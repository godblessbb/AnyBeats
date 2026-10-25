/**
 * 录音：跟着走带（core 时钟）录多遍 take、★ 选用、裁头尾、回放、延迟校准。
 *
 * - 声音只从 AudioInputSource 来（麦克风或外部分片），这里不碰 getUserMedia。
 * - 对齐：开录时记下时钟 start 事件的 (AudioContext 时间, 歌曲时间)，按分片时间戳切出这一遍；
 *   往前挪的校准延迟记在 take 上，回放 / 轨道条 / .RPP 都用 takes.alignedRegion 算位置。
 * - 存储：TakeStore（IndexedDB，拿不到就内存）；校准结果记在 StorageAdapter（本机设置）。
 */

import { STEPS_PER_BAR, type TransportEvent } from '../core';
import type { EditorStore } from '../engine/editorStore';
import type { AudioLayer, Transport } from '../engine/transport';
import { playFrom } from '../engine/view';
import type { StorageAdapter } from '../storage/StorageAdapter';
import type { TakeStore } from '../storage/takeStore';
import { InputError, type AudioInputSource, type InputAvailability, type PcmChunk } from './AudioInputSource';
import { DEFAULT_PLAN, estimateLatency, makeCalibrationSignal } from './latency';
import { PcmCollector, rmsDb } from './pcm';
import { alignedRegion, clampTrim, makeTake, newTakeId, nextTakeName, type Take, type TakeMeta } from './takes';

export const LATENCY_KEY = 'anybeats.latency.v1';

/** 录音用到的那部分走带（测试里可以换成假的） */
export type RecordTransport = Pick<Transport, 'ensureRunning' | 'audioContext' | 'onClock' | 'setLayers' | 'play' | 'stop' | 'getState'>;
const MIN_TAKE_SECONDS = 0.3;

export interface CalibrationState {
  step: 1 | 2 | 3;
  running: boolean;
  /** 已经放完的脉冲数 / 总数 */
  done: number;
  total: number;
  /** 目前测到的平均（毫秒） */
  currentMs: number | null;
  /** 第 3 步要确认的结果 */
  result: number | null;
  error: string | null;
  /** 校准完直接开录 */
  thenRecord: boolean;
}

export type RecordPhase = 'idle' | 'starting' | 'recording' | 'saving';

export interface RecordState {
  available: InputAvailability;
  phase: RecordPhase;
  takes: TakeMeta[];
  /** 正在录的 take 名字 */
  recordingName: string | null;
  /** 正在录的这一遍从歌曲第几秒开始（轨道条画红色泳道用） */
  recordFromSec: number | null;
  /** 输入电平（dBFS） */
  levelDb: number;
  /** 本机校准的往返延迟；null = 还没校准 */
  latencyMs: number | null;
  calibration: CalibrationState | null;
  /** 正在试听的 take（null = 正常播放 / 没在放） */
  auditionId: string | null;
  deviceLabel: string;
  message: string | null;
  persistent: boolean;
  storeReason: string | null;
}

interface Capture {
  collector: PcmCollector;
  startTime: number | null;
  startSongTime: number;
  name: string;
  latencyMs: number;
  projectId: string;
  /** 时钟还没起来就按了停 */
  cancelled: boolean;
}

export class RecordController {
  private readonly transport: RecordTransport;
  private readonly editor: EditorStore;
  private readonly input: AudioInputSource;
  private readonly store: TakeStore;
  private readonly settings: StorageAdapter;
  private takes: Take[] = [];
  private buffers = new Map<string, AudioBuffer>();
  private capture: Capture | null = null;
  private projectId: string | null = null;
  private skipped = false;
  /** 还在 starting（等声卡 / 麦克风）时就按了停 */
  private cancelStart = false;
  private calTimer: ReturnType<typeof setInterval> | null = null;
  private calStop: (() => void) | null = null;
  private lastLevelAt = 0;
  private listeners = new Set<() => void>();
  private state: RecordState;

