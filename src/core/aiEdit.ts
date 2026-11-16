/**
 * 接上 AI 之后的两种改写（静态版界面不挂载入口，这里只是逻辑）：
 *
 * 1. 一次填韵（planRhymeFill / applyRhymeFill）：只填涂了色、而且一个字都还没写的格子里的韵脚位置，
 *    已经写了字的格子整格跳过；锁定的韵脚位置也不填。
 * 2. 选区润色（buildPolishRequest / applyPolish）：全文给 AI 当上下文，只改选区；
 *    默认保持骨架（字数、落点、长度都不变，只换字），另有「允许改 flow」开关。
 *
 * 两种结果上屏前都先过 locks.checkChanges 逐字比对：选区外或锁定位置有任何改动，整份作废，表格保持原样。
 */

import { allBars, allWords, cellKey, insertWord, setWordText, TICKS_PER_BAR, TICKS_PER_BEAT, totalTicks, wordsInCell, type Grid } from './grid';
import { checkChanges, lockedWordTicks, type CheckResult, type LockContext } from './locks';
import { rhymeSlots } from './rhymeRules';

// ---------- 一次填韵 ----------

export interface FillTarget {
  key: string;
  /** 全曲绝对起点 */
  abs: number;
  want: string;
}

/** 要填的韵脚位置：涂了色、格子里一个字都没写、不在锁定位置 */
export function planRhymeFill(grid: Grid, ctx: LockContext): FillTarget[] {
  const bars = allBars(grid);
  const written = new Set<string>();
  for (const b of bars) {
    for (let beat = 0; beat < 4; beat++) if (wordsInCell(b.data, beat).some((w) => w.text)) written.add(cellKey(b.data.id, beat));
  }
  const locked = lockedWordTicks(grid, ctx);
  return rhymeSlots(grid, ctx.rules, ctx.paint)
    .filter((s) => !written.has(s.key) && !locked.has(s.abs))
    .map((s) => ({ key: s.key, abs: s.abs, want: s.want }));
}

export interface FillAnswer {
  abs: number;
  text: string;
}

export interface ApplyResult {
  ok: boolean;
  grid: Grid;
  check: CheckResult;
}

/**
 * 把 AI 给的字填进去。AI 只许写 planRhymeFill 给出的位置：
 * 写到别的位置（已写字的格子、锁定位置、没涂色的格子）就整份作废，返回原网格。
 */
export function applyRhymeFill(grid: Grid, ctx: LockContext, answers: FillAnswer[]): ApplyResult {
  const targets = planRhymeFill(grid, ctx);
  const allowed = new Set(targets.map((t) => t.abs));
  const byAbs = new Map(allWords(grid).map((w) => [w.abs, w]));
  let out = grid;
  for (const a of answers) {
    const w = byAbs.get(a.abs);
    const text = Array.from(a.text.trim()).slice(0, 1).join('');
    if (w) out = setWordText(out, w.word.id, text);
    else if (a.abs >= 0 && a.abs < totalTicks(out)) out = insertWord(out, a.abs, 12, text);
  }
  // 「选区」= 只有要填的那几个字所在的格；再用位置白名单兜一层：格子里别的字也不许动
  const scope = new Set(targets.map((t) => t.key));
  const check = checkChanges(grid, out, { ...ctx, scope, keepSkeleton: true });
  const extra = check.changes.filter((c) => !allowed.has(c.abs)).map((c) => ({ ...c, reason: 'outside' as const }));
  const violations = [...check.violations, ...extra.filter((e) => !check.violations.some((v) => v.abs === e.abs))];
  const ok = violations.length === 0;
  return { ok, grid: ok ? out : grid, check: { ...check, ok, violations } };
}

// ---------- 选区润色 ----------

export interface PolishOptions {
  /** 默认 true：字数和落点都不变，只换字 */
  keepSkeleton: boolean;
  /** 默认 false */
  allowFlow: boolean;
}

export const DEFAULT_POLISH: PolishOptions = { keepSkeleton: true, allowFlow: false };

export interface PolishLine {
  /** 全曲第几个小节 */
  bar: number;
  /** 这一小节的字（选区里的才可改） */
  words: { abs: number; len: number; text: string; editable: boolean; locked: boolean }[];
}

export interface PolishRequest {
  /** 全文每小节一行，给 AI 当上下文 */
  context: string[];
  lines: PolishLine[];
  options: PolishOptions;
}

export function buildPolishRequest(grid: Grid, ctx: LockContext, scope: Set<string>, options: PolishOptions = DEFAULT_POLISH): PolishRequest {
  const bars = allBars(grid);
  const locked = lockedWordTicks(grid, ctx);
  const context = bars.map((b) => b.data.words.map((w) => w.text).join(''));
  const lines: PolishLine[] = [];
  for (const b of bars) {
    const inScope = [0, 1, 2, 3].some((beat) => scope.has(cellKey(b.data.id, beat)));
    if (!inScope) continue;
    lines.push({
      bar: b.global,
      words: b.data.words.map((w) => {
        const abs = b.global * TICKS_PER_BAR + w.tick;
        const isLocked = locked.has(abs);
        return { abs, len: w.len, text: w.text, editable: scope.has(cellKey(b.data.id, Math.floor(w.tick / TICKS_PER_BEAT))) && !isLocked, locked: isLocked };
      }),
    });
  }
  return { context, lines, options: { ...options, keepSkeleton: !options.allowFlow && options.keepSkeleton } };
}

/**
 * AI 的结果：保持骨架时是每个位置的新字（abs → text）；允许改 flow 时可以给新的字列表（abs、len、text）。
 * 先算出候选网格，再逐字比对；不通过就整份作废。
 */
export function applyPolish(
  grid: Grid,
  ctx: LockContext,
  scope: Set<string>,
  options: PolishOptions,
  result: { texts?: FillAnswer[]; words?: { abs: number; len: number; text: string }[] },
): ApplyResult {
  let out = grid;
  const byAbs = new Map(allWords(grid).map((w) => [w.abs, w]));
  if (result.texts) {
    for (const t of result.texts) {
      const w = byAbs.get(t.abs);
      if (w) out = setWordText(out, w.word.id, t.text);
      else if (t.abs >= 0 && t.abs < totalTicks(out)) out = insertWord(out, t.abs, 12, t.text);
    }
  }
  if (result.words) {
    // 允许改 flow：AI 给出的字整体替换它覆盖到的那些小节里的字
    const barsTouched = new Set(result.words.map((w) => Math.floor(w.abs / TICKS_PER_BAR)));
    const removeIds = allWords(out)
      .filter((w) => barsTouched.has(w.global))
      .map((w) => w.word.id);
    let g = out;
    g = { ...g, sections: g.sections.map((s) => ({ ...s, bars: s.bars.map((b) => ({ ...b, words: b.words.filter((w) => !removeIds.includes(w.id)) })) })) };
    for (const w of [...result.words].sort((a, b) => a.abs - b.abs)) {
      if (w.abs >= 0 && w.abs < totalTicks(g) && w.len >= 1) g = insertWord(g, w.abs, w.len, w.text);
    }
    out = g;
  }
  const keepSkeleton = !options.allowFlow && options.keepSkeleton;
  const check = checkChanges(grid, out, { ...ctx, scope, keepSkeleton });
  return { ok: check.ok, grid: check.ok ? out : grid, check };
}
