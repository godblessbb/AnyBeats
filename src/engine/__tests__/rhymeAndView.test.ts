import { describe, expect, it, vi } from 'vitest';
import { analyze, finalOfChar, findWord, setWordText, TICKS_PER_BAR, wordStartingAt, type Doc } from '../../core';
import { nightDriveProject } from '../demo';
import { backendFinal, checkRhymeService, localMatches, nextExclude, pageOf, posCounts, ruleCandidates, themeCandidates } from '../rhymeSearch';
import { peaksOf } from '../transport';
import { cellName, formatClock, formatPosition, playFrom, sheetView, toneMark } from '../view';

const yan = analyze('眼')[0]!;

describe('同韵候选（本地韵表）', () => {
  it('按句尾韵部找 2 字词，韵母完全相同的排前面', () => {
    const words = localMatches(yan, { length: 2, tone: 'all' });
    expect(words.length).toBeGreaterThan(50);
    const finals = words.map((w) => analyze(w.word)[1]!.final);
    const firstNear = finals.findIndex((f) => f !== 'ian');
    expect(finals.slice(0, firstNear).every((f) => f === 'ian')).toBe(true);
    expect(finals.slice(firstNear).every((f) => f !== 'ian')).toBe(true);
    expect(words.every((w) => analyze(w.word)[1]!.group === 'yanqian')).toBe(true);
  });

  it('声调 / 平仄 / 单字筛选', () => {
    expect(localMatches(yan, { length: 2, tone: 4 }).every((w) => w.tone === 4)).toBe(true);
    expect(localMatches(yan, { length: 2, tone: '平' }).every((w) => w.tone === 1 || w.tone === 2)).toBe(true);
    const one = localMatches(yan, { length: 1, tone: 'all' });
    expect(one.length).toBeGreaterThan(5);
    expect(one.every((w) => Array.from(w.word).length === 1 && w.word !== '眼')).toBe(true);
  });

  it('词性统计', () => {
    const words = localMatches(yan, { length: 2, tone: 'all' });
    const c = posCounts(words);
    expect(c.all).toBe(words.length);
    expect(c.n + c.v + c.a + c.d + c.o).toBe(words.length);
  });

  it('「换一批」：排除表只收字符串（旧界面把点击事件传了进去），全排除完从头再来', () => {
    const words = localMatches(yan, { length: 2, tone: 'all' }).slice(0, 30);
    let exclude: string[] = [];
    const first = pageOf(words, exclude).page;
    exclude = nextExclude(exclude, first);
    expect(exclude.every((w) => typeof w === 'string')).toBe(true);
    const second = pageOf(words, exclude).page;
    expect(second.some((w) => first.includes(w))).toBe(false);
    exclude = nextExclude(nextExclude(exclude, second), pageOf(words, nextExclude(exclude, second)).page);
    const wrapped = pageOf(words, exclude);
    expect(wrapped.wrapped).toBe(true);
    expect(wrapped.page).toHaveLength(12);
  });
});

describe('按颜色规则找候选（ruleCandidates）', () => {
  it('双押 u · ou：只给两字词，每个字的韵母都严格对得上', () => {
    const words = ruleCandidates(['u', 'ou']);
    expect(words.length).toBeGreaterThan(0);
    expect(words.length).toBeLessThanOrEqual(9);
    for (const w of words) {
      const chars = Array.from(w);
      expect(chars).toHaveLength(2);
      expect(chars.map((c) => finalOfChar(c))).toEqual(['u', 'ou']);
    }
    expect(new Set(words).size).toBe(words.length);
  });

  it('单押 ang：给单字，严格按字面（不混进 iang）', () => {
    const words = ruleCandidates(['ang'], 20);
    expect(words.length).toBeGreaterThan(0);
    expect(words.every((w) => Array.from(w).length === 1)).toBe(true);
    expect(words).toContain('方');
    expect(words.map((w) => finalOfChar(w))).not.toContain('iang');
    // 注：没有断言「每个单字单独读的韵母都是 ang」——多音字（如取自「银行」的「行」）单独读是 xíng，见报告
  });

  it('zhi / chi / shi 的韵母字面是 i；排除表；韵母没填全时不给候选', () => {
    const words = ruleCandidates(['i', 'ang'], 30);
    expect(words.length).toBeGreaterThan(0);
    expect(words.every((w) => Array.from(w).map((c) => finalOfChar(c)).join(' ') === 'i ang')).toBe(true);
    const ex = ruleCandidates(['i', 'ang'], 9, [words[0]]);
    expect(ex).not.toContain(words[0]);
    expect(ruleCandidates(['', 'ou'])).toEqual([]);
    expect(ruleCandidates([])).toEqual([]);
  });
});

