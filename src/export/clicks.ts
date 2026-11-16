/**
 * 把节拍器 / 导唱离线渲染成 PCM（纯函数），导出成分轨 WAV。
 * 发声规则和播放时一致：节拍器每拍一下、小节头高音（core/clock 的 attachMetronome）；
 * 导唱每个字「嗒」一声，按字的长度拉长，空白不出声（engine/transport）。
 */

import { guideEvents, STEPS_PER_BAR, STEPS_PER_BEAT, tickDuration, timeOfStep, timeOfTick, totalSteps, type Project } from '../core';

interface Hit {
  time: number;
  freq: number;
  gain: number;
  wave: 'sine' | 'triangle';
  /** 持续多少秒（不给 = 短促一下） */
  hold?: number;
}

function render(hits: Hit[], seconds: number, sampleRate: number): Float32Array {
  const out = new Float32Array(Math.max(1, Math.ceil(seconds * sampleRate)));
  for (const h of hits) {
    const start = Math.round(h.time * sampleRate);
    const holdSec = h.hold ?? 0;
    const len = Math.round(Math.max(0.08, holdSec) * sampleRate);
    for (let i = 0; i < len; i++) {
      const k = start + i;
      if (k < 0 || k >= out.length) continue;
      const t = i / sampleRate;
      const ph = 2 * Math.PI * h.freq * t;
      const osc = h.wave === 'sine' ? Math.sin(ph) : (2 / Math.PI) * Math.asin(Math.sin(ph));
      // 起音后衰减到 35% 并保持到字结束，最后 30ms 收掉
      const env = holdSec ? Math.max(0.35, Math.exp(-t * 60)) * Math.min(1, (holdSec - t) / 0.03) : Math.exp(-t * 60);
      out[k] += osc * Math.max(0, env) * h.gain;
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
  const sec = tickDuration(project.bpm);
  for (const e of guideEvents(project.grid)) {
    hits.push({ time: timeOfTick(project, e.abs), freq: 1180, gain: 0.35, wave: 'triangle', hold: Math.max(0.06, e.len * sec * 0.92) });
  }
  return render(hits, seconds, sampleRate);
}
