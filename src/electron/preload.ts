const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

type AgentStatus = {
  status: 'idle' | 'running' | 'error';
  detail: string;
};

type LogPayload = {
  level: 'log' | 'warn' | 'error' | 'info';
  message: string;
  timestamp: string;
};

type HotkeySettings = {
  invokeHotkey: string;
  interruptHotkey: string;
  completionAutoCloseMs: number;
};

type HotkeyUpdatedPayload = {
  invokeHotkey: string;
  interruptHotkey: string;
  errors: string[];
};

type CompletionPayload = {
  message: string;
  seconds: number;
};

type AuraVisibilityPayload = {
  visible: boolean;
};

type RuntimeConfig = {
  api: {
    provider?: string;
    base_url: string;
    api_key: string | string[];
    model: string;
    providers?: Array<{
      id: string;
      name: string;
      enabled: boolean;
      base_url: string;
      api_keys: string[];
      models: Array<{ id: string; enabled: boolean }>;
    }>;
  };
  settings: {
    screenshot_interval: number;
    max_iterations: number;
    coordinate_scale: number;
    action_context_length?: number;
  };
};

contextBridge.exposeInMainWorld('autogui', {
  startTask: (task: string) => ipcRenderer.invoke('agent:start', task),
  stopTask: () => ipcRenderer.invoke('agent:stop'),
  submitTask: (payload: string | { task?: string; modelTarget?: string }) =>
    ipcRenderer.invoke('ui:submit-task', payload),
  showPrompt: () => ipcRenderer.invoke('ui:show-prompt'),
  hidePrompt: () => ipcRenderer.invoke('ui:hide-prompt'),
  setPromptClickThrough: (enabled: boolean) => ipcRenderer.invoke('ui:set-prompt-click-through', enabled),
  openSettings: () => ipcRenderer.invoke('ui:open-settings'),
  closeCompletion: () => ipcRenderer.invoke('ui:close-completion'),
  getConfigMeta: () => ipcRenderer.invoke('app:get-config-meta'),
  getRuntimeConfig: () => ipcRenderer.invoke('app:get-runtime-config'),
  saveRuntimeConfig: (config: Partial<RuntimeConfig>) => ipcRenderer.invoke('app:save-runtime-config', config),
  listModelTargets: () => ipcRenderer.invoke('app:list-model-targets'),
  getHotkeySettings: () => ipcRenderer.invoke('ui:get-hotkey-settings'),
  saveHotkeySettings: (settings: Partial<HotkeySettings>) =>
    ipcRenderer.invoke('ui:save-hotkey-settings', settings),
  onStatus: (handler: (payload: AgentStatus) => void) => {
    const wrapped = (_event: unknown, payload: AgentStatus) => handler(payload);
    ipcRenderer.on('agent:status', wrapped);
    return () => ipcRenderer.removeListener('agent:status', wrapped);
  },
  onLog: (handler: (payload: LogPayload) => void) => {
    const wrapped = (_event: unknown, payload: LogPayload) => handler(payload);
    ipcRenderer.on('app:log', wrapped);
    return () => ipcRenderer.removeListener('app:log', wrapped);
  },
  onHotkeyUpdated: (handler: (payload: HotkeyUpdatedPayload) => void) => {
    const wrapped = (_event: unknown, payload: HotkeyUpdatedPayload) => handler(payload);
    ipcRenderer.on('hotkey:updated', wrapped);
    return () => ipcRenderer.removeListener('hotkey:updated', wrapped);
  },
  onPromptReset: (handler: () => void) => {
    const wrapped = () => handler();
    ipcRenderer.on('prompt:reset', wrapped);
    return () => ipcRenderer.removeListener('prompt:reset', wrapped);
  },
  onCompletionUpdate: (handler: (payload: CompletionPayload) => void) => {
    const wrapped = (_event: unknown, payload: CompletionPayload) => handler(payload);
    ipcRenderer.on('completion:update', wrapped);
    return () => ipcRenderer.removeListener('completion:update', wrapped);
  },
  onAuraVisibility: (handler: (payload: AuraVisibilityPayload) => void) => {
    const wrapped = (_event: unknown, payload: AuraVisibilityPayload) => handler(payload);
    ipcRenderer.on('aura:visibility', wrapped);
    return () => ipcRenderer.removeListener('aura:visibility', wrapped);
  },
});
