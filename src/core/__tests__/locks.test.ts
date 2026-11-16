import { describe, expect, it } from 'vitest';
import {
  allWords,
  cellKey,
  createBar,
  createGrid,
  createSection,
  createWord,
  deleteBars,
  insertBars,
  insertWord,
  removeWords,
  resizeWord,
  setWordText,
  wordStartingAt,
  type Grid,
  type Word,
} from '../grid';
import {
  checkChanges,
  emptyLocks,
  hasAnyLock,
  isCellLocked,
  lockedWordTicks,
  pruneLocks,
  setBarLocks,
  setBeatLocks,
  setCellLocks,
  setRhymeLock,
  type CheckOptions,
  type LockContext,
} from '../locks';
import { applyPolish, applyRhymeFill, buildPolishRequest, DEFAULT_POLISH, planRhymeFill } from '../aiEdit';
import { createRule } from '../rhymeRules';

const w = (tick: number, len: number, text = '') => createWord({ tick, len, text });

function build(rows: Word[][]): Grid {
  return createGrid([{ ...createSection('verse', 0), bars: rows.map((ws) => createBar(ws)) }]);
}

const shape = (g: Grid) => allWords(g).map((x) => `${x.abs}:${x.word.text}/${x.word.len}`);
const idAt = (g: Grid, abs: number) => wordStartingAt(g, abs)!.word.id;
const textAt = (g: Grid, abs: number) => wordStartingAt(g, abs)?.word.text;
const setText = (g: Grid, abs: number, text: string) => setWordText(g, idAt(g, abs), text);

/**
 * 第 0 小节：我来 | 路口（口拖到第 2 拍） | 空 | 方
 * 第 1 小节：不走 | 场 | 在 | 来
 * 第 0 小节第 1 拍涂了单押 ou → 韵脚字是「口」
 */
const g = build([
  [w(0, 12, '我'), w(12, 12, '来'), w(48, 12, '路'), w(60, 36, '口'), w(144, 48, '方')],
  [w(0, 24, '不'), w(24, 24, '走'), w(48, 48, '场'), w(96, 48, '在'), w(144, 48, '来')],
]);
const [b0, b1] = g.sections[0].bars.map((b) => b.id);
const ruleOu = createRule([], { count: 1, finals: ['ou'] })!;
const base: LockContext = { locks: emptyLocks(), rules: [ruleOu], paint: { [cellKey(b0, 1)]: ruleOu.id } };
const opts = (scope: string[], extra: Partial<CheckOptions> = {}): CheckOptions => ({ ...base, scope: new Set(scope), keepSkeleton: true, ...extra });

describe('四种锁', () => {
  it('整行、整列、单格锁都会锁住格子', () => {
    const byBar = setBarLocks(emptyLocks(), [b0], true);
    expect(isCellLocked(byBar, b0, 2)).toBe(true);
    expect(isCellLocked(byBar, b1, 2)).toBe(false);

    const byBeat = setBeatLocks(emptyLocks(), [2], true);
    expect(isCellLocked(byBeat, b1, 2)).toBe(true);
    expect(isCellLocked(byBeat, b1, 1)).toBe(false);

    const byCell = setCellLocks(emptyLocks(), [cellKey(b1, 3)], true);
    expect(isCellLocked(byCell, b1, 3)).toBe(true);
    expect(isCellLocked(byCell, b0, 3)).toBe(false);
  });

  it('开关锁：关掉后解锁，整列按拍排序，韵脚锁没变时返回原对象', () => {
    const l = setBarLocks(setBarLocks(emptyLocks(), [b0, b1], true), [b0], false);
    expect(l.bars).toEqual([b1]);
    expect(setBeatLocks(emptyLocks(), [3, 1], true).beats).toEqual([1, 3]);
    expect(setCellLocks(setCellLocks(emptyLocks(), ['x:1'], true), ['x:1'], false).cells).toEqual([]);
    const off = emptyLocks();
    expect(setRhymeLock(off, false)).toBe(off);
    expect(setRhymeLock(off, true).rhyme).toBe(true);
  });

  it('hasAnyLock', () => {
    expect(hasAnyLock(emptyLocks())).toBe(false);
    expect(hasAnyLock(setRhymeLock(emptyLocks(), true))).toBe(true);
    expect(hasAnyLock(setBeatLocks(emptyLocks(), [0], true))).toBe(true);
  });

  it('pruneLocks 去掉指向已删除小节的锁', () => {
    const locks = setCellLocks(setBarLocks(emptyLocks(), [b0, b1], true), [cellKey(b1, 3), cellKey(b0, 1)], true);
    const pruned = pruneLocks(deleteBars(g, 0, 1, 1), locks);
    expect(pruned.bars).toEqual([b0]);
    expect(pruned.cells).toEqual([cellKey(b0, 1)]);
    expect(pruneLocks(g, locks)).toBe(locks);
  });

  it('lockedWordTicks：锁住格子里的字 + 锁韵脚时的韵脚字', () => {
    const cell = { ...base, locks: setCellLocks(emptyLocks(), [cellKey(b0, 0)], true) };
    expect([...lockedWordTicks(g, cell)].sort((a, b) => a - b)).toEqual([0, 12]);
    const rhyme = { ...base, locks: setRhymeLock(emptyLocks(), true) };
    expect([...lockedWordTicks(g, rhyme)]).toEqual([60]);
  });
});

