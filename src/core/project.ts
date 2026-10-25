/**
 * 工程文件：带 schema 版本号的 JSON 序列化/反序列化，能读旧版本；导出 txt / LRC。
 *
 * 版本：
 *   1 —— 旧界面 localStorage 'anybeats_projects' 里的 SavedProject
 *        { name, createdAt, updatedAt, measures: {text, isAccented}[][] }，每格 = 1 拍，
 *        格内多个字平均分这一拍，' ' = 空拍，'-' = 延音。没有 BPM / 偏移。
 *   2 —— 本模块：{ schema: 'anybeats.project', version: 2, ..., grid }
 */

import { stepDuration } from './clock';
import {
  createBar,
  createClip,
  createGrid,
  createSection,
  iterateClips,
  SECTION_KIND_NAMES,
  STEPS_PER_BAR,
  STEPS_PER_BEAT,
  type Bar,
  type Clip,
  type Grid,
  type Section,
  type SectionKind,
} from './grid';

export const PROJECT_SCHEMA = 'anybeats.project';
export const PROJECT_VERSION = 2;

export interface Project {
  name: string;
  createdAt: number;
  updatedAt: number;
  bpm: number;
  /** 第一拍在伴奏里的位置，毫秒 */
  offsetMs: number;
  grid: Grid;
}

export class ProjectFormatError extends Error {}

export function createProject(init: Partial<Project> = {}): Project {
  const now = init.createdAt ?? 0;
  return {
    name: init.name ?? '',
    createdAt: now,
    updatedAt: init.updatedAt ?? now,
    bpm: init.bpm ?? 90,
    offsetMs: init.offsetMs ?? 0,
    grid: init.grid ?? createGrid(),
  };
}

interface ProjectFileV2 {
  schema: typeof PROJECT_SCHEMA;
  version: 2;
  name: string;
  createdAt: number;
  updatedAt: number;
  bpm: number;
  offsetMs: number;
  timeSignature: '4/4';
  stepsPerBar: number;
  sections: {
    id: string;
    kind: SectionKind;
    label: string;
    bars: { id: string; clips: { id: string; start: number; length: number; text: string; accent?: boolean; hold?: boolean }[] }[];
  }[];
}

export interface LegacyProjectV1 {
  name: string;
  createdAt: number;
  updatedAt: number;
  measures: { text: string; isAccented: boolean }[][];
}

export function serializeProject(project: Project): string {
  const file: ProjectFileV2 = {
    schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    bpm: project.bpm,
    offsetMs: project.offsetMs,
    timeSignature: '4/4',
    stepsPerBar: STEPS_PER_BAR,
    sections: project.grid.sections.map((s) => ({
      id: s.id,
      kind: s.kind,
      label: s.label,
      bars: s.bars.map((b) => ({
        id: b.id,
        clips: b.clips.map((c) => ({ id: c.id, start: c.start, length: c.length, text: c.text, accent: c.accent, hold: c.hold })),
      })),
    })),
  };
  return JSON.stringify(file);
}

export interface DeserializeOptions {
  /** 旧版本没有 BPM 时用这个，默认 90（旧界面默认值） */
  defaultBpm?: number;
}

export function deserializeProject(input: string | unknown, options: DeserializeOptions = {}): Project {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      throw new ProjectFormatError(`不是合法 JSON：${(e as Error).message}`);
    }
  }
  if (!isObject(raw)) throw new ProjectFormatError('工程文件不是对象');
  if (raw.schema === PROJECT_SCHEMA) {
    if (raw.version === 2) return fromV2(raw as unknown as ProjectFileV2);
    throw new ProjectFormatError(`不认识的工程版本 ${String(raw.version)}，可能是更新的 AnyBeats 存的`);
  }
  if (Array.isArray(raw.measures)) return fromV1(raw as unknown as LegacyProjectV1, options);
  throw new ProjectFormatError('认不出的工程格式');
}

