/**
 * 铺 flow：按落点精度放字、拉长字（拖音 = 字的长度）、复制一行的节奏；
 * 以及表格怎么画一个字（字框那一段 + 后面的细线）和手机上的最小字宽、导唱的发声序列。
 */

import {
  allWords,
  barAt,
  findWord,
  insertWord,
  removeWords,
  resizeWord,
  TICKS_PER_BAR,
  TICKS_PER_BEAT,
  totalTicks,
  wordStartingAt,
  type Bar,
  type Grid,
  type Word,
} from './grid';

export type Precision = '1/8' | '1/16' | '1/32' | 't3' | 't6';

export interface PrecisionInfo {
  key: Precision;
  label: string;
  /** 一个精度单位多少 tick */
  unit: number;
}

/** 1/8 = 24、1/16 = 12、1/32 = 6、三连 = 16（一拍 3 个）、半拍三连 = 8（一拍 6 个） */
export const PRECISIONS: PrecisionInfo[] = [
  { key: '1/8', label: '1/8', unit: 24 },
  { key: '1/16', label: '1/16', unit: 12 },
  { key: '1/32', label: '1/32', unit: 6 },
  { key: 't3', label: '三连', unit: 16 },
  { key: 't6', label: '半拍三连', unit: 8 },
];

export function precisionUnit(p: Precision): number {
  return PRECISIONS.find((x) => x.key === p)?.unit ?? 12;
}

/** 绝对 tick 按精度往前吸附到这一拍里的落点 */
export function snapTick(absTick: number, p: Precision): number {
  const unit = precisionUnit(p);
  const beatStart = Math.floor(absTick / TICKS_PER_BEAT) * TICKS_PER_BEAT;
  return beatStart + Math.floor((absTick - beatStart) / unit) * unit;
}

/** 铺一个字：吸附到落点，长度一个精度单位；这里已经有字开头就不动 */
export function placeWord(grid: Grid, absTick: number, p: Precision): Grid {
  const at = snapTick(absTick, p);
  if (at < 0 || at >= totalTicks(grid)) return grid;
  if (wordStartingAt(grid, at)) return grid;
  return insertWord(grid, at, precisionUnit(p));
}

/** 按 - 键：多拖一个精度单位（steps 可以是负数，往回缩） */
export function extendWord(grid: Grid, id: string, p: Precision, steps = 1): Grid {
  const loc = findWord(grid, id);
  if (!loc) return grid;
  return resizeWord(grid, id, loc.word.len + steps * precisionUnit(p));
}

/** 拖字框右边缘：结束位置吸附到精度落点（至少留一个单位或原长中较短者） */
export function stretchWordTo(grid: Grid, id: string, endAbs: number, p: Precision): Grid {
  const loc = findWord(grid, id);
  if (!loc) return grid;
  const unit = precisionUnit(p);
  const rel = Math.max(1, endAbs - loc.abs);
  const snapped = Math.max(Math.min(unit, loc.word.len), Math.round(rel / unit) * unit);
  return resizeWord(grid, id, snapped);
}

/** 把第 globalBar 小节的 flow（字的位置和长度，不带文字）复制到下一小节，替换那里原来的字 */
export function copyFlowToNextBar(grid: Grid, globalBar: number): Grid {
  const src = barAt(grid, globalBar);
  const dst = barAt(grid, globalBar + 1);
  if (!src || !dst) return grid;
  let out = removeWords(grid, dst.words.map((w) => w.id));
  const base = (globalBar + 1) * TICKS_PER_BAR;
  for (const w of src.words) out = insertWord(out, base + w.tick, w.len);
  return out;
}

/** 清空一小节的字 */
export function clearBar(grid: Grid, globalBar: number): Grid {
  const bar = barAt(grid, globalBar);
  if (!bar || !bar.words.length) return grid;
  return removeWords(grid, bar.words.map((w) => w.id));
}

// ---------- 画法：字框 + 细线 ----------

export type BeatMode = '' | 't3' | 't6';

/** 一拍是不是三连：有字落在 8 / 40 → 半拍三连；有字落在 16 / 32 → 三连 */
export function beatMode(words: Word[]): BeatMode {
  const offs = words.map((w) => w.tick % TICKS_PER_BEAT);
  if (offs.some((o) => o === 8 || o === 40)) return 't6';
  if (offs.some((o) => o === 16 || o === 32)) return 't3';
  return '';
}

/**
 * 字框那一段画多长（tick）：落在 1/32 半格上的 6，半拍三连 8，三连 16，其余一个 16 分（12）；
 * 字比这还短就按字长。超出部分画成字后面的细线。
 */
export function boxTicks(word: Word, mode: BeatMode): number {
  const off = word.tick % TICKS_PER_BEAT;
  const unit = off % 12 === 6 ? 6 : mode === 't6' ? 8 : mode === 't3' ? 16 : 12;
  return Math.min(word.len, unit);
}

/** 一小节里每拍的三连模式 */
export function barModes(bar: Bar): BeatMode[] {
  return [0, 1, 2, 3].map((beat) => beatMode(bar.words.filter((w) => Math.floor(w.tick / TICKS_PER_BEAT) === beat)));
}

// ---------- 手机上的最小字宽 ----------

/** 最小字宽：CJK 字是方块，字号 = 字宽 */
export const MIN_FONT_PX = 11;
/** 字框左右各留 1px 缝 */
export const BOX_GAP_PX = 2;
/** 字框边线 1px */
export const BOX_BORDER_PX = 1;

export interface WordSize {
  /** 字号 px */
  font: number;
  /** 去掉边线改浅底（多出 2px 给字） */
  dense: boolean;
}

/**
 * 字号 = 字框里放得下的宽度（最大 base），最小 11px；放不下 11px 先去边线。
 * 调用方保证格宽 ≥ minCellWidth，所以不会出现连去边线都放不下的字框。
 */
export function wordSize(box: number, cellWidth: number, base: number): WordSize {
  const boxPx = (box / TICKS_PER_BEAT) * cellWidth - BOX_GAP_PX;
  const inner = boxPx - 2 * BOX_BORDER_PX;
  if (inner >= base) return { font: base, dense: false };
  if (inner >= MIN_FONT_PX) return { font: Math.floor(inner), dense: false };
  return { font: Math.max(1, Math.min(MIN_FONT_PX, Math.floor(boxPx - 1))), dense: true };
}

/**
 * 整张表每拍（格子里面，不算格线）至少要多宽，字才放得下最小字宽（去边线的字框 ≥ 11px + 1px 余量）：
 * 1/32（6 tick）要 112px，半拍三连（8 tick）要 84px。手机上格子窄于这个值时整张表左右滑（用户 11-16 定的，不上下叠）。
 */
export function minCellWidth(grid: Grid): number {
  let minBox = 12;
  for (const bar of grid.sections.flatMap((s) => s.bars)) {
    const modes = barModes(bar);
    for (const w of bar.words) minBox = Math.min(minBox, boxTicks(w, modes[Math.floor(w.tick / TICKS_PER_BEAT)]));
  }
  return Math.ceil(((MIN_FONT_PX + 1 + BOX_GAP_PX) * TICKS_PER_BEAT) / minBox);
}

// ---------- 导唱 ----------

export interface GuideEvent {
  /** 全曲绝对起点 tick */
  abs: number;
  /** 持续多少 tick（按字的长度拉长） */
  len: number;
}

/** 导唱：每个字「嗒」一声，按字的长度拉长，空白不出声 */
export function guideEvents(grid: Grid): GuideEvent[] {
  return allWords(grid).map((w) => ({ abs: w.abs, len: w.word.len }));
}
