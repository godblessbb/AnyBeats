import { describe, expect, it } from 'vitest';
import { cellKey, createBar, createGrid, createSection, createWord, removeWords, type Grid, type Word } from '../grid';
import {
  addRule,
  boxKeys,
  canPaint,
  columnKeys,
  createRule,
  deleteRule,
  erasePaint,
  finalOfChar,
  finalsMatch,
  MAX_RULES,
  mergeSameRules,
  mismatches,
  normalizeFinal,
  paintCells,
  prunePaint,
  rhymeSlots,
  rowKeys,
  RULE_HUES,
  sameRhyme,
  toggleKeys,
  updateRule,
  type RhymeRule,
  type RulesState,
} from '../rhymeRules';

const w = (tick: number, len: number, text = '') => createWord({ tick, len, text });

function build(rows: Word[][]): Grid {
  return createGrid([{ ...createSection('verse', 0), bars: rows.map((ws) => createBar(ws)) }]);
}

/**
 * 第 0 小节：我想 | 方＋空字 | 空 | 路口（口拖进下一小节一拍）
 * 第 1 小节：只有拖音 | 不走场 | 在 | 来
 * 第 2 小节：空
 */
const g = build([
  [w(0, 12, '我'), w(12, 36, '想'), w(48, 24, '方'), w(72, 24, ''), w(144, 24, '路'), w(168, 48, '口')],
  [w(48, 12, '不'), w(60, 12, '走'), w(72, 24, '场'), w(96, 48, '在'), w(144, 48, '来')],
  [],
]);
const [b0, b1, b2] = g.sections[0].bars.map((b) => b.id);

const rule = (id: string, count: number, finals: string[], rules: RhymeRule[] = []) => createRule(rules, { id, count, finals })!;

describe('押韵位置：格内最后 n 个字', () => {
  it('只数字不数拖音：「路口」口拖进下一小节仍是双押 u / ou', () => {
    const r = rule('R', 2, ['u', 'ou']);
    const slots = rhymeSlots(g, [r], { [cellKey(b0, 3)]: r.id }, 'strict');
    expect(slots.map((s) => [s.word.text, s.abs, s.want, s.got, s.ok])).toEqual([
      ['路', 144, 'u', 'u', true],
      ['口', 168, 'ou', 'ou', true],
    ]);
  });

  it('格内字多于押数时只看最后几个', () => {
    const r = rule('R', 2, ['ou', 'ang']);
    const slots = rhymeSlots(g, [r], { [cellKey(b1, 1)]: r.id }, 'strict');
    expect(slots.map((s) => [s.word.text, s.want, s.ok])).toEqual([
      ['走', 'ou', true],
      ['场', 'ang', true],
    ]);
  });

  it('格内字少于押数时对齐靠后的韵母', () => {
    const r = rule('R', 2, ['u', 'ai']);
    const slots = rhymeSlots(g, [r], { [cellKey(b1, 2)]: r.id }, 'strict');
    expect(slots.map((s) => [s.word.text, s.abs, s.want])).toEqual([['在', 192 + 96, 'ai']]);
  });
});

describe('涂色', () => {
  it('一格一色：涂新色覆盖旧色，涂同色不算改动', () => {
    const k = cellKey(b0, 3);
    const a = paintCells(g, {}, [k], 'A');
    expect(a.paint).toEqual({ [k]: 'A' });
    const b = paintCells(g, a.paint, [k], 'B');
    expect(b.paint).toEqual({ [k]: 'B' });
    expect(b.painted).toEqual([k]);
    const again = paintCells(g, b.paint, [k], 'B');
    expect(again.painted).toEqual([]);
    expect(again.paint).toBe(b.paint);
  });

  it('只有拖音的格子和空格子涂不上，并报告原因', () => {
    const keys = [cellKey(b0, 3), cellKey(b1, 0), cellKey(b0, 2), cellKey(b2, 0)];
    const r = paintCells(g, {}, keys, 'A');
    expect(r.painted).toEqual([cellKey(b0, 3)]);
    expect(r.paint).toEqual({ [cellKey(b0, 3)]: 'A' });
    expect(r.refused).toEqual([
      { key: cellKey(b1, 0), reason: 'hold-only' },
      { key: cellKey(b0, 2), reason: 'empty' },
      { key: cellKey(b2, 0), reason: 'empty' },
    ]);
    expect(canPaint(g, 'nope:1')).toEqual({ ok: false, reason: 'empty' });
  });

  it('只写了空字（还没填文字）的格子也能涂', () => {
    const empties = build([[w(0, 12)]]);
    expect(canPaint(empties, cellKey(empties.sections[0].bars[0].id, 0)).ok).toBe(true);
  });

  it('erasePaint / deleteRule 去掉颜色', () => {
    const paint = { [cellKey(b0, 3)]: 'A', [cellKey(b1, 1)]: 'B' };
    expect(erasePaint(paint, [cellKey(b0, 3)])).toEqual({ [cellKey(b1, 1)]: 'B' });
    expect(erasePaint(paint, [cellKey(b2, 0)])).toBe(paint);
    const state = deleteRule({ rules: [rule('A', 1, ['u']), rule('B', 1, ['ang'])], paint }, 'A');
    expect(state.rules.map((r) => r.id)).toEqual(['B']);
    expect(state.paint).toEqual({ [cellKey(b1, 1)]: 'B' });
  });

  it('prunePaint 去掉指向不存在规则、或已经不能涂的格子上的颜色', () => {
    const a = rule('A', 1, ['ou']);
    const paint = { [cellKey(b0, 3)]: 'A', [cellKey(b1, 1)]: 'A', [cellKey(b1, 2)]: 'gone' };
    const ids = g.sections[0].bars[0].words.filter((x) => x.tick >= 144).map((x) => x.id);
    expect(prunePaint(removeWords(g, ids), [a], paint)).toEqual({ [cellKey(b1, 1)]: 'A' });
    const ok = { [cellKey(b1, 1)]: 'A' };
    expect(prunePaint(g, [a], ok)).toBe(ok);
  });
});

