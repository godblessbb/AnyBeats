/**
 * 把 core 的数据算成表格要画的东西（纯函数，不碰 DOM）。
 *
 * 一行 = 一小节，一格 = 一拍。格子里没有字框：字直接写在落点上（宽度按 core/flow 的 boxTicks 留给字形），
 * 比字框长的字（拖音）从落点起铺一块同色浅底到字结束，越过格线、拖过一行末尾就接着铺在下一行第一格开头。
 * 一句超过一小节时超出的字自然落在下一行开头，不加任何续行标记。
 */

import {
  allBars,
  allWords,
  barModes,
  boxTicks,
  cellKey,
  isCellLocked,
  lockedWordTicks,
  mismatches,
  rhymeSlots,
  TICKS_PER_BAR,
  TICKS_PER_BEAT,
  TICKS_PER_STEP,
  type BeatMode,
  type CellContent,
  type Doc,
  type RhymeRule,
  type SectionKind,
} from '../core';

export interface WordView {
  id: string;
  /** 全曲绝对起点 */
  abs: number;
  /** 小节内起点 */
  tick: number;
  /** 拍内起点（0–47） */
  off: number;
  len: number;
  /** 字框那一段多长 */
  box: number;
  text: string;
  /** 这一位要押的韵母（是韵脚字时） */
  final: string | null;
  /** 韵脚字的颜色色相 */
  hue: number | null;
  /** 锁定（所在格锁了，或锁了韵脚位置且它是韵脚字） */
  locked: boolean;
  /** 锁了全部韵脚位置、而且它是韵脚字（字角画小锁） */
  rhymeLocked: boolean;
  /** 写了字但对不上本格颜色 */
  mismatch: { got: string; want: string } | null;
}

/** 拖音浅底的一段（按格切开） */
export interface TintView {
  /** 起点所在那个字 */
  wordId: string;
  /** 起点那个字所在的格（字归属它起点所在的格） */
  fromKey: string;
  fromBar: number;
  fromBeat: number;
  fromOff: number;
  /** 这一段在全曲里的 [s, e) */
  s: number;
  e: number;
  /** 从字的落点开始（这一段在字所在那一格） */
  head: boolean;
  /** 字在这一段结束 */
  tail: boolean;
  tone: 'rp' | 'ink' | 'empty';
  hue: number | null;
}

export interface CellView {
  key: string;
  barId: string;
  global: number;
  beat: number;
  content: CellContent;
  /** 涂的颜色（只有拖音 / 空格子不会有） */
  rule: RhymeRule | null;
  mode: BeatMode;
  words: WordView[];
  /** 经过这一格的拖音浅底（含起点在这一格的字自己那一段） */
  tints: TintView[];
  /** 只有拖音时：是哪个字拖过来的 */
  holdFrom: { bar: number; beat: number; text: string } | null;
  lockedCell: boolean;
  /** 单独锁了这一格（格角画小锁） */
  cellLockIcon: boolean;
}

export interface RowView {
  global: number;
  barId: string;
  section: number;
  cells: CellView[];
  /** 行尾：这一行涂了哪些颜色 */
  tags: RhymeRule[];
  barLocked: boolean;
}

export interface SectionView {
  index: number;
  id: string;
  kind: SectionKind;
  label: string;
  rows: RowView[];
}

export interface SheetView {
  sections: SectionView[];
  rows: RowView[];
  mismatchCount: number;
}

