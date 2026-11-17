import { describe, expect, it } from 'vitest';
import { allWords, barAt, cellKey, DEFAULT_POLISH, deserializeProject, serializeProject, TICKS_PER_BAR, wordStartingAt, type Word } from '../../core';
import { FakeTimers, MemoryStore } from '../../core/__tests__/fakeTime';
import { V2_NIGHT_DRIVE } from '../../core/__tests__/fixtures/v2project';
import { backupKey, CURRENT_KEY, historyKey, INDEX_KEY, LEGACY_KEY, ProjectLibrary, projectKey } from '../../storage/library';
import { MemoryStorage, WebStorage, type StorageAdapter } from '../../storage/StorageAdapter';
import { emptyProject } from '../demo';
import { EditorStore } from '../editorStore';

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

/** 全曲第 bar 小节（0 起）里第 tick 个 tick 的绝对位置 */
const at = (bar: number, tick: number) => bar * TICKS_PER_BAR + tick;
const wordAt = (store: EditorStore, abs: number): Word | undefined => wordStartingAt(store.grid, abs)?.word;
const textAt = (store: EditorStore, abs: number) => wordAt(store, abs)?.text;
const keyOf = (store: EditorStore, global: number, beat: number) => cellKey(barAt(store.grid, global)!.id, beat);
const barText = (store: EditorStore, global: number) => barAt(store.grid, global)!.words.map((w) => w.text).join('');
const layout = (store: EditorStore, global: number) => barAt(store.grid, global)!.words.map((w) => [w.tick, w.len, w.text]);
const kinds = (store: EditorStore) => store.getState().history.done.map((s) => s.kind);

/** 空工程里铺好：第 1 小节第 1 拍两个空字（0、12），第 2 小节第 1 拍「我」+ 一个空字，第 3 小节一个空字（不涂色）；
 *  新建一种颜色（单押 ang），涂第 1、2 小节的第 1 拍 */
function fillableProject(store: EditorStore) {
  store.newProject();
  for (const abs of [at(0, 0), at(0, 12), at(1, 0), at(1, 12), at(2, 0)]) store.flowClick(abs);
  store.commitText(at(1, 0), '我');
  store.addRule();
  const rule = store.getState().activeRule!;
  store.setRuleFinal(rule, 0, 'ang');
  store.selectBox({ bar: 0, beat: 0 }, { bar: 1, beat: 0 });
  store.paintSelection();
  return rule;
}

describe('EditorStore：首次打开、自动保存、刷新后撤销历史还在', () => {
  it('第一次打开放视觉稿里的「夜车」，并进了作品库', () => {
    const { store, library, storage } = setup();
    const s = store.getState();
    expect(s.name).toBe('夜车');
    expect(s.doc.bpm).toBe(92);
    expect(store.grid.sections.map((x) => x.label)).toEqual(['Intro', 'Verse 1', 'Hook']);
    expect(barText(store, 1)).toBe('凌晨三点街灯在还在路上找个地方');
    expect(library.list()).toHaveLength(1);
    expect(library.list()[0]).toMatchObject({ id: s.projectId, name: '夜车', bars: 9 });
    expect(storage.getItem(CURRENT_KEY)).toBe(s.projectId);
    expect(s.history).toMatchObject({ canUndo: false, canRedo: false, done: [], redo: [] });
    expect(s.save.kind).toBe('saved');
  });

  it('改动在 1 秒内经 core/autosave 落盘；刷新（新实例 + 同一个存储）后作品和撤销历史都还在，撤销真的能退回去', () => {
    const backing = new MemoryStore();
    const a = setup(persistentStorage(backing));
    const id = a.store.getState().projectId;
    a.store.commitText(at(1, 0), '早');
    expect(textAt(a.store, at(1, 0))).toBe('早');
    expect(a.store.getState().save.kind).toBe('pending');
    a.timers.advance(999);
    expect(a.store.getState().save.kind).toBe('pending');
    expect(backing.getItem(historyKey(id))).toBeNull();
    a.timers.advance(1);
    expect(a.store.getState().save.kind).toBe('saved');
    expect(deserializeProject(backing.getItem(projectKey(id))!).grid.sections[1].bars[0].words[0].text).toBe('早');
    expect(backing.getItem(historyKey(id))).not.toBeNull();
    const label = a.store.getState().history.undoLabel;
    expect(label).toBeTruthy();

    const b = setup(persistentStorage(backing));
    expect(b.store.getState().projectId).toBe(id);
    expect(b.library.list()).toHaveLength(1); // 没有再建一首「夜车」
    expect(textAt(b.store, at(1, 0))).toBe('早');
    const h = b.store.getState().history;
    expect(h.canUndo).toBe(true);
    expect(h.undoLabel).toBe(label);
    expect(h.done.map((s) => s.kind)).toEqual(['fill']);
    b.store.undo();
    expect(textAt(b.store, at(1, 0))).toBe('凌');
    expect(b.store.getState().history.canRedo).toBe(true);
    b.store.redo();
    expect(textAt(b.store, at(1, 0))).toBe('早');
  });

  it('撤销之后刷新：可重做的步骤也跟着存下来', () => {
    const backing = new MemoryStore();
    const a = setup(persistentStorage(backing));
    a.store.commitText(at(1, 0), '早');
    a.store.undo();
    a.store.flush();
    const b = setup(persistentStorage(backing));
    expect(textAt(b.store, at(1, 0))).toBe('凌');
    expect(b.store.getState().history).toMatchObject({ canUndo: false, canRedo: true });
    b.store.redo();
    expect(textAt(b.store, at(1, 0))).toBe('早');
  });

  it('flush（⌘S / 页面关闭）不等 1 秒立即落盘', () => {
    const backing = new MemoryStore();
    const a = setup(persistentStorage(backing));
    a.store.rename('新名字');
    a.store.commitText(at(1, 0), '早');
    a.store.flush();
    expect(a.store.getState().save.kind).toBe('saved');
    expect(a.timers.pendingCount).toBe(0);
    const b = setup(persistentStorage(backing));
    expect(b.store.getState().name).toBe('新名字');
    expect(textAt(b.store, at(1, 0))).toBe('早');
    expect(b.store.getState().history.canUndo).toBe(true);
  });

  it('拿不到存储时用内存：状态是「本次不保存」，照样能编辑、撤销', () => {
    const { store, timers } = setup(new MemoryStorage('画布里拿不到本机存储'));
    expect(store.persistent).toBe(false);
    expect(store.getState().save).toEqual({ kind: 'memory', reason: '画布里拿不到本机存储' });
    store.commitText(at(1, 0), '早');
    expect(textAt(store, at(1, 0))).toBe('早');
    expect(store.getState().save.kind).toBe('memory');
    timers.advance(1000);
    expect(store.getState().save.kind).toBe('memory');
    store.undo();
    expect(textAt(store, at(1, 0))).toBe('凌');
  });

  it('首次启动把旧版 v1 作品（anybeats_projects）导入作品库，只导入一次', () => {
    const backing = new MemoryStore();
    backing.setItem(
      LEGACY_KEY,
      JSON.stringify([{ name: '旧歌', createdAt: 1, updatedAt: 2, measures: [[{ text: '我们', isAccented: true }, { text: '-', isAccented: false }, { text: ' ', isAccented: false }, { text: '走', isAccented: false }]] }]),
    );
    const { library } = setup(persistentStorage(backing));
    const old = library.list().find((m) => m.name === '旧歌');
    expect(old).toBeTruthy();
    const p = library.load(old!.id)!;
    expect(p.grid.sections[0].bars[0].words.map((w) => [w.tick, w.len, w.text])).toEqual([
      [0, 24, '我'],
      [24, 72, '们'], // 「-」是「们」的长度
      [144, 48, '走'],
    ]);
    expect(new ProjectLibrary(persistentStorage(backing)).migrateLegacy()).toBe(0);
  });
});

