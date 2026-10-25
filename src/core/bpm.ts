/**
 * 从 PCM 估 BPM。
 *
 * 1. 起音强度包络：~23ms 汉宁窗短时傅里叶，对数压缩幅度谱，逐帧正向谱通量
 *    （持续的低音只在起音那一帧有通量，后面不再"顶"包络——旧算法正是被它带偏）。
 * 2. 去掉 0.5s 滑动均值后做自相关。
 * 3. 梳状打分：S(bpm) = 自相关在 1..K 倍拍长处的均值，候选 BPM 按 0.05 步进扫描。
 * 4. 在最高分附近用尽量多的倍数精修到 0.01 BPM。
 * 5. 倍频/半频：真实拍速 T 的整数分之一（T/2、T/3）梳状打分和 T 一样高，所以范围内的最高分
 *    可能落在慢一倍的档上。按拍子网格对齐相位，看两拍正中间的起音能量是否和拍点上一样强：
 *    一样强说明真拍子更快，换上去；明显更弱说明那只是反拍细分，不换（offbeatRatio）。
 */

export interface BpmCandidate {
  bpm: number;
  /** 相对最佳候选的梳状打分，0–1 */
  score: number;
  /** 与最佳候选的关系 */
  relation: 'best' | 'double' | 'half' | 'triple-half' | 'two-thirds';
}

export interface BpmResult {
  bpm: number;
  /** 0–1；越接近 1 周期性越明确，纯噪声接近 0 */
  confidence: number;
  candidates: BpmCandidate[];
  /** 倍频判断的依据：每次考虑"快一倍"时奇数齿/偶数齿的比值，便于排查 */
  octaveChecks: { from: number; to: number; ratio: number; accepted: boolean }[];
}

export interface BpmOptions {
  minBpm?: number;
  maxBpm?: number;
  /** 反拍能量 / 拍点能量 ≥ 这个比值才换到快一倍，默认 0.65（见 offbeatRatio） */
  doubleRatio?: number;
}

export interface OnsetEnvelope {
  values: Float64Array;
  /** 每秒多少帧 */
  rate: number;
}

export function mixToMono(channels: ArrayLike<number>[]): Float32Array {
  const n = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length;
  return out;
}

// ---------- FFT ----------

function fftInPlace(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

// ---------- 起音包络 ----------

export interface EnvelopeOptions {
  /** 对数压缩 log(1 + c·|X|) 的 c，越大越把轻重音拉平 */
  compression?: number;
  /** 低于这个频率的通量全额计入，高于的乘 highWeight。默认 0：拍子由底鼓/军鼓/低音的起音决定，
   *  踩镲是细分，算进来会把 70 的十六分踩镲听成 140（合成夹具上实测，见测试） */
  splitHz?: number;
  highWeight?: number;
}

export const DEFAULT_ENVELOPE: Required<EnvelopeOptions> = { compression: 10, splitHz: 1000, highWeight: 0 };

export function onsetEnvelope(
  samples: ArrayLike<number>,
  sampleRate: number,
  options: EnvelopeOptions = {},
): OnsetEnvelope {
  const { compression, splitHz, highWeight } = { ...DEFAULT_ENVELOPE, ...options };
  const size = 2 ** Math.round(Math.log2(sampleRate * 0.023));
  const hop = size / 4;
  const bins = size / 2;
  const hann = new Float64Array(size);
  for (let i = 0; i < size; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);

  const frames = Math.max(0, Math.floor((samples.length - size) / hop) + 1);
  const flux = new Float64Array(frames);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let prev = new Float64Array(bins);
  let cur = new Float64Array(bins);
  const splitBin = Math.round((splitHz * size) / sampleRate);
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < size; i++) {
      re[i] = samples[off + i] * hann[i];
      im[i] = 0;
    }
    fftInPlace(re, im);
    let sum = 0;
    for (let k = 1; k < bins; k++) {
      cur[k] = Math.log1p(compression * Math.hypot(re[k], im[k]));
      const d = cur[k] - prev[k];
      if (f > 0 && d > 0) sum += k < splitBin ? d : d * highWeight;
    }
    flux[f] = sum;
    [prev, cur] = [cur, prev];
  }

  const rate = sampleRate / hop;
  // 减去 0.5s 滑动均值并半波整流，只留"比周围更突然"的起音
  const half = Math.max(1, Math.round(rate * 0.25));
  const prefix = new Float64Array(frames + 1);
  for (let i = 0; i < frames; i++) prefix[i + 1] = prefix[i] + flux[i];
  const values = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(frames, i + half + 1);
    values[i] = Math.max(0, flux[i] - (prefix[b] - prefix[a]) / (b - a));
  }
  return { values, rate };
}

