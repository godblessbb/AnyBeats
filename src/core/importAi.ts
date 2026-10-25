/**
 * 把 AI 给出的带时值歌词导入网格，保留每个字的起点和时长。
 *
 * 现在的提示词（src/config/openai.config.ts）约定 startBeat / duration 的单位是「1/16 拍」，
 * 每小节 64 个单位；网格一格是 1/16 音符（每小节 16 格），所以默认按 64 → 16 换算。
 * 提示词以后改成别的分辨率时传 unitsPerBar 即可。
 */

import { createBar, createClip, createGrid, createSection, STEPS_PER_BAR, type Bar, type Clip, type Grid, type SectionKind } from './grid';

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
  /** 一个条目里有多个字且时长够分时，平均拆成每字一个片段，默认 true */
  splitChars?: boolean;
  sectionKind?: SectionKind;
}

export interface ImportAiResult {
  bars: Bar[];
  grid: Grid;
  bpm?: number;
  /** 量化、截断、合并等有损处理的说明；空数组表示无损 */
  warnings: string[];
}

export function importAiLyrics(data: AiLyricData, options: ImportAiOptions = {}): ImportAiResult {
  const unitsPerBar = options.unitsPerBar ?? 64;
  const splitChars = options.splitChars ?? true;
  const toSteps = (u: number) => (u * STEPS_PER_BAR) / unitsPerBar;
  const warnings: string[] = [];

  if (data.timeSignature && data.timeSignature !== '4/4') {
    warnings.push(`拍号 ${data.timeSignature} 按 4/4 导入`);
  }

  const barCount = data.measures.reduce((n, m) => Math.max(n, m.measureIndex + 1), 0);
  const barClips: Clip[][] = Array.from({ length: barCount }, () => []);

  for (const measure of data.measures) {
    if (measure.measureIndex < 0) continue;
    const clips = barClips[measure.measureIndex];
    const items = [...measure.lyrics].sort((a, b) => a.startBeat - b.startBeat);
    for (const item of items) {
      const where = `第 ${measure.measureIndex + 1} 小节「${item.text}」`;
      const exactStart = toSteps(item.startBeat);
      const exactEnd = toSteps(item.startBeat + item.duration);
      let start = Math.round(exactStart);
      let end = Math.round(exactEnd);
      if (start !== exactStart || end !== exactEnd) warnings.push(`${where} 时值不在 1/16 格上，已就近对齐`);
      if (start >= STEPS_PER_BAR) {
        warnings.push(`${where} 起点超出小节，已丢弃`);
        continue;
      }
      if (end > STEPS_PER_BAR) {
        warnings.push(`${where} 越过小节线，已截到小节末`);
        end = STEPS_PER_BAR;
      }
      const prevEnd = clips.length ? clips[clips.length - 1].start + clips[clips.length - 1].length : 0;
      if (start < prevEnd) {
        warnings.push(`${where} 与前一个字重叠，已顺延`);
        start = prevEnd;
      }
      if (end <= start) end = start + 1;
      if (start >= STEPS_PER_BAR) {
        const prev = clips[clips.length - 1];
        warnings.push(`${where} 没有剩余格子，已并入前一个片段`);
        prev.text += item.text;
        continue;
      }
      end = Math.min(end, STEPS_PER_BAR);

      const chars = Array.from(item.text);
      const length = end - start;
      if (splitChars && chars.length > 1 && length >= chars.length) {
        chars.forEach((ch, i) => {
          const s = start + Math.floor((i * length) / chars.length);
          const e = start + Math.floor(((i + 1) * length) / chars.length);
          clips.push(makeClip(ch, s, e - s));
        });
      } else {
        clips.push(makeClip(item.text, start, length));
      }
    }
  }

  const bars = barClips.map((clips) => createBar(clips));
  const section = { ...createSection(options.sectionKind ?? 'verse', 0), bars };
  return { bars, grid: createGrid([section]), bpm: data.bpm, warnings };
}

function makeClip(text: string, start: number, length: number): Clip {
  const hold = text === '-';
  return createClip({ start, length, text: hold ? '' : text, hold });
}
