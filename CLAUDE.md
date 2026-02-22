# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

AutoGUI - 基于视觉的电脑操作 Agent，使用 AI 模型分析屏幕并执行操作。支持 CLI 和 Electron GUI 两种运行模式。

## 开发命令

```bash
# 安装依赖
npm install

# TypeScript 类型检查
npm run typecheck

# 编译 TypeScript
npm run build

# CLI 开发模式
npm run dev

# CLI 生产模式
npm start

# Electron GUI 模式 (开发/生产)
npm run gui
# 或
npm run dev:gui

# Lint
npm run lint
```

## 架构结构

```
autoGUI/
├── src/
│   ├── types/
│   │   └── index.ts          # 类型定义 (Action, Config, AIResponse 等)
│   ├── utils/
│   │   ├── screenshot.ts     # 屏幕截图管理 (sharp 处理)
│   │   ├── ai.ts             # AI 客户端 (多 API Key 轮询)
│   │   ├── controller.ts     # nut-js 控制器
│   │   └── windowsController.ts # Windows PowerShell 原生控制器
│   ├── electron/
│   │   ├── main.ts           # Electron 主进程
│   │   └── preload.ts        # 预加载脚本
│   ├── agent.ts              # 核心 Agent 类 (任务执行循环)
│   └── index.ts              # CLI 入口
├── ui/                       # HTML 界面 (prompt/aura/completion/settings)
├── config.json               # API 配置 (不提交到 git)
└── config.json.example       # 配置示例
```

## 核心流程

1. **Agent 循环** (`agent.ts`): 截图 → AI 分析 → 执行动作 → 等待 → 重复
2. **坐标系统**: 截图统一缩放到 1000x1000 → 映射到实际屏幕分辨率
3. **多 API Key 轮询** (`utils/ai.ts`): 自动切换失效的 Key，支持多 Provider 配置

## 配置格式

```json
{
  "api": {
    "providers": [
      {
        "id": "modelscope",
        "name": "ModelScope",
        "enabled": true,
        "base_url": "https://api-inference.modelscope.cn/v1",
        "api_keys": ["key1", "key2"],
        "models": [{"id": "Qwen/Qwen3.5-397B-A17B", "enabled": true}]
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

## 支持的操作类型

- `click`, `double_click`, `right_click`, `long_press`
- `type`, `enter`, `press` (键盘)
- `scroll`, `drag`, `move`, `wait`
- `task_complete`

## 操作系统支持

- **Windows**: 使用 `WindowsController` (PowerShell + System.Windows.Forms)
- **其他平台**: 使用 `Controller` (nut-js)
