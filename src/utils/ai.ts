import OpenAI from 'openai';
import { Config, AIResponse, Action } from '../types/index.js';
type ModelPoolEntry = {
  entryId: string;
  providerId: string;
  providerName: string;
  baseURL: string;
  model: string;
  apiKey: string;
};

export class AIClient {
  private config: Config;
  private systemPrompt: string;
  private modelPool: ModelPoolEntry[] = [];
  private poolCursorByTarget: Map<string, number> = new Map();
  private activeRequestControllers: Set<AbortController> = new Set();

  constructor(config: Config) {
    this.config = config;
    this.systemPrompt = this.generateSystemPrompt();
    this.modelPool = this.buildModelPool(config);
  }

  private generateSystemPrompt(): string {
    return `你是一个电脑操作助手。你的任务是分析屏幕截图并决定下一步操作。
你可以执行以下操作：

1. click - 点击指定位置
   {“thought”: “...”, “action”: {“action”: “click”, “x”: 500, “y”: 300}}
2. double_click - 双击
3. right_click - 右键点击
4. long_press - 左键长按（秒）
   {“thought”: “...”, “action”: {“action”: “long_press”, “x”: 500, “y”: 300, “hold_seconds”: 1.5}}
5. type - 输入文本
6. enter - 按下回车（提交输入）
   {“thought”: “...”, “action”: {“action”: “enter”}}
7. press - 按键组合
8. scroll - 滚动
9. drag - 拖拽
10. move - 移动鼠标
11. wait - 等待
12. task_complete - 任务完成
13. shell - 执行命令行命令（新增）
    {“thought”: “...”, “action”: {“action”: “shell”, “command”: “dir”, “capture_output”: true}}

shell 动作说明：
- command: 要执行的命令（必填），如 “dir”, “ls -la”, “git status”, “node --version”
- capture_output: 是否捕获输出，默认 true（可选）
- timeout: 超时时间（毫秒），默认 30000（可选）
- work_dir: 工作目录（可选），如 “C:\\project”
- shell: 指定 shell 类型，如 “powershell”, “cmd”, “bash”（可选）
- 执行结果会在下一轮迭代中反馈给你

多命令执行方式：
1. 使用连接符：cd C:\\project && npm install && node app.js
2. 使用分号：cd C:\\project; npm install; node app.js
3. 使用 cd 命令会自动跟踪工作目录，后续 shell 命令会在该目录下执行

坐标系说明：
- 截图坐标系是 1000x1000
- 左上角是 (0,0)，右下角是 (1000,1000)
- x 和 y 必须是数字（不要数组）

重要规则：
- 只返回 JSON 对象，不要 markdown 代码块，不要额外解释。
- 需要提交输入框内容时，优先使用 enter 动作，不要等待界面自动提交。
- 如果任务完成，返回 task_complete。
- 必须通过”当前截图中的可见证据”确认上一步是否成功，再决定下一步；不能只凭假设继续。
- 如果当前截图与预期不一致（点错、弹错窗口、页面未变化等），不要假装成功；应返回修正动作或 wait。
- 除非用户任务明确要求”关闭/退出/结束某窗口或程序”，否则禁止执行任何关闭类操作（点击关闭按钮、Alt+F4、关闭终端/控制台等）。
- 使用 shell 命令时，请使用安全的命令（如 dir, ls, git, node 等），不要执行危险命令（如 rm -rf, format, deltree 等）。`;
  }

  private getClientForEntry(entry: ModelPoolEntry): OpenAI {
    return new OpenAI({
      baseURL: entry.baseURL,
      apiKey: entry.apiKey,
    });
  }

