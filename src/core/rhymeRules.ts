/**
 * 色块押韵：一种颜色 = 一条韵脚规则（押数 + 韵母串），整首作品成立。
 *
 * - 涂色以格（某小节第几拍）为单位，一格只能一种颜色；涂新色覆盖旧色。
 * - 押韵落在格内最后 n 个字上：只数字（起点在这一格里的字），不数拖的长度。「路口——」拖一拍仍是双押。
 * - 只有前面拖过来的音、没有新字的格子不能涂色；一个字都没有的格子也不能涂。
 * - 韵母比对默认严格按字面（iang ≠ ang），见 RHYME_MATCH_MODE。
 * - 两种颜色定成同一个韵（同押数、同韵母串）时自动合并：留先建的，另一种的格子全部改成它。
 */

import { analyze, groupOfFinal, splitSyllable } from './rhyme/syllable';
import {
  allBars,
  cellContent,
  cellKey,
  parseCellKey,
  TICKS_PER_BAR,
  wordsInCell,
  type CellContent,
  type Grid,
  type Word,
} from './grid';

export interface RhymeRule {
  id: string;
  /** 色相，界面颜色都由它派生；避开 250–310° 紫区 */
  hue: number;
  /** 单押 … 四押 */
  count: 1 | 2 | 3 | 4;
  /** 长度 = count，从前往后对应格内最后 count 个字 */
  finals: string[];
}

/** CellKey（小节 id:拍） → 规则 id */
export type Paint = Record<string, string>;

export type RhymeMatchMode = 'strict' | 'loose';

/**
 * 韵母比对方式（设置常量）：
 *   strict（默认，11-16 决定）—— 严格按字面：iang ≠ ang，uan ≠ an；
 *   loose —— 按十三辙忽略介音（第一期的口径）。
 */
export const RHYME_MATCH_MODE: RhymeMatchMode = 'strict';

/** 新建颜色依次用这些色相（两两至少差 25°，都不在 250–310°） */
export const RULE_HUES = [215, 150, 340, 42, 185, 100, 10, 240];
export const RULE_NAMES: Record<number, string> = {
  215: '蓝色',
  150: '绿色',
  340: '粉色',
  42: '金色',
  185: '青色',
  100: '草绿',
  10: '红色',
  240: '靛蓝',
};
export const MAX_RULES = RULE_HUES.length;
export const MAX_COUNT = 4;
export const COUNT_NAMES = ['单押', '双押', '三押', '四押'];

export function ruleName(rule: Pick<RhymeRule, 'hue'>): string {
  return RULE_NAMES[rule.hue] ?? `颜色 ${rule.hue}°`;
}

/** 用户输入的韵母规范化：小写、去声调数字和空白，v / u: 写成 ü */
export function normalizeFinal(input: string): string {
  const s = input.trim().toLowerCase().replace(/[0-9\s]/g, '').replace(/u:/g, 'ü').replace(/v/g, 'ü');
  return s;
}

/** 字面韵母：zhi / chi / shi 这类的韵母字面就是 i */
export function literalFinal(final: string): string {
  return final === '-i' ? 'i' : final;
}

/** 一个字的字面韵母；不是汉字返回 null */
export function finalOfChar(ch: string): string | null {
  if (!ch) return null;
  const s = analyze(ch)[0];
  return s ? literalFinal(s.final) : null;
}

export function finalsMatch(got: string, want: string, mode: RhymeMatchMode = RHYME_MATCH_MODE): boolean {
  const a = normalizeFinal(got);
  const b = normalizeFinal(want);
  if (!a || !b) return false;
  if (mode === 'strict') return a === b;
  const ga = groupOfFinal(a) ?? groupOfFinal(splitSyllable(a).final);
  const gb = groupOfFinal(b) ?? groupOfFinal(splitSyllable(b).final);
  return a === b || (!!ga && ga === gb);
}

export function sameRhyme(a: Pick<RhymeRule, 'count' | 'finals'>, b: Pick<RhymeRule, 'count' | 'finals'>): boolean {
  return a.count === b.count && a.finals.length === b.finals.length && a.finals.every((f, i) => normalizeFinal(f) === normalizeFinal(b.finals[i]) && !!normalizeFinal(f));
}

// ---------- 规则 ----------

