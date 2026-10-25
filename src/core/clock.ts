/**
 * 唯一的播放时钟：基于 AudioContext.currentTime 的前瞻调度（"A Tale of Two Clocks" 模式）。
 *
 * - 时间源可注入：浏览器里传 `{ now: () => ctx.currentTime }`，测试里传假时钟，结果完全确定。
 * - 唤醒器只负责"隔一会儿叫醒调度器看一眼"，不参与计时：每个 1/16 的发声时刻都由
 *   anchor + n × 步长 算出来，再交给 Web Audio 在那个精确时刻发声，唤醒抖动不影响节奏。
 * - 位置单位是 1/16（STEPS_PER_BEAT = 4）；歌曲时间 = 第一拍偏移 + 位置 × 步长。
 */

import { STEPS_PER_BAR, STEPS_PER_BEAT } from './grid';

export interface TimeSource {
  /** 单调递增的秒数，例如 AudioContext.currentTime */
  now(): number;
}

export interface Waker {
  /** 开始周期性调用 tick，返回停止函数 */
  start(tick: () => void): () => void;
}

export interface LoopRegion {
  /** 含，单位 1/16 */
  start: number;
  /** 不含，单位 1/16 */
  end: number;
}

export interface ClockOptions {
  time: TimeSource;
  bpm: number;
  /** 第一拍（第 0 格）在伴奏里的位置，毫秒 */
  offsetMs?: number;
  loop?: LoopRegion | null;
  /** 前瞻窗口：每次唤醒把未来这么多秒内的格子排好，默认 0.1s */
  lookahead?: number;
  /** 按下播放到第一个格子发声之间的预留，默认 0.05s，给调度留余量 */
  startDelay?: number;
  /** 不给就需要外部（如 requestAnimationFrame）手动调用 tick() */
  waker?: Waker;
}

export interface StepEvent {
  /** 网格上的位置（已按循环区间折回），单位 1/16 */
  step: number;
  /** 应当发声的时刻（时间源的秒） */
  time: number;
  /** 这个格子对应的歌曲时间（秒）= 偏移 + step × 步长 */
  songTime: number;
}

export type TransportEvent =
  | { type: 'start'; time: number; step: number; songTime: number }
  /** 循环折回：伴奏需要在 time 时刻从 songTime 重新开始 */
  | { type: 'jump'; time: number; step: number; songTime: number }
  /** 播放中改了 BPM：伴奏按新步长从 songTime 重新对齐 */
  | { type: 'retime'; time: number; step: number; songTime: number }
  | { type: 'stop'; time: number };

export type ClockState = 'stopped' | 'playing';

export function stepDuration(bpm: number): number {
  return 60 / bpm / STEPS_PER_BEAT;
}

export class Clock {
  private readonly time: TimeSource;
  private readonly waker?: Waker;
  private readonly lookahead: number;
  private readonly startDelay: number;
  private bpmValue: number;
  private offsetMsValue: number;
  private loopValue: LoopRegion | null;

  private stateValue: ClockState = 'stopped';
  private anchorTime = 0;
  /** 锚点处的线性位置（未折回） */
  private anchorStep = 0;
  /** 自锚点起已排好的格子数 */
  private scheduled = 0;
  private lastWrapped: number | null = null;
  private stopWaker: (() => void) | null = null;

  private stepListeners = new Set<(e: StepEvent) => void>();
  private transportListeners = new Set<(e: TransportEvent) => void>();

  constructor(options: ClockOptions) {
    this.time = options.time;
    this.waker = options.waker;
    this.lookahead = options.lookahead ?? 0.1;
    this.startDelay = options.startDelay ?? 0.05;
    this.bpmValue = checkBpm(options.bpm);
    this.offsetMsValue = options.offsetMs ?? 0;
    this.loopValue = checkLoop(options.loop ?? null);
  }

  get state(): ClockState {
    return this.stateValue;
  }

  get bpm(): number {
    return this.bpmValue;
  }

  get offsetMs(): number {
    return this.offsetMsValue;
  }

  get loop(): LoopRegion | null {
    return this.loopValue;
  }

  get stepSeconds(): number {
    return stepDuration(this.bpmValue);
  }

  onStep(listener: (e: StepEvent) => void): () => void {
    this.stepListeners.add(listener);
    return () => this.stepListeners.delete(listener);
  }

  onTransport(listener: (e: TransportEvent) => void): () => void {
    this.transportListeners.add(listener);
    return () => this.transportListeners.delete(listener);
  }

  /** 歌曲时间（秒）↔ 网格位置 */
  songTimeOfStep(step: number): number {
    return this.offsetMsValue / 1000 + step * this.stepSeconds;
  }

  stepOfSongTime(seconds: number): number {
    return (seconds - this.offsetMsValue / 1000) / this.stepSeconds;
  }

  play(fromStep = 0): void {
    if (this.stateValue === 'playing') this.stop();
    this.stateValue = 'playing';
    this.anchorTime = this.time.now() + this.startDelay;
    this.anchorStep = fromStep;
    this.scheduled = 0;
    this.lastWrapped = null;
    const step = this.wrap(fromStep);
    this.emitTransport({ type: 'start', time: this.anchorTime, step, songTime: this.songTimeOfStep(step) });
    this.tick();
    if (this.waker) this.stopWaker = this.waker.start(() => this.tick());
  }

