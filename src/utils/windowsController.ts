import { exec } from 'child_process';
import { promisify } from 'util';
import { Action, ScreenSize, ShellResult } from '../types/index.js';
import { ShellExecutor } from './shellExecutor.js';

const execAsync = promisify(exec);

/**
 * Native Windows controller implemented with PowerShell.
 */
export class WindowsController {
  private screenSize: ScreenSize;
  private shellExecutor: ShellExecutor;
  private lastShellResult: ShellResult | null = null;

  constructor(screenSize: ScreenSize) {
    this.screenSize = screenSize;
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

  private async runPowerShell(script: string): Promise<void> {
    // Avoid coordinate offset under Windows display scaling.
    const dpiBootstrap = `
      Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public static class DpiBootstrap {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
}
"@ -ErrorAction SilentlyContinue
      [DpiBootstrap]::SetProcessDPIAware() | Out-Null
    `;

    const mergedScript = `${dpiBootstrap}\n${script}`;
    const encodedScript = Buffer.from(mergedScript, 'utf16le').toString('base64');
    const command = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`;
    await execAsync(command);
  }

  private async moveMouse(x: number, y: number): Promise<void> {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(x)}, ${Math.round(y)})
    `;
    await this.runPowerShell(script);
    await this.delay(50);
  }

  private async click(x?: number, y?: number): Promise<void> {
    if (x === undefined || y === undefined) {
      throw new Error('ACTION_FORMAT_ERROR: click requires x and y');
    }

    await this.moveMouse(x, y);
    await this.delay(100);

    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int cButtons, int info);' -Name U32 -Namespace W
      [W.U32]::mouse_event(0x02, 0, 0, 0, 0)
      Start-Sleep -Milliseconds 50
      [W.U32]::mouse_event(0x04, 0, 0, 0, 0)
    `;
    await this.runPowerShell(script);
    console.log(`Click done: (${x}, ${y})`);
  }

  private async doubleClick(x?: number, y?: number): Promise<void> {
    if (x === undefined || y === undefined) {
      throw new Error('ACTION_FORMAT_ERROR: double_click requires x and y');
    }

    await this.moveMouse(x, y);
    await this.delay(100);

    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int cButtons, int info);' -Name U32 -Namespace W

      [W.U32]::mouse_event(0x02, 0, 0, 0, 0)
      Start-Sleep -Milliseconds 30
      [W.U32]::mouse_event(0x04, 0, 0, 0, 0)
      Start-Sleep -Milliseconds 50
      [W.U32]::mouse_event(0x02, 0, 0, 0, 0)
      Start-Sleep -Milliseconds 30
      [W.U32]::mouse_event(0x04, 0, 0, 0, 0)
    `;
    await this.runPowerShell(script);
    console.log(`Double click done: (${x}, ${y})`);
  }

