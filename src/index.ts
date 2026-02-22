#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { Config } from './types/index.js';
import { Agent } from './agent.js';

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

/**
 * 加载配置文件
 */
async function loadConfig(): Promise<Config> {
  try {
    const configData = await fs.readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(configData) as Config;
  } catch (error) {
    console.error('无法加载配置文件:', error);
    console.log('\n请创建 config.json 文件，格式如下:');
    console.log(JSON.stringify({
      api: {
        base_url: 'https://api.openai.com/v1',
        api_key: 'your-api-key-here',
        model: 'gpt-4o'
      },
      settings: {
        screenshot_interval: 2000,
        max_iterations: 50,
        coordinate_scale: 1000
      }
    }, null, 2));
    process.exit(1);
  }
}

/**
 * 获取用户输入
 */
function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('  AutoGUI TypeScript - 基于视觉的电脑操作 Agent');
  console.log('='.repeat(60));
  console.log();

  // 加载配置
  const config = await loadConfig();
  console.log(`API 配置: ${config.api.base_url}`);
  console.log(`使用模型: ${config.api.model}`);
  console.log();

  // 创建 Agent
  const agent = new Agent(config);

  // 创建 readline 接口
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // 处理退出信号
  process.on('SIGINT', () => {
    console.log('\n\n正在停止...');
    agent.stop();
    rl.close();
    process.exit(0);
  });

  try {
    while (true) {
      console.log('-'.repeat(60));
      const task = await askQuestion(rl, '\n请输入任务 (或输入 "exit" 退出): ');
      
      if (task.toLowerCase() === 'exit' || task.toLowerCase() === 'quit') {
        console.log('再见！');
        break;
      }

      if (task.trim() === '') {
        console.log('任务不能为空，请重新输入');
        continue;
      }

      // 执行任务
      await agent.run(task);
      console.log();
    }
  } catch (error) {
    console.error('发生错误:', error);
  } finally {
    rl.close();
  }
}

// 运行主函数
main().catch(console.error);
