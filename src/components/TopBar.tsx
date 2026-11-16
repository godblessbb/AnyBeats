import { useState } from 'react';
import { tickDuration } from '../core';
import { BPM_MAX, BPM_MIN, type SaveStatus } from '../engine/editorStore';
import { formatClock, formatPosition, playFrom } from '../engine/view';
import { Icon } from './icons';
import { useEditor, useServices, useTransport } from './services';

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
            e.stopPropagation();
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <b data-contrast data-role="project-name" title="点击改名" onClick={() => setEditing(true)}>
          {s.name}
        </b>
      )}
      <span data-role="save-status" title={s.save.kind === 'memory' ? s.save.reason : undefined}>
        <i className={`dot ${save.tone}`}></i>
        {save.text}
        {save.tone === 'ok' && <span className="desk-only"> · 含撤销历史</span>}
      </span>
    </div>
  );
}

export function BpmControl({ compact = false }: { compact?: boolean }) {
  const { store } = useServices();
  const s = useEditor();
  const [editing, setEditing] = useState(false);
  const bpm = s.doc.bpm;
  const shown = Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1);
  return (
    <div className="bpm" title="BPM：点数字直接输入；换伴奏时 BPM 不一样会弹窗二选一">
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
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <b className="mono" data-contrast data-role="bpm" onClick={() => setEditing(true)}>
          {shown}
        </b>
      )}
    </div>
  );
}

function usePosition() {
  const s = useEditor();
  const t = useTransport();
  const { transport } = useServices();
  const abs = t.position !== null ? t.position * 12 : (s.cursor ?? 0);
  const now = s.doc.offsetMs / 1000 + abs * tickDuration(s.doc.bpm);
  return { bar: formatPosition(abs), time: formatClock(now), total: formatClock(transport.songSeconds(), false) };
}

/** 唯一的播放键 */
export function PlayButton() {
  const { transport } = useServices();
  const s = useEditor();
  const t = useTransport();
  return (
    <button
      className="play"
      data-role="play"
      title="播放 / 停止（空格）"
      aria-label={t.playing ? '停止' : '播放'}
      aria-pressed={t.playing}
      onClick={() => transport.toggle(playFrom(s.cursor === null ? null : { focus: s.cursor }))}
    >
      {t.playing ? <Icon.pause /> : <Icon.play />}
    </button>
  );
}

export function Steps() {
  const { store } = useServices();
  const s = useEditor();
  return (
    <div className="steps" data-role="steps">
      <button className={s.step === 1 ? 'on' : ''} aria-pressed={s.step === 1} data-step="1" onClick={() => store.setStep(1)}>
        <i>1</i>铺 flow
      </button>
      <button className={s.step === 2 ? 'on' : ''} aria-pressed={s.step === 2} data-step="2" onClick={() => store.setStep(2)}>
        <i>2</i>
        <span className="desk-only">填字和韵脚</span>
        <span className="mob-only">填字</span>
      </button>
    </div>
  );
}

function Transport({ desk }: { desk: boolean }) {
  const { transport, store } = useServices();
  const pos = usePosition();
  return (
    <div className="transport">
      {desk && (
        <button
          className="ibtn"
          title="回到开头"
          aria-label="回到开头"
          onClick={() => {
            transport.stop();
            store.focusWord(null);
          }}
        >
          <Icon.start />
        </button>
      )}
      <PlayButton />
      <div className="pos" data-role="position">
        <b className="mono" data-contrast>
          {pos.bar}
        </b>
        {desk && (
          <span className="mono">
            {pos.time} / {pos.total}
          </span>
        )}
      </div>
    </div>
  );
}

export function TopBar({ onHistory, historyOpen, onProjects }: { onHistory: () => void; historyOpen: boolean; onProjects: () => void }) {
  const { store, transport } = useServices();
  const s = useEditor();
  const t = useTransport();
  const h = s.history;
  const undoTitle = h.undoLabel ? `撤销：${h.undoLabel}（⌘Z）` : '撤销（⌘Z）';
  const redoTitle = h.redoLabel ? `重做：${h.redoLabel}（⇧⌘Z）` : '重做（⇧⌘Z）';
  return (
    <>
      <header className="top">
        <div className="brand">
          <span className="logo">AB</span>
          <ProjectName />
        </div>
        <div className="vsep desk-only"></div>
        <div className="hist">
          <button className="ibtn" data-role="undo" title={undoTitle} aria-label={undoTitle} disabled={!h.canUndo} onClick={() => store.undo()}>
            <Icon.undo />
          </button>
          <button className="ibtn" data-role="redo" title={redoTitle} aria-label={redoTitle} disabled={!h.canRedo} onClick={() => store.redo()}>
            <Icon.redo />
          </button>
          <button className={`ibtn${historyOpen ? ' on' : ''}`} data-role="history-btn" aria-label="操作历史" aria-expanded={historyOpen} title="操作历史" onClick={onHistory}>
            <Icon.hist />
            <span className="desk-only">历史</span>
          </button>
        </div>
        <div className="desk-only" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Steps />
          <div className="vsep"></div>
          <Transport desk />
          <BpmControl />
          <button className={`tog${t.metronome ? ' on' : ''}`} title="节拍器（和伴奏同一时钟）" aria-pressed={t.metronome} onClick={() => transport.setMetronome(!t.metronome)}>
            <Icon.metro />
            节拍器
          </button>
          <button className={`tog${t.guide ? ' on' : ''}`} title="导唱：每个字「嗒」一声，按字的长度拉长，空白不出声" aria-pressed={t.guide} data-role="guide" onClick={() => transport.setGuide(!t.guide)}>
            <Icon.guide />
            导唱
          </button>
        </div>
        <div className="spacer"></div>
        <button className="btn ghost desk-only" data-role="open-projects" onClick={onProjects}>
          <Icon.folder />
          作品
        </button>
        <button className="btn desk-only" data-role="open-export" onClick={onProjects}>
          <Icon.out />
          导出
        </button>
        <button className="ibtn mob-only" aria-label="作品与导出" data-role="open-export-m" onClick={onProjects}>
          <Icon.out />
        </button>
      </header>
      <div className="bar2 mob-only">
        <Steps />
        <Transport desk={false} />
        <BpmControl compact />
      </div>
    </>
  );
}
