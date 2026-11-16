/**
 * 工程文件：带 schema 版本号的 JSON 序列化 / 反序列化，能读旧版本并迁移；导出 txt / LRC。
 *
 * 版本：
 *   1 —— 旧界面 localStorage 'anybeats_projects' 里的 SavedProject
 *        { name, createdAt, updatedAt, measures: {text, isAccented}[][] }，每格 = 1 拍，格内多个字平均分这一拍，
 *        ' ' = 空拍，'-' = 延音。没有 BPM / 偏移。
 *   2 —— 第一期：{ schema, version: 2, stepsPerBar: 16, sections[{kind, label(中文), bars[{clips[{start,length,text,accent,hold}]}]}] }，
 *        单位 1/16；延音是单独的 hold 片段。datode.com/anybeats/ 11-15 起的作品都是这一版。
 *   3 —— 现在：单位 tick（每拍 48）；字 = 起点 + 长度（拖音就是长度）；段落名英文；
 *        另存押韵规则（rules）、涂色（paint）、锁定（locks）、伴奏信息（beat）。
 *
 * 迁移 2 → 3（migrateV2）：1/16 → tick ×12；中文段落名 → 英文；hold 片段并进前一个字的长度（可跨小节）；
 * 空拍片段变成空白；一个片段里多个字按时长平分成几个字。重音这一版不用，丢掉（原文在存储里另有备份键）。
 */

import { tickDuration } from './clock';
import {
  allBars,
  createWord,
  iterateWords,
  normalize,
  relabelSections,
  SECTION_KIND_NAMES,
  SECTION_KINDS,
  TICKS_PER_BAR,
  TICKS_PER_STEP,
  type Bar,
  type Grid,
  type Section,
  type SectionKind,
  type Word,
} from './grid';
import { emptyLocks, pruneLocks, type Locks } from './locks';
import { prunePaint, type Paint, type RhymeRule } from './rhymeRules';
import type { Codec } from './history';

export const PROJECT_SCHEMA = 'anybeats.project';
export const PROJECT_VERSION = 3;

/** 伴奏信息（音频本身不存进本机，刷新后要重新选文件） */
export interface BeatRef {
  name: string;
  /** 检测出的伴奏 BPM（没检测出为 null） */
  bpm: number | null;
  /** 伴奏播放速度：保留原 BPM 时新伴奏变速播放（工程 BPM ÷ 伴奏 BPM），改用新 BPM 时为 1 */
  rate: number;
  durationSec: number | null;
}

/** 撤销历史跟踪的那部分：歌词、规则、涂色、锁定、速度、伴奏 */
export interface Doc {
  bpm: number;
  /** 第一拍在伴奏里的位置，毫秒 */
  offsetMs: number;
  beat: BeatRef | null;
  grid: Grid;
  rules: RhymeRule[];
  paint: Paint;
  locks: Locks;
}

export interface Project extends Doc {
  name: string;
  createdAt: number;
  updatedAt: number;
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
    beat: init.beat ?? null,
    grid: init.grid ?? { sections: [{ id: 's0', kind: 'verse', label: 'Verse 1', bars: Array.from({ length: 8 }, (_, i) => ({ id: `b0${i}`, words: [] })) }] },
    rules: init.rules ?? [],
    paint: init.paint ?? {},
    locks: init.locks ?? emptyLocks(),
  };
}

/** 存盘前清理：涂色 / 锁定里指向已删除小节、规则、或已经不能涂的格子的条目去掉 */
export function tidyDoc<T extends Doc>(doc: T): T {
  const paint = prunePaint(doc.grid, doc.rules, doc.paint);
  const locks = pruneLocks(doc.grid, doc.locks);
  return paint === doc.paint && locks === doc.locks ? doc : { ...doc, paint, locks };
}

// ---------- v3 文件 ----------

interface WordFile {
  id: string;
  tick: number;
  len: number;
  text: string;
}

