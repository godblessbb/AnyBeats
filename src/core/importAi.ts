/**
 * 把 AI 给出的带时值歌词导入网格，保留每个字的起点和时长。
 *
 * 提示词约定 startBeat / duration 的单位是「1/16 拍」，每小节 64 个单位；网格每小节 192 tick，
 * 所以默认 1 单位 = 3 tick，不用再对齐到 1/16 格。提示词以后改成别的分辨率时传 unitsPerBar 即可。
 */

import { createBar, createGrid, createSection, createWord, normalize, TICKS_PER_BAR, type Bar, type Grid, type SectionKind, type Word } from './grid';

export interface AiLyricItem {
  text: string;
  startBeat: number;
  duration: number;
}

export interface AiLyricData {
  bpm?: number;
  timeSignature?: string;
  measures: { measureIndex: number; lyrics: AiLyricItem[] }[];
}

export interface ImportAiOptions {
  /** AI 时值单位：每小节多少个单位，默认 64 */
  unitsPerBar?: number;
  /** 一个条目里有多个字且时长够分时，平均拆成每字一个，默认 true */
  splitChars?: boolean;
  sectionKind?: SectionKind;
}

export interface ImportAiResult {
  bars: Bar[];
  grid: Grid;
  bpm?: number;
  /** 对齐、截断、合并等有损处理的说明；空数组表示无损 */
  warnings: string[];
}

export function importAiLyrics(data: AiLyricData, options: ImportAiOptions = {}): ImportAiResult {
  const unitsPerBar = options.unitsPerBar ?? 64;
  const splitChars = options.splitChars ?? true;
  const toTicks = (u: number) => (u * TICKS_PER_BAR) / unitsPerBar;
  const warnings: string[] = [];

  if (data.timeSignature && data.timeSignature !== '4/4') warnings.push(`拍号 ${data.timeSignature} 按 4/4 导入`);

  const barCount = data.measures.reduce((n, m) => Math.max(n, m.measureIndex + 1), 0);
  const barWords: Word[][] = Array.from({ length: barCount }, () => []);

  for (const measure of data.measures) {
    if (measure.measureIndex < 0) continue;
    const words = barWords[measure.measureIndex];
    const items = [...measure.lyrics].sort((a, b) => a.startBeat - b.startBeat);
    for (const item of items) {
      const where = `第 ${measure.measureIndex + 1} 小节「${item.text}」`;
      const exactStart = toTicks(item.startBeat);
      const exactEnd = toTicks(item.startBeat + item.duration);
      let start = Math.round(exactStart);
      let end = Math.round(exactEnd);
      if (start !== exactStart || end !== exactEnd) warnings.push(`${where} 时值不在 tick 上，已就近对齐`);
      if (start >= TICKS_PER_BAR) {
        warnings.push(`${where} 起点超出小节，已丢弃`);
        continue;
      }
      const prev = words[words.length - 1];
      const prevEnd = prev ? prev.tick + prev.len : 0;
      if (start < prevEnd) {
        warnings.push(`${where} 与前一个字重叠，已顺延`);
        start = prevEnd;
      }
      if (start >= TICKS_PER_BAR) {
        warnings.push(`${where} 没有剩余位置，已并入前一个字`);
        if (prev) prev.text += item.text;
        continue;
      }
      if (end > TICKS_PER_BAR) {
        warnings.push(`${where} 越过小节线，已截到小节末`);
        end = TICKS_PER_BAR;
      }
      if (end <= start) end = start + 1;
      const text = item.text === '-' ? '' : item.text;
      if (item.text === '-' && prev && prevEnd === start) {
        prev.len += end - start; // 「-」就是把前一个字拖长
        continue;
      }
      const chars = Array.from(text);
      const length = end - start;
      if (splitChars && chars.length > 1 && length >= chars.length) {
        chars.forEach((ch, i) => {
          const s = start + Math.floor((i * length) / chars.length);
          const e = start + Math.floor(((i + 1) * length) / chars.length);
          words.push(createWord({ tick: s, len: e - s, text: ch }));
        });
      } else {
        words.push(createWord({ tick: start, len: length, text }));
      }
    }
  }

  const bars = barWords.map((words) => createBar(words));
  const section = { ...createSection(options.sectionKind ?? 'verse', 0), bars };
  return { bars, grid: normalize(createGrid([section])), bpm: data.bpm, warnings };
}