function autocorrelation(x: Float64Array, maxLag: number): Float64Array {
  const n = x.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n || 1;
  const y = x.map((v) => v - mean);
  const r = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += y[i] * y[i + lag];
    r[lag] = s / (n - lag);
  }
  return r;
}

// ---------- 打分 ----------

class Scorer {
  private readonly r: Float64Array;
  private readonly rate: number;

  constructor(r: Float64Array, rate: number) {
    this.r = r;
    this.rate = rate;
  }

  period(bpm: number): number {
    return (60 * this.rate) / bpm;
  }

  /** 线性插值取自相关，并在 ±1 帧内取最大（包络量化误差容忍） */
  at(lag: number): number {
    const r = this.r;
    if (lag + 1 >= r.length) return Number.NaN;
    const i = Math.floor(lag);
    const t = lag - i;
    const v = r[i] * (1 - t) + r[i + 1] * t;
    return Math.max(v, r[i], r[i + 1]);
  }

  /** 第 ks 号齿的平均值 */
  teeth(bpm: number, ks: number[]): number {
    const p = this.period(bpm);
    let sum = 0;
    let n = 0;
    for (const k of ks) {
      const v = this.at(k * p);
      if (Number.isNaN(v)) break;
      sum += v;
      n++;
    }
    return n ? sum / n : Number.NaN;
  }

  /** 能用上的最多齿数（受包络长度限制） */
  maxTeeth(bpm: number, cap: number): number {
    return Math.max(1, Math.min(cap, Math.floor((this.r.length - 2) / this.period(bpm))));
  }

  comb(bpm: number, k: number): number {
    return this.teeth(bpm, range(1, Math.min(k, this.maxTeeth(bpm, k))));
  }

