import { Fragment, memo, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { insertBars, playheadAt, SECTION_KIND_NAMES, STEPS_PER_BAR, type Bar, type Grid, type LineEndRhyme, type SectionKind } from '../core';
import type { AiPreview } from '../engine/editorStore';
import { barSlots, finalLabel, lastCharStep, previewRhymes, rhymeClass, rhymeView, type SectionRhymeStat } from '../engine/view';
import { Icon } from './icons';
import { Menu, type MenuItem } from './Menu';
import { useEditor, useServices, useTransport } from './services';

export const DRAG_SLOT = 'application/x-anybeats-slot';
export const DRAG_BAR = 'application/x-anybeats-bar';
export const DRAG_WORD = 'application/x-anybeats-word';

function SlotEditor({ initial, onCommit, onCancel }: { initial: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const done = useRef(false);
  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };
  return (
    <input
      className="slot-input"
      data-role="slot-input"
      defaultValue={initial}
      autoFocus
      aria-label="输入歌词：一格一个字，- 延音，_ 空拍"
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          const v = e.currentTarget.value;
          finish(() => onCommit(v));
        } else if (e.key === 'Escape') {
          finish(onCancel);
        }
      }}
      onBlur={(e) => {
        const v = e.currentTarget.value;
        finish(() => (v === initial ? onCancel() : onCommit(v)));
      }}
    />
  );
}

interface RowProps {
  bar: Bar;
  section: number;
  index: number;
  global: number;
  rhyme: LineEndRhyme | null;
  /** 正在播放的格（只有当前行有） */
  nowStep: number | null;
  /** 选区落在这一行的部分（小节内格号），没有为 null */
  selFrom: number | null;
  selTo: number | null;
  focusStep: number | null;
  editingStep: number | null;
  ghost?: boolean;
  folded?: boolean;
  label?: string;
}

const BarRow = memo(function BarRow(p: RowProps) {
  const { store } = useServices();
  const ref = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const slots = barSlots(p.bar);
  const last = lastCharStep(p.bar);
  const base = p.global * STEPS_PER_BAR;
  const isCur = p.nowStep !== null;

  useEffect(() => {
    if (isCur || p.ghost) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [isCur, p.ghost]);

  const onDragOverRow = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_BAR)) e.preventDefault();
  };
  const onDropRow = (e: DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_BAR);
    if (!raw) return;
    e.preventDefault();
    const from = JSON.parse(raw) as { section: number; bar: number };
    store.moveBarTo(from, { section: p.section, bar: p.index });
  };

  const menuItems: MenuItem[] = [
    { label: '在下面插入一小节', onClick: () => store.exec('插入小节', (g) => insertAfter(g, p.section, p.index)) },
    { label: '清空这一小节', onClick: () => store.clearSlots(base, base + STEPS_PER_BAR - 1) },
    { label: '删除这一小节', danger: true, onClick: () => store.deleteBar(p.section, p.index) },
  ];

  const cls = ['row'];
  if (isCur) cls.push('cur');
  if (p.ghost) cls.push('ghost-row');
  if (p.folded) cls.push('fold-m');
  if (p.selFrom !== null) cls.push('sel-row');

  return (
    <div className={cls.join(' ')} ref={ref} data-bar={p.global + 1} onDragOver={onDragOverRow} onDrop={onDropRow}>
      <div
        className="bar"
        onContextMenu={(e) => {
          if (p.ghost) return;
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <span
          className="grip"
          title="拖动重排小节；右键小节号：插入 / 清空 / 删除"
          draggable={!p.ghost}
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_BAR, JSON.stringify({ section: p.section, bar: p.index }));
            e.dataTransfer.effectAllowed = 'move';
          }}
        ></span>
        {p.label ?? String(p.global + 1).padStart(2, '0')}
      </div>
      {slots.map((s) => {
        const abs = base + s.step;
        const k = ['slot'];
        if (s.step % 4 === 0) k.push('b0');
        if (s.step === 0) k.push('m');
        if (s.kind === 'sus') k.push('sus');
        if (s.kind === 'rest') k.push('rest');
        if (s.accent) k.push('acc');
        if (s.step === last && p.rhyme?.syllable && p.rhyme.color !== null) k.push('rh', rhymeClass(p.rhyme.color));
        if (isCur && p.nowStep === s.step) k.push('now');
        if (isCur && p.nowStep !== null && s.step < p.nowStep) k.push('sung');
        if (p.ghost) k.push('ghost');
        if (p.selFrom !== null && p.selTo !== null && s.step >= p.selFrom && s.step <= p.selTo) k.push('picked');
        if (p.focusStep === s.step) k.push('focus');
        const editing = p.editingStep === s.step;
        const text = s.kind === 'rest' ? '∅' : s.text;
        const hasClip = s.clipId !== null && !p.ghost;
        return (
          <div
            key={s.step}
            className={k.join(' ')}
            data-abs={abs}
            onClick={(e) => {
              if (p.ghost) return;
              if (e.shiftKey) store.select(abs, true);
              else store.gesture({ type: 'click', target: { id: String(abs), hasText: s.kind === 'char' } });
            }}
            onDoubleClick={() => {
              if (p.ghost) return;
              store.gesture({ type: 'dblclick', target: { id: String(abs), hasText: s.kind === 'char' || store.slotHasText(abs) } });
            }}
            draggable={hasClip && !editing}
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_SLOT, String(abs));
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              if (p.ghost) return;
              if (e.dataTransfer.types.includes(DRAG_SLOT) || e.dataTransfer.types.includes(DRAG_WORD)) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            onDrop={(e) => {
              if (p.ghost) return;
              const fromSlot = e.dataTransfer.getData(DRAG_SLOT);
              const word = e.dataTransfer.getData(DRAG_WORD);
              if (!fromSlot && !word) return;
              e.preventDefault();
              e.stopPropagation();
              if (fromSlot) store.moveSlot(Number(fromSlot), abs);
              else store.writeText(abs, word);
            }}
          >
            {text && <span className="ch">{text}</span>}
            {editing && (
              <SlotEditor
                initial={s.kind === 'char' ? s.text : ''}
                onCommit={(v) => store.commitEdit(v)}
                onCancel={() => store.cancelEdit()}
              />
            )}
          </div>
        );
      })}
      <div className="end">
        {p.rhyme?.syllable && (
          <span className={`chip ${p.rhyme.color === null ? 'plain' : rhymeClass(p.rhyme.color)}`} title={p.rhyme.color === null ? '这一韵在全曲只出现一次' : '句尾韵母'}>
            {finalLabel(p.rhyme.syllable.final)}
          </span>
        )}
      </div>
      {menu && <Menu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  );
});