interface SectionFile {
  id: string;
  kind: SectionKind;
  label: string;
  bars: { id: string; words: WordFile[] }[];
}

interface ProjectFileV3 {
  schema: typeof PROJECT_SCHEMA;
  version: 3;
  name: string;
  createdAt: number;
  updatedAt: number;
  bpm: number;
  offsetMs: number;
  timeSignature: '4/4';
  ticksPerBeat: 48;
  beat: BeatRef | null;
  sections: SectionFile[];
  rules: RhymeRule[];
  paint: Paint;
  locks: Locks;
}

export function serializeProject(project: Project): string {
  const file: ProjectFileV3 = {
    schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    bpm: project.bpm,
    offsetMs: project.offsetMs,
    timeSignature: '4/4',
    ticksPerBeat: 48,
    beat: project.beat,
    sections: project.grid.sections.map((s) => ({
      id: s.id,
      kind: s.kind,
      label: s.label,
      bars: s.bars.map((b) => ({ id: b.id, words: b.words.map((w) => ({ id: w.id, tick: w.tick, len: w.len, text: w.text })) })),
    })),
    rules: project.rules,
    paint: project.paint,
    locks: project.locks,
  };
  return JSON.stringify(file);
}

export interface DeserializeOptions {
  /** 旧版本没有 BPM 时用这个，默认 90（旧界面默认值） */
  defaultBpm?: number;
}

/** 读的是哪一版（不解析内容）；认不出返回 null */
export function projectVersionOf(raw: unknown): 1 | 2 | 3 | number | null {
  if (!isObject(raw)) return null;
  if (raw.schema === PROJECT_SCHEMA) return typeof raw.version === 'number' ? raw.version : null;
  if (Array.isArray(raw.measures)) return 1;
  return null;
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
    if (raw.version === 3) return fromV3(raw as unknown as ProjectFileV3);
    if (raw.version === 2) return migrateV2(raw as unknown as ProjectFileV2);
    throw new ProjectFormatError(`不认识的工程版本 ${String(raw.version)}，可能是更新的 AnyBeats 存的`);
  }
  if (Array.isArray(raw.measures)) return migrateV2(v1ToV2(raw as unknown as LegacyProjectV1, options));
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

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function fromV3(file: ProjectFileV3): Project {
  if (!Array.isArray(file.sections)) throw new ProjectFormatError('工程里没有段落');
  const sections: Section[] = file.sections.map((s) => ({
    id: String(s.id),
    kind: SECTION_KINDS.includes(s.kind) ? s.kind : 'verse',
    label: String(s.label ?? SECTION_KIND_NAMES.verse),
    bars: (s.bars ?? []).map(
      (b): Bar => ({
        id: String(b.id),
        words: (b.words ?? []).map((w) => createWord({ id: String(w.id), tick: w.tick, len: w.len, text: String(w.text ?? '') })).sort((x, y) => x.tick - y.tick),
      }),
    ),
  }));
  const rules = Array.isArray(file.rules)
    ? file.rules.map((r) => ({ id: String(r.id), hue: num(r.hue, 215), count: Math.max(1, Math.min(4, num(r.count, 1))) as RhymeRule['count'], finals: (r.finals ?? []).map(String) }))
    : [];
  const locks: Locks = isObject(file.locks)
    ? {
        bars: Array.isArray(file.locks.bars) ? file.locks.bars.map(String) : [],
        beats: Array.isArray(file.locks.beats) ? file.locks.beats.map(Number) : [],
        cells: Array.isArray(file.locks.cells) ? file.locks.cells.map(String) : [],
        rhyme: !!file.locks.rhyme,
      }
    : emptyLocks();
  return tidyDoc({
    name: String(file.name ?? ''),
    createdAt: num(file.createdAt, 0),
    updatedAt: num(file.updatedAt, 0),
    bpm: num(file.bpm, 90),
    offsetMs: num(file.offsetMs, 0),
    beat: isObject(file.beat) ? { name: String(file.beat.name), bpm: file.beat.bpm ?? null, rate: num(file.beat.rate, 1), durationSec: file.beat.durationSec ?? null } : null,
    grid: normalize({ sections }),
    rules,
    paint: isObject(file.paint) ? Object.fromEntries(Object.entries(file.paint).map(([k, v]) => [k, String(v)])) : {},
    locks,
  });
}

