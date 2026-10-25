/**
 * 「Reaper 工程 + 分轨」打包（纯函数）：一个 zip，里面是
 *
 *   <作品名>.RPP
 *   audio/backing.wav        伴奏（原声道数）
 *   audio/take-01.wav …      每个 take 一个文件（完整录音，未裁；裁剪写在 .RPP 的 SOFFS / LENGTH 里）
 *   audio/click.wav          节拍器（可选）
 *   audio/guide.wav          导唱（可选）
 *
 * 轨道：伴奏一轨；每个 take 一轨，★ 选用的那轨正常，其余轨静音（打开就是选好的那一遍，想换随时取消静音）。
 */

import { zipSync, type Zippable } from 'fflate';
import { timeOfStep, totalSteps, type Project } from '../core';
import { alignedRegion, type Take } from '../audio/takes';
import { renderGuide, renderMetronome } from './clicks';
import { projectRpp, takeItem, type RppTrack } from './rpp';
import { encodeWav, type WavFormat } from './wav';

export interface StemChoice {
  backing: boolean;
  takes: boolean;
  metronome: boolean;
  guide: boolean;
}

export interface ReaperExportInput {
  project: Project;
  /** 导出采样率（跟随 AudioContext） */
  sampleRate: number;
  backing: { name: string; channels: Float32Array[] } | null;
  takes: Take[];
  stems: StemChoice;
  format?: WavFormat;
}

export interface ReaperExport {
  zip: Uint8Array;
  rppName: string;
  rpp: string;
  files: string[];
}

export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\r\n]+/g, '_').trim() || 'AnyBeats';
}

/** 工程总长：网格、伴奏、各 take 末尾取最大 */
export function projectSeconds(project: Project, backingSeconds: number, takes: Take[]): number {
  let end = Math.max(timeOfStep(project, totalSteps(project.grid)), backingSeconds);
  for (const t of takes) {
    const r = alignedRegion(t);
    if (r) end = Math.max(end, r.position + r.length);
  }
  return end;
}

export function buildReaperZip(input: ReaperExportInput): ReaperExport {
  const { project, sampleRate, backing, takes, stems } = input;
  const format = input.format ?? 'pcm24';
  const files: Zippable = {};
  const tracks: RppTrack[] = [];
  const backingSeconds = backing && backing.channels[0] ? backing.channels[0].length / sampleRate : 0;
  const seconds = projectSeconds(project, backingSeconds, stems.takes ? takes : []);

  if (stems.backing && backing && backingSeconds > 0) {
    const file = 'audio/backing.wav';
    files[file] = encodeWav(backing.channels, sampleRate, format);
    tracks.push({ name: `伴奏 · ${backing.name}`, items: [{ name: backing.name, position: 0, length: backingSeconds, sourceOffset: 0, file }] });
  }

  if (stems.takes) {
    takes.forEach((t, i) => {
      const file = `audio/take-${String(i + 1).padStart(2, '0')}.wav`;
      const item = takeItem(t, file);
      if (!item) return;
      files[file] = encodeWav([t.samples], t.sampleRate, format);
      tracks.push({ name: t.selected ? `${t.name} ★` : t.name, mute: !t.selected, items: [item] });
    });
  }

  if (stems.metronome) {
    const file = 'audio/click.wav';
    files[file] = encodeWav([renderMetronome(project, seconds, sampleRate)], sampleRate, format);
    tracks.push({ name: '节拍器', volume: 0.5, items: [{ name: '节拍器', position: 0, length: seconds, sourceOffset: 0, file }] });
  }

  if (stems.guide) {
    const file = 'audio/guide.wav';
    files[file] = encodeWav([renderGuide(project, seconds, sampleRate)], sampleRate, format);
    tracks.push({ name: '导唱', volume: 0.5, items: [{ name: '导唱', position: 0, length: seconds, sourceOffset: 0, file }] });
  }

  const rpp = projectRpp({ project, sampleRate, tracks });
  const rppName = `${safeName(project.name)}.RPP`;
  const enc = new TextEncoder();
  const zipFiles: Zippable = { [rppName]: enc.encode(rpp), ...files };
  // WAV 基本压不动，直接存（level 0）省时间
  const zip = zipSync(zipFiles, { level: 0 });
  return { zip, rppName, rpp, files: Object.keys(zipFiles) };
}