describe('checkChanges：逐字比对', () => {
  it('选区内只换字：通过', () => {
    const r = checkChanges(g, setText(g, 0, '你'), opts([cellKey(b0, 0)]));
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.changes.map((c) => [c.bar, c.beat, c.abs, c.before, c.after])).toEqual([[0, 0, 0, '我', '你']]);
  });

  it('没有改动：通过', () => {
    const r = checkChanges(g, g, opts([]));
    expect(r.ok).toBe(true);
    expect(r.changes).toEqual([]);
  });

  it('任何一处改到选区外：整份不通过（outside）', () => {
    const after = setText(setText(g, 0, '你'), 192, '别');
    const r = checkChanges(g, after, opts([cellKey(b0, 0)]));
    expect(r.ok).toBe(false);
    expect(r.changes).toHaveLength(2);
    expect(r.violations.map((v) => [v.abs, v.reason])).toEqual([[192, 'outside']]);
    // 选区为空 = 哪里都不许改
    expect(checkChanges(g, setText(g, 0, '你'), opts([])).ok).toBe(false);
  });

  it('锁定的格子：整行 / 整列 / 单格都不通过（locked）', () => {
    const after = setText(g, 0, '你');
    for (const locks of [setCellLocks(emptyLocks(), [cellKey(b0, 0)], true), setBarLocks(emptyLocks(), [b0], true), setBeatLocks(emptyLocks(), [0], true)]) {
      const r = checkChanges(g, after, opts([cellKey(b0, 0)], { locks }));
      expect(r.ok).toBe(false);
      expect(r.violations.map((v) => v.reason)).toEqual(['locked']);
    }
  });

  it('锁定的格子里加字也不行', () => {
    const locks = setCellLocks(emptyLocks(), [cellKey(b0, 0)], true);
    const r = checkChanges(g, insertWord(g, 24, 12, '新'), opts([cellKey(b0, 0)], { locks, keepSkeleton: false }));
    expect(r.violations.map((v) => [v.abs, v.reason])).toEqual([[24, 'locked']]);
  });

  it('锁了韵脚位置：韵脚字不许改，同格的非韵脚字可以改', () => {
    const locks = setRhymeLock(emptyLocks(), true);
    const bad = checkChanges(g, setText(g, 60, '走'), opts([cellKey(b0, 1)], { locks }));
    expect(bad.ok).toBe(false);
    expect(bad.violations.map((v) => [v.abs, v.reason])).toEqual([[60, 'locked']]);
    expect(checkChanges(g, setText(g, 48, '街'), opts([cellKey(b0, 1)], { locks })).ok).toBe(true);
  });

  it('保持骨架：改长度、加字、删字都不通过（skeleton）；关掉保持骨架就可以', () => {
    const scope = [cellKey(b0, 0)];
    const variants = [resizeWord(g, idAt(g, 0), 6), insertWord(g, 24, 12, '新'), removeWords(g, [idAt(g, 12)])];
    for (const after of variants) {
      const r = checkChanges(g, after, opts(scope));
      expect(r.ok).toBe(false);
      expect(r.violations.every((v) => v.reason === 'skeleton')).toBe(true);
      expect(checkChanges(g, after, opts(scope, { keepSkeleton: false })).ok).toBe(true);
    }
  });

  it('小节结构变了：不通过（structure）', () => {
    const all = [0, 1, 2, 3].flatMap((beat) => [cellKey(b0, beat), cellKey(b1, beat)]);
    const r = checkChanges(g, insertBars(g, 0, 2), opts(all, { keepSkeleton: false }));
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.reason)).toEqual(['structure']);
    const sec = g.sections[0];
    const renamed: Grid = { sections: [{ ...sec, bars: [{ ...sec.bars[0], id: 'other' }, sec.bars[1]] }] };
    expect(checkChanges(g, renamed, opts(all, { keepSkeleton: false })).violations[0].reason).toBe('structure');
  });
});