// ---------- v2 → v3 迁移 ----------

export interface ProjectFileV2 {
  schema: typeof PROJECT_SCHEMA;
  version: 2;
  name: string;
  createdAt: number;
  updatedAt: number;
  bpm: number;
  offsetMs: number;
  timeSignature?: '4/4';
  stepsPerBar: number;
  sections: {
    id: string;
    kind: string;
    label: string;
    bars: { id: string; clips: { id: string; start: number; length: number; text: string; accent?: boolean; hold?: boolean }[] }[];
  }[];
}

/** 旧段落类型 → 新类型（导歌算 Bridge，副歌算 Hook） */
const V2_KIND: Record<string, SectionKind> = {
  intro: 'intro',
  verse: 'verse',
  prechorus: 'bridge',
  chorus: 'hook',
  hook: 'hook',
  bridge: 'bridge',
  outro: 'outro',
};

/** 旧段落名（中文）→ 新类型；带号的保留号（主歌 2 → Verse 2） */
const V2_LABEL: [RegExp, SectionKind][] = [
  [/^前奏/, 'intro'],
  [/^主歌/, 'verse'],
  [/^导歌/, 'bridge'],
  [/^副歌/, 'hook'],
  [/^hook/i, 'hook'],
  [/^桥段/, 'bridge'],
  [/^尾奏/, 'outro'],
  [/^intro/i, 'intro'],
  [/^verse/i, 'verse'],
  [/^bridge/i, 'bridge'],
  [/^outro/i, 'outro'],
];

export function migrateV2(file: ProjectFileV2): Project {
  if (!Array.isArray(file.sections)) throw new ProjectFormatError('旧工程里没有段落');
  const spb = num(file.stepsPerBar, 16);
  if (spb !== 16) throw new ProjectFormatError(`暂不支持每小节 ${spb} 格的旧工程`);
  const sections: Section[] = [];
  const words: { abs: number; len: number; text: string; id: string }[] = [];
  const barIds: string[] = [];
  let global = 0;
  let last: { abs: number; len: number } | null = null;
  for (const s of file.sections) {
    const byLabel = V2_LABEL.find(([re]) => re.test(String(s.label ?? '').trim()));
    const kind = byLabel ? byLabel[1] : (V2_KIND[s.kind] ?? 'verse');
    const n = String(s.label ?? '').match(/(\d+)\s*$/);
    const sec: Section = { id: String(s.id), kind, label: n ? `${SECTION_KIND_NAMES[kind]} ${n[1]}` : SECTION_KIND_NAMES[kind], bars: [] };
    for (const b of s.bars ?? []) {
      const bar: Bar = { id: String(b.id), words: [] };
      sec.bars.push(bar);
      barIds.push(bar.id);
      const clips = [...(b.clips ?? [])].sort((x, y) => x.start - y.start);
      for (const c of clips) {
        const abs = global * TICKS_PER_BAR + Math.round(num(c.start, 0)) * TICKS_PER_STEP;
        const len = Math.max(1, Math.round(num(c.length, 1))) * TICKS_PER_STEP;
        const text = String(c.text ?? '').replace(/\s/g, '');
        if (c.hold) {
          // 延音：前一个字正好在这里结束，就把它拉长（可以跨小节）；前面是空拍就丢掉
          if (last && last.abs + last.len === abs) last.len += len;
          continue;
        }
        if (!text) {
          last = null; // 空拍 = 空白
          continue;
        }
        const chars = Array.from(text);
        if (chars.length === 1 || len < chars.length) {
          // 一个字；或者时长不够分（极少见），几个字留在同一个字里
          const w = { abs, len, text, id: String(c.id) };
          words.push(w);
          last = w;
          continue;
        }
        chars.forEach((ch, i) => {
          const s0 = abs + Math.floor((i * len) / chars.length);
          const s1 = abs + Math.floor(((i + 1) * len) / chars.length);
          const w = { abs: s0, len: s1 - s0, text: ch, id: i === 0 ? String(c.id) : `${c.id}_${i}` };
          words.push(w);
          last = w;
        });
      }
      global += 1;
    }
    sections.push(sec);
  }
  for (const w of words) {
    const g = Math.floor(w.abs / TICKS_PER_BAR);
    const bar = sections.flatMap((s) => s.bars).find((b) => b.id === barIds[g]);
    bar?.words.push(createWord({ id: w.id, tick: w.abs - g * TICKS_PER_BAR, len: w.len, text: w.text }));
  }
  let grid: Grid = { sections };
  // 没带号的同类段落按顺序编号（两段「主歌」→ Verse 1 / Verse 2）
  const dup = sections.some((s, i) => !/\d$/.test(s.label) && sections.some((t, j) => j !== i && t.kind === s.kind));
  if (dup) grid = relabelSections(grid);
  return {
    name: String(file.name ?? ''),
    createdAt: num(file.createdAt, 0),
    updatedAt: num(file.updatedAt, 0),
    bpm: num(file.bpm, 90),
    offsetMs: num(file.offsetMs, 0),
    beat: null,
    grid: normalize(grid),
    rules: [],
    paint: {},
    locks: emptyLocks(),
  };
}

