import { describe, expect, it } from 'vitest';
import { findClip, iterateClips, serializeProject, updateClip } from '../../core';
import { FakeTimers, MemoryStore } from '../../core/__tests__/fakeTime';
import { ProjectLibrary, LEGACY_KEY } from '../../storage/library';
import { MemoryStorage, WebStorage, type StorageAdapter } from '../../storage/StorageAdapter';
import { EditorStore } from '../editorStore';
import { barText } from '../view';
import { emptyProject } from '../demo';

/** 模拟「本机存储可用」：WebStorage 包一个内存 Storage */
function persistentStorage(backing = new MemoryStore()): StorageAdapter {
  return new WebStorage(backing as unknown as Storage);
}

function setup(storage: StorageAdapter = persistentStorage()) {
  const timers = new FakeTimers();
  const library = new ProjectLibrary(storage, () => 1000);
  const store = new EditorStore({ storage, library, timers, now: () => 1000 });
  return { storage, timers, library, store };
}

const texts = (store: EditorStore) => store.getState().grid.sections.flatMap((s) => s.bars.map(barText));

describe('EditorStore：首次打开与自动保存', () => {
  it('第一次打开放视觉稿里的「夜车」，并进了作品库', () => {
    const { store, library } = setup();
    expect(store.getState().name).toBe('夜车');
    expect(texts(store)[0]).toBe('凌晨三点我还在路上');
    expect(library.list()).toHaveLength(1);
  });

  it('改动 1 秒内经 core/autosave 落盘，刷新（新实例 + 同一个存储）后还在', () => {
    const backing = new MemoryStore();
    const a = setup(persistentStorage(backing));
    a.store.writeText(9 * 16 + 9, '城市');
    expect(a.store.getState().save.kind).toBe('pending');
    a.timers.advance(999);
    expect(a.store.getState().save.kind).toBe('pending');
    a.timers.advance(1);
    expect(a.store.getState().save.kind).toBe('saved');

    const b = setup(persistentStorage(backing));
    expect(texts(b.store)[9]).toBe('没人给我捷径城市');
  });

  it('flush（页面关闭）不等 1 秒立即落盘', () => {
    const backing = new MemoryStore();
    const a = setup(persistentStorage(backing));
    a.store.rename('新名字');
    a.store.flush();
    expect(setup(persistentStorage(backing)).store.getState().name).toBe('新名字');
  });

  it('拿不到存储时用内存，状态是「本次不保存」，照样能编辑', () => {
    const { store } = setup(new MemoryStorage('画布里拿不到本机存储'));
    expect(store.getState().save).toEqual({ kind: 'memory', reason: '画布里拿不到本机存储' });
    store.writeText(0, '我');
    expect(store.getState().save.kind).toBe('memory');
    expect(texts(store)[0].startsWith('我')).toBe(true);
  });

  it('首次启动把旧版 v1 作品（anybeats_projects）导入作品库', () => {
    const backing = new MemoryStore();
    backing.setItem(
      LEGACY_KEY,
      JSON.stringify([{ name: '旧歌', createdAt: 1, updatedAt: 2, measures: [[{ text: '我们', isAccented: true }, { text: '-', isAccented: false }, { text: ' ', isAccented: false }, { text: '走', isAccented: false }]] }]),
    );
    const { library } = setup(persistentStorage(backing));
    const old = library.list().find((m) => m.name === '旧歌');
    expect(old).toBeTruthy();
    const p = library.load(old!.id)!;
    expect(barText(p.grid.sections[0].bars[0])).toBe('我们走');
    // 只导入一次
    expect(new ProjectLibrary(persistentStorage(backing)).migrateLegacy()).toBe(0);
  });
});