export function sheetView(doc: Doc): SheetView {
  const bars = allBars(doc.grid);
  const words = allWords(doc.grid);
  const rules = new Map(doc.rules.map((r) => [r.id, r]));
  const slots = rhymeSlots(doc.grid, doc.rules, doc.paint);
  const slotByAbs = new Map(slots.map((s) => [s.abs, s]));
  const missByAbs = new Map(mismatches(doc.grid, doc.rules, doc.paint).map((m) => [m.abs, m]));
  const locked = lockedWordTicks(doc.grid, doc);

  const wordView = new Map<number, WordView>();
  const modesOf = bars.map((b) => barModes(b.data));
  for (const w of words) {
    const beat = Math.floor(w.word.tick / TICKS_PER_BEAT);
    const slot = slotByAbs.get(w.abs);
    const rule = slot ? rules.get(slot.ruleId) : undefined;
    const miss = missByAbs.get(w.abs);
    wordView.set(w.abs, {
      id: w.word.id,
      abs: w.abs,
      tick: w.word.tick,
      off: w.word.tick % TICKS_PER_BEAT,
      len: w.word.len,
      box: boxTicks(w.word, modesOf[w.global][beat]),
      text: w.word.text,
      final: slot ? slot.want : null,
      hue: rule ? rule.hue : null,
      locked: locked.has(w.abs),
      rhymeLocked: !!slot && doc.locks.rhyme,
      mismatch: miss && miss.got ? { got: miss.got, want: miss.want } : null,
    });
  }

  // 拖音浅底：每个比字框长的字，从落点铺到字结束，按格切段
  const segsByCell = new Map<string, TintView[]>();
  for (const w of words) {
    const v = wordView.get(w.abs)!;
    const ls = w.abs;
    const le = w.abs + w.word.len;
    if (w.word.len <= v.box) continue;
    const fromBeat = Math.floor(w.word.tick / TICKS_PER_BEAT);
    for (let c0 = Math.floor(ls / TICKS_PER_BEAT) * TICKS_PER_BEAT; c0 < le; c0 += TICKS_PER_BEAT) {
      const g = Math.floor(c0 / TICKS_PER_BAR);
      const bar = bars[g];
      if (!bar) break;
      const key = cellKey(bar.data.id, Math.floor((c0 % TICKS_PER_BAR) / TICKS_PER_BEAT));
      const s = Math.max(ls, c0);
      const e = Math.min(le, c0 + TICKS_PER_BEAT);
      const list = segsByCell.get(key) ?? [];
      list.push({
        wordId: w.word.id,
        fromKey: cellKey(w.barId, fromBeat),
        fromBar: w.global,
        fromBeat,
        fromOff: v.off,
        s,
        e,
        head: s === ls,
        tail: e === le,
        tone: v.hue !== null ? 'rp' : v.text ? 'ink' : 'empty',
        hue: v.hue,
      });
      segsByCell.set(key, list);
    }
  }

  const rows: RowView[] = bars.map((b) => {
    const cells: CellView[] = [0, 1, 2, 3].map((beat) => {
      const key = cellKey(b.data.id, beat);
      const ws = b.data.words.filter((w) => Math.floor(w.tick / TICKS_PER_BEAT) === beat).map((w) => wordView.get(b.global * TICKS_PER_BAR + w.tick)!);
      const segs = segsByCell.get(key) ?? [];
      // 没有新字、但有前面拖过来的浅底经过 → 只有拖音
      const content: CellContent = ws.length ? 'words' : segs.length ? 'hold-only' : 'empty';
      const rule = content === 'words' ? (rules.get(doc.paint[key]) ?? null) : null;
      const from = content === 'hold-only' ? segs[0] : null;
      const fromWord = from ? words.find((w) => w.word.id === from.wordId) : null;
      return {
        key,
        barId: b.data.id,
        global: b.global,
        beat,
        content,
        rule,
        mode: modesOf[b.global][beat],
        words: ws,
        tints: segs,
        holdFrom: from && fromWord ? { bar: from.fromBar, beat: from.fromBeat, text: fromWord.word.text } : null,
        lockedCell: isCellLocked(doc.locks, b.data.id, beat),
        cellLockIcon: doc.locks.cells.includes(key),
      };
    });
    const tags: RhymeRule[] = [];
    for (const c of cells) if (c.rule && !tags.includes(c.rule)) tags.push(c.rule);
    return { global: b.global, barId: b.data.id, section: b.section, cells, tags, barLocked: doc.locks.bars.includes(b.data.id) };
  });

  const sections: SectionView[] = doc.grid.sections.map((s, i) => ({
    index: i,
    id: s.id,
    kind: s.kind,
    label: s.label,
    rows: rows.filter((r) => r.section === i),
  }));
  return { sections, rows, mismatchCount: missByAbs.size };
}

// ---------- 显示用小工具 ----------

/** 位置：小节 · 拍 · 第几个 16 分（都从 1 起） */
export function formatPosition(absTick: number | null): string {
  if (absTick === null || absTick < 0) return '1 · 1 · 1';
  const bar = Math.floor(absTick / TICKS_PER_BAR) + 1;
  const inBar = absTick % TICKS_PER_BAR;
  return `${bar} · ${Math.floor(inBar / TICKS_PER_BEAT) + 1} · ${Math.floor((inBar % TICKS_PER_BEAT) / TICKS_PER_STEP) + 1}`;
}

export function formatClock(seconds: number, tenths = true): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return tenths ? `${m}:${rest.toFixed(1).padStart(4, '0')}` : `${m}:${String(Math.floor(rest)).padStart(2, '0')}`;
}

/** 播放从哪一格（1/16）开始：选中了字就从那个字所在的 16 分，否则从头 */
export function playFrom(selection: { focus: number } | null): number {
  return selection ? Math.floor(selection.focus / TICKS_PER_STEP) : 0;
}

/** 一格的中文名：「第 7 小节第 2 拍」 */
export function cellName(global: number, beat: number): string {
  return `第 ${global + 1} 小节第 ${beat + 1} 拍`;
}

const TONE_MARKS: Record<string, string> = {
  a: 'āáǎà',
  o: 'ōóǒò',
  e: 'ēéěè',
  i: 'īíǐì',
  u: 'ūúǔù',
  ü: 'ǖǘǚǜ',
};

/** 无调拼音 + 声调 → 带调号拼音（yan, 3 → yǎn），只用于显示 */
export function toneMark(pinyin: string, tone: number): string {
  const py = pinyin.replace(/v/g, 'ü');
  if (tone < 1 || tone > 4) return py;
  let idx = py.search(/[ae]/);
  if (idx < 0) idx = py.indexOf('ou');
  if (idx < 0) {
    for (let i = py.length - 1; i >= 0; i--) {
      if ('iouü'.includes(py[i])) {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) return py;
  return py.slice(0, idx) + TONE_MARKS[py[idx]][tone - 1] + py.slice(idx + 1);
}
