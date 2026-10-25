/**
 * 把节拍器 / 导唱离线渲染成 PCM（纯函数），导出成分轨 WAV。
 * 发声规则和播放时一致：节拍器每拍一下、小节头高音（core/clock 的 attachMetronome）；
 * 导唱在每个字的起点打一下（延音、空拍不打），重音字高音（engine/transport）。
 */

import { iterateClips, STEPS_PER_BAR, STEPS_PER_BEAT, timeOfStep, totalSteps, type Project } from '../core';

interface Hit {
  time: number;
  freq: number;
  gain: number;
  wave: 'sine' | 'triangle';
}

function render(hits: Hit[], seconds: number, sampleRate: number): Float32Array {
  const out = new Float32Array(Math.max(1, Math.ceil(seconds * sampleRate)));
  const len = Math.round(0.08 * sampleRate);
  for (const h of hits) {
    const start = Math.round(h.time * sampleRate);
    for (let i = 0; i < len; i++) {
      const k = start + i;
      if (k < 0 || k >= out.length) continue;
      const t = i / sampleRate;
      const ph = 2 * Math.PI * h.freq * t;
      const osc = h.wave === 'sine' ? Math.sin(ph) : (2 / Math.PI) * Math.asin(Math.sin(ph));
      const env = Math.exp(-t * 60);
      out[k] += osc * env * h.gain;
    }
  }
  return out;
}

export function renderMetronome(project: Project, seconds: number, sampleRate: number): Float32Array {
  const hits: Hit[] = [];
  const total = totalSteps(project.grid);
  for (let s = 0; s < total; s += STEPS_PER_BEAT) {
    const accent = s % STEPS_PER_BAR === 0;
    hits.push({ time: timeOfStep(project, s), freq: accent ? 1000 : 800, gain: accent ? 0.5 : 0.35, wave: 'sine' });
  }
  return render(hits, seconds, sampleRate);
}

export function renderGuide(project: Project, seconds: number, sampleRate: number): Float32Array {
  const hits: Hit[] = [];
  for (const loc of iterateClips(project.grid)) {
    if (loc.clip.hold || !loc.clip.text) continue;
    hits.push({ time: timeOfStep(project, loc.absStart), freq: loc.clip.accent ? 1480 : 1180, gain: loc.clip.accent ? 0.5 : 0.35, wave: 'triangle' });
  }
  return render(hits, seconds, sampleRate);
}
