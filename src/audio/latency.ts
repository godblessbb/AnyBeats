/**
 * 延迟校准算法（纯函数，不碰 Web Audio）：放一串已知的短扫频脉冲，同时录回来，
 * 对每个脉冲在 0–maxLatency 范围里做归一化互相关，峰值位置就是这一次的往返延迟；取中位数。
 *
 * 往返延迟 = 输出延迟 + 空气 / 耳机漏音 + 输入延迟，正好是「跟着伴奏唱、录下来比伴奏晚多少」，
 * 录音时把 take 往前挪这么多就对齐了。
 */

export const BLUETOOTH_MS = 120;

export interface CalibrationPlan {
  /** 第一个脉冲距离录音起点的时间（秒） */
  lead: number;
  /** 脉冲间隔（秒） */
  interval: number;
  count: number;
  /** 脉冲长度（秒） */
  pulseSeconds: number;
}

export const DEFAULT_PLAN: CalibrationPlan = { lead: 0.25, interval: 0.6, count: 8, pulseSeconds: 0.012 };

/** 汉宁窗包着的线性扫频（1.2k → 7k Hz），自相关峰窄，适合定位 */
export function makePulse(sampleRate: number, seconds = DEFAULT_PLAN.pulseSeconds): Float32Array {
  const n = Math.max(16, Math.round(seconds * sampleRate));
  const out = new Float32Array(n);
  const f0 = 1200;
  const f1 = Math.min(7000, sampleRate * 0.4);
  const T = n / sampleRate;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const phase = 2 * Math.PI * (f0 * t + ((f1 - f0) / (2 * T)) * t * t);
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    out[i] = Math.sin(phase) * w;
  }
  return out;
}

/** 每个脉冲在播放信号里的起点（采样） */
export function pulseStarts(plan: CalibrationPlan, sampleRate: number): number[] {
  return Array.from({ length: plan.count }, (_, k) => Math.round((plan.lead + k * plan.interval) * sampleRate));
}

/** 整串校准信号（要播放的东西），长度覆盖最后一个脉冲之后再留 tail 秒 */
export function makeCalibrationSignal(sampleRate: number, plan: CalibrationPlan = DEFAULT_PLAN, tail = 0.6): Float32Array {
  const pulse = makePulse(sampleRate, plan.pulseSeconds);
  const starts = pulseStarts(plan, sampleRate);
  const len = starts[starts.length - 1] + pulse.length + Math.round(tail * sampleRate);
  const out = new Float32Array(len);
  for (const s of starts) out.set(pulse, s);
  return out;
}

export interface PulseHit {
  /** 这个脉冲测到的延迟（毫秒），没听清时 null */
  ms: number | null;
  /** 归一化互相关峰值 0–1 */
  score: number;
}

export interface LatencyEstimate {
  ok: boolean;
  /** 中位数（毫秒），ok 为 false 时 null */
  latencyMs: number | null;
  hits: PulseHit[];
  /** 用上的脉冲个数 */
  used: number;
  /** 失败原因（给人看） */
  reason: string | null;
}

export interface EstimateOptions {
  plan?: CalibrationPlan;
  maxLatencyMs?: number;
  /** 归一化互相关低于这个就当没听到 */
  minScore?: number;
  /** 至少要有几个脉冲听清 */
  minHits?: number;
  /** 离中位数超过这么多毫秒的结果丢掉 */
  tolerance?: number;
}

/** 单个脉冲：在 recorded[start .. start + maxLag] 里找和 pulse 最像的位置 */
export function locatePulse(recorded: Float32Array, pulse: Float32Array, start: number, maxLag: number): { lag: number; score: number } {
  const m = pulse.length;
  let ep = 0;
  for (let j = 0; j < m; j++) ep += pulse[j] * pulse[j];
  const end = Math.min(maxLag, recorded.length - start - m);
  if (end < 0 || ep === 0) return { lag: 0, score: 0 };
  // 滑动窗口能量
  let ew = 0;
  for (let j = 0; j < m; j++) {
    const v = recorded[start + j];
    ew += v * v;
  }
  let best = 0;
  let bestLag = 0;
  for (let lag = 0; lag <= end; lag++) {
    const base = start + lag;
    if (lag > 0) {
      const out = recorded[base - 1];
      const inn = recorded[base + m - 1];
      ew += inn * inn - out * out;
    }
    if (ew <= 1e-12) continue;
    let dot = 0;
    for (let j = 0; j < m; j++) dot += pulse[j] * recorded[base + j];
    const score = Math.abs(dot) / Math.sqrt(ep * ew);
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  return { lag: bestLag, score: best };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * recorded 的第 0 个采样 = 校准信号开始播放的那一刻（同一个 AudioContext 时间）。
 * 只看前 hitsSoFar 个脉冲时可以用来显示进度（「5 / 8 次」）。
 */
export function estimateLatency(recorded: Float32Array, sampleRate: number, options: EstimateOptions = {}, hitsSoFar?: number): LatencyEstimate {
  const plan = options.plan ?? DEFAULT_PLAN;
  const maxLag = Math.round(((options.maxLatencyMs ?? 450) / 1000) * sampleRate);
  const minScore = options.minScore ?? 0.35;
  const minHits = options.minHits ?? Math.ceil(plan.count / 2);
  const tolerance = options.tolerance ?? 6;
  const pulse = makePulse(sampleRate, plan.pulseSeconds);
  const starts = pulseStarts(plan, sampleRate).slice(0, hitsSoFar ?? plan.count);
  const hits: PulseHit[] = starts.map((s) => {
    const { lag, score } = locatePulse(recorded, pulse, s, maxLag);
    return { ms: score >= minScore ? (lag / sampleRate) * 1000 : null, score };
  });
  const heard = hits.filter((h) => h.ms !== null).map((h) => h.ms as number);
  if (heard.length === 0) return { ok: false, latencyMs: null, hits, used: 0, reason: '没听到「嘀」声：麦克风离耳机 / 音箱太远，或者音量太小' };
  const mid = median(heard);
  const kept = heard.filter((ms) => Math.abs(ms - mid) <= tolerance);
  const need = hitsSoFar === undefined ? minHits : 1;
  if (kept.length < need) {
    return { ok: false, latencyMs: null, hits, used: kept.length, reason: `只听清 ${kept.length} 次（至少要 ${need} 次），环境太吵或音量太小，再试一次` };
  }
  return { ok: true, latencyMs: Math.round(median(kept) * 10) / 10, hits, used: kept.length, reason: null };
}

export const isLikelyBluetooth = (ms: number | null | undefined, deviceLabel = ''): boolean =>
  (ms ?? 0) > BLUETOOTH_MS || /bluetooth|airpods|buds|蓝牙|hands-?free|headset \(bt\)/i.test(deviceLabel);
