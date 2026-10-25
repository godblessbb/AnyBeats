import { describe, expect, it } from 'vitest';
import type { AudioInputSource, InputContext, PcmChunk } from '../AudioInputSource';
import { ChunkInputSource } from '../ChunkInputSource';
import { mixDown, PcmCollector, resampleLinear, rmsDb } from '../pcm';
import { alignedRegion, clampTrim, makeTake, nextTakeName } from '../takes';

const SR = 48000;

function fakeCtx(now = 10): InputContext & { currentTime: number } {
  return { sampleRate: SR, currentTime: now };
}

/** 录音流程只认 AudioInputSource：任何实现都走同一段代码 */
async function recordWith(input: AudioInputSource, ctx: InputContext, feed: () => void): Promise<PcmCollector> {
  const col = new PcmCollector(ctx.sampleRate);
  await input.start(ctx, (c: PcmChunk) => col.push(c));
  feed();
  input.stop();
  return col;
}

describe('ChunkInputSource：外部推分片进来', () => {
  it('没接上时不可用，原因可显示；start 直接拒绝而不是挂着', async () => {
    const input = new ChunkInputSource();
    const a = input.availability();
    expect(a.ok).toBe(false);
    expect(a.ok ? '' : a.reason).toMatch(/外层/);
    await expect(input.start(fakeCtx(), () => {})).rejects.toThrow(/外层/);
  });

  it('connect 后可用并通知订阅者；disconnect 后停', async () => {
    const input = new ChunkInputSource();
    let n = 0;
    input.subscribe(() => n++);
    input.connect('外层麦克风');
    expect(input.availability().ok).toBe(true);
    const started = await input.start(fakeCtx(), () => {});
    expect(started.label).toBe('外层麦克风');
    input.disconnect('外层关了');
    expect(input.running).toBe(false);
    expect(n).toBe(2);
  });

  it('带时间戳的分片按时间拼起来，空档补 0', async () => {
    const input = new ChunkInputSource();
    input.connect();
    const ctx = fakeCtx();
    const col = await recordWith(input, ctx, () => {
      input.push({ channels: new Float32Array(480).fill(0.5), sampleRate: SR, time: 10 });
      input.push({ channels: new Float32Array(480).fill(-0.5), sampleRate: SR, time: 10.02 });
    });
    const pcm = col.extract(10, 10.03);
    expect(pcm.length).toBe(1440);
    expect(pcm[0]).toBe(0.5);
    expect(pcm[479]).toBe(0.5);
    expect(pcm[480]).toBe(0); // 10.01–10.02 没有分片
    expect(pcm[960]).toBe(-0.5);
  });

  it('不带时间戳：第一片按到达时刻倒推，之后首尾相接；44.1k 立体声重采样成 48k 单声道', async () => {
    const input = new ChunkInputSource();
    input.connect();
    const ctx = fakeCtx(5);
    const got: PcmChunk[] = [];
    await input.start(ctx, (c) => got.push(c));
    const l = new Float32Array(441).fill(0.2);
    const r = new Float32Array(441).fill(0.6);
    input.push({ channels: [l, r], sampleRate: 44100 });
    ctx.currentTime = 5.5; // 到达抖动不影响后面的时间戳
    input.push({ channels: [l, r], sampleRate: 44100 });
    expect(got).toHaveLength(2);
    expect(got[0].samples.length).toBe(480);
    expect(got[0].samples[100]).toBeCloseTo(0.4, 5);
    expect(got[0].time).toBeCloseTo(5 - 0.01, 9);
    expect(got[1].time).toBeCloseTo(5, 9);
  });

  it('没在录时推进来的分片丢掉', () => {
    const input = new ChunkInputSource();
    input.connect();
    expect(() => input.push({ channels: new Float32Array(10), sampleRate: SR })).not.toThrow();
  });

  it('用分片输入录一遍做成 take：歌曲时间、长度、校准偏移都对', async () => {
    const input = new ChunkInputSource();
    input.connect();
    const ctx = fakeCtx(0);
    const col = await recordWith(input, ctx, () => {
      for (let k = 0; k < 100; k++) input.push({ channels: new Float32Array(480).fill(0.1), sampleRate: SR, time: 1 + k * 0.01 });
    });
    const take = makeTake(col, { startTime: 1.2, startSongTime: 8, stopTime: 1.9 }, { id: 't', projectId: 'p', name: 'Take 1', createdAt: 0, latencyMs: 42 });
    expect(take.duration).toBeCloseTo(0.7, 6);
    expect(take.songStart).toBe(8);
    expect(take.samples.every((v) => v === Math.fround(0.1))).toBe(true);
    const r = alignedRegion(take)!;
    expect(r.position).toBeCloseTo(8 - 0.042, 9);
  });
});

describe('对齐：alignedRegion', () => {
  const base = { songStart: 4, latencyMs: 40, trimStart: 0, trimEnd: 0, duration: 10 };

  it('整体往前挪校准延迟', () => {
    expect(alignedRegion(base)).toEqual({ position: 3.96, sourceOffset: 0, length: 10 });
  });

  it('没校准（0 ms）就不挪', () => {
    expect(alignedRegion({ ...base, latencyMs: 0 })!.position).toBe(4);
  });

  it('裁头裁尾', () => {
    const r = alignedRegion({ ...base, trimStart: 0.5, trimEnd: 1.5 })!;
    expect(r.position).toBeCloseTo(4.46, 9);
    expect(r.sourceOffset).toBe(0.5);
    expect(r.length).toBe(8);
  });

  it('挪到 0 之前的部分截掉', () => {
    const r = alignedRegion({ ...base, songStart: 0.01 })!;
    expect(r.position).toBe(0);
    expect(r.sourceOffset).toBeCloseTo(0.03, 9);
    expect(r.length).toBeCloseTo(9.97, 9);
  });

  it('全裁光了返回 null', () => {
    expect(alignedRegion({ ...base, trimStart: 5, trimEnd: 5 })).toBeNull();
  });

  it('裁剪收进合法范围', () => {
    expect(clampTrim(2, -1, 0.5)).toEqual({ trimStart: 0, trimEnd: 0.5 });
    expect(clampTrim(2, 3, 3)).toEqual({ trimStart: 1.95, trimEnd: 0 });
  });

  it('take 名字往上数', () => {
    expect(nextTakeName([])).toBe('Take 1');
    expect(nextTakeName([{ name: 'Take 1' }, { name: 'Take 3' }])).toBe('Take 4');
  });
});

describe('pcm 小工具', () => {
  it('混单声道、重采样、电平', () => {
    expect([...mixDown([new Float32Array([1, 0]), new Float32Array([0, 1])])]).toEqual([0.5, 0.5]);
    expect(resampleLinear(new Float32Array(100), 48000, 24000).length).toBe(50);
    expect(rmsDb(new Float32Array(10).fill(1))).toBeCloseTo(0, 6);
    expect(rmsDb(new Float32Array(10))).toBe(-Infinity);
  });
});
