import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN, estimateLatency, isLikelyBluetooth, makeCalibrationSignal } from '../latency';

/** 确定性的伪随机（mulberry32），噪声每次都一样 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 合成「录回来的声音」：延迟 + 衰减 + 一次房间反射 + 低频嗡声 + 白噪声 */
function synthRecording(sr: number, delayMs: number, seed: number, noise = 0.05): Float32Array {
  const played = makeCalibrationSignal(sr);
  const out = new Float32Array(played.length + Math.round(0.5 * sr));
  const d = Math.round((delayMs / 1000) * sr);
  const echo = Math.round(0.009 * sr);
  for (let i = 0; i < played.length; i++) {
    if (i + d < out.length) out[i + d] += 0.3 * played[i];
    if (i + d + echo < out.length) out[i + d + echo] += 0.12 * played[i];
  }
  const r = rng(seed);
  for (let i = 0; i < out.length; i++) {
    // 近似高斯：4 个均匀分布相加
    const g = (r() + r() + r() + r() - 2) * 0.866;
    out[i] += noise * g + 0.02 * Math.sin((2 * Math.PI * 50 * i) / sr);
  }
  return out;
}

describe('延迟校准：互相关定位脉冲', () => {
  for (const sr of [48000, 44100]) {
    for (const delay of [0, 40, 180]) {
      it(`${sr} Hz，真实延迟 ${delay} ms（含噪声、反射）→ 误差 ≤ 2 ms`, () => {
        const rec = synthRecording(sr, delay, delay + sr);
        const est = estimateLatency(rec, sr);
        expect(est.ok).toBe(true);
        expect(est.used).toBeGreaterThanOrEqual(DEFAULT_PLAN.count - 1);
        expect(Math.abs((est.latencyMs as number) - delay)).toBeLessThanOrEqual(2);
      });
    }
  }

  it('非整数毫秒的延迟（73.4 ms）也在 2 ms 内', () => {
    const est = estimateLatency(synthRecording(48000, 73.4, 7), 48000);
    expect(Math.abs((est.latencyMs as number) - 73.4)).toBeLessThanOrEqual(2);
  });

  it('噪声更大（脉冲只比噪声高一点）仍然对得上', () => {
    const est = estimateLatency(synthRecording(48000, 40, 11, 0.15), 48000);
    expect(est.ok).toBe(true);
    expect(Math.abs((est.latencyMs as number) - 40)).toBeLessThanOrEqual(2);
  });

  it('只有噪声、没有脉冲 → 判失败并给出原因，不瞎报一个数', () => {
    const sr = 48000;
    const r = rng(3);
    const rec = new Float32Array(sr * 6).map(() => (r() - 0.5) * 0.1);
    const est = estimateLatency(rec, sr);
    expect(est.ok).toBe(false);
    expect(est.latencyMs).toBeNull();
    expect(est.reason).toBeTruthy();
  });

  it('全静音 → 判失败', () => {
    const est = estimateLatency(new Float32Array(48000 * 6), 48000);
    expect(est.ok).toBe(false);
    expect(est.reason).toMatch(/没听到/);
  });

  it('进度：只看前 5 个脉冲也能给出当前平均', () => {
    const est = estimateLatency(synthRecording(48000, 46, 5), 48000, {}, 5);
    expect(est.hits).toHaveLength(5);
    expect(Math.abs((est.latencyMs as number) - 46)).toBeLessThanOrEqual(2);
  });

  it('超过 120 ms 提示多半是蓝牙；设备名带 AirPods 也提示', () => {
    expect(isLikelyBluetooth(180)).toBe(true);
    expect(isLikelyBluetooth(42)).toBe(false);
    expect(isLikelyBluetooth(30, 'AirPods Pro')).toBe(true);
    expect(isLikelyBluetooth(null)).toBe(false);
  });
});
