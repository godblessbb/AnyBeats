/**
 * 歌词数据模型（v3）：段落 → 小节 → 字。
 *
 * 格子只是视图，数据里记的是 tick：每拍 48 tick，一小节 4 拍 = 192 tick。
 * 每个字只记「从小节里第几个 tick 开始、持续多少 tick」。拖音不是单独的格子，就是字的长度：
 * 字可以拖过拍线、拖过小节线（拖到下一行开头）。空音 = 字和字之间留出的空白，不存。
 *
 * 不变式（normalize 维护）：按全曲顺序，前一个字的结束 ≤ 后一个字的起点；字不越过全曲末尾。
 * 所有操作都是纯函数：输入旧 Grid，返回新 Grid，不改原对象；撤销 / 重做见 history.ts。
 */

export const TICKS_PER_BEAT = 48;
export const BEATS_PER_BAR = 4;
export const TICKS_PER_BAR = TICKS_PER_BEAT * BEATS_PER_BAR;
/** 1/16 音符：时钟、节拍器的步长单位 */
export const STEPS_PER_BEAT = 4;
export const STEPS_PER_BAR = STEPS_PER_BEAT * BEATS_PER_BAR;
export const TICKS_PER_STEP = TICKS_PER_BEAT / STEPS_PER_BEAT;

export type SectionKind = 'intro' | 'verse' | 'hook' | 'bridge' | 'outro';

export const SECTION_KINDS: SectionKind[] = ['intro', 'verse', 'hook', 'bridge', 'outro'];

/** 段落标签用英文（11-16 决定） */
export const SECTION_KIND_NAMES: Record<SectionKind, string> = {
  intro: 'Intro',
  verse: 'Verse',
  hook: 'Hook',
  bridge: 'Bridge',
  outro: 'Outro',
};

export interface Word {
  id: string;
  /** 小节内起点，0–191 */
  tick: number;
  /** 持续多少 tick，≥ 1；可以越过小节末尾 */
  len: number;
  /** 一个字；铺 flow 时可以先空着 */
  text: string;
}

export interface Bar {
  id: string;
  /** 按 tick 升序 */
  words: Word[];
}

export interface Section {
  id: string;
  kind: SectionKind;
  label: string;
  bars: Bar[];
}

export interface Grid {
  sections: Section[];
}

export interface BarAddress {
  section: number;
  bar: number;
}

export interface TickAddress extends BarAddress {
  /** 小节内第几个 tick */
  tick: number;
}

export class GridError extends Error {}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function createWord(init: { tick: number; len: number; text?: string; id?: string }): Word {
  const w: Word = { id: init.id ?? newId('w'), tick: init.tick, len: init.len, text: init.text ?? '' };
  if (!Number.isInteger(w.tick) || w.tick < 0 || w.tick >= TICKS_PER_BAR) throw new GridError(`字的起点 ${w.tick} 不在 0–${TICKS_PER_BAR - 1}`);
  if (!Number.isInteger(w.len) || w.len < 1) throw new GridError(`字的长度 ${w.len} 不合法`);
  return w;
}

export function createBar(words: Word[] = []): Bar {
  return { id: newId('b'), words: sortWords(words) };
}

export function sectionLabel(kind: SectionKind, n?: number): string {
  return n ? `${SECTION_KIND_NAMES[kind]} ${n}` : SECTION_KIND_NAMES[kind];
}

export function createSection(kind: SectionKind, bars = 4, label = sectionLabel(kind)): Section {
  return { id: newId('s'), kind, label, bars: Array.from({ length: bars }, () => createBar()) };
}

export function createGrid(sections: Section[] = [createSection('verse', 8, 'Verse 1')]): Grid {
  return { sections };
}

function sortWords(words: Word[]): Word[] {
  return [...words].sort((a, b) => a.tick - b.tick);
}

// ---------- 定位 ----------

export function barCount(grid: Grid): number {
  return grid.sections.reduce((n, s) => n + s.bars.length, 0);
}

export function totalTicks(grid: Grid): number {
  return barCount(grid) * TICKS_PER_BAR;
}

export function totalSteps(grid: Grid): number {
  return barCount(grid) * STEPS_PER_BAR;
}

/** 全曲第几个小节（从 0 起） */
export function globalBarIndex(grid: Grid, addr: BarAddress): number {
  let n = 0;
  for (let i = 0; i < addr.section; i++) n += grid.sections[i].bars.length;
  return n + addr.bar;
}

