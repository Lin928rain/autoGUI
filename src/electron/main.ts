import electron from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import util from 'util';
import type { BrowserWindow as BrowserWindowType, Tray as TrayType } from 'electron';
import { Agent, AgentRunResult } from '../agent.js';
import { Config } from '../types/index.js';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut, screen } =
  electron as typeof import('electron');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface UISettings {
  invokeHotkey: string;
  interruptHotkey: string;
  completionAutoCloseMs: number;
}

const LEGACY_DEFAULT_SETTINGS = {
  invokeHotkey: 'CommandOrControl+Shift+Space',
  interruptHotkey: 'CommandOrControl+Shift+X',
} as const;

const DEFAULT_SETTINGS: UISettings = {
  invokeHotkey: 'CommandOrControl+Alt+A',
  interruptHotkey: 'CommandOrControl+Alt+X',
  completionAutoCloseMs: 7000,
};

let promptWindow: BrowserWindowType | null = null;
let auraWindow: BrowserWindowType | null = null;
let completionWindow: BrowserWindowType | null = null;
let settingsWindow: BrowserWindowType | null = null;
let tray: TrayType | null = null;
let agent: Agent | null = null;
let isRunning = false;
let stopRequestedByUser = false;
let uiSettings: UISettings = { ...DEFAULT_SETTINGS };
let completionTimer: NodeJS.Timeout | null = null;
let auraPreviewPinned = false;
let promptPositionLocked = false;
let auraHideTimer: NodeJS.Timeout | null = null;
const AURA_REVEAL_DELAY_MS = 300;
const AURA_HIDE_ANIMATION_MS = 480;

const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
};

function formatLogArgs(args: unknown[]): string {
  return args
    .map((arg) =>
      typeof arg === 'string'
        ? arg
        : util.inspect(arg, { depth: 4, colors: false, compact: true })
    )
    .join(' ');
}

function sendToAll(channel: string, payload: unknown): void {
  for (const win of [promptWindow, auraWindow, settingsWindow, completionWindow]) {
    if (!win || win.isDestroyed()) continue;
    win.webContents.send(channel, payload);
  }
}

function sendLog(level: 'log' | 'warn' | 'error' | 'info', args: unknown[]): void {
  sendToAll('app:log', {
    level,
    message: formatLogArgs(args),
    timestamp: new Date().toISOString(),
  });
}

function patchConsole(): void {
  console.log = (...args: unknown[]) => {
    sendLog('log', args);
    originalConsole.log(...args);
  };
  console.warn = (...args: unknown[]) => {
    sendLog('warn', args);
    originalConsole.warn(...args);
  };
  console.error = (...args: unknown[]) => {
    sendLog('error', args);
    originalConsole.error(...args);
  };
  console.info = (...args: unknown[]) => {
    sendLog('info', args);
    originalConsole.info(...args);
  };
}

function getConfigPath(): string {
  return path.join(process.cwd(), 'config.json');
}

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'ui-settings.json');
}

function getAppIconPath(): string {
  const cwdIcon = path.join(process.cwd(), 'app.ico');
  if (nativeImage.createFromPath(cwdIcon).isEmpty()) {
    return '';
  }
  return cwdIcon;
}

