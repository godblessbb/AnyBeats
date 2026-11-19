/**
 * 色块押韵：一种颜色 = 一条韵脚规则（押数 + 韵母串），整首作品成立。
 *
 * - 涂色以格（某小节第几拍）为单位，一格只能一种颜色；涂新色覆盖旧色。
 * - 押韵落在格内最后 n 个字上：只数字（起点在这一格里的字），不数拖的长度。「路口——」拖一拍仍是双押。
 * - 只有前面拖过来的音、没有新字的格子不能涂色；一个字都没有的格子也不能涂。
 * - 判押韵有两档，存在作品里（Doc.rhymeMatch，DESIGN_v34 §4）：十三辙（新作品默认，同辙就算押上）/ 严格韵母（字面一字不差）。
 *   没有这个字段的旧作品按严格判。所有判押韵的函数都要显式传档，不读任何代码常量。
 * - 规则里的韵母按用户写的样子存（an / ian / yuan / 言前 都行），判的时候才按档解释。
 * - 两种颜色定成同一个韵（同押数、每一位同韵——十三辙下是同辙）时自动合并：留先建的，另一种的格子全部改成它。
 */

import { analyze, groupOfFinal, RHYME_GROUP_NAMES, splitSyllable, type RhymeGroup } from './rhyme/syllable';
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

/**
 * 判押韵的档（作品级设置，存在 Doc.rhymeMatch）：
 *   thirteen —— 十三辙：同一辙就算押上（an / ian / uan / üan 都是言前；in 属人辰、ing 属中东，不同辙）；
 *   strict   —— 严格韵母：字面一字不差（iang ≠ ang，uan ≠ an）。旧作品（文件里没有 rhymeMatch）按这一档。
 */
export type RhymeMatchMode = 'thirteen' | 'strict';

/** 文件 / 历史里读到的档：只认 'thirteen' | 'strict'，第一期的 'loose' 读作 thirteen，别的值当没有（= 旧作品） */
export function readRhymeMatch(v: unknown): RhymeMatchMode | undefined {
  if (v === 'thirteen' || v === 'loose') return 'thirteen';
  if (v === 'strict') return 'strict';
  return undefined;
}

/** 作品实际用的档：没有字段 = 旧作品 = 严格 */
export function rhymeMatchOf(doc: { rhymeMatch?: RhymeMatchMode }): RhymeMatchMode {
  return doc.rhymeMatch === 'thirteen' ? 'thirteen' : 'strict';
}

export const RHYME_MATCH_NAMES: Record<RhymeMatchMode, string> = { thirteen: '十三辙', strict: '严格韵母' };

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

const GROUP_BY_NAME = new Map<string, RhymeGroup>(Object.entries(RHYME_GROUP_NAMES).map(([g, n]) => [n, g as RhymeGroup]));

/** 规则里写的是辙名（「言前」「言前辙」）时返回那一辙，否则 null */
export function groupOfName(input: string): RhymeGroup | null {
  return GROUP_BY_NAME.get(input.trim().replace(/辙$/, '')) ?? null;
}

/**
 * 规范成标准韵母（字面）：本来就是韵母的原样（-i 记作字面 i）；整音节先还原（yuan → üan、wan → uan、iou → iu、zhi → i），
 * 认不出的原样返回（normalizeFinal 之后的）。
 */
export function canonicalFinal(input: string): string {
  const s = normalizeFinal(input);
  if (!s) return '';
  if (groupOfFinal(s)) return literalFinal(s);
  const f = splitSyllable(s).final;
  return groupOfFinal(f) ? literalFinal(f) : s;
}

/** 一位韵脚要押的辙：韵母（an）、整音节（yuan、wan）、辙名（言前 / 言前辙）都认；认不出 / 空的返回 null */
export function groupOfWant(input: string): RhymeGroup | null {
  const named = groupOfName(input);
  if (named) return named;
  const s = normalizeFinal(input);
  if (!s) return null;
  return groupOfFinal(s) ?? groupOfFinal(splitSyllable(s).final);
}

/** 辙的中文名加「辙」：言前辙；认不出返回 null */
export function zheName(input: string): string | null {
  const g = groupOfWant(input);
  return g ? `${RHYME_GROUP_NAMES[g]}辙` : null;
}

