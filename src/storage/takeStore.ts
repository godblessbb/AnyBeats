/**
 * 录音 take 的存储：音频大，放 IndexedDB（两张表：meta 存 take 信息，audio 存 PCM）。
 *
 * 跟着 StorageAdapter 走：StorageAdapter 不持久（画布 sandbox iframe）或 IndexedDB 打不开时，
 * 退到内存，persistent = false，界面提示「录音只在这次打开时有效」。
 */

import type { Take, TakeMeta } from '../audio/takes';
import type { StorageAdapter } from './StorageAdapter';

export interface TakeStore {
  readonly persistent: boolean;
  readonly reason: string | null;
  /** 某个作品的全部 take（按录制先后） */
  list(projectId: string): Promise<Take[]>;
  /** 新增或整条覆盖（含音频） */
  put(take: Take): Promise<void>;
  /** 只改信息（★、裁剪），不重写音频 */
  putMeta(meta: TakeMeta): Promise<void>;
  remove(id: string): Promise<void>;
}

const byCreated = (a: TakeMeta, b: TakeMeta) => a.createdAt - b.createdAt;

function metaOf(t: Take | TakeMeta): TakeMeta {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { samples, ...meta } = t as Take;
  return meta;
}

export class MemoryTakeStore implements TakeStore {
  readonly persistent = false;
  readonly reason: string | null;
  private metas = new Map<string, TakeMeta>();
  private audio = new Map<string, Float32Array>();

  constructor(reason: string | null = null) {
    this.reason = reason;
  }

  async list(projectId: string): Promise<Take[]> {
    return [...this.metas.values()]
      .filter((m) => m.projectId === projectId)
      .sort(byCreated)
      .map((m) => ({ ...m, samples: this.audio.get(m.id) ?? new Float32Array(0) }));
  }

  async put(take: Take): Promise<void> {
    this.metas.set(take.id, metaOf(take));
    this.audio.set(take.id, take.samples);
  }

  async putMeta(meta: TakeMeta): Promise<void> {
    this.metas.set(meta.id, metaOf(meta));
  }

  async remove(id: string): Promise<void> {
    this.metas.delete(id);
    this.audio.delete(id);
  }
}

const DB_NAME = 'anybeats-takes';
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务被中止'));
  });
}

export class IndexedDbTakeStore implements TakeStore {
  readonly persistent = true;
  readonly reason = null;
  private readonly db: IDBDatabase;

  constructor(db: IDBDatabase) {
    this.db = db;
  }

  static open(factory: IDBFactory, timeoutMs = 3000): Promise<IndexedDbTakeStore> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('IndexedDB 没有响应')), timeoutMs);
      let r: IDBOpenDBRequest;
      try {
        r = factory.open(DB_NAME, DB_VERSION);
      } catch (e) {
        clearTimeout(timer);
        reject(e);
        return;
      }
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' }).createIndex('projectId', 'projectId');
        if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
      };
      r.onsuccess = () => {
        clearTimeout(timer);
        resolve(new IndexedDbTakeStore(r.result));
      };
      r.onerror = () => {
        clearTimeout(timer);
        reject(r.error);
      };
      r.onblocked = () => {
        clearTimeout(timer);
        reject(new Error('IndexedDB 被别的标签页占着'));
      };
    });
  }

  async list(projectId: string): Promise<Take[]> {
    const tx = this.db.transaction(['meta', 'audio'], 'readonly');
    const metas = (await req(tx.objectStore('meta').index('projectId').getAll(projectId))) as TakeMeta[];
    const audio = tx.objectStore('audio');
    const out: Take[] = [];
    for (const m of metas.sort(byCreated)) {
      const samples = (await req(audio.get(m.id))) as Float32Array | undefined;
      out.push({ ...m, samples: samples ?? new Float32Array(0) });
    }
    return out;
  }

  async put(take: Take): Promise<void> {
    const tx = this.db.transaction(['meta', 'audio'], 'readwrite');
    tx.objectStore('meta').put(metaOf(take));
    tx.objectStore('audio').put(take.samples, take.id);
    await done(tx);
  }

  async putMeta(meta: TakeMeta): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(metaOf(meta));
    await done(tx);
  }

  async remove(id: string): Promise<void> {
    const tx = this.db.transaction(['meta', 'audio'], 'readwrite');
    tx.objectStore('meta').delete(id);
    tx.objectStore('audio').delete(id);
    await done(tx);
  }
}

/** 选存储：StorageAdapter 能持久 + IndexedDB 打得开 → IndexedDB；否则内存 */
export async function createTakeStore(storage: StorageAdapter, getFactory: () => IDBFactory | undefined = () => globalThis.indexedDB): Promise<TakeStore> {
  if (!storage.persistent) return new MemoryTakeStore(storage.reason ?? '拿不到本机存储');
  let factory: IDBFactory | undefined;
  try {
    factory = getFactory();
  } catch {
    factory = undefined;
  }
  if (!factory) return new MemoryTakeStore('这个环境没有 IndexedDB');
  try {
    return await IndexedDbTakeStore.open(factory);
  } catch (e) {
    return new MemoryTakeStore(`IndexedDB 打不开：${(e as Error)?.message || '未知原因'}`);
  }
}
