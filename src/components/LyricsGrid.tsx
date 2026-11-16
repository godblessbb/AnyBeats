import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { minCellWidth, playheadAt, SECTION_KIND_NAMES, SECTION_KINDS, TICKS_PER_BAR, TICKS_PER_BEAT, wordSize, type SectionKind } from '../core';
import type { EditorState } from '../engine/editorStore';
import { cellName, sheetView, type CellView, type RowView, type SegView, type WordView } from '../engine/view';
import { Icon } from './icons';
import { Menu, type MenuItem } from './Menu';
import { useEditor, useServices, useTransport } from './services';

type Css = CSSProperties & Record<`--${string}`, string | number | undefined>;

/** 字号表：按格宽现算（core/flow 的 wordSize，最小 11px） */
interface Sizing {
  cell: number;
  base: number;
}

function WordInput({ abs, initial }: { abs: number; initial: string }) {
  const { store } = useServices();
  const done = useRef(false);
  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };
  return (
    <input
      className="slot-input"
      data-role="word-input"
      defaultValue={initial}
      autoFocus
      aria-label="填字：一个位置一个字，多打的字依次填进后面的位置"
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          const v = e.currentTarget.value;
          finish(() => {
            store.commitText(abs, v);
            // 接着填下一个字
            const next = store.getState().cursor;
            if (v && next !== null && next !== abs) store.startEdit(next);
          });
        } else if (e.key === 'Escape') finish(() => store.cancelEdit());
      }}
      onBlur={(e) => {
        const v = e.currentTarget.value;
        finish(() => (v === initial ? store.cancelEdit() : store.commitText(abs, v)));
      }}
    />
  );
}

function segStyle(sg: SegView, c0: number): Css {
  const pct = (t: number) => ((t - c0) / TICKS_PER_BEAT) * 100;
  return {
    left: sg.first ? `calc(${pct(sg.s)}% - 1px)` : '0px',
    right: sg.last ? `calc(${100 - pct(sg.e)}% + 2px)` : '-1px',
    '--h': sg.hue ?? undefined,
  };
}

interface CellProps {
  cell: CellView;
  step: 1 | 2;
  sizing: Sizing;
  selected: boolean;
  anchor: boolean;
  cursor: number | null;
  editing: number | null;
  nowAbs: number | null;
  nowCell: boolean;
  band: number | null;
  holdTip: EditorState['holdTip'];
  selMode: EditorState['selMode'];
  invert: boolean;
}