describe('主题联想（本机韵脚服务，可选）', () => {
  it('服务没起：返回 offline，不抛错', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await checkRhymeService('http://x', fetchImpl)).toMatchObject({ state: 'offline' });
  });

  it('请求体：韵母换成后端写法，exclude 是字符串数组', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ rhyme: 'ian', word_length: 2, theme: '夜晚', exclude: ['从前'], tone: 4 });
      return new Response(JSON.stringify({ words: [{ word: '夜店', tone: 4, part_of_speech: '名词' }] }));
    });
    const words = await themeCandidates(yan, { length: 2, tone: 4, pos: 'all' }, '夜晚', ['从前'], 'http://x', fetchImpl);
    expect(words).toEqual([{ word: '夜店', tone: 4, pos: 'n' }]);
    expect(backendFinal('üan')).toBe('uan');
    expect(backendFinal('ü')).toBe('v');
    expect(backendFinal('-i')).toBe('i');
  });
});

describe('表格视图（sheetView，夜车）', () => {
  const project = nightDriveProject(0);
  const doc: Doc = project;
  const view = sheetView(doc);
  const cell = (global: number, beat: number) => view.rows[global].cells[beat];
  const wordId = (global: number, tick: number) => wordStartingAt(doc.grid, global * TICKS_PER_BAR + tick)!.word.id;

  it('段落和行：9 小节，Intro / Verse 1 / Hook', () => {
    expect(view.rows).toHaveLength(9);
    expect(view.sections.map((s) => [s.label, s.rows.length])).toEqual([
      ['Intro', 1],
      ['Verse 1', 4],
      ['Hook', 4],
    ]);
    expect(view.sections[2].rows[0].global).toBe(5);
    expect(cell(0, 0).content).toBe('empty');
    expect(cell(0, 3).words.map((w) => w.text)).toEqual(['走', '吧']);
  });

  it('字比字框长：从字的落点铺一块浅底到字结束（同一格里一段）', () => {
    // 第 3 小节「霓---」：一个字拖满一拍
    const c = cell(2, 0);
    expect(c.content).toBe('words');
    expect(c.words.map((w) => [w.text, w.len, w.box])).toEqual([['霓', 48, 12]]);
    expect(c.tints).toEqual([
      expect.objectContaining({ wordId: wordId(2, 0), s: 2 * TICKS_PER_BAR, e: 2 * TICKS_PER_BAR + 48, head: true, tail: true, tone: 'ink', hue: null }),
    ]);
    // 三连：字框就是 16 tick，字没拖长，不铺浅底
    expect(cell(3, 0).mode).toBe('t3');
    expect(cell(3, 0).words.map((w) => w.box)).toEqual([16, 16, 16]);
    expect(cell(3, 0).tints).toEqual([]);
  });

  it('拖过小节线：第 6 小节第 4 拍的「口」接着铺到第 7 小节第 1 拍开头（换行后 head = false）', () => {
    const kou = wordId(5, 156);
    const here = cell(5, 3).tints.filter((s) => s.wordId === kou);
    const next = cell(6, 0).tints.filter((s) => s.wordId === kou);
    const abs = 5 * TICKS_PER_BAR + 156;
    expect(here).toEqual([expect.objectContaining({ s: abs, e: 6 * TICKS_PER_BAR, head: true, tail: false, fromBar: 5, fromBeat: 3 })]);
    expect(next).toEqual([expect.objectContaining({ s: 6 * TICKS_PER_BAR, e: abs + 60, head: false, tail: true, fromBar: 5, fromBeat: 3, fromKey: cell(5, 3).key })]);
    // 韵脚字的浅底带颜色
    expect(next[0]).toMatchObject({ tone: 'rp', hue: 340 });
    // 第 7 小节第 1 拍自己也有字（「油」），所以不是只有拖音
    expect(cell(6, 0).content).toBe('words');
  });

  it('只有拖音的格子（第 7 小节第 2 拍，「门」拖过来）：没有字、不能涂色，记得是谁拖过来的', () => {
    const c = cell(6, 1);
    expect(c.content).toBe('hold-only');
    expect(c.words).toEqual([]);
    expect(c.rule).toBeNull();
    expect(c.holdFrom).toEqual({ bar: 6, beat: 0, text: '门' });
    expect(c.tints).toEqual([expect.objectContaining({ wordId: wordId(6, 36), head: false, tail: true })]);
    expect(cell(6, 0).holdFrom).toBeNull();
  });

  it('韵脚字：带颜色色相和要押的韵母；不是韵脚的字没有；行尾标出这一行的颜色', () => {
    const c = cell(1, 3);
    expect(c.rule?.id).toBe('rA');
    expect(c.words.map((w) => [w.text, w.final, w.hue])).toEqual([
      ['找', null, null],
      ['个', null, null],
      ['地', 'i', 215],
      ['方', 'ang', 215],
    ]);
    expect(view.rows[1].tags.map((r) => r.id)).toEqual(['rB', 'rA']);
    expect(cell(6, 2).words.map((w) => [w.text, w.final, w.hue])).toEqual([
      ['踩', null, null],
      ['到', null, null],
      ['满', 'an', 42],
    ]);
    expect(view.mismatchCount).toBe(0);
    expect(c.words.every((w) => w.mismatch === null && !w.locked && !w.rhymeLocked)).toBe(true);
  });

  it('写了字但对不上本格颜色：记一处，字上带 got / want', () => {
    const fang = findWord(doc.grid, wordId(1, 180))!;
    const v = sheetView({ ...doc, grid: setWordText(doc.grid, fang.word.id, '想') });
    expect(v.mismatchCount).toBe(1);
    expect(v.rows[1].cells[3].words[3].mismatch).toEqual({ got: 'iang', want: 'ang' });
  });

  it('锁定：整行锁 / 单格锁（格角小锁）/ 锁韵脚位置（字角小锁）', () => {
    const bar1 = doc.grid.sections[1].bars[0].id;
    const bar2 = doc.grid.sections[1].bars[1].id;
    const v = sheetView({ ...doc, locks: { bars: [bar1], beats: [], cells: [`${bar2}:0`], rhyme: true } });
    expect(v.rows[1].barLocked).toBe(true);
    expect(v.rows[1].cells.every((c) => c.lockedCell && !c.cellLockIcon)).toBe(true);
    expect(v.rows[2].cells[0]).toMatchObject({ lockedCell: true, cellLockIcon: true });
    expect(v.rows[2].cells[1].lockedCell).toBe(false);
    // 第 9 小节第 4 拍：「十字」不是韵脚，「路口」是
    expect(v.rows[8].cells[3].words.map((w) => [w.text, w.locked, w.rhymeLocked])).toEqual([
      ['十', false, false],
      ['字', false, false],
      ['路', true, true],
      ['口', true, true],
    ]);
  });
});

