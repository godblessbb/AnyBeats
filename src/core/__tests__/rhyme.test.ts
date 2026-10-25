import { describe, expect, it } from 'vitest';
import { colorLineEndRhymes, tailRhyme } from '../rhyme/rhyme';
import { analyze, splitSyllable } from '../rhyme/syllable';
import { createLexicon, getDefaultLexicon, parseLexiconData } from '../rhyme/lexicon';
import { DEFAULT_LEXICON_DATA, DEFAULT_LEXICON_SIZE } from '../rhyme/lexiconData';

const fin = (text: string) => analyze(text).map((s) => (s ? `${s.final}${s.tone}` : null));

describe('韵母与声调', () => {
  it('规范化韵母：ü、零声母、整体认读、iou/uei/uen', () => {
    expect(fin('雨月去学')).toEqual(['ü3', 'üe4', 'ü4', 'üe2']);
    expect(fin('日字吃诗')).toEqual(['-i4', '-i4', '-i1', '-i1']);
    expect(fin('有围问王')).toEqual(['iu3', 'ui2', 'un4', 'uang2']);
    expect(fin('吕绿女')).toEqual(['ü3', 'ü4', 'ü3']);
    expect(fin('说过我')).toEqual(['uo1', 'uo4', 'uo3']);
    expect(splitSyllable('xiong')).toEqual({ initial: 'x', final: 'iong' });
  });

  it('多音字按整句上下文', () => {
    expect(analyze('银行')[1]?.final).toBe('ang');
    expect(analyze('行走')[0]?.final).toBe('ing');
  });

  it('非汉字为 null；轻声为 0', () => {
    expect(fin('a你-')).toEqual([null, 'i3', null]);
    expect(analyze('桌子')[1]?.tone).toBe(0);
  });

  it('十三辙分组：ang/iang/uang 同押，an/ian 同押', () => {
    expect(analyze('放想光').map((s) => s?.group)).toEqual(['jiangyang', 'jiangyang', 'jiangyang']);
    expect(analyze('看天钱').map((s) => s?.group)).toEqual(['yanqian', 'yanqian', 'yanqian']);
    expect(tailRhyme('我的梦想', 2)).toEqual(['zhongdong', 'jiangyang']);
  });
});

describe('句尾押韵标色', () => {
  it('同韵部的句尾分到同一颜色；只出现一次的不标', () => {
    const r = colorLineEndRhymes(['我在街上走', '感受这节奏！', '音乐在耳边', '回荡在天边', '无人', '', 'yo -']);
    expect(r.map((x) => x.color)).toEqual([0, 0, 1, 1, null, null, null]);
    expect(r[1].syllable?.char).toBe('奏');
    expect(r[5].syllable).toBeNull();
  });

  it('按精确韵母更严格：ang 与 iang 不同色', () => {
    const lines = ['放', '想', '光', '上'];
    expect(colorLineEndRhymes(lines).map((x) => x.color)).toEqual([0, 0, 0, 0]);
    expect(colorLineEndRhymes(lines, 'final').map((x) => x.color)).toEqual([0, null, null, 0]);
  });
});

describe('同韵词本地词表', () => {
  it('内置词表规模与体积', () => {
    expect(DEFAULT_LEXICON_SIZE).toBe(30000);
    expect(getDefaultLexicon().size).toBe(30000);
    expect(parseLexiconData(DEFAULT_LEXICON_DATA).length).toBe(30000);
    expect(new TextEncoder().encode(DEFAULT_LEXICON_DATA).length).toBeLessThan(600 * 1024);
  });

  it('按韵部、词长、声调、词性、排除过滤', () => {
    const lex = getDefaultLexicon();
    const r = lex.candidates({ group: 'jiangyang', length: 2, toneClass: '仄', pos: 'n', exclude: ['理想'], limit: 30 });
    expect(r.length).toBe(30);
    for (const c of r) {
      expect(Array.from(c.word).length).toBe(2);
      expect(c.tail[0].group).toBe('jiangyang');
      expect([3, 4]).toContain(c.tail[0].tone);
      expect(c.pos).toBe('n');
      expect(c.word).not.toBe('理想');
    }
  });

  it('按精确韵母和声调', () => {
    const r = getDefaultLexicon().candidates({ final: 'iang', tone: 3, limit: 10 });
    expect(r.length).toBe(10);
    for (const c of r) expect(c.tail[0]).toMatchObject({ final: 'iang', tone: 3 });
  });

  it('多押：尾部两个字都和「梦想」同韵', () => {
    const r = getDefaultLexicon().candidates({ like: '梦想', tailLength: 2, limit: 10 });
    expect(r.length).toBeGreaterThan(3);
    for (const c of r) {
      expect(c.word).not.toBe('梦想');
      expect(c.tail.map((s) => s.group)).toEqual(['zhongdong', 'jiangyang']);
    }
  });

  it('接口可换词表', () => {
    const lex = createLexicon([
      { word: '天堂', pos: 'n' },
      { word: '光芒', pos: 'n' },
      { word: '跑步', pos: 'v' },
    ]);
    expect(lex.size).toBe(3);
    expect(lex.candidates({ group: 'jiangyang' }).map((c) => c.word)).toEqual(['天堂', '光芒']);
    expect(lex.candidates({ final: 'xx' })).toEqual([]);
  });
});
