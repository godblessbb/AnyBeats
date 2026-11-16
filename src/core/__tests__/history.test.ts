import { describe, expect, it } from 'vitest';
import { createBar, createGrid, createSection, createWord, setWordText } from '../grid';
import { command, History, restoreHistory, serializeHistory, type HistoryStep } from '../history';
import { createProject, docCodec, type Doc, type Project } from '../project';

const add = (n: number) => command<number>(`加 ${n}`, (s) => s + n);

describe('History：一条线', () => {
  it('执行、撤销、重做', () => {
    const h = new History(0);
    h.execute(add(1));
    h.execute(add(2));
    expect(h.state).toBe(3);
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBe(0);
    expect(h.undo()).toBe(0);
    expect(h.redo()).toBe(1);
    expect(h.redo()).toBe(3);
    expect(h.redo()).toBe(3);
  });

  it('撤销之后做新改动：可重做的步骤全部丢掉', () => {
    const h = new History(0);
    h.execute(add(1));
    h.execute(add(2));
    h.undo();
    expect(h.canRedo).toBe(true);
    h.execute(add(10));
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBe(11);
    expect(h.done.map((s) => s.label)).toEqual(['加 1', '加 10']);
    expect(h.redoable).toEqual([]);
  });

  it('每一步记下 kind 和时间（now 可注入），kind 默认 edit', () => {
    let t = 1000;
    const h = new History(0, { now: () => t });
    h.execute(command('填字', (s: number) => s + 1, 'fill'));
    t = 2500;
    h.execute(add(1));
    expect(h.done).toEqual<HistoryStep[]>([
      { label: '填字', kind: 'fill', at: 1000 },
      { label: '加 1', kind: 'edit', at: 2500 },
    ]);
  });

  it('undoLabel / redoLabel 指下一次撤销 / 重做的那一步', () => {
    const h = new History(0);
    expect(h.undoLabel).toBeNull();
    expect(h.redoLabel).toBeNull();
    h.execute(add(1));
    h.execute(command('锁定第 3 小节整行', (s: number) => s + 100, 'lock'));
    expect(h.undoLabel).toBe('锁定第 3 小节整行');
    h.undo();
    expect(h.undoLabel).toBe('加 1');
    expect(h.redoLabel).toBe('锁定第 3 小节整行');
    h.undo();
    expect(h.undoLabel).toBeNull();
    expect(h.redoLabel).toBe('加 1');
  });

  it('命令抛错：状态和历史都不变，可重做的步骤也还在', () => {
    const h = new History(0);
    h.execute(add(1));
    h.execute(add(2));
    h.undo();
    const boom = command<number>('坏命令', () => {
      throw new Error('boom');
    });
    expect(() => h.execute(boom)).toThrow('boom');
    expect(h.state).toBe(1);
    expect(h.depth).toBe(1);
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toBe(3);
  });

  it('没有变化的命令不记一步，也不丢可重做的步骤', () => {
    const h = new History({ n: 1 });
    h.execute(command('改', (s: { n: number }) => ({ n: s.n + 1 })));
    h.undo();
    h.execute(command('什么也不做', (s: { n: number }) => s));
    expect(h.depth).toBe(0);
    expect(h.canRedo).toBe(true);
    expect(h.done).toEqual([]);
  });

  it('超过 limit 丢最早的步骤', () => {
    const h = new History(0, { limit: 3 });
    for (let i = 1; i <= 5; i++) h.execute(add(i));
    expect(h.state).toBe(15);
    expect(h.depth).toBe(3);
    expect(h.done.map((s) => s.label)).toEqual(['加 3', '加 4', '加 5']);
    h.undo();
    h.undo();
    h.undo();
    expect(h.canUndo).toBe(false);
    expect(h.state).toBe(3);

    // 第二个参数也可以直接给数字
    const h2 = new History(0, 2);
    for (let i = 1; i <= 4; i++) h2.execute(add(i));
    expect(h2.depth).toBe(2);
  });

  it('reset 清空历史；fromSnapshot 拒绝不合法的快照', () => {
    const h = new History(0);
    h.execute(add(1));
    h.reset(42);
    expect(h.state).toBe(42);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(() => History.fromSnapshot({ states: [], steps: [], cursor: 0 })).toThrow();
    expect(() => History.fromSnapshot({ states: [1, 2], steps: [], cursor: 0 })).toThrow();
    expect(() => History.fromSnapshot({ states: [1], steps: [], cursor: 1 })).toThrow();
  });
});

// ---------- 序列化 ----------

function toDoc(p: Project): Doc {
  return { bpm: p.bpm, offsetMs: p.offsetMs, beat: p.beat, grid: p.grid, rules: p.rules, paint: p.paint, locks: p.locks };
}

/** 16 小节、每小节 8 个字的作品 */
function songDoc(bars = 16): Doc {
  const rows = Array.from({ length: bars }, () => [0, 24, 48, 72, 96, 120, 144, 168].map((tick) => createWord({ tick, len: 24, text: '啊' })));
  const section = { ...createSection('verse', 0, 'Verse 1'), bars: rows.map((ws) => createBar(ws)) };
  return toDoc(createProject({ grid: createGrid([section]) }));
}

