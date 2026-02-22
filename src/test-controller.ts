// 测试鼠标控制器
import { WindowsController } from './utils/windowsController.js';

async function test() {
  console.log('=== 鼠标控制器测试 ===\n');
  
  const controller = new WindowsController({ width: 1920, height: 1080 });
  
  console.log('测试 1: 移动鼠标到屏幕中心 (960, 540)');
  try {
    await controller.executeAction({ action: 'move', x: 960, y: 540 });
    console.log('✓ 移动成功\n');
  } catch (error) {
    console.error('✗ 移动失败:', error);
  }
  
  await new Promise(r => setTimeout(r, 1000));
  
  console.log('测试 2: 点击');
  try {
    await controller.executeAction({ action: 'click', x: 960, y: 540 });
    console.log('✓ 点击成功\n');
  } catch (error) {
    console.error('✗ 点击失败:', error);
  }
  
  await new Promise(r => setTimeout(r, 1000));
  
  console.log('测试 3: 输入文本');
  try {
    await controller.executeAction({ action: 'type', text: 'Hello World' });
    console.log('✓ 输入成功\n');
  } catch (error) {
    console.error('✗ 输入失败:', error);
  }
  
  console.log('=== 测试完成 ===');
}

test().catch(console.error);
