/**
 * 把 core 的数据算成界面要画的东西（纯函数，不碰 DOM）。
 */

import {
  colorLineEndRhymes,
  STEPS_PER_BAR,
  type Bar,
  type Grid,
  type LineEndRhyme,
} from '../core';

export type SlotKind = 'empty' | 'char' | 'sus' | 'rest';

export interface SlotView {
  /** 小节内第几格 */
  step: number;
  kind: SlotKind;
  text: string;
  accent: boolean;
  /** 覆盖这一格的片段（含延音尾巴） */
  clipId: string | null;
}

/** 一小节的 16 格：片段起点画字（空字 = 空拍 ∅，延音片段 = 横线），片段后面占着的格子画延音横线 */
export function barSlots(bar: Bar): SlotView[] {
  const slots: SlotView[] = Array.from({ length: STEPS_PER_BAR }, (_, step) => ({
    step,
    kind: 'empty' as SlotKind,
    text: '',
    accent: false,
    clipId: null,
  }));
  for (const c of bar.clips) {
    for (let s = c.start; s < c.start + c.length && s < STEPS_PER_BAR; s++) {
      const head = s === c.start;
      slots[s] = {
        step: s,
        kind: !head || c.hold ? 'sus' : c.text ? 'char' : 'rest',
        text: head && !c.hold ? c.text : '',
        accent: head && c.accent && !c.hold && !!c.text,
        clipId: c.id,
      };
    }
  }
  return slots;
}

/** 一小节的文字（跳过延音和空拍） */
export function barText(bar: Bar): string {
  return bar.clips
    .filter((c) => !c.hold && c.text)
    .map((c) => c.text)
    .join('');
}

/** 句尾最后一个字所在的格；没有字时 -1 */
export function lastCharStep(bar: Bar): number {
  for (let i = bar.clips.length - 1; i >= 0; i--) {
    const c = bar.clips[i];
    if (!c.hold && c.text) return c.start;
  }
  return -1;
}

export function allBars(grid: Grid): { section: number; bar: number; global: number; data: Bar }[] {
  const out: { section: number; bar: number; global: number; data: Bar }[] = [];
  grid.sections.forEach((s, si) => s.bars.forEach((b, bi) => out.push({ section: si, bar: bi, global: out.length, data: b })));
  return out;
}

export interface SectionRhymeStat {
  /** 显示用的韵母（这一组里第一次出现的那个） */
  final: string;
  color: number;
  count: number;
}

export interface RhymeView {
  /** 按全曲小节顺序 */
  lines: LineEndRhyme[];
  sections: SectionRhymeStat[][];
}

/** 句尾押韵：core/rhyme 按十三辙分组配色；这里再按段落统计「ang ×4」 */
export function rhymeView(grid: Grid): RhymeView {
  const bars = allBars(grid);
  const lines = colorLineEndRhymes(bars.map((b) => barText(b.data)));
  const sections: SectionRhymeStat[][] = grid.sections.map(() => []);
  bars.forEach((b, i) => {
    const r = lines[i];
    if (!r.syllable || r.color === null) return;
    const stats = sections[b.section];
    const hit = stats.find((s) => s.color === r.color);
    if (hit) hit.count += 1;
    else stats.push({ final: r.syllable.final, color: r.color, count: 1 });
  });
  return { lines, sections };
}

/** AI 预览行的句尾韵：接在全曲后面一起算，颜色和已有的行一致 */
export function previewRhymes(grid: Grid, lines: string[]): LineEndRhyme[] {
  if (lines.length === 0) return [];
  const all = colorLineEndRhymes([...allBars(grid).map((b) => barText(b.data)), ...lines]);
  return all.slice(-lines.length);
}

/** 韵母色板只有 5 个（蓝 / 绿 / 粉 / 青 / 金），超过就轮着用 */
/** 显示用韵母：core 把 zhi/chi/shi 的韵母记成 "-i"，界面上写 i */
export const finalLabel = (final: string) => (final === '-i' ? 'i' : final);

export const RHYME_COLORS = 5;
export const rhymeClass = (color: number | null) => (color === null ? '' : `rc-${color % RHYME_COLORS}`);

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

export function formatPosition(absStep: number | null): string {
  if (absStep === null || absStep < 0) return '01 · 1 · 1';
  const bar = Math.floor(absStep / STEPS_PER_BAR) + 1;
  const inBar = absStep % STEPS_PER_BAR;
  return `${String(bar).padStart(2, '0')} · ${Math.floor(inBar / 4) + 1} · ${(inBar % 4) + 1}`;
}

export function formatClock(seconds: number, tenths = true): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return tenths ? `${m}:${rest.toFixed(1).padStart(4, '0')}` : `${m}:${String(Math.floor(rest)).padStart(2, '0')}`;
}

/** 播放从哪一格开始：选中了格子就从选中格（DAW 式「从光标播放」），否则从头 */
export function playFrom(selection: { focus: number } | null): number {
  return selection ? selection.focus : 0;
}
