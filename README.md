# AutoGUI TypeScript

基于视觉的电脑操作 Agent，使用 AI 模型分析屏幕并执行操作。这是 [qwen_autogui](https://github.com/tech-shrimp/qwen_autogui) 的 TypeScript 复刻版本。

## 功能特点

- 实时屏幕截图分析
- AI 驱动的任务规划和决策
- 自动坐标映射 (1000x1000 → 实际分辨率)
- 支持多种操作：点击、输入、快捷键、拖拽等
- 自动循环执行直到任务完成
- **多 API Key 轮询支持** - 自动切换失效的 Key

## 安装

```bash
# 克隆或下载项目
git clone <repository-url>
cd autogui-ts

# 安装依赖
npm install

# 编译 TypeScript
npm run build
```

## 配置

复制配置文件示例并编辑：

```bash
cp config.json.example config.json
```

编辑 `config.json` 文件：

### 单 API Key 配置

```json
{
  "api": {
    "base_url": "https://api-inference.modelscope.cn/v1",
    "api_key": "your-api-key-here",
    "model": "Qwen/Qwen3.5-397B-A17B"
  },
  "settings": {
    "screenshot_interval": 2000,
    "max_iterations": 50,
    "coordinate_scale": 1000
  }
}
```

### 多 API Key 轮询配置（推荐）

```json
{
  "api": {
    "base_url": "https://api-inference.modelscope.cn/v1",
    "api_key": [
      "your-api-key-1-here",
      "your-api-key-2-here",
      "your-api-key-3-here"
    ],
    "model": "Qwen/Qwen3.5-397B-A17B"
  },
  "settings": {
    "screenshot_interval": 2000,
    "max_iterations": 50,
    "coordinate_scale": 1000
  }
}
```

### 配置说明

- `api.base_url`: API 基础 URL
  - ModelScope: `https://api-inference.modelscope.cn/v1`
  - OpenAI: `https://api.openai.com/v1`
  - 其他兼容 OpenAI API 的服务
- `api.api_key`: API 密钥（支持单 key 字符串或多 key 数组）
- `api.model`: 使用的 AI 模型（需要支持视觉）
  - ModelScope: `Qwen/Qwen3.5-397B-A17B`
  - OpenAI: `gpt-4o`, `gpt-4-vision-preview`
- `settings.screenshot_interval`: 截图间隔（毫秒）
- `settings.max_iterations`: 最大迭代次数
- `settings.coordinate_scale`: 坐标缩放比例（默认 1000）

## 多 API Key 轮询功能

当配置多个 API Key 时，系统会自动：

1. **轮询使用** - 按顺序循环使用所有 Key
2. **自动切换** - 当某个 Key 失效（401、配额不足等）时自动切换到下一个
3. **状态追踪** - 记录每个 Key 的状态和错误信息
4. **脱敏显示** - 日志中只显示 Key 的前 8 位，保护安全

### 支持的 API Key 错误类型

- 401 Unauthorized - 认证失败
- Invalid API key - Key 无效
- Quota exceeded - 配额不足
- Rate limit - 请求频率限制
- Billing issues - 账单问题

## 使用

### 开发模式

```bash
npm run dev
```

### 生产模式

```bash
npm run build
npm start
```

### 示例任务

启动程序后，输入你的任务：

- "打开记事本并输入'Hello World'"
- "搜索桌面上的 Chrome 图标并打开它"
- "最小化所有窗口"
- "打开计算器并计算 123 + 456"

## 支持的操作

| 操作 | 说明 |
|------|------|
| click | 点击指定位置 |
| double_click | 双击 |
| right_click | 右键点击 |
| type | 输入文本 |
| press | 按键组合 |
| scroll | 滚动 |
| drag | 拖拽 |
| move | 移动鼠标 |
| wait | 等待 |
| task_complete | 标记任务完成 |

## 项目结构

```
autogui-ts/
├── src/
│   ├── types/
│   │   └── index.ts          # 类型定义
│   ├── utils/
│   │   ├── screenshot.ts     # 屏幕截图管理
│   │   ├── ai.ts             # AI 客户端（支持多 Key 轮询）
│   │   ├── apiKeyManager.ts  # API Key 轮询管理器
│   │   └── controller.ts     # 操作控制器
│   ├── agent.ts              # Agent 主类
│   └── index.ts              # 入口文件
├── config.json.example       # 配置示例
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

## 依赖说明

- `@nut-tree-fork/nut-js`: 跨平台自动化控制（鼠标、键盘）
- `screenshot-desktop`: 屏幕截图
- `sharp`: 图像处理
- `openai`: OpenAI API 客户端

## 注意事项

1. **安全性**: 配置文件包含敏感信息，已添加到 `.gitignore`，请勿提交到版本控制
2. **权限**: 某些操作可能需要管理员权限
3. **AI 模型**: 需要使用支持视觉的模型
4. **调试**: 截图会自动保存到 `debug_screenshots/` 目录用于调试
5. **API Key**: 建议使用多 Key 配置以提高稳定性

## 与 Python 原版的区别

| 特性 | Python 原版 | TypeScript 版本 |
|------|-------------|-----------------|
| 语言 | Python | TypeScript/Node.js |
| 截图 | pyautogui/PIL | screenshot-desktop/sharp |
| 控制 | pyautogui | @nut-tree-fork/nut-js |
| AI 客户端 | openai | openai (官方 Node.js SDK) |
| 多 Key 轮询 | 不支持 | ✅ 支持 |
| 类型安全 | 无 | 完整类型支持 |

## License

MIT