/** 这一辙包含的韵母（按十三辙表的顺序），给「言前辙 · an ian uan üan 都算」用 */
export function finalsOfGroup(group: RhymeGroup): string[] {
  return ZHE_FINALS[group];
}

const ZHE_FINALS: Record<RhymeGroup, string[]> = {
  fahua: ['a', 'ia', 'ua'],
  suobo: ['o', 'e', 'uo'],
  miexie: ['ie', 'üe', 'ê'],
  yiqi: ['i', 'ü', '-i', 'er'],
  gusu: ['u'],
  huailai: ['ai', 'uai'],
  huidui: ['ei', 'ui'],
  yaotiao: ['ao', 'iao'],
  youqiu: ['ou', 'iu'],
  yanqian: ['an', 'ian', 'uan', 'üan'],
  renchen: ['en', 'in', 'un', 'ün'],
  jiangyang: ['ang', 'iang', 'uang'],
  zhongdong: ['eng', 'ing', 'ong', 'iong', 'ueng'],
};

/**
 * 一个字的韵母 got 押不押规则里写的 want，按作品的档判：
 *   strict   —— 规范成标准韵母后字面相同（iang ≠ ang）；
 *   thirteen —— 同一辙（认不出辙时退回字面相同）。
 * 规则里直接写辙名（「言前」）时两档都按这一辙判——写辙名就是要整辙都算。
 */
export function finalsMatch(got: string, want: string, mode: RhymeMatchMode): boolean {
  const a = canonicalFinal(got);
  if (!a || !normalizeFinal(want)) return false;
  const named = groupOfName(want);
  if (named) return groupOfWant(a) === named;
  const b = canonicalFinal(want);
  if (a === b) return true;
  if (mode === 'strict') return false;
  const ga = groupOfWant(a);
  return !!ga && ga === groupOfWant(want);
}

/** 两个韵母位按档算不算同一个韵（空的不算） */
function sameFinal(x: string, y: string, mode: RhymeMatchMode): boolean {
  if (!normalizeFinal(x) || !normalizeFinal(y)) return false;
  const gx = groupOfName(x);
  const gy = groupOfName(y);
  if (gx || gy) return mode === 'thirteen' ? groupOfWant(x) === groupOfWant(y) : gx === gy;
  if (canonicalFinal(x) === canonicalFinal(y)) return true;
  if (mode === 'strict') return false;
  const g = groupOfWant(x);
  return !!g && g === groupOfWant(y);
}

