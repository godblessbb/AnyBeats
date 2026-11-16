import { describe, expect, it } from 'vitest';
import { createProject, deserializeProject, serializeProject } from '../../core';
import { MemoryStore } from '../../core/__tests__/fakeTime';
import { V2_NIGHT_DRIVE, V2_SECTIONS } from '../../core/__tests__/fixtures/v2project';
import { backupKey, historyKey, INDEX_KEY, ProjectLibrary, projectKey } from '../library';
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

  it('remove 连撤销历史一起删；迁移备份不删', () => {
    const s = new MemoryStorage();
    const lib = new ProjectLibrary(s, () => 10);
    const id = lib.create(createProject({ name: 'a' }));
    s.setItem(historyKey(id), '{"v":1}');
    s.setItem(backupKey(id), 'raw');
    expect(lib.loadHistory(id)).toBe('{"v":1}');
    lib.remove(id);
    expect(s.getItem(projectKey(id))).toBeNull();
    expect(s.getItem(historyKey(id))).toBeNull();
    expect(lib.loadHistory(id)).toBeNull();
    expect(s.getItem(backupKey(id))).toBe('raw');
    expect(lib.list()).toEqual([]);
  });
});

describe('ProjectLibrary.load：旧版本先备份原文再迁移', () => {
  it('v2：第一次读时把原文拷进备份键，迁移成 v3 返回；正文键不动', () => {
    const s = new MemoryStorage();
    s.setItem(projectKey('old'), V2_NIGHT_DRIVE);
    const lib = new ProjectLibrary(s);
    expect(lib.backupOf('old')).toBeNull();
    const p = lib.load('old')!;
    expect(p.name).toBe('夜车');
    expect(p.grid.sections.map((x) => x.label)).toEqual(['Verse 1', 'Hook', 'Verse 2']);
    expect(p.grid.sections[0].bars[0].words[0]).toMatchObject({ tick: 0, len: 12, text: '凌' });
    expect(s.getItem(backupKey('old'))).toBe(V2_NIGHT_DRIVE);
    expect(lib.backupOf('old')).toBe(V2_NIGHT_DRIVE);
    expect(s.getItem(projectKey('old'))).toBe(V2_NIGHT_DRIVE);
  });

  it('备份只拷一次：之后正文变了（另一份旧文件 / 已经存成 v3）再读，备份也不覆盖', () => {
    const s = new MemoryStorage();
    s.setItem(projectKey('old'), V2_NIGHT_DRIVE);
    const lib = new ProjectLibrary(s);
    lib.load('old');
    s.setItem(projectKey('old'), V2_SECTIONS);
    expect(lib.load('old')?.name).toBe('段落名');
    expect(s.getItem(backupKey('old'))).toBe(V2_NIGHT_DRIVE);
    s.setItem(projectKey('old'), serializeProject(createProject({ name: '新版' })));
    expect(lib.load('old')?.name).toBe('新版');
    expect(s.getItem(backupKey('old'))).toBe(V2_NIGHT_DRIVE);
  });

  it('v1（旧界面单个作品）也先备份', () => {
    const s = new MemoryStorage();
    const raw = JSON.stringify({ name: '旧歌', createdAt: 1, updatedAt: 2, measures: [[{ text: '我', isAccented: false }]] });
    s.setItem(projectKey('v1'), raw);
    expect(new ProjectLibrary(s).load('v1')?.name).toBe('旧歌');
    expect(s.getItem(backupKey('v1'))).toBe(raw);
  });

  it.each([
    ['不支持的 v2（每小节 8 格）', V2_NIGHT_DRIVE.replace('"stepsPerBar":16', '"stepsPerBar":8')],
    ['更新的版本', JSON.stringify({ schema: 'anybeats.project', version: 4, sections: [] })],
    ['不是合法 JSON', '{坏'],
  ])('迁移失败（%s）：返回 null，正文原样留着，备份里也有原文', (_name, raw) => {
    const s = new MemoryStorage();
    s.setItem(projectKey('bad'), raw);
    const lib = new ProjectLibrary(s);
    expect(lib.load('bad')).toBeNull();
    expect(s.getItem(projectKey('bad'))).toBe(raw);
    expect(s.getItem(backupKey('bad'))).toBe(raw);
    // 再读一次也一样，什么都不丢
    expect(lib.load('bad')).toBeNull();
    expect(s.getItem(projectKey('bad'))).toBe(raw);
    expect(s.getItem(backupKey('bad'))).toBe(raw);
  });

  it('v3：不写备份', () => {
    const s = new MemoryStorage();
    const lib = new ProjectLibrary(s, () => 10);
    const id = lib.create(createProject({ name: 'v3' }));
    expect(lib.load(id)?.name).toBe('v3');
    expect(s.getItem(backupKey(id))).toBeNull();
    expect(lib.backupOf(id)).toBeNull();
  });

  it('备份写不进去（配额满）：照样能读出迁移后的作品', () => {
    const s = new MemoryStorage();
    s.setItem(projectKey('old'), V2_NIGHT_DRIVE);
    const lib = new ProjectLibrary(s);
    const full = {
      getItem: (k: string) => s.getItem(k),
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
      removeItem: (k: string) => s.removeItem(k),
    };
    const ro = new ProjectLibrary(full);
    expect(ro.load('old')?.name).toBe('夜车');
    expect(s.getItem(backupKey('old'))).toBeNull();
    expect(s.getItem(projectKey('old'))).toBe(V2_NIGHT_DRIVE);
    expect(lib.load('old')?.name).toBe('夜车');
  });

  it('没有这个作品：返回 null，不写任何键', () => {
    const s = new MemoryStorage();
    expect(new ProjectLibrary(s).load('nope')).toBeNull();
    expect(s.getItem(backupKey('nope'))).toBeNull();
  });
});
