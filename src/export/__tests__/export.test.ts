import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createBar, createProject, createSection, createWord, guideEvents, TICKS_PER_BEAT, timeOfTick, type Project } from '../../core';
import type { Take } from '../../audio/takes';
import { renderGuide, renderMetronome } from '../clicks';
import { buildReaperZip, projectSeconds, safeName } from '../reaperZip';
import { buildRpp, lyricRegions, num, projectRpp, quote, sectionMarkers, takeItem } from '../rpp';
import { encodeWav, readWavHeader } from '../wav';

const SR = 48000;

/** 第 1 小节「凌晨——」（「晨」拖到第 2 拍末）、第 2 小节空、Hook 第 1 小节第 2 拍「夜车」 */
function project(): Project {
  const verse = createSection('verse', 0, 'Verse 1');
  verse.bars = [createBar([createWord({ tick: 0, len: 12, text: '凌' }), createWord({ tick: 12, len: 84, text: '晨' })]), createBar()];
  const hook = createSection('hook', 0, 'Hook');
  hook.bars = [createBar([createWord({ tick: 48, len: 12, text: '夜' }), createWord({ tick: 60, len: 12, text: '车' })])];
  return createProject({ name: '夜车', bpm: 90, offsetMs: 120, grid: { sections: [verse, hook] } });
}

function take(over: Partial<Take> = {}): Take {
  const samples = new Float32Array(SR * 2).fill(0.25);
  return {
    id: 't1',
    projectId: 'p',
    name: 'Take 1',
    createdAt: 0,
    sampleRate: SR,
    songStart: 2.5,
    latencyMs: 42,
    trimStart: 0,
    trimEnd: 0,
    duration: samples.length / SR,
    peaks: [],
    selected: true,
    samples,
    ...over,
  };
}

/** 从 RPP 文本里按顺序取出每个 ITEM 的字段 */
function items(rpp: string): { position: number; length: number; soffs: number; file: string }[] {
  const out: { position: number; length: number; soffs: number; file: string }[] = [];
  const re = /<ITEM\n\s+POSITION (\S+)\n\s+LENGTH (\S+)\n\s+SOFFS (\S+)\n[\s\S]*?<SOURCE WAVE\n\s+FILE "([^"]+)"/g;
  for (let m = re.exec(rpp); m; m = re.exec(rpp)) out.push({ position: Number(m[1]), length: Number(m[2]), soffs: Number(m[3]), file: m[4] });
  return out;
}

describe('WAV 编码', () => {
  it('24 bit：头字段、长度、采样值', () => {
    const l = new Float32Array([0, 1, -1, 0.5]);
    const r = new Float32Array([0.25, -0.25, 2, -2]);
    const wav = encodeWav([l, r], 44100, 'pcm24');
    const h = readWavHeader(wav);
    expect(h).toMatchObject({ format: 1, channels: 2, sampleRate: 44100, bits: 24, frames: 4 });
    const v = new DataView(wav.buffer);
    const s24 = (o: number) => {
      const n = wav[o] | (wav[o + 1] << 8) | (wav[o + 2] << 16);
      return n & 0x800000 ? n - 0x1000000 : n;
    };
    expect(s24(h.dataOffset + 3)).toBe(Math.round(0.25 * 0x7fffff));
    expect(s24(h.dataOffset + 6)).toBe(0x7fffff); // 1.0
    expect(s24(h.dataOffset + 12)).toBe(-0x800000); // -1.0
    expect(s24(h.dataOffset + 15)).toBe(0x7fffff); // 2.0 削顶
    expect(v.getUint32(4, true)).toBe(wav.length - 8);
  });

  it('32 bit 浮点：格式 3、带 fact 块、值原样', () => {
    const wav = encodeWav([new Float32Array([0.125, -0.5])], 48000, 'float32');
    const h = readWavHeader(wav);
    expect(h).toMatchObject({ format: 3, channels: 1, sampleRate: 48000, bits: 32, frames: 2 });
    const v = new DataView(wav.buffer);
    expect(v.getFloat32(h.dataOffset, true)).toBe(0.125);
    expect(v.getFloat32(h.dataOffset + 4, true)).toBe(-0.5);
  });
});

