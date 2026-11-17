import { describe, expect, it } from 'vitest';
import { allWords, barAt, createBar, createGrid, createSection, createWord, setBeatText, TICKS_PER_BAR, type Grid, type Word } from '../grid';

const w = (tick: number, len: number, text = '') => createWord({ tick, len, text });

function build(rows: Word[][]): Grid {
  const sec = createSection('verse', 0, 'Verse 1');
  sec.bars = rows.map((ws) => createBar(ws));
  return createGrid([sec]);
}

/** 一小节里某一拍的字：[拍内起点, 长度, 字] */
const beatOf = (g: Grid, bar: number, beat: number) =>
  barAt(g, bar)!.words.filter((x) => Math.floor(x.tick / 48) === beat).map((x) => [x.tick % 48, x.len, x.text]);
/** 某一拍以外的字（逐字节比对用） */
const outside = (g: Grid, bar: number, beat: number) =>
  JSON.stringify(allWords(g).filter((x) => !(x.global === bar && Math.floor(x.word.tick / 48) === beat)).map((x) => [x.abs, x.word.len, x.word.text, x.word.id]));
const chars = (s: string) => Array.from(s);

describe('setBeatText：打几个字排几个字，永远不碰下一拍', () => {
  // 第 1 小节：第 1 拍「街灯 在」（0、12、36），第 2 拍「风吹过来」，第 3 拍空，第 4 拍「远」拖到第 2 小节第 1 拍中间
  const base = () =>
    build([
      [w(0, 12, '街'), w(12, 12, '灯'), w(36, 12, '在'), w(48, 12, '风'), w(60, 12, '吹'), w(72, 12, '过'), w(84, 12, '来'), w(144, 72, '远')],
      [w(60, 12, '走'), w(72, 12, '吧')],
    ]);

  it('位置够：按原来的节奏依次填，多的位置清空、位置保留', () => {
    const g = base();
    const r = setBeatText(g, 0, 0, chars('灯火亮'));
    expect(r.ok && r.how).toBe('fill');
    if (!r.ok) return;
    expect(beatOf(r.grid, 0, 0)).toEqual([
      [0, 12, '灯'],
      [12, 12, '火'],
      [36, 12, '亮'],
    ]);
    expect(r.written).toEqual([0, 12, 36]);
    const r2 = setBeatText(g, 0, 0, chars('夜'));
    expect(r2.ok && beatOf(r2.grid, 0, 0)).toEqual([
      [0, 12, '夜'],
      [12, 12, ''],
      [36, 12, ''],
    ]);
    expect(outside(r.grid, 0, 0)).toBe(outside(g, 0, 0));
  });

  it('不打字 = 清掉这一拍的文字，位置不动', () => {
    const r = setBeatText(base(), 0, 1, []);
    expect(r.ok && beatOf(r.grid, 0, 1).map((x) => x[2])).toEqual(['', '', '', '']);
  });

  it.each([
    ['走', [[0, 48, '走']]],
    ['夜色', [[0, 24, '夜'], [24, 24, '色']]],
    ['慢慢走', [[0, 16, '慢'], [16, 16, '慢'], [32, 16, '走']]],
    ['不要回头', [[0, 12, '不'], [12, 12, '要'], [24, 12, '回'], [36, 12, '头']]],
  ])('位置不够：空拍里打「%s」→ 平分（1/4、1/8、三连、1/16）', (text, want) => {
    const g = base();
    const r = setBeatText(g, 0, 2, chars(text));
    expect(r.ok && r.how).toBe('split');
    if (!r.ok) return;
    expect(beatOf(r.grid, 0, 2)).toEqual(want);
    expect(outside(r.grid, 0, 2)).toBe(outside(g, 0, 2));
  });

  it('3 个位置打 4 个字：这一拍重新平分成 1/16，下一拍的字逐字节不变', () => {
    const g = base();
    const r = setBeatText(g, 0, 0, chars('走得太慢'));
    expect(r.ok && r.how).toBe('split');
    if (!r.ok) return;
    expect(beatOf(r.grid, 0, 0)).toEqual([
      [0, 12, '走'],
      [12, 12, '得'],
      [24, 12, '太'],
      [36, 12, '慢'],
    ]);
    expect(outside(r.grid, 0, 0)).toBe(outside(g, 0, 0));
    expect(r.written).toEqual([0, 12, 24, 36]);
  });

  it('前一拍拖进来的字截到本拍开头；本拍最后一个字原来拖进下一拍的部分不要了，下一拍的字不变', () => {
    // 第 2 小节第 1 拍：被第 1 小节「远」拖进来（只有拖音），第 2 拍是「走吧」
    const g = base();
    const r = setBeatText(g, 1, 0, chars('我'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 「远」原来拖到第 2 小节 tick 24，现在截到第 2 小节开头；「我」占满第 2 小节第 1 拍
    const yuan = allWords(r.grid).find((x) => x.word.text === '远')!;
    expect(yuan.abs + yuan.word.len).toBe(TICKS_PER_BAR);
    expect(beatOf(r.grid, 1, 0)).toEqual([[0, 48, '我']]);
    expect(beatOf(r.grid, 1, 1)).toEqual(beatOf(g, 1, 1));
    // 本拍最后一个字拖进下一拍：第 1 小节第 4 拍「远」所在那拍重排，下一小节的字一个不变
    const r2 = setBeatText(g, 0, 3, chars('不停'));
    expect(r2.ok && beatOf(r2.grid, 0, 3)).toEqual([
      [0, 24, '不'],
      [24, 24, '停'],
    ]);
    if (r2.ok) expect(outside(r2.grid, 0, 3)).toBe(outside(g, 0, 3));
  });

  it('位置不够又超过 4 个字：什么都不写', () => {
    const g = base();
    const r = setBeatText(g, 0, 0, chars('我们一起往前冲'));
    expect(r).toEqual({ ok: false, reason: 'too-many', slots: 3 });
  });

  it('位置够时超过 4 个字也照填（例如本来就分到 1/32 的拍）', () => {
    const g = build([[0, 6, 12, 18, 24, 30].map((t) => w(t, 6))]);
    const r = setBeatText(g, 0, 0, chars('一个一个往前'));
    expect(r.ok && beatOf(r.grid, 0, 0).map((x) => x[2]).join('')).toBe('一个一个往前');
  });

  it('锁：这一拍锁着时不能重排；锁住的字不能改字；前一拍拖进来的字锁着也不能重排', () => {
    const g = base();
    expect(setBeatText(g, 0, 0, chars('走得太慢'), { cellLocked: true })).toEqual({ ok: false, reason: 'locked', slots: 3 });
    expect(setBeatText(g, 0, 0, chars('街灯在'), { cellLocked: true }).ok).toBe(true); // 一个字都没变
    expect(setBeatText(g, 0, 0, chars('灯'), { lockedAbs: new Set([0]) })).toEqual({ ok: false, reason: 'locked', slots: 3 });
    expect(setBeatText(g, 0, 0, chars('街火'), { lockedAbs: new Set([0]) }).ok).toBe(true); // 只改没锁的「灯」
    expect(setBeatText(g, 1, 0, chars('我'), { lockedAbs: new Set([144]) })).toEqual({ ok: false, reason: 'locked', slots: 0 });
  });

  it('原来的网格不变（纯函数）', () => {
    const g = base();
    const before = JSON.stringify(g);
    setBeatText(g, 0, 0, chars('走得太慢'));
    setBeatText(g, 0, 1, chars('风'));
    expect(JSON.stringify(g)).toBe(before);
  });
});
