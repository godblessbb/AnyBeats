import { locateTick, TICKS_PER_BEAT, TICKS_PER_STEP, wordAt, type Grid, type Word } from './grid';

export interface Playhead {
  /** 全曲绝对位置（tick，整数） */
  absTick: number;
  section: number;
  bar: number;
  /** 全曲第几个小节 */
  global: number;
  /** 小节内 tick（0–191） */
  tick: number;
  /** 小节内第几拍（0–3） */
  beat: number;
  /** 正在唱的字（含拖音），没有则 null */
  word: Word | null;
}

/**
 * 时钟位置 → 歌词区该高亮哪里。
 * 输入是 Clock.position() 给出的「全曲第几个 1/16」（带小数）；停止（null）或越出全曲时返回 null，界面据此清掉高亮。
 */
export function playheadAt(grid: Grid, position: number | null): Playhead | null {
  if (position === null) return null;
  const absTick = Math.floor(position * TICKS_PER_STEP);
  const addr = locateTick(grid, absTick);
  if (!addr) return null;
  const w = wordAt(grid, absTick);
  return {
    absTick,
    ...addr,
    global: Math.floor(absTick / (TICKS_PER_BEAT * 4)),
    beat: Math.floor(addr.tick / TICKS_PER_BEAT),
    word: w ? w.word : null,
  };
}
