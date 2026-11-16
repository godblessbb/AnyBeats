import { describe, expect, it } from 'vitest';
import { allWords, cellContent, createBar, createGrid, createSection, createWord, findWord, insertWord, TICKS_PER_BEAT, wordStartingAt, type Grid, type Word } from '../grid';
import {
  barModes,
  beatMode,
  BOX_BORDER_PX,
  BOX_GAP_PX,
  boxTicks,
  clearBar,
  copyFlowToNextBar,
  extendWord,
  guideEvents,
  MIN_FONT_PX,
  minCellWidth,
  placeWord,
  precisionUnit,
  snapTick,
  stretchWordTo,
  wordSize,
  type Precision,
} from '../flow';

const w = (tick: number, len: number, text = '') => createWord({ tick, len, text });

function build(rows: Word[][]): Grid {
  return createGrid([{ ...createSection('verse', 0), bars: rows.map((ws) => createBar(ws)) }]);
}

const empty = (bars = 4) => createGrid([createSection('verse', bars)]);
const shape = (g: Grid) => allWords(g).map((x) => `${x.abs}:${x.word.text}/${x.word.len}`);
const idAt = (g: Grid, abs: number) => wordStartingAt(g, abs)!.word.id;
const lenOf = (g: Grid, id: string) => findWord(g, id)!.word.len;

describe('落点精度', () => {
  it('精度单位：1/8=24、1/16=12、1/32=6、三连=16、半拍三连=8', () => {
    const units: Record<Precision, number> = { '1/8': 24, '1/16': 12, '1/32': 6, t3: 16, t6: 8 };
    for (const [p, u] of Object.entries(units)) expect(precisionUnit(p as Precision)).toBe(u);
  });

  it('snapTick 在这一拍里往前吸附到落点', () => {
    const at = (t: number) => ({ '1/8': snapTick(t, '1/8'), '1/16': snapTick(t, '1/16'), '1/32': snapTick(t, '1/32'), t3: snapTick(t, 't3'), t6: snapTick(t, 't6') });
    // 第 1 拍（起点 48）的第 47 个 tick
    expect(at(48 + 47)).toEqual({ '1/8': 72, '1/16': 84, '1/32': 90, t3: 80, t6: 88 });
    expect(at(48 + 20)).toEqual({ '1/8': 48, '1/16': 60, '1/32': 66, t3: 64, t6: 64 });
    expect(snapTick(60, '1/16')).toBe(60);
    expect(snapTick(192 * 2 + 47, 't3')).toBe(192 * 2 + 32);
  });
});

describe('placeWord', () => {
  it('吸附到落点，长度一个精度单位', () => {
    expect(shape(placeWord(empty(), 30, '1/16'))).toEqual(['24:/12']);
    expect(shape(placeWord(empty(), 30, 't3'))).toEqual(['16:/16']);
    expect(shape(placeWord(empty(), 30, 't6'))).toEqual(['24:/8']);
    expect(shape(placeWord(empty(), 31, '1/32'))).toEqual(['30:/6']);
  });

  it('这里已经有字开头就不动，返回原网格', () => {
    const g = insertWord(empty(), 24, 12, '我');
    expect(placeWord(g, 25, '1/16')).toBe(g);
    expect(placeWord(g, 24, '1/8')).toBe(g);
  });

  it('在前一个字的拖音中间放字，前一个字被截短', () => {
    const g = insertWord(empty(), 0, 48, '路');
    expect(shape(placeWord(g, 24, '1/16'))).toEqual(['0:路/24', '24:/12']);
  });

  it('超出全曲不动', () => {
    const g = empty(1);
    expect(placeWord(g, 192, '1/16')).toBe(g);
  });
});

