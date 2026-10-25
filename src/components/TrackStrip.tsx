import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { stepDuration, STEPS_PER_BAR } from '../core';
import { formatClock } from '../engine/view';
import { Icon } from './icons';
import { Menu } from './Menu';
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

function Volume({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const set = (e: RPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onChange(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
  };
  return (
    <div className="vol">
      <span className="muted">{label}</span>
      <div
        className="bar"
        role="slider"
        tabIndex={0}
        aria-label={`${label}音量`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          set(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons) set(e);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onChange(Math.max(0, value - 0.05));
          if (e.key === 'ArrowRight') onChange(Math.min(1, value + 0.05));
        }}
      >
        <i style={{ width: `${Math.round(value * 100)}%` }}></i>
      </div>
    </div>
  );
}

export function TrackStrip() {
  const { store, transport } = useServices();
  const s = useEditor();
  const t = useTransport();
  const fileRef = useRef<HTMLInputElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const dur = stepDuration(s.bpm);
  const total = transport.songSeconds() || 1;
  const xOfStep = (step: number) => ((s.offsetMs / 1000 + step * dur) / total) * 100;
  const bars = s.grid.sections.reduce((n, sec) => n + sec.bars.length, 0);
  const every = bars <= 24 ? 1 : bars <= 48 ? 2 : 4;
  const sectionStarts: { label: string; bar: number }[] = [];
  s.grid.sections.reduce((n, sec) => {
    sectionStarts.push({ label: sec.label, bar: n });
    return n + sec.bars.length;
  }, 0);
  const headStep = t.position ?? (s.selection ? s.selection.focus : null);
  const headX = headStep === null ? null : xOfStep(headStep);
  const backing = t.backing;
  const waveWidth = backing ? (backing.duration / total) * 100 : 0;
  const played = backing && headX !== null ? Math.round((Math.min(headX, waveWidth) / waveWidth) * backing.peaks.length) : 0;

  const load = (file: File | undefined) => {
    if (file) void transport.loadBacking(file);
  };

  const dragFlag = (e: RPointerEvent<HTMLDivElement>) => {
    const lane = laneRef.current;
    if (!lane) return;
    const r = lane.getBoundingClientRect();
    const sec = ((e.clientX - r.left) / r.width) * total;
    store.setOffsetMs(sec * 1000);
  };

  return (
    <section
      className={`strip${dragOver ? ' drop' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragOver(false);
        load(e.dataTransfer.files[0]);
      }}
    >
      <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => load(e.currentTarget.files?.[0])} />
      <div className="lanes-l">
        <div className="lane-h big">
          <button className="nm lane-name" title={backing ? '替换伴奏' : '载入伴奏'} onClick={() => fileRef.current?.click()}>
            伴奏 · {backing ? backing.name : t.analyzing ? '分析中…' : '点此载入'}
          </button>
          <span className="sub">
            {backing ? formatClock(backing.duration, false) : '未载入'} · 首拍 +{s.offsetMs}ms
          </span>
          <button
            className="ibtn lane-more"
            aria-label="伴奏菜单"
            title="伴奏：替换 / 移除"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ x: r.left, y: r.bottom + 2 });
            }}
          >
            <Icon.more />
          </button>
        </div>
        {menu && (
          <Menu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            items={[
              { label: backing ? '替换伴奏…' : '载入伴奏…', onClick: () => fileRef.current?.click() },
              { label: '移除伴奏', danger: true, disabled: !backing, onClick: () => transport.removeBacking() },
              { label: '首拍偏移归零', disabled: s.offsetMs === 0, onClick: () => store.setOffsetMs(0) },
            ]}
          />
        )}
      </div>
      <div className="lanes-c" ref={laneRef}>
        <div className="ruler">
          {Array.from({ length: bars }, (_, b) =>
            b % every === 0 ? (
              <RulerTick key={b} x={xOfStep(b * STEPS_PER_BAR)} n={b + 1} />
            ) : null,
          )}
          {sectionStarts.map((sec, i) => (
            <span key={i} className="sec" style={{ left: `${xOfStep(sec.bar * STEPS_PER_BAR)}%` }}>
              {sec.label}
            </span>
          ))}
        </div>
        <div className="lane wave-lane" style={{ height: 23 }} data-role="backing-lane">
          {backing ? (
            <svg viewBox="0 0 1000 100" preserveAspectRatio="none" style={{ width: `${waveWidth}%` }}>
              <g fill="var(--wave-played)">{played > 0 && <polygon points={wavePolygon(backing.peaks, 0, played)} />}</g>
              <g fill="var(--wave)">
                <polygon points={wavePolygon(backing.peaks, Math.max(0, played - 1), backing.peaks.length)} />
              </g>
            </svg>
          ) : (
            <button className="lane-empty" onClick={() => fileRef.current?.click()}>
              {t.analyzing ? '正在分析伴奏、检测 BPM…' : '拖入伴奏（mp3 / wav），自动检测 BPM'}
            </button>
          )}
        </div>
        {/* 录音 take 泳道的位置（录音上线后在这里展开） */}
        <div className="take-lanes" data-role="take-lanes" aria-hidden="true"></div>
        <div
          className="firstbeat"
          style={{ left: `${(s.offsetMs / 1000 / total) * 100}%` }}
          title={`第一拍偏移 +${s.offsetMs}ms，可拖动`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (e.buttons) dragFlag(e);
          }}
        >
          <i className="fb-hit"></i>
        </div>
        {headX !== null && <div className="playhead" style={{ left: `${Math.min(100, headX)}%` }}></div>}
      </div>
      <div className="lanes-r">
        <Volume label="伴奏" value={t.backingVolume} onChange={(v) => transport.setBackingVolume(v)} />
        <Volume label="节拍" value={t.clickVolume} onChange={(v) => transport.setClickVolume(v)} />
        {t.message && <span className="lbl strip-msg" title={t.message}>{t.message}</span>}
      </div>
    </section>
  );
}

function RulerTick({ x, n }: { x: number; n: number }) {
  return (
    <>
      <i style={{ left: `${x}%` }}></i>
      <span style={{ left: `${x}%` }}>{n}</span>
    </>
  );
}