const Cell = memo(function Cell(p: CellProps) {
  const { store } = useServices();
  const c = p.cell;
  const c0 = c.global * TICKS_PER_BAR + c.beat * TICKS_PER_BEAT;
  const [stretch, setStretch] = useState<{ abs: number; end: number } | null>(null);

  const cls = ['cell'];
  if (c.rule) cls.push('painted');
  if (c.lockedCell) cls.push('locked');
  if (p.selected) cls.push('sel-in');
  if (p.anchor) cls.push('anchor');
  if (p.nowCell) cls.push('now');
  if (p.holdTip?.key === c.key) cls.push('hold-hit');

  const tickAt = (e: { clientX: number }, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(el.clientWidth - 0.01, e.clientX - r.left - el.clientLeft));
    return Math.floor((x / el.clientWidth) * TICKS_PER_BEAT);
  };

  const onCellClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (p.step === 1) store.flowClick(c0 + tickAt(e, e.currentTarget));
    else store.clickCell(c.global, c.beat);
  };

  /** 拖字框右边缘：手指 / 鼠标停在哪一格的哪个位置，字就拖到那里（吸附到精度） */
  const startStretch = (w: WordView) => (e: RPointerEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const endAt = (ev: { clientX: number; clientY: number }) => {
      const under = document.elementsFromPoint(ev.clientX, ev.clientY).find((el) => (el as HTMLElement).dataset?.role === 'cell') as HTMLElement | undefined;
      if (!under) return null;
      const g = Number(under.dataset.bar) - 1;
      const beat = Number(under.dataset.beat);
      const r = under.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (ev.clientX - r.left - under.clientLeft) / under.clientWidth));
      return g * TICKS_PER_BAR + beat * TICKS_PER_BEAT + Math.round(frac * TICKS_PER_BEAT);
    };
    const target = e.currentTarget;
    const move = (ev: PointerEvent) => {
      const end = endAt(ev);
      if (end !== null) setStretch({ abs: w.abs, end });
    };
    const up = (ev: PointerEvent) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setStretch(null);
      const end = endAt(ev);
      if (end !== null && end > w.abs) store.stretchWord(w.abs, end);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  return (
    <div className={cls.join(' ')} data-role="cell" data-bar={c.global + 1} data-beat={c.beat} data-content={c.content} data-key={c.key} style={{ '--h': c.rule?.hue } as Css} onClick={onCellClick}>
      {[0, 1, 2, 3].map((k) => (
        <span key={k} className="tk" data-role="tick-line" style={{ left: `${k * 25}%` }}></span>
      ))}
      {p.band !== null && <span className="band" style={{ left: `${p.band * 25}%`, width: '25%' }}></span>}
      {c.cellLockIcon && (
        <span className="clock" data-role="lock-icon">
          <Icon.lock />
        </span>
      )}
      {c.words.length > 0 && c.mode === 't3' && (
        <span className="trip" data-role="triplet-mark">
          <b>3</b>
        </span>
      )}
      {c.words.length > 0 && c.mode === 't6' && (
        <>
          <span className="trip half" data-role="triplet-mark">
            <b>3</b>
          </span>
          <span className="trip half h2" data-role="triplet-mark">
            <b>3</b>
          </span>
        </>
      )}
      {c.words.map((w) => {
        const size = wordSize(w.box, p.sizing.cell, p.sizing.base);
        const k = ['slot', 'word'];
        if (w.text) k.push('filled');
        if (w.final) k.push('rp');
        if (size.dense) k.push('dense');
        else if (size.font < p.sizing.base) k.push('narrow');
        if (w.mismatch) k.push('miss');
        if (p.cursor === w.abs && p.editing !== w.abs) k.push('cursor');
        if (p.nowAbs === w.abs) k.push('now');
        return (
          <span
            key={w.id}
            className={k.join(' ')}
            data-role="slot"
            data-kind="word"
            data-tick={w.off}
            data-len={w.len}
            data-box={w.box}
            data-abs={w.abs}
            data-rhyme={w.final ?? undefined}
            data-mismatch={w.mismatch ? `${w.mismatch.got}≠${w.mismatch.want}` : undefined}
            data-locked={w.locked ? '1' : undefined}
            style={{ '--t': w.off, '--l': w.box, '--fs': `${size.font}px`, '--h': w.hue ?? undefined } as Css}
            onClick={(e) => {
              e.stopPropagation();
              if (p.step === 1) store.focusWord(w.abs);
              else {
                store.clickCell(c.global, c.beat);
                if (p.selMode === 'cell' && !p.invert) store.startEdit(w.abs);
                else store.focusWord(w.abs);
              }
            }}
          >
            {w.text ? (
              <span className="ch">{w.text}</span>
            ) : w.final ? (
              <span className="ph" data-role="placeholder">
                {w.final}
              </span>
            ) : null}
            {w.rhymeLocked && (
              <span className="slock" data-role="lock-icon">
                <Icon.lock />
              </span>
            )}
            {p.step === 1 && p.cursor === w.abs && <span className="grip" data-role="stretch-handle" title="往右拖：拉长这个字" onPointerDown={startStretch(w)} onClick={(e) => e.stopPropagation()}></span>}
            {p.editing === w.abs && <WordInput abs={w.abs} initial={w.text} />}
          </span>
        );
      })}
      {c.segs.map((sg) => (
        <span
          key={sg.wordId}
          className={`dl ${sg.tone}${sg.last ? ' end' : ''}`}
          data-role="drag-line"
          data-from={`${sg.fromBar + 1}:${sg.fromBeat}:${sg.fromOff}`}
          data-word={sg.wordId}
          data-s={sg.s}
          data-e={sg.e}
          style={segStyle(sg, c0)}
        ></span>
      ))}
      {stretch && stretch.end > c0 && (
        <span className="dl preview" style={{ left: '0px', right: `${Math.max(0, 100 - ((stretch.end - c0) / TICKS_PER_BEAT) * 100)}%` }}></span>
      )}
      {p.holdTip?.key === c.key && (
        <div className="hold-tip" role="status" data-role="hold-only-tip" onClick={(e) => e.stopPropagation()}>
          <b>这一拍只有拖音</b>
          <span>
            是{cellName(p.holdTip.fromBar, p.holdTip.fromBeat)}「{p.holdTip.text || '字'}」拖过来的。这一拍没有新字，不能涂色；字算在它起点那一格。
          </span>
        </div>
      )}
    </div>
  );
});