export function barAddressOf(grid: Grid, globalBar: number): BarAddress | null {
  if (globalBar < 0) return null;
  let rest = globalBar;
  for (let s = 0; s < grid.sections.length; s++) {
    const len = grid.sections[s].bars.length;
    if (rest < len) return { section: s, bar: rest };
    rest -= len;
  }
  return null;
}

/** 全曲小节列表（按顺序），带全曲序号 */
export function allBars(grid: Grid): { section: number; bar: number; global: number; data: Bar }[] {
  const out: { section: number; bar: number; global: number; data: Bar }[] = [];
  grid.sections.forEach((s, si) => s.bars.forEach((b, bi) => out.push({ section: si, bar: bi, global: out.length, data: b })));
  return out;
}

export function barAt(grid: Grid, globalBar: number): Bar | null {
  const a = barAddressOf(grid, globalBar);
  return a ? grid.sections[a.section].bars[a.bar] : null;
}

export function globalBarOfId(grid: Grid, barId: string): number {
  return allBars(grid).findIndex((b) => b.data.id === barId);
}

/** 绝对 tick → 段落 / 小节 / 小节内 tick */
export function locateTick(grid: Grid, absTick: number): TickAddress | null {
  if (!Number.isFinite(absTick) || absTick < 0) return null;
  const t = Math.floor(absTick);
  const addr = barAddressOf(grid, Math.floor(t / TICKS_PER_BAR));
  return addr ? { ...addr, tick: t % TICKS_PER_BAR } : null;
}

export function absoluteTick(grid: Grid, addr: TickAddress): number {
  return globalBarIndex(grid, addr) * TICKS_PER_BAR + addr.tick;
}

export function getBar(grid: Grid, addr: BarAddress): Bar {
  const bar = grid.sections[addr.section]?.bars[addr.bar];
  if (!bar) throw new GridError(`没有小节 ${addr.section}/${addr.bar}`);
  return bar;
}

export interface WordLocation extends BarAddress {
  word: Word;
  /** 全曲第几个小节 */
  global: number;
  /** 全曲绝对起点 */
  abs: number;
  barId: string;
}

/** 按全曲顺序遍历所有字 */
export function* iterateWords(grid: Grid): Generator<WordLocation> {
  let global = 0;
  for (let s = 0; s < grid.sections.length; s++) {
    const bars = grid.sections[s].bars;
    for (let b = 0; b < bars.length; b++, global++) {
      for (const word of bars[b].words) yield { section: s, bar: b, word, global, abs: global * TICKS_PER_BAR + word.tick, barId: bars[b].id };
    }
  }
}

export function allWords(grid: Grid): WordLocation[] {
  return [...iterateWords(grid)];
}

export function findWord(grid: Grid, id: string): WordLocation | null {
  for (const loc of iterateWords(grid)) if (loc.word.id === id) return loc;
  return null;
}

/** 从 absTick 开始的字 */
export function wordStartingAt(grid: Grid, absTick: number): WordLocation | null {
  for (const loc of iterateWords(grid)) {
    if (loc.abs === absTick) return loc;
    if (loc.abs > absTick) break;
  }
  return null;
}

/** absTick 这一刻正在发声的字（起点 ≤ t < 结束），含前面拖过来的 */
export function wordAt(grid: Grid, absTick: number): WordLocation | null {
  let hit: WordLocation | null = null;
  for (const loc of iterateWords(grid)) {
    if (loc.abs > absTick) break;
    if (absTick < loc.abs + loc.word.len) hit = loc;
  }
  return hit;
}

/** 一格（某小节第几拍）的稳定键：用小节 id，插删小节后不串格 */
export function cellKey(barId: string, beat: number): string {
  return `${barId}:${beat}`;
}

export function parseCellKey(key: string): { barId: string; beat: number } {
  const i = key.lastIndexOf(':');
  return { barId: key.slice(0, i), beat: Number(key.slice(i + 1)) };
}

/** 起点落在这一格里的字（跨格的字归属它起点所在的格） */
export function wordsInCell(bar: Bar, beat: number): Word[] {
  return bar.words.filter((w) => Math.floor(w.tick / TICKS_PER_BEAT) === beat);
}

/** 这一格有没有被前面的字拖进来（起点在格子之前、结束在格子起点之后） */
export function holdInto(grid: Grid, globalBar: number, beat: number): WordLocation | null {
  const c0 = globalBar * TICKS_PER_BAR + beat * TICKS_PER_BEAT;
  const w = wordAt(grid, c0);
  return w && w.abs < c0 ? w : null;
}

export type CellContent = 'words' | 'hold-only' | 'empty';