  /** 在 bpm 附近 ±spread 内细扫，返回打分最高的位置 */
  refine(bpm: number, spread: number, step: number, k: number): number {
    let best = bpm;
    let bestScore = -Infinity;
    for (let b = bpm * (1 - spread); b <= bpm * (1 + spread); b += step) {
      const s = this.comb(b, this.maxTeeth(b, k));
      if (s > bestScore) {
        bestScore = s;
        best = b;
      }
    }
    return best;
  }
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

const COMB_TEETH = 4;

/**
 * 以 bpm 为拍长、取起音能量最大的相位，返回「反拍（半拍处）平均能量 / 拍点平均能量」。
 * 每个点在 ±3% 拍长内取最大值，容忍人手抖动。
 */
export function offbeatRatio(env: OnsetEnvelope, bpm: number): number {
  const v = env.values;
  const period = (60 * env.rate) / bpm;
  const tol = Math.max(1, Math.round(period * 0.03));
  const peakNear = (center: number) => {
    let m = 0;
    const c = Math.round(center);
    for (let i = Math.max(0, c - tol); i <= Math.min(v.length - 1, c + tol); i++) m = Math.max(m, v[i]);
    return m;
  };
  const gridMean = (phase: number) => {
    let sum = 0;
    let n = 0;
    for (let t = phase; t < v.length; t += period, n++) sum += peakNear(t);
    return n ? sum / n : 0;
  };
  let bestPhase = 0;
  let onBeat = -1;
  for (let phase = 0; phase < period; phase += 1) {
    const e = gridMean(phase);
    if (e > onBeat) {
      onBeat = e;
      bestPhase = phase;
    }
  }
  if (!(onBeat > 0)) return 0;
  return gridMean(bestPhase + period / 2) / onBeat;
}

export function estimateBpmFromEnvelope(env: OnsetEnvelope, options: BpmOptions = {}): BpmResult {
  const minBpm = options.minBpm ?? 60;
  const maxBpm = options.maxBpm ?? 180;
  const doubleRatio = options.doubleRatio ?? 0.65;

  const maxLag = Math.min(env.values.length - 2, Math.ceil(((60 * env.rate) / (minBpm / 2)) * COMB_TEETH * 2));
  if (maxLag < (60 * env.rate) / minBpm) {
    return { bpm: Number.NaN, confidence: 0, candidates: [], octaveChecks: [] };
  }
  const r = autocorrelation(env.values, maxLag);
  // 没有起音（静音、纯持续音）：没有拍子可言
  if (!(r[0] > 1e-8)) return { bpm: Number.NaN, confidence: 0, candidates: [], octaveChecks: [] };
  const scorer = new Scorer(r, env.rate);

  // 范围内粗扫
  const grid: { bpm: number; s: number }[] = [];
  for (let b = minBpm; b <= maxBpm; b += 0.05) grid.push({ bpm: b, s: scorer.comb(b, COMB_TEETH) });
  let top = grid[0];
  for (const g of grid) if (g.s > top.s) top = g;
  // 用尽量多的齿精修，后面的相位对齐要求拍长足够准
  let best = scorer.refine(top.bpm, 0.01, 0.01, 64);

  // 倍频：按拍子网格对齐相位，比较「两拍正中间」和「拍点上」的起音能量。
  // 中间和拍点一样强 → 真拍子快一倍（比如 140 的军鼓落在 70 的反拍上）；明显弱 → 只是反拍细分，不换。
  const octaveChecks: BpmResult['octaveChecks'] = [];
  for (;;) {
    const up = scorer.refine(best * 2, 0.005, 0.01, 64);
    if (up > maxBpm * 1.01) break;
    const ratio = offbeatRatio(env, best);
    const accepted = ratio >= doubleRatio;
    octaveChecks.push({ from: round2(best), to: round2(up), ratio: round2(ratio), accepted });
    if (!accepted) break;
    best = up;
  }

  const bestScore = scorer.comb(best, COMB_TEETH);
  // 置信度：最佳打分比整个范围的平均打分突出多少（纯噪声各处差不多 → 接近 0）
  const mean = grid.reduce((a, g) => a + g.s, 0) / grid.length;
  const confidence = bestScore > 0 ? clamp01((bestScore - mean) / bestScore) : 0;

  const related: [number, BpmCandidate['relation']][] = [
    [best, 'best'],
    [best * 2, 'double'],
    [best / 2, 'half'],
    [best * 1.5, 'triple-half'],
    [(best * 2) / 3, 'two-thirds'],
  ];
  const candidates = related
    .filter(([b]) => b >= minBpm / 2 && b <= maxBpm * 2)
    .map(([b, relation]) => {
      const refined = relation === 'best' ? b : scorer.refine(b, 0.01, 0.02, COMB_TEETH);
      return {
        bpm: round2(refined),
        score: bestScore > 0 ? clamp01(scorer.comb(refined, COMB_TEETH) / bestScore) : 0,
        relation,
      };
    })
    .sort((a, b) => (a.relation === 'best' ? -1 : b.relation === 'best' ? 1 : b.score - a.score));

  return { bpm: round2(best), confidence, candidates, octaveChecks };
}

export function estimateBpm(
  samples: ArrayLike<number>,
  sampleRate: number,
  options: BpmOptions & { envelope?: EnvelopeOptions } = {},
): BpmResult {
  return estimateBpmFromEnvelope(onsetEnvelope(samples, sampleRate, options.envelope), options);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round2 = (v: number) => Math.round(v * 100) / 100;