interface RowProps {
  row: RowView;
  state: EditorState;
  sizing: Sizing;
  nowAbs: number | null;
  nowKey: string | null;
  selected: Set<string>;
  rowOn: boolean;
}

const Row = memo(function Row({ row, state, sizing, nowAbs, nowKey, selected, rowOn }: RowProps) {
  const { store } = useServices();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const isNow = nowKey !== null && row.cells.some((c) => c.key === nowKey);
  useEffect(() => {
    if (isNow) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [isNow]);
  const items: MenuItem[] = [
    { label: '复制 flow 到下一小节', onClick: () => store.copyFlowToNext(row.global) },
    { label: '清空这一小节', onClick: () => store.clearBarFlow(row.global) },
    { label: '删除这一小节', danger: true, onClick: () => store.deleteBar(row.global) },
  ];
  const lab: React.ReactNode[] = row.tags.map((r) => (
    <span key={r.id} className="rtag" style={{ '--h': r.hue } as Css}>
      <i></i>
      {r.finals.join('·')}
    </span>
  ));
  const miss = row.cells.flatMap((c) => c.words.filter((w) => w.mismatch));
  if (miss.length) {
    lab.unshift(
      <span key="miss" className="miss-tag" data-role="mismatch">
        「{miss[0].text}」{miss[0].mismatch!.got} ≠ {miss[0].mismatch!.want}
      </span>,
    );
  }
  return (
    <div className="row" data-role="row" data-bar={row.global + 1} ref={ref}>
      <div
        className={`rh${rowOn ? ' on' : ''}`}
        data-role="row-head"
        data-bar={row.global + 1}
        role="button"
        tabIndex={-1}
        title="点：选中整行；右键：复制 flow / 清空 / 删除"
        onClick={() => store.selectRow(row.global)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <b>{String(row.global + 1).padStart(2, '0')}</b>
        {row.barLocked && (
          <span data-role="lock-icon">
            <Icon.lock />
          </span>
        )}
      </div>
      {row.cells.map((c) => (
        <Cell
          key={c.key}
          cell={c}
          step={state.step}
          sizing={sizing}
          selected={selected.has(c.key)}
          anchor={!!state.anchor && state.anchor.bar === c.global && state.anchor.beat === c.beat}
          cursor={state.cursor !== null && Math.floor(state.cursor / TICKS_PER_BEAT) === Math.floor((c.global * TICKS_PER_BAR + c.beat * TICKS_PER_BEAT) / TICKS_PER_BEAT) ? state.cursor : null}
          editing={state.editing}
          nowAbs={nowAbs}
          nowCell={nowKey === c.key}
          band={state.band && state.band.beat === c.beat ? state.band.sub : null}
          holdTip={state.holdTip}
          selMode={state.selMode}
          invert={state.invert}
        />
      ))}
      <div className="lab">{lab}</div>
      {menu && <Menu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  );
});

function SectionHeader({ index, label, kind, bars }: { index: number; label: string; kind: SectionKind; bars: number }) {
  const { store } = useServices();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const items: MenuItem[] = [
    ...SECTION_KINDS.filter((k) => k !== kind).map((k) => ({ label: `改成 ${SECTION_KIND_NAMES[k]}`, onClick: () => store.setSectionKind(index, k), small: true })),
    { label: '复制这一段', onClick: () => store.duplicateSection(index) },
    { label: '末尾加一小节', onClick: () => store.addBar(index) },
    { label: '删除这一段', danger: true, onClick: () => store.deleteSection(index) },
  ];
  return (
    <div className="sec-h" data-role="section-header">
      <b data-role="section-label" data-contrast>
        {label}
      </b>
      <span>{bars} 小节</span>
      <button
        className="ibtn"
        aria-label={`${label} 段落菜单`}
        title="段落菜单：改类型 / 复制 / 加小节 / 删除"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.right - 180, y: r.bottom + 2 });
        }}
      >
        <Icon.more />
      </button>
      {menu && <Menu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** 量出一拍的格宽；格子窄于最小字宽要求时整张表左右滑（每拍至少 minCell px） */
function useSizing(sheet: React.RefObject<HTMLDivElement | null>, minCell: number): { sizing: Sizing; scroll: boolean; minWidth: number | undefined } {
  const [m, setM] = useState({ natural: 0, rh: 66, lab: 150, base: 19 });
  useLayoutEffect(() => {
    const el = sheet.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const hs = getComputedStyle(host);
      const rh = parseFloat(cs.getPropertyValue('--rh')) || 0;
      const lab = parseFloat(cs.getPropertyValue('--lab')) || 0;
      const base = parseFloat(cs.getPropertyValue('--ch')) || 19;
      const avail = host.clientWidth - parseFloat(hs.paddingLeft) - parseFloat(hs.paddingRight) - 2;
      const natural = (avail - rh - lab) / 4;
      setM((old) => (old.natural === natural && old.rh === rh && old.lab === lab && old.base === base ? old : { natural, rh, lab, base }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [sheet]);
  // minCell 是格子里面的宽度（core/flow 的 minCellWidth）；每格右边还有 1px 格线
  const inner = m.natural - 1;
  const scroll = m.natural > 0 && inner < minCell;
  const cell = scroll ? minCell : inner;
  return { sizing: { cell: Math.max(1, cell), base: m.base }, scroll, minWidth: scroll ? m.rh + 4 * (minCell + 1) + m.lab + 2 : undefined };
}

export function LyricsGrid() {
  const { store } = useServices();
  const s = useEditor();
  const t = useTransport();
  const view = useMemo(() => sheetView(s.doc), [s.doc]);
  const minCell = useMemo(() => minCellWidth(s.doc.grid), [s.doc.grid]);
  const sheetRef = useRef<HTMLDivElement>(null);
  const { sizing, scroll, minWidth } = useSizing(sheetRef, minCell);
  const head = playheadAt(s.doc.grid, t.position);
  const nowAbs = head?.word ? (view.rows[head.global]?.cells.flatMap((c) => c.words).find((w) => w.id === head.word!.id)?.abs ?? null) : null;
  const nowKey = head ? (view.rows[head.global]?.cells[head.beat]?.key ?? null) : null;
  const selected = useMemo(() => new Set(s.selection), [s.selection]);
  const rowOn = (r: RowView) => r.cells.every((c) => selected.has(c.key));
  const locks = s.doc.locks;

  return (
    <div
      className={`sheet${scroll ? ' scroll' : ''}`}
      data-role="lyrics-sheet"
      data-step={s.step}
      ref={sheetRef}
      style={{ '--cell-min': scroll ? `${minCell + 1}px` : '0px', minWidth } as Css}
    >
      <div className="sh-head">
        <div className="corner">小节 \ 拍</div>
        {[0, 1, 2, 3].map((bi) => (
          <div key={bi} className="colh" data-role="beat-head" data-beat={bi}>
            <button className="bn" aria-label={`选中第 ${bi + 1} 拍整列`} onClick={() => store.selectColumn(bi)}>
              {bi + 1}
              {locks.beats.includes(bi) && (
                <span data-role="lock-icon">
                  <Icon.lock />
                </span>
              )}
            </button>
            <div className="subs">
              {[0, 1, 2, 3].map((k) => (
                <button
                  key={k}
                  className={`sub${s.band && s.band.beat === bi && s.band.sub === k ? ' on' : ''}`}
                  data-role="sub-tick"
                  data-sub={k}
                  aria-label={`第 ${bi + 1} 拍第 ${k + 1} 个 16 分（整首这一列）`}
                  onClick={() => store.setBand({ beat: bi, sub: k })}
                ></button>
              ))}
            </div>
          </div>
        ))}
        <div className="lab-h">韵脚</div>
      </div>
      {view.sections.map((sec) => (
        <div className="sec" key={sec.id} data-role="section">
          <SectionHeader index={sec.index} label={sec.label} kind={sec.kind} bars={sec.rows.length} />
          {sec.rows.map((row) => (
            <Row key={row.barId} row={row} state={s} sizing={sizing} nowAbs={nowAbs} nowKey={nowKey} selected={selected} rowOn={rowOn(row)} />
          ))}
        </div>
      ))}
      <div className="add-row">
        <button className="btn sm" data-role="add-bar" onClick={() => store.addBar()}>
          <Icon.plus />
          小节
        </button>
        <button className="btn sm" data-role="add-section" onClick={() => store.addSection('verse')}>
          <Icon.plus />
          段落
        </button>
      </div>
    </div>
  );
}