  constructor(opts: { transport: RecordTransport; editor: EditorStore; input: AudioInputSource; store: TakeStore; settings: StorageAdapter }) {
    this.transport = opts.transport;
    this.editor = opts.editor;
    this.input = opts.input;
    this.store = opts.store;
    this.settings = opts.settings;
    this.state = {
      available: this.input.availability(),
      phase: 'idle',
      takes: [],
      recordingName: null,
      recordFromSec: null,
      levelDb: -Infinity,
      latencyMs: this.readLatency(),
      calibration: null,
      auditionId: null,
      deviceLabel: '',
      message: null,
      persistent: this.store.persistent,
      storeReason: this.store.reason,
    };
    this.input.subscribe(() => this.set({ available: this.input.availability() }));
    this.transport.setLayers(() => this.layers());
    this.transport.onClock((e) => this.onClock(e));
    this.editor.subscribe(() => {
      const id = this.editor.getState().projectId;
      if (id !== this.projectId) void this.loadProject(id);
    });
    void this.loadProject(this.editor.getState().projectId);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): RecordState => this.state;

  private set(patch: Partial<RecordState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  get recording(): boolean {
    return this.state.phase === 'recording' || this.state.phase === 'starting';
  }

  /** 导出用：当前作品的全部 take（含音频） */
  allTakes(): Take[] {
    return this.takes;
  }

  // ---------- take 列表 ----------

  private async loadProject(projectId: string) {
    this.projectId = projectId;
    this.buffers.clear();
    let takes: Take[] = [];
    try {
      takes = await this.store.list(projectId);
    } catch (e) {
      this.set({ message: `读取录音失败：${(e as Error).message}` });
    }
    if (this.projectId !== projectId) return;
    this.takes = takes;
    this.publishTakes();
  }

  private publishTakes() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this.set({ takes: this.takes.map(({ samples, ...meta }) => meta) });
  }

