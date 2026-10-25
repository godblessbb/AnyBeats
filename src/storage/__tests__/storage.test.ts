import { describe, expect, it } from 'vitest';
import { createProject, deserializeProject, serializeProject } from '../../core';
import { MemoryStore } from '../../core/__tests__/fakeTime';
import { INDEX_KEY, ProjectLibrary, projectKey } from '../library';
import { createStorage, MemoryStorage } from '../StorageAdapter';

describe('createStorage', () => {
  it('访问 localStorage 抛错（sandbox 不透明源 iframe）→ 退到内存，persistent = false', () => {
    const s = createStorage(() => {
      throw new DOMException('The document is sandboxed', 'SecurityError');
    });
    expect(s.persistent).toBe(false);
    expect(s.reason).toMatch(/画布/);
    s.setItem('a', '1');
    expect(s.getItem('a')).toBe('1');
  });

  it('写入探测失败（隐私模式配额 0）也退到内存', () => {
    const broken = { setItem: () => { throw new Error('QuotaExceeded'); } } as unknown as Storage;
    expect(createStorage(() => broken).persistent).toBe(false);
  });

  it('没有 localStorage（node）→ 内存', () => {
    expect(createStorage(() => undefined).persistent).toBe(false);
  });

  it('能用就用本机存储', () => {
    const backing = new MemoryStore();
    const s = createStorage(() => backing as unknown as Storage);
    expect(s.persistent).toBe(true);
    s.setItem('k', 'v');
    expect(backing.getItem('k')).toBe('v');
    expect(backing.getItem('anybeats.probe')).toBeNull();
  });
});

describe('ProjectLibrary', () => {
  it('新建 / 读取 / 删除 / 未命名编号', () => {
    const lib = new ProjectLibrary(new MemoryStorage(), () => 10);
    expect(lib.nextUntitledName()).toBe('未命名 1');
    const id = lib.create(createProject({ name: '未命名 1', updatedAt: 5 }));
    expect(lib.nextUntitledName()).toBe('未命名 2');
    expect(lib.load(id)?.name).toBe('未命名 1');
    lib.remove(id);
    expect(lib.list()).toEqual([]);
    expect(lib.load(id)).toBeNull();
  });

  it('trackedStore：autosave 写工程正文时同步索引；索引持久化', () => {
    const backing = new MemoryStorage();
    const lib = new ProjectLibrary(backing, () => 10);
    const id = lib.create(createProject({ name: 'a', updatedAt: 1 }));
    lib.trackedStore().setItem(projectKey(id), serializeProject(createProject({ name: 'b', updatedAt: 99 })));
    expect(lib.list()[0]).toMatchObject({ id, name: 'b', updatedAt: 99, bars: 8 });
    expect(JSON.parse(backing.getItem(INDEX_KEY)!)[0].name).toBe('b');
    expect(new ProjectLibrary(backing).list()[0].name).toBe('b');
    expect(deserializeProject(backing.getItem(projectKey(id))!).name).toBe('b');
  });

  it('索引损坏时当成空列表，不抛错', () => {
    const s = new MemoryStorage();
    s.setItem(INDEX_KEY, '{坏');
    expect(new ProjectLibrary(s).list()).toEqual([]);
  });
});
