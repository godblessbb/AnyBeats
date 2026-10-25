import { useState } from 'react';
import { stepDuration } from '../core';
import { BPM_MAX, BPM_MIN, type SaveStatus } from '../engine/editorStore';
import { formatClock, formatPosition, playFrom } from '../engine/view';
import { Icon } from './icons';
import { useAi, useEditor, useRecorder, useServices, useTransport } from './services';

function clockText(ms: number) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function saveLabel(save: SaveStatus): { text: string; tone: 'ok' | 'warn' | 'busy' } {
  switch (save.kind) {
    case 'saved':
      return { text: save.at ? `已自动保存 · ${clockText(save.at)}` : '已自动保存', tone: 'ok' };
    case 'pending':
      return { text: '正在自动保存…', tone: 'busy' };
    case 'memory':
      return { text: '本次不保存', tone: 'warn' };
    case 'error':
      return { text: `保存失败：${save.message}`, tone: 'warn' };
  }
}

function ProjectName() {
  const { store } = useServices();
  const s = useEditor();
  const [editing, setEditing] = useState(false);
  const save = saveLabel(s.save);
  return (
    <div className="proj">
      {editing ? (
        <input
          className="name-input"
          defaultValue={s.name}
          autoFocus
          aria-label="作品名"
          onBlur={(e) => {
            store.rename(e.currentTarget.value);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <b data-contrast data-role="project-name" title="点击改名" onClick={() => setEditing(true)}>
          {s.name}
        </b>
      )}
      <span data-role="save-status" className={save.tone === 'warn' ? 'save-warn' : undefined} title={s.save.kind === 'memory' ? s.save.reason : undefined}>
        <span className={`dot ${save.tone}`}></span>
        {save.text}
      </span>
    </div>
  );
}

export function BpmControl({ compact = false }: { compact?: boolean }) {
  const { store } = useServices();
  const s = useEditor();
  const [editing, setEditing] = useState(false);
  const shown = Number.isInteger(s.bpm) ? String(s.bpm) : s.bpm.toFixed(1);
  return (
    <div className="bpm" title="BPM：载入伴奏后自动检测，可 ±1 手动校；点数字直接输入">
      {!compact && <span className="lbl">BPM</span>}
      {editing ? (
        <input
          className="bpm-input mono"
          type="number"
          min={BPM_MIN}
          max={BPM_MAX}
          defaultValue={shown}
          autoFocus
          aria-label="BPM"
          onBlur={(e) => {
            store.setBpm(Number(e.currentTarget.value));
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <b className="mono" data-contrast data-role="bpm" onClick={() => setEditing(true)}>
          {shown}
        </b>
      )}
      {s.bpmAuto && <span className="tag">自动</span>}
      {!compact && (
        <>
          <button className="ibtn" title="-1" aria-label="BPM 减 1" onClick={() => store.setBpm(Math.round(s.bpm) - 1)}>
            <Icon.minus />
          </button>
          <button className="ibtn" title="+1" aria-label="BPM 加 1" onClick={() => store.setBpm(Math.round(s.bpm) + 1)}>
            <Icon.plus />
          </button>
        </>
      )}
    </div>
  );
}

function usePositionText() {
  const s = useEditor();
  const t = useTransport();
  const { transport } = useServices();
  const abs = t.position ?? (s.selection ? s.selection.focus : 0);
  const now = s.offsetMs / 1000 + abs * stepDuration(s.bpm);
  return { bar: formatPosition(abs), time: formatClock(now), total: formatClock(transport.songSeconds(), false) };
}

export function PlayButton({ mobile = false }: { mobile?: boolean }) {
  const { transport } = useServices();
  const s = useEditor();
  const t = useTransport();
  return (
    <button
      className="play"
      data-role={mobile ? 'play-m' : 'play'}
      title="播放 / 停止（空格）"
      aria-label={t.playing ? '停止' : '播放'}
      aria-pressed={t.playing}
      onClick={() => transport.toggle(playFrom(s.selection))}
    >
      {t.playing ? <Icon.pause /> : <Icon.play />}
    </button>
  );
}

export function RecordButton({ onRecord, mobile = false }: { onRecord: () => void; mobile?: boolean }) {
  const r = useRecorder();
  const recording = r.phase === 'recording' || r.phase === 'starting';
  const title = !r.available.ok ? `录不了音：${r.available.reason}` : recording ? '停止录音（R）' : '录音（R）：跟伴奏录一遍';
  return (
    <button
      className={`ibtn recbtn${recording ? ' on' : ''}${r.available.ok ? '' : ' unavailable'}`}
      data-role={mobile ? 'record-m' : 'record'}
      title={title}
      aria-label={title}
      aria-pressed={recording}
      data-unavailable={r.available.ok ? undefined : '1'}
      onClick={onRecord}
    >
      <Icon.rec />
    </button>
  );
}

export function WorkerChip() {
  const ai = useAi();
  const connected = ai.status?.state === 'connected';
  const text = ai.status === null || ai.checking ? 'Worker 检测中' : connected ? (ai.status as { worker: string }).worker : 'Worker 未连接';
  return (
    <span className={`worker${connected ? '' : ' off'}`} title="当前 Worker" data-role="worker">
      <span className="dot"></span>
      {text}
    </span>
  );
}

export function TopBar({ onExport, onRecord }: { onExport: () => void; onRecord: () => void }) {
  const { store, transport } = useServices();
  const s = useEditor();
  const t = useTransport();
  const pos = usePositionText();
  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">AB</span>
        <ProjectName />
      </div>
      <div className="sep desk-only"></div>
      <button className="ibtn" title={s.undoLabel ? `撤销 ${s.undoLabel}（⌘Z）` : '撤销 ⌘Z'} aria-label="撤销" data-role="undo" disabled={!s.canUndo} onClick={() => store.undo()}>
        <Icon.undo />
      </button>
      <button className="ibtn" title={s.redoLabel ? `重做 ${s.redoLabel}（⇧⌘Z）` : '重做 ⇧⌘Z'} aria-label="重做" data-role="redo" disabled={!s.canRedo} onClick={() => store.redo()}>
        <Icon.redo />
      </button>
      <div className="sep desk-only"></div>
      <div className="transport">
        <button className="ibtn" title="回到开头" aria-label="回到开头" onClick={() => {
          transport.stop();
          store.clearSelection();
        }}>
          <Icon.start />
        </button>
        <PlayButton />
        <RecordButton onRecord={onRecord} />
        <div className="pos" data-role="position">
          <b className="mono" data-contrast>{pos.bar}</b>
          <span className="mono hide-narrow">
            {pos.time} / {pos.total}
          </span>
        </div>
        <BpmControl />
        <button className={`tog${t.metronome ? ' on' : ''}`} title="节拍器（和伴奏同一时钟）" aria-pressed={t.metronome} onClick={() => transport.setMetronome(!t.metronome)}>
          <Icon.metro />
          <span className="hide-narrow">节拍器</span>
        </button>
        <button className={`tog${t.guide ? ' on' : ''}`} title="智能导唱：按字打点，延音不打" aria-pressed={t.guide} onClick={() => transport.setGuide(!t.guide)}>
          <Icon.guide />
          <span className="hide-narrow">导唱</span>
        </button>
        <button className={`tog${t.loop ? ' on' : ''}`} title="循环播放" aria-label="循环播放" aria-pressed={t.loop} onClick={() => transport.setLoop(!t.loop)}>
          <Icon.loop />
        </button>
      </div>
      <div className="spacer"></div>
      <span className="desk-only">
        <WorkerChip />
      </span>
      <button className="btn desk-only" title="工程与导出 ⌘E" data-role="open-export" onClick={onExport}>
        <Icon.out />
        导出
      </button>
      <button className="ibtn mob-only" title="工程与导出" aria-label="工程与导出" onClick={onExport}>
        <Icon.out />
      </button>
    </header>
  );
}

export function MobileTransport({ onRecord }: { onRecord: () => void }) {
  const { transport } = useServices();
  const t = useTransport();
  const pos = usePositionText();
  return (
    <div className="mtransport">
      <PlayButton mobile />
      <RecordButton onRecord={onRecord} mobile />
      <div className="pos">
        <b className="mono" data-contrast>{pos.bar}</b>
        <span className="mono">{pos.time}</span>
      </div>
      <div className="spacer"></div>
      <BpmControl compact />
      <button className={`tog${t.metronome ? ' on' : ''}`} aria-label="节拍器" aria-pressed={t.metronome} onClick={() => transport.setMetronome(!t.metronome)}>
        <Icon.metro />
      </button>
      <button className={`tog${t.guide ? ' on' : ''}`} aria-label="导唱" aria-pressed={t.guide} onClick={() => transport.setGuide(!t.guide)}>
        <Icon.guide />
      </button>
    </div>
  );
}
