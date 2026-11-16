/**
 * 锁定：整行（小节）、整列（拍）、选中的格子、全部韵脚位置。
 * 锁住的字不能改字、不能挪落点、不能改长度，AI 也不许动。
 *
 * AI 结果上屏前逐字比对（checkChanges）：选区外或锁定位置有任何改动，整份作废。
 */

import { allBars, allWords, cellKey, TICKS_PER_BAR, TICKS_PER_BEAT, type Grid } from './grid';
import { rhymeSlots, type Paint, type RhymeRule } from './rhymeRules';

export interface Locks {
  /** 整行锁：小节 id */
  bars: string[];
  /** 整列锁：拍（0–3） */
  beats: number[];
  /** 单独锁的格子：CellKey */
  cells: string[];
  /** 锁全部韵脚位置 */
  rhyme: boolean;
}

export function emptyLocks(): Locks {
  return { bars: [], beats: [], cells: [], rhyme: false };
}

export function isCellLocked(locks: Locks, barId: string, beat: number): boolean {
  return locks.bars.includes(barId) || locks.beats.includes(beat) || locks.cells.includes(cellKey(barId, beat));
}

export function hasAnyLock(locks: Locks): boolean {
  return locks.bars.length > 0 || locks.beats.length > 0 || locks.cells.length > 0 || locks.rhyme;
}

function toggle<T>(list: T[], items: T[], on: boolean): T[] {
  const set = new Set(list);
  for (const x of items) {
    if (on) set.add(x);
    else set.delete(x);
  }
  return [...set];
}

export function setBarLocks(locks: Locks, barIds: string[], on: boolean): Locks {
  return { ...locks, bars: toggle(locks.bars, barIds, on) };
}

export function setBeatLocks(locks: Locks, beats: number[], on: boolean): Locks {
  return { ...locks, beats: toggle(locks.beats, beats, on).sort() };
}

export function setCellLocks(locks: Locks, keys: string[], on: boolean): Locks {
  return { ...locks, cells: toggle(locks.cells, keys, on) };
}

export function setRhymeLock(locks: Locks, on: boolean): Locks {
  return locks.rhyme === on ? locks : { ...locks, rhyme: on };
}

/** 去掉指向已删除小节的锁 */
export function pruneLocks(grid: Grid, locks: Locks): Locks {
  const ids = new Set(allBars(grid).map((b) => b.data.id));
  const bars = locks.bars.filter((id) => ids.has(id));
  const cells = locks.cells.filter((k) => ids.has(k.slice(0, k.lastIndexOf(':'))));
  return bars.length === locks.bars.length && cells.length === locks.cells.length ? locks : { ...locks, bars, cells };
}

export interface LockContext {
  locks: Locks;
  rules: RhymeRule[];
  paint: Paint;
}

/** 被锁住的字的起点（全曲绝对 tick）：所在格锁了，或者锁了韵脚位置且它是韵脚字 */
export function lockedWordTicks(grid: Grid, ctx: LockContext): Set<number> {
  const out = new Set<number>();
  for (const w of allWords(grid)) {
    if (isCellLocked(ctx.locks, w.barId, Math.floor(w.word.tick / TICKS_PER_BEAT))) out.add(w.abs);
  }
  if (ctx.locks.rhyme) for (const s of rhymeSlots(grid, ctx.rules, ctx.paint)) out.add(s.abs);
  return out;
}

export type ChangeReason = 'outside' | 'locked' | 'skeleton' | 'structure';

export interface Change {
  /** 全曲第几个小节（0 起） */
  bar: number;
  beat: number;
  /** 改动位置的全曲绝对 tick */
  abs: number;
  before: string | null;
  after: string | null;
  reason: ChangeReason;
}

export interface CheckOptions extends LockContext {
  /** 允许改动的格子（CellKey）；为空 = 哪里都不许改 */
  scope: Set<string>;
  /** 保持骨架：字数和每个字的落点、长度都不许变，只许换字 */
  keepSkeleton: boolean;
}

export interface CheckResult {
  ok: boolean;
  changes: Change[];
  violations: Change[];
}

/**
 * 逐字比对 before / after：每一个起点上的字（有无、长度、文字）都比一遍，
 * 改动落在选区外 → outside；落在锁定位置 → locked；保持骨架却动了字数 / 落点 / 长度 → skeleton。
 * 小节数、段落结构变了 → structure。有任何一条违规就整份作废（ok = false）。
 */
export function checkChanges(before: Grid, after: Grid, opts: CheckOptions): CheckResult {
  const bBars = allBars(before);
  const aBars = allBars(after);
  const changes: Change[] = [];
  const violations: Change[] = [];
  const sameStructure =
    bBars.length === aBars.length &&
    before.sections.length === after.sections.length &&
    bBars.every((b, i) => b.data.id === aBars[i].data.id);
  if (!sameStructure) {
    const v: Change = { bar: 0, beat: 0, abs: 0, before: null, after: null, reason: 'structure' };
    return { ok: false, changes: [v], violations: [v] };
  }
  const locked = lockedWordTicks(before, opts);
  const map = (g: Grid) => new Map(allWords(g).map((w) => [w.abs, w.word]));
  const bm = map(before);
  const am = map(after);
  const ticks = [...new Set([...bm.keys(), ...am.keys()])].sort((x, y) => x - y);
  for (const abs of ticks) {
    const b = bm.get(abs);
    const a = am.get(abs);
    const textChanged = (b?.text ?? null) !== (a?.text ?? null);
    const shapeChanged = !b || !a || b.len !== a.len;
    if (!textChanged && !shapeChanged) continue;
    const bar = Math.floor(abs / TICKS_PER_BAR);
    const beat = Math.floor((abs % TICKS_PER_BAR) / TICKS_PER_BEAT);
    const key = cellKey(bBars[bar].data.id, beat);
    const change: Change = { bar, beat, abs, before: b ? b.text : null, after: a ? a.text : null, reason: 'outside' };
    changes.push(change);
    if (!opts.scope.has(key)) violations.push({ ...change, reason: 'outside' });
    else if (locked.has(abs) || isCellLocked(opts.locks, bBars[bar].data.id, beat)) violations.push({ ...change, reason: 'locked' });
    else if (opts.keepSkeleton && shapeChanged) violations.push({ ...change, reason: 'skeleton' });
  }
  return { ok: violations.length === 0, changes, violations };
}

export const CHANGE_REASON_TEXT: Record<ChangeReason, string> = {
  outside: '在选区外',
  locked: '锁定的字',
  skeleton: '改了字数或落点（保持骨架开着）',
  structure: '改了小节结构',
};