const CHARS = Array.from('一二三四五六七八九十天地人和日月星辰风云');

/** 20 步单字修改，只动前 10 个小节 */
function editedHistory(): History<Doc> {
  let t = 0;
  const h = new History<Doc>(songDoc(), { now: () => (t += 1000) });
  for (let i = 0; i < 20; i++) {
    const bar = i % 10;
    const wordIndex = (i * 3) % 8;
    h.execute(
      command(
        `填字 ${i}`,
        (d: Doc) => {
          const id = d.grid.sections[0].bars[bar].words[wordIndex].id;
          return { ...d, grid: setWordText(d.grid, id, CHARS[i]) };
        },
        'fill',
      ),
    );
  }
  return h;
}

describe('撤销历史的序列化（docCodec）', () => {
  it('存下再恢复：状态、步骤、cursor 都一样，撤销 / 重做照常', () => {
    const h = editedHistory();
    const restored = restoreHistory(serializeHistory(h, docCodec), docCodec);
    const a = h.snapshot();
    const b = restored.snapshot();
    expect(b.cursor).toBe(a.cursor);
    expect(b.steps).toEqual(a.steps);
    expect(b.states).toHaveLength(a.states.length);
    b.states.forEach((s, i) => expect(s).toEqual(a.states[i]));

    expect(restored.undoLabel).toBe('填字 19');
    expect(restored.undo()).toEqual(a.states[19]);
    expect(restored.redo()).toEqual(a.states[20]);
  });

  it('cursor 在中间时恢复后还能重做', () => {
    const h = editedHistory();
    for (let i = 0; i < 7; i++) h.undo();
    const restored = restoreHistory(serializeHistory(h, docCodec), docCodec);
    expect(restored.depth).toBe(13);
    expect(restored.canRedo).toBe(true);
    expect(restored.redoLabel).toBe(h.redoLabel);
    expect(restored.state).toEqual(h.state);
    for (let i = 0; i < 7; i++) restored.redo();
    expect(restored.canRedo).toBe(false);
    expect(restored.state).toEqual(h.snapshot().states[20]);
    while (restored.canUndo) restored.undo();
    expect(restored.state).toEqual(h.snapshot().states[0]);
  });

  it('恢复后各快照共用相同的小节对象', () => {
    const restored = restoreHistory(serializeHistory(editedHistory(), docCodec), docCodec);
    const states = restored.snapshot().states;
    const bars = (i: number) => states[i].grid.sections[0].bars;
    // 第 10–15 小节从没改过：所有快照里是同一个对象
    for (let i = 1; i < states.length; i++) for (let b = 10; b < 16; b++) expect(bars(i)[b]).toBe(bars(0)[b]);
    // 相邻两步只有一个小节不同
    for (let i = 1; i < states.length; i++) {
      const same = bars(i).filter((bar, b) => bar === bars(i - 1)[b]).length;
      expect(same).toBe(15);
    }
  });

  it('字符串表去重：20 步单字修改存下来远小于 20 份作品', () => {
    const h = editedHistory();
    const full = serializeHistory(h, docCodec);
    const one = serializeHistory(new History(h.state), docCodec);
    expect(full.length).toBeLessThan(4 * one.length);
  });

  it('超出 maxChars 从最早的步骤开始丢，当前状态一定保留', () => {
    const h = editedHistory();
    const full = serializeHistory(h, docCodec);

    const trimmed = restoreHistory(serializeHistory(h, docCodec, full.length - 1), docCodec);
    expect(trimmed.depth).toBeGreaterThan(0);
    expect(trimmed.depth).toBeLessThan(20);
    expect(trimmed.state).toEqual(h.state);
    expect(trimmed.done).toEqual(h.done.slice(20 - trimmed.depth));

    const tiny = restoreHistory(serializeHistory(h, docCodec, 1), docCodec);
    expect(tiny.depth).toBe(0);
    expect(tiny.canUndo).toBe(false);
    expect(tiny.state).toEqual(h.state);
  });

  it('cursor 在中间时预算再小也保留当前状态和可重做的步骤', () => {
    const h = editedHistory();
    for (let i = 0; i < 5; i++) h.undo();
    const tiny = restoreHistory(serializeHistory(h, docCodec, 1), docCodec);
    expect(tiny.depth).toBe(0);
    expect(tiny.state).toEqual(h.state);
    expect(tiny.redoable).toEqual(h.redoable);
    for (let i = 0; i < 5; i++) tiny.redo();
    expect(tiny.state).toEqual(h.snapshot().states[20]);
  });

  it('格式不对时抛错', () => {
    expect(() => restoreHistory('{"v":2}', docCodec)).toThrow();
    expect(() => restoreHistory(JSON.stringify({ v: 1, table: [], states: [], steps: [], cursor: 0 }), docCodec)).toThrow();
  });
});