describe('EditorStore：编辑都走 core', () => {
  it('单击 → 单击 → 双击（core/cellGesture）切换重音并关掉编辑框', () => {
    const { store } = setup();
    const abs = 9 * 16 + 1; // 第 10 小节「人」
    const target = { id: String(abs), hasText: true };
    store.gesture({ type: 'click', target });
    expect(store.getState().gesture.editing).toBe(String(abs));
    store.gesture({ type: 'click', target });
    store.gesture({ type: 'dblclick', target });
    const clip = [...iterateClips(store.getState().grid)].find((c) => c.absStart === abs)!.clip;
    expect(clip.accent).toBe(true);
    expect(store.getState().gesture.editing).toBeNull();
  });

  it('一格一个字；- 延音、_ 空拍；在延音尾巴上写字只截短前一个字', () => {
    const { store } = setup();
    store.newProject();
    store.writeText(0, '我们');
    store.markFocused('hold'); // 没选中：不动
    store.select(2);
    store.markFocused('hold');
    store.markFocused('rest');
    const bar = store.getState().grid.sections[0].bars[0];
    expect(bar.clips.map((c) => [c.start, c.length, c.text, c.hold])).toEqual([
      [0, 1, '我', false],
      [1, 1, '们', false],
      [2, 1, '', true],
      [3, 1, '', false],
    ]);
    // 「我」拉长到 4 格，再在第 2 格写字：「我」被截到 2 格，不被删
    store.clearSlots(1, 3);
    store.exec('拉长', (g) => updateClip(g, bar.clips[0].id, { length: 4 }));
    store.writeText(2, '们');
    expect(store.getState().grid.sections[0].bars[0].clips.map((c) => [c.start, c.length, c.text])).toEqual([
      [0, 2, '我'],
      [2, 1, '们'],
    ]);
  });

  it('撤销 / 重做（core/history）', () => {
    const { store } = setup();
    const before = texts(store)[0];
    store.writeText(0, '早');
    expect(texts(store)[0].startsWith('早')).toBe(true);
    expect(store.getState().undoLabel).toBe('输入歌词');
    store.undo();
    expect(texts(store)[0]).toBe(before);
    store.redo();
    expect(texts(store)[0].startsWith('早')).toBe(true);
  });

  it('复制粘贴、删除选区', () => {
    const { store } = setup();
    store.newProject();
    store.writeText(0, '一二三四');
    store.select(0);
    store.select(3, true);
    expect(store.copySelection()).toBe(4);
    store.select(16);
    store.paste();
    expect(texts(store)[1]).toBe('一二三四');
    store.select(16);
    store.select(17, true);
    store.deleteSelection();
    expect(texts(store)[1]).toBe('三四');
  });

  it('格子拖到格子、小节重排、段落增删改名', () => {
    const { store } = setup();
    store.newProject();
    store.writeText(0, '我');
    store.moveSlot(0, 5);
    expect(store.getState().grid.sections[0].bars[0].clips[0].start).toBe(5);
    store.writeText(16, '你');
    store.moveBarTo({ section: 0, bar: 1 }, { section: 0, bar: 0 });
    expect(texts(store).slice(0, 2)).toEqual(['你', '我']);
    store.addSection();
    expect(store.getState().grid.sections[1].label).toBe('主歌 2');
    store.renameSection(1, 'Hook');
    expect(store.getState().grid.sections[1].label).toBe('Hook');
    store.duplicateSection(0);
    expect(store.getState().grid.sections).toHaveLength(3);
    store.deleteSection(1);
    expect(store.getState().grid.sections).toHaveLength(2);
  });

  it('作品库：新建 / 打开 / 改名 / 删除 / 导入工程文件', () => {
    const { store, library } = setup();
    const first = store.getState().projectId;
    store.newProject();
    expect(store.getState().name).toBe('未命名 1');
    store.renameProject(first, '夜车 v2');
    expect(library.list().find((m) => m.id === first)?.name).toBe('夜车 v2');
    store.openProject(first);
    expect(store.getState().name).toBe('夜车 v2');
    const file = serializeProject(emptyProject('导入的歌', 5));
    expect(store.importProjectFile(file)).toBe(true);
    expect(store.getState().name).toBe('导入的歌');
    expect(store.importProjectFile('{坏的')).toBe(false);
    expect(store.getState().notice?.text).toMatch(/导入失败/);
    const id = store.getState().projectId;
    store.deleteProject(id);
    expect(library.list().some((m) => m.id === id)).toBe(false);
  });

  it('AI 预览：先填后面的空小节，不够再插；采用后能撤销', () => {
    const { store } = setup();
    store.newProject(); // 16 个空小节
    store.writeText(0, '第一句');
    const at = store.continuePoint();
    expect(at).toEqual({ section: 0, at: 1 });
    const bar = store.getState().grid.sections[0].bars[0];
    store.setPreview({ task: 'continue', mode: 'fill', ...at, bars: [bar, bar], lines: ['第一句', '第一句'], before: [], warnings: [] });
    const n = store.getState().grid.sections[0].bars.length;
    store.adoptPreview();
    expect(store.getState().preview).toBeNull();
    expect(texts(store).slice(0, 3)).toEqual(['第一句', '第一句', '第一句']);
    expect(store.getState().grid.sections[0].bars.length).toBe(n); // 填进空小节，没有多插
    store.undo();
    expect(texts(store).slice(0, 3)).toEqual(['第一句', '', '']);
    expect(findClip(store.getState().grid, bar.clips[0].id)).toBeTruthy();
  });
});