describe('extendWord（- 键）', () => {
  it('每按一次多拖一个精度单位', () => {
    let g = placeWord(empty(), 0, '1/16');
    const id = idAt(g, 0);
    g = extendWord(g, id, '1/16');
    expect(lenOf(g, id)).toBe(24);
    g = extendWord(g, id, '1/16');
    expect(lenOf(g, id)).toBe(36);
    g = extendWord(g, id, '1/32');
    expect(lenOf(g, id)).toBe(42);
  });

  it('拖到下一个字的起点就停，不挪后面的字', () => {
    let g = build([[w(0, 12, '我'), w(48, 12, '在')]]);
    const id = idAt(g, 0);
    for (let i = 0; i < 5; i++) g = extendWord(g, id, '1/16');
    expect(shape(g)).toEqual(['0:我/48', '48:在/12']);
  });

  it('可以拖过拍线、拖过小节线', () => {
    let g = insertWord(empty(2), 168, 12, '口');
    const id = idAt(g, 168);
    g = extendWord(g, id, '1/8');
    g = extendWord(g, id, '1/8');
    expect(shape(g)).toEqual(['168:口/60']);
    expect(g.sections[0].bars[1].words).toEqual([]);
    expect(cellContent(g, 1, 0)).toBe('hold-only');
  });

  it('负数步长往回缩，最短 1 tick；找不到字原样返回', () => {
    const g = build([[w(0, 24, '我')]]);
    expect(lenOf(extendWord(g, idAt(g, 0), '1/16', -1), idAt(g, 0))).toBe(12);
    expect(lenOf(extendWord(g, idAt(g, 0), '1/16', -5), idAt(g, 0))).toBe(1);
    expect(extendWord(g, 'nope', '1/16')).toBe(g);
  });
});

describe('stretchWordTo（拖字框右边缘）', () => {
  it('结束位置吸附到精度落点', () => {
    const g = build([[w(0, 12, '我')]]);
    const id = idAt(g, 0);
    expect(lenOf(stretchWordTo(g, id, 40, '1/16'), id)).toBe(36);
    expect(lenOf(stretchWordTo(g, id, 43, '1/16'), id)).toBe(48);
    expect(lenOf(stretchWordTo(g, id, 40, '1/8'), id)).toBe(48);
    expect(lenOf(stretchWordTo(g, id, 40, 't3'), id)).toBe(48);
  });

  it('往回拖最少留一个单位（或原长中较短者）', () => {
    const g = build([[w(0, 12, '我'), w(48, 6, '在')]]);
    expect(lenOf(stretchWordTo(g, idAt(g, 0), 2, '1/16'), idAt(g, 0))).toBe(12);
    expect(lenOf(stretchWordTo(g, idAt(g, 48), 48, '1/16'), idAt(g, 48))).toBe(6);
  });

  it('拉过下一个字的起点会被挡住', () => {
    const g = build([[w(0, 12, '我'), w(36, 12, '在')]]);
    expect(shape(stretchWordTo(g, idAt(g, 0), 100, '1/16'))).toEqual(['0:我/36', '36:在/12']);
  });
});

describe('copyFlowToNextBar / clearBar', () => {
  it('复制位置和长度、不带文字，替换下一小节原来的字', () => {
    const g = build([[w(0, 12, '我'), w(12, 36, '在'), w(96, 24, '路')], [w(48, 12, '旧')], []]);
    const out = copyFlowToNextBar(g, 0);
    const [b0, b1] = out.sections[0].bars;
    expect(b0.words.map((x) => x.text)).toEqual(['我', '在', '路']);
    expect(b1.words.map((x) => ({ tick: x.tick, len: x.len, text: x.text }))).toEqual([
      { tick: 0, len: 12, text: '' },
      { tick: 12, len: 36, text: '' },
      { tick: 96, len: 24, text: '' },
    ]);
    const srcIds = new Set(b0.words.map((x) => x.id));
    expect(b1.words.some((x) => srcIds.has(x.id))).toBe(false);
  });

  it('最后一小节没有下一小节时不动', () => {
    const g = build([[w(0, 12, '我')], [w(0, 12, '在')]]);
    expect(copyFlowToNextBar(g, 1)).toBe(g);
  });

  it('clearBar 清空一小节的字，空小节返回原对象', () => {
    const g = build([[w(0, 12, '我')], [w(0, 12, '在')]]);
    expect(shape(clearBar(g, 0))).toEqual(['192:在/12']);
    const e = empty(2);
    expect(clearBar(e, 0)).toBe(e);
  });
});

