/**
 * 第 1 步的方格（v3.2）：方格 = 一个字（文字可以空着），空音 = 字和字之间的空白。数据模型不变，只是几种只动一拍的操作：
 * 一分为 n（空格 / Shift+空格）、变成空音、合并（空方格按 ⌫）、清空全部 flow（每拍一个方格）。
 * 所有操作都是纯函数，永远不碰别的拍里起点的字。规则见 design/DESIGN_v32.md 第 2 节。
 */

import {
  barAt,
  createWord,
  findWord,
  newId,
  normalize,
  TICKS_PER_BAR,
  TICKS_PER_BEAT,
  wordAt,
  wordStartingAt,
  BEATS_PER_BAR,
  type Bar,
  type Grid,
  type Word,
} from './grid';

/** 最细一块：1/32 = 6 tick */
export const MIN_SQUARE_TICKS = 6;

/** 方格画多宽：字在它起点那一拍里的长度（拖过拍线的部分是拖音） */
export function squareBox(word: Pick<Word, 'tick' | 'len'>): number {
  return Math.min(word.len, TICKS_PER_BEAT - (word.tick % TICKS_PER_BEAT));
}

/** 每拍一个占满整拍的空方格 */
export function defaultBarWords(): Word[] {
  return Array.from({ length: BEATS_PER_BAR }, (_, beat) => createWord({ tick: beat * TICKS_PER_BEAT, len: TICKS_PER_BEAT }));
}

/** 清空全部 flow：段落、小节（连 id）都留着，每一小节换成每拍一个空方格；文字、拖音、分格全清掉 */
export function resetFlow(grid: Grid): Grid {
  return { ...grid, sections: grid.sections.map((s) => ({ ...s, bars: s.bars.map((b) => ({ ...b, words: defaultBarWords() })) })) };
}

/** 还没铺过 flow：一个字都没写，而且每一小节要么是空的、要么正好是默认的每拍一个方格 */
export function isBlankFlow(grid: Grid): boolean {
  return grid.sections.every((s) =>
    s.bars.every((b) => !b.words.length || (b.words.length === BEATS_PER_BAR && b.words.every((w, i) => !w.text && w.tick === i * TICKS_PER_BEAT && w.len === TICKS_PER_BEAT))),
  );
}

/** 方格大小的名字（提示里用） */
export function squareName(ticks: number): string {
  return ({ 48: '1/4', 24: '1/8', 16: '三连', 12: '1/16', 8: '半拍三连', 6: '1/32' } as Record<number, string>)[ticks] ?? `${ticks} tick`;
}

function replaceBarWords(grid: Grid, barId: string, fn: (words: Word[]) => Word[]): Grid {
  return {
    ...grid,
    sections: grid.sections.map((s) => (s.bars.some((b) => b.id === barId) ? { ...s, bars: s.bars.map((b) => (b.id === barId ? { ...b, words: fn(b.words).sort((x, y) => x.tick - y.tick) } : b)) } : s)),
  };
}

export type SquareResult = { ok: true; grid: Grid; focus: number } | { ok: false; reason: 'no-square' | 'finest' | 'triplet' | 'whole' | 'finer' | 'both-text' | 'hold' };

/**
 * 一分为 n（2 = 空格，3 = Shift+空格）：方格宽 b，每块 u = b / n，必须是整数而且 ≥ 6。
 * 第一块沿用原来的字（文字留在左边），其余是新的空方格；拖过拍线的长度跟着最后一块走。focus = 第一块的起点。
 */
export function splitSquare(grid: Grid, abs: number, n: 2 | 3): SquareResult {
  const loc = wordStartingAt(grid, abs);
  if (!loc) return { ok: false, reason: 'no-square' };
  const w = loc.word;
  const b = squareBox(w);
  const u = b / n;
  if (!Number.isInteger(u) || u < MIN_SQUARE_TICKS) return { ok: false, reason: n === 2 ? 'finest' : 'triplet' };
  const hold = w.len - b;
  const pieces: Word[] = [{ ...w, len: u }];
  for (let i = 1; i < n; i++) pieces.push(createWord({ tick: w.tick + i * u, len: u + (i === n - 1 ? hold : 0) }));
  return { ok: true, grid: normalize(replaceBarWords(grid, loc.barId, (ws) => [...ws.filter((x) => x.id !== w.id), ...pieces])), focus: abs };
}

