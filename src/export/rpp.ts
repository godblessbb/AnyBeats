/**
 * Reaper 工程（.RPP 文本）生成器（纯函数）。
 *
 * 结构：
 *   <REAPER_PROJECT 0.1 "6.0/AnyBeats" 0
 *     TEMPO <bpm> 4 4
 *     SAMPLERATE <sr> 0 0
 *     MARKER 1 <首拍秒> "首拍" 0          ← 首拍偏移
 *     MARKER 2 <秒> "主歌" 0              ← 段落 = marker
 *     MARKER 3 <起> "歌词一行" 1 / MARKER 3 <止> "" 1   ← 歌词行 = region
 *     <TRACK {GUID}
 *       NAME "伴奏"  MUTESOLO 0 0 0
 *       <ITEM  POSITION / LENGTH / SOFFS / MUTE
 *         <SOURCE WAVE  FILE "audio/backing.wav" >
 *       >
 *     >
 *   >
 * 时间都是秒（Reaper 时间线 0 = 伴奏开头）。FILE 用相对路径，相对 .RPP 所在目录，即 zip 里的路径。
 */

import { barCount, iterateClips, STEPS_PER_BAR, timeOfStep, type Project } from '../core';
import { alignedRegion, type TakeMeta } from '../audio/takes';

export interface RppItem {
  name: string;
  /** 时间线位置（秒） */
  position: number;
  length: number;
  /** 从源文件的第几秒开始（裁头） */
  sourceOffset: number;
  /** 相对 .RPP 的路径 */
  file: string;
  mute?: boolean;
}

export interface RppTrack {
  name: string;
  items: RppItem[];
  mute?: boolean;
  /** 线性音量，1 = 0 dB */
  volume?: number;
}

export interface RppMarker {
  name: string;
  position: number;
}

export interface RppRegion {
  name: string;
  start: number;
  end: number;
}

export interface RppDoc {
  bpm: number;
  sampleRate: number;
  markers: RppMarker[];
  regions: RppRegion[];
  tracks: RppTrack[];
}

/** 秒数：最多 10 位小数，去掉尾零 */
export function num(x: number): string {
  if (!Number.isFinite(x)) return '0';
  const s = x.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

/** RPP 字符串用双引号包；名字里的双引号换成单引号、换行换成空格 */
export function quote(s: string): string {
  return `"${s.replace(/"/g, "'").replace(/[\r\n]+/g, ' ')}"`;
}

function guid(n: number): string {
  const hex = n.toString(16).toUpperCase().padStart(12, '0');
  return `{A0BEA75E-0000-4000-8000-${hex}}`;
}

export function buildRpp(doc: RppDoc): string {
  const out: string[] = [];
  const line = (depth: number, s: string) => out.push('  '.repeat(depth) + s);
  line(0, '<REAPER_PROJECT 0.1 "6.0/AnyBeats" 0');
  line(1, `TEMPO ${num(doc.bpm)} 4 4`);
  line(1, `SAMPLERATE ${doc.sampleRate} 0 0`);
  let id = 1;
  for (const m of doc.markers) line(1, `MARKER ${id++} ${num(m.position)} ${quote(m.name)} 0`);
  for (const r of doc.regions) {
    line(1, `MARKER ${id} ${num(r.start)} ${quote(r.name)} 1`);
    line(1, `MARKER ${id} ${num(r.end)} "" 1`);
    id++;
  }
  let g = 1;
  for (const t of doc.tracks) {
    line(1, `<TRACK ${guid(g++)}`);
    line(2, `NAME ${quote(t.name)}`);
    line(2, `VOLPAN ${num(t.volume ?? 1)} 0 -1 -1 1`);
    line(2, `MUTESOLO ${t.mute ? 1 : 0} 0 0`);
    for (const it of t.items) {
      line(2, '<ITEM');
      line(3, `POSITION ${num(it.position)}`);
      line(3, `LENGTH ${num(it.length)}`);
      line(3, `SOFFS ${num(it.sourceOffset)}`);
      line(3, `MUTE ${it.mute ? 1 : 0} 0`);
      line(3, `IGUID ${guid(g++)}`);
      line(3, `NAME ${quote(it.name)}`);
      line(3, '<SOURCE WAVE');
      line(4, `FILE ${quote(it.file)}`);
      line(3, '>');
      line(2, '>');
    }
    line(1, '>');
  }
  line(0, '>');
  return out.join('\n') + '\n';
}

/** 段落 marker：每段第一小节的开头 */
export function sectionMarkers(project: Project): RppMarker[] {
  const out: RppMarker[] = [];
  let bar = 0;
  for (const s of project.grid.sections) {
    out.push({ name: s.label, position: timeOfStep(project, bar * STEPS_PER_BAR) });
    bar += s.bars.length;
  }
  return out;
}

/** 歌词行 region：一小节一行，跳过没字的小节；区间 = 这一小节的起止 */
export function lyricRegions(project: Project): RppRegion[] {
  const bars = barCount(project.grid);
  const text: string[] = Array.from({ length: bars }, () => '');
  let bar = -1;
  let key = '';
  for (const loc of iterateClips(project.grid)) {
    const k = `${loc.section}/${loc.bar}`;
    if (k !== key) {
      key = k;
      bar = Math.floor(loc.absStart / STEPS_PER_BAR);
    }
    if (!loc.clip.hold && loc.clip.text) text[bar] += loc.clip.text;
  }
  const out: RppRegion[] = [];
  text.forEach((t, b) => {
    if (t) out.push({ name: t, start: timeOfStep(project, b * STEPS_PER_BAR), end: timeOfStep(project, (b + 1) * STEPS_PER_BAR) });
  });
  return out;
}

/** take → RPP item：位置走 alignedRegion（含校准偏移和裁剪） */
export function takeItem(take: TakeMeta, file: string): RppItem | null {
  const r = alignedRegion(take);
  if (!r) return null;
  return { name: take.selected ? `${take.name} ★` : take.name, position: r.position, length: r.length, sourceOffset: r.sourceOffset, file };
}

export interface ProjectRppInput {
  project: Project;
  sampleRate: number;
  tracks: RppTrack[];
}

/** 整个工程：BPM、首拍 marker、段落 marker、歌词 region + 给定的轨道 */
export function projectRpp({ project, sampleRate, tracks }: ProjectRppInput): string {
  return buildRpp({
    bpm: project.bpm,
    sampleRate,
    markers: [{ name: `首拍 +${Math.round(project.offsetMs)}ms`, position: project.offsetMs / 1000 }, ...sectionMarkers(project)],
    regions: lyricRegions(project),
    tracks,
  });
}
