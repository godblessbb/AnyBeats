/**
 * 走带：一个 core/clock 时钟，伴奏、节拍器、导唱、歌词高亮全挂在它上面（DESIGN.md §1.3）。
 *
 * - 时钟 = core/clock 的 Clock，时间源是 AudioContext.currentTime（拿不到声卡时退到 performance.now，只是不出声）。
 * - 节拍器 = core/clock 的 attachMetronome；伴奏 = attachBacking；导唱 = onStep 里遇到字的起点就打一下。
 * - 歌词高亮 = 每帧读 clock.position()，交给 core/playhead 的 playheadAt 算格子；停止时 position 为 null → 高亮清掉。
 * - BPM 检测 = core/bpm 的 estimateBpm。
 */

import {
  attachBacking,
  attachMetronome,
  Clock,
  createTimeoutWaker,
  estimateBpm,
  locateStep,
  mixToMono,
  stepDuration,
  totalSteps,
  type ClickSink,
  type TimeSource,
  type TransportEvent,
} from '../core';
import type { EditorStore } from './editorStore';

export interface BackingInfo {
  name: string;
  duration: number;
  /** 波形峰值 0–1，WAVE_BUCKETS 个 */
  peaks: number[];
}

export interface TransportState {
  playing: boolean;
  /** 当前播放到全曲第几个 1/16（整数）；停止时 null */
  position: number | null;
  metronome: boolean;
  guide: boolean;
  loop: boolean;
  backing: BackingInfo | null;
  backingVolume: number;
  clickVolume: number;
  analyzing: boolean;
  /** 没有声卡（只走高亮，不出声） */
  silent: boolean;
  /** 检测结果说明（例如「检测到 92 BPM」或失败原因） */
  message: string | null;
}

export const WAVE_BUCKETS = 240;

/** 跟伴奏一起放的一段音频（录好的 take）：歌曲时间线上 position 起放 sourceOffset 开始的 length 秒 */
export interface AudioLayer {
  buffer: AudioBuffer;
  position: number;
  sourceOffset: number;
  length: number;
}

export interface PlayOptions {
  /** 覆盖「循环」开关（录音时不循环） */
  loop?: boolean;
}

type AudioCtor = typeof AudioContext;

export class Transport {
  private readonly store: EditorStore;
  private ctx: AudioContext | null = null;
  private clock: Clock | null = null;
  /** 这一次播放临时指定的循环（录音时 false）；null = 跟着开关 */
  private loopOverride: boolean | null = null;
  private detach: (() => void)[] = [];
  private raf: number | null = null;
  private buffer: AudioBuffer | null = null;
  private backingNode: AudioBufferSourceNode | null = null;
  private backingGain: GainNode | null = null;
  private scheduled: OscillatorNode[] = [];
  private layerNodes: AudioBufferSourceNode[] = [];
  private layers: () => AudioLayer[] = () => [];
  private clockListeners = new Set<(e: TransportEvent) => void>();
  private listeners = new Set<() => void>();
  private state: TransportState = {
    playing: false,
    position: null,
    metronome: true,
    guide: false,
    loop: true,
    backing: null,
    backingVolume: 0.7,
    clickVolume: 0.45,
    analyzing: false,
    silent: false,
    message: null,
  };

  constructor(store: EditorStore) {
    this.store = store;
    store.subscribe(() => this.syncFromStore());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): TransportState => this.state;

