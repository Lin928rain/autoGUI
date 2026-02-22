import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import { Config, Action, AIResponse } from './types/index.js';
import { ScreenshotManager } from './utils/screenshot.js';
import { AIClient } from './utils/ai.js';
import { Controller } from './utils/controller.js';
import { WindowsController } from './utils/windowsController.js';

interface IController {
  executeAction(action: Action): Promise<void>;
  getLastShellResultFormatted?(): Promise<string | null>;
}

export interface AgentRunHooks {
  beforeCapture?: () => Promise<void> | void;
  afterCapture?: () => Promise<void> | void;
}

export interface AgentRunOptions {
  modelTarget?: string;
}

export interface AgentRunResult {
  status: 'completed' | 'stopped' | 'max_iterations' | 'error';
  error?: string;
  iterations: number;
}

export class Agent {
  private config: Config;
  private screenshotManager: ScreenshotManager;
  private aiClient: AIClient;
  private controller: IController | null = null;
  private previousActions: Action[] = [];
  private lastShellResult: string | null = null;
  private currentWorkDir: string | null = null;  // 会话工作目录
  private isRunning = false;
  private repeatedActionWarning = '';
  private lastActionSignature = '';
  private consecutiveSameActionCount = 0;

  constructor(config: Config) {
    this.config = config;
    this.screenshotManager = new ScreenshotManager(config.settings.coordinate_scale);
    this.aiClient = new AIClient(config);
  }

