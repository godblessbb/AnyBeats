/**
 * 作品库：本机的作品列表 + 每个作品一份 v2 工程（core/project 的序列化格式）。
 *
 * key：
 *   anybeats.library.v2          作品索引 [{ id, name, updatedAt, bars }]
 *   anybeats.project.v2.<id>     工程正文（core/autosave 往这里写）
 *   anybeats.current.v2          上次打开的作品 id
 *   anybeats_projects            旧界面（v1）的作品列表，只读，首次启动时导入一次
 */

import { barCount, deserializeProject, migrateLegacyStorage, serializeProject, type KeyValueStore, type Project } from '../core';

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  bars: number;
}

export const INDEX_KEY = 'anybeats.library.v2';
export const CURRENT_KEY = 'anybeats.current.v2';
export const LEGACY_KEY = 'anybeats_projects';
export const LEGACY_DONE_KEY = 'anybeats.legacy-imported.v2';
const PROJECT_PREFIX = 'anybeats.project.v2.';

export const projectKey = (id: string) => PROJECT_PREFIX + id;

let seq = 0;
function newProjectId(now: number): string {
  seq += 1;
  return `p${now.toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export class ProjectLibrary {
  private readonly store: KeyValueStore;
  private readonly now: () => number;
  private index: ProjectMeta[];
  private listeners = new Set<() => void>();

  constructor(store: KeyValueStore, now: () => number = () => Date.now()) {
    this.store = store;
    this.now = now;
    this.index = this.readIndex();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 按最近修改排序；返回的数组在下一次变化前保持同一个引用（给 useSyncExternalStore） */
  list(): ProjectMeta[] {
    return this.index;
  }

  load(id: string): Project | null {
    const raw = this.store.getItem(projectKey(id));
    if (!raw) return null;
    try {
      return deserializeProject(raw);
    } catch {
      return null;
    }
  }

  /** 新建一条作品，返回 id */
  create(project: Project): string {
    const id = newProjectId(this.now());
    this.store.setItem(projectKey(id), serializeProject(project));
    this.upsert({ id, name: project.name, updatedAt: project.updatedAt || this.now(), bars: barCount(project.grid) });
    return id;
  }

  remove(id: string): void {
    this.store.removeItem(projectKey(id));
    this.index = this.index.filter((m) => m.id !== id);
    this.writeIndex();
  }

  get currentId(): string | null {
    const id = this.store.getItem(CURRENT_KEY);
    return id && this.index.some((m) => m.id === id) ? id : null;
  }

  setCurrent(id: string): void {
    this.store.setItem(CURRENT_KEY, id);
  }

  /** 新作品的默认名「未命名 N」，N 取当前没被占用的最小值 */
  nextUntitledName(): string {
    const used = new Set(this.index.map((m) => m.name));
    for (let n = 1; ; n++) if (!used.has(`未命名 ${n}`)) return `未命名 ${n}`;
  }

  /**
   * 首次启动时把旧界面 localStorage 'anybeats_projects'（v1）导入作品库，只做一次。
   * 旧数据原样保留，不删。返回导入了几首。
   */
  migrateLegacy(): number {
    if (this.store.getItem(LEGACY_DONE_KEY)) return 0;
    let projects: Project[] = [];
    try {
      projects = migrateLegacyStorage(this.store.getItem(LEGACY_KEY));
    } catch {
      projects = [];
    }
    for (const p of projects) this.create({ ...p, name: p.name || this.nextUntitledName() });
    this.store.setItem(LEGACY_DONE_KEY, '1');
    return projects.length;
  }

  /**
   * 给 core/autosave 用的存储：写工程正文时顺手更新索引里的名字、小节数、修改时间。
   * 其它 key 原样透传。
   */
  trackedStore(): KeyValueStore {
    return {
      getItem: (key) => this.store.getItem(key),
      removeItem: (key) => this.store.removeItem(key),
      setItem: (key, value) => {
        this.store.setItem(key, value);
        if (!key.startsWith(PROJECT_PREFIX)) return;
        const id = key.slice(PROJECT_PREFIX.length);
        try {
          const p = deserializeProject(value);
          this.upsert({ id, name: p.name, updatedAt: p.updatedAt || this.now(), bars: barCount(p.grid) });
        } catch {
          // 正文已经写进去了，索引下次再补
        }
      },
    };
  }

  private upsert(meta: ProjectMeta) {
    const rest = this.index.filter((m) => m.id !== meta.id);
    this.index = [meta, ...rest].sort((a, b) => b.updatedAt - a.updatedAt);
    this.writeIndex();
  }

  private readIndex(): ProjectMeta[] {
    try {
      const raw = this.store.getItem(INDEX_KEY);
      const list: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      return list
        .filter((m): m is ProjectMeta => typeof m?.id === 'string' && typeof m?.name === 'string')
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  private writeIndex() {
    try {
      this.store.setItem(INDEX_KEY, JSON.stringify(this.index));
    } catch {
      // 配额满等：内存里的索引照样可用
    }
    for (const l of this.listeners) l();
  }
}
