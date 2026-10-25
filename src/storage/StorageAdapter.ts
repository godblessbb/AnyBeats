/**
 * 存储适配层：界面里所有读写都经过这里，不直接碰 localStorage。
 *
 * Alphie 用户画布是 sandbox="allow-scripts" 的不透明源 iframe，访问 localStorage 会抛 SecurityError。
 * 拿不到存储时自动退到内存（persistent = false），界面据此在顶栏提示「本次不保存」，不白屏。
 */

import type { KeyValueStore } from '../core';

export interface StorageAdapter extends KeyValueStore {
  /** true = 写进本机（刷新后还在）；false = 只在内存里，关掉就没了 */
  readonly persistent: boolean;
  /** persistent 为 false 时的原因，给界面显示 */
  readonly reason: string | null;
}

export class MemoryStorage implements StorageAdapter {
  readonly persistent = false;
  readonly reason: string | null;
  private map = new Map<string, string>();

  constructor(reason: string | null = null) {
    this.reason = reason;
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** 包一层浏览器 Storage；单次读写失败（配额满等）往外抛，由调用方（core/autosave 的 onError）处理 */
export class WebStorage implements StorageAdapter {
  readonly persistent = true;
  readonly reason = null;
  private readonly storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  getItem(key: string): string | null {
    return this.storage.getItem(key);
  }

  setItem(key: string, value: string): void {
    this.storage.setItem(key, value);
  }

  removeItem(key: string): void {
    this.storage.removeItem(key);
  }
}

const PROBE_KEY = 'anybeats.probe';

/**
 * 探测可用存储。getStorage 可注入（测试用）；默认读 globalThis.localStorage，
 * 在不透明源 iframe 里这一步本身就会抛错。
 */
export function createStorage(getStorage: () => Storage | undefined = () => globalThis.localStorage): StorageAdapter {
  try {
    const storage = getStorage();
    if (!storage) return new MemoryStorage('这个环境没有本机存储');
    storage.setItem(PROBE_KEY, '1');
    storage.removeItem(PROBE_KEY);
    return new WebStorage(storage);
  } catch {
    return new MemoryStorage('画布里拿不到本机存储');
  }
}
