/**
 * 测试用鼓点合成器：全部在内存里按种子生成，确定性，不放音频文件。
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Voice = 'kick' | 'snare' | 'hat' | 'bass';

export interface Hit {
  /** 第几拍（小数），从 0 起 */
  beat: number;
  voice: Voice;
  gain?: number;
  /** 持续时长（拍），只对 bass 有效 */
  beats?: number;
}

export interface RenderOptions {
  bpm: number;
  seconds: number;
  sampleRate?: number;
  /** 一个小节（4 拍）的鼓型，会循环铺满 */
  bar: Hit[];
  /** 时值抖动（秒，均匀分布 ±），模拟人手 */
  jitter?: number;
  /** 力度随机 ±比例 */
  humanize?: number;
  /** 底噪幅度 */
  noise?: number;
  seed?: number;
}

export function renderDrums(opts: RenderOptions): { samples: Float32Array; sampleRate: number } {
  const sr = opts.sampleRate ?? 22050;
  const n = Math.floor(opts.seconds * sr);
  const out = new Float32Array(n);
  const rand = mulberry32(opts.seed ?? 1);
  const beatSec = 60 / opts.bpm;
  const bars = Math.ceil(opts.seconds / (beatSec * 4)) + 1;

  for (let bar = 0; bar < bars; bar++) {
    for (const hit of opts.bar) {
      const jitter = opts.jitter ? (rand() * 2 - 1) * opts.jitter : 0;
      const t0 = (bar * 4 + hit.beat) * beatSec + jitter;
      if (t0 < 0 || t0 >= opts.seconds) continue;
      const gain = (hit.gain ?? 1) * (1 + (opts.humanize ? (rand() * 2 - 1) * opts.humanize : 0));
      addVoice(out, sr, Math.round(t0 * sr), hit, gain, beatSec, rand);
    }
  }
  if (opts.noise) for (let i = 0; i < n; i++) out[i] += (rand() * 2 - 1) * opts.noise;
  return { samples: out, sampleRate: sr };
}

function addVoice(out: Float32Array, sr: number, start: number, hit: Hit, gain: number, beatSec: number, rand: () => number) {
  const add = (i: number, v: number) => {
    if (i >= 0 && i < out.length) out[i] += v * gain;
  };
  switch (hit.voice) {
    case 'kick': {
      const len = Math.floor(0.25 * sr);
      let phase = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const f = 50 + 90 * Math.exp(-t * 30);
        phase += (2 * Math.PI * f) / sr;
        add(start + i, 0.9 * Math.sin(phase) * Math.exp(-t * 14));
      }
      break;
    }
    case 'snare': {
      const len = Math.floor(0.2 * sr);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const tone = Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 30);
        add(start + i, 0.55 * ((rand() * 2 - 1) * Math.exp(-t * 22) + 0.5 * tone));
      }
      break;
    }
    case 'hat': {
      const len = Math.floor(0.05 * sr);
      let prev = 0;
      for (let i = 0; i < len; i++) {
        const w = rand() * 2 - 1;
        add(start + i, 0.3 * (w - prev) * Math.exp((-i / sr) * 90));
        prev = w;
      }
      break;
    }
    case 'bass': {
      // 持续低音：55Hz 正弦，10ms 起音后一直保持高电平
      const len = Math.floor((hit.beats ?? 4) * beatSec * sr);
      const attack = Math.floor(0.01 * sr);
      for (let i = 0; i < len; i++) {
        const env = Math.min(1, i / attack) * (i > len - attack ? (len - i) / attack : 1);
        add(start + i, 0.6 * env * Math.sin((2 * Math.PI * 55 * i) / sr));
      }
      break;
    }
  }
}

const K = (beat: number, gain?: number): Hit => ({ beat, voice: 'kick', gain });
const S = (beat: number, gain?: number): Hit => ({ beat, voice: 'snare', gain });
const H = (beat: number, gain?: number): Hit => ({ beat, voice: 'hat', gain });

/** 基本 backbeat：1、3 拍底鼓，2、4 拍军鼓，八分音符踩镲 */
export const BACKBEAT: Hit[] = [K(0), S(1), K(2), S(3), ...[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((b) => H(b, b % 1 ? 0.6 : 1))];

/** 90 BPM 鼓点 + 整小节持续低音（808 式），旧算法在这里出错 */
export const BACKBEAT_WITH_BASS: Hit[] = [...BACKBEAT, { beat: 0, voice: 'bass', beats: 4 }];

/** boom-bap：反拍底鼓 + 十六分音符踩镲（倍频陷阱：140/280 方向都有很强的周期） */
export const BOOMBAP_16THS: Hit[] = [
  K(0),
  K(1.75, 0.7),
  S(1),
  K(2.5, 0.8),
  S(3),
  ...Array.from({ length: 16 }, (_, i) => H(i / 4, i % 4 === 0 ? 1 : i % 2 === 0 ? 0.7 : 0.45)),
];

/** swing 八分：反拍踩镲落在 2/3 拍处 */
export function swingBeat(ratio = 2 / 3): Hit[] {
  const hats = [0, 1, 2, 3].flatMap((b) => [H(b), H(b + ratio, 0.7)]);
  return [K(0), S(1), K(2), K(2 + ratio, 0.6), S(3), ...hats];
}