  /** 停止并复位：position() 回到 null，下次 play 从头（或指定位置）开始 */
  stop(): void {
    if (this.stateValue === 'stopped') return;
    this.stateValue = 'stopped';
    this.stopWaker?.();
    this.stopWaker = null;
    this.scheduled = 0;
    this.lastWrapped = null;
    this.emitTransport({ type: 'stop', time: this.time.now() });
  }

  setBpm(bpm: number): void {
    checkBpm(bpm);
    if (this.stateValue === 'playing') {
      // 从下一个还没排的格子开始换新步长，已排好的格子不动
      const nextTime = this.anchorTime + this.scheduled * this.stepSeconds;
      this.anchorStep += this.scheduled;
      this.anchorTime = nextTime;
      this.scheduled = 0;
      this.bpmValue = bpm;
      const step = this.wrap(this.anchorStep);
      this.emitTransport({ type: 'retime', time: nextTime, step, songTime: this.songTimeOfStep(step) });
      this.tick();
    } else {
      this.bpmValue = bpm;
    }
  }

  setOffsetMs(offsetMs: number): void {
    this.offsetMsValue = offsetMs;
  }

  setLoop(loop: LoopRegion | null): void {
    this.loopValue = checkLoop(loop);
  }

  /** 当前播放位置（1/16，带小数，已折回）；停止时为 null */
  position(): number | null {
    if (this.stateValue !== 'playing') return null;
    const linear = this.anchorStep + (this.time.now() - this.anchorTime) / this.stepSeconds;
    if (linear < this.anchorStep) return this.wrap(this.anchorStep);
    return this.wrap(linear);
  }

  /** 调度器：把 now + lookahead 之前还没排的格子全部发出去 */
  tick(): void {
    if (this.stateValue !== 'playing') return;
    const horizon = this.time.now() + this.lookahead;
    const dur = this.stepSeconds;
    for (;;) {
      const time = this.anchorTime + this.scheduled * dur;
      if (time >= horizon) break;
      const step = this.wrap(this.anchorStep + this.scheduled);
      const songTime = this.songTimeOfStep(step);
      if (this.lastWrapped !== null && step !== this.lastWrapped + 1) {
        this.emitTransport({ type: 'jump', time, step, songTime });
      }
      this.lastWrapped = step;
      this.scheduled += 1;
      for (const l of this.stepListeners) l({ step, time, songTime });
      if (this.stateValue !== 'playing') break;
    }
  }

  private wrap(linear: number): number {
    const loop = this.loopValue;
    if (!loop || linear < loop.end) return linear;
    const len = loop.end - loop.start;
    return loop.start + ((((linear - loop.end) % len) + len) % len);
  }

  private emitTransport(e: TransportEvent) {
    for (const l of this.transportListeners) l(e);
  }
}

function checkBpm(bpm: number): number {
  if (!Number.isFinite(bpm) || bpm < 20 || bpm > 400) throw new RangeError(`BPM ${bpm} 超出 20–400`);
  return bpm;
}

function checkLoop(loop: LoopRegion | null): LoopRegion | null {
  if (loop && !(Number.isInteger(loop.start) && Number.isInteger(loop.end) && 0 <= loop.start && loop.start < loop.end)) {
    throw new RangeError(`循环区间 ${loop.start}–${loop.end} 不合法`);
  }
  return loop;
}

/** 浏览器里默认的唤醒器：setTimeout 链，间隔只影响"多久看一眼"，不影响发声时刻。 */
export function createTimeoutWaker(intervalMs = 25): Waker {
  return {
    start(tick) {
      let handle: ReturnType<typeof setTimeout> | null = null;
      const loop = () => {
        tick();
        handle = setTimeout(loop, intervalMs);
      };
      handle = setTimeout(loop, intervalMs);
      return () => {
        if (handle !== null) clearTimeout(handle);
      };
    },
  };
}

// ---------- 从时钟派生的调度 ----------

export interface ClickSink {
  /** 在 time 时刻发一个节拍声；accent = 小节第一拍 */
  click(time: number, accent: boolean): void;
  /** 停止时取消已排但未发声的 */
  cancel?(): void;
}

/** 节拍器：每拍（4 个 1/16）一个声，小节首拍重音。 */
export function attachMetronome(clock: Clock, sink: ClickSink): () => void {
  const offStep = clock.onStep(({ step, time }) => {
    if (step % STEPS_PER_BEAT === 0) sink.click(time, step % STEPS_PER_BAR === 0);
  });
  const offTransport = clock.onTransport((e) => {
    if (e.type === 'stop') sink.cancel?.();
  });
  return () => {
    offStep();
    offTransport();
  };
}

export interface BackingSink {
  /** 在 time 时刻从伴奏的 songTime 秒处开始播放 */
  startAt(time: number, songTime: number): void;
  /** 在 time 时刻停 */
  stopAt(time: number): void;
}

/** 伴奏：起播、循环折回、改速、停止都跟着时钟走。 */
export function attachBacking(clock: Clock, sink: BackingSink): () => void {
  return clock.onTransport((e) => {
    if (e.type === 'stop') {
      sink.stopAt(e.time);
      return;
    }
    if (e.type !== 'start') sink.stopAt(e.time);
    sink.startAt(e.time, Math.max(0, e.songTime));
  });
}
