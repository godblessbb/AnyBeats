import { describe, expect, it } from 'vitest';
import {
  absoluteTick,
  allWords,
  barCount,
  cellContent,
  cellKey,
  clearRange,
  createBar,
  createGrid,
  createSection,
  createWord,
  deleteBars,
  duplicateSection,
  fillTexts,
  GridError,
  holdInto,
  insertBars,
  insertWord,
  locateTick,
  normalize,
  parseCellKey,
  relabelSections,
  removeWords,
  resizeWord,
  setWordText,
  TICKS_PER_BAR,
  TICKS_PER_BEAT,
  totalTicks,
  wordAt,
  wordsInCell,
  wordStartingAt,
  type Grid,
  type Word,
} from '../grid';

const w = (tick: number, len: number, text = '') => createWord({ tick, len, text });

/** 每个数组是一小节的字（直接构造，不经过 normalize） */
function build(rows: Word[][]): Grid {
  return createGrid([{ ...createSection('verse', 0), bars: rows.map((ws) => createBar(ws)) }]);
}

const empty = (bars = 4) => createGrid([createSection('verse', bars)]);

/** 全曲字的简写：绝对起点:文字/长度 */
const shape = (g: Grid) => allWords(g).map((x) => `${x.abs}:${x.word.text}/${x.word.len}`);

const idAt = (g: Grid, abs: number) => wordStartingAt(g, abs)!.word.id;

describe('常量与字', () => {
  it('每拍 48 tick，一小节 4 拍 192 tick', () => {
    expect(TICKS_PER_BEAT).toBe(48);
    expect(TICKS_PER_BAR).toBe(192);
    expect(totalTicks(empty(3))).toBe(576);
  });

  it('createWord 拒绝越界起点和非法长度，长度可以越过小节末尾', () => {
    expect(() => w(192, 12)).toThrow(GridError);
    expect(() => w(-1, 12)).toThrow(GridError);
    expect(() => w(10.5, 12)).toThrow(GridError);
    expect(() => w(0, 0)).toThrow(GridError);
    expect(() => w(0, 1.5)).toThrow(GridError);
    expect(w(191, 500).len).toBe(500);
  });
});

describe('拖音 = 字的长度', () => {
  it('在前一个字的尾巴上放新字，前一个字被截短', () => {
    let g = insertWord(empty(), 0, 48, '我');
    g = insertWord(g, 24, 12, '在');
    expect(shape(g)).toEqual(['0:我/24', '24:在/12']);
  });

  it('字可以拖过拍线：字归起点所在的格，后一格只有拖音', () => {
    const g = insertWord(empty(), 36, 24, '路');
    const bar = g.sections[0].bars[0];
    expect(wordsInCell(bar, 0).map((x) => x.text)).toEqual(['路']);
    expect(wordsInCell(bar, 1)).toEqual([]);
    expect(cellContent(g, 0, 1)).toBe('hold-only');
    expect(holdInto(g, 0, 1)?.word.text).toBe('路');
  });

  it('字可以拖过小节线进下一小节，仍属于起点所在的小节', () => {
    const g = insertWord(empty(), 180, 36, '口');
    expect(g.sections[0].bars[0].words.map((x) => [x.tick, x.len])).toEqual([[180, 36]]);
    expect(g.sections[0].bars[1].words).toEqual([]);
    expect(wordAt(g, 200)?.word.text).toBe('口');
    expect(wordAt(g, 216)).toBeNull();
    expect(cellContent(g, 1, 0)).toBe('hold-only');
    expect(holdInto(g, 1, 0)?.global).toBe(0);
    expect(cellContent(g, 1, 1)).toBe('empty');
  });

  it('新字盖掉起点落在它范围里的旧字', () => {
    const g = build([[w(0, 12, 'a'), w(12, 12, 'b'), w(24, 12, 'c'), w(48, 12, 'd')]]);
    expect(shape(insertWord(g, 0, 36, '啊'))).toEqual(['0:啊/36', '48:d/12']);
  });

  it('新字最长到全曲末尾', () => {
    expect(shape(insertWord(empty(2), 380, 100, '尾'))).toEqual(['380:尾/4']);
  });

  it('位置越界或长度非法时抛错', () => {
    const g = empty(2);
    expect(() => insertWord(g, -1, 12)).toThrow(GridError);
    expect(() => insertWord(g, totalTicks(g), 12)).toThrow(GridError);
    expect(() => insertWord(g, 0, 0)).toThrow(GridError);
  });

  it('纯函数：不改原网格', () => {
    const g0 = insertWord(empty(), 0, 48, '我');
    const before = JSON.stringify(g0);
    insertWord(g0, 24, 12, '在');
    resizeWord(g0, idAt(g0, 0), 5);
    expect(JSON.stringify(g0)).toBe(before);
  });
});