/** 变成空音：删掉这个方格（它拖过拍线的拖音也一起没了） */
export function restSquare(grid: Grid, abs: number): SquareResult {
  const loc = wordStartingAt(grid, abs);
  if (!loc) return { ok: false, reason: 'no-square' };
  return { ok: true, grid: replaceBarWords(grid, loc.barId, (ws) => ws.filter((x) => x.id !== loc.word.id)), focus: abs };
}

/** 一拍里的一块：方格（字）或空音（空白）；前一拍拖进来的那段不算块 */
interface Piece {
  off: number;
  len: number;
  word: Word | null;
}

function beatPieces(grid: Grid, globalBar: number, beat: number): { pieces: Piece[]; holdEnd: number } {
  const bar = barAt(grid, globalBar) as Bar;
  const c0 = globalBar * TICKS_PER_BAR + beat * TICKS_PER_BEAT;
  const into = wordAt(grid, c0);
  const holdEnd = into && into.abs < c0 ? Math.min(TICKS_PER_BEAT, into.abs + into.word.len - c0) : 0;
  const words = bar.words.filter((w) => Math.floor(w.tick / TICKS_PER_BEAT) === beat).sort((a, b) => a.tick - b.tick);
  const pieces: Piece[] = [];
  let at = holdEnd;
  for (const w of words) {
    const off = w.tick % TICKS_PER_BEAT;
    if (off > at) pieces.push({ off: at, len: off - at, word: null });
    pieces.push({ off, len: squareBox(w), word: w });
    at = off + squareBox(w);
  }
  if (at < TICKS_PER_BEAT) pieces.push({ off: at, len: TICKS_PER_BEAT - at, word: null });
  return { pieces, holdEnd };
}

/** [from, from + u·k) 正好是 k 块大小为 u 的方格 / 空音（空音可以连成一片，按 u 切开看） */
function slotsOf(pieces: Piece[], holdEnd: number, from: number, u: number, k: number): (Word | null)[] | null {
  if (from < holdEnd || from + u * k > TICKS_PER_BEAT) return null;
  const out: (Word | null)[] = [];
  for (let i = 0; i < k; i++) {
    const s = from + i * u;
    const p = pieces.find((x) => x.off <= s && s < x.off + x.len);
    if (!p) return null;
    if (p.word) {
      if (p.off !== s || p.len !== u) return null;
      out.push(p.word);
    } else {
      if (s + u > p.off + p.len) return null;
      out.push(null);
    }
  }
  return out;
}

/**
 * 合并：空方格（或光标停着的空音，abs + len）和它的「另一半」合回一个。
 * 一块大小 u：u = 16（三连）三块合成整拍；u = 8 先试半拍三连（三块合成半拍），不成再试两块；其余两块（二分）合一个。
 * 另一半是空音 → 这个方格把那段空白也占上；另一半分得更细 → finer；整拍一个方格 → whole；两块都有字 → both-text。
 * 合出来的方格用最左边那块的 id 和字（左边空就用右边的字），结束位置取最后一块的结束（拖音保留）。
 */