function normalizeConfig(input: Partial<Config>): Config {
  const api = input.api || ({} as Partial<Config['api']>);
  const settings = input.settings || ({} as Partial<Config['settings']>);

  const apiKey = api.api_key;
  const normalizedApiKey = Array.isArray(apiKey)
    ? apiKey.map((k) => String(k || '').trim()).filter(Boolean)
    : String(apiKey || '').trim();

  const legacyProviderId = String(api.provider || 'default');
  const legacyBaseUrl = String(api.base_url || '');
  const legacyModel = String(api.model || '');
  const legacyKeys = Array.isArray(normalizedApiKey)
    ? normalizedApiKey
    : normalizedApiKey
      ? [normalizedApiKey]
      : [];

  const rawProviders = Array.isArray(api.providers) ? api.providers : [];
  const normalizedProviders = rawProviders
    .map((p, idx) => {
      const providerId = String((p as any).id || `provider_${idx + 1}`).trim();
      const providerName = String((p as any).name || providerId || `Provider ${idx + 1}`).trim();
      const providerEnabled = (p as any).enabled !== false;
      const providerBaseUrl = String((p as any).base_url || '').trim();
      const providerKeys = Array.isArray((p as any).api_keys)
        ? (p as any).api_keys.map((k: unknown) => String(k || '').trim()).filter(Boolean)
        : [];
      const providerModels = Array.isArray((p as any).models)
        ? (p as any).models
            .map((m: any) => ({
              id: String(m?.id || '').trim(),
              enabled: m?.enabled !== false,
            }))
            .filter((m: { id: string }) => Boolean(m.id))
        : [];

      if (!providerId || !providerBaseUrl || providerKeys.length === 0 || providerModels.length === 0) {
        return null;
      }

      return {
        id: providerId,
        name: providerName,
        enabled: providerEnabled,
        base_url: providerBaseUrl,
        api_keys: providerKeys,
        models: providerModels,
      };
    })
    .filter(Boolean) as NonNullable<Config['api']['providers']>;

  const providers =
    normalizedProviders.length > 0
      ? normalizedProviders
      : legacyBaseUrl && legacyModel && legacyKeys.length > 0
        ? [
            {
              id: legacyProviderId || 'default',
              name: String(api.provider || 'OpenAI Compatible'),
              enabled: true,
              base_url: legacyBaseUrl,
              api_keys: legacyKeys,
              models: [{ id: legacyModel, enabled: true }],
            },
          ]
        : [];

  return {
    api: {
      provider: String(api.provider || 'OpenAI Compatible'),
      base_url: legacyBaseUrl,
      api_key: normalizedApiKey,
      model: legacyModel,
      providers,
    },
    settings: {
      screenshot_interval:
        typeof settings.screenshot_interval === 'number' && settings.screenshot_interval > 0
          ? settings.screenshot_interval
          : 2000,
      max_iterations:
        typeof settings.max_iterations === 'number' && settings.max_iterations > 0
          ? settings.max_iterations
          : 50,
      coordinate_scale:
        typeof settings.coordinate_scale === 'number' && settings.coordinate_scale > 0
          ? settings.coordinate_scale
          : 1000,
      action_context_length:
        typeof settings.action_context_length === 'number' && settings.action_context_length >= 0
          ? Math.min(50, Math.floor(settings.action_context_length))
          : 8,
    },
  };
}

