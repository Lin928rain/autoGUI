// 测试 AI 响应
import fs from 'fs/promises';
import path from 'path';
import { AIClient } from './utils/ai.js';
import { ScreenshotManager } from './utils/screenshot.js';

async function testAI() {
  console.log('=== AI 响应测试 ===\n');
  
  // 加载配置
  const configData = await fs.readFile(path.join(process.cwd(), 'config.json'), 'utf-8');
  const config = JSON.parse(configData);
  
  const aiClient = new AIClient(config);
  const screenshotManager = new ScreenshotManager(1000);
  
  console.log('1. 捕获屏幕截图...');
  const screenshot = await screenshotManager.capture();
  const base64Image = screenshotManager.bufferToBase64(screenshot);
  console.log(`   截图大小: ${screenshot.length} bytes`);
  console.log(`   Base64 长度: ${base64Image.length}\n`);
  
  console.log('2. 发送给 AI 分析...');
  const task = '移动鼠标到屏幕中心';
  
  try {
    const response = await aiClient.analyzeScreenshot(base64Image, task);
    console.log('\n=== AI 响应 ===');
    console.log('思考:', response.thought);
    console.log('操作:', JSON.stringify(response.action, null, 2));
    
    // 检查操作是否有效
    if (response.action) {
      console.log('\n操作类型:', response.action.action);
      if (response.action.x !== undefined) {
        console.log('X 坐标:', response.action.x);
      }
      if (response.action.y !== undefined) {
        console.log('Y 坐标:', response.action.y);
      }
    }
  } catch (error) {
    console.error('AI 请求失败:', error);
  }
}

testAI().catch(console.error);