export function mergeSquare(grid: Grid, abs: number, restLen?: number): SquareResult {
  const globalBar = Math.floor(abs / TICKS_PER_BAR);
  const bar = barAt(grid, globalBar);
  if (!bar) return { ok: false, reason: 'no-square' };
  const beat = Math.floor((abs % TICKS_PER_BAR) / TICKS_PER_BEAT);
  const off = abs % TICKS_PER_BEAT;
  const loc = wordStartingAt(grid, abs);
  const u = loc ? squareBox(loc.word) : restLen;
  if (!u) return { ok: false, reason: 'no-square' };
  if (u >= TICKS_PER_BEAT) return { ok: false, reason: 'whole' };
  const { pieces, holdEnd } = beatPieces(grid, globalBar, beat);
  const groups: { from: number; k: number }[] = [];
  if (u === 16 || u === 8) groups.push({ from: off - (off % (u * 3)), k: 3 });
  if (TICKS_PER_BEAT % (u * 2) === 0 || u === 8) groups.push({ from: off - (off % (u * 2)), k: 2 });
  for (const g of groups) {
    const slots = slotsOf(pieces, holdEnd, g.from, u, g.k);
    if (!slots) continue;
    const words = slots.filter((x): x is Word => !!x);
    if (!words.length) return { ok: false, reason: 'no-square' };
    if (words.filter((w) => w.text).length > 1) return { ok: false, reason: 'both-text' };
    const keep = words[0];
    const last = slots[slots.length - 1];
    const end = last ? last.tick + last.len : beat * TICKS_PER_BEAT + g.from + u * g.k;
    const tick = beat * TICKS_PER_BEAT + g.from;
    const merged: Word = { ...keep, tick, len: end - tick, text: words.find((w) => w.text)?.text ?? '' };
    const drop = new Set(words.map((w) => w.id));
    return { ok: true, grid: normalize(replaceBarWords(grid, bar.id, (ws) => [...ws.filter((x) => !drop.has(x.id)), merged])), focus: globalBar * TICKS_PER_BAR + tick };
  }
  if (off < holdEnd) return { ok: false, reason: 'hold' };
  return { ok: false, reason: 'finer' };
}

/** 空音里打字：放回一个方格（大小 = 这段空音）并写上字 */
export function fillRest(grid: Grid, abs: number, len: number, text: string): SquareResult {
  const globalBar = Math.floor(abs / TICKS_PER_BAR);
  const bar = barAt(grid, globalBar);
  if (!bar) return { ok: false, reason: 'no-square' };
  const tick = abs % TICKS_PER_BAR;
  if (bar.words.some((w) => w.tick >= tick && w.tick < tick + len)) return { ok: false, reason: 'no-square' };
  const word = createWord({ id: newId('w'), tick, len, text });
  return { ok: true, grid: normalize(replaceBarWords(grid, bar.id, (ws) => [...ws, word])), focus: abs };
}

/**
 * 在方格里打字：第一个字写进 abs 这一格，多的字往后依次写进同一拍里的方格（不越过这一拍）。
 * 返回写了几个字、丢了几个字。
 */
export function typeIntoSquares(grid: Grid, abs: number, chars: string[]): { grid: Grid; written: number; dropped: number; last: number } {
  const loc = wordStartingAt(grid, abs);
  if (!loc || !chars.length) return { grid, written: 0, dropped: chars.length, last: abs };
  const beat = Math.floor(loc.word.tick / TICKS_PER_BEAT);
  const bar = barAt(grid, loc.global) as Bar;
  const targets = bar.words.filter((w) => Math.floor(w.tick / TICKS_PER_BEAT) === beat && w.tick >= loc.word.tick).sort((a, b) => a.tick - b.tick);
  const n = Math.min(chars.length, targets.length);
  const texts = new Map(targets.slice(0, n).map((w, i) => [w.id, chars[i]]));
  const out = replaceBarWords(grid, bar.id, (ws) => ws.map((w) => (texts.has(w.id) ? { ...w, text: texts.get(w.id)! } : w)));
  const lastWord = targets[n - 1];
  return { grid: out, written: n, dropped: chars.length - n, last: lastWord ? loc.global * TICKS_PER_BAR + lastWord.tick : abs };
}

/** 点格子：abs 落在哪个方格里（方格范围 = 起点到它在这一拍里结束） */
export function squareAt(grid: Grid, abs: number): number | null {
  const bar = barAt(grid, Math.floor(abs / TICKS_PER_BAR));
  if (!bar) return null;
  const t = abs % TICKS_PER_BAR;
  const w = bar.words.find((x) => x.tick <= t && t < x.tick + squareBox(x));
  return w ? Math.floor(abs / TICKS_PER_BAR) * TICKS_PER_BAR + w.tick : null;
}

/** 字 id → 它现在的起点（撤销后重新找光标用） */
export function wordAbs(grid: Grid, id: string): number | null {
  return findWord(grid, id)?.abs ?? null;
}