describe('EditorStore：读旧作品（v2 → v3 迁移经作品库）', () => {
  function seed(backing: MemoryStore, id: string, raw: string) {
    backing.setItem(projectKey(id), raw);
    backing.setItem(INDEX_KEY, JSON.stringify([{ id, name: '夜车', updatedAt: 1731630000000, bars: 10 }]));
    backing.setItem(CURRENT_KEY, id);
  }

  it('打开 v2 作品：迁移后的内容对得上；原文拷进备份键；改动落盘后正文变 v3，备份还是原文', () => {
    const backing = new MemoryStore();
    seed(backing, 'old1', V2_NIGHT_DRIVE);
    const a = setup(persistentStorage(backing));
    expect(a.store.getState().projectId).toBe('old1');
    expect(a.store.getState().name).toBe('夜车');
    expect(a.store.doc).toMatchObject({ bpm: 92, offsetMs: 120 });
    expect(a.store.grid.sections.map((s) => s.label)).toEqual(['Verse 1', 'Hook', 'Verse 2']);
    expect(layout(a.store, 0).slice(0, 2)).toEqual([
      [0, 12, '凌'],
      [12, 12, '晨'],
    ]);
    expect(a.library.list()).toHaveLength(1); // 没有另建「夜车」
    expect(backing.getItem(backupKey('old1'))).toBe(V2_NIGHT_DRIVE);
    expect(backing.getItem(projectKey('old1'))).toBe(V2_NIGHT_DRIVE); // 只打开不改，正文不动

    a.store.commitText(at(0, 0), '早');
    a.store.flush();
    expect(JSON.parse(backing.getItem(projectKey('old1'))!).version).toBe(3);
    expect(backing.getItem(backupKey('old1'))).toBe(V2_NIGHT_DRIVE);

    // 再刷新：读的是 v3，备份不被覆盖，撤销历史接得上
    const b = setup(persistentStorage(backing));
    expect(b.store.getState().projectId).toBe('old1');
    expect(textAt(b.store, at(0, 0))).toBe('早');
    expect(backing.getItem(backupKey('old1'))).toBe(V2_NIGHT_DRIVE);
    b.store.undo();
    expect(textAt(b.store, at(0, 0))).toBe('凌');
  });

  it.each([
    ['不支持的 v2（每小节 8 格）', V2_NIGHT_DRIVE.replace('"stepsPerBar":16', '"stepsPerBar":8')],
    ['不是合法 JSON', '{"schema":"anybeats.project","version":2,坏'],
  ])('读不出来（%s）：换一首打开，原文留在正文键，也拷进了备份键，什么都没丢', (_name, raw) => {
    expect(raw).not.toBe(V2_NIGHT_DRIVE);
    const backing = new MemoryStore();
    seed(backing, 'old1', raw);
    const { store, library } = setup(persistentStorage(backing));
    expect(store.getState().projectId).not.toBe('old1');
    expect(store.grid.sections.map((s) => s.label)).toEqual(['Intro', 'Verse 1', 'Hook']); // 打开的是内置「夜车」
    expect(store.getState().notice?.text).toMatch(/读不出来/);
    expect(backing.getItem(projectKey('old1'))).toBe(raw);
    expect(backing.getItem(backupKey('old1'))).toBe(raw);
    expect(library.list().some((m) => m.id === 'old1')).toBe(true);

    // 在别的作品上改动、落盘，也不碰它；再去打开它只给提示
    store.commitText(at(1, 0), '早');
    store.flush();
    const cur = store.getState().projectId;
    store.openProject('old1');
    expect(store.getState().projectId).toBe(cur);
    expect(store.getState().notice?.text).toMatch(/读不出来/);
    expect(backing.getItem(projectKey('old1'))).toBe(raw);
    expect(backing.getItem(backupKey('old1'))).toBe(raw);
  });
});

