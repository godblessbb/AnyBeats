/**
 * take 的数据和对齐算法（纯函数）。回放、轨道条、.RPP 导出都用 alignedRegion 算位置，
 * 所以校准偏移只在这一个地方生效，三处不会各算各的。
 *
 * 时间都是「歌曲时间」（秒）：0 = 伴奏开头，第一拍在 offsetMs。
 */

import { peaksOf } from '../engine/transport';
import type { PcmCollector } from './pcm';

export interface TakeMeta {
  id: string;
  projectId: string;
  /** Take 1、Take 2…… */
  name: string;
  createdAt: number;
  sampleRate: number;
  /** 录音第一个采样「被录到」时伴奏走到的歌曲时间（秒），未做延迟补偿 */
  songStart: number;
  /** 录这个 take 时用的往返延迟（毫秒）；0 = 没校准 */
  latencyMs: number;
  /** 裁头 / 裁尾（秒，相对录音本身） */
  trimStart: number;
  trimEnd: number;
  /** 录音总长（秒，未裁） */
  duration: number;
  /** 波形峰值（0–1） */
  peaks: number[];
  /** ★ 选用 */
  selected: boolean;
}

export interface Take extends TakeMeta {
  /** 单声道 PCM，采样率 sampleRate */
  samples: Float32Array;
}

export interface AlignedRegion {
  /** 在歌曲时间线上从哪儿开始（秒） */
  position: number;
  /** 从录音的第几秒开始放 */
  sourceOffset: number;
  /** 放多长（秒） */
  length: number;
}

/**
 * take 在歌曲时间线上的位置：录到的第 i 个采样其实是在 songStart + i/sr − 延迟 那一刻唱的，
 * 所以整体往前挪 latencyMs；再按裁头裁尾截一段。挪到 0 之前的部分截掉。
 */
export function alignedRegion(take: Pick<TakeMeta, 'songStart' | 'latencyMs' | 'trimStart' | 'trimEnd' | 'duration'>): AlignedRegion | null {
  let position = take.songStart - take.latencyMs / 1000 + take.trimStart;
  let sourceOffset = take.trimStart;
  let length = take.duration - take.trimStart - take.trimEnd;
  if (position < 0) {
    sourceOffset -= position;
    length += position;
    position = 0;
  }
  if (!(length > 1e-6)) return null;
  return { position, sourceOffset, length };
}

/** 裁剪值收进合法范围：两头都 ≥ 0，留下至少 0.05 秒 */
export function clampTrim(duration: number, trimStart: number, trimEnd: number): { trimStart: number; trimEnd: number } {
  const min = Math.min(0.05, duration);
  const s = Math.max(0, Math.min(trimStart, duration - min));
  const e = Math.max(0, Math.min(trimEnd, duration - min - s));
  return { trimStart: round3(s), trimEnd: round3(e) };
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function nextTakeName(existing: { name: string }[]): string {
  let max = 0;
  for (const t of existing) {
    const m = /^Take (\d+)$/.exec(t.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Take ${max + 1}`;
}

let seq = 0;
export function newTakeId(now: number): string {
  seq += 1;
  return `t${now.toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export interface CaptureWindow {
  /** 开录那一刻（AudioContext 时间，秒）= 时钟 start 事件的 time */
  startTime: number;
  /** 那一刻对应的歌曲时间（秒）= 时钟 start 事件的 songTime */
  startSongTime: number;
  /** 停录那一刻（AudioContext 时间，秒） */
  stopTime: number;
}

/** 从收集到的分片里切出这一遍，做成 take（还没存） */
export function makeTake(
  collector: PcmCollector,
  win: CaptureWindow,
  meta: { id: string; projectId: string; name: string; createdAt: number; latencyMs: number },
): Take {
  const samples = collector.extract(win.startTime, win.stopTime);
  return {
    ...meta,
    sampleRate: collector.sampleRate,
    songStart: win.startSongTime,
    trimStart: 0,
    trimEnd: 0,
    duration: samples.length / collector.sampleRate,
    peaks: peaksOf(samples, 400),
    selected: false,
    samples,
  };
}