  private set(patch: Partial<TransportState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  // ---------- 音频上下文 ----------

  /** 伴奏、节拍器、录音、校准共用这一个 AudioContext */
  audioContext(): AudioContext | null {
    return this.ensureContext();
  }

  /** 声卡能不能出声（会尝试 resume） */
  async ensureRunning(): Promise<AudioContext | null> {
    const ctx = this.ensureContext();
    return (await this.audioRunning(ctx)) ? ctx : null;
  }

  /** 时钟的起播 / 折回 / 改速 / 停止事件（每次播放新建的时钟都会接上） */
  onClock(listener: (e: TransportEvent) => void): () => void {
    this.clockListeners.add(listener);
    return () => this.clockListeners.delete(listener);
  }

  /** 跟伴奏一起放的音频（选用的 take）；每次起播 / 折回时现取 */
  setLayers(provider: () => AudioLayer[]): void {
    this.layers = provider;
  }

  /** 伴奏的 PCM（导出分轨用） */
  backingAudio(): { name: string; sampleRate: number; channels: Float32Array[] } | null {
    const b = this.buffer;
    if (!b || !this.state.backing) return null;
    return {
      name: this.state.backing.name,
      sampleRate: b.sampleRate,
      channels: Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i)),
    };
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const w = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  /** 声卡跑起来了没有：没跑起来（无设备 / 被策略挡住）就用 performance 时间走高亮 */
  private async audioRunning(ctx: AudioContext | null): Promise<boolean> {
    if (!ctx) return false;
    if (ctx.state === 'running') return true;
    try {
      await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 300))]);
    } catch {
      return false;
    }
    return (ctx.state as AudioContextState) === 'running';
  }

  // ---------- 播放 ----------

  get songSteps(): number {
    return totalSteps(this.store.getState().grid);
  }

  /** 唯一的播放键 */
  toggle(fromStep?: number): void {
    if (this.state.playing) this.stop();
    else void this.play(fromStep);
  }

  async play(fromStep = 0, options: PlayOptions = {}): Promise<void> {
    this.stop();
    const ctx = this.ensureContext();
    const audible = await this.audioRunning(ctx);
    const time: TimeSource = audible && ctx ? { now: () => ctx.currentTime } : { now: () => performance.now() / 1000 };
    const s = this.store.getState();
    const total = this.songSteps;
    const start = Math.max(0, Math.min(total - 1, Math.floor(fromStep)));
    const loop = options.loop ?? this.state.loop;
    this.loopOverride = options.loop ?? null;
    const clock = new Clock({
      time,
      bpm: s.bpm,
      offsetMs: s.offsetMs,
      loop: loop ? { start: 0, end: total } : null,
      waker: createTimeoutWaker(25),
    });
    this.clock = clock;

    if (audible && ctx) {
      this.detach.push(attachMetronome(clock, this.clickSink(ctx, () => this.state.metronome, 1000, 800)));
      const guide = this.clickSink(ctx, () => this.state.guide, 1480, 1180, 'triangle');
      this.detach.push(
        clock.onStep(({ step, time: t }) => {
          if (!this.state.guide) return;
          // 智能导唱：字的起点打一下（延音、空拍不打），重音字用高音
          const g = this.store.getState().grid;
          const addr = locateStep(g, step);
          const c = addr ? g.sections[addr.section].bars[addr.bar].clips.find((x) => x.start === addr.step) : null;
          if (c && !c.hold && c.text) guide.click(t, c.accent);
        }),
      );
      this.detach.push(
        attachBacking(clock, {
          startAt: (t, songTime) => this.startBacking(ctx, t, songTime),
          stopAt: (t) => this.stopBacking(t),
        }),
      );
      this.detach.push(
        clock.onTransport((e) => {
          this.stopLayers(e.time);
          if (e.type !== 'stop') this.startLayers(ctx, e.time, e.songTime);
        }),
      );
    }
    this.detach.push(
      clock.onTransport((e) => {
        if (e.type === 'stop') this.set({ playing: false, position: null });
        for (const l of this.clockListeners) l(e);
      }),
    );

    clock.play(start);
    this.set({ playing: true, position: start, silent: !audible });
    this.frame();
  }

  stop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    const clock = this.clock;
    this.clock = null;
    clock?.stop();
    for (const d of this.detach.splice(0)) d();
    this.stopBacking(0);
    this.stopLayers(0);
    if (this.state.playing || this.state.position !== null) this.set({ playing: false, position: null });
  }

  /** 每帧读一次时钟位置；只有换格时才通知界面 */
  private frame = () => {
    const clock = this.clock;
    if (!clock) return;
    const pos = clock.position();
    if (pos === null) {
      this.stop();
      return;
    }
    if (!clock.loop && pos >= this.songSteps) {
      this.stop();
      return;
    }
    const abs = Math.floor(pos);
    if (abs !== this.state.position) this.set({ position: abs });
    this.raf = requestAnimationFrame(this.frame);
  };

  private syncFromStore() {
    const clock = this.clock;
    if (!clock) return;
    const s = this.store.getState();
    if (clock.bpm !== s.bpm) clock.setBpm(s.bpm);
    if (clock.offsetMs !== s.offsetMs) clock.setOffsetMs(s.offsetMs);
    const total = this.songSteps;
    if ((this.loopOverride ?? this.state.loop) && clock.loop?.end !== total) clock.setLoop({ start: 0, end: total });
  }

  // ---------- 开关 ----------

  setMetronome(on: boolean) {
    this.set({ metronome: on });
  }

  setGuide(on: boolean) {
    this.set({ guide: on });
  }

  setLoop(on: boolean) {
    this.set({ loop: on });
    if (this.loopOverride === null) this.clock?.setLoop(on ? { start: 0, end: this.songSteps } : null);
  }

  setBackingVolume(v: number) {
    this.set({ backingVolume: v });
    if (this.backingGain) this.backingGain.gain.value = v;
  }

  setClickVolume(v: number) {
    this.set({ clickVolume: v });
  }

  // ---------- 发声 ----------

  private clickSink(ctx: AudioContext, enabled: () => boolean, hi: number, lo: number, type: OscillatorType = 'sine'): ClickSink {
    return {
      click: (time, accent) => {
        if (!enabled()) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = accent ? hi : lo;
        const v = Math.max(0.0001, this.state.clickVolume * (accent ? 0.9 : 0.6));
        gain.gain.setValueAtTime(v, time);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);
        osc.connect(gain).connect(ctx.destination);
        osc.start(time);
        osc.stop(time + 0.09);
        this.scheduled.push(osc);
        osc.onended = () => {
          this.scheduled = this.scheduled.filter((o) => o !== osc);
        };
      },
      cancel: () => {
        for (const o of this.scheduled.splice(0)) {
          try {
            o.stop();
          } catch {
            // 已经停了
          }
        }
      },
    };
  }

  private startBacking(ctx: AudioContext, time: number, songTime: number) {
    if (!this.buffer || songTime >= this.buffer.duration) return;
    this.stopBacking(time);
    const node = ctx.createBufferSource();
    node.buffer = this.buffer;
    const gain = ctx.createGain();
    gain.gain.value = this.state.backingVolume;
    node.connect(gain).connect(ctx.destination);
    node.start(Math.max(time, ctx.currentTime), songTime);
    this.backingNode = node;
    this.backingGain = gain;
  }

  private startLayers(ctx: AudioContext, time: number, songTime: number) {
    for (const layer of this.layers()) {
      const late = Math.max(0, songTime - layer.position);
      const length = layer.length - late;
      if (length <= 0.001) continue;
      const node = ctx.createBufferSource();
      node.buffer = layer.buffer;
      node.connect(ctx.destination);
      const at = time + Math.max(0, layer.position - songTime);
      node.start(Math.max(at, ctx.currentTime), layer.sourceOffset + late, length);
      this.layerNodes.push(node);
      node.onended = () => {
        this.layerNodes = this.layerNodes.filter((n) => n !== node);
      };
    }
  }

  private stopLayers(time: number) {
    for (const node of this.layerNodes.splice(0)) {
      try {
        node.stop(time);
      } catch {
        // 还没开始或已经停了
      }
    }
  }

  private stopBacking(time: number) {
    const node = this.backingNode;
    if (!node) return;
    this.backingNode = null;
    try {
      node.stop(time);
    } catch {
      // 还没开始或已经停了
    }
  }

  // ---------- 伴奏 ----------

  /** 拖入 / 选择伴奏：解码 → core/bpm 自动检测 BPM → 画波形 */
  async loadBacking(file: File): Promise<void> {
    const ctx = this.ensureContext();
    if (!ctx) {
      this.set({ message: '这个浏览器不支持 Web Audio，没法载入伴奏' });
      return;
    }
    this.stop();
    this.set({ analyzing: true, message: null });
    try {
      const data = await file.arrayBuffer();
      const buffer = await ctx.decodeAudioData(data);
      this.buffer = buffer;
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
      const mono = mixToMono(channels);
      const result = estimateBpm(mono, buffer.sampleRate);
      let message: string;
      if (Number.isFinite(result.bpm) && result.confidence > 0.05) {
        this.store.setBpm(result.bpm, true);
        message = `检测到 ${Math.round(result.bpm)} BPM`;
      } else {
        message = '没检测出稳定的拍子，BPM 请手动设置';
      }
      this.set({ backing: { name: file.name, duration: buffer.duration, peaks: peaksOf(mono) }, message });
    } catch (e) {
      this.set({ message: `伴奏载入失败：${(e as Error).message || '格式不支持'}` });
    } finally {
      this.set({ analyzing: false });
    }
  }

  removeBacking(): void {
    this.stop();
    this.buffer = null;
    this.set({ backing: null, message: null });
  }

  /** 歌曲总长（秒）：网格长度和伴奏长度取大 */
  songSeconds(): number {
    const s = this.store.getState();
    const grid = s.offsetMs / 1000 + this.songSteps * stepDuration(s.bpm);
    return Math.max(grid, this.state.backing?.duration ?? 0);
  }
}

export function peaksOf(samples: ArrayLike<number>, buckets = WAVE_BUCKETS): number[] {
  const out: number[] = [];
  const size = Math.max(1, Math.floor(samples.length / buckets));
  let max = 0;
  for (let b = 0; b < buckets; b++) {
    let peak = 0;
    const end = Math.min(samples.length, (b + 1) * size);
    for (let i = b * size; i < end; i++) {
      const v = Math.abs(samples[i]);
      if (v > peak) peak = v;
    }
    out.push(peak);
    if (peak > max) max = peak;
  }
  return max > 0 ? out.map((v) => v / max) : out;
}
