/**
 * 内置作品：首次打开的「夜车」（就是视觉稿里那首）和旧界面「使用示例」的「街头节奏」。
 * 只用 core 的构造函数拼数据，不自己定义格式。
 */

import {
  createBar,
  createClip,
  createProject,
  createSection,
  importAiLyrics,
  type AiLyricData,
  type Bar,
  type Clip,
  type Project,
  type SectionKind,
} from '../core';

/**
 * 一小节的简写：每个字符一个 1/16 格。
 * '.' 空格子；'-' 延音（接在前一个字后面就拉长它，否则是单独的延音片段）；'_' 空拍；其它是字。
 */
export function barFromPattern(pattern: string, accents: number[] = []): Bar {
  const clips: Clip[] = [];
  Array.from(pattern)
    .slice(0, 16)
    .forEach((ch, i) => {
      if (ch === '.') return;
      const prev = clips[clips.length - 1];
      if (ch === '-') {
        if (prev && !prev.hold && prev.start + prev.length === i) prev.length += 1;
        else clips.push(createClip({ start: i, hold: true }));
        return;
      }
      clips.push(createClip({ start: i, text: ch === '_' ? '' : ch, accent: accents.includes(i) && ch !== '_' }));
    });
  return createBar(clips);
}

interface DemoSection {
  kind: SectionKind;
  label: string;
  bars: [string, number[]][];
}

const NIGHT_DRIVE: DemoSection[] = [
  {
    kind: 'verse',
    label: '主歌 1',
    bars: [
      ['凌晨三点.我还在路-上----.', [0, 5]],
      ['霓虹灯把影子拉得很长---...', [0]],
      ['耳机.里鼓点敲着.心-脏---.', [0, 8]],
      ['每一步.都踩在.节拍-上---.', [0, 8]],
    ],
  },
  {
    kind: 'hook',
    label: 'Hook',
    bars: [
      ['开着夜车__一路向-前----.', [0, 6]],
      ['把梦想写进每一个字-眼---..', [0]],
      ['别问我_为什么_不-眠----.', [0, 8]],
      ['答案都在下个八拍-里-面--..', [0, 4]],
    ],
  },
  {
    kind: 'verse',
    label: '主歌 2',
    bars: [
      ['从地下室_到大-舞-台---..', [0]],
      ['没人给我_捷径..........', [0]],
    ],
  },
];

export function nightDriveProject(now: number): Project {
  const sections = NIGHT_DRIVE.map((s) => ({
    ...createSection(s.kind, 0, s.label),
    bars: s.bars.map(([p, acc]) => barFromPattern(p, acc)),
  }));
  return createProject({ name: '夜车', bpm: 92, offsetMs: 120, createdAt: now, updatedAt: now, grid: { sections } });
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
  const section = { ...grid.sections[0], label: '主歌 1' };
  return createProject({ name: '街头节奏', bpm: bpm ?? 90, createdAt: now, updatedAt: now, grid: { sections: [section] } });
}

export const EXAMPLES = [
  { key: 'street', name: '示例：街头节奏', build: streetRhythmProject },
  { key: 'night', name: '示例：夜车', build: nightDriveProject },
] as const;

export type ExampleKey = (typeof EXAMPLES)[number]['key'];

/** 空工程：一个 16 小节的「主歌 1」 */
export function emptyProject(name: string, now: number, bpm = 90): Project {
  return createProject({ name, bpm, createdAt: now, updatedAt: now, grid: { sections: [createSection('verse', 16, '主歌 1')] } });
}