describe('EditorStore：撤销 / 重做是一条线', () => {
  it('填字、铺 flow、涂色、锁定、换伴奏都进同一条历史（kind 区分），逐步撤销回到最初', () => {
    const { store } = setup();
    const original = store.doc;
    store.commitText(at(1, 0), '早'); // fill
    store.flowClick(at(1, 72)); // 第 2 小节第 2 拍的空位：flow
    expect(wordAt(store, at(1, 72))).toMatchObject({ len: 12, text: '' });
    store.clickCell(1, 0);
    store.setActiveRule('rD');
    store.paintSelection(); // paint
    store.lockCells(true); // lock
    store.requestBeat({ name: 'beat.mp3', bpm: 92, durationSec: 100, firstBeatMs: 120 }); // BPM 一样：直接换，beat
    expect(kinds(store)).toEqual(['fill', 'flow', 'paint', 'lock', 'beat']);
    expect(store.getState().history.done.every((s) => s.label && s.at === 1000)).toBe(true);
    for (let i = 0; i < 5; i++) store.undo();
    expect(store.doc).toBe(original);
    expect(store.getState().history.canUndo).toBe(false);
    expect(store.getState().history.redo.map((s) => s.kind)).toEqual(['fill', 'flow', 'paint', 'lock', 'beat']);
  });

  it('撤销之后做新改动：可重做的步骤全部丢掉', () => {
    const { store } = setup();
    store.commitText(at(1, 0), '早');
    store.commitText(at(1, 12), '上');
    store.undo();
    expect(store.getState().history).toMatchObject({ canRedo: true });
    expect(store.getState().history.redo).toHaveLength(1);
    expect(textAt(store, at(1, 12))).toBe('晨');
    store.commitText(at(1, 24), '好');
    expect(store.getState().history).toMatchObject({ canRedo: false, redo: [], redoLabel: null });
    store.redo(); // 没有可重做的：什么都不变
    expect(textAt(store, at(1, 12))).toBe('晨');
    expect(barText(store, 1).startsWith('早晨好点')).toBe(true);
  });

  it('没有变化的操作不记一步', () => {
    const { store } = setup();
    store.commitText(at(1, 0), '凌');
    store.setBpm(92);
    store.flowClick(at(1, 0)); // 已经有字：只是选中
    expect(store.getState().cursor).toBe(at(1, 0));
    expect(store.getState().history.done).toEqual([]);
  });
});

describe('EditorStore：铺 flow（拖音 = 字的长度，空音 = 空白）', () => {
  it('点格子按精度放空字；- 键拖长 / 缩短；拖右边缘吸附到精度；删掉留下空白', () => {
    const { store } = setup();
    store.newProject();
    expect(store.getState().name).toBe('未命名 1');
    store.flowClick(5); // 1/16：吸附到 0
    expect(layout(store, 0)).toEqual([[0, 12, '']]);
    expect(store.getState().cursor).toBe(0);
    store.extendCursor();
    expect(layout(store, 0)).toEqual([[0, 24, '']]);
    store.extendCursor(-1);
    expect(layout(store, 0)).toEqual([[0, 12, '']]);
    store.setPrecision('1/32');
    store.flowClick(30);
    expect(layout(store, 0)).toEqual([
      [0, 12, ''],
      [30, 6, ''],
    ]);
    store.setPrecision('t3');
    store.flowClick(at(0, 50)); // 三连：一拍 3 个，吸附到 48
    expect(wordAt(store, at(0, 48))?.len).toBe(16);
    // 拖右边缘：长度最多到下一个字的起点
    store.setPrecision('1/16');
    store.stretchWord(0, 100);
    expect(wordAt(store, 0)?.len).toBe(30);
    // 删掉选中的字，光标回到前一个字
    store.focusWord(30);
    store.deleteCursorWord();
    expect(layout(store, 0)).toEqual([
      [0, 30, ''],
      [48, 16, ''],
    ]);
    expect(store.getState().cursor).toBe(0);
    expect(kinds(store).every((k) => k === 'flow')).toBe(true);
  });

  it('字可以拖过小节线：下一行开头只有拖音；复制一行的 flow 到下一行（不带字）', () => {
    const { store } = setup();
    store.newProject();
    store.flowClick(at(0, 168));
    store.stretchWord(at(0, 168), at(1, 24));
    expect(wordAt(store, at(0, 168))?.len).toBe(48);
    expect(barAt(store.grid, 1)!.words).toEqual([]);
    store.clickCell(1, 0);
    expect(store.getState().holdTip).toMatchObject({ global: 1, beat: 0, fromBar: 0, fromBeat: 3 });

    store.flowClick(0);
    store.commitText(0, '我');
    store.copyFlowToNext(0);
    // 第 2 小节：第 1 小节的落点和长度（不带字），原来拖进来的音被截断
    expect(layout(store, 1)).toEqual([
      [0, 12, ''],
      [168, 48, ''],
    ]);
    expect(wordAt(store, at(0, 168))?.len).toBe(24);
    store.copyFlowToNext(7);
    expect(store.getState().notice?.text).toMatch(/最后一小节/);
    store.clearBarFlow(1);
    expect(layout(store, 1)).toEqual([]);
  });
});

