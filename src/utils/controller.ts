import {
  mouse,
  keyboard,
  Button,
  Point,
  Key,
} from '@nut-tree-fork/nut-js';
import { Action, ScreenSize, ShellResult } from '../types/index.js';
import { ShellExecutor } from './shellExecutor.js';

export class Controller {
  private screenSize: ScreenSize;
  private shellExecutor: ShellExecutor;
  private lastShellResult: ShellResult | null = null;

  constructor(screenSize: ScreenSize) {
    this.screenSize = screenSize;
    mouse.config.mouseSpeed = 2000;
    this.shellExecutor = new ShellExecutor();
  }

  async executeAction(action: Action): Promise<void> {
    console.log(`Execute action: ${action.action}`, action);

    try {
      switch (action.action) {
        case 'click':
          await this.click(action.x, action.y);
          break;
        case 'double_click':
          await this.doubleClick(action.x, action.y);
          break;
        case 'right_click':
          await this.rightClick(action.x, action.y);
          break;
        case 'long_press':
          await this.longPress(action.x, action.y, action.hold_seconds);
          break;
        case 'type':
          await this.type(action.text || '');
          break;
        case 'enter':
          await this.press(['enter']);
          break;
        case 'press':
          await this.press(action.keys || []);
          break;
        case 'scroll':
          await this.scroll(action.scroll_amount || 0);
          break;
        case 'drag':
          await this.drag(action.x, action.y, action.end_x, action.end_y);
          break;
        case 'move':
          await this.move(action.x, action.y);
          break;
        case 'wait':
          await this.wait(action.duration || 1000);
          break;
        case 'task_complete':
          console.log('Task complete');
          break;
        case 'shell':
          this.lastShellResult = await this.executeShell(action);
          break;
        default:
          console.warn(`Unknown action: ${action.action}`);
      }
    } catch (error) {
      console.error(`Execute action failed: ${action.action}`, error);
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async click(x?: number, y?: number): Promise<void> {
    if (x === undefined || y === undefined) {
      throw new Error('ACTION_FORMAT_ERROR: click requires x and y');
    }

    await mouse.move([new Point(x, y)]);
    await this.delay(100);

    await mouse.pressButton(Button.LEFT);
    await this.delay(50);
    await mouse.releaseButton(Button.LEFT);

    console.log(`Click done: (${x}, ${y})`);
  }

  private async doubleClick(x?: number, y?: number): Promise<void> {
    if (x === undefined || y === undefined) {
      throw new Error('ACTION_FORMAT_ERROR: double_click requires x and y');
    }

    await mouse.move([new Point(x, y)]);
    await this.delay(100);

    await mouse.pressButton(Button.LEFT);
    await this.delay(30);
    await mouse.releaseButton(Button.LEFT);
    await this.delay(50);
    await mouse.pressButton(Button.LEFT);
    await this.delay(30);
    await mouse.releaseButton(Button.LEFT);

    console.log(`Double click done: (${x}, ${y})`);
  }

  private async rightClick(x?: number, y?: number): Promise<void> {
    if (x === undefined || y === undefined) {
      throw new Error('ACTION_FORMAT_ERROR: right_click requires x and y');
    }

    await mouse.move([new Point(x, y)]);
    await this.delay(100);

    await mouse.pressButton(Button.RIGHT);
    await this.delay(50);
    await mouse.releaseButton(Button.RIGHT);

    console.log(`Right click done: (${x}, ${y})`);
  }

  private async longPress(x?: number, y?: number, holdSeconds = 1): Promise<void> {
    if (x === undefined || y === undefined) {
      throw new Error('ACTION_FORMAT_ERROR: long_press requires x and y');
    }

    await mouse.move([new Point(x, y)]);
    await this.delay(100);

    const holdMs = Math.max(100, Math.round((Number(holdSeconds) || 1) * 1000));
    await mouse.pressButton(Button.LEFT);
    await this.delay(holdMs);
    await mouse.releaseButton(Button.LEFT);

    console.log(`Long press done: (${x}, ${y}), hold=${holdMs}ms`);
  }

  private async type(text: string): Promise<void> {
    await this.delay(100);

    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const segments = normalized.split('\n');

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (segment.length > 0) {
        await keyboard.type(segment);
      }
      if (i < segments.length - 1) {
        await this.press(['enter']);
      }
    }

    console.log(`Type text: ${text}`);
  }

  private async press(keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    const keyEnums = keys.map(key => this.mapKey(key)).filter(Boolean) as Key[];
    if (keyEnums.length === 0) {
      console.warn('No valid keys');
      return;
    }

    await this.delay(100);

    if (keyEnums.length === 1) {
      await keyboard.pressKey(keyEnums[0]);
      await this.delay(50);
      await keyboard.releaseKey(keyEnums[0]);
    } else {
      for (const key of keyEnums) {
        await keyboard.pressKey(key);
        await this.delay(20);
      }

      await this.delay(50);

      for (let i = keyEnums.length - 1; i >= 0; i--) {
        await keyboard.releaseKey(keyEnums[i]);
        await this.delay(20);
      }
    }

    console.log(`Press keys: ${keys.join('+')}`);
  }

  private async scroll(amount: number): Promise<void> {
    const scrollSteps = Math.min(Math.abs(amount), 10);
    const direction = amount > 0 ? -1 : 1;

    for (let i = 0; i < scrollSteps; i++) {
      await mouse.scrollDown(direction);
      await this.delay(50);
    }

    console.log(`Scroll: ${amount}`);
  }

  private async drag(
    startX?: number,
    startY?: number,
    endX?: number,
    endY?: number
  ): Promise<void> {
    if (startX === undefined || startY === undefined || endX === undefined || endY === undefined) {
      console.warn('Drag action requires start and end coordinates');
      return;
    }

    await mouse.move([new Point(startX, startY)]);
    await this.delay(100);

    await mouse.pressButton(Button.LEFT);
    await this.delay(50);

    await mouse.move([new Point(endX, endY)]);
    await this.delay(100);

    await mouse.releaseButton(Button.LEFT);

    console.log(`Drag done: (${startX}, ${startY}) -> (${endX}, ${endY})`);
  }

  private async move(x?: number, y?: number): Promise<void> {
    if (x === undefined || y === undefined) {
      console.warn('Move action requires coordinates');
      return;
    }

    await mouse.move([new Point(x, y)]);
    console.log(`Move mouse to: (${x}, ${y})`);
  }

  private async wait(duration: number): Promise<void> {
    console.log(`Wait ${duration}ms`);
    await this.delay(duration);
  }

  private async executeShell(action: Action): Promise<ShellResult | null> {
    if (!action.command) {
      throw new Error('ACTION_FORMAT_ERROR: shell action requires a command');
    }

    try {
      const result = await this.shellExecutor.execute({
        command: action.command,
        shell: action.shell,
        workDir: action.work_dir,
        timeout: action.timeout,
        captureOutput: action.capture_output !== false,
      });

      console.log(`Shell command executed: ${action.command}`);
      console.log(`Exit code: ${result.exit_code}, Duration: ${result.duration}ms`);

      return result;
    } catch (error: any) {
      console.error(`Shell command failed: ${action.command}`, error);
      throw error;
    }
  }

  /**
   * 获取上一次 shell 执行结果（用于传递给 AI）
   */
  getLastShellResult(): ShellResult | null {
    return this.lastShellResult;
  }

  /**
   * 获取格式化后的上一次 shell 执行结果
   */
  async getLastShellResultFormatted(): Promise<string | null> {
    if (!this.lastShellResult) {
      return null;
    }

    const result = this.lastShellResult;
    const parts: string[] = [];

    parts.push(`命令：${result.command}`);
    parts.push(`退出码：${result.exit_code}`);
    parts.push(`执行时间：${result.duration}ms`);

    if (result.stdout) {
      parts.push(`\n标准输出:\n${result.stdout}`);
    }

    if (result.stderr) {
      parts.push(`\n标准错误:\n${result.stderr}`);
    }

    return parts.join('\n');
  }

  private mapKey(key: string): Key | null {
    const keyMap: Record<string, Key> = {
      ctrl: Key.LeftControl,
      control: Key.LeftControl,
      alt: Key.LeftAlt,
      shift: Key.LeftShift,
      win: Key.LeftWin,
      meta: Key.LeftWin,
      cmd: Key.LeftWin,
      command: Key.LeftWin,
      enter: Key.Enter,
      return: Key.Enter,
      newline: Key.Enter,
      linebreak: Key.Enter,
      submit: Key.Enter,
      send: Key.Enter,
      space: Key.Space,
      tab: Key.Tab,
      escape: Key.Escape,
      esc: Key.Escape,
      backspace: Key.Backspace,
      delete: Key.Delete,
      del: Key.Delete,
      up: Key.Up,
      down: Key.Down,
      left: Key.Left,
      right: Key.Right,
      home: Key.Home,
      end: Key.End,
      pageup: Key.PageUp,
      pagedown: Key.PageDown,
      f1: Key.F1,
      f2: Key.F2,
      f3: Key.F3,
      f4: Key.F4,
      f5: Key.F5,
      f6: Key.F6,
      f7: Key.F7,
      f8: Key.F8,
      f9: Key.F9,
      f10: Key.F10,
      f11: Key.F11,
      f12: Key.F12,
    };

    if (key.length === 1) {
      const upperKey = key.toUpperCase();
      if (Key[upperKey as keyof typeof Key]) {
        return Key[upperKey as keyof typeof Key];
      }
    }

    return keyMap[key.toLowerCase()] || null;
  }
}
