# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

AutoGUI TypeScript - 基于视觉的电脑操作 Agent，使用 AI 模型分析屏幕并执行操作。这是 Python 原版 (qwen_autogui) 的 TypeScript 复刻版本。

核心功能：
- 实时屏幕截图分析 (1000x1000 缩放坐标系)
- AI 驱动的任务规划和决策
- 自动坐标映射 (1000x1000 → 实际屏幕分辨率)
- 支持多 API Key 轮询和多 Provider 配置
- GUI 界面 (Electron) + CLI 双模式运行

## 构建和运行命令

```bash
# 安装依赖
npm install

# 编译 TypeScript
npm run build

# 运行编译后的版本
npm start

# 开发模式 (直接运行 TypeScript)
npm run dev

# GUI 模式 (Electron)
npm run gui

# 开发 GUI 模式
npm run dev:gui

# Lint
npm run lint

# 类型检查
npm run typecheck
```

## 配置

复制配置文件：
```bash
cp config.json.example config.json
```

### 配置格式 (`config.json`)

```json
{
  "api": {
    "provider": "default",
    "base_url": "https://api-inference.modelscope.cn/v1",
    "api_key": "your-api-key",
    "model": "Qwen/Qwen3.5-397B-A17B",
    "providers": [
      {
        "id": "provider1",
        "name": "Provider Name",
        "enabled": true,
        "base_url": "https://...",
        "api_keys": ["key1", "key2"],
        "models": [{"id": "model1", "enabled": true}]
      }
    ]
  },
  "settings": {
    "screenshot_interval": 2000,
    "max_iterations": 50,
    "coordinate_scale": 1000,
    "action_context_length": 8
  }
}
```

- 支持单 API Key 或多 Key 数组（轮询）
- 支持多 Provider 配置，每个 Provider 可以有多个 Key 和模型
- `action_context_length`: 发送给 AI 的历史操作数量（默认 8）

## 代码架构

### 核心模块

```
src/
├── types/index.ts          # 类型定义 (Action, Config, AIResponse 等)
├── agent.ts                # Agent 主类，任务执行循环
├── index.ts                # CLI 入口
├── electron/
│   ├── main.ts             # Electron 主进程，GUI 入口
│   ├── preload.ts          # Preload 脚本
│   └── global.d.ts         # 全局类型声明
└── utils/
    ├── ai.ts               # AIClient，AI 模型池管理和截图分析
    ├── apiKeyManager.ts    # API Key 轮询管理器
    ├── screenshot.ts       # 屏幕截图管理 (sharp 处理)
    ├── controller.ts       # nut-js 控制器 (跨平台)
    └── windowsController.ts # PowerShell 控制器 (Windows 原生)
```

### 数据流

1. **用户输入任务** → `index.ts` (CLI) 或 `electron/main.ts` (GUI)
2. **创建 Agent** → `agent.ts`
3. **Agent 执行循环**:
   - 调用 `ScreenshotManager.capture()` 获取 1000x1000 截图
   - 调用 `AIClient.analyzeScreenshot()` 分析截图
   - AI 返回 JSON 响应 `{thought, action}`
   - 坐标映射：`mapCoordinates()` (1000x1000 → 实际分辨率)
   - 执行操作：`Controller.executeAction()` 或 `WindowsController.executeAction()`
4. **重复检测**：Agent 会检测连续相同的操作并警告 AI

### 关键类说明

**AIClient** (`src/utils/ai.ts`):
- 构建模型池（支持多 Provider、多 Key、多模型）
- `analyzeScreenshot()`: 分析截图，自动重试，处理 API Key 错误
- 支持 JSON 解析容错（提取平衡括号、恢复损坏 JSON）

**Agent** (`src/agent.ts`):
- 主执行循环，迭代直到任务完成或达到 `max_iterations`
- 平台检测：Windows 使用 `WindowsController`，其他使用 `nut-js Controller`
- `updateRepeatedActionWarning()`: 检测重复操作死循环

**ScreenshotManager** (`src/utils/screenshot.ts`):
- `capture()`: 截图并缩放到 1000x1000
- `mapCoordinates()`: 将 1000x1000 坐标映射到实际分辨率

**WindowsController** (`src/utils/windowsController.ts`):
- 使用 PowerShell 和 Windows API (user32.dll) 实现
- 支持 DPI 感知 (`SetProcessDPIAware`)
- 所有操作通过 encoded PowerShell 脚本执行

**Controller** (`src/utils/controller.ts`):
- 使用 `@nut-tree-fork/nut-js` 库
- 跨平台鼠标键盘控制

### 支持的操作类型

```typescript
type ActionType =
  | 'click' | 'double_click' | 'right_click' | 'long_press'
  | 'type' | 'enter' | 'press'
  | 'scroll' | 'drag' | 'move' | 'wait' | 'task_complete';
```

Action 接口：
```typescript
interface Action {
  action: ActionType;
  x?: number; y?: number;           // 坐标 (1000x1000 系统)
  text?: string;                     // type 操作的文本
  keys?: string[];                   // press 操作的按键
  duration?: number;                 // wait 时长 (ms)
  hold_seconds?: number;             // long_press 按住时间
  scroll_amount?: number;            // 滚动量
  end_x?: number; end_y?: number;    // drag 终点
}
```

### GUI 特有功能 (`electron/main.ts`)

- **热键**: `CommandOrControl+Alt+A` 唤起，`CommandOrControl+Alt+X` 中断
- **光晕效果** (Aura): 任务执行时显示全屏渐变光晕
- **完成提示**: 任务完成后显示 7 秒倒计时提示
- **系统设置**: UI 设置保存在 `app.getPath('userData')/ui-settings.json`

## 依赖

- `@nut-tree-fork/nut-js`: 跨平台鼠标键盘控制
- `screenshot-desktop`: 屏幕截图
- `sharp`: 图像处理（截图缩放）
- `openai`: OpenAI API 客户端（兼容其他 API）
- `electron`: GUI 界面

## 调试

- 截图保存到 `debug_screenshots/` 目录
- 日志通过 IPC 发送到所有 UI 窗口
- 控制台输出会被劫持并广播到 UI

## 注意事项

1. **坐标系统**: AI 看到的是 1000x1000 的截图，实际执行时会映射到真实分辨率
2. **Windows 控制器**: 使用 PowerShell 和 user32.dll，需要允许脚本执行
3. **API Key 池**: 当某个 Key 失败时会自动切换下一个，3 轮全失败会报错
4. **JSON 容错**: AIClient 会尝试修复 AI 返回的损坏 JSON
5. **热键冲突**: 注册失败会自动回退到默认热键