describe('韵母比对', () => {
  // v3.4：判押韵的档存在作品里，函数必须显式传档（原来的 RHYME_MATCH_MODE 常量删掉了；原「默认严格」断言改到 project / store 测试：没字段的作品 = strict）
  it('finalsMatch：严格时 iang ≠ ang，十三辙同辙算押', () => {
    expect(finalsMatch('iang', 'ang', 'strict')).toBe(false);
    expect(finalsMatch('iang', 'ang', 'thirteen')).toBe(true);
    expect(finalsMatch('ang', 'ang', 'strict')).toBe(true);
    expect(finalsMatch(' ANG3 ', 'ang', 'strict')).toBe(true);
    expect(finalsMatch('ou', 'u', 'thirteen')).toBe(false);
    expect(finalsMatch('', '', 'strict')).toBe(false);
    expect(finalsMatch('', '', 'thirteen')).toBe(false);
  });

  it('finalOfChar 取字面韵母，不是汉字返回 null', () => {
    const got = Object.fromEntries(Array.from('想方是路口在满地').map((c) => [c, finalOfChar(c)]));
    expect(got).toEqual({ 想: 'iang', 方: 'ang', 是: 'i', 路: 'u', 口: 'ou', 在: 'ai', 满: 'an', 地: 'i' });
    expect(finalOfChar('a')).toBeNull();
    expect(finalOfChar('')).toBeNull();
  });

  it('normalizeFinal：小写、去声调和空白，v / u: 写成 ü', () => {
    expect(normalizeFinal(' Ang 2')).toBe('ang');
    expect(normalizeFinal('V')).toBe('ü');
    expect(normalizeFinal('u:e')).toBe('üe');
  });

  it('mismatches 列出写了字但韵母不对的位置，空字不列', () => {
    const a = rule('A', 1, ['ang']);
    // 第 0 小节第 0 拍末字「想」(iang)；第 1 拍末字是空字；第 1 小节第 1 拍末字「场」(ang)
    const paint = { [cellKey(b0, 0)]: a.id, [cellKey(b0, 1)]: a.id, [cellKey(b1, 1)]: a.id };
    const m = mismatches(g, [a], paint, 'strict');
    expect(m.map((s) => [s.key, s.word.text, s.got, s.want])).toEqual([[cellKey(b0, 0), '想', 'iang', 'ang']]);
    expect(rhymeSlots(g, [a], paint, 'strict').find((s) => s.key === cellKey(b0, 1))?.ok).toBeNull();
    expect(mismatches(g, [a], paint, 'thirteen')).toEqual([]);
  });
});