describe('.RPP 生成', () => {
  it('数字和字符串格式', () => {
    expect(num(1.5)).toBe('1.5');
    expect(num(2)).toBe('2');
    expect(num(-0)).toBe('0');
    expect(quote('说"唱"\n下一行')).toBe(`"说'唱' 下一行"`);
  });

  it('骨架：REAPER_PROJECT、TEMPO、SAMPLERATE、尖括号配对', () => {
    const rpp = projectRpp({ project: project(), sampleRate: SR, tracks: [] });
    expect(rpp.startsWith('<REAPER_PROJECT 0.1 ')).toBe(true);
    expect(rpp).toMatch(/^ {2}TEMPO 90 4 4$/m);
    expect(rpp).toMatch(/^ {2}SAMPLERATE 48000 0 0$/m);
    const opens = (rpp.match(/^\s*</gm) ?? []).length;
    const closes = (rpp.match(/^\s*>$/gm) ?? []).length;
    expect(opens).toBe(closes);
  });

  it('首拍偏移、段落写成 MARKER，歌词行写成 region', () => {
    const p = project();
    const rpp = projectRpp({ project: p, sampleRate: SR, tracks: [] });
    const bar = (60 / 90) * 4;
    expect(rpp).toContain('MARKER 1 0.12 "首拍 +120ms" 0');
    expect(rpp).toContain('MARKER 2 0.12 "Verse 1" 0');
    expect(rpp).toContain(`MARKER 3 ${num(0.12 + 2 * bar)} "Hook" 0`);
    // 第 1 小节「凌晨」、第 3 小节「夜车」；空的第 2 小节不出 region
    expect(rpp).toContain(`MARKER 4 0.12 "凌晨" 1\n  MARKER 4 ${num(0.12 + bar)} "" 1`);
    expect(rpp).toContain(`MARKER 5 ${num(0.12 + 2 * bar)} "夜车" 1`);
    expect(lyricRegions(p)).toHaveLength(2);
    expect(sectionMarkers(p).map((m) => m.name)).toEqual(['Verse 1', 'Hook']);
    // region 是整小节的起止（跟字的落点无关）
    const hook = lyricRegions(p)[1];
    expect(hook.name).toBe('夜车');
    expect(hook.start).toBeCloseTo(0.12 + 2 * bar, 9);
    expect(hook.end).toBeCloseTo(0.12 + 3 * bar, 9);
  });

  it('take 的 ITEM POSITION = 录音起点 − 校准延迟 + 裁头；SOFFS = 裁头；LENGTH = 裁后长度', () => {
    const t = take({ trimStart: 0.3, trimEnd: 0.2 });
    const item = takeItem(t, 'audio/take-01.wav')!;
    expect(item.position).toBeCloseTo(2.5 - 0.042 + 0.3, 9);
    expect(item.sourceOffset).toBeCloseTo(0.3, 9);
    expect(item.length).toBeCloseTo(1.5, 9);
    const rpp = buildRpp({ bpm: 90, sampleRate: SR, markers: [], regions: [], tracks: [{ name: 'Take 1', items: [item] }] });
    const [it0] = items(rpp);
    expect(it0.position).toBeCloseTo(2.758, 9);
    expect(it0.soffs).toBeCloseTo(0.3, 9);
    expect(it0.file).toBe('audio/take-01.wav');
  });

  it('不同校准值 → ITEM POSITION 跟着变（偏移确实写进去了）', () => {
    const a = takeItem(take({ latencyMs: 0 }), 'a.wav')!;
    const b = takeItem(take({ latencyMs: 180 }), 'a.wav')!;
    expect(a.position - b.position).toBeCloseTo(0.18, 9);
  });
});