async function loadConfig(): Promise<Config> {
  const configPath = getConfigPath();
  const raw = await fs.readFile(configPath, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<Config>;
  return normalizeConfig(parsed);
}

async function saveConfig(nextConfig: Partial<Config>): Promise<Config> {
  const normalized = normalizeConfig(nextConfig);
  const configPath = getConfigPath();
  await fs.writeFile(configPath, JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

async function loadUISettings(): Promise<UISettings> {
  try {
    const raw = await fs.readFile(getSettingsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<UISettings>;
    const normalizedInvoke = normalizeAcceleratorInput(
      parsed.invokeHotkey || DEFAULT_SETTINGS.invokeHotkey
    );
    const normalizedInterrupt = normalizeAcceleratorInput(
      parsed.interruptHotkey || DEFAULT_SETTINGS.interruptHotkey
    );

    const invokeHotkey =
      normalizedInvoke === LEGACY_DEFAULT_SETTINGS.invokeHotkey
        ? DEFAULT_SETTINGS.invokeHotkey
        : normalizedInvoke;
    const interruptHotkey =
      normalizedInterrupt === LEGACY_DEFAULT_SETTINGS.interruptHotkey
        ? DEFAULT_SETTINGS.interruptHotkey
        : normalizedInterrupt;

    return {
      invokeHotkey,
      interruptHotkey,
      completionAutoCloseMs:
        typeof parsed.completionAutoCloseMs === 'number' && parsed.completionAutoCloseMs >= 1000
          ? parsed.completionAutoCloseMs
          : DEFAULT_SETTINGS.completionAutoCloseMs,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveUISettings(nextSettings: UISettings): Promise<void> {
  uiSettings = nextSettings;
  await fs.writeFile(getSettingsPath(), JSON.stringify(uiSettings, null, 2), 'utf-8');
}

function normalizeAcceleratorInput(input: string): string {
  const cleaned = String(input || '').trim();
  if (!cleaned) return '';

  const normalizedText = cleaned.replace(/\s+/g, '').replace(/-/g, '+');
  const tokens = normalizedText
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (
        lower === 'ctrl' ||
        lower === 'control' ||
        lower === 'cmdorctrl' ||
        lower === 'commandorcontrol' ||
        lower === 'commandorcommandorcontrol'
      ) {
        return 'CommandOrControl';
      }
      if (lower === 'cmd' || lower === 'command') return 'Command';
      if (lower === 'opt' || lower === 'option' || lower === 'alt') return 'Alt';
      if (lower === 'esc') return 'Escape';
      if (part.length === 1) return part.toUpperCase();
      return part;
    });

  return tokens.join('+');
}

function getPrimaryDisplayOuterBounds(): Electron.Rectangle {
  const display = screen.getPrimaryDisplay();
  const b = display.bounds;
  const wa = display.workArea;
  const size = display.size;

  const x = Math.min(b.x, wa.x);
  const y = Math.min(b.y, wa.y);
  const right = Math.max(b.x + b.width, wa.x + wa.width, x + size.width);
  const bottom = Math.max(b.y + b.height, wa.y + wa.height, y + size.height);

  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

function syncAuraBounds(): void {
  if (!auraWindow || auraWindow.isDestroyed()) return;
  auraWindow.setBounds(getPrimaryDisplayOuterBounds());
}

function emitStatus(status: 'idle' | 'running' | 'error', detail = ''): void {
  sendToAll('agent:status', { status, detail });
}

async function ensureAgent(): Promise<Agent> {
  const config = await loadConfig();
  agent = new Agent(config);
  return agent;
}

async function createPromptWindow(): Promise<void> {
  if (promptWindow && !promptWindow.isDestroyed()) return;

  promptWindow = new BrowserWindow({
    width: 900,
    height: 340,
    show: false,
    frame: false,
    resizable: false,
    transparent: true,
    backgroundColor: '#00000000',
    skipTaskbar: true,
    alwaysOnTop: true,
    roundedCorners: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  promptWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  promptWindow.on('closed', () => {
    promptWindow = null;
  });

  const htmlPath = path.join(app.getAppPath(), 'ui', 'prompt.html');
  await promptWindow.loadFile(htmlPath);
  promptPositionLocked = false;
  positionPromptWindow(true);
}

async function createAuraWindow(): Promise<void> {
  if (auraWindow && !auraWindow.isDestroyed()) return;

  const bounds = getPrimaryDisplayOuterBounds();
  auraWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    show: false,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  auraWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  auraWindow.setIgnoreMouseEvents(true, { forward: true });
  try {
    auraWindow.setContentProtection(true);
  } catch (error) {
    console.warn('启用光晕防截图失败，将继续使用普通模式:', error);
  }

  auraWindow.on('closed', () => {
    auraWindow = null;
  });

  const htmlPath = path.join(app.getAppPath(), 'ui', 'aura.html');
  await auraWindow.loadFile(htmlPath);
}

async function createCompletionWindow(): Promise<void> {
  if (completionWindow && !completionWindow.isDestroyed()) return;

  completionWindow = new BrowserWindow({
    width: 360,
    height: 120,
    show: false,
    frame: false,
    resizable: false,
    transparent: false,
    backgroundColor: '#ffffff',
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  completionWindow.on('closed', () => {
    completionWindow = null;
  });

  const htmlPath = path.join(app.getAppPath(), 'ui', 'completion.html');
  await completionWindow.loadFile(htmlPath);
}

async function createSettingsWindow(): Promise<void> {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 700,
    height: 760,
    show: false,
    resizable: false,
    title: '系统设置',
    icon: getAppIconPath() || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  const htmlPath = path.join(app.getAppPath(), 'ui', 'settings.html');
  await settingsWindow.loadFile(htmlPath);
  settingsWindow.show();
  settingsWindow.focus();
}

function positionPromptWindow(force = false): void {
  if (!promptWindow || promptWindow.isDestroyed()) return;
  if (promptPositionLocked && !force) return;

  const display = screen.getPrimaryDisplay();
  const { width, height, x, y } = display.workArea;
  const [windowWidth, windowHeight] = promptWindow.getSize();

  const left = x + Math.round((width - windowWidth) / 2);
  const top = y + height - windowHeight - 42;
  promptWindow.setPosition(left, top, false);
  promptPositionLocked = true;
}

function positionCompletionWindow(): void {
  if (!completionWindow || completionWindow.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  const { width, height, x, y } = display.workArea;
  const [windowWidth, windowHeight] = completionWindow.getSize();

  const left = x + Math.round((width - windowWidth) / 2);
  const top = y + Math.round((height - windowHeight) / 2);
  completionWindow.setPosition(left, top, false);
}

function hidePromptWindow(): void {
  if (!promptWindow || promptWindow.isDestroyed()) return;
  promptWindow.hide();
}

function showPromptWindow(): void {
  if (isRunning) return;
  if (!promptWindow || promptWindow.isDestroyed()) return;
  positionPromptWindow(false);
  promptWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  promptWindow.setIgnoreMouseEvents(false);
  promptWindow.show();
  promptWindow.moveTop();
  promptWindow.focus();
  promptWindow.webContents.send('prompt:reset');
}

async function showAura(): Promise<void> {
  if (!auraWindow || auraWindow.isDestroyed()) return;
  const wasVisible = auraWindow.isVisible();
  if (auraHideTimer) {
    clearTimeout(auraHideTimer);
    auraHideTimer = null;
  }
  syncAuraBounds();
  if (!wasVisible) {
    auraWindow.webContents.send('aura:visibility', { visible: false });
  }
  auraWindow.showInactive();
  auraWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  auraWindow.moveTop();
  if (!wasVisible) {
    await new Promise((resolve) => setTimeout(resolve, AURA_REVEAL_DELAY_MS));
  }
  auraWindow.webContents.send('aura:visibility', { visible: true });
}

function hideAura(): void {
  if (!auraWindow || auraWindow.isDestroyed()) return;
  auraWindow.webContents.send('aura:visibility', { visible: false });
  if (auraHideTimer) {
    clearTimeout(auraHideTimer);
  }
  auraHideTimer = setTimeout(() => {
    if (!auraWindow || auraWindow.isDestroyed()) return;
    auraWindow.hide();
    auraHideTimer = null;
  }, AURA_HIDE_ANIMATION_MS);
}

function clearCompletionTimer(): void {
  if (completionTimer) {
    clearTimeout(completionTimer);
    completionTimer = null;
  }
}

function hideCompletionWindow(): void {
  clearCompletionTimer();
  if (!completionWindow || completionWindow.isDestroyed()) return;
  completionWindow.hide();
}

async function showCompletionWindow(message: string): Promise<void> {
  if (!completionWindow || completionWindow.isDestroyed()) return;
  clearCompletionTimer();

  const seconds = Math.max(1, Math.round(uiSettings.completionAutoCloseMs / 1000));
  positionCompletionWindow();
  completionWindow.webContents.send('completion:update', {
    message,
    seconds,
  });
  completionWindow.show();
  completionWindow.focus();

  completionTimer = setTimeout(() => {
    hideCompletionWindow();
  }, uiSettings.completionAutoCloseMs);
}

function buildTrayIcon(): Electron.NativeImage {
  const iconPath = getAppIconPath();
  if (iconPath) {
    const ico = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    if (!ico.isEmpty()) return ico;
  }

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#00e0ff"/>
        <stop offset="50%" stop-color="#42ff93"/>
        <stop offset="100%" stop-color="#ff9a3d"/>
      </linearGradient>
    </defs>
    <rect x="5" y="5" width="54" height="54" rx="14" fill="#0e1626"/>
    <rect x="8" y="8" width="48" height="48" rx="12" fill="none" stroke="url(#g)" stroke-width="4"/>
    <circle cx="32" cy="32" r="8" fill="url(#g)"/>
  </svg>`;

  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const icon = nativeImage.createFromDataURL(dataUrl).resize({ width: 16, height: 16 });
  return icon;
}

function refreshTrayMenu(): void {
  if (!tray) return;

  const menu = Menu.buildFromTemplate([
    { label: `唤起快捷键: ${uiSettings.invokeHotkey}`, enabled: false },
    { label: `中断快捷键: ${uiSettings.interruptHotkey}`, enabled: false },
    { type: 'separator' },
    {
      label: '输入任务',
      click: () => showPromptWindow(),
      enabled: !isRunning,
    },
    {
      label: '停止当前任务',
      click: () => stopTaskExecution(),
      enabled: isRunning,
    },
    {
      label: '系统设置',
      click: () => {
        void createSettingsWindow();
      },
    },
    {
      label: auraPreviewPinned ? '隐藏光晕测试' : '显示光晕测试',
      click: () => {
        auraPreviewPinned = !auraPreviewPinned;
        if (auraPreviewPinned) {
          void showAura();
        } else {
          hideAura();
        }
        refreshTrayMenu();
      },
      enabled: !isRunning,
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip(isRunning ? 'AutoGUI 正在执行任务' : 'AutoGUI 已在托盘运行');
}

function registerHotkeys(): { invoke: string; interrupt: string; errors: string[] } {
  const errors: string[] = [];
  globalShortcut.unregisterAll();

  let invokeKey = normalizeAcceleratorInput(uiSettings.invokeHotkey);
  let interruptKey = normalizeAcceleratorInput(uiSettings.interruptHotkey);

  if (!invokeKey) invokeKey = DEFAULT_SETTINGS.invokeHotkey;
  if (!interruptKey) interruptKey = DEFAULT_SETTINGS.interruptHotkey;

  let invokeOk = globalShortcut.register(invokeKey, () => {
    showPromptWindow();
  });
  if (!invokeOk) {
    errors.push(`无法注册唤起快捷键: ${invokeKey}`);
    invokeKey = DEFAULT_SETTINGS.invokeHotkey;
    invokeOk = globalShortcut.register(invokeKey, () => {
      showPromptWindow();
    });
    if (!invokeOk) {
      errors.push(`回退唤起快捷键也注册失败: ${invokeKey}`);
    }
  }

  let interruptOk = globalShortcut.register(interruptKey, () => {
    void stopTaskExecution();
  });
  if (!interruptOk) {
    errors.push(`无法注册中断快捷键: ${interruptKey}`);
    interruptKey = DEFAULT_SETTINGS.interruptHotkey;
    interruptOk = globalShortcut.register(interruptKey, () => {
      void stopTaskExecution();
    });
    if (!interruptOk) {
      errors.push(`回退中断快捷键也注册失败: ${interruptKey}`);
    }
  }

  uiSettings.invokeHotkey = invokeKey;
  uiSettings.interruptHotkey = interruptKey;

  sendToAll('hotkey:updated', {
    invokeHotkey: invokeKey,
    interruptHotkey: interruptKey,
    errors,
  });

  if (errors.length) {
    console.warn('[hotkey] 注册异常:', errors.join(' | '));
  } else {
    console.info(`[hotkey] 已注册: invoke=${invokeKey}, interrupt=${interruptKey}`);
  }

  return { invoke: invokeKey, interrupt: interruptKey, errors };
}

async function createTray(): Promise<void> {
  if (tray) return;

  tray = new Tray(buildTrayIcon());
  tray.on('double-click', () => {
    showPromptWindow();
  });
  tray.on('click', () => {
    showPromptWindow();
  });

  refreshTrayMenu();
}

async function runTask(task: string, modelTarget = 'all'): Promise<{ ok: boolean; message?: string }> {
  const inputTask = String(task || '').trim();
  if (!inputTask) {
    return { ok: false, message: '任务不能为空' };
  }

  if (isRunning) {
    return { ok: false, message: '任务正在执行中' };
  }

  try {
    const instance = await ensureAgent();

    hidePromptWindow();
    hideCompletionWindow();

    isRunning = true;
    stopRequestedByUser = false;
    emitStatus('running', '任务执行中');
    refreshTrayMenu();
    await showAura();

    const result: AgentRunResult = await instance.run(
      inputTask,
      {
        beforeCapture: async () => {
          hidePromptWindow();
        },
      },
      { modelTarget }
    );

    if (result.status === 'error') {
      emitStatus('error', result.error || '任务执行失败');
      await showCompletionWindow(`任务失败: ${result.error || '未知错误'}`);
      return { ok: false, message: result.error || '任务执行失败' };
    }

    if (result.status === 'stopped' || stopRequestedByUser) {
      emitStatus('idle', '任务已中断');
      await showCompletionWindow('任务已中断');
      return { ok: true };
    }

    if (result.status === 'max_iterations') {
      emitStatus('idle', '达到最大迭代次数');
      await showCompletionWindow('任务结束：达到最大迭代次数');
      return { ok: true };
    }

    emitStatus('idle', '任务完成');
    await showCompletionWindow('任务完成');
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('启动任务失败:', message);
    emitStatus('error', message);
    await showCompletionWindow(`任务失败: ${message}`);
    return { ok: false, message };
  } finally {
    isRunning = false;
    hideAura();
    agent = null;
    refreshTrayMenu();
  }
}

async function stopTaskExecution(): Promise<{ ok: boolean; message?: string }> {
  if (!agent || !isRunning) {
    return { ok: true };
  }

  stopRequestedByUser = true;
  agent.stop();
  hideAura();
  emitStatus('idle', '正在中断任务...');
  return { ok: true };
}

ipcMain.handle('ui:show-prompt', async () => {
  showPromptWindow();
  return { ok: true };
});

ipcMain.handle('ui:hide-prompt', async () => {
  hidePromptWindow();
  return { ok: true };
});

ipcMain.handle('ui:set-prompt-click-through', async (_event, enabled: boolean) => {
  if (promptWindow && !promptWindow.isDestroyed()) {
    promptWindow.setIgnoreMouseEvents(Boolean(enabled), { forward: true });
  }
  return { ok: true };
});

ipcMain.handle(
  'ui:submit-task',
  async (_event, payload: string | { task?: string; modelTarget?: string }) => {
    if (typeof payload === 'string') {
      return runTask(payload, 'all');
    }
    return runTask(String(payload?.task || ''), String(payload?.modelTarget || 'all'));
  }
);

ipcMain.handle('app:list-model-targets', async () => {
  try {
    const config = await loadConfig();
    const providers = Array.isArray(config.api.providers) ? config.api.providers : [];
    let targets = providers
      .filter((p) => p.enabled)
      .flatMap((p) =>
        (Array.isArray(p.models) ? p.models : [])
          .filter((m) => m.enabled)
          .map((m) => ({
            id: `${p.id}::${m.id}`,
            providerId: p.id,
            providerName: p.name || p.id,
            modelId: m.id,
            label: `${p.name || p.id} / ${m.id}`,
          }))
      );

    if (targets.length === 0 && config.api.base_url && config.api.model) {
      targets = [
        {
          id: `legacy::${config.api.model}`,
          providerId: 'legacy',
          providerName: config.api.provider || 'OpenAI Compatible',
          modelId: config.api.model,
          label: `${config.api.provider || 'OpenAI Compatible'} / ${config.api.model}`,
        },
      ];
    }
    return { ok: true, targets };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message, targets: [] };
  }
});

ipcMain.handle('agent:start', async (_event, task: string) => {
  return runTask(task);
});

ipcMain.handle('agent:stop', async () => {
  return stopTaskExecution();
});

ipcMain.handle('ui:open-settings', async () => {
  await createSettingsWindow();
  return { ok: true };
});

ipcMain.handle('ui:get-hotkey-settings', async () => {
  return { ok: true, settings: uiSettings };
});

ipcMain.handle(
  'ui:save-hotkey-settings',
  async (_event, payload: Partial<UISettings> & { invokeHotkey?: string; interruptHotkey?: string }) => {
    const nextSettings: UISettings = {
      invokeHotkey: normalizeAcceleratorInput(payload.invokeHotkey || uiSettings.invokeHotkey),
      interruptHotkey: normalizeAcceleratorInput(payload.interruptHotkey || uiSettings.interruptHotkey),
      completionAutoCloseMs:
        typeof payload.completionAutoCloseMs === 'number' && payload.completionAutoCloseMs >= 1000
          ? payload.completionAutoCloseMs
          : uiSettings.completionAutoCloseMs,
    };

    await saveUISettings(nextSettings);
    const registration = registerHotkeys();
    refreshTrayMenu();

    return {
      ok: true,
      settings: uiSettings,
      errors: registration.errors,
    };
  }
);

ipcMain.handle('ui:close-completion', async () => {
  hideCompletionWindow();
  return { ok: true };
});

ipcMain.handle('app:get-config-meta', async () => {
  try {
    const config = await loadConfig();
    return {
      ok: true,
      config: {
        provider: config.api.provider || 'OpenAI Compatible',
        baseURL: config.api.base_url,
        model: config.api.model,
        keyCount: Array.isArray(config.api.api_key) ? config.api.api_key.length : 1,
        providerCount: Array.isArray(config.api.providers) ? config.api.providers.length : 0,
        actionContextLength: config.settings.action_context_length || 8,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message };
  }
});

ipcMain.handle('app:get-runtime-config', async () => {
  try {
    const config = await loadConfig();
    return { ok: true, config };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message };
  }
});

ipcMain.handle('app:save-runtime-config', async (_event, payload: Partial<Config>) => {
  try {
    const saved = await saveConfig(payload);
    // Force recreation on next run so latest API/model settings take effect.
    if (!isRunning) {
      agent = null;
    }
    return { ok: true, config: saved };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message };
  }
});

app.whenReady().then(async () => {
  patchConsole();
  uiSettings = await loadUISettings();

  await createPromptWindow();
  await createAuraWindow();
  await createCompletionWindow();
  await createTray();

  registerHotkeys();
  refreshTrayMenu();
  emitStatus('idle', '待命');

  if (process.env.AURA_PREVIEW === '1') {
    await showAura();
  }

  screen.on('display-metrics-changed', async () => {
    promptPositionLocked = false;
    positionPromptWindow(true);
    positionCompletionWindow();
    syncAuraBounds();
  });
});

app.on('browser-window-created', (_event, window) => {
  window.setMenuBarVisibility(false);
});

app.on('window-all-closed', () => {
  // keep running in tray mode
});

app.on('before-quit', () => {
  clearCompletionTimer();
  globalShortcut.unregisterAll();
});

app.on('activate', async () => {
  showPromptWindow();
});

