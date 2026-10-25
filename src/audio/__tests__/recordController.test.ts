/**
 * 录音控制器 + ChunkInputSource 的整条链路（不需要浏览器）：
 * 假声卡把「放出去的声音」延迟 D 秒后当作外部分片推回来（回环），
 * 校准应该量出 D，之后录的 take 自动按 D 往前挪，回放层和对齐结果一致。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STEPS_PER_BEAT, type TransportEvent } from '../../core';
import { FakeTimers, MemoryStore } from '../../core/__tests__/fakeTime';
import { EditorStore } from '../../engine/editorStore';
import type { AudioLayer, PlayOptions, TransportState } from '../../engine/transport';
import { ProjectLibrary } from '../../storage/library';
import { WebStorage } from '../../storage/StorageAdapter';
import { MemoryTakeStore } from '../../storage/takeStore';
import { ChunkInputSource } from '../ChunkInputSource';
import { LATENCY_KEY, RecordController, type RecordTransport } from '../RecordController';
import { alignedRegion } from '../takes';

const SR = 48000;

class FakeBuffer {
  data: Float32Array;
  readonly sampleRate: number;
  constructor(len: number, sr: number) {
    this.data = new Float32Array(len);
    this.sampleRate = sr;
  }
  get duration() {
    return this.data.length / this.sampleRate;
  }
  copyToChannel(src: Float32Array) {
    this.data.set(src);
  }
}

/** 假 AudioContext：放出去的 buffer 经过 delay 秒回环进 ChunkInputSource */
class LoopbackCtx {
  sampleRate = SR;
  currentTime = 1;
  destination = {};
  private input: ChunkInputSource;
  private delay: number;
  constructor(input: ChunkInputSource, delay: number) {
    this.input = input;
    this.delay = delay;
  }
  createBuffer(_ch: number, len: number, sr: number) {
    return new FakeBuffer(len, sr);
  }
  createGain() {
    return { gain: { value: 1 }, connect: () => ({}) };
  }
  createBufferSource() {
    const node = {
      buffer: null as FakeBuffer | null,
      connect: () => ({ connect: () => ({}) }),
      start: (t: number) => {
        const b = node.buffer!;
        const echo = b.data.map((v, i) => 0.3 * v + 0.02 * Math.sin(i * 0.37));
        this.input.push({ channels: echo, sampleRate: b.sampleRate, time: t + this.delay });
      },
      stop: () => {},
    };
    return node;
  }
}