describe('Reaper zip 打包', () => {
  const backing = { name: 'beat.mp3', channels: [new Float32Array(SR * 3).fill(0.1), new Float32Array(SR * 3).fill(-0.1)] };

  it('zip 里有 .RPP 和非空 WAV，SOURCE FILE 指向 zip 内的路径', () => {
    const takes = [take({ id: 'a', name: 'Take 1', selected: false }), take({ id: 'b', name: 'Take 2', selected: true, latencyMs: 40, trimStart: 0.1 })];
    const out = buildReaperZip({ project: project(), sampleRate: SR, backing, takes, stems: { backing: true, takes: true, metronome: true, guide: true } });
    const zip = unzipSync(out.zip);
    expect(Object.keys(zip).sort()).toEqual(['audio/backing.wav', 'audio/click.wav', 'audio/guide.wav', 'audio/take-01.wav', 'audio/take-02.wav', '夜车.RPP']);
    const rpp = new TextDecoder().decode(zip['夜车.RPP']);
    expect(rpp).toBe(out.rpp);
    const its = items(rpp);
    for (const it of its) {
      expect(zip[it.file]).toBeDefined();
      expect(readWavHeader(zip[it.file]).frames).toBeGreaterThan(0);
    }
    // 伴奏在 0；Take 2 = 2.5 − 0.04 + 0.1
    expect(its[0]).toMatchObject({ position: 0, file: 'audio/backing.wav' });
    expect(its[2].position).toBeCloseTo(2.56, 9);
    expect(its[2].soffs).toBeCloseTo(0.1, 9);
    // 选用的 take 不静音，其余静音
    expect(rpp).toMatch(/NAME "Take 1"\n\s+VOLPAN [^\n]+\n\s+MUTESOLO 1 0 0/);
    expect(rpp).toMatch(/NAME "Take 2 ★"\n\s+VOLPAN [^\n]+\n\s+MUTESOLO 0 0 0/);
    expect(readWavHeader(zip['audio/backing.wav'])).toMatchObject({ channels: 2, sampleRate: SR, bits: 24 });
    // 节拍器 / 导唱铺满整个工程长度（3 小节 + 首拍偏移，比伴奏和 take 都长）
    const seconds = projectSeconds(project(), 3, takes);
    expect(seconds).toBeCloseTo(0.12 + 3 * 4 * (60 / 90), 9);
    for (const f of ['audio/click.wav', 'audio/guide.wav']) expect(readWavHeader(zip[f]).frames).toBe(Math.ceil(seconds * SR));
    expect(rpp).toMatch(/NAME "导唱"\n\s+VOLPAN 0.5 /);
  });

  it('文件名去掉不能用的字符', () => {
    expect(safeName('夜车: v2/最终?')).toBe('夜车_ v2_最终_');
    expect(safeName('  ')).toBe('AnyBeats');
  });

  it('只勾伴奏：没有 take 文件', () => {
    const out = buildReaperZip({ project: project(), sampleRate: SR, backing, takes: [take()], stems: { backing: true, takes: false, metronome: false, guide: false } });
    expect(out.files).toEqual(['夜车.RPP', 'audio/backing.wav']);
  });

  it('节拍器渲染：每拍一下', () => {
    const p = project();
    const pcm = renderMetronome(p, 3, 8000);
    const beat = 60 / 90;
    const at = (t: number) => Math.abs(pcm[Math.round((t + 0.0013) * 8000)]);
    expect(at(0.12)).toBeGreaterThan(0.01);
    expect(at(0.12 + beat)).toBeGreaterThan(0.01);
    expect(Math.abs(pcm[Math.round((0.12 + beat / 2) * 8000)])).toBeLessThan(1e-3);
  });

  it('导唱渲染：每个字一声、按字的长度拉长，长字比短字响得久；空白不出声', () => {
    const p = project();
    const sr = 8000;
    const pcm = renderGuide(p, 9, sr);
    expect(pcm.length).toBe(9 * sr);
    expect(guideEvents(p.grid).map((e) => e.len)).toEqual([12, 84, 12, 12]);
    const t = (tick: number) => timeOfTick(p, tick);
    /** [from, to) 秒里从 from 起最后一个出声的采样离 from 多远 */
    const span = (from: number, to: number) => {
      let last = -1;
      for (let i = Math.round(from * sr); i < Math.min(pcm.length, Math.round(to * sr)); i++) if (Math.abs(pcm[i]) > 1e-3) last = i;
      return last < 0 ? 0 : last / sr - from;
    };
    const peak = (from: number, to: number) => {
      let m = 0;
      for (let i = Math.round(from * sr); i < Math.round(to * sr); i++) m = Math.max(m, Math.abs(pcm[i]));
      return m;
    };
    const tickSec = 60 / 90 / TICKS_PER_BEAT;
    const short = span(t(0), t(12)); // 「凌」12 tick
    const long = span(t(12), t(12 + 84 + 48)); // 「晨」84 tick
    expect(short).toBeGreaterThan(0.08);
    expect(short).toBeLessThan(12 * tickSec);
    expect(long).toBeGreaterThan(84 * tickSec * 0.85);
    expect(long).toBeLessThan(84 * tickSec);
    expect(long).toBeGreaterThan(5 * short);
    // 「晨」之后到 Hook 的「夜」之前全是空白（含空的第 2 小节）：不出声
    expect(peak(t(12 + 84) + 0.01, t(2 * 192 + 48) - 0.01)).toBe(0);
    expect(peak(t(2 * 192 + 48), t(2 * 192 + 48) + 0.02)).toBeGreaterThan(0.01);
  });
});