// ---------- v1 → v2 ----------

export interface LegacyProjectV1 {
  name: string;
  createdAt: number;
  updatedAt: number;
  measures: { text: string; isAccented: boolean }[][];
}

let v1Seq = 0;

/** 旧格子 = 1 拍 = 4 个 1/16；格内的字平均分这一拍（与旧「智能导唱」一致），超过 4 个字时挤进同一格 */
export function v1ToV2(old: LegacyProjectV1, options: DeserializeOptions = {}): ProjectFileV2 {
  const id = () => `v1_${(v1Seq += 1).toString(36)}`;
  const bars = old.measures.map((cells) => {
    const clips: ProjectFileV2['sections'][number]['bars'][number]['clips'] = [];
    cells.forEach((cell, beat) => {
      const chars = Array.from(cell.text ?? '');
      const slots = Math.min(chars.length, 4);
      const groups: string[] = Array.from({ length: slots }, () => '');
      chars.forEach((ch, i) => {
        groups[Math.floor((i * slots) / chars.length)] += ch;
      });
      groups.forEach((g, i) => {
        const start = beat * 4 + Math.floor((i * 4) / slots);
        const end = beat * 4 + Math.floor(((i + 1) * 4) / slots);
        const text = g.replace(/ /g, '');
        if (!text) return;
        const hold = /^-+$/.test(text);
        clips.push({ id: id(), start, length: end - start, text: hold ? '' : text.replace(/-/g, ''), hold, accent: false });
      });
    });
    return { id: id(), clips };
  });
  return {
    schema: PROJECT_SCHEMA,
    version: 2,
    name: old.name ?? '',
    createdAt: old.createdAt ?? 0,
    updatedAt: old.updatedAt ?? 0,
    bpm: options.defaultBpm ?? 90,
    offsetMs: 0,
    stepsPerBar: 16,
    sections: [{ id: id(), kind: 'verse', label: '主歌 1', bars: bars.length ? bars : [{ id: id(), clips: [] }] }],
  };
}

// ---------- 撤销历史的编码：每个快照拆成「元数据 / 规则 / 涂色 / 锁定 / 段落骨架 / 每个小节」 ----------