/** 一格里是什么：有新字 / 只有前面拖过来的音 / 什么都没有 */
export function cellContent(grid: Grid, globalBar: number, beat: number): CellContent {
  const bar = barAt(grid, globalBar);
  if (!bar) return 'empty';
  if (wordsInCell(bar, beat).length) return 'words';
  const c0 = globalBar * TICKS_PER_BAR + beat * TICKS_PER_BEAT;
  for (const loc of iterateWords(grid)) {
    if (loc.abs >= c0 + TICKS_PER_BEAT) break;
    if (loc.abs < c0 && loc.abs + loc.word.len > c0) return 'hold-only';
  }
  return 'empty';
}

// ---------- 不可变更新 ----------

function mapBars(grid: Grid, fn: (bar: Bar, global: number) => Bar): Grid {
  let global = 0;
  let changed = false;
  const sections = grid.sections.map((sec) => {
    let secChanged = false;
    const bars = sec.bars.map((bar) => {
      const next = fn(bar, global++);
      if (next !== bar) secChanged = true;
      return next;
    });
    if (!secChanged) return sec;
    changed = true;
    return { ...sec, bars };
  });
  return changed ? { ...grid, sections } : grid;
}

function mapSection(grid: Grid, index: number, fn: (s: Section) => Section): Grid {
  if (!grid.sections[index]) throw new GridError(`没有段落 ${index}`);
  return { ...grid, sections: grid.sections.map((s, i) => (i === index ? fn(s) : s)) };
}

/**
 * 维护不变式：每个字最多拖到下一个字的起点、最多到全曲末尾；起点重复的只留第一个。
 * 没有变化时返回原对象。
 */
export function normalize(grid: Grid): Grid {
  const total = totalTicks(grid);
  const fix = new Map<string, number>();
  const drop = new Set<string>();
  const kept: WordLocation[] = [];
  for (const loc of iterateWords(grid)) {
    if (kept.length && kept[kept.length - 1].abs === loc.abs) drop.add(loc.word.id);
    else kept.push(loc);
  }
  kept.forEach((cur, i) => {
    const limit = (i + 1 < kept.length ? kept[i + 1].abs : total) - cur.abs;
    if (cur.word.len > limit) fix.set(cur.word.id, Math.max(1, limit));
  });
  if (!fix.size && !drop.size) return grid;
  return mapBars(grid, (bar) => {
    if (!bar.words.some((w) => fix.has(w.id) || drop.has(w.id))) return bar;
    return { ...bar, words: bar.words.filter((w) => !drop.has(w.id)).map((w) => (fix.has(w.id) ? { ...w, len: fix.get(w.id)! } : w)) };
  });
}

/** 把一组「全曲绝对位置」的字写回网格（只替换 [from, to) 里起点的字） */
function replaceRange(grid: Grid, from: number, to: number, words: { abs: number; len: number; text: string; id?: string }[]): Grid {
  const out = mapBars(grid, (bar, global) => {
    const b0 = global * TICKS_PER_BAR;
    const b1 = b0 + TICKS_PER_BAR;
    if (b1 <= from || b0 >= to) {
      const add = words.filter((w) => w.abs >= b0 && w.abs < b1);
      if (!add.length) return bar;
    }
    const kept = bar.words.filter((w) => {
      const abs = b0 + w.tick;
      return abs < from || abs >= to;
    });
    const add = words
      .filter((w) => w.abs >= b0 && w.abs < b1)
      .map((w) => createWord({ id: w.id, tick: w.abs - b0, len: w.len, text: w.text }));
    if (kept.length === bar.words.length && !add.length) return bar;
    return { ...bar, words: sortWords([...kept, ...add]) };
  });
  return out;
}

/** 前面拖进 absTick 的字截到 absTick 为止 */
export function carve(grid: Grid, absTick: number): Grid {
  const w = wordAt(grid, absTick);
  if (!w || w.abs >= absTick) return grid;
  return setWordLen(grid, w.word.id, absTick - w.abs);
}

function setWordLen(grid: Grid, id: string, len: number): Grid {
  return mapBars(grid, (bar) => (bar.words.some((w) => w.id === id) ? { ...bar, words: bar.words.map((w) => (w.id === id ? { ...w, len } : w)) } : bar));
}

// ---------- 字的操作 ----------

/**
 * 在 absTick 放一个字：前面拖进来的字截短，起点落在新字范围里的旧字被盖掉；
 * 长度最多到下一个字的起点 / 全曲末尾。
 */