describe('EditorStore：填字', () => {
  it('一个位置只放一个字：多打的字不会写到别的位置；空字符串清掉文字', () => {
    const { store } = setup();
    store.commitText(at(1, 0), '早');
    expect(barText(store, 1).startsWith('早晨三点')).toBe(true);
    expect(store.getState().cursor).toBe(at(1, 12));
    expect(store.getState().history.undoLabel).toMatch(/填字/);
    store.commitText(at(1, 0), '早上好');
    expect(barText(store, 1).startsWith('早晨三点')).toBe(true);
    expect(store.getState().notice?.text).toMatch(/双击/);
    store.commitText(at(1, 0), '');
    expect(textAt(store, at(1, 0))).toBe('');
    expect(kinds(store)).toEqual(['fill', 'fill']);
  });

  it('候选词填进一格的韵脚位置（最后 n 个字）', () => {
    const { store } = setup();
    store.fillRhyme(keyOf(store, 1, 3), '市场');
    expect(barText(store, 1).endsWith('找个市场')).toBe(true);
    store.fillRhyme(keyOf(store, 1, 0), '你好'); // 没涂色
    expect(store.getState().notice?.text).toMatch(/涂了色/);
    expect(kinds(store)).toEqual(['fill']);
  });

  it('严格按字面比对韵母：规则 ang，写「想」(iang) 算对不上，写「方」才对', () => {
    const { store } = setup();
    store.newProject();
    store.flowClick(0);
    store.addRule();
    const rule = store.getState().activeRule!;
    store.setRuleFinal(rule, 0, 'ang');
    expect(store.doc.rules.find((r) => r.id === rule)?.finals).toEqual(['ang']);
    store.clickCell(0, 0);
    store.paintSelection();
    expect(store.mismatchCount()).toBe(0); // 还没写字不算
    store.commitText(0, '想');
    expect(store.mismatchCount()).toBe(1);
    store.commitText(0, '方');
    expect(store.mismatchCount()).toBe(0);
  });

  it('夜车里把韵脚「方」改成「想」：对不上的数量加一', () => {
    const { store } = setup();
    expect(store.mismatchCount()).toBe(0);
    store.commitText(at(1, 180), '想');
    expect(store.mismatchCount()).toBe(1);
  });
});

describe('EditorStore：锁定', () => {
  function expectBlocked(store: EditorStore, action: () => void) {
    const doc = store.doc;
    const depth = store.getState().history.done.length;
    const notice = store.getState().notice;
    action();
    expect(store.doc).toBe(doc);
    expect(store.getState().history.done).toHaveLength(depth);
    expect(store.getState().notice).not.toBe(notice);
    expect(store.getState().notice?.text).toMatch(/锁住了/);
  }

  it('锁了格子：这一格不能填字、不能铺 flow、不能删字，别的格照样能改；解锁后又能改', () => {
    const { store } = setup();
    store.clickCell(1, 0);
    store.lockCells(true);
    expect(store.doc.locks.cells).toEqual([keyOf(store, 1, 0)]);
    expect(kinds(store)).toEqual(['lock']);
    expectBlocked(store, () => store.commitText(at(1, 0), '早'));
    store.setPrecision('1/32');
    expectBlocked(store, () => store.flowClick(at(1, 6)));
    store.setPrecision('1/16');
    store.focusWord(at(1, 12));
    expectBlocked(store, () => store.deleteCursorWord());
    store.focusWord(at(1, 12));
    expectBlocked(store, () => store.extendCursor(-1)); // 改长度也不行
    expectBlocked(store, () => store.clearBarFlow(1));
    // 旁边没锁的格照样能改
    store.commitText(at(1, 48), '路');
    expect(textAt(store, at(1, 48))).toBe('路');
    store.clickCell(1, 0);
    store.lockCells(false);
    store.commitText(at(1, 0), '早');
    expect(textAt(store, at(1, 0))).toBe('早');
  });

  it('锁整行 / 整列', () => {
    const { store } = setup();
    store.selectRow(2);
    store.lockRows(true);
    expect(store.doc.locks.bars).toEqual([barAt(store.grid, 2)!.id]);
    expectBlocked(store, () => store.commitText(at(2, 48), '雨'));
    expectBlocked(store, () => store.flowClick(at(2, 12))); // 会截短拖着的「霓」
    store.selectColumn(0);
    store.lockColumns(true);
    expect(store.doc.locks.beats).toEqual([0]);
    expectBlocked(store, () => store.commitText(at(4, 0), '一'));
    store.commitText(at(4, 48), '走');
    expect(textAt(store, at(4, 48))).toBe('走');
    expect(kinds(store)).toEqual(['lock', 'lock', 'fill']);
  });

  it('锁全部韵脚位置：韵脚字不能改，同一格里不是韵脚的字照样能改', () => {
    const { store } = setup();
    store.lockRhyme(true);
    expect(store.doc.locks.rhyme).toBe(true);
    expectBlocked(store, () => store.commitText(at(1, 180), '堂'));
    expectBlocked(store, () => store.fillRhyme(keyOf(store, 1, 3), '市场'));
    store.commitText(at(1, 144), '去');
    expect(textAt(store, at(1, 144))).toBe('去');
    store.lockRhyme(false);
    store.commitText(at(1, 180), '堂');
    expect(textAt(store, at(1, 180))).toBe('堂');
  });

  it('锁定不挡涂色（涂色不改字）', () => {
    const { store } = setup();
    store.clickCell(1, 0);
    store.lockCells(true);
    store.setActiveRule('rB');
    store.paintSelection();
    expect(store.doc.paint[keyOf(store, 1, 0)]).toBe('rB');
  });
});

