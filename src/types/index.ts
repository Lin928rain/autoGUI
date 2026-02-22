// 操作类型定义
export type ActionType =
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'long_press'
  | 'type'
  | 'enter'
  | 'press'
  | 'scroll'
  | 'drag'
  | 'move'
  | 'wait'
  | 'task_complete'
  | 'shell';

// 操作接口
export interface Action {
  action: ActionType;
  x?: number;
  y?: number;
  text?: string;
  keys?: string[];
  duration?: number;
  hold_seconds?: number;
  scroll_amount?: number;
  end_x?: number;
  end_y?: number;
  // shell 动作专用字段
  command?: string;        // shell 命令内容
  shell?: string;          // 指定 shell 类型 (bash/powershell/cmd)
  timeout?: number;        // 超时时间 (ms)
  work_dir?: string;       // 工作目录
  capture_output?: boolean; // 是否捕获输出 (默认 true)
}

// Shell 执行结果
export interface ShellResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration: number;
  command: string;
}

// AI 响应接口
export interface AIResponse {
  thought: string;
  action: Action;
}

// API 配置接口（支持单 key 或多 key）
export interface ApiConfig {
  provider?: string;
  base_url: string;
  // 支持单 key (string) 或多 key (string[])
  api_key: string | string[];
  model: string;
  providers?: ApiProviderConfig[];
}

export interface ApiProviderConfig {
  id: string;
  name: string;
  enabled: boolean;
  base_url: string;
  api_keys: string[];
  models: ApiModelConfig[];
}

export interface ApiModelConfig {
  id: string;
  enabled: boolean;
}

// 配置接口
export interface Config {
  api: ApiConfig;
  settings: {
    screenshot_interval: number;
    max_iterations: number;
    coordinate_scale: number;
    action_context_length?: number;
  };
}

// 屏幕尺寸接口
export interface ScreenSize {
  width: number;
  height: number;
}

// 坐标接口
export interface Coordinates {
  x: number;
  y: number;
}
