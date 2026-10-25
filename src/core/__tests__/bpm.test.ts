import { describe, expect, it } from 'vitest';
import { estimateBpm, mixToMono, onsetEnvelope } from '../bpm';
import { BACKBEAT, BACKBEAT_WITH_BASS, BOOMBAP_16THS, mulberry32, renderDrums, swingBeat, type Hit } from './fixtures/drums';

interface Case {
  name: string;
  bpm: number;
  bar: Hit[];
  sampleRate?: number;
}

/**
 * 夹具都在内存合成（fixtures/drums.ts），每个都加了 ±4ms 时值抖动、±15% 力度、底噪，并跑 3 个随机种子。
 * 难点：
 * - 90 + 持续低音：整小节 55Hz 正弦，电平一直高于旧算法的 0.3 阈值。
 * - 70 boom-bap：十六分音符踩镲 + 反拍底鼓，140、280 方向都有强周期（半频/倍频陷阱）。
 * - 140：与 70 同属 backbeat，但每拍都有底鼓/军鼓，必须报 140 而不是 70。
 * - 95 swing：反拍落在 2/3 拍，三连音方向（142.5）有假峰。
 */
const CASES: Case[] = [
  { name: '90 BPM 鼓点 + 持续低音', bpm: 90, bar: BACKBEAT_WITH_BASS },
  { name: '120 BPM 干净鼓点', bpm: 120, bar: BACKBEAT },
  { name: '120 BPM 干净鼓点 @44.1kHz', bpm: 120, bar: BACKBEAT, sampleRate: 44100 },
  { name: '70 BPM boom-bap 十六分踩镲', bpm: 70, bar: BOOMBAP_16THS },
  { name: '140 BPM backbeat', bpm: 140, bar: BACKBEAT },
  { name: '95 BPM swing', bpm: 95, bar: swingBeat() },
  { name: '62 BPM 鼓点 + 持续低音（下限附近）', bpm: 62, bar: BACKBEAT_WITH_BASS },
  { name: '85 BPM boom-bap', bpm: 85, bar: BOOMBAP_16THS },
  { name: '160 BPM backbeat', bpm: 160, bar: BACKBEAT },
];

describe('estimateBpm', () => {
  for (const c of CASES) {
    for (const seed of [1, 2, 3]) {
      it(`${c.name}（种子 ${seed}）：误差 ≤ 1 BPM，不报成倍频/半频`, () => {
        const { samples, sampleRate } = renderDrums({
          bpm: c.bpm,
          seconds: 20,
          bar: c.bar,
          sampleRate: c.sampleRate,
          jitter: 0.004,
          humanize: 0.15,
          noise: 0.01,
          seed,
        });
        const r = estimateBpm(samples, sampleRate);
        expect(Math.abs(r.bpm - c.bpm)).toBeLessThanOrEqual(1);
        expect(r.confidence).toBeGreaterThan(0.6);
        expect(r.candidates[0]).toMatchObject({ relation: 'best', score: 1 });
      });
    }
  }

  it('候选里给出倍频/半频及其打分，便于界面让用户一键改成 ×2 / ÷2', () => {
    const { samples, sampleRate } = renderDrums({ bpm: 70, seconds: 20, bar: BOOMBAP_16THS, seed: 4 });
    const r = estimateBpm(samples, sampleRate);
    const double = r.candidates.find((c) => c.relation === 'double');
    const half = r.candidates.find((c) => c.relation === 'half');
    expect(double?.bpm).toBeCloseTo(140, 0);
    expect(half?.bpm).toBeCloseTo(35, 0);
    // 倍频判断：70 的反拍（半拍处）起音能量明显弱于拍点 → 没换到 140
    expect(r.octaveChecks[0]).toMatchObject({ accepted: false });
    expect(r.octaveChecks[0].ratio).toBeLessThan(0.6);
  });

  it('纯噪声置信度接近 0；太短的音频返回 NaN', () => {
    const rand = mulberry32(5);
    const noise = new Float32Array(22050 * 10).map(() => rand() * 2 - 1);
    expect(estimateBpm(noise, 22050).confidence).toBeLessThan(0.2);
    expect(estimateBpm(new Float32Array(22050 / 2), 22050).bpm).toBeNaN();
    expect(estimateBpm(new Float32Array(22050 * 5), 22050)).toMatchObject({ confidence: 0 });
  });

  it('起音包络：持续低音只在起音处有通量', () => {
    const sr = 22050;
    const x = new Float32Array(sr * 2);
    for (let i = sr / 2; i < x.length; i++) x[i] = 0.6 * Math.sin((2 * Math.PI * 55 * i) / sr);
    const env = onsetEnvelope(x, sr);
    const onsetFrame = Math.round((0.5 * sr) / (sr / env.rate));
    const peak = env.values.indexOf(Math.max(...env.values));
    expect(Math.abs(peak - onsetFrame)).toBeLessThanOrEqual(5);
    const late = env.values.slice(onsetFrame + 60);
    expect(Math.max(...late)).toBeLessThan(env.values[peak] * 0.1);
  });

  it('mixToMono 取各声道平均', () => {
    expect(Array.from(mixToMono([new Float32Array([1, 0.5]), new Float32Array([0, 0.5])]))).toEqual([0.5, 0.5]);
  });
});