describe('画法：字框 + 细线', () => {
  it('beatMode：落在 8 / 40 → 半拍三连，落在 16 / 32 → 三连，其余普通', () => {
    expect(beatMode([])).toBe('');
    expect(beatMode([w(0, 12), w(12, 12), w(24, 12), w(36, 12)])).toBe('');
    expect(beatMode([w(6, 6), w(18, 6)])).toBe('');
    expect(beatMode([w(8, 8)])).toBe('t6');
    expect(beatMode([w(48 + 40, 8)])).toBe('t6');
    expect(beatMode([w(16, 16)])).toBe('t3');
    expect(beatMode([w(48 + 32, 16)])).toBe('t3');
    expect(beatMode([w(16, 8), w(8, 8)])).toBe('t6');
  });

  it('boxTicks：1/32 半格 6、半拍三连 8、三连 16、其余 12，不超过字长', () => {
    expect(boxTicks(w(6, 24), '')).toBe(6);
    expect(boxTicks(w(18, 6), '')).toBe(6);
    expect(boxTicks(w(30, 18), 't3')).toBe(6);
    expect(boxTicks(w(8, 40), 't6')).toBe(8);
    expect(boxTicks(w(0, 40), 't6')).toBe(8);
    expect(boxTicks(w(16, 32), 't3')).toBe(16);
    expect(boxTicks(w(0, 48), '')).toBe(12);
    expect(boxTicks(w(0, 3), '')).toBe(3);
    expect(boxTicks(w(16, 10), 't3')).toBe(10);
  });

  it('barModes 逐拍判断', () => {
    expect(barModes(createBar([w(8, 8), w(96 + 16, 16), w(144, 12)]))).toEqual(['t6', '', 't3', '']);
  });
});

describe('手机上的最小字宽', () => {
  it('minCellWidth：普通 16 分 56，有半拍三连 84，有 1/32 112', () => {
    expect(minCellWidth(empty())).toBe(56);
    expect(minCellWidth(build([[w(0, 12), w(12, 60), w(96, 96)], [w(48, 16), w(64, 16)]]))).toBe(56);
    expect(minCellWidth(build([[w(0, 12)], [w(48, 8), w(56, 8)]]))).toBe(84);
    expect(minCellWidth(build([[w(0, 12)], [w(48, 8), w(56, 8)], [w(6, 6)]]))).toBe(112);
    // 1/32 不在半格上、但字长只有 6 也一样
    expect(minCellWidth(build([[w(0, 6)]]))).toBe(112);
  });

  it('wordSize：字号 = min(base, 框内宽)，放得下时有边线', () => {
    expect(wordSize(12, 200, 16)).toEqual({ font: 16, dense: false });
    expect(wordSize(12, 200, 14)).toEqual({ font: 14, dense: false });
    // 框 = 12/48 × 64 − 2 = 14，框内 = 12
    expect(wordSize(12, 64, 16)).toEqual({ font: 12, dense: false });
    expect(wordSize(12, 70, 16)).toEqual({ font: 13, dense: false });
  });

  it('wordSize：框内放不下 11px 先去边线，字号不小于 11px', () => {
    expect(MIN_FONT_PX).toBe(11);
    expect(wordSize(12, 56, 16)).toEqual({ font: 11, dense: true });
    expect(wordSize(8, 84, 16)).toEqual({ font: 11, dense: true });
    expect(wordSize(6, 112, 16)).toEqual({ font: 11, dense: true });
  });

  it('格宽不小于 minCellWidth 时字号永远在 11px 到 base 之间，框内 < 11 才去边线', () => {
    const cases: [number, number][] = [
      [12, 56],
      [8, 84],
      [6, 112],
    ];
    for (const [box, minW] of cases) {
      for (let cw = minW; cw <= minW + 200; cw += 0.5) {
        const s = wordSize(box, cw, 16);
        const inner = (box / TICKS_PER_BEAT) * cw - BOX_GAP_PX - 2 * BOX_BORDER_PX;
        expect(s.font).toBeGreaterThanOrEqual(MIN_FONT_PX);
        expect(s.font).toBeLessThanOrEqual(16);
        expect(s.dense).toBe(inner < MIN_FONT_PX);
      }
    }
  });
});

describe('导唱', () => {
  it('每个字一声，按字的长度拉长（含跨小节的拖音），空白不出声', () => {
    const g = build([[w(0, 36, '我'), w(96, 12, '在'), w(180, 36, '路')], [w(48, 12, '口')]]);
    expect(guideEvents(g)).toEqual([
      { abs: 0, len: 36 },
      { abs: 96, len: 12 },
      { abs: 180, len: 36 },
      { abs: 240, len: 12 },
    ]);
    expect(guideEvents(empty())).toEqual([]);
  });

  it('按 - 拉长后导唱也跟着拉长', () => {
    const g = build([[w(0, 12, '我')]]);
    expect(guideEvents(extendWord(g, idAt(g, 0), '1/8'))).toEqual([{ abs: 0, len: 36 }]);
  });
});