  async analyzeScreenshot(
    base64Image: string,
    userTask: string,
    previousActions: Action[] = [],
    modelTarget: string = 'all',
    shouldAbort: () => boolean = () => false
  ): Promise<AIResponse> {
    if (shouldAbort()) {
      throw new Error('TASK_ABORTED');
    }

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.systemPrompt,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `用户任务: ${userTask}\n\n请分析当前屏幕截图并决定下一步操作，必须返回 JSON。`,
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${base64Image}`,
            },
          },
        ],
      },
    ];

    const contextLength = Math.max(0, Math.floor(this.config.settings.action_context_length ?? 8));

    if (previousActions.length > 0 && contextLength > 0) {
      messages.push({
        role: 'assistant',
        content: `之前的操作: ${JSON.stringify(previousActions.slice(-contextLength))}`,
      });
    }

    const targetKey = String(modelTarget || 'all');
    const targetPool = this.getPoolForTarget(targetKey);
    if (targetPool.length === 0) {
      throw new Error(`没有可用的模型池: ${targetKey}`);
    }

    let lastError: Error | null = null;
    const maxRetries = Math.max(6, targetPool.length * 3);
    let formatErrorFeedback = '';
    const apiErrorEntriesThisRequest = new Set<string>();
    let apiErrorRound = 0;
    const apiErrorRoundBackoffMs = [5000, 10000];
    let currentEntry = this.getNextPoolEntry(targetPool, targetKey);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (shouldAbort()) {
        throw new Error('TASK_ABORTED');
      }

      const requestController = new AbortController();
      this.activeRequestControllers.add(requestController);
      try {
        const client = this.getClientForEntry(currentEntry);
        const requestMessages = [...messages];
        if (formatErrorFeedback) {
          requestMessages.push({
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  `${formatErrorFeedback}\n` +
                  '请仅返回一个合法 JSON，对缺失字段进行修正，不要输出解释。',
              },
            ],
          });
        }

        const response = await client.chat.completions.create({
          model: currentEntry.model,
          messages: requestMessages,
          response_format: { type: 'json_object' },
          max_tokens: 500,
          temperature: 0.2,
        }, {
          signal: requestController.signal,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error('AI 返回空响应');
        }

        // 调试日志：输出 AI 原始返回内容
        console.log('[AI 原始响应]', content.slice(0, 1000) + (content.length > 1000 ? '...' : ''));

        const parsedResponse = this.parseResponseJson(content);
        const fixedAction = this.fixActionFormat(parsedResponse.action);

        // 调试日志：输出解析后的动作
        console.log('[解析后动作]', JSON.stringify(fixedAction));

        this.validateActionOrThrow(fixedAction);

        return {
          thought: parsedResponse.thought || '',
          action: fixedAction,
        };
      } catch (error) {
        if (shouldAbort()) {
          throw new Error('TASK_ABORTED');
        }

        lastError = error as Error;
        const errorMessage = lastError.message || '未知错误';
        if (this.isAbortError(errorMessage)) {
          throw new Error('TASK_ABORTED');
        }

        console.error(`AI 分析错误 (尝试 ${attempt + 1}/${maxRetries}):`, errorMessage);

        if (this.isApiKeyError(errorMessage)) {
          apiErrorEntriesThisRequest.add(currentEntry.entryId);
          if (apiErrorEntriesThisRequest.size >= targetPool.length) {
            apiErrorRound += 1;

            if (apiErrorRound >= 3) {
              throw new Error(
                `API_KEY_POOL_EXHAUSTED: 当前模型池(${targetKey})连续 3 轮全部触发限额/鉴权错误`
              );
            }

            const waitMs = apiErrorRoundBackoffMs[apiErrorRound - 1] || 10000;
            console.warn(
              `模型池(${targetKey})第 ${apiErrorRound} 轮全部报错，等待 ${Math.round(waitMs / 1000)} 秒后重试...`
            );
            await this.sleepWithAbort(waitMs, shouldAbort);
            apiErrorEntriesThisRequest.clear();
          }

          currentEntry = this.getNextPoolEntry(targetPool, targetKey);
          console.log(`切换到下一个模型池条目: ${currentEntry.providerName}/${currentEntry.model}`);
          continue;
        }

        if (this.isJsonParseError(errorMessage)) {
          if (attempt < maxRetries - 1) {
            console.warn('AI 返回 JSON 格式异常，正在重试...');
            await this.sleepWithAbort(800, shouldAbort);
            continue;
          }
          break;
        }

        if (this.isActionFormatError(errorMessage)) {
          if (attempt < maxRetries - 1) {
            formatErrorFeedback = `上一条动作格式错误：${errorMessage}`;
            console.warn('AI 返回动作字段不完整，要求其重新生成...');
            await this.sleepWithAbort(500, shouldAbort);
            continue;
          }
          break;
        }

        throw error;
      } finally {
        this.activeRequestControllers.delete(requestController);
      }
    }

    throw lastError || new Error('所有 API Key 都请求失败');
  }

  private buildModelPool(config: Config): ModelPoolEntry[] {
    const entries: ModelPoolEntry[] = [];

    if (Array.isArray(config.api.providers) && config.api.providers.length > 0) {
      for (const provider of config.api.providers) {
        if (!provider?.enabled) continue;
        const baseURL = String(provider.base_url || '').trim();
        if (!baseURL) continue;

        const keys = Array.isArray(provider.api_keys)
          ? provider.api_keys.map((k) => String(k || '').trim()).filter(Boolean)
          : [];
        if (keys.length === 0) continue;

        const models = Array.isArray(provider.models)
          ? provider.models.filter((m) => m?.enabled && String(m.id || '').trim())
          : [];
        if (models.length === 0) continue;

        for (const model of models) {
          const modelId = String(model.id || '').trim();
          for (const key of keys) {
            entries.push({
              entryId: `${provider.id}::${modelId}::${key}`,
              providerId: String(provider.id || '').trim() || 'provider',
              providerName: String(provider.name || provider.id || 'Provider'),
              baseURL,
              model: modelId,
              apiKey: key,
            });
          }
        }
      }
    }

    if (entries.length > 0) return entries;

    const fallbackBaseURL = String(config.api.base_url || '').trim();
    const fallbackModel = String(config.api.model || '').trim();
    const fallbackKeys = Array.isArray(config.api.api_key)
      ? config.api.api_key.map((k) => String(k || '').trim()).filter(Boolean)
      : String(config.api.api_key || '').trim()
        ? [String(config.api.api_key || '').trim()]
        : [];

    for (const key of fallbackKeys) {
      entries.push({
        entryId: `legacy::${fallbackModel}::${key}`,
        providerId: 'legacy',
        providerName: String(config.api.provider || 'OpenAI Compatible'),
        baseURL: fallbackBaseURL,
        model: fallbackModel,
        apiKey: key,
      });
    }

    return entries;
  }

  private getPoolForTarget(target: string): ModelPoolEntry[] {
    const t = String(target || 'all');
    if (t === 'all') return this.modelPool;
    return this.modelPool.filter((e) => `${e.providerId}::${e.model}` === t);
  }

  private getNextPoolEntry(pool: ModelPoolEntry[], target: string): ModelPoolEntry {
    const key = String(target || 'all');
    const cursor = this.poolCursorByTarget.get(key) || 0;
    const next = pool[cursor % pool.length];
    this.poolCursorByTarget.set(key, (cursor + 1) % pool.length);
    return next;
  }

  private fixActionFormat(action: any): Action {
    if (!action) {
      return { action: 'wait', duration: 1000 };
    }

    const normalizedAction = this.normalizeActionType(action.action);

    // 特殊处理：如果 action 是 shell 但 command 为空，回退到 wait
    if (normalizedAction === 'shell' && (!action.command || !String(action.command).trim())) {
      console.log('shell 动作缺少 command 字段，回退到 wait 动作');
      return { action: 'wait', duration: 1000 };
    }

    const fixed: Action = {
      action: normalizedAction,
    };

    if (Array.isArray(action.x) && action.x.length >= 2) {
      fixed.x = Number(action.x[0]);
      fixed.y = Number(action.x[1]);
      console.log(`修正坐标格式: [${action.x}] -> x=${fixed.x}, y=${fixed.y}`);
    } else {
      if (action.x !== undefined) fixed.x = Number(action.x);
      if (action.y !== undefined) fixed.y = Number(action.y);
    }

    if (Array.isArray(action.end_x) && action.end_x.length >= 2) {
      fixed.end_x = Number(action.end_x[0]);
      fixed.end_y = Number(action.end_x[1]);
    } else {
      if (action.end_x !== undefined) fixed.end_x = Number(action.end_x);
      if (action.end_y !== undefined) fixed.end_y = Number(action.end_y);
    }

    if (action.text !== undefined) fixed.text = String(action.text);
    if (action.keys !== undefined) fixed.keys = Array.isArray(action.keys) ? action.keys : [String(action.keys)];
    if (action.duration !== undefined) fixed.duration = Number(action.duration);
    if (action.hold_seconds !== undefined) fixed.hold_seconds = Number(action.hold_seconds);
    if (action.scroll_amount !== undefined) fixed.scroll_amount = Number(action.scroll_amount);

    // 处理 shell 动作专用字段
    if (action.command !== undefined) fixed.command = String(action.command);
    if (action.shell !== undefined) fixed.shell = String(action.shell);
    if (action.timeout !== undefined) fixed.timeout = Number(action.timeout);
    if (action.work_dir !== undefined) fixed.work_dir = String(action.work_dir);
    if (action.capture_output !== undefined) fixed.capture_output = Boolean(action.capture_output);

    return fixed;
  }

  private normalizeActionType(actionType: unknown): Action['action'] {
    const raw = String(actionType || '').toLowerCase();
    const map: Record<string, Action['action']> = {
      click: 'click',
      double_click: 'double_click',
      right_click: 'right_click',
      long_press: 'long_press',
      long_click: 'long_press',
      hold_click: 'long_press',
      click_and_hold: 'long_press',
      press_and_hold: 'long_press',
      type: 'type',
      enter: 'enter',
      press: 'press',
      scroll: 'scroll',
      drag: 'drag',
      move: 'move',
      wait: 'wait',
      task_complete: 'task_complete',
      shell: 'shell',
      command: 'shell',
      cmd: 'shell',
      run: 'shell',
      execute: 'shell',
      press_enter: 'enter',
      submit: 'enter',
      send: 'enter',
      confirm: 'enter',
      key_enter: 'enter',
    };

    return map[raw] || 'wait';
  }

  private parseResponseJson(content: string): any {
    const trimmed = content.trim();
    const candidates: string[] = [];

    const withoutFence = trimmed
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    candidates.push(withoutFence);

    const firstBrace = withoutFence.indexOf('{');
    const lastBrace = withoutFence.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      candidates.push(withoutFence.slice(firstBrace, lastBrace + 1));
    }

    const balancedJson = this.extractFirstBalancedJsonObject(withoutFence);
    if (balancedJson) {
      candidates.push(balancedJson);
    }

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch {
        // continue
      }
    }

    const recovered = this.recoverActionFromBrokenText(trimmed);
    if (recovered) {
      console.warn('AI JSON 损坏，已使用兜底解析动作。');
      return recovered;
    }

    throw new Error(`Invalid JSON response: ${trimmed.slice(0, 200)}`);
  }

  private validateActionOrThrow(action: Action): void {
    const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
    const missing = (name: string) => {
      throw new Error(`ACTION_FORMAT_ERROR: 缺少或无效字段 ${name}`);
    };
    const requireXY = () => {
      if (!isNum(action.x)) missing('x');
      if (!isNum(action.y)) missing('y');
    };

    switch (action.action) {
      case 'click':
      case 'double_click':
      case 'right_click':
      case 'move':
      case 'long_press':
        requireXY();
        break;
      case 'drag':
        requireXY();
        if (!isNum(action.end_x)) missing('end_x');
        if (!isNum(action.end_y)) missing('end_y');
        break;
      case 'type':
        if (typeof action.text !== 'string') missing('text');
        break;
      case 'press':
        if (!Array.isArray(action.keys) || action.keys.length === 0) missing('keys');
        break;
      case 'scroll':
        if (!isNum(action.scroll_amount)) missing('scroll_amount');
        break;
      case 'wait':
        if (!isNum(action.duration)) missing('duration');
        break;
      case 'enter':
      case 'task_complete':
        break;
      case 'shell':
        if (typeof action.command !== 'string' || !action.command.trim()) {
          missing('command');
        }
        break;
      default:
        throw new Error(`ACTION_FORMAT_ERROR: 未知 action ${String((action as Action).action)}`);
    }
  }

  private extractFirstBalancedJsonObject(text: string): string | null {
    const start = text.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }

    return null;
  }

  private recoverActionFromBrokenText(text: string): any | null {
    const actionMatch = text.match(/"action"\s*:\s*"([a-z_]+)"/i);
    const actionType = actionMatch?.[1]?.toLowerCase();
    if (!actionType) return null;

    const thoughtMatch = text.match(/"thought"\s*:\s*"([^"]*)"/i);
    const xMatch = text.match(/"x"\s*:\s*(-?\d+(?:\.\d+)?)/i);
    const yMatch = text.match(/"y"\s*:\s*(-?\d+(?:\.\d+)?)/i);
    const endXMatch = text.match(/"end_x"\s*:\s*(-?\d+(?:\.\d+)?)/i);
    const endYMatch = text.match(/"end_y"\s*:\s*(-?\d+(?:\.\d+)?)/i);
    const durationMatch = text.match(/"duration"\s*:\s*(\d+)/i);
    const holdSecondsMatch = text.match(/"hold_seconds"\s*:\s*(-?\d+(?:\.\d+)?)/i);
    const scrollMatch = text.match(/"scroll_amount"\s*:\s*(-?\d+)/i);
    const textMatch = text.match(/"text"\s*:\s*"([^"]*)"/i);

    const action: Record<string, unknown> = { action: actionType };
    if (xMatch) action.x = Number(xMatch[1]);
    if (yMatch) action.y = Number(yMatch[1]);
    if (endXMatch) action.end_x = Number(endXMatch[1]);
    if (endYMatch) action.end_y = Number(endYMatch[1]);
    if (durationMatch) action.duration = Number(durationMatch[1]);
    if (holdSecondsMatch) action.hold_seconds = Number(holdSecondsMatch[1]);
    if (scrollMatch) action.scroll_amount = Number(scrollMatch[1]);
    if (textMatch) action.text = textMatch[1];

    return {
      thought: thoughtMatch?.[1] || '',
      action
    };
  }

  private isApiKeyError(errorMessage: string): boolean {
    const apiKeyErrorPatterns = [
      '401',
      'unauthorized',
      'invalid api key',
      'api key invalid',
      'authentication',
      'auth',
      'quota',
      'rate limit',
      'insufficient_quota',
      'billing',
    ];

    const lowerError = errorMessage.toLowerCase();
    return apiKeyErrorPatterns.some(pattern => lowerError.includes(pattern));
  }

  private isJsonParseError(errorMessage: string): boolean {
    const msg = errorMessage.toLowerCase();
    return (
      msg.includes('json') ||
      msg.includes('unterminated string') ||
      msg.includes('unexpected token') ||
      msg.includes('invalid json')
    );
  }

  getApiKeyStatusReport(): string {
    const total = this.modelPool.length;
    let report = `模型池条目: ${total}\n`;
    this.modelPool.forEach((entry, index) => {
      const masked =
        entry.apiKey.length > 8 ? `${entry.apiKey.slice(0, 8)}****` : entry.apiKey;
      report += `  [${index + 1}] ${entry.providerName}/${entry.model} @ ${masked}\n`;
    });
    return report;
  }

  private isActionFormatError(errorMessage: string): boolean {
    return errorMessage.toLowerCase().includes('action_format_error');
  }

  private isAbortError(errorMessage: string): boolean {
    const m = String(errorMessage || '').toLowerCase();
    return (
      m.includes('aborted') ||
      m.includes('aborterror') ||
      m.includes('task_aborted') ||
      m.includes('request aborted')
    );
  }

  private async sleepWithAbort(ms: number, shouldAbort: () => boolean): Promise<void> {
    const step = 120;
    let elapsed = 0;
    while (elapsed < ms) {
      if (shouldAbort()) throw new Error('TASK_ABORTED');
      const waitMs = Math.min(step, ms - elapsed);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      elapsed += waitMs;
    }
  }

  cancelPendingRequests(): void {
    for (const controller of this.activeRequestControllers) {
      try {
        controller.abort();
      } catch {
        // ignore abort errors
      }
    }
    this.activeRequestControllers.clear();
  }
}
