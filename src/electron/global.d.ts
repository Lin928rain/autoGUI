export {};

declare global {
  interface Window {
    autogui: {
      startTask: (task: string) => Promise<{ ok: boolean; message?: string }>;
      stopTask: () => Promise<{ ok: boolean; message?: string }>;
      submitTask: (
        payload: string | { task?: string; modelTarget?: string }
      ) => Promise<{ ok: boolean; message?: string }>;
      showPrompt: () => Promise<{ ok: boolean; message?: string }>;
      hidePrompt: () => Promise<{ ok: boolean; message?: string }>;
      setPromptClickThrough: (enabled: boolean) => Promise<{ ok: boolean; message?: string }>;
      openSettings: () => Promise<{ ok: boolean; message?: string }>;
      closeCompletion: () => Promise<{ ok: boolean; message?: string }>;
      getConfigMeta: () => Promise<{
        ok: boolean;
        message?: string;
        config?: {
          provider: string;
          baseURL: string;
          model: string;
          keyCount: number;
          actionContextLength: number;
        };
      }>;
      getRuntimeConfig: () => Promise<{
        ok: boolean;
        message?: string;
        config?: {
          api: {
            provider?: string;
            base_url: string;
            api_key: string | string[];
            model: string;
            providers?: Array<{
              id: string;
              name: string;
              enabled: boolean;
              base_url: string;
              api_keys: string[];
              models: Array<{ id: string; enabled: boolean }>;
            }>;
          };
          settings: {
            screenshot_interval: number;
            max_iterations: number;
            coordinate_scale: number;
            action_context_length?: number;
          };
        };
      }>;
      saveRuntimeConfig: (config: {
        api?: {
          provider?: string;
          base_url?: string;
          api_key?: string | string[];
          model?: string;
        };
        settings?: {
          screenshot_interval?: number;
          max_iterations?: number;
          coordinate_scale?: number;
          action_context_length?: number;
        };
      }) => Promise<{
        ok: boolean;
        message?: string;
        config?: {
          api: {
            provider?: string;
            base_url: string;
            api_key: string | string[];
            model: string;
            providers?: Array<{
              id: string;
              name: string;
              enabled: boolean;
              base_url: string;
              api_keys: string[];
              models: Array<{ id: string; enabled: boolean }>;
            }>;
          };
          settings: {
            screenshot_interval: number;
            max_iterations: number;
            coordinate_scale: number;
            action_context_length?: number;
          };
        };
      }>;
      listModelTargets: () => Promise<{
        ok: boolean;
        message?: string;
        targets: Array<{
          id: string;
          providerId: string;
          providerName: string;
          modelId: string;
          label: string;
        }>;
      }>;
      getHotkeySettings: () => Promise<{
        ok: boolean;
        settings: {
          invokeHotkey: string;
          interruptHotkey: string;
          completionAutoCloseMs: number;
        };
      }>;
      saveHotkeySettings: (settings: {
        invokeHotkey?: string;
        interruptHotkey?: string;
        completionAutoCloseMs?: number;
      }) => Promise<{
        ok: boolean;
        settings: {
          invokeHotkey: string;
          interruptHotkey: string;
          completionAutoCloseMs: number;
        };
        errors: string[];
      }>;
      onStatus: (
        handler: (payload: { status: 'idle' | 'running' | 'error'; detail: string }) => void
      ) => () => void;
      onLog: (
        handler: (payload: {
          level: 'log' | 'warn' | 'error' | 'info';
          message: string;
          timestamp: string;
        }) => void
      ) => () => void;
      onHotkeyUpdated: (
        handler: (payload: {
          invokeHotkey: string;
          interruptHotkey: string;
          errors: string[];
        }) => void
      ) => () => void;
      onPromptReset: (handler: () => void) => () => void;
      onCompletionUpdate: (
        handler: (payload: { message: string; seconds: number }) => void
      ) => () => void;
      onAuraVisibility: (handler: (payload: { visible: boolean }) => void) => () => void;
    };
  }
}