  async run(
    task: string,
    hooks: AgentRunHooks = {},
    options: AgentRunOptions = {}
  ): Promise<AgentRunResult> {
    console.log(`开始执行任务: ${task}`);
    console.log('='.repeat(50));

    this.isRunning = true;
    this.previousActions = [];
    this.lastShellResult = null;
    this.repeatedActionWarning = '';
    this.lastActionSignature = '';
    this.consecutiveSameActionCount = 0;
    let iterations = 0;

    try {
      const screenSize = await this.screenshotManager.getScreenSize();
      console.log(`屏幕尺寸: ${screenSize.width}x${screenSize.height}`);

      this.controller = this.createController(screenSize);

      for (let iteration = 0; iteration < this.config.settings.max_iterations; iteration++) {
        if (!this.isRunning) {
          console.log('任务被中断');
          return { status: 'stopped', iterations };
        }

        iterations = iteration + 1;
        console.log(`\n--- 迭代 ${iteration + 1}/${this.config.settings.max_iterations} ---`);

        console.log('正在捕获屏幕截图...');
        await hooks.beforeCapture?.();

        let screenshot: Buffer;
        try {
          screenshot = await this.screenshotManager.capture();
        } finally {
          await hooks.afterCapture?.();
        }

        const base64Image = this.screenshotManager.bufferToBase64(screenshot);
        await this.saveDebugScreenshot(screenshot, iteration);

        console.log('正在分析截图...');
        let aiResponse: AIResponse;
        try {
          // 构建任务提示，包含上一次 shell 执行结果（如果有）
          let taskForModel = task;

          // 添加 shell 结果反馈
          if (this.lastShellResult) {
            taskForModel += `\n\n[上一步执行结果]\n${this.lastShellResult}\n\n请基于上述结果和当前屏幕截图，决定下一步操作。`;
          }

          // 添加重复动作警告
          if (this.repeatedActionWarning) {
            taskForModel += `\n\n${this.repeatedActionWarning}`;
          }

          aiResponse = await this.aiClient.analyzeScreenshot(
            base64Image,
            taskForModel,
            this.previousActions,
            options.modelTarget || 'all',
            () => !this.isRunning
          );
        } catch (error) {
          console.error('AI 分析失败:', error);
          const message = error instanceof Error ? error.message : String(error);
          if (!this.isRunning || message.includes('TASK_ABORTED')) {
            console.log('任务被中断（已取消当前 AI 请求）');
            return { status: 'stopped', iterations };
          }
          if (message.includes('API_KEY_POOL_EXHAUSTED')) {
            return {
              status: 'error',
              error: 'API 次数已用完（所有 Key 均触发限额/鉴权错误），请稍后重试或更换模型/Key',
              iterations,
            };
          }
          console.log('等待后重试...');
          if (!this.isRunning) {
            console.log('任务被中断');
            return { status: 'stopped', iterations };
          }
          await this.sleep(3000);
          if (!this.isRunning) {
            console.log('任务被中断');
            return { status: 'stopped', iterations };
          }
          continue;
        }

        if (!this.isRunning) {
          console.log('任务被中断（丢弃本轮 AI 返回动作）');
          return { status: 'stopped', iterations };
        }

        console.log('\n--- AI 返回内容 ---');
        console.log('思考:', aiResponse.thought);
        console.log('原始动作:', JSON.stringify(aiResponse.action, null, 2));
        console.log('------------------\n');

        if (aiResponse.action.action === 'task_complete') {
          console.log('\n' + '='.repeat(50));
          console.log('任务已完成！');
          console.log('='.repeat(50));
          return { status: 'completed', iterations };
        }

        this.updateRepeatedActionWarning(aiResponse.action);

        const mappedAction = this.mapActionCoordinates(aiResponse.action, screenSize);
        if (!this.isRunning) {
          console.log('任务被中断（跳过动作执行）');
          return { status: 'stopped', iterations };
        }

        try {
          // 为 shell 动作注入当前工作目录
          if (mappedAction.action === 'shell' && this.currentWorkDir && !mappedAction.work_dir) {
            mappedAction.work_dir = this.currentWorkDir;
          }

          await this.controller.executeAction(mappedAction);
          this.previousActions.push(aiResponse.action);

          // 如果是 shell 动作，获取执行结果供下次迭代使用
          if (aiResponse.action.action === 'shell' && this.controller.getLastShellResultFormatted) {
            this.lastShellResult = await this.controller.getLastShellResultFormatted();

            // 检测是否是 cd 命令，如果是，更新会话工作目录
            if (aiResponse.action.command) {
              const cdMatch = aiResponse.action.command.match(/^(?:cd|chdir)\s+([^\s&;|]+)/i);
              if (cdMatch && cdMatch[1]) {
                const newDir = cdMatch[1].replace(/['"]/g, '');
                if (!path.isAbsolute(newDir) && this.currentWorkDir) {
                  this.currentWorkDir = path.resolve(this.currentWorkDir, newDir);
                } else if (path.isAbsolute(newDir)) {
                  this.currentWorkDir = newDir;
                }
                console.log(`[shell] 工作目录更新：${this.currentWorkDir}`);
              }
            }
          }
        } catch (error) {
          console.error('执行操作失败:', error);
        }

        console.log(`等待 ${this.config.settings.screenshot_interval}ms...`);
        await this.sleep(this.config.settings.screenshot_interval);
      }

      console.log('\n达到最大迭代次数，任务可能未完成');
      return { status: 'max_iterations', iterations };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('任务执行出错:', error);
      return { status: 'error', error: message, iterations };
    } finally {
      this.isRunning = false;
    }
  }

  private createController(screenSize: { width: number; height: number }): IController {
    const platform = os.platform();
    console.log(`操作系统: ${platform}`);

    if (platform === 'win32') {
      console.log('使用 Windows 原生控制器');
      return new WindowsController(screenSize);
    }

    console.log('使用 nut-js 控制器');
    return new Controller(screenSize);
  }

  stop(): void {
    this.isRunning = false;
    this.aiClient.cancelPendingRequests();
  }

  private mapActionCoordinates(action: Action, screenSize: { width: number; height: number }): Action {
    const mappedAction = { ...action };

    if (action.x !== undefined && action.y !== undefined) {
      const mapped = this.screenshotManager.mapCoordinates(action.x, action.y, screenSize);
      mappedAction.x = mapped.x;
      mappedAction.y = mapped.y;
    }

    if (action.end_x !== undefined && action.end_y !== undefined) {
      const mapped = this.screenshotManager.mapCoordinates(action.end_x, action.end_y, screenSize);
      mappedAction.end_x = mapped.x;
      mappedAction.end_y = mapped.y;
    }

    return mappedAction;
  }

  private async saveDebugScreenshot(screenshot: Buffer, iteration: number): Promise<void> {
    try {
      const debugDir = path.join(process.cwd(), 'debug_screenshots');
      await fs.mkdir(debugDir, { recursive: true });
      const filename = path.join(debugDir, `screenshot_${Date.now()}_${iteration}.png`);
      await fs.writeFile(filename, screenshot);
    } catch {
      // ignore debug screenshot save errors
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private updateRepeatedActionWarning(action: Action): void {
    const signature = this.buildActionSignature(action);
    if (!signature) {
      this.lastActionSignature = '';
      this.consecutiveSameActionCount = 0;
      this.repeatedActionWarning = '';
      return;
    }

    if (signature === this.lastActionSignature) {
      this.consecutiveSameActionCount += 1;
    } else {
      this.lastActionSignature = signature;
      this.consecutiveSameActionCount = 1;
    }

    if (this.consecutiveSameActionCount >= 3) {
      const brief = signature.length > 120 ? `${signature.slice(0, 120)}...` : signature;
      this.repeatedActionWarning =
        `【系统提醒】你可能陷入了重复操作死循环：已连续 ${this.consecutiveSameActionCount} 次输出近似相同动作（${brief}）。` +
        '下一步必须先基于当前截图验证上一步是否成功；如果未成功，请更换策略（换目标控件/先聚焦窗口/使用快捷键或其他路径），禁止继续原地重复同一动作。';
      console.warn(
        `[loop-detect] 检测到连续重复动作 ${this.consecutiveSameActionCount} 次: ${brief}`
      );
      return;
    }

    this.repeatedActionWarning = '';
  }

  private buildActionSignature(action: Action): string {
    const type = action.action;
    switch (type) {
      case 'click':
      case 'double_click':
      case 'right_click':
      case 'move':
        return `${type}:${action.x ?? 'na'},${action.y ?? 'na'}`;
      case 'long_press':
        return `${type}:${action.x ?? 'na'},${action.y ?? 'na'}:${Number(action.hold_seconds ?? 1).toFixed(2)}`;
      case 'drag':
        return `${type}:${action.x ?? 'na'},${action.y ?? 'na'}->${action.end_x ?? 'na'},${action.end_y ?? 'na'}`;
      case 'type':
        return `${type}:${String(action.text ?? '')}`;
      case 'press':
        return `${type}:${Array.isArray(action.keys) ? action.keys.join('+') : ''}`;
      case 'scroll':
        return `${type}:${Number(action.scroll_amount ?? 0)}`;
      case 'wait':
        return `${type}:${Number(action.duration ?? 1000)}`;
      case 'shell':
        // shell 动作需要包含具体的命令内容
        return `${type}:${String(action.command ?? '')}`;
      case 'enter':
      case 'task_complete':
        return type;
      default:
        return `${String(type)}`;
    }
  }
}