describe('EditorStore：选格子 / 涂色', () => {
  it('点只有拖音的格子（第 7 小节第 2 拍，「门」拖过来）：出提示、选不上', () => {
    const { store } = setup();
    store.clickCell(1, 0);
    expect(store.getState().selection).toEqual([keyOf(store, 1, 0)]);
    store.clickCell(6, 1);
    expect(store.getState().holdTip).toMatchObject({ key: keyOf(store, 6, 1), global: 6, beat: 1, fromBar: 6, fromBeat: 0, text: '门' });
    expect(store.getState().selection).toEqual([]);
    expect(store.canPaintKey(keyOf(store, 6, 1))).toBe(false);
    store.dismissHoldTip();
    expect(store.getState().holdTip).toBeNull();
    store.clickCell(6, 0);
    expect(store.getState().holdTip).toBeNull();
    expect(store.getState().selection).toEqual([keyOf(store, 6, 0)]);
  });

  it('选区里有只有拖音的格子：涂色跳过它（paint 里没有这个键），其余照涂', () => {
    const { store } = setup();
    store.selectRow(6);
    expect(store.getState().selection).toHaveLength(4);
    store.setActiveRule('rB');
    store.paintSelection();
    const paint = store.doc.paint;
    expect(keyOf(store, 6, 1) in paint).toBe(false);
    expect([0, 2, 3].map((b) => paint[keyOf(store, 6, b)])).toEqual(['rB', 'rB', 'rB']);
    expect(store.getState().notice?.text).toMatch(/跳过 1 格/);
    expect(kinds(store)).toEqual(['paint']);
    // 只框了这一格：涂不上，出拖音提示
    store.selectBox({ bar: 6, beat: 1 }, { bar: 6, beat: 1 });
    store.paintSelection();
    expect(store.getState().holdTip?.text).toBe('门');
    expect(kinds(store)).toEqual(['paint']);
  });

  it('一格一种颜色：用别的颜色再涂就替换；擦掉', () => {
    const { store } = setup();
    const k = keyOf(store, 6, 2);
    expect(store.doc.paint[k]).toBe('rD');
    store.clickCell(6, 2);
    store.setActiveRule('rB');
    store.paintSelection();
    expect(store.doc.paint[k]).toBe('rB');
    expect(Object.values(store.doc.paint)).not.toContain('rD');
    store.setActiveRule('rA');
    store.paintSelection();
    expect(store.doc.paint[k]).toBe('rA');
    store.eraseSelection();
    expect(k in store.doc.paint).toBe(false);
    expect(kinds(store)).toEqual(['paint', 'paint', 'paint']);
    store.paintSelection();
    store.setActiveRule(null);
    store.paintSelection();
    expect(store.getState().notice?.text).toMatch(/先选一种颜色/);
  });

  it('选法：整行 / 框选两个角 / 反选', () => {
    const { store } = setup();
    store.setSelMode('row');
    store.clickCell(2, 1);
    expect(store.getState().selection).toEqual([0, 1, 2, 3].map((b) => keyOf(store, 2, b)));
    store.setSelMode('box');
    store.clickCell(1, 0);
    store.clickCell(2, 1);
    expect(store.getState().selection).toEqual([keyOf(store, 1, 0), keyOf(store, 1, 1), keyOf(store, 2, 0), keyOf(store, 2, 1)]);
    store.toggleInvert();
    store.clickCell(1, 0);
    expect(store.getState().selection).toEqual([keyOf(store, 1, 1), keyOf(store, 2, 0), keyOf(store, 2, 1)]);
    store.clearSelection();
    expect(store.getState().selection).toEqual([]);
  });
});

describe('EditorStore：颜色规则', () => {
  it('两种颜色定成同一个韵：一步自动合并，格子改成先建的颜色，提示「合并」；撤销一次两种颜色和涂色都回来', () => {
    const { store } = setup();
    store.addRule();
    const id = store.getState().activeRule!;
    expect(store.doc.rules.map((r) => r.id)).toEqual(['rA', 'rB', 'rC', 'rD', id]);
    const k = keyOf(store, 1, 0);
    store.clickCell(1, 0);
    store.paintSelection();
    expect(store.doc.paint[k]).toBe(id);
    store.setRuleCount(id, 2);
    expect(store.doc.rules.find((r) => r.id === id)?.finals).toEqual(['', '']);
    store.setRuleFinal(id, 0, 'u');
    expect(store.doc.rules).toHaveLength(5);
    const before = store.doc;
    const depth = store.getState().history.done.length;

    store.setRuleFinal(id, 1, 'ou'); // 和粉色 rC（u · ou）一样
    expect(store.doc.rules.map((r) => r.id)).toEqual(['rA', 'rB', 'rC', 'rD']);
    expect(store.doc.paint[k]).toBe('rC');
    expect(Object.values(store.doc.paint)).not.toContain(id);
    expect(store.getState().activeRule).toBe('rC');
    expect(store.getState().notice?.text).toMatch(/合并/);
    expect(store.getState().history.done).toHaveLength(depth + 1);
    expect(store.getState().history.undoLabel).toMatch(/合并/);

    store.undo();
    expect(store.doc).toBe(before);
    expect(store.doc.rules.find((r) => r.id === id)?.finals).toEqual(['u', '']);
    expect(store.doc.paint[k]).toBe(id);
  });

  it('删掉一种颜色：它的格子不再涂色；押数改了韵母框跟着变', () => {
    const { store } = setup();
    store.setRuleCount('rB', 2);
    expect(store.doc.rules.find((r) => r.id === 'rB')?.finals).toEqual(['', 'ai']);
    store.removeRule('rB');
    expect(store.doc.rules.map((r) => r.id)).toEqual(['rA', 'rC', 'rD']);
    expect(Object.values(store.doc.paint)).not.toContain('rB');
    expect(kinds(store)).toEqual(['paint', 'paint']);
  });

  it('最多 8 种颜色', () => {
    const { store } = setup();
    for (let i = 0; i < 4; i++) store.addRule();
    expect(store.doc.rules).toHaveLength(8);
    store.addRule();
    expect(store.doc.rules).toHaveLength(8);
    expect(store.getState().notice?.text).toMatch(/8/);
  });
});