/** 读旧界面 localStorage 'anybeats_projects' 的整个值（一个 SavedProject 数组） */
export function migrateLegacyStorage(value: string | null, options: DeserializeOptions = {}): Project[] {
  if (!value) return [];
  const list: unknown = JSON.parse(value);
  if (!Array.isArray(list)) throw new ProjectFormatError('旧作品列表不是数组');
  return list.map((p) => deserializeProject(p, options));
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fromV2(file: ProjectFileV2): Project {
  if (file.stepsPerBar !== STEPS_PER_BAR) {
    throw new ProjectFormatError(`暂不支持每小节 ${file.stepsPerBar} 格的工程`);
  }
  const sections: Section[] = file.sections.map((s) => ({
    id: s.id,
    kind: s.kind in SECTION_KIND_NAMES ? s.kind : 'verse',
    label: s.label,
    bars: s.bars.map(
      (b): Bar => ({
        id: b.id,
        clips: b.clips
          .map((c): Clip => {
            const clip = createClip({ start: c.start, length: c.length, text: c.text, accent: !!c.accent, hold: !!c.hold });
            return { ...clip, id: c.id };
          })
          .sort((x, y) => x.start - y.start),
      }),
    ),
  }));
  return {
    name: file.name,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    bpm: file.bpm,
    offsetMs: file.offsetMs,
    grid: { sections },
  };
}

function fromV1(old: LegacyProjectV1, options: DeserializeOptions): Project {
  const bars = old.measures.map((cells) => {
    const clips: Clip[] = [];
    cells.forEach((cell, beat) => {
      // 旧格子 = 1 拍 = 4 个 1/16；格内的字平均分这一拍（与旧「智能导唱」一致），超过 4 个字时挤进同一格
      const chars = Array.from(cell.text ?? '');
      const slots = Math.min(chars.length, STEPS_PER_BEAT);
      const groups: string[] = Array.from({ length: slots }, () => '');
      chars.forEach((ch, i) => {
        groups[Math.floor((i * slots) / chars.length)] += ch;
      });
      let first = true;
      groups.forEach((g, i) => {
        const start = beat * STEPS_PER_BEAT + Math.floor((i * STEPS_PER_BEAT) / slots);
        const end = beat * STEPS_PER_BEAT + Math.floor(((i + 1) * STEPS_PER_BEAT) / slots);
        const text = g.replace(/ /g, '');
        if (!text) return; // 空拍
        const hold = /^-+$/.test(text);
        clips.push(
          createClip({
            start,
            length: end - start,
            text: hold ? '' : text.replace(/-/g, ''),
            hold,
            accent: !hold && first && !!cell.isAccented,
          }),
        );
        if (!hold) first = false;
      });
    });
    return createBar(clips);
  });
  const section: Section = { ...createSection('verse', 0), bars: bars.length ? bars : [createBar()] };
  return {
    name: old.name ?? '',
    createdAt: old.createdAt ?? 0,
    updatedAt: old.updatedAt ?? 0,
    bpm: options.defaultBpm ?? 90,
    offsetMs: 0,
    grid: { sections: [section] },
  };
}

// ---------- 导出 ----------

/** 某个绝对 1/16 位置对应的歌曲时间（秒）= 偏移 + 位置 × 步长 */
export function timeOfStep(project: Pick<Project, 'bpm' | 'offsetMs'>, absStep: number): number {
  return project.offsetMs / 1000 + absStep * stepDuration(project.bpm);
}

interface Line {
  section: number;
  absStart: number;
  clips: { clip: Clip; absStart: number }[];
}

/** 一个小节一行，跳过没有字的小节 */
function lines(grid: Grid): Line[] {
  const out: Line[] = [];
  let current: Line | null = null;
  let key = '';
  for (const loc of iterateClips(grid)) {
    if (loc.clip.hold || !loc.clip.text) continue;
    const k = `${loc.section}/${loc.bar}`;
    if (k !== key) {
      current = { section: loc.section, absStart: loc.absStart, clips: [] };
      out.push(current);
      key = k;
    }
    current!.clips.push({ clip: loc.clip, absStart: loc.absStart });
  }
  return out;
}

/** 纯文本：段落标题 + 每小节一行 */
export function exportTxt(project: Project): string {
  const out: string[] = [];
  let lastSection = -1;
  for (const line of lines(project.grid)) {
    if (line.section !== lastSection) {
      if (out.length) out.push('');
      out.push(`[${project.grid.sections[line.section].label}]`);
      lastSection = line.section;
    }
    out.push(line.clips.map((c) => c.clip.text).join(''));
  }
  return out.join('\n') + (out.length ? '\n' : '');
}

export function formatLrcTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const mm = Math.floor(cs / 6000);
  const ss = Math.floor((cs % 6000) / 100);
  const xx = cs % 100;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(xx).padStart(2, '0')}`;
}

export interface LrcOptions {
  /** 逐字时间戳（增强 LRC：`<mm:ss.xx>字`），默认 false */
  wordTimestamps?: boolean;
}

/** LRC：每小节一行，时间戳 = 该行第一个字的时刻（网格 + BPM + 偏移算出） */
export function exportLrc(project: Project, options: LrcOptions = {}): string {
  const out: string[] = [];
  if (project.name) out.push(`[ti:${project.name}]`);
  out.push('[re:AnyBeats]');
  for (const line of lines(project.grid)) {
    const head = `[${formatLrcTime(timeOfStep(project, line.absStart))}]`;
    const body = options.wordTimestamps
      ? line.clips.map((c) => `<${formatLrcTime(timeOfStep(project, c.absStart))}>${c.clip.text}`).join('')
      : line.clips.map((c) => c.clip.text).join('');
    out.push(head + body);
  }
  return out.join('\n') + '\n';
}