describe('一次填韵', () => {
  /**
   * 第 0 小节第 3 拍：两个空字，涂双押 u/ou → 两个都要填
   * 第 1 小节第 1 拍：两个空字，涂单押 ang → 只填最后一个
   * 第 1 小节第 3 拍：已经写了「不」，涂双押 → 整格跳过
   * 第 2 小节第 0 拍：没涂色；第 3 拍涂单押 ang 但锁了格子
   */
  const fg = build([
    [w(0, 12, '我'), w(12, 36, '想'), w(144, 24), w(168, 24)],
    [w(48, 12), w(60, 36), w(144, 24, '不'), w(168, 24)],
    [w(0, 12), w(144, 48)],
    [],
  ]);
  const [f0, f1, f2] = fg.sections[0].bars.map((b) => b.id);
  const r1 = createRule([], { count: 1, finals: ['ang'] })!;
  const r2 = createRule([r1], { count: 2, finals: ['u', 'ou'] })!;
  const paint = { [cellKey(f0, 3)]: r2.id, [cellKey(f1, 1)]: r1.id, [cellKey(f1, 3)]: r2.id, [cellKey(f2, 3)]: r1.id };
  const ctx: LockContext = { locks: setCellLocks(emptyLocks(), [cellKey(f2, 3)], true), rules: [r1, r2], paint };

  it('planRhymeFill 只给涂了色、一个字都没写的格子里的韵脚位置，跳过锁定位置', () => {
    expect(planRhymeFill(fg, ctx)).toEqual([
      { key: cellKey(f0, 3), abs: 144, want: 'u' },
      { key: cellKey(f0, 3), abs: 168, want: 'ou' },
      { key: cellKey(f1, 1), abs: 192 + 60, want: 'ang' },
    ]);
    // 不锁格子时第 2 小节第 3 拍也要填
    expect(planRhymeFill(fg, { ...ctx, locks: emptyLocks() }).map((t) => t.abs)).toEqual([144, 168, 252, 384 + 144]);
    // 锁了全部韵脚位置就一个都不填
    expect(planRhymeFill(fg, { ...ctx, locks: setRhymeLock(emptyLocks(), true) })).toEqual([]);
  });

  it('applyRhymeFill 填进要填的位置，别的字不动', () => {
    const r = applyRhymeFill(fg, ctx, [
      { abs: 144, text: '路' },
      { abs: 168, text: '口' },
      { abs: 252, text: ' 方向 ' },
    ]);
    expect(r.ok).toBe(true);
    expect([144, 168, 252].map((a) => textAt(r.grid, a))).toEqual(['路', '口', '方']);
    expect(shape(r.grid).filter((s) => !/^(144|168|252):/.test(s))).toEqual(shape(fg).filter((s) => !/^(144|168|252):/.test(s)));
  });

  it('只填一部分也可以', () => {
    const r = applyRhymeFill(fg, ctx, [{ abs: 168, text: '口' }]);
    expect(r.ok).toBe(true);
    expect(textAt(r.grid, 168)).toBe('口');
    expect(textAt(r.grid, 144)).toBe('');
  });

  it('写到已经有字的格子：整份作废，返回原网格', () => {
    const r = applyRhymeFill(fg, ctx, [
      { abs: 144, text: '路' },
      { abs: 192 + 168, text: '走' },
    ]);
    expect(r.ok).toBe(false);
    expect(r.grid).toBe(fg);
    expect(r.check.violations.map((v) => v.abs)).toContain(192 + 168);
  });

  it('写到同格的非韵脚字：整份作废', () => {
    const r = applyRhymeFill(fg, ctx, [
      { abs: 144, text: '路' },
      { abs: 192 + 48, text: '光' },
    ]);
    expect(r.ok).toBe(false);
    expect(r.grid).toBe(fg);
    expect(r.check.violations.map((v) => v.abs)).toContain(192 + 48);
  });

  it('写到锁定位置、没涂色的格子、空白处：整份作废', () => {
    for (const abs of [384 + 144, 384, 576]) {
      const r = applyRhymeFill(fg, ctx, [
        { abs: 144, text: '路' },
        { abs, text: '啊' },
      ]);
      expect(r.ok).toBe(false);
      expect(r.grid).toBe(fg);
    }
  });
});

