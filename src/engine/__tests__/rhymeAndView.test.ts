import { describe, expect, it, vi } from 'vitest';
import { analyze, createBar, createClip } from '../../core';
import { barFromPattern } from '../demo';
import { backendFinal, checkRhymeService, localMatches, nextExclude, pageOf, posCounts, themeCandidates } from '../rhymeSearch';
import { peaksOf } from '../transport';
import { barSlots, barText, finalLabel, formatPosition, lastCharStep, toneMark } from '../view';

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

describe('网格显示', () => {
  it('片段起点画字、尾巴画延音、空字是空拍', () => {
    const bar = barFromPattern('我-_好..-', [0]);
    const kinds = barSlots(bar).slice(0, 8).map((s) => s.kind);
    expect(kinds).toEqual(['char', 'sus', 'rest', 'char', 'empty', 'empty', 'sus', 'empty']);
    expect(barSlots(bar)[0].accent).toBe(true);
    expect(barText(bar)).toBe('我好');
    expect(lastCharStep(bar)).toBe(3);
    expect(lastCharStep(createBar([createClip({ start: 0, hold: true })]))).toBe(-1);
  });

  it('位置 = 小节 · 拍 · 1/16（都从 1 起）', () => {
    expect(formatPosition(null)).toBe('01 · 1 · 1');
    expect(formatPosition(5 * 16 + 5)).toBe('06 · 2 · 2');
  });

  it('调号与韵母显示', () => {
    expect(toneMark('yan', 3)).toBe('yǎn');
    expect(toneMark('liu', 2)).toBe('liú');
    expect(toneMark('gui', 4)).toBe('guì');
    expect(toneMark('lv', 4)).toBe('lǜ');
    expect(toneMark('ma', 0)).toBe('ma');
    expect(finalLabel('-i')).toBe('i');
  });

  it('波形峰值归一化', () => {
    const p = peaksOf([0, 0.5, -1, 0.25], 2);
    expect(p).toEqual([0.5, 1]);
  });
});