describe('EditorStore：换伴奏', () => {
  const info = { name: '新伴奏.mp3', bpm: 100, durationSec: 120, firstBeatMs: 200 };

  it('BPM 不一样且已经写了字：先弹窗（默认推荐改用新 BPM），不改任何东西', () => {
    const { store } = setup();
    const doc = store.doc;
    store.requestBeat(info);
    const pending = store.getState().beatSwap!;
    expect(pending).toMatchObject({ name: '新伴奏.mp3', bpm: 100 });
    expect(pending.plan.recommended).toBe('adopt');
    expect(pending.plan).toMatchObject({ oldBpm: 92, newBpm: 100, keep: { bpm: 92 }, adopt: { bpm: 100, rate: 1 } });
    expect(pending.plan.keep.rate).toBeCloseTo(0.92, 9);
    expect(store.doc).toBe(doc);
    expect(store.getState().history.done).toEqual([]);
  });

  it('改用新 BPM：BPM 100、伴奏原速，每个字的 tick 不动；记一步「换伴奏」', () => {
    const { store } = setup();
    const grid = store.grid;
    store.requestBeat(info);
    store.confirmBeatSwap('adopt');
    expect(store.getState().beatSwap).toBeNull();
    expect(store.doc.bpm).toBe(100);
    expect(store.doc.beat).toEqual({ name: '新伴奏.mp3', bpm: 100, rate: 1, durationSec: 120 });
    expect(store.doc.offsetMs).toBe(200);
    expect(store.grid).toBe(grid);
    expect(kinds(store)).toEqual(['beat']);
    store.undo();
    expect(store.doc).toMatchObject({ bpm: 92, beat: null, offsetMs: 120 });
  });

  it('保留原 BPM：还是 92，新伴奏按 0.92 倍速放，首拍偏移按变速换算', () => {
    const { store } = setup();
    const before = allWords(store.grid).map((w) => [w.abs, w.word.len]);
    store.requestBeat(info);
    store.confirmBeatSwap('keep');
    expect(store.doc.bpm).toBe(92);
    expect(store.doc.beat?.rate).toBeCloseTo(0.92, 9);
    expect(store.doc.beat?.bpm).toBe(100);
    expect(store.doc.offsetMs).toBe(Math.round(200 / 0.92));
    expect(allWords(store.grid).map((w) => [w.abs, w.word.len])).toEqual(before);
    expect(kinds(store)).toEqual(['beat']);
  });

  it('取消：什么都不变', () => {
    const { store } = setup();
    const doc = store.doc;
    store.requestBeat(info);
    store.cancelBeatSwap();
    expect(store.getState().beatSwap).toBeNull();
    expect(store.doc).toBe(doc);
    expect(store.getState().history.done).toEqual([]);
    store.confirmBeatSwap('adopt'); // 弹窗已经关了：不做
    expect(store.doc).toBe(doc);
  });

  it('空工程（还没有字）：不弹窗，直接换成新伴奏的 BPM', () => {
    const { store } = setup();
    store.newProject();
    expect(store.doc.bpm).toBe(92); // 新工程沿用当前 BPM
    store.requestBeat(info);
    expect(store.getState().beatSwap).toBeNull();
    expect(store.doc.bpm).toBe(100);
    expect(store.doc.beat).toMatchObject({ name: '新伴奏.mp3', rate: 1 });
    expect(kinds(store)).toEqual(['beat']);
    store.removeBeat();
    expect(store.doc.beat).toBeNull();
    expect(kinds(store)).toEqual(['beat', 'beat']);
  });

  it('BPM 夹在 40–220；首拍偏移 0–5000ms', () => {
    const { store } = setup();
    store.setBpm(500);
    expect(store.doc.bpm).toBe(220);
    store.setBpm(Number.NaN);
    expect(store.doc.bpm).toBe(220);
    store.setOffsetMs(-10);
    expect(store.doc.offsetMs).toBe(0);
    expect(kinds(store)).toEqual(['edit', 'edit']);
  });
});

describe('EditorStore：AI 结果上屏前逐字比对', () => {
  it('一次填韵：只填涂了色、还没写字的格子，作为一步「AI 改写」', () => {
    const { store } = setup();
    fillableProject(store);
    const depth = store.getState().history.done.length;
    const r = store.applyAiFill([{ abs: 12, text: '方' }]);
    expect(r).toEqual({ ok: true, violations: [] });
    expect(layout(store, 0)).toEqual([
      [0, 12, ''],
      [12, 12, '方'],
    ]);
    expect(store.getState().history.done).toHaveLength(depth + 1);
    expect(kinds(store).at(-1)).toBe('ai');
    store.undo();
    expect(textAt(store, 12)).toBe('');
  });

  it('一次填韵：答案还写了别的位置 → 整份作废，表格不动', () => {
    const { store } = setup();
    fillableProject(store);
    const doc = store.doc;
    const depth = store.getState().history.done.length;
    const r = store.applyAiFill([
      { abs: 12, text: '方' },
      { abs: at(1, 12), text: '场' }, // 第 2 小节已经写了字，不该填
    ]);
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.abs)).toContain(at(1, 12));
    expect(store.doc).toBe(doc);
    expect(store.getState().history.done).toHaveLength(depth);
    expect(store.getState().notice?.text).toMatch(/作废/);
  });

  it('选区润色：保持骨架只换字，选区外 / 改落点的整份作废', () => {
    const { store } = setup();
    fillableProject(store);
    const scope = [keyOf(store, 0, 0)];
    expect(store.applyAiPolish(scope, DEFAULT_POLISH, { texts: [{ abs: 0, text: '远' }, { abs: 12, text: '方' }] }).ok).toBe(true);
    expect(barText(store, 0)).toBe('远方');
    expect(kinds(store).at(-1)).toBe('ai');

    const doc = store.doc;
    const outside = store.applyAiPolish(scope, DEFAULT_POLISH, { texts: [{ abs: 0, text: '前' }, { abs: at(1, 0), text: '你' }] });
    expect(outside.ok).toBe(false);
    expect(outside.violations).toEqual([expect.objectContaining({ abs: at(1, 0), reason: 'outside' })]);
    const skeleton = store.applyAiPolish(scope, DEFAULT_POLISH, { texts: [{ abs: 6, text: '的' }] });
    expect(skeleton.ok).toBe(false);
    expect(skeleton.violations.some((v) => v.reason === 'skeleton')).toBe(true);
    expect(store.doc).toBe(doc);
  });

  it('选区润色：锁住的字被改了也整份作废', () => {
    const { store } = setup();
    store.clickCell(1, 0);
    store.lockCells(true);
    const doc = store.doc;
    const r = store.applyAiPolish([keyOf(store, 1, 0)], DEFAULT_POLISH, { texts: [{ abs: at(1, 0), text: '早' }] });
    expect(r.ok).toBe(false);
    expect(r.violations[0].reason).toBe('locked');
    expect(store.doc).toBe(doc);
  });
});