class FakeTransport implements RecordTransport {
  playing = false;
  layers: () => AudioLayer[] = () => [];
  private listeners = new Set<(e: TransportEvent) => void>();
  private ctx: LoopbackCtx;
  private bpm: number;
  private offsetMs: number;
  constructor(ctx: LoopbackCtx, bpm: number, offsetMs: number) {
    this.ctx = ctx;
    this.bpm = bpm;
    this.offsetMs = offsetMs;
  }
  ensureRunning = async () => this.ctx as unknown as AudioContext;
  audioContext = () => this.ctx as unknown as AudioContext;
  onClock(l: (e: TransportEvent) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  setLayers(p: () => AudioLayer[]) {
    this.layers = p;
  }
  async play(step = 0, options: PlayOptions = {}) {
    void options;
    this.playing = true;
    const songTime = this.offsetMs / 1000 + (step * 60) / this.bpm / STEPS_PER_BEAT;
    this.emit({ type: 'start', time: this.ctx.currentTime + 0.05, step, songTime });
  }
  stop() {
    if (!this.playing) return;
    this.playing = false;
    this.emit({ type: 'stop', time: this.ctx.currentTime });
  }
  getState = () => ({ playing: this.playing }) as TransportState;
  private emit(e: TransportEvent) {
    for (const l of this.listeners) l(e);
  }
}

function setup(delayMs: number, offsetMs = 500) {
  const settings = new WebStorage(new MemoryStore() as unknown as Storage);
  const library = new ProjectLibrary(settings, () => 1000);
  const editor = new EditorStore({ storage: settings, library, timers: new FakeTimers(), now: () => 1000 });
  editor.setOffsetMs(offsetMs);
  const input = new ChunkInputSource();
  const ctx = new LoopbackCtx(input, delayMs / 1000);
  const s = editor.getState();
  const transport = new FakeTransport(ctx, s.bpm, s.offsetMs);
  const store = new MemoryTakeStore();
  const recorder = new RecordController({ transport, editor, input, store, settings });
  return { settings, editor, input, ctx, transport, store, recorder };
}

/** 同时推进假声卡时间和定时器 */
async function run(ctx: LoopbackCtx, seconds: number) {
  const steps = Math.round(seconds / 0.05);
  for (let i = 0; i < steps; i++) {
    ctx.currentTime += 0.05;
    await vi.advanceTimersByTimeAsync(50);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('RecordController + ChunkInputSource（外部分片输入）', () => {
  it('外部没接上：点录音立即给出原因，不挂起', async () => {
    const { recorder } = setup(0);
    await recorder.startRecording();
    const st = recorder.getState();
    expect(st.phase).toBe('idle');
    expect(st.available.ok).toBe(false);
  });

  it('接上之后：第一次录音先走校准；回环 40 ms → 量出 40 ms 并存进本机设置', async () => {
    const { recorder, input, ctx, settings } = setup(40);
    input.connect('外层页面');
    await recorder.startRecording();
    expect(recorder.getState().calibration?.step).toBe(1);
    await recorder.runCalibration();
    expect(recorder.getState().calibration?.step).toBe(2);
    await run(ctx, 7);
    const cal = recorder.getState().calibration!;
    expect(cal.error).toBeNull();
    expect(cal.step).toBe(3);
    expect(Math.abs(cal.result! - 40)).toBeLessThanOrEqual(2);
    recorder.acceptCalibration();
    expect(JSON.parse(settings.getItem(LATENCY_KEY)!).ms).toBe(cal.result);
    // 确认后直接开录
    await vi.advanceTimersByTimeAsync(0);
    expect(recorder.getState().phase).toBe('recording');
  });

  it('录一遍：take 带上校准延迟，对齐位置 = 开录时的歌曲时间 − 延迟；回放层用同一个位置', async () => {
    const { recorder, input, ctx, transport } = setup(180);
    input.connect();
    recorder.setLatency(180);
    await recorder.startRecording();
    expect(recorder.getState().phase).toBe('recording');
    // 外部每 20ms 推一片「人声」
    for (let k = 0; k < 100; k++) {
      input.push({ channels: new Float32Array(960).fill(0.2), sampleRate: SR, time: 1 + k * 0.02 });
    }
    await run(ctx, 1.5);
    transport.stop();
    await vi.advanceTimersByTimeAsync(200);
    const st = recorder.getState();
    expect(st.phase).toBe('idle');
    expect(st.takes).toHaveLength(1);
    const take = st.takes[0];
    expect(take.latencyMs).toBe(180);
    expect(take.selected).toBe(true);
    expect(take.duration).toBeCloseTo(1.45, 2);
    expect(take.songStart).toBeCloseTo(0.5, 9); // 从第 0 格开录，歌曲时间 = 首拍偏移
    const region = alignedRegion(take)!;
    expect(region.position).toBeCloseTo(0.5 - 0.18, 9);
    // 回放层
    const [layer] = transport.layers();
    expect(layer.position).toBeCloseTo(region.position, 9);
    expect(layer.length).toBeCloseTo(region.length, 9);
    // 录到的就是推进来的分片
    const full = recorder.allTakes()[0];
    expect(full.samples[100]).toBeCloseTo(0.2, 6);
  });

  it('★ 只能选一个；裁剪收进范围；删除', async () => {
    const { recorder, input, ctx, transport } = setup(0);
    input.connect();
    recorder.setLatency(0);
    for (let n = 0; n < 2; n++) {
      await recorder.startRecording();
      await run(ctx, 1);
      transport.stop();
      await vi.advanceTimersByTimeAsync(200);
    }
    const [a, b] = recorder.getState().takes;
    expect([a.name, b.name]).toEqual(['Take 1', 'Take 2']);
    expect([a.selected, b.selected]).toEqual([true, false]);
    recorder.select(b.id);
    expect(recorder.getState().takes.map((t) => t.selected)).toEqual([false, true]);
    recorder.setTrim(b.id, -1, 0.2);
    expect(recorder.getState().takes[1]).toMatchObject({ trimStart: 0, trimEnd: 0.2 });
    recorder.remove(a.id);
    expect(recorder.getState().takes.map((t) => t.name)).toEqual(['Take 2']);
  });
});