export const docCodec: Codec<Doc> = {
  split(doc) {
    const skeleton = doc.grid.sections.map((s) => ({ id: s.id, kind: s.kind, label: s.label, bars: s.bars.length }));
    return [
      JSON.stringify({ bpm: doc.bpm, offsetMs: doc.offsetMs, beat: doc.beat }),
      JSON.stringify(doc.rules),
      JSON.stringify(doc.paint),
      JSON.stringify(doc.locks),
      JSON.stringify(skeleton),
      ...doc.grid.sections.flatMap((s) => s.bars.map((b) => JSON.stringify(b))),
    ];
  },
  join(parts, parse) {
    const meta = parse(parts[0]) as Pick<Doc, 'bpm' | 'offsetMs' | 'beat'>;
    const skeleton = parse(parts[4]) as { id: string; kind: SectionKind; label: string; bars: number }[];
    let i = 5;
    const sections: Section[] = skeleton.map((s) => ({ id: s.id, kind: s.kind, label: s.label, bars: Array.from({ length: s.bars }, () => parse(parts[i++]) as Bar) }));
    return {
      bpm: meta.bpm,
      offsetMs: meta.offsetMs,
      beat: meta.beat,
      rules: parse(parts[1]) as RhymeRule[],
      paint: parse(parts[2]) as Paint,
      locks: parse(parts[3]) as Locks,
      grid: { sections },
    };
  },
};

// ---------- 导出 ----------

/** 某个绝对 tick 对应的歌曲时间（秒）= 偏移 + tick × (60 / BPM / 48)。换 BPM 时 tick 不动，只有秒数变 */
export function timeOfTick(project: Pick<Doc, 'bpm' | 'offsetMs'>, absTick: number): number {
  return project.offsetMs / 1000 + absTick * tickDuration(project.bpm);
}

/** 1/16 步长的时间（时钟、节拍器用） */
export function timeOfStep(project: Pick<Doc, 'bpm' | 'offsetMs'>, absStep: number): number {
  return timeOfTick(project, absStep * TICKS_PER_STEP);
}

interface Line {
  section: number;
  abs: number;
  words: { word: Word; abs: number }[];
}

/** 一个小节一行，跳过没有字的小节 */
function lines(grid: Grid): Line[] {
  const out: Line[] = [];
  let current: Line | null = null;
  let key = -1;
  for (const loc of iterateWords(grid)) {
    if (!loc.word.text) continue;
    if (loc.global !== key) {
      current = { section: loc.section, abs: loc.abs, words: [] };
      out.push(current);
      key = loc.global;
    }
    current!.words.push({ word: loc.word, abs: loc.abs });
  }
  return out;
}

/** 纯文本：段落标题 + 每小节一行 */
export function exportTxt(project: Pick<Project, 'grid'>): string {
  const out: string[] = [];
  let lastSection = -1;
  for (const line of lines(project.grid)) {
    if (line.section !== lastSection) {
      if (out.length) out.push('');
      out.push(`[${project.grid.sections[line.section].label}]`);
      lastSection = line.section;
    }
    out.push(line.words.map((c) => c.word.text).join(''));
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

/** LRC：每小节一行，时间戳 = 该行第一个字的时刻 */
export function exportLrc(project: Pick<Project, 'grid' | 'bpm' | 'offsetMs' | 'name'>, options: LrcOptions = {}): string {
  const out: string[] = [];
  if (project.name) out.push(`[ti:${project.name}]`);
  out.push('[re:AnyBeats]');
  for (const line of lines(project.grid)) {
    const head = `[${formatLrcTime(timeOfTick(project, line.abs))}]`;
    const body = options.wordTimestamps
      ? line.words.map((c) => `<${formatLrcTime(timeOfTick(project, c.abs))}>${c.word.text}`).join('')
      : line.words.map((c) => c.word.text).join('');
    out.push(head + body);
  }
  return out.join('\n') + '\n';
}

/** 全曲小节数（给作品库索引用） */
export function projectBars(project: Pick<Project, 'grid'>): number {
  return allBars(project.grid).length;
}