  private async persist(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      this.set({ message: `录音没存进本机：${(e as Error).message || '存储出错'}（这次打开期间仍可用）` });
    }
  }

  private update(id: string, patch: Partial<TakeMeta>) {
    const t = this.takes.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    this.publishTakes();
    void this.persist(() => this.store.putMeta(t));
  }

  /** ★ 选用（只能选一个）；再点一次取消 */
  select(id: string): void {
    const target = this.takes.find((t) => t.id === id);
    if (!target) return;
    const on = !target.selected;
    for (const t of this.takes) {
      const want = t.id === id ? on : false;
      if (t.selected !== want) this.update(t.id, { selected: want });
    }
  }

  setTrim(id: string, trimStart: number, trimEnd: number): void {
    const t = this.takes.find((x) => x.id === id);
    if (!t) return;
    this.update(id, clampTrim(t.duration, trimStart, trimEnd));
  }

  remove(id: string): void {
    if (this.state.auditionId === id) this.transport.stop();
    this.takes = this.takes.filter((t) => t.id !== id);
    this.buffers.delete(id);
    this.publishTakes();
    void this.persist(() => this.store.remove(id));
  }

  /** 回放：伴奏 + 这个 take（不给 id 就是选用的那遍），从它开头前一点开始；歌词跟着高亮 */
  playTake(id?: string): void {
    if (this.recording) return;
    if (this.transport.getState().playing) {
      this.transport.stop();
      return;
    }
    const t = id ? this.takes.find((x) => x.id === id) : this.takes.find((x) => x.selected);
    if (!t) return;
    const r = alignedRegion(t);
    const s = this.editor.getState();
    const step = r ? Math.max(0, Math.floor((r.position - s.offsetMs / 1000) / (60 / s.bpm / 4))) : 0;
    this.set({ auditionId: t.id });
    void this.transport.play(step, { loop: false });
  }

  private layers(): AudioLayer[] {
    if (this.recording) return [];
    const ctx = this.transport.audioContext();
    if (!ctx) return [];
    const id = this.state.auditionId;
    const take = id ? this.takes.find((t) => t.id === id) : this.takes.find((t) => t.selected);
    if (!take || take.samples.length === 0) return [];
    const r = alignedRegion(take);
    if (!r) return [];
    let buffer = this.buffers.get(take.id);
    if (!buffer) {
      buffer = ctx.createBuffer(1, take.samples.length, take.sampleRate);
      buffer.copyToChannel(take.samples as Float32Array<ArrayBuffer>, 0);
      this.buffers.set(take.id, buffer);
    }
    return [{ buffer, position: r.position, sourceOffset: r.sourceOffset, length: r.length }];
  }

  // ---------- 录音 ----------

  /** 顶栏录音键 / R：没在录就开录（第一次先校准），在录就停 */
  toggleRecord(): void {
    if (this.recording) this.stopRecording();
    else void this.startRecording();
  }

  stopRecording(): void {
    if (!this.recording) return;
    if (!this.capture) this.cancelStart = true;
    else if (this.capture.startTime === null) this.capture.cancelled = true;
    this.transport.stop();
  }

  async startRecording(): Promise<void> {
    if (this.recording || this.state.calibration?.running) return;
    const available = this.input.availability();
    if (!available.ok) {
      // 原因已经显示在录音按钮和面板顶上，不再重复一条
      this.set({ available, message: null });
      return;
    }
    if (this.state.latencyMs === null && !this.skipped) {
      this.openCalibration(true);
      return;
    }
    this.set({ phase: 'starting', message: null, auditionId: null });
    this.cancelStart = false;
    this.transport.stop();
    const ctx = await this.transport.ensureRunning();
    if (this.cancelStart) {
      this.set({ phase: 'idle' });
      return;
    }
    if (!ctx) {
      this.set({ phase: 'idle', message: '声卡没有启动（没有输出设备或被浏览器挡住），没法跟伴奏录' });
      return;
    }
    const collector = new PcmCollector(ctx.sampleRate);
    let label = '';
    try {
      label = (await this.input.start(ctx, (c) => this.onChunk(collector, c))).label;
    } catch (e) {
      this.set({ phase: 'idle', message: e instanceof InputError ? e.message : `录音没开起来：${(e as Error).message}` });
      return;
    }
    if (this.cancelStart) {
      this.input.stop();
      this.set({ phase: 'idle' });
      return;
    }
    const projectId = this.editor.getState().projectId;
    const name = nextTakeName(this.takes);
    const cap: Capture = {
      collector,
      startTime: null,
      startSongTime: 0,
      name,
      latencyMs: this.state.latencyMs ?? 0,
      projectId,
      cancelled: false,
    };
    this.capture = cap;
    this.set({ phase: 'recording', recordingName: name, deviceLabel: label });
    // 预备 1 小节：从选中格所在小节的前一小节开始
    const from = playFrom(this.editor.getState().selection);
    const start = Math.max(0, Math.floor(from / STEPS_PER_BAR) * STEPS_PER_BAR - STEPS_PER_BAR);
    await this.transport.play(start, { loop: false });
    if (cap.cancelled) this.transport.stop();
    if (!this.transport.getState().playing && this.capture === cap) this.finish(ctx.currentTime);
  }

  private onChunk(collector: PcmCollector, chunk: PcmChunk) {
    collector.push(chunk);
    const now = Date.now();
    if (now - this.lastLevelAt > 100) {
      this.lastLevelAt = now;
      this.set({ levelDb: rmsDb(chunk.samples) });
    }
  }

  private onClock(e: TransportEvent) {
    const cap = this.capture;
    if (e.type === 'stop') {
      if (this.state.auditionId) this.set({ auditionId: null });
      if (cap) this.finish(this.transport.audioContext()?.currentTime ?? 0);
      return;
    }
    if (cap && e.type === 'start' && cap.startTime === null) {
      cap.startTime = e.time;
      cap.startSongTime = e.songTime;
      this.set({ recordFromSec: e.songTime });
    }
  }

  private finish(stopTime: number) {
    const cap = this.capture;
    if (!cap) return;
    this.capture = null;
    this.set({ phase: 'saving' });
    // 等最后一片从 worklet 送过来（一片 2048 帧 ≈ 45 ms）
    setTimeout(() => {
      this.input.stop();
      this.set({ phase: 'idle', recordingName: null, recordFromSec: null, levelDb: -Infinity });
      if (cap.startTime === null || stopTime - cap.startTime < MIN_TAKE_SECONDS) {
        this.set({ message: '录得太短，没有保存' });
        return;
      }
      const take = makeTake(
        cap.collector,
        { startTime: cap.startTime, startSongTime: cap.startSongTime, stopTime },
        { id: newTakeId(Date.now()), projectId: cap.projectId, name: cap.name, createdAt: Date.now(), latencyMs: cap.latencyMs },
      );
      if (!this.takes.some((t) => t.selected)) take.selected = true;
      if (cap.projectId !== this.projectId) {
        void this.persist(() => this.store.put(take));
        return;
      }
      this.takes = [...this.takes, take];
      this.publishTakes();
      void this.persist(() => this.store.put(take));
    }, 150);
  }

  // ---------- 延迟校准 ----------

  private readLatency(): number | null {
    try {
      const raw = this.settings.getItem(LATENCY_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw) as { ms?: unknown };
      return typeof v.ms === 'number' && Number.isFinite(v.ms) ? v.ms : null;
    } catch {
      return null;
    }
  }

  openCalibration(thenRecord = false): void {
    if (this.recording) return;
    this.set({ calibration: { step: 1, running: false, done: 0, total: DEFAULT_PLAN.count, currentMs: null, result: null, error: null, thenRecord }, message: null });
  }

  /** 跳过（这次打开期间不再问），按 0 ms 录 */
  skipCalibration(): void {
    const then = this.state.calibration?.thenRecord ?? false;
    this.cancelCalibrationRun();
    this.skipped = true;
    this.set({ calibration: null });
    if (then) void this.startRecording();
  }

  async runCalibration(): Promise<void> {
    const cal = this.state.calibration;
    if (!cal || cal.running) return;
    const available = this.input.availability();
    if (!available.ok) {
      this.set({ calibration: { ...cal, error: available.reason } });
      return;
    }
    this.transport.stop();
    const ctx = await this.transport.ensureRunning();
    if (!ctx) {
      this.set({ calibration: { ...cal, error: '声卡没有启动，没法放校准声' } });
      return;
    }
    const collector = new PcmCollector(ctx.sampleRate);
    let label = '';
    try {
      label = (await this.input.start(ctx, (c) => collector.push(c))).label;
    } catch (e) {
      this.set({ calibration: { ...cal, error: (e as Error).message } });
      return;
    }
    const signal = makeCalibrationSignal(ctx.sampleRate);
    const buffer = ctx.createBuffer(1, signal.length, ctx.sampleRate);
    buffer.copyToChannel(signal as Float32Array<ArrayBuffer>, 0);
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.8;
    node.connect(gain).connect(ctx.destination);
    const t0 = ctx.currentTime + 0.3;
    node.start(t0);
    const end = t0 + buffer.duration;
    this.set({ deviceLabel: label, calibration: { ...cal, step: 2, running: true, done: 0, currentMs: null, result: null, error: null } });
    this.calStop = () => {
      try {
        node.stop();
      } catch {
        // 已经停了
      }
      this.input.stop();
    };
    const plan = DEFAULT_PLAN;
    this.calTimer = setInterval(() => {
      const c = this.state.calibration;
      if (!c) return this.cancelCalibrationRun();
      const now = ctx.currentTime;
      const done = Math.max(0, Math.min(plan.count, Math.floor((now - t0 - plan.lead - 0.5) / plan.interval) + 1));
      if (now < end + 0.2) {
        if (done !== c.done) {
          const partial = done > 0 ? estimateLatency(collector.extract(t0, now), ctx.sampleRate, {}, done) : null;
          this.set({ calibration: { ...c, done, currentMs: partial?.latencyMs ?? null } });
        }
        return;
      }
      this.cancelCalibrationRun();
      const est = estimateLatency(collector.extract(t0, end), ctx.sampleRate);
      if (est.ok) {
        this.set({ calibration: { ...c, step: 3, running: false, done: plan.count, currentMs: est.latencyMs, result: est.latencyMs } });
      } else {
        this.set({ calibration: { ...c, step: 2, running: false, error: est.reason } });
      }
    }, 100);
  }

  private cancelCalibrationRun() {
    if (this.calTimer !== null) clearInterval(this.calTimer);
    this.calTimer = null;
    this.calStop?.();
    this.calStop = null;
  }

  /** 第 3 步：微调结果 */
  adjustCalibration(deltaMs: number): void {
    const c = this.state.calibration;
    if (!c || c.result === null) return;
    this.set({ calibration: { ...c, result: Math.max(0, Math.round((c.result + deltaMs) * 10) / 10) } });
  }

  /** 第 3 步：确认，存进本机设置；之后每个 take 自动按这个值对齐 */
  acceptCalibration(): void {
    const c = this.state.calibration;
    if (!c || c.result === null) return;
    this.setLatency(c.result);
    this.set({ calibration: null });
    if (c.thenRecord) void this.startRecording();
  }

  setLatency(ms: number): void {
    try {
      this.settings.setItem(LATENCY_KEY, JSON.stringify({ ms, at: Date.now() }));
    } catch {
      // 存不进去也照样用这次的值
    }
    this.set({ latencyMs: ms });
  }

  closeCalibration(): void {
    this.cancelCalibrationRun();
    this.set({ calibration: null });
  }
}