export function insertWord(grid: Grid, absTick: number, len: number, text = '', id?: string): Grid {
  const total = totalTicks(grid);
  if (!Number.isInteger(absTick) || absTick < 0 || absTick >= total) throw new GridError(`位置 ${absTick} 不在全曲范围里`);
  if (!Number.isInteger(len) || len < 1) throw new GridError(`字的长度 ${len} 不合法`);
  let out = carve(grid, absTick);
  out = replaceRange(out, absTick, Math.min(total, absTick + len), [{ abs: absTick, len, text, id }]);
  return normalize(out);
}

export function removeWords(grid: Grid, ids: Iterable<string>): Grid {
  const set = new Set(ids);
  return mapBars(grid, (bar) => (bar.words.some((w) => set.has(w.id)) ? { ...bar, words: bar.words.filter((w) => !set.has(w.id)) } : bar));
}

export function setWordText(grid: Grid, id: string, text: string): Grid {
  const loc = findWord(grid, id);
  if (!loc) throw new GridError(`没有这个字 ${id}`);
  if (loc.word.text === text) return grid;
  return mapBars(grid, (bar) => (bar.id === loc.barId ? { ...bar, words: bar.words.map((w) => (w.id === id ? { ...w, text } : w)) } : bar));
}

/** 改字的长度：最短 1 tick，最长到下一个字的起点 / 全曲末尾（不挪后面的字） */
export function resizeWord(grid: Grid, id: string, len: number): Grid {
  const list = allWords(grid);
  const i = list.findIndex((x) => x.word.id === id);
  if (i < 0) throw new GridError(`没有这个字 ${id}`);
  const cur = list[i];
  const limit = (i + 1 < list.length ? list[i + 1].abs : totalTicks(grid)) - cur.abs;
  const v = Math.max(1, Math.min(limit, Math.round(len)));
  return v === cur.word.len ? grid : setWordLen(grid, id, v);
}

/** 删掉 [from, to] 范围里起点的字，并把前面拖进 from 的字截短 */
export function clearRange(grid: Grid, from: number, to: number): Grid {
  const ids = allWords(grid)
    .filter((x) => x.abs >= from && x.abs <= to)
    .map((x) => x.word.id);
  return carve(ids.length ? removeWords(grid, ids) : grid, from);
}

/** 写一串字的文字：从 fromAbs 起（含）依次填进已经铺好的字里，返回新网格和写到的最后一个字 */
export function fillTexts(grid: Grid, fromAbs: number, chars: string[]): { grid: Grid; written: WordLocation[] } {
  const targets = allWords(grid).filter((x) => x.abs >= fromAbs);
  let out = grid;
  const written: WordLocation[] = [];
  chars.forEach((ch, i) => {
    const t = targets[i];
    if (!t) return;
    out = setWordText(out, t.word.id, ch);
    written.push(t);
  });
  return { grid: out, written };
}

/** 一拍里最多平分成几个字（1/4、1/8、三连、1/16） */
export const MAX_BEAT_CHARS = 4;

export type BeatTextResult =
  | { ok: true; grid: Grid; how: 'fill' | 'split'; written: number[] }
  | { ok: false; reason: 'too-many' | 'locked'; slots: number };

/**
 * 把一拍（全曲第 globalBar 小节第 beat 拍）的字改成 chars，永远不碰下一拍：
 * - 这一拍原来字的位置够（N ≤ S）：按原来的节奏依次填，多出来的位置清成空字（位置保留）；
 * - 不够、而且 N ≤ 4：这一拍平分成 N 份重新排（1/4、1/8、三连、1/16），原来这一拍的字被替换，
 *   前一拍拖进来的字截到本拍开头，最后一个字结束在本拍末尾；
 * - 不够、而且 N > 4：什么都不写（too-many）；
 * - 要改的字锁着（或要重排的这一拍锁着、前一拍拖进来的字锁着）：什么都不写（locked）。
 * written：写了字的全曲绝对起点（按顺序）。
 */
