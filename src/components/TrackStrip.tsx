import { useRef } from 'react';
import { barCount, stepDuration, STEPS_PER_BAR } from '../core';
import { formatClock } from '../engine/view';
import { Icon } from './icons';
import { useEditor, useServices, useTransport } from './services';

function wavePolygon(peaks: number[], from: number, to: number): string {
  const n = peaks.length;
  const top: string[] = [];
  const bot: string[] = [];
  for (let i = from; i < to; i++) {
    const x = ((i / n) * 1000).toFixed(1);
    const amp = 4 + peaks[i] * 44;
    top.push(`${x},${(50 - amp).toFixed(1)}`);
    bot.unshift(`${x},${(50 + amp).toFixed(1)}`);
  }
  return top.concat(bot).join(' ');
}

/** 轨道区：只有伴奏（录音整块不挂载）。伴奏可替换；BPM 不一样时弹窗二选一 */
export function TrackStrip() {
  const { transport } = useServices();
  const s = useEditor();
  const t = useTransport();
  const fileRef = useRef<HTMLInputElement>(null);
  const doc = s.doc;
  const total = transport.songSeconds() || 1;
  const dur = stepDuration(doc.bpm);
  const xOfBar = (bar: number) => ((doc.offsetMs / 1000 + bar * STEPS_PER_BAR * dur) / total) * 100;
  const bars = barCount(doc.grid);
  const every = bars <= 24 ? 1 : bars <= 48 ? 2 : 4;
  const starts: { label: string; bar: number }[] = [];
  doc.grid.sections.reduce((n, sec) => {
    starts.push({ label: sec.label, bar: n });
    return n + sec.bars.length;
  }, 0);
  const startBars = new Set(starts.map((x) => x.bar));
  const headX = t.position !== null ? ((doc.offsetMs / 1000 + t.position * dur) / total) * 100 : null;
  const backing = t.backing;
  const rate = doc.beat?.rate ?? 1;
  const waveWidth = backing ? (backing.duration / rate / total) * 100 : 0;
  const name = backing?.name ?? doc.beat?.name ?? null;
  const sub = backing
    ? `${formatClock(backing.duration / rate, false)}${doc.beat?.bpm ? ` · ${Math.round(doc.beat.bpm)} BPM` : ''}${rate !== 1 ? ` · 变速 ${rate.toFixed(2)}×` : ''}`
    : t.backingMissing
      ? '需要重新选择文件'
      : t.analyzing
        ? '分析中…'
        : '还没载入';
  const pick = () => fileRef.current?.click();
  return (
    <section className="track" data-role="track-area">
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        hidden
        data-role="beat-file"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) void transport.loadBacking(f);
        }}
      />
      <div className="tl-lab ruler-l">小节</div>
      <div className="ruler">
        {Array.from({ length: bars }, (_, b) =>
          b % every === 0 && !startBars.has(b) ? (
            <span key={b} className="bm" style={{ left: `${xOfBar(b)}%` }}>
              {b + 1}
            </span>
          ) : null,
        )}
        {starts.map((x, i) => (
          <span key={i}>
            <span className="bm nx" style={{ left: `${xOfBar(x.bar)}%` }}></span>
            <span className="sl" data-role="section-label" style={{ left: `calc(${xOfBar(x.bar)}% + 2px)` }}>
              {x.label}
            </span>
          </span>
        ))}
      </div>
      <div className="tl-lab">
        <div className="nm">
          <b>伴奏</b>
          <span title={name ?? undefined}>
            {name ? `${name} · ` : ''}
            {sub}
          </span>
        </div>
        <div className="spacer"></div>
        <button className="btn sm" data-role="replace-beat" onClick={pick} title={doc.beat ? '替换伴奏（BPM 不一样时会让你二选一）' : '载入伴奏（mp3 / wav），自动检测 BPM'}>
          <Icon.swap />
          {doc.beat ? (t.backingMissing ? '重新选择' : '替换伴奏') : '载入伴奏'}
        </button>
      </div>
      <div className="lane" data-role="backing-lane">
        {backing ? (
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" style={{ width: `${waveWidth}%` }}>
            <polygon points={wavePolygon(backing.peaks, 0, backing.peaks.length)} style={{ fill: 'var(--wave)' }} />
          </svg>
        ) : (
          <button className="lane-empty" onClick={pick}>
            {t.analyzing ? '正在分析伴奏、检测 BPM…' : t.backingMissing ? `「${t.backingMissing}」要重新选择一次文件（音频不存进本机）` : '点这里载入伴奏（mp3 / wav），自动检测 BPM'}
          </button>
        )}
        {headX !== null && <span className="playhead" style={{ left: `${Math.min(100, headX)}%` }}></span>}
      </div>
      <div className="m-beat mob-only">
        <span>
          伴奏 <b>{name ?? '还没载入'}</b>
          {backing && doc.beat?.bpm ? ` · ${Math.round(doc.beat.bpm)} BPM` : ''}
        </span>
        <span className="spacer"></span>
        <button className="btn sm" data-role="replace-beat" onClick={pick}>
          <Icon.swap />
          {doc.beat ? '替换' : '载入'}
        </button>
      </div>
    </section>
  );
}
