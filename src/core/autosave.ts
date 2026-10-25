/**
 * 自动保存草稿：每次改动后在 debounceMs 内写入存储，不要求工程先起名。
 * 存储和定时器都可注入（浏览器里传 localStorage 和 window.setTimeout），测试里用内存假实现。
 * 页面关闭前界面应调用 flush()（例如挂在 pagehide 上），把未落盘的改动立即写入。
 */

import { deserializeProject, serializeProject, type DeserializeOptions, type Project } from './project';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TimerApi {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AutosaveOptions {
  store: KeyValueStore;
  timers: TimerApi;
  key?: string;
  /** 第一次改动后最多等这么久就落盘，默认 1000ms */
  debounceMs?: number;
  onError?: (error: unknown) => void;
}

export const AUTOSAVE_KEY = 'anybeats.autosave.v2';

export interface Autosave {
  /** 工程每改一次就调用一次 */
  notify(project: Project): void;
  /** 立即写入未落盘的改动 */
  flush(): void;
  /** 读回草稿；没有或损坏时返回 null */
  restore(options?: DeserializeOptions): Project | null;
  clear(): void;
  readonly pending: boolean;
}

export function createAutosave(options: AutosaveOptions): Autosave {
  const { store, timers } = options;
  const key = options.key ?? AUTOSAVE_KEY;
  const debounceMs = options.debounceMs ?? 1000;
  let latest: Project | null = null;
  let handle: unknown = null;

  const write = () => {
    handle = null;
    if (!latest) return;
    try {
      store.setItem(key, serializeProject(latest));
      latest = null;
    } catch (e) {
      options.onError?.(e);
    }
  };

  return {
    notify(project) {
      latest = project;
      // 节流而不是不断推迟：连续打字时也保证 debounceMs 内落盘一次
      if (handle === null) handle = timers.setTimeout(write, debounceMs);
    },
    flush() {
      if (handle !== null) timers.clearTimeout(handle);
      write();
    },
    restore(opts) {
      const raw = store.getItem(key);
      if (!raw) return null;
      try {
        return deserializeProject(raw, opts);
      } catch (e) {
        options.onError?.(e);
        return null;
      }
    },
    clear() {
      if (handle !== null) timers.clearTimeout(handle);
      handle = null;
      latest = null;
      store.removeItem(key);
    },
    get pending() {
      return latest !== null;
    },
  };
}