describe('显示用小工具', () => {
  it('位置 = 小节 · 拍 · 第几个 16 分（都从 1 起）', () => {
    expect(formatPosition(null)).toBe('1 · 1 · 1');
    expect(formatPosition(0)).toBe('1 · 1 · 1');
    expect(formatPosition(5 * TICKS_PER_BAR + 48 + 12)).toBe('6 · 2 · 2');
    expect(formatPosition(5 * TICKS_PER_BAR + 48 + 16)).toBe('6 · 2 · 2'); // 三连的第二个字也落在第 2 个 16 分里
    expect(formatPosition(191)).toBe('1 · 4 · 4');
  });

  it('播放起点（1/16）、时钟、格子名', () => {
    expect(playFrom(null)).toBe(0);
    expect(playFrom({ focus: 5 * TICKS_PER_BAR + 12 })).toBe(81);
    expect(playFrom({ focus: 13 })).toBe(1);
    expect(formatClock(65.25)).toBe('1:05.3');
    expect(formatClock(65.25, false)).toBe('1:05');
    expect(cellName(6, 1)).toBe('第 7 小节第 2 拍');
  });

  it('调号', () => {
    expect(toneMark('yan', 3)).toBe('yǎn');
    expect(toneMark('liu', 2)).toBe('liú');
    expect(toneMark('gui', 4)).toBe('guì');
    expect(toneMark('lv', 4)).toBe('lǜ');
    expect(toneMark('kou', 3)).toBe('kǒu');
    expect(toneMark('ma', 0)).toBe('ma');
  });

  it('波形峰值归一化', () => {
    const p = peaksOf([0, 0.5, -1, 0.25], 2);
    expect(p).toEqual([0.5, 1]);
  });
});