describe('normalize', () => {
  it('每个字最多拖到下一个字的起点，跨小节也一样', () => {
    const g = build([[w(180, 300, '长')], [w(24, 12, '短')], []]);
    expect(shape(normalize(g))).toEqual(['180:长/36', '216:短/12']);
  });

  it('字不越过全曲末尾', () => {
    expect(shape(normalize(build([[], [w(100, 500, '尾')]])))).toEqual(['292:尾/92']);
  });

  it('起点重复的只留第一个', () => {
    expect(shape(normalize(build([[w(0, 12, 'a'), w(0, 12, 'b')]])))).toEqual(['0:a/12']);
  });

  it('已经合规时返回原对象', () => {
    const g = build([[w(0, 12), w(12, 180)], [w(0, 12)]]);
    expect(normalize(g)).toBe(g);
  });
});

describe('resizeWord', () => {
  it('拉长最多到下一个字的起点，不挪后面的字', () => {
    const g = build([[w(0, 12, '我'), w(48, 12, '在')]]);
    expect(shape(resizeWord(g, idAt(g, 0), 100))).toEqual(['0:我/48', '48:在/12']);
  });

  it('最短 1 tick；最后一个字最多拉到全曲末尾', () => {
    const g = build([[w(0, 12, '我')], [w(48, 12, '尾')]]);
    expect(shape(resizeWord(g, idAt(g, 0), 0))).toEqual(['0:我/1', '240:尾/12']);
    expect(shape(resizeWord(g, idAt(g, 240), 1000))).toEqual(['0:我/12', '240:尾/144']);
  });

  it('可以拉过小节线，停在下一小节第一个字前', () => {
    const g = build([[w(180, 12, '口')], [w(48, 12, '走')]]);
    expect(shape(resizeWord(g, idAt(g, 180), 100))).toEqual(['180:口/60', '240:走/12']);
  });

  it('长度没变返回原对象；找不到字抛错', () => {
    const g = build([[w(0, 12, '我'), w(12, 12, '在')]]);
    expect(resizeWord(g, idAt(g, 0), 30)).toBe(g);
    expect(() => resizeWord(g, 'nope', 12)).toThrow(GridError);
  });
});

describe('格子：cellContent / holdInto', () => {
  it('words / hold-only / empty 三种', () => {
    const g = build([[w(0, 72, '路'), w(144, 12, '口')], []]);
    expect(cellContent(g, 0, 0)).toBe('words');
    expect(cellContent(g, 0, 1)).toBe('hold-only');
    expect(cellContent(g, 0, 2)).toBe('empty');
    expect(cellContent(g, 0, 3)).toBe('words');
    expect(cellContent(g, 1, 0)).toBe('empty');
    expect(cellContent(g, 9, 0)).toBe('empty');
  });

  it('拖音刚好停在格线上不算拖进来', () => {
    const g = build([[w(0, 48, '路')]]);
    expect(cellContent(g, 0, 1)).toBe('empty');
    expect(holdInto(g, 0, 1)).toBeNull();
  });

  it('holdInto 返回拖音的源头字；格子从新字开头时返回 null', () => {
    const g = build([[w(36, 60, '路'), w(96, 12, '口')]]);
    expect(holdInto(g, 0, 1)?.word.text).toBe('路');
    expect(holdInto(g, 0, 1)?.abs).toBe(36);
    expect(holdInto(g, 0, 2)).toBeNull();
  });

  it('格子里既有新字又有前面拖进来的音时算 words，holdInto 仍能找到源头', () => {
    const g = build([[w(36, 24, '路'), w(60, 12, '口')]]);
    expect(cellContent(g, 0, 1)).toBe('words');
    expect(holdInto(g, 0, 1)?.word.text).toBe('路');
  });

  it('wordsInCell 按起点归格', () => {
    const bar = createBar([w(47, 30, 'a'), w(96, 1, 'b')]);
    expect(wordsInCell(bar, 0).map((x) => x.text)).toEqual(['a']);
    expect(wordsInCell(bar, 1)).toEqual([]);
    expect(wordsInCell(bar, 2).map((x) => x.text)).toEqual(['b']);
  });

  it('cellKey 用小节 id 拼拍号，parseCellKey 能拆回来', () => {
    expect(cellKey('bx', 3)).toBe('bx:3');
    expect(parseCellKey(cellKey('bx', 3))).toEqual({ barId: 'bx', beat: 3 });
  });
});