function insertAfter(g: Grid, section: number, bar: number): Grid {
  return insertBars(g, section, bar + 1, 1);
}

function SectionHeader({
  index,
  label,
  kind,
  bars,
  stats,
  folded,
  onExpand,
}: {
  index: number;
  label: string;
  kind: SectionKind;
  bars: number;
  stats: SectionRhymeStat[];
  folded: boolean;
  onExpand: () => void;
}) {
  const { store } = useServices();
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const items: MenuItem[] = [
    { label: '重命名', onClick: () => setRenaming(true) },
    { label: '复制段落', onClick: () => store.duplicateSection(index) },
    { label: '添加小节', onClick: () => store.addBar(index) },
    ...(Object.keys(SECTION_KIND_NAMES) as SectionKind[])
      .filter((k) => k !== kind)
      .map((k) => ({ label: `改成「${SECTION_KIND_NAMES[k]}」`, onClick: () => store.setSectionKind(index, k), small: true })),
    { label: '删除段落', danger: true, onClick: () => store.deleteSection(index) },
  ];
  return (
    <div className={`sec-h${folded ? ' fold-m' : ''}`} data-role="section-header" onClick={folded ? onExpand : undefined}>
      {renaming ? (
        <input
          className="sec-input"
          defaultValue={label}
          autoFocus
          aria-label="段落名"
          onBlur={(e) => {
            store.renameSection(index, e.currentTarget.value);
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur();
            if (e.key === 'Escape') setRenaming(false);
          }}
        />
      ) : (
        <b onDoubleClick={() => setRenaming(true)} title="双击改名">
          {label}
        </b>
      )}
      <span>{bars} 小节</span>
      {stats.map((st) => (
        <span key={st.color} className={`chip ${rhymeClass(st.color)}`}>
          {finalLabel(st.final)} ×{st.count}
        </span>
      ))}
      <span className="fold-tag">已折叠 · 点开</span>
      <button
        className="ibtn add"
        title="段落菜单：重命名 / 复制段落 / 删除"
        aria-label="段落菜单"
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.right - 160, y: r.bottom + 2 });
        }}
      >
        <Icon.more />
      </button>
      {menu && <Menu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** 预览行怎么摆：fill 模式下先占掉后面的空小节，不够再在后面加虚线行 */
function previewLayout(preview: AiPreview | null, section: number, bars: Bar[]) {
  const inPlace = new Map<number, number>();
  const extra: number[] = [];
  if (!preview || preview.section !== section) return { inPlace, extra, after: -1 };
  if (preview.mode === 'replace') {
    inPlace.set(preview.at, 0);
    return { inPlace, extra, after: -1 };
  }
  let at = preview.at;
  preview.bars.forEach((_, i) => {
    if (at < bars.length && bars[at].clips.length === 0) {
      inPlace.set(at, i);
      at += 1;
    } else extra.push(i);
  });
  return { inPlace, extra, after: at - 1 };
}

export function LyricsGrid({ foldInactive }: { foldInactive: boolean }) {
  const { store } = useServices();
  const s = useEditor();
  const t = useTransport();
  const grid = s.grid;
  const rhyme = useMemo(() => rhymeView(grid), [grid]);
  const preview = s.preview;
  const ghostRhyme = useMemo(() => (preview ? previewRhymes(grid, preview.lines) : []), [grid, preview]);
  const head = playheadAt(grid, t.position);
  const sel = s.selection;
  const selLo = sel ? Math.min(sel.anchor, sel.focus) : -1;
  const selHi = sel ? Math.max(sel.anchor, sel.focus) : -1;
  const editingAbs = s.gesture.editing === null ? null : Number(s.gesture.editing);
  const [expanded, setExpanded] = useState<number | null>(null);

  // 手机抽屉拉高时，只展开焦点段落（选中格 / 播放位置 / AI 预览所在的段落）
  const focusSection =
    expanded ?? s.preview?.section ?? head?.section ?? (sel ? (playheadAt(grid, sel.focus)?.section ?? null) : null) ?? grid.sections.length - 1;

  let global = 0;
  let ghostNo = 0;
  return (
    <div className="lyrics-grid" data-role="lyrics-grid">
      {grid.sections.map((sec, si) => {
        const folded = foldInactive && si !== focusSection;
        const layout = previewLayout(s.preview, si, sec.bars);
        const startGlobal = global;
        global += sec.bars.length;
        const rows = sec.bars.map((bar, bi) => {
          const g = startGlobal + bi;
          const lo = g * STEPS_PER_BAR;
          const hi = lo + STEPS_PER_BAR - 1;
          const ghostIdx = layout.inPlace.get(bi);
          const selFrom = sel && selHi >= lo && selLo <= hi ? Math.max(selLo, lo) - lo : null;
          const selTo = sel && selHi >= lo && selLo <= hi ? Math.min(selHi, hi) - lo : null;
          const row = (
            <BarRow
              key={bar.id}
              bar={ghostIdx !== undefined ? s.preview!.bars[ghostIdx] : bar}
              ghost={ghostIdx !== undefined}
              section={si}
              index={bi}
              global={g}
              rhyme={ghostIdx !== undefined ? ghostRhyme[ghostIdx] : rhyme.lines[g]}
              nowStep={head && head.absStep >= lo && head.absStep <= hi ? head.step : null}
              selFrom={selFrom}
              selTo={selTo}
              focusStep={sel && sel.focus >= lo && sel.focus <= hi ? sel.focus - lo : null}
              editingStep={editingAbs !== null && editingAbs >= lo && editingAbs <= hi ? editingAbs - lo : null}
              folded={folded}
            />
          );
          if (layout.extra.length && bi === layout.after) {
            return (
              <Fragment key={bar.id}>
                {row}
                {layout.extra.map((i) => (
                  <BarRow
                    key={`ghost-${i}`}
                    bar={s.preview!.bars[i]}
                    ghost
                    section={si}
                    index={bi}
                    global={startGlobal + sec.bars.length + ghostNo++}
                    rhyme={ghostRhyme[i] ?? null}
                    nowStep={null}
                    selFrom={null}
                    selTo={null}
                    focusStep={null}
                    editingStep={null}
                  />
                ))}
              </Fragment>
            );
          }
          return row;
        });
        return (
          <Fragment key={sec.id}>
            <SectionHeader
              index={si}
              label={sec.label}
              kind={sec.kind}
              bars={sec.bars.length}
              stats={rhyme.sections[si]}
              folded={folded}
              onExpand={() => setExpanded(si)}
            />
            {rows}
            {layout.extra.length > 0 && layout.after === -1 &&
              layout.extra.map((i) => (
                <BarRow
                  key={`ghost-${i}`}
                  bar={s.preview!.bars[i]}
                  ghost
                  section={si}
                  index={0}
                  global={startGlobal + sec.bars.length + ghostNo++}
                  rhyme={ghostRhyme[i] ?? null}
                  nowStep={null}
                  selFrom={null}
                  selTo={null}
                  focusStep={null}
                  editingStep={null}
                />
              ))}
          </Fragment>
        );
      })}
      <div className="add-bar">
        <button className="btn sm" data-role="add-bar" onClick={() => store.addBar(sel ? (playheadAt(grid, sel.focus)?.section ?? undefined) : undefined)}>
          <Icon.plus />
          小节
        </button>
        <button className="btn sm" data-role="add-section" onClick={() => store.addSection()}>
          <Icon.plus />
          段落
        </button>
      </div>
    </div>
  );
}