let ruleSeq = 0;
function newRuleId(): string {
  ruleSeq += 1;
  return `r${ruleSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function nextHue(rules: RhymeRule[]): number | null {
  return RULE_HUES.find((h) => !rules.some((r) => r.hue === h)) ?? null;
}

export function createRule(rules: RhymeRule[], init: { count?: number; finals?: string[]; id?: string; hue?: number } = {}): RhymeRule | null {
  const hue = init.hue ?? nextHue(rules);
  if (hue === null) return null;
  const count = clampCount(init.count ?? 1);
  const finals = fitFinals(init.finals ?? [], count);
  return { id: init.id ?? newRuleId(), hue, count, finals };
}

function clampCount(n: number): 1 | 2 | 3 | 4 {
  return Math.max(1, Math.min(MAX_COUNT, Math.round(n))) as 1 | 2 | 3 | 4;
}

/** 韵母框个数跟着押数变：多了从前面补空，少了从前面去掉（保留靠后的，押韵落在最后几个字） */
function fitFinals(finals: string[], count: number): string[] {
  const norm = finals.map(normalizeFinal);
  if (norm.length >= count) return norm.slice(norm.length - count);
  return [...Array.from({ length: count - norm.length }, () => ''), ...norm];
}

export interface RulesState {
  rules: RhymeRule[];
  paint: Paint;
}

export interface MergeInfo {
  kept: string;
  removed: string;
}

/** 两种颜色同韵就合并：留先建的（rules 数组里靠前的），另一种的格子全部改成它 */
export function mergeSameRules(state: RulesState): RulesState & { merged: MergeInfo[] } {
  const merged: MergeInfo[] = [];
  let rules = state.rules;
  let paint = state.paint;
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      if (!sameRhyme(rules[i], rules[j])) continue;
      const kept = rules[i].id;
      const removed = rules[j].id;
      merged.push({ kept, removed });
      paint = Object.fromEntries(Object.entries(paint).map(([k, v]) => [k, v === removed ? kept : v]));
      rules = rules.filter((r) => r.id !== removed);
      j -= 1;
    }
  }
  return { rules, paint, merged };
}

export function addRule(state: RulesState, init: { count?: number; finals?: string[]; id?: string } = {}): RulesState & { rule: RhymeRule | null; merged: MergeInfo[] } {
  const rule = createRule(state.rules, init);
  if (!rule) return { ...state, rule: null, merged: [] };
  const m = mergeSameRules({ rules: [...state.rules, rule], paint: state.paint });
  return { ...m, rule: m.rules.find((r) => r.id === rule.id) ?? null };
}

export function updateRule(state: RulesState, id: string, patch: { count?: number; finals?: string[] }): RulesState & { merged: MergeInfo[] } {
  const rules = state.rules.map((r) => {
    if (r.id !== id) return r;
    const count = patch.count !== undefined ? clampCount(patch.count) : r.count;
    const finals = fitFinals(patch.finals ?? r.finals, count);
    return { ...r, count, finals };
  });
  return mergeSameRules({ rules, paint: state.paint });
}

export function deleteRule(state: RulesState, id: string): RulesState {
  return {
    rules: state.rules.filter((r) => r.id !== id),
    paint: Object.fromEntries(Object.entries(state.paint).filter(([, v]) => v !== id)),
  };
}

// ---------- 涂色 ----------

export interface PaintResult {
  paint: Paint;
  painted: string[];
  /** 涂不上的格子和原因 */
  refused: { key: string; reason: CellContent }[];
}

/** 一格能不能涂色：要有起点在这一格里的字 */
export function canPaint(grid: Grid, key: string): { ok: boolean; reason: CellContent } {
  const { barId, beat } = parseCellKey(key);
  const global = allBars(grid).findIndex((b) => b.data.id === barId);
  if (global < 0) return { ok: false, reason: 'empty' };
  const reason = cellContent(grid, global, beat);
  return { ok: reason === 'words', reason };
}

/** 涂色：一格只能一种颜色，涂新色覆盖旧色；只有拖音 / 没有字的格子跳过 */
export function paintCells(grid: Grid, paint: Paint, keys: Iterable<string>, ruleId: string): PaintResult {
  const next = { ...paint };
  const painted: string[] = [];
  const refused: { key: string; reason: CellContent }[] = [];
  for (const key of keys) {
    const c = canPaint(grid, key);
    if (!c.ok) {
      refused.push({ key, reason: c.reason });
      continue;
    }
    if (next[key] !== ruleId) painted.push(key);
    next[key] = ruleId;
  }
  return { paint: painted.length ? next : paint, painted, refused };
}

export function erasePaint(paint: Paint, keys: Iterable<string>): Paint {
  const set = new Set(keys);
  if (![...set].some((k) => k in paint)) return paint;
  return Object.fromEntries(Object.entries(paint).filter(([k]) => !set.has(k)));
}

/** 去掉指向不存在的小节 / 规则、或者已经变成不能涂的格子上的颜色 */
export function prunePaint(grid: Grid, rules: RhymeRule[], paint: Paint): Paint {
  const ids = new Set(rules.map((r) => r.id));
  const out: Paint = {};
  let changed = false;
  for (const [k, v] of Object.entries(paint)) {
    if (ids.has(v) && canPaint(grid, k).ok) out[k] = v;
    else changed = true;
  }
  return changed ? out : paint;
}

// ---------- 选格子 ----------

export function rowKeys(grid: Grid, globalBar: number): string[] {
  const bar = allBars(grid)[globalBar];
  return bar ? [0, 1, 2, 3].map((b) => cellKey(bar.data.id, b)) : [];
}

export function columnKeys(grid: Grid, beat: number): string[] {
  return allBars(grid).map((b) => cellKey(b.data.id, beat));
}

/** 框选：两个角（全曲小节号, 拍）之间的矩形 */
export function boxKeys(grid: Grid, a: { bar: number; beat: number }, b: { bar: number; beat: number }): string[] {
  const bars = allBars(grid);
  const out: string[] = [];
  for (let g = Math.min(a.bar, b.bar); g <= Math.max(a.bar, b.bar); g++) {
    const bar = bars[g];
    if (!bar) continue;
    for (let beat = Math.min(a.beat, b.beat); beat <= Math.max(a.beat, b.beat); beat++) out.push(cellKey(bar.data.id, beat));
  }
  return out;
}

/** 反选开着时点格子：已选的去掉，没选的加上 */
export function toggleKeys(selection: string[], keys: string[]): string[] {
  const set = new Set(selection);
  for (const k of keys) {
    if (set.has(k)) set.delete(k);
    else set.add(k);
  }
  return [...set];
}

// ---------- 韵脚位置与比对 ----------

export interface RhymeSlot {
  key: string;
  ruleId: string;
  word: Word;
  /** 全曲绝对起点 */
  abs: number;
  /** 这一位要押的韵母 */
  want: string;
  /** 已写的字的字面韵母（没写 / 不是汉字为 null） */
  got: string | null;
  ok: boolean | null;
}

/** 涂了色的格子里最后 n 个字（只数字，不数拖的长度） */
export function rhymeWords(words: Word[], count: number): Word[] {
  const sorted = [...words].sort((a, b) => a.tick - b.tick);
  return sorted.slice(Math.max(0, sorted.length - count));
}

/** 全曲所有韵脚位置 */
export function rhymeSlots(grid: Grid, rules: RhymeRule[], paint: Paint, mode: RhymeMatchMode = RHYME_MATCH_MODE): RhymeSlot[] {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const out: RhymeSlot[] = [];
  for (const b of allBars(grid)) {
    for (let beat = 0; beat < 4; beat++) {
      const key = cellKey(b.data.id, beat);
      const rule = byId.get(paint[key]);
      if (!rule) continue;
      const rp = rhymeWords(wordsInCell(b.data, beat), rule.count);
      rp.forEach((word, j) => {
        const want = rule.finals[j + (rule.count - rp.length)] ?? '';
        const got = word.text ? finalOfChar(Array.from(word.text).pop()!) : null;
        out.push({
          key,
          ruleId: rule.id,
          word,
          abs: b.global * TICKS_PER_BAR + word.tick,
          want,
          got,
          ok: got === null || !want ? null : finalsMatch(got, want, mode),
        });
      });
    }
  }
  return out;
}

/** 写了字但对不上本格颜色的位置（只提示，不自动改） */
export function mismatches(grid: Grid, rules: RhymeRule[], paint: Paint, mode: RhymeMatchMode = RHYME_MATCH_MODE): RhymeSlot[] {
  return rhymeSlots(grid, rules, paint, mode).filter((s) => s.ok === false);
}