describe('其他编辑', () => {
  it('clearRange 删掉范围里起点的字，并截短拖进来的字', () => {
    const g = build([[w(0, 60, 'a'), w(60, 12, 'b'), w(96, 12, 'c')]]);
    expect(shape(clearRange(g, 48, 95))).toEqual(['0:a/48', '96:c/12']);
  });

  it('fillTexts 从某位置起依次写进已铺好的字（可跨小节）', () => {
    const g = build([[w(0, 12), w(96, 12)], [w(0, 24)]]);
    const r = fillTexts(g, 96, ['我', '在', '这']);
    expect(shape(r.grid)).toEqual(['0:/12', '96:我/12', '192:在/24']);
    expect(r.written.map((x) => x.abs)).toEqual([96, 192]);
  });

  it('setWordText 改字，相同文字返回原对象；removeWords 删字', () => {
    const g = build([[w(0, 12, '我'), w(12, 12, '在')]]);
    expect(setWordText(g, idAt(g, 0), '我')).toBe(g);
    expect(shape(setWordText(g, idAt(g, 0), '你'))).toEqual(['0:你/12', '12:在/12']);
    expect(shape(removeWords(g, [idAt(g, 12)]))).toEqual(['0:我/12']);
  });

  it('locateTick / absoluteTick 互逆，越界返回 null', () => {
    const g = createGrid([createSection('verse', 2), createSection('hook', 3)]);
    const addr = locateTick(g, 192 * 3 + 50);
    expect(addr).toEqual({ section: 1, bar: 1, tick: 50 });
    expect(absoluteTick(g, addr!)).toBe(192 * 3 + 50);
    expect(locateTick(g, totalTicks(g))).toBeNull();
    expect(locateTick(g, -1)).toBeNull();
  });

  it('deleteBars 后重新 normalize：拖音不越过新的下一个字', () => {
    const g = build([[w(180, 36, '口')], [], [w(0, 12, '走')]]);
    expect(shape(deleteBars(g, 0, 1))).toEqual(['180:口/12', '192:走/12']);
  });

  it('insertBars 插入空小节，原来的字长度不变', () => {
    const g = build([[w(180, 12, 'a')], [w(0, 12, 'b')]]);
    const out = insertBars(g, 0, 1);
    expect(barCount(out)).toBe(3);
    expect(shape(out)).toEqual(['180:a/12', '384:b/12']);
  });

  it('duplicateSection 复制整段，段落、小节、字的 id 都是新的', () => {
    const g = createGrid([{ ...createSection('verse', 0), bars: [createBar([w(0, 12, '我')])] }]);
    const out = duplicateSection(g, 0);
    const [a, b] = out.sections;
    expect(b.id).not.toBe(a.id);
    expect(b.bars[0].id).not.toBe(a.bars[0].id);
    expect(b.bars[0].words[0].id).not.toBe(a.bars[0].words[0].id);
    expect(b.bars[0].words[0].text).toBe('我');
  });

  it('relabelSections 同类段落按出现顺序编号，只有一个的不带号（verse 总带号）', () => {
    const g = createGrid([createSection('intro', 1), createSection('verse', 1), createSection('hook', 1), createSection('verse', 1), createSection('hook', 1)]);
    expect(relabelSections(g).sections.map((s) => s.label)).toEqual(['Intro', 'Verse 1', 'Hook 1', 'Verse 2', 'Hook 2']);
  });
});
