/**
 * 工程数据模型：段落 → 小节 → 1/16 格（十六分音符）。
 *
 * 所有操作都是纯函数：输入旧 Grid，返回新 Grid，不改原对象；
 * 撤销/重做见 history.ts。
 */

export const STEPS_PER_BEAT = 4;
export const BEATS_PER_BAR = 4;
export const STEPS_PER_BAR = STEPS_PER_BEAT * BEATS_PER_BAR;

export type SectionKind = 'intro' | 'verse' | 'prechorus' | 'chorus' | 'hook' | 'bridge' | 'outro';

export const SECTION_KIND_NAMES: Record<SectionKind, string> = {
  intro: '前奏',
  verse: '主歌',
  prechorus: '导歌',
  chorus: '副歌',
  hook: 'Hook',
  bridge: '桥段',
  outro: '尾奏',
};

export interface Clip {
  id: string;
  /** 小节内起点，单位 1/16（0–15） */
  start: number;
  /** 时长，单位 1/16，≥1，且不越过小节末尾 */
  length: number;
  /** 一个或几个字；延音符片段的 text 忽略 */
  text: string;
  accent: boolean;
  /** 延音符（旧界面里的 "-"）：不发新音，拖长前一个字 */
  hold: boolean;
}

export interface Bar {
  id: string;
  /** 按 start 升序，互不重叠 */
  clips: Clip[];
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

export interface StepAddress extends BarAddress {
  /** 小节内第几个 1/16 */
  step: number;
}

export class GridError extends Error {}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function createBar(clips: Clip[] = []): Bar {
  return { id: newId('b'), clips: sortClips(clips) };
}

export function createSection(kind: SectionKind, bars = 4, label = SECTION_KIND_NAMES[kind]): Section {
  return { id: newId('s'), kind, label, bars: Array.from({ length: bars }, () => createBar()) };
}

export function createGrid(sections: Section[] = [createSection('verse', 8)]): Grid {
  return { sections };
}

export type ClipInit = Partial<Omit<Clip, 'id' | 'start'>> & { start: number };

export function createClip(init: ClipInit): Clip {
  const clip: Clip = {
    id: newId('c'),
    start: init.start,
    length: init.length ?? 1,
    text: init.text ?? '',
    accent: init.accent ?? false,
    hold: init.hold ?? false,
  };
  validateClip(clip);
  return clip;
}

function validateClip(c: Clip) {
  if (!Number.isInteger(c.start) || c.start < 0 || c.start >= STEPS_PER_BAR) {
    throw new GridError(`片段起点 ${c.start} 不在 0–${STEPS_PER_BAR - 1}`);
  }
  if (!Number.isInteger(c.length) || c.length < 1 || c.start + c.length > STEPS_PER_BAR) {
    throw new GridError(`片段时长 ${c.length}（起点 ${c.start}）越出小节`);
  }
}

function sortClips(clips: Clip[]): Clip[] {
  return [...clips].sort((a, b) => a.start - b.start);
}

const overlaps = (a: { start: number; length: number }, b: { start: number; length: number }) =>
  a.start < b.start + b.length && b.start < a.start + a.length;

// ---------- 定位 ----------

export function barCount(grid: Grid): number {
  return grid.sections.reduce((n, s) => n + s.bars.length, 0);
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

/** 绝对位置（全曲第几个 1/16）→ 段落/小节/格 */
export function locateStep(grid: Grid, absStep: number): StepAddress | null {
  if (!Number.isFinite(absStep) || absStep < 0) return null;
  const s = Math.floor(absStep);
  const addr = barAddressOf(grid, Math.floor(s / STEPS_PER_BAR));
  return addr ? { ...addr, step: s % STEPS_PER_BAR } : null;
}

export function absoluteStep(grid: Grid, addr: StepAddress): number {
  return globalBarIndex(grid, addr) * STEPS_PER_BAR + addr.step;
}

export function getBar(grid: Grid, addr: BarAddress): Bar {
  const bar = grid.sections[addr.section]?.bars[addr.bar];
  if (!bar) throw new GridError(`没有小节 ${addr.section}/${addr.bar}`);
  return bar;
}

export interface ClipLocation extends BarAddress {
  clip: Clip;
}

export function findClip(grid: Grid, id: string): ClipLocation | null {
  for (let s = 0; s < grid.sections.length; s++) {
    const bars = grid.sections[s].bars;
    for (let b = 0; b < bars.length; b++) {
      const clip = bars[b].clips.find((c) => c.id === id);
      if (clip) return { section: s, bar: b, clip };
    }
  }
  return null;
}

/** 该位置正在发声的片段（start ≤ step < start+length） */
export function clipAt(grid: Grid, addr: StepAddress): Clip | null {
  const bar = grid.sections[addr.section]?.bars[addr.bar];
  return bar?.clips.find((c) => c.start <= addr.step && addr.step < c.start + c.length) ?? null;
}

/** 按全曲顺序遍历所有片段，带绝对起点 */
export function* iterateClips(grid: Grid): Generator<ClipLocation & { absStart: number }> {
  let globalBar = 0;
  for (let s = 0; s < grid.sections.length; s++) {
    const bars = grid.sections[s].bars;
    for (let b = 0; b < bars.length; b++, globalBar++) {
      for (const clip of bars[b].clips) {
        yield { section: s, bar: b, clip, absStart: globalBar * STEPS_PER_BAR + clip.start };
      }
    }
  }
}

// ---------- 不可变更新工具 ----------

function mapBar(grid: Grid, addr: BarAddress, fn: (bar: Bar) => Bar): Grid {
  getBar(grid, addr);
  return {
    ...grid,
    sections: grid.sections.map((sec, si) =>
      si !== addr.section ? sec : { ...sec, bars: sec.bars.map((bar, bi) => (bi === addr.bar ? fn(bar) : bar)) },
    ),
  };
}

function mapSection(grid: Grid, index: number, fn: (s: Section) => Section): Grid {
  if (!grid.sections[index]) throw new GridError(`没有段落 ${index}`);
  return { ...grid, sections: grid.sections.map((s, i) => (i === index ? fn(s) : s)) };
}

/** 写入片段：与之重叠的旧片段被覆盖（删掉）。 */
function writeClips(bar: Bar, clips: Clip[]): Bar {
  clips.forEach(validateClip);
  const kept = bar.clips.filter((old) => !clips.some((c) => c.id === old.id || overlaps(c, old)));
  return { ...bar, clips: sortClips([...kept, ...clips]) };
}

// ---------- 片段操作 ----------

export function insertClip(grid: Grid, addr: BarAddress, init: ClipInit | Clip): Grid {
  const clip = 'id' in init ? (init as Clip) : createClip(init);
  return mapBar(grid, addr, (bar) => writeClips(bar, [clip]));
}

export function deleteClips(grid: Grid, ids: Iterable<string>): Grid {
  const set = new Set(ids);
  return {
    ...grid,
    sections: grid.sections.map((sec) => ({
      ...sec,
      bars: sec.bars.map((bar) =>
        bar.clips.some((c) => set.has(c.id)) ? { ...bar, clips: bar.clips.filter((c) => !set.has(c.id)) } : bar,
      ),
    })),
  };
}

export function updateClip(grid: Grid, id: string, patch: Partial<Omit<Clip, 'id'>>): Grid {
  const loc = findClip(grid, id);
  if (!loc) throw new GridError(`没有片段 ${id}`);
  const next = { ...loc.clip, ...patch };
  const removed = deleteClips(grid, [id]);
  return mapBar(removed, loc, (bar) => writeClips(bar, [next]));
}

export function toggleAccent(grid: Grid, id: string): Grid {
  const loc = findClip(grid, id);
  if (!loc) throw new GridError(`没有片段 ${id}`);
  return updateClip(grid, id, { accent: !loc.clip.accent });
}

/** 移动片段到任意小节的任意格（可跨小节、跨段落），时长不变。 */
export function moveClip(grid: Grid, id: string, to: StepAddress): Grid {
  const loc = findClip(grid, id);
  if (!loc) throw new GridError(`没有片段 ${id}`);
  const moved = { ...loc.clip, start: to.step };
  validateClip(moved);
  getBar(grid, to);
  return mapBar(deleteClips(grid, [id]), to, (bar) => writeClips(bar, [moved]));
}

// ---------- 复制粘贴 ----------

export interface ClipboardItem {
  /** 相对剪贴板第一个片段的绝对偏移（1/16） */
  offset: number;
  length: number;
  text: string;
  accent: boolean;
  hold: boolean;
}

export function copyClips(grid: Grid, ids: Iterable<string>): ClipboardItem[] {
  const set = new Set(ids);
  const picked = [...iterateClips(grid)].filter((c) => set.has(c.clip.id));
  if (picked.length === 0) return [];
  const base = picked[0].absStart;
  return picked.map(({ clip, absStart }) => ({
    offset: absStart - base,
    length: clip.length,
    text: clip.text,
    accent: clip.accent,
    hold: clip.hold,
  }));
}

/** 把剪贴板粘到某个位置，可跨小节；越出全曲末尾的部分丢弃，越出小节末尾的截短。 */
export function pasteClips(grid: Grid, at: StepAddress, items: ClipboardItem[]): Grid {
  const base = absoluteStep(grid, at);
  const total = totalSteps(grid);
  let out = grid;
  for (const item of items) {
    const abs = base + item.offset;
    if (abs >= total) continue;
    const addr = locateStep(out, abs)!;
    const length = Math.min(item.length, STEPS_PER_BAR - addr.step);
    out = insertClip(out, addr, {
      start: addr.step,
      length,
      text: item.text,
      accent: item.accent,
      hold: item.hold,
    });
  }
  return out;
}

// ---------- 小节 / 段落 ----------

export function insertBars(grid: Grid, section: number, index: number, count = 1): Grid {
  return mapSection(grid, section, (s) => {
    if (index < 0 || index > s.bars.length) throw new GridError(`小节插入位置 ${index} 越界`);
    const bars = [...s.bars];
    bars.splice(index, 0, ...Array.from({ length: count }, () => createBar()));
    return { ...s, bars };
  });
}

export function deleteBars(grid: Grid, section: number, index: number, count = 1): Grid {
  return mapSection(grid, section, (s) => {
    if (index < 0 || index + count > s.bars.length) throw new GridError(`小节删除范围越界`);
    return { ...s, bars: s.bars.filter((_, i) => i < index || i >= index + count) };
  });
}

export function moveBar(grid: Grid, from: BarAddress, to: BarAddress): Grid {
  const bar = getBar(grid, from);
  const removed = mapSection(grid, from.section, (s) => ({ ...s, bars: s.bars.filter((_, i) => i !== from.bar) }));
  return mapSection(removed, to.section, (s) => {
    if (to.bar < 0 || to.bar > s.bars.length) throw new GridError(`小节目标位置越界`);
    const bars = [...s.bars];
    bars.splice(to.bar, 0, bar);
    return { ...s, bars };
  });
}

export function insertSection(grid: Grid, index: number, section: Section): Grid {
  if (index < 0 || index > grid.sections.length) throw new GridError(`段落插入位置越界`);
  const sections = [...grid.sections];
  sections.splice(index, 0, section);
  return { ...grid, sections };
}

export function deleteSection(grid: Grid, index: number): Grid {
  if (!grid.sections[index]) throw new GridError(`没有段落 ${index}`);
  return { ...grid, sections: grid.sections.filter((_, i) => i !== index) };
}

export function moveSection(grid: Grid, from: number, to: number): Grid {
  const sec = grid.sections[from];
  if (!sec || to < 0 || to >= grid.sections.length) throw new GridError(`段落移动越界`);
  const sections = grid.sections.filter((_, i) => i !== from);
  sections.splice(to, 0, sec);
  return { ...grid, sections };
}

export function updateSection(grid: Grid, index: number, patch: Partial<Pick<Section, 'kind' | 'label'>>): Grid {
  return mapSection(grid, index, (s) => ({ ...s, ...patch }));
}

/** 复制整段（新 id），插在原段后面——副歌复用常用。 */
export function duplicateSection(grid: Grid, index: number): Grid {
  const src = grid.sections[index];
  if (!src) throw new GridError(`没有段落 ${index}`);
  const copy: Section = {
    ...src,
    id: newId('s'),
    bars: src.bars.map((bar) => ({ id: newId('b'), clips: bar.clips.map((c) => ({ ...c, id: newId('c') })) })),
  };
  return insertSection(grid, index + 1, copy);
}
