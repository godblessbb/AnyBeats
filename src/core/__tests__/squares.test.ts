import { describe, expect, it } from 'vitest';
import {
  barAt,
  createGrid,
  createSection,
  createWord,
  defaultBarWords,
  fillRest,
  isBlankFlow,
  mergeSquare,
  resetFlow,
  restSquare,
  splitSquare,
  squareAt,
  squareBox,
  TICKS_PER_BAR,
  typeIntoSquares,
  type Grid,
} from '..';

/** 两小节、每拍一个方格 */
const base = (): Grid => resetFlow(createGrid([createSection('verse', 2, 'Verse 1')]));
const lay = (g: Grid, bar = 0) => barAt(g, bar)!.words.map((w) => [w.tick, w.len, w.text]);
/** 别的拍里起点的字（逐字节比对用） */
const others = (g: Grid, bar: number, beat: number) =>
  JSON.stringify(g.sections.flatMap((s) => s.bars).map((b, gi) => b.words.filter((w) => !(gi === bar && Math.floor(w.tick / 48) === beat))));

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  expect(r.ok).toBe(true);
  return r as Extract<T, { ok: true }>;
}

describe('方格：默认、清空全部 flow', () => {
  it('每拍一个 48 tick 的空方格；resetFlow 保留段落、小节 id，清掉文字和拖音', () => {
    expect(defaultBarWords().map((w) => [w.tick, w.len, w.text])).toEqual([
      [0, 48, ''],
      [48, 48, ''],
      [96, 48, ''],
      [144, 48, ''],
    ]);
    let g = createGrid([createSection('verse', 2, 'Verse 1'), createSection('hook', 1, 'Hook')]);
    const ids = g.sections.map((s) => [s.id, s.label, s.bars.map((b) => b.id)]);
    g = { ...g, sections: g.sections.map((s, i) => (i ? s : { ...s, bars: [{ ...s.bars[0], words: [createWord({ tick: 0, len: 300, text: '我' })] }, s.bars[1]] })) };
    const r = resetFlow(g);
    expect(r.sections.map((s) => [s.id, s.label, s.bars.map((b) => b.id)])).toEqual(ids);
    for (const s of r.sections) for (const b of s.bars) expect(b.words.map((w) => [w.tick, w.len, w.text])).toEqual(defaultBarWords().map((w) => [w.tick, w.len, '']));
    expect(isBlankFlow(r)).toBe(true);
    expect(isBlankFlow(g)).toBe(false);
    expect(isBlankFlow(createGrid())).toBe(true);
  });
});

describe('一分为二 / 三连', () => {
  it('1/4 → 1/8 → 1/16 → 1/32，再分被拒；字留在左边；别的拍不动', () => {
    let g = base();
    g = typeIntoSquares(g, 48, ['我']).grid;
    const keep = others(g, 0, 1);
    g = ok(splitSquare(g, 48, 2)).grid;
    expect(lay(g).filter((w) => (w[0] as number) >= 48 && (w[0] as number) < 96)).toEqual([
      [48, 24, '我'],
      [72, 24, ''],
    ]);
    g = ok(splitSquare(g, 48, 2)).grid;
    g = ok(splitSquare(g, 48, 2)).grid;
    expect(lay(g).filter((w) => (w[0] as number) >= 48 && (w[0] as number) < 96)).toEqual([
      [48, 6, '我'],
      [54, 6, ''],
      [60, 12, ''],
      [72, 24, ''],
    ]);
    expect(splitSquare(g, 48, 2)).toEqual({ ok: false, reason: 'finest' });
    expect(others(g, 0, 1)).toBe(keep);
  });

  it('三连：整拍 → 3 个 16；1/8 → 半拍三连 3 个 8；1/16、三连格再三连被拒；三连格二分 → 8，8 再二分被拒', () => {
    let g = base();
    g = ok(splitSquare(g, 0, 3)).grid;
    expect(lay(g).slice(0, 3)).toEqual([
      [0, 16, ''],
      [16, 16, ''],
      [32, 16, ''],
    ]);
    expect(splitSquare(g, 0, 3)).toEqual({ ok: false, reason: 'triplet' });
    g = ok(splitSquare(g, 0, 2)).grid;
    expect(lay(g).slice(0, 2)).toEqual([
      [0, 8, ''],
      [8, 8, ''],
    ]);
    expect(splitSquare(g, 0, 2)).toEqual({ ok: false, reason: 'finest' });
    g = ok(splitSquare(g, 48, 2)).grid;
    g = ok(splitSquare(g, 72, 3)).grid;
    expect(lay(g).filter((w) => (w[0] as number) >= 48 && (w[0] as number) < 96)).toEqual([
      [48, 24, ''],
      [72, 8, ''],
      [80, 8, ''],
      [88, 8, ''],
    ]);
    g = ok(splitSquare(g, 48, 2)).grid;
    expect(splitSquare(g, 48, 3)).toEqual({ ok: false, reason: 'triplet' });
  });

  it('拖过拍线的长度跟着最后一块走', () => {
    let g = base();
    g = ok(restSquare(g, 48)).grid;
    g = { ...g, sections: [{ ...g.sections[0], bars: [{ ...g.sections[0].bars[0], words: g.sections[0].bars[0].words.map((w) => (w.tick === 0 ? { ...w, len: 72 } : w)) }, g.sections[0].bars[1]] }] };
    expect(squareBox({ tick: 0, len: 72 })).toBe(48);
    g = ok(splitSquare(g, 0, 2)).grid;
    expect(lay(g).slice(0, 2)).toEqual([
      [0, 24, ''],
      [24, 48, ''],
    ]);
  });

  it('没有方格时什么都不做', () => {
    const g = ok(restSquare(base(), 0)).grid;
    expect(splitSquare(g, 0, 2)).toEqual({ ok: false, reason: 'no-square' });
  });
});

