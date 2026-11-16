/**
 * 内置作品：首次打开的「夜车」（v3 / v3b 视觉稿里那首）和旧界面「使用示例」的「街头节奏」。
 * 只用 core 的构造函数拼数据，不自己定义格式。
 */

import {
  createProject,
  createSection,
  emptyLocks,
  importAiLyrics,
  insertWord,
  normalize,
  TICKS_PER_BAR,
  TICKS_PER_BEAT,
  type AiLyricData,
  type Grid,
  type Paint,
  type Project,
  type RhymeRule,
  type SectionKind,
} from '../core';

/**
 * 一拍的简写：一个字 = 一个 16 分起点（12 tick）的字；「-」把前一个字再拖长一个单位（可以拖过拍线、小节线）；
 * 「_」留一个单位的空白；「?」还没填字的字；「[ab]」两个 1/32；「3:」开头 = 三连（每个 16 tick）；「6:」开头 = 半拍三连（8 tick）。
 */
export interface DemoSection {
  kind: SectionKind;
  label: string;
  bars: [string, string, string, string][];
}

/** 把简写铺成网格（全曲连续解析，「-」能接到上一拍 / 上一小节的字） */
export function gridFromPatterns(sections: DemoSection[]): Grid {
  let grid: Grid = { sections: sections.map((s) => ({ ...createSection(s.kind, s.bars.length, s.label) })) };
  let last: { abs: number; len: number; text: string } | null = null;
  const words: { abs: number; len: number; text: string }[] = [];
  let global = 0;
  for (const s of sections) {
    for (const beats of s.bars) {
      beats.forEach((raw, bi) => {
        let unit = 12;
        let str = raw;
        if (str.startsWith('3:')) {
          unit = 16;
          str = str.slice(2);
        } else if (str.startsWith('6:')) {
          unit = 8;
          str = str.slice(2);
        }
        let t = global * TICKS_PER_BAR + bi * TICKS_PER_BEAT;
        const put = (c: string, len: number) => {
          if (c === '-') {
            if (last) last.len += len;
          } else if (c === '_') last = null;
          else {
            last = { abs: t, len, text: c === '?' ? '' : c };
            words.push(last);
          }
          t += len;
        };
        const cs = Array.from(str);
        for (let i = 0; i < cs.length; i++) {
          if (cs[i] === '[') {
            put(cs[i + 1], 6);
            put(cs[i + 2], 6);
            i += 3;
          } else put(cs[i], unit);
        }
      });
      global += 1;
    }
  }
  for (const w of words) grid = insertWord(grid, w.abs, w.len, w.text);
  return normalize(grid);
}

const NIGHT_DRIVE: DemoSection[] = [
  { kind: 'intro', label: 'Intro', bars: [['____', '____', '____', '走-吧-']] },
  {
    kind: 'verse',
    label: 'Verse 1',
    bars: [
      ['凌晨三点', '街灯_在', '还在路上', '找个地方'],
      ['霓---', '风吹过来', '把那梦想', '吹向西方'],
      ['3:我不怕', '_走得慢', '只要心里', '还有一场'],
      ['每一步都', '踩在节拍', '-带着光', '一起启航'],
    ],
  },
  {
    kind: 'hook',
    label: 'Hook',
    bars: [
      ['开着夜-', '车_穿过', '霓虹_的', '路口--'],
      ['--油门', '----', '踩到满-', '我就不走'],
      ['3:风在吹', '灯-在闪', '这条街_', '没有出口'],
      ['开着夜-', '车_穿过', '一个一个', '十字路口'],
    ],
  },
];

/** 夜车的四种颜色：蓝 i·ang（Verse 第 4 拍）、绿 ai、粉 u·ou（Hook 第 4 拍）、金 an */
const NIGHT_RULES: RhymeRule[] = [
  { id: 'rA', hue: 215, count: 2, finals: ['i', 'ang'] },
  { id: 'rB', hue: 150, count: 1, finals: ['ai'] },
  { id: 'rC', hue: 340, count: 2, finals: ['u', 'ou'] },
  { id: 'rD', hue: 42, count: 1, finals: ['an'] },
];
/** [全曲小节号（1 起）, 拍（0 起）, 规则] */
const NIGHT_PAINT: [number, number, string][] = [
  [2, 3, 'rA'],
  [3, 3, 'rA'],
  [4, 3, 'rA'],
  [5, 3, 'rA'],
  [2, 1, 'rB'],
  [3, 1, 'rB'],
  [5, 1, 'rB'],
  [6, 3, 'rC'],
  [7, 3, 'rC'],
  [8, 3, 'rC'],
  [9, 3, 'rC'],
  [7, 2, 'rD'],
];

export function nightDriveProject(now: number): Project {
  const grid = gridFromPatterns(NIGHT_DRIVE);
  const bars = grid.sections.flatMap((s) => s.bars);
  const paint: Paint = {};
  for (const [bar, beat, rule] of NIGHT_PAINT) paint[`${bars[bar - 1].id}:${beat}`] = rule;
  return createProject({
    name: '夜车',
    bpm: 92,
    offsetMs: 120,
    createdAt: now,
    updatedAt: now,
    grid,
    rules: NIGHT_RULES.map((r) => ({ ...r, finals: [...r.finals] })),
    paint,
    locks: emptyLocks(),
  });
}

/** 旧界面 AILyricsGenerator.useExampleData 的数据（原样），经 core/importAi 导入 */
export const STREET_RHYTHM: AiLyricData = {
  bpm: 90,
  timeSignature: '4/4',
  measures: [
    {
      measureIndex: 0,
      lyrics: [
        { text: '我', startBeat: 0, duration: 4 },
        { text: '走', startBeat: 4, duration: 4 },
        { text: '在', startBeat: 8, duration: 4 },
        { text: '街', startBeat: 12, duration: 4 },
        { text: '上', startBeat: 16, duration: 8 },
        { text: '感', startBeat: 24, duration: 4 },
        { text: '受', startBeat: 28, duration: 4 },
        { text: '节', startBeat: 32, duration: 4 },
        { text: '奏', startBeat: 36, duration: 12 },
      ],
    },
    {
      measureIndex: 1,
      lyrics: [
        { text: '音', startBeat: 0, duration: 4 },
        { text: '乐', startBeat: 4, duration: 4 },
        { text: '在', startBeat: 8, duration: 4 },
        { text: '耳', startBeat: 12, duration: 4 },
        { text: '边', startBeat: 16, duration: 8 },
        { text: '回', startBeat: 24, duration: 4 },
        { text: '荡', startBeat: 28, duration: 12 },
      ],
    },
  ],
};

export function streetRhythmProject(now: number): Project {
  const { grid, bpm } = importAiLyrics(STREET_RHYTHM, { sectionKind: 'verse' });
  const section = { ...grid.sections[0], label: 'Verse 1' };
  return createProject({ name: '街头节奏', bpm: bpm ?? 90, createdAt: now, updatedAt: now, grid: { sections: [section] } });
}

export const EXAMPLES = [
  { key: 'street', name: '示例：街头节奏', build: streetRhythmProject },
  { key: 'night', name: '示例：夜车', build: nightDriveProject },
] as const;

export type ExampleKey = (typeof EXAMPLES)[number]['key'];

/** 空工程：一个 8 小节的 Verse 1 */
export function emptyProject(name: string, now: number, bpm = 90): Project {
  return createProject({ name, bpm, createdAt: now, updatedAt: now, grid: { sections: [createSection('verse', 8, 'Verse 1')] } });
}