export function setBeatText(grid: Grid, globalBar: number, beat: number, chars: string[], opts: { cellLocked?: boolean; lockedAbs?: ReadonlySet<number> } = {}): BeatTextResult {
  const bar = barAt(grid, globalBar);
  if (!bar || beat < 0 || beat >= BEATS_PER_BAR) throw new GridError(`没有第 ${globalBar + 1} 小节第 ${beat + 1} 拍`);
  const b0 = globalBar * TICKS_PER_BAR;
  const c0 = b0 + beat * TICKS_PER_BEAT;
  const words = sortWords(wordsInCell(bar, beat));
  const locked = (abs: number) => !!opts.cellLocked || !!opts.lockedAbs?.has(abs);
  const n = chars.length;
  const s = words.length;
  if (n <= s) {
    let out = grid;
    const written: number[] = [];
    for (let i = 0; i < s; i++) {
      const text = i < n ? chars[i] : '';
      if (words[i].text === text) {
        if (text) written.push(b0 + words[i].tick);
        continue;
      }
      if (locked(b0 + words[i].tick)) return { ok: false, reason: 'locked', slots: s };
      out = setWordText(out, words[i].id, text);
      if (text) written.push(b0 + words[i].tick);
    }
    return { ok: true, grid: out, how: 'fill', written };
  }
  if (n > MAX_BEAT_CHARS) return { ok: false, reason: 'too-many', slots: s };
  const into = holdInto(grid, globalBar, beat);
  if (opts.cellLocked || words.some((w) => locked(b0 + w.tick)) || (into && opts.lockedAbs?.has(into.abs))) return { ok: false, reason: 'locked', slots: s };
  const unit = TICKS_PER_BEAT / n;
  let out = carve(removeWords(grid, words.map((w) => w.id)), c0);
  const fresh = chars.map((text, i) => ({ abs: c0 + i * unit, len: unit, text, id: words[i]?.id }));
  out = normalize(replaceRange(out, c0, c0 + TICKS_PER_BEAT, fresh));
  return { ok: true, grid: out, how: 'split', written: fresh.map((w) => w.abs) };
}

/** 作品里有没有写过字（只铺了位置、没写字不算） */
export function hasAnyText(grid: Grid): boolean {
  for (const loc of iterateWords(grid)) if (loc.word.text) return true;
  return false;
}

// ---------- 小节 / 段落 ----------

export function insertBars(grid: Grid, section: number, index: number, count = 1): Grid {
  return normalize(
    mapSection(grid, section, (s) => {
      if (index < 0 || index > s.bars.length) throw new GridError(`小节插入位置 ${index} 越界`);
      const bars = [...s.bars];
      bars.splice(index, 0, ...Array.from({ length: count }, () => createBar()));
      return { ...s, bars };
    }),
  );
}

export function deleteBars(grid: Grid, section: number, index: number, count = 1): Grid {
  return normalize(
    mapSection(grid, section, (s) => {
      if (index < 0 || index + count > s.bars.length) throw new GridError(`小节删除范围越界`);
      return { ...s, bars: s.bars.filter((_, i) => i < index || i >= index + count) };
    }),
  );
}

export function insertSection(grid: Grid, index: number, section: Section): Grid {
  if (index < 0 || index > grid.sections.length) throw new GridError(`段落插入位置越界`);
  const sections = [...grid.sections];
  sections.splice(index, 0, section);
  return normalize({ ...grid, sections });
}

export function deleteSection(grid: Grid, index: number): Grid {
  if (!grid.sections[index]) throw new GridError(`没有段落 ${index}`);
  return normalize({ ...grid, sections: grid.sections.filter((_, i) => i !== index) });
}

export function updateSection(grid: Grid, index: number, patch: Partial<Pick<Section, 'kind' | 'label'>>): Grid {
  return mapSection(grid, index, (s) => ({ ...s, ...patch }));
}

/** 复制整段（新 id），插在原段后面 */
export function duplicateSection(grid: Grid, index: number): Grid {
  const src = grid.sections[index];
  if (!src) throw new GridError(`没有段落 ${index}`);
  const copy: Section = {
    ...src,
    id: newId('s'),
    bars: src.bars.map((bar) => ({ id: newId('b'), words: bar.words.map((w) => ({ ...w, id: newId('w') })) })),
  };
  return insertSection(grid, index + 1, copy);
}

/** 同类段落按出现顺序编号：Verse 1 / Verse 2；只有一个的不带号 */
export function relabelSections(grid: Grid): Grid {
  const total: Record<string, number> = {};
  for (const s of grid.sections) total[s.kind] = (total[s.kind] ?? 0) + 1;
  const seen: Record<string, number> = {};
  let changed = false;
  const sections = grid.sections.map((s) => {
    seen[s.kind] = (seen[s.kind] ?? 0) + 1;
    const label = sectionLabel(s.kind, total[s.kind] > 1 || s.kind === 'verse' ? seen[s.kind] : undefined);
    if (label === s.label) return s;
    changed = true;
    return { ...s, label };
  });
  return changed ? { ...grid, sections } : grid;
}