describe('EditorStore：小节 / 段落 / 作品库', () => {
  it('加删小节、加段落（同类自动编号）、改类型、复制、删除', () => {
    const { store } = setup();
    store.deleteBar(0); // Intro 只有一小节
    expect(store.getState().notice?.text).toMatch(/至少留一个小节/);
    store.addBar(0);
    expect(store.grid.sections[0].bars).toHaveLength(2);
    store.deleteBar(1);
    expect(store.grid.sections[0].bars).toHaveLength(1);
    store.addSection('verse');
    expect(store.grid.sections.map((s) => s.label)).toEqual(['Intro', 'Verse 1', 'Hook', 'Verse 2']);
    store.setSectionKind(3, 'outro');
    expect(store.grid.sections[3].label).toBe('Outro');
    store.duplicateSection(2);
    expect(store.grid.sections.map((s) => s.label)).toEqual(['Intro', 'Verse 1', 'Hook 1', 'Hook 2', 'Outro']);
    expect(barText(store, 9)).toBe(barText(store, 5)); // Hook 2 的第一小节 = Hook 1 的第一小节
    store.deleteSection(4);
    expect(store.grid.sections).toHaveLength(4);
    expect(kinds(store)).toEqual(['flow', 'flow', 'edit', 'edit', 'edit', 'edit']);
  });

  it('新建 / 打开 / 改名 / 另存 / 删除 / 导入工程文件', () => {
    const { store, library } = setup();
    const first = store.getState().projectId;
    store.commitText(at(1, 0), '早');
    store.newProject();
    expect(store.getState().name).toBe('未命名 1');
    expect(store.getState().history.done).toEqual([]);
    expect(store.grid.sections.map((s) => s.label)).toEqual(['Verse 1']);
    store.renameProject(first, '夜车 v2');
    expect(library.list().find((m) => m.id === first)?.name).toBe('夜车 v2');
    store.openProject(first);
    expect(store.getState().name).toBe('夜车 v2');
    expect(textAt(store, at(1, 0))).toBe('早');
    store.saveAs('夜车 副本');
    expect(store.getState().projectId).not.toBe(first);
    expect(store.getState().name).toBe('夜车 副本');
    expect(textAt(store, at(1, 0))).toBe('早');

    expect(store.importProjectFile(serializeProject(emptyProject('导入的歌', 5)))).toBe(true);
    expect(store.getState().name).toBe('导入的歌');
    expect(store.importProjectFile(V2_NIGHT_DRIVE)).toBe(true); // 旧版 v2 也认
    expect(store.grid.sections.map((s) => s.label)).toEqual(['Verse 1', 'Hook', 'Verse 2']);
    expect(store.importProjectFile('{坏的')).toBe(false);
    expect(store.getState().notice?.text).toMatch(/导入失败/);

    const id = store.getState().projectId;
    store.deleteProject(id);
    expect(library.list().some((m) => m.id === id)).toBe(false);
    expect(store.getState().projectId).not.toBe(id);
  });

  it('打开示例「街头节奏」', () => {
    const { store } = setup();
    store.openExample('street');
    expect(store.getState().name).toBe('街头节奏');
    expect(barText(store, 0)).toBe('我走在街上感受节奏');
  });

  it('订阅：每次改动都通知', () => {
    const { store } = setup();
    let n = 0;
    const off = store.subscribe(() => (n += 1));
    store.commitText(at(1, 0), '早');
    expect(n).toBeGreaterThan(0);
    off();
    const m = n;
    store.undo();
    expect(n).toBe(m);
  });
});

