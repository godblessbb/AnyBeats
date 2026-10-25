/**
 * 外部推 PCM 分片进来的输入源（给 Alphie 画布用：外层页面录音，画布里只接收）。
 *
 * 传输协议还没定，这里只做接收端：谁拿到了分片就调 push()。本模块不往 parent 发任何消息。
 *
 *   const input = new ChunkInputSource();
 *   input.connect('外层页面的麦克风');       // 外层说「我能录了」
 *   input.push({ channels: [f32], sampleRate: 48000 });   // 一片片推进来
 *   input.disconnect('外层页面关了麦克风');
 *
 * 分片可以带 time（已经换算成本页 AudioContext 时间的秒数）；不带时按到达时刻倒推第一片、之后首尾相接，
 * 剩下的固定偏差由延迟校准量出来一并补偿。采样率不同会线性重采样，多声道会混成单声道。
 */

import { InputError, type AudioInputSource, type InputAvailability, type InputContext, type InputStarted, type PcmChunk } from './AudioInputSource';
import { mixDown, resampleLinear } from './pcm';

export interface ExternalPcmChunk {
  channels: Float32Array | Float32Array[];
  sampleRate: number;
  /** 第一个采样对应的本页 AudioContext 时间（秒），不知道就不给 */
  time?: number;
}

export class ChunkInputSource implements AudioInputSource {
  readonly kind = 'chunk' as const;
  private connected = false;
  private label = '';
  private reason: string;
  private listeners = new Set<() => void>();
  private ctx: InputContext | null = null;
  private onChunk: ((c: PcmChunk) => void) | null = null;
  private nextTime: number | null = null;

  constructor(reason = '外层页面还没接上录音') {
    this.reason = reason;
  }

  availability(): InputAvailability {
    return this.connected ? { ok: true } : { ok: false, reason: this.reason };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 外部声明可以录了 */
  connect(label = '外部输入'): void {
    this.connected = true;
    this.label = label;
    this.emit();
  }

  /** 外部声明不能录了；正在录的会停在最后一片 */
  disconnect(reason = '外部输入已断开'): void {
    this.connected = false;
    this.reason = reason;
    this.stop();
    this.emit();
  }

  async start(ctx: InputContext, onChunk: (chunk: PcmChunk) => void): Promise<InputStarted> {
    if (!this.connected) throw new InputError(this.reason);
    this.ctx = ctx;
    this.onChunk = onChunk;
    this.nextTime = null;
    return { label: this.label };
  }

  stop(): void {
    this.ctx = null;
    this.onChunk = null;
    this.nextTime = null;
  }

  get running(): boolean {
    return this.onChunk !== null;
  }

  /** 推一片；没在录时直接丢掉 */
  push(chunk: ExternalPcmChunk): void {
    const ctx = this.ctx;
    const sink = this.onChunk;
    if (!ctx || !sink) return;
    const mono = mixDown(Array.isArray(chunk.channels) ? chunk.channels : [chunk.channels]);
    const samples = resampleLinear(mono, chunk.sampleRate, ctx.sampleRate);
    if (samples.length === 0) return;
    const duration = samples.length / ctx.sampleRate;
    const time = chunk.time ?? this.nextTime ?? ctx.currentTime - duration;
    this.nextTime = time + duration;
    sink({ samples, time });
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}