  private async rightClick(x?: number, y?: number): Promise<void> {
    if (x === undefined || y === undefined) {
      throw new Error('ACTION_FORMAT_ERROR: right_click requires x and y');
    }

    await this.moveMouse(x, y);
    await this.delay(100);

    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int cButtons, int info);' -Name U32 -Namespace W
      [W.U32]::mouse_event(0x08, 0, 0, 0, 0)
      Start-Sleep -Milliseconds 50
      [W.U32]::mouse_event(0x10, 0, 0, 0, 0)
    `;
    await this.runPowerShell(script);
    console.log(`Right click done: (${x}, ${y})`);
  }

  private async longPress(x?: number, y?: number, holdSeconds = 1): Promise<void> {
    if (x === undefined || y === undefined) {
      throw new Error('ACTION_FORMAT_ERROR: long_press requires x and y');
    }

    await this.moveMouse(x, y);
    await this.delay(100);

    const holdMs = Math.max(100, Math.round((Number(holdSeconds) || 1) * 1000));
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int cButtons, int info);' -Name U32 -Namespace W
      [W.U32]::mouse_event(0x02, 0, 0, 0, 0)
      Start-Sleep -Milliseconds ${holdMs}
      [W.U32]::mouse_event(0x04, 0, 0, 0, 0)
    `;
    await this.runPowerShell(script);
    console.log(`Long press done: (${x}, ${y}), hold=${holdMs}ms`);
  }

  private async type(text: string): Promise<void> {
    await this.delay(100);
    const escapedText = this.toSendKeysText(text);

    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait('${escapedText}')
    `;
    await this.runPowerShell(script);
    console.log(`Type text: ${text}`);
  }

  private toSendKeysText(text: string): string {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const escaped = normalized
      .replace(/\{/g, '{{')
      .replace(/\}/g, '}}')
      .replace(/\+/g, '{+}')
      .replace(/\^/g, '{^}')
      .replace(/%/g, '{%}')
      .replace(/~/g, '{~}')
      .replace(/\(/g, '{(}')
      .replace(/\)/g, '{)}');

    return escaped.replace(/\n/g, '{ENTER}');
  }

  private async press(keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    const keyMap: Record<string, string> = {
      ctrl: '^',
      control: '^',
      alt: '%',
      shift: '+',
      win: '#',
      enter: '{ENTER}',
      return: '{ENTER}',
      newline: '{ENTER}',
      linebreak: '{ENTER}',
      submit: '{ENTER}',
      send: '{ENTER}',
      space: ' ',
      tab: '{TAB}',
      escape: '{ESC}',
      esc: '{ESC}',
      backspace: '{BACKSPACE}',
      delete: '{DELETE}',
      del: '{DELETE}',
      up: '{UP}',
      down: '{DOWN}',
      left: '{LEFT}',
      right: '{RIGHT}',
      home: '{HOME}',
      end: '{END}',
      pageup: '{PGUP}',
      pagedown: '{PGDN}',
      f1: '{F1}',
      f2: '{F2}',
      f3: '{F3}',
      f4: '{F4}',
      f5: '{F5}',
      f6: '{F6}',
      f7: '{F7}',
      f8: '{F8}',
      f9: '{F9}',
      f10: '{F10}',
      f11: '{F11}',
      f12: '{F12}',
    };

    await this.delay(100);

    if (this.hasWindowsKey(keys)) {
      await this.pressWithVirtualKeys(keys);
      console.log(`Press keys (virtual): ${keys.join('+')}`);
      return;
    }

    let sendKeysStr = '';
    for (const key of keys) {
      const lowerKey = key.toLowerCase();
      if (keyMap[lowerKey]) {
        sendKeysStr += keyMap[lowerKey];
      } else if (key.length === 1) {
        sendKeysStr += key;
      }
    }

    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait('${sendKeysStr}')
    `;
    await this.runPowerShell(script);
    console.log(`Press keys: ${keys.join('+')}`);
  }

  private hasWindowsKey(keys: string[]): boolean {
    return keys.some((k) => ['win', 'meta', 'cmd', 'command'].includes(String(k).toLowerCase()));
  }

  private mapVirtualKeyCode(key: string): number | null {
    const lower = String(key || '').toLowerCase();
    const map: Record<string, number> = {
      ctrl: 0x11,
      control: 0x11,
      alt: 0x12,
      shift: 0x10,
      win: 0x5b,
      meta: 0x5b,
      cmd: 0x5b,
      command: 0x5b,
      enter: 0x0d,
      return: 0x0d,
      newline: 0x0d,
      linebreak: 0x0d,
      submit: 0x0d,
      send: 0x0d,
      space: 0x20,
      tab: 0x09,
      escape: 0x1b,
      esc: 0x1b,
      backspace: 0x08,
      delete: 0x2e,
      del: 0x2e,
      up: 0x26,
      down: 0x28,
      left: 0x25,
      right: 0x27,
      home: 0x24,
      end: 0x23,
      pageup: 0x21,
      pagedown: 0x22,
    };

    if (map[lower]) return map[lower];

    if (lower.length === 1) {
      const ch = lower.charCodeAt(0);
      if (ch >= 97 && ch <= 122) return ch - 32; // a-z -> A-Z virtual key
      if (ch >= 48 && ch <= 57) return ch; // 0-9
    }

    const fMatch = lower.match(/^f([1-9]|1[0-2])$/);
    if (fMatch) {
      return 0x6f + Number(fMatch[1]); // F1=0x70
    }

    return null;
  }

  private async pressWithVirtualKeys(keys: string[]): Promise<void> {
    const vkCodes = keys
      .map((k) => this.mapVirtualKeyCode(k))
      .filter((v): v is number => typeof v === 'number');

    if (vkCodes.length === 0) {
      console.warn('No valid virtual keys');
      return;
    }

    const down = vkCodes
      .map((vk) => `[W.U32]::keybd_event(${vk}, 0, 0, 0); Start-Sleep -Milliseconds 20`)
      .join('\n');
    const up = [...vkCodes]
      .reverse()
      .map((vk) => `[W.U32]::keybd_event(${vk}, 0, 0x0002, 0); Start-Sleep -Milliseconds 20`)
      .join('\n');

    const script = `
      Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo);' -Name U32 -Namespace W
      ${down}
      Start-Sleep -Milliseconds 30
      ${up}
    `;

    await this.runPowerShell(script);
  }

  private async scroll(amount: number): Promise<void> {
    const direction = amount > 0 ? 1 : -1;
    const scrollAmount = Math.min(Math.abs(amount), 10) * 120;

    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int cButtons, int info);' -Name U32 -Namespace W
      [W.U32]::mouse_event(0x0800, 0, 0, ${direction * scrollAmount}, 0)
    `;
    await this.runPowerShell(script);
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

    await this.moveMouse(startX, startY);
    await this.delay(100);

    const downScript = `
      Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int cButtons, int info);' -Name U32 -Namespace W
      [W.U32]::mouse_event(0x02, 0, 0, 0, 0)
    `;
    await this.runPowerShell(downScript);
    await this.delay(50);

    await this.moveMouse(endX, endY);
    await this.delay(100);

    const upScript = `
      Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int cButtons, int info);' -Name U32 -Namespace W
      [W.U32]::mouse_event(0x04, 0, 0, 0, 0)
    `;
    await this.runPowerShell(upScript);

    console.log(`Drag done: (${startX}, ${startY}) -> (${endX}, ${endY})`);
  }

  private async move(x?: number, y?: number): Promise<void> {
    if (x === undefined || y === undefined) {
      console.warn('Move action requires coordinates');
      return;
    }
    await this.moveMouse(x, y);
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
        shell: action.shell || 'powershell.exe',
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
}
