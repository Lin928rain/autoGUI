import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import { ShellResult } from '../types/index.js';

const execAsync = promisify(exec);

/**
 * 命令黑名单 - 阻止危险命令执行
 */
const BLOCKED_COMMANDS = [
  // 危险删除命令
  'rm -rf /',
  'rm -rf /*',
  'rm -rf ~/*',
  'deltree',
  'format',
  'format c:',
  'format d:',
  'format e:',
  // 磁盘操作
  'fdisk',
  'diskpart',
  'chkdsk /f',
  'chkdsk /r',
  // 系统破坏
  'mklink',
  'attrib +s +h',
  'takeown',
  'icacls',
  // 网络攻击
  'curl.*|.*sh',
  'curl.*\\|.*bash',
  'wget.*\\|.*sh',
  'wget.*|.*bash',
  // PowerShell 危险命令
  'invoke-webrequest.*\\|.*iex',
  'invoke-restmethod.*\\|.*iex',
  'downloadstring',
  // 其他
  ':(){ :|:& };:',  // fork bomb
  'shutdown /s /t 0',
  'shutdown -s -t 0',
  'init 0',
  'init 6',
  'reboot',
  'poweroff',
];

/**
 * 命令白名单前缀 - 允许的安全命令
 */
const SAFE_COMMAND_PREFIXES = [
  'dir',
  'ls',
  'cat',
  'type',
  'head',
  'tail',
  'cd',
  'pwd',
  'echo',
  'printf',
  'find',
  'grep',
  'which',
  'where',
  'whoami',
  'hostname',
  'uname',
  'ver',
  'systeminfo',
  'tasklist',
  'ps',
  'top',
  'df',
  'du',
  'free',
  'netstat',
  'ipconfig',
  'ifconfig',
  'ping',
  'tracert',
  'traceroute',
  'nslookup',
  'dig',
  'git',
  'npm',
  'npx',
  'node',
  'python',
  'python3',
  'pip',
  'pip3',
  'cargo',
  'rustc',
  'javac',
  'java',
  'mvn',
  'gradle',
  'gcc',
  'g++',
  'clang',
  'make',
  'cmake',
  'code',
  'vim',
  'nano',
  'notepad',
  'touch',
  'mkdir',
  'rmdir',
  'cp',
  'copy',
  'mv',
  'move',
  'ren',
  'chmod',
  'chown',
  'ln',
  'tree',
  'fold',
  'sort',
  'uniq',
  'wc',
  'diff',
  'patch',
  'sed',
  'awk',
  'jq',
  'node -e',
  'python -c',
  'python3 -c',
];

export interface ShellExecutorConfig {
  blockedCommands?: string[];
  allowedCommands?: string[];
  allowedDirectories?: string[];
  maxOutputLength?: number;
  defaultTimeout?: number;
}

export class ShellExecutor {
  private blockedCommands: Set<string>;
  private allowedCommands?: Set<string>;
  private allowedDirectories: string[];
  private maxOutputLength: number;
  private defaultTimeout: number;

  constructor(config: ShellExecutorConfig = {}) {
    this.blockedCommands = new Set([
      ...BLOCKED_COMMANDS,
      ...(config.blockedCommands || []),
    ]);

    if (config.allowedCommands) {
      this.allowedCommands = new Set(config.allowedCommands);
    }

    this.allowedDirectories = config.allowedDirectories || [process.cwd()];
    this.maxOutputLength = config.maxOutputLength || 50000;
    this.defaultTimeout = config.defaultTimeout || 30000;
  }