/** 两条规则同韵：同押数，每一位同韵（十三辙 = 每一位同辙；严格 = 每一位韵母相同） */
export function sameRhyme(a: Pick<RhymeRule, 'count' | 'finals'>, b: Pick<RhymeRule, 'count' | 'finals'>, mode: RhymeMatchMode): boolean {
  return a.count === b.count && a.finals.length === b.finals.length && a.finals.every((f, i) => sameFinal(f, b.finals[i], mode));
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

/** 两种颜色同韵（按档）就合并：留先建的（rules 数组里靠前的），另一种的格子全部改成它 */
export function mergeSameRules(state: RulesState, mode: RhymeMatchMode): RulesState & { merged: MergeInfo[] } {
  const merged: MergeInfo[] = [];
  let rules = state.rules;
  let paint = state.paint;
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      if (!sameRhyme(rules[i], rules[j], mode)) continue;
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

export function addRule(state: RulesState, mode: RhymeMatchMode, init: { count?: number; finals?: string[]; id?: string } = {}): RulesState & { rule: RhymeRule | null; merged: MergeInfo[] } {
  const rule = createRule(state.rules, init);
  if (!rule) return { ...state, rule: null, merged: [] };
  const m = mergeSameRules({ rules: [...state.rules, rule], paint: state.paint }, mode);
  return { ...m, rule: m.rules.find((r) => r.id === rule.id) ?? null };
}

export function updateRule(state: RulesState, id: string, patch: { count?: number; finals?: string[] }, mode: RhymeMatchMode): RulesState & { merged: MergeInfo[] } {
  const rules = state.rules.map((r) => {
    if (r.id !== id) return r;
    const count = patch.count !== undefined ? clampCount(patch.count) : r.count;
    const finals = fitFinals(patch.finals ?? r.finals, count);
    return { ...r, count, finals };
  });
  return mergeSameRules({ rules, paint: state.paint }, mode);
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
export function rhymeSlots(grid: Grid, rules: RhymeRule[], paint: Paint, mode: RhymeMatchMode): RhymeSlot[] {
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
export function mismatches(grid: Grid, rules: RhymeRule[], paint: Paint, mode: RhymeMatchMode): RhymeSlot[] {
  return rhymeSlots(grid, rules, paint, mode).filter((s) => s.ok === false);
}

// ---------- 切换判押韵的档（DESIGN_v34 §4.6 / §4.7） ----------

export interface RecolorInfo {
  /** 被并掉的规则 / 并进去的规则 */
  removed: string;
  kept: string;
  /** 被并掉的那条规则涂过的格子数 */
  cells: number;
  /** 两条规则色相不同：这些格子会变色 */
  recolor: boolean;
}

export interface RhymeMatchChange extends RulesState {
  mode: RhymeMatchMode;
  merged: RecolorInfo[];
}

/** 改档：换档 + 按新档合并同韵颜色（界面上算一步）；规则里的韵母不改写 */
export function switchRhymeMatch(state: RulesState, mode: RhymeMatchMode): RhymeMatchChange {
  const m = mergeSameRules(state, mode);
  const byId = new Map(state.rules.map((r) => [r.id, r]));
  // 链式合并（C 并进 B、B 并进 A）时以最后留下的那条为准
  const finalOf = (id: string): string => {
    const hit = m.merged.find((x) => x.removed === id);
    return hit ? finalOf(hit.kept) : id;
  };
  const merged = m.merged.map(({ removed, kept }) => {
    const to = finalOf(kept);
    const cells = Object.values(state.paint).filter((v) => v === removed).length;
    return { removed, kept: to, cells, recolor: byId.get(removed)?.hue !== byId.get(to)?.hue };
  });
  return { mode, rules: m.rules, paint: m.paint, merged };
}

export interface RhymeMatchPreview {
  from: RhymeMatchMode;
  to: RhymeMatchMode;
  /** 现在 / 改了以后全曲「不押」几处 */
  missBefore: number;
  missAfter: number;
  rulesBefore: number;
  rulesAfter: number;
  /** 改了以后颜色有变化的格子数（同色相合并不算） */
  recolorCells: number;
  merged: RecolorInfo[];
  /** 改了以后不再「不押」的位置，按颜色（色相）分：几处、哪几个字（按出现顺序去重） */
  resolved: { hue: number; count: number; chars: string[] }[];
}

/** 改档之前先算一遍：「不押」少几处、哪些颜色合并、哪些格子变色（迁移横幅上的数字） */
export function previewRhymeMatch(grid: Grid, state: RulesState, from: RhymeMatchMode, to: RhymeMatchMode): RhymeMatchPreview {
  const next = switchRhymeMatch(state, to);
  const before = mismatches(grid, state.rules, state.paint, from);
  const after = new Set(mismatches(grid, next.rules, next.paint, to).map((m) => m.abs));
  const hueOf = new Map(state.rules.map((r) => [r.id, r.hue]));
  const resolved: RhymeMatchPreview['resolved'] = [];
  for (const m of before) {
    if (after.has(m.abs)) continue;
    const hue = hueOf.get(m.ruleId) ?? 0;
    let row = resolved.find((x) => x.hue === hue);
    if (!row) resolved.push((row = { hue, count: 0, chars: [] }));
    row.count += 1;
    const ch = Array.from(m.word.text).pop() ?? '';
    if (ch && !row.chars.includes(ch)) row.chars.push(ch);
  }
  resolved.sort((a, b) => b.count - a.count);
  return {
    from,
    to,
    missBefore: before.length,
    missAfter: after.size,
    resolved,
    rulesBefore: state.rules.length,
    rulesAfter: next.rules.length,
    recolorCells: next.merged.filter((m) => m.recolor).reduce((n, m) => n + m.cells, 0),
    merged: next.merged,
  };
}