describe('规则：自动合并', () => {
  it('mergeSameRules：同押数同韵母合并，留数组里靠前的，被删规则的格子全部改色', () => {
    const state: RulesState = {
      rules: [rule('A', 1, ['ang']), rule('B', 2, ['u', 'ou']), rule('C', 1, ['ang'])],
      paint: { k1: 'A', k2: 'C', k3: 'B', k4: 'C' },
    };
    const m = mergeSameRules(state, 'strict');
    expect(m.rules.map((r) => r.id)).toEqual(['A', 'B']);
    expect(m.paint).toEqual({ k1: 'A', k2: 'A', k3: 'B', k4: 'A' });
    expect(m.merged).toEqual([{ kept: 'A', removed: 'C' }]);
  });

  it('updateRule 改成和别的规则同韵：留靠前的那条（不管改的是哪条）', () => {
    const state: RulesState = { rules: [rule('A', 1, ['an']), rule('B', 1, ['ang'])], paint: { k1: 'A', k2: 'B' } };

    const u1 = updateRule(state, 'A', { finals: ['ang'] }, 'strict');
    expect(u1.rules.map((r) => [r.id, r.finals])).toEqual([['A', ['ang']]]);
    expect(u1.paint).toEqual({ k1: 'A', k2: 'A' });
    expect(u1.merged).toEqual([{ kept: 'A', removed: 'B' }]);

    const u2 = updateRule(state, 'B', { finals: ['an'] }, 'strict');
    expect(u2.rules.map((r) => r.id)).toEqual(['A']);
    expect(u2.paint).toEqual({ k1: 'A', k2: 'A' });
  });

  it('韵母没填全的规则不合并', () => {
    let state: RulesState = { rules: [], paint: {} };
    state = addRule(state, 'strict');
    state = addRule(state, 'strict');
    expect(state.rules).toHaveLength(2);
    state = addRule(state, 'strict', { count: 2, finals: ['', 'ou'] });
    state = addRule(state, 'strict', { count: 2, finals: ['', 'ou'] });
    expect(state.rules).toHaveLength(4);
    expect(sameRhyme(state.rules[2], state.rules[3], 'strict')).toBe(false);
  });

  it('addRule 和已有规则同韵时并进已有规则，返回的 rule 为 null', () => {
    const first = addRule({ rules: [], paint: {} }, 'strict', { count: 2, finals: ['u', 'ou'] });
    const second = addRule(first, 'strict', { count: 2, finals: ['U', 'ou4'] });
    expect(second.rule).toBeNull();
    expect(second.rules.map((r) => r.id)).toEqual([first.rule!.id]);
    expect(second.merged).toHaveLength(1);
    expect(second.merged[0].kept).toBe(first.rule!.id);
  });
});

describe('规则：色相与押数', () => {
  it('addRule 依次用 RULE_HUES 的色相，用完返回 null；删掉的色相可再用', () => {
    let state: RulesState = { rules: [], paint: {} };
    for (let i = 0; i < MAX_RULES; i++) {
      const r = addRule(state, 'strict');
      expect(r.rule?.hue).toBe(RULE_HUES[i]);
      state = r;
    }
    expect(addRule(state, 'strict').rule).toBeNull();
    const freed = deleteRule(state, state.rules[2].id);
    expect(addRule(freed, 'strict').rule?.hue).toBe(RULE_HUES[2]);
  });

  it('RULE_HUES 互不相同，都不在 250–310° 紫区', () => {
    expect(new Set(RULE_HUES).size).toBe(RULE_HUES.length);
    for (const h of RULE_HUES) expect(h < 250 || h > 310).toBe(true);
  });

  it('押数限制在 1–4，韵母框个数跟着押数变（保留靠后的）', () => {
    expect(createRule([], { count: 9 })!.count).toBe(4);
    expect(createRule([], { count: 0 })!.count).toBe(1);
    expect(createRule([], { count: 2, finals: ['a', 'u', 'OU1'] })!.finals).toEqual(['u', 'ou']);
    expect(createRule([], { count: 3, finals: ['ou'] })!.finals).toEqual(['', '', 'ou']);

    const state: RulesState = { rules: [rule('A', 2, ['u', 'ou'])], paint: {} };
    expect(updateRule(state, 'A', { count: 1 }, 'strict').rules[0]).toMatchObject({ count: 1, finals: ['ou'] });
    expect(updateRule(state, 'A', { count: 4 }, 'strict').rules[0]).toMatchObject({ count: 4, finals: ['', '', 'u', 'ou'] });
    expect(updateRule(state, 'A', { count: 7 }, 'strict').rules[0].count).toBe(4);
  });
});

describe('选格子', () => {
  it('rowKeys：一小节四拍', () => {
    expect(rowKeys(g, 1)).toEqual([0, 1, 2, 3].map((b) => cellKey(b1, b)));
    expect(rowKeys(g, 9)).toEqual([]);
  });

  it('columnKeys：每小节同一拍', () => {
    expect(columnKeys(g, 2)).toEqual([cellKey(b0, 2), cellKey(b1, 2), cellKey(b2, 2)]);
  });

  it('boxKeys：两个角之间的矩形，角的顺序无所谓，越界的小节跳过', () => {
    const want = [cellKey(b1, 2), cellKey(b1, 3), cellKey(b2, 2), cellKey(b2, 3)];
    expect(boxKeys(g, { bar: 2, beat: 3 }, { bar: 1, beat: 2 })).toEqual(want);
    expect(boxKeys(g, { bar: 1, beat: 2 }, { bar: 2, beat: 3 })).toEqual(want);
    expect(boxKeys(g, { bar: 2, beat: 0 }, { bar: 5, beat: 0 })).toEqual([cellKey(b2, 0)]);
  });

  it('toggleKeys：已选的去掉，没选的加上', () => {
    expect(toggleKeys(['a', 'b'], ['b', 'c'])).toEqual(['a', 'c']);
  });
});