describe('EditorStore v3.1：双击改一拍的字，绝不写进下一拍', () => {
  /** 第 global 小节第 beat 拍的字：[拍内起点, 长度, 字] */
  const beatLayout = (store: EditorStore, global: number, beat: number) =>
    barAt(store.grid, global)!.words.filter((w) => Math.floor(w.tick / 48) === beat).map((w) => [w.tick % 48, w.len, w.text]);
  const othersOf = (store: EditorStore, global: number, beat: number) =>
    JSON.stringify(allWords(store.grid).filter((x) => !(x.global === global && Math.floor(x.word.tick / 48) === beat)).map((x) => [x.abs, x.word.len, x.word.text]));

  it('双击进入改字；位置够按原节奏填，不够就平分；别的拍逐字节不变；一次回车一步、可撤销', () => {
    const { store } = setup();
    store.editCell(1, 1);
    expect(store.getState().editing).toEqual({ key: keyOf(store, 1, 1), global: 1, beat: 1 });
    expect(store.getState().selection).toEqual([keyOf(store, 1, 1)]);
    const others = othersOf(store, 1, 1);
    // 「街灯 在」3 个位置打 3 个字：节奏不变
    expect(store.commitBeatText(1, 1, '灯火亮')).toBe(true);
    expect(store.getState().editing).toBeNull();
    expect(beatLayout(store, 1, 1)).toEqual([
      [0, 12, '灯'],
      [12, 12, '火'],
      [36, 12, '亮'],
    ]);
    // 打 4 个字：平分成 1/16
    expect(store.commitBeatText(1, 1, '走 得太慢')).toBe(true);
    expect(beatLayout(store, 1, 1)).toEqual([
      [0, 12, '走'],
      [12, 12, '得'],
      [24, 12, '太'],
      [36, 12, '慢'],
    ]);
    expect(othersOf(store, 1, 1)).toBe(others);
    expect(kinds(store)).toEqual(['fill', 'fill']);
    expect(store.getState().history.undoLabel).toBe('填字 第 2 小节第 2 拍「走得太慢」');
    store.undo();
    expect(beatLayout(store, 1, 1).map((x) => x[2]).join('')).toBe('灯火亮');
  });

  it('位置不够又超过 4 个字：什么都不写、不进历史，提示去第 1 步分细', () => {
    const { store } = setup();
    const before = JSON.stringify(allWords(store.grid).map((x) => [x.abs, x.word.len, x.word.text]));
    expect(store.commitBeatText(1, 0, '一二三四五六')).toBe(false);
    expect(JSON.stringify(allWords(store.grid).map((x) => [x.abs, x.word.len, x.word.text]))).toBe(before);
    expect(store.getState().notice?.text).toMatch(/一拍最多 4 个字.*铺 flow/);
    expect(kinds(store)).toEqual([]);
    expect(store.beatTextPlan(1, 0, '一二三四五六')).toEqual({ n: 6, slots: 4, how: 'too-many' });
    expect(store.beatTextPlan(1, 0, '一二')).toEqual({ n: 2, slots: 4, how: 'fill' });
    expect(store.beatTextPlan(0, 0, '一二三')).toEqual({ n: 3, slots: 0, how: 'split' });
    expect(store.beatTextPlan(1, 0, '')).toEqual({ n: 0, slots: 4, how: 'clear' });
  });

  it('空拍里打 1 / 2 / 3 个字：1/4、1/8、三连', () => {
    const { store } = setup();
    store.commitBeatText(0, 0, '走');
    store.commitBeatText(0, 1, '夜色');
    store.commitBeatText(0, 2, '慢慢走');
    expect(beatLayout(store, 0, 0)).toEqual([[0, 48, '走']]);
    expect(beatLayout(store, 0, 1)).toEqual([
      [0, 24, '夜'],
      [24, 24, '色'],
    ]);
    expect(beatLayout(store, 0, 2).map((x) => x[0])).toEqual([0, 16, 32]);
    expect(beatLayout(store, 0, 3).map((x) => x[2]).join('')).toBe('走吧');
  });

  it('这一拍锁着：位置不够时不重排，提示先解锁', () => {
    const { store } = setup();
    store.clickCell(1, 1);
    store.lockCells(true);
    expect(store.commitBeatText(1, 1, '走得太慢')).toBe(false);
    expect(store.getState().notice?.text).toMatch(/锁住.*先解锁.*3 个字以内/);
    expect(beatLayout(store, 1, 1).map((x) => x[2]).join('')).toBe('街灯在');
    expect(store.beatTextPlan(1, 1, '走得太慢').how).toBe('locked');
  });

  it('选中字按回车：改它所在的那一拍', () => {
    const { store } = setup();
    store.startEdit(at(1, 60));
    expect(store.getState().editing).toMatchObject({ global: 1, beat: 1 });
    store.cancelEdit();
    expect(store.getState().editing).toBeNull();
  });
});

describe('EditorStore v3.1：点拍头选整列、加段落、打开在哪一步', () => {
  it('点拍头：只选这一拍里有东西的格子（跨段落），空格子不选；不改选法；点格子后拍头不再高亮', () => {
    const { store } = setup();
    store.addSection('outro'); // 后面加一段空的
    store.selectColumn(2);
    const s = store.getState();
    expect(s.selection).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((g) => keyOf(store, g, 2)));
    expect(s.selColumn).toBe(2);
    expect(s.selMode).toBe('cell');
    store.clickCell(3, 0);
    expect(store.getState().selection).toEqual([keyOf(store, 3, 0)]);
    expect(store.getState().selColumn).toBeNull();
    store.selectRow(2);
    expect(store.getState().selMode).toBe('cell');
    store.clickCell(5, 1);
    expect(store.getState().selection).toEqual([keyOf(store, 5, 1)]);
  });

  it('只有拖音的格子也算这一列里有东西；整首这一拍都空时选全部（空作品也能锁整列）', () => {
    const { store } = setup();
    store.selectColumn(1);
    expect(store.getState().selection).toContain(keyOf(store, 6, 1)); // 「门」拖过来
    store.newProject();
    store.selectColumn(0);
    const bars = store.grid.sections.flatMap((x) => x.bars).length;
    expect(bars).toBeGreaterThan(0);
    expect(store.getState().selection).toHaveLength(bars);
    store.lockColumns(true);
    expect(store.doc.locks.beats).toEqual([0]);
  });

  it('加段落可以选 Intro / Verse / Hook / Bridge / Outro，同类型自动编号', () => {
    const { store } = setup();
    for (const k of ['intro', 'verse', 'hook', 'bridge', 'outro'] as const) store.addSection(k);
    expect(store.grid.sections.map((x) => x.kind).slice(-5)).toEqual(['intro', 'verse', 'hook', 'bridge', 'outro']);
    expect(store.grid.sections.map((x) => x.label)).toEqual(['Intro 1', 'Verse 1', 'Hook 1', 'Intro 2', 'Verse 2', 'Hook 2', 'Bridge', 'Outro']);
  });

  it('打开作品：写过字的在第 2 步；一个字都没写的（包括只铺了位置）在第 1 步', () => {
    const { store } = setup();
    expect(store.getState().step).toBe(2);
    store.newProject();
    expect(store.getState().step).toBe(1);
    store.flowClick(0);
    store.flush();
    const id = store.getState().projectId;
    store.setStep(2);
    store.newProject();
    store.openProject(id);
    expect(store.getState().projectId).toBe(id);
    expect(store.getState().step).toBe(1);
  });
});
