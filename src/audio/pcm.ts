/**
 * PCM 小工具（纯函数，不碰 Web Audio）：混成单声道、线性重采样、按时间拼接分片、电平。
 */

import type { PcmChunk } from './AudioInputSource';

/** 多声道平均成单声道 */
export function mixDown(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const n = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) out[i] += c[i];
  const k = 1 / channels.length;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

/** 线性插值重采样；同采样率原样返回 */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const n = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(n);
  const step = fromRate / toRate;
  for (let i = 0; i < n; i++) {
    const x = i * step;
    const j = Math.floor(x);
    const f = x - j;
    const a = input[Math.min(j, input.length - 1)];
    const b = input[Math.min(j + 1, input.length - 1)];
    out[i] = a + (b - a) * f;
  }
  return out;
}

/**
 * 收集输入分片，按分片自带的时间戳拼成一段连续 PCM。
 * 分片之间有空档补 0，重叠的后到覆盖先到；只保留 keepSeconds 以内的分片（校准、录音都不会更长）。
 */
export class PcmCollector {
  private chunks: PcmChunk[] = [];
  readonly sampleRate: number;
  private readonly keepSeconds: number;

  constructor(sampleRate: number, keepSeconds = 30 * 60) {
    this.sampleRate = sampleRate;
    this.keepSeconds = keepSeconds;
  }

  push(chunk: PcmChunk): void {
    this.chunks.push(chunk);
    const last = chunk.time;
    while (this.chunks.length > 1 && this.chunks[0].time < last - this.keepSeconds) this.chunks.shift();
  }

  clear(): void {
    this.chunks = [];
  }

  /** 最后一个采样之后的时间（秒）；还没有分片时 null */
  get endTime(): number | null {
    const c = this.chunks[this.chunks.length - 1];
    return c ? c.time + c.samples.length / this.sampleRate : null;
  }

  /** 取 [from, to) 这段时间的采样（秒，AudioContext 时间） */
  extract(from: number, to: number): Float32Array {
    const sr = this.sampleRate;
    const n = Math.max(0, Math.round((to - from) * sr));
    const out = new Float32Array(n);
    for (const c of this.chunks) {
      const at = Math.round((c.time - from) * sr);
      const s0 = Math.max(0, -at);
      const s1 = Math.min(c.samples.length, n - at);
      if (s1 <= s0) continue;
      out.set(c.samples.subarray(s0, s1), at + s0);
    }
    return out;
  }
}

/** 均方根电平（dBFS），静音时 -Infinity */
export function rmsDb(samples: ArrayLike<number>): number {
  if (samples.length === 0) return -Infinity;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}