describe('空音、合并、空音里打字', () => {
  it('变成空音 = 删掉这个方格；空音里打字放回同样大的方格', () => {
    let g = base();
    g = ok(splitSquare(g, 96, 2)).grid;
    g = ok(restSquare(g, 120)).grid;
    expect(lay(g).filter((w) => (w[0] as number) >= 96 && (w[0] as number) < 144)).toEqual([[96, 24, '']]);
    g = ok(fillRest(g, 120, 24, '光')).grid;
    expect(lay(g).filter((w) => (w[0] as number) >= 96 && (w[0] as number) < 144)).toEqual([
      [96, 24, ''],
      [120, 24, '光'],
    ]);
  });

  it('二分合并：右边空方格 ⌫ 合回左边（字保留）；左边空方格合右边；整拍不能合；另一半更细不能合', () => {
    let g = base();
    g = typeIntoSquares(g, 0, ['我']).grid;
    g = ok(splitSquare(g, 0, 2)).grid;
    const keep = others(g, 0, 0);
    let r = ok(mergeSquare(g, 24));
    expect(lay(r.grid).slice(0, 1)).toEqual([[0, 48, '我']]);
    expect(r.focus).toBe(0);
    expect(others(r.grid, 0, 0)).toBe(keep);
    g = ok(splitSquare(g, 24, 2)).grid; // 0:24 我 | 24:12 | 36:12
    expect(mergeSquare(g, 0)).toEqual({ ok: false, reason: 'finer' });
    r = ok(mergeSquare(g, 36));
    expect(lay(r.grid).slice(0, 2)).toEqual([
      [0, 24, '我'],
      [24, 24, ''],
    ]);
    expect(mergeSquare(base(), 0)).toEqual({ ok: false, reason: 'whole' });
  });

  it('三连三块合成整拍；半拍三连三块合成半拍；和空音合并 = 方格占上空白', () => {
    let g = ok(splitSquare(base(), 0, 3)).grid;
    expect(lay(ok(mergeSquare(g, 16)).grid).slice(0, 1)).toEqual([[0, 48, '']]);
    g = ok(splitSquare(base(), 0, 2)).grid;
    g = ok(splitSquare(g, 24, 3)).grid;
    expect(lay(ok(mergeSquare(g, 40)).grid).slice(0, 2)).toEqual([
      [0, 24, ''],
      [24, 24, ''],
    ]);
    g = ok(splitSquare(base(), 0, 2)).grid;
    g = ok(restSquare(g, 24)).grid;
    expect(lay(ok(mergeSquare(g, 0)).grid).slice(0, 1)).toEqual([[0, 48, '']]);
    // 光标停在空音上按 ⌫：空音和旁边的方格合并
    expect(lay(ok(mergeSquare(g, 24, 24)).grid).slice(0, 1)).toEqual([[0, 48, '']]);
  });

  it('两块都有字不合', () => {
    let g = ok(splitSquare(base(), 0, 2)).grid;
    g = typeIntoSquares(g, 0, ['我', '们']).grid;
    expect(mergeSquare(g, 0)).toEqual({ ok: false, reason: 'both-text' });
  });
});

describe('打字、点哪个方格', () => {
  it('多打的字往后填同一拍里的方格，不写进下一拍', () => {
    let g = ok(splitSquare(base(), 0, 2)).grid;
    const r = typeIntoSquares(g, 0, ['夜', '色', '美']);
    expect(r.written).toBe(2);
    expect(r.dropped).toBe(1);
    g = r.grid;
    expect(lay(g).slice(0, 3)).toEqual([
      [0, 24, '夜'],
      [24, 24, '色'],
      [48, 48, ''],
    ]);
  });

  it('squareAt：点在方格范围里返回它的起点；点在空音 / 拖音上返回 null', () => {
    let g = ok(splitSquare(base(), 0, 2)).grid;
    g = ok(restSquare(g, 24)).grid;
    expect(squareAt(g, 10)).toBe(0);
    expect(squareAt(g, 30)).toBeNull();
    expect(squareAt(g, TICKS_PER_BAR + 100)).toBe(TICKS_PER_BAR + 96);
  });
});
