import { clipAt, locateStep, STEPS_PER_BEAT, type Clip, type Grid } from './grid';

export interface Playhead {
  /** 全曲绝对位置（1/16，整数） */
  absStep: number;
  section: number;
  bar: number;
  /** 小节内第几个 1/16（0–15） */
  step: number;
  /** 小节内第几拍（0–3） */
  beat: number;
  /** 正在唱的片段（含延音），没有则 null */
  clip: Clip | null;
}

/**
 * 时钟位置 → 歌词区该高亮哪里。
 * 输入必须是 Clock.position() 给出的「全曲第几个 1/16」，不是「小节内第几拍」；
 * 停止（null）或越出全曲时返回 null，界面据此清掉高亮。
 */
export function playheadAt(grid: Grid, position: number | null): Playhead | null {
  if (position === null) return null;
  const addr = locateStep(grid, position);
  if (!addr) return null;
  return {
    absStep: Math.floor(position),
    ...addr,
    beat: Math.floor(addr.step / STEPS_PER_BEAT),
    clip: clipAt(grid, addr),
  };
}