  /**
   * 检查命令是否被阻止
   */
  private isBlocked(command: string): boolean {
    const normalizedCmd = command.toLowerCase().trim();

    // 检查黑名单
    for (const blocked of this.blockedCommands) {
      if (blocked.startsWith('^')) {
        // 正则表达式
        const regex = new RegExp(blocked, 'i');
        if (regex.test(normalizedCmd)) {
          return true;
        }
      } else {
        // 精确匹配或子串匹配
        if (normalizedCmd === blocked || normalizedCmd.startsWith(blocked + ' ')) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 验证工作目录是否在允许列表中
   */
  private validateWorkDir(workDir?: string): string {
    if (!workDir) {
      return process.cwd();
    }

    const resolvedPath = path.resolve(workDir);

    // 检查是否在允许的目录内
    const isAllowed = this.allowedDirectories.some(dir => {
      const resolvedDir = path.resolve(dir);
      return resolvedPath.startsWith(resolvedDir);
    });

    if (!isAllowed && this.allowedDirectories.length > 0) {
      throw new Error(`工作目录不允许：${workDir}，允许的目录：${this.allowedDirectories.join(', ')}`);
    }

    return resolvedPath;
  }

  /**
   * 执行 shell 命令
   */
  async execute(options: {
    command: string;
    shell?: string;
    workDir?: string;
    timeout?: number;
    captureOutput?: boolean;
  }): Promise<ShellResult> {
    const {
      command,
      shell,
      workDir,
      timeout = this.defaultTimeout,
      captureOutput = true,
    } = options;

    // 安全检查
    if (this.isBlocked(command)) {
      throw new Error(`命令被阻止：${command}`);
    }

    const validWorkDir = this.validateWorkDir(workDir);
    const selectedShell = shell || this.getDefaultShell();
    const startTime = Date.now();

    try {
      const result = await execAsync(command, {
        shell: selectedShell,
        cwd: validWorkDir,
        timeout,
        maxBuffer: this.maxOutputLength,
        encoding: 'utf8',
      });

      const duration = Date.now() - startTime;

      let stdout = result.stdout || '';
      let stderr = result.stderr || '';

      // 截断过长输出
      if (stdout.length > this.maxOutputLength) {
        stdout = stdout.slice(0, this.maxOutputLength) + '\n... [输出已截断]';
      }
      if (stderr.length > this.maxOutputLength) {
        stderr = stderr.slice(0, this.maxOutputLength) + '\n... [输出已截断]';
      }

      return {
        stdout: captureOutput ? stdout : '',
        stderr: captureOutput ? stderr : '',
        exit_code: 0,
        duration,
        command,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;

      if (error.killed && error.signal === 'SIGTERM') {
        throw new Error(`命令执行超时（>${timeout}ms），已终止`);
      }

      let stderr = error.stderr || error.message || '';
      if (stderr.length > this.maxOutputLength) {
        stderr = stderr.slice(0, this.maxOutputLength) + '\n... [输出已截断]';
      }

      return {
        stdout: captureOutput ? (error.stdout || '') : '',
        stderr: captureOutput ? stderr : '',
        exit_code: error.code || 1,
        duration,
        command,
      };
    }
  }

  /**
   * 获取默认 shell
   */
  private getDefaultShell(): string {
    const platform = os.platform();

    if (platform === 'win32') {
      return 'powershell.exe';
    }

    return process.env.SHELL || '/bin/sh';
  }

  /**
   * 执行命令并返回格式化输出（用于 AI 阅读）
   */
  async executeAndFormat(options: {
    command: string;
    shell?: string;
    workDir?: string;
    timeout?: number;
  }): Promise<string> {
    const result = await this.execute(options);

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

  /**
   * 添加阻止的命令
   */
  addBlockedCommands(commands: string[]): void {
    commands.forEach(cmd => this.blockedCommands.add(cmd));
  }

  /**
   * 添加允许的目录
   */
  addAllowedDirectory(dir: string): void {
    const resolved = path.resolve(dir);
    if (!this.allowedDirectories.includes(resolved)) {
      this.allowedDirectories.push(resolved);
    }
  }

  /**
   * 获取配置信息
   */
  getConfig(): ShellExecutorConfig {
    return {
      blockedCommands: Array.from(this.blockedCommands),
      allowedDirectories: this.allowedDirectories,
      maxOutputLength: this.maxOutputLength,
      defaultTimeout: this.defaultTimeout,
    };
  }
}