describe('选区润色', () => {
  const scope = new Set([cellKey(b0, 0), cellKey(b0, 1)]);
  const ctx: LockContext = { ...base, locks: emptyLocks() };

  it('默认保持骨架、不许改 flow', () => {
    expect(DEFAULT_POLISH).toEqual({ keepSkeleton: true, allowFlow: false });
  });

  it('保持骨架：选区内换字通过', () => {
    const r = applyPolish(g, ctx, scope, DEFAULT_POLISH, {
      texts: [
        { abs: 0, text: '你' },
        { abs: 60, text: '头' },
      ],
    });
    expect(r.ok).toBe(true);
    expect(shape(r.grid).slice(0, 5)).toEqual(['0:你/12', '12:来/12', '48:路/12', '60:头/36', '144:方/48']);
  });

  it('改到选区外的字：整份作废，表格不变', () => {
    const r = applyPolish(g, ctx, scope, DEFAULT_POLISH, {
      texts: [
        { abs: 0, text: '你' },
        { abs: 144, text: '光' },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.grid).toBe(g);
    expect(r.check.violations.map((v) => [v.abs, v.reason])).toEqual([[144, 'outside']]);
  });

  it('改到锁定的字：整份作废', () => {
    const cellLocked = { ...ctx, locks: setCellLocks(emptyLocks(), [cellKey(b0, 0)], true) };
    const r = applyPolish(g, cellLocked, scope, DEFAULT_POLISH, {
      texts: [
        { abs: 0, text: '你' },
        { abs: 48, text: '街' },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.grid).toBe(g);
    expect(r.check.violations.map((v) => [v.abs, v.reason])).toEqual([[0, 'locked']]);

    const rhymeLocked = { ...ctx, locks: setRhymeLock(emptyLocks(), true) };
    const r2 = applyPolish(g, rhymeLocked, scope, DEFAULT_POLISH, { texts: [{ abs: 60, text: '头' }] });
    expect(r2.ok).toBe(false);
    expect(r2.grid).toBe(g);
  });

  const reflow = [
    { abs: 0, len: 24, text: '你' },
    { abs: 48, len: 24, text: '街' },
    { abs: 72, len: 24, text: '头' },
    { abs: 144, len: 48, text: '方' },
  ];

  it('保持骨架时 AI 改了 flow：整份作废', () => {
    const r = applyPolish(g, ctx, scope, DEFAULT_POLISH, { words: reflow });
    expect(r.ok).toBe(false);
    expect(r.grid).toBe(g);
    expect(r.check.violations.some((v) => v.reason === 'skeleton')).toBe(true);
  });

  it('允许改 flow：选区内可以挪字、改长度', () => {
    const r = applyPolish(g, ctx, scope, { keepSkeleton: true, allowFlow: true }, { words: reflow });
    expect(r.ok).toBe(true);
    expect(shape(r.grid)).toEqual(['0:你/24', '48:街/24', '72:头/24', '144:方/48', '192:不/24', '216:走/24', '240:场/48', '288:在/48', '336:来/48']);
  });

  it('允许改 flow 也不能动选区外的字', () => {
    const r = applyPolish(g, ctx, scope, { keepSkeleton: false, allowFlow: true }, { words: reflow.slice(0, 3) });
    expect(r.ok).toBe(false);
    expect(r.grid).toBe(g);
    expect(r.check.violations.map((v) => [v.abs, v.reason])).toEqual([[144, 'outside']]);
  });

  it('buildPolishRequest：全文当上下文，只有选区里没锁的字可改；允许改 flow 时不再保持骨架', () => {
    const locked = { ...ctx, locks: setCellLocks(emptyLocks(), [cellKey(b0, 0)], true) };
    const req = buildPolishRequest(g, locked, scope);
    expect(req.context).toEqual(['我来路口方', '不走场在来']);
    expect(req.lines.map((l) => l.bar)).toEqual([0]);
    expect(req.lines[0].words.map((x) => [x.abs, x.editable, x.locked])).toEqual([
      [0, false, true],
      [12, false, true],
      [48, true, false],
      [60, true, false],
      [144, false, false],
    ]);
    expect(req.options).toEqual(DEFAULT_POLISH);
    expect(buildPolishRequest(g, ctx, scope, { keepSkeleton: true, allowFlow: true }).options.keepSkeleton).toBe(false);
  });
});
