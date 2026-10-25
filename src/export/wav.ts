/**
 * WAV 编码（纯函数）：24 bit 整数 PCM 或 32 bit 浮点，采样率由调用方给（跟随 AudioContext）。
 */

export type WavFormat = 'pcm24' | 'float32';

export function encodeWav(channels: readonly Float32Array[], sampleRate: number, format: WavFormat = 'pcm24'): Uint8Array {
  const nch = Math.max(1, channels.length);
  const frames = channels.length ? Math.min(...channels.map((c) => c.length)) : 0;
  const bytes = format === 'pcm24' ? 3 : 4;
  const float = format === 'float32';
  const blockAlign = nch * bytes;
  const dataSize = frames * blockAlign;
  const fmtSize = float ? 18 : 16;
  const factSize = float ? 12 : 0;
  const total = 12 + 8 + fmtSize + factSize + 8 + dataSize + (dataSize % 2);
  const buf = new ArrayBuffer(total);
  const v = new DataView(buf);
  let p = 0;
  const str = (s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(p++, s.charCodeAt(i));
  };
  const u32 = (x: number) => {
    v.setUint32(p, x, true);
    p += 4;
  };
  const u16 = (x: number) => {
    v.setUint16(p, x, true);
    p += 2;
  };
  str('RIFF');
  u32(total - 8);
  str('WAVE');
  str('fmt ');
  u32(fmtSize);
  u16(float ? 3 : 1);
  u16(nch);
  u32(sampleRate);
  u32(sampleRate * blockAlign);
  u16(blockAlign);
  u16(bytes * 8);
  if (float) {
    u16(0);
    str('fact');
    u32(4);
    u32(frames);
  }
  str('data');
  u32(dataSize);
  const src = channels.length ? channels : [new Float32Array(0)];
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const x = src[c][i];
      if (float) {
        v.setFloat32(p, x, true);
        p += 4;
      } else {
        const s = Math.max(-1, Math.min(1, x || 0));
        let n = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
        if (n < 0) n += 0x1000000;
        v.setUint8(p, n & 0xff);
        v.setUint8(p + 1, (n >> 8) & 0xff);
        v.setUint8(p + 2, (n >> 16) & 0xff);
        p += 3;
      }
    }
  }
  return new Uint8Array(buf);
}

/** 读回 WAV 头（测试和自检用） */
export function readWavHeader(bytes: Uint8Array): { format: number; channels: number; sampleRate: number; bits: number; frames: number; dataOffset: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('不是 WAV');
  let p = 12;
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  while (p + 8 <= bytes.length) {
    const id = tag(p);
    const size = v.getUint32(p + 4, true);
    if (id === 'fmt ') {
      format = v.getUint16(p + 8, true);
      channels = v.getUint16(p + 10, true);
      sampleRate = v.getUint32(p + 12, true);
      bits = v.getUint16(p + 22, true);
    } else if (id === 'data') {
      return { format, channels, sampleRate, bits, frames: size / (channels * (bits / 8)), dataOffset: p + 8 };
    }
    p += 8 + size + (size % 2);
  }
  throw new Error('WAV 里没有 data 块');
}
