import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import {
  MAX_BEAT_CHARS,
  MIN_SQUARE_TICKS,
  minCellWidth,
  playheadAt,
  precisionUnit,
  SECTION_KIND_NAMES,
  SECTION_KINDS,
  squareName,
  TICKS_PER_BAR,
  TICKS_PER_BEAT,
  totalTicks,
  wordSize,
  type SectionKind,
} from '../core';
import type { EditorState } from '../engine/editorStore';
import { cellName, sheetView, type CellView, type RowView, type TintView, type WordView } from '../engine/view';
import { Icon } from './icons';
import { Menu, type MenuItem } from './Menu';
import { useEditor, useServices, useTransport } from './services';

type Css = CSSProperties & Record<`--${string}`, string | number | undefined>;

/** 字号表：按格宽现算（core/flow 的 wordSize，最小 11px） */
interface Sizing {
  cell: number;
  base: number;
}

/** 正在拖字的长度：字的起点、拖到的（吸附后的）结束位置，指针在哪（显示小提示） */
interface Stretch {
  abs: number;
  end: number;
  x: number;
  y: number;
}

/** 拖长度的入口：格子里的把手按下时调用（放在 context 里，行组件不用跟着重画） */
const StretchCtx = createContext<(w: WordView, e: RPointerEvent<HTMLSpanElement>) => void>(() => {});

const SPLIT_NAMES = ['1/4', '1/8', '三连', '1/16'];

/** 双击格子：整格变成输入框，改这一拍的字；下面实时说明回车后怎么排 */
function CellEditor({ global, beat, initial }: { global: number; beat: number; initial: string }) {
  const { store } = useServices();
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };
  const plan = store.beatTextPlan(global, beat, value);
  let hint: React.ReactNode;
  let warn = false;
  if (plan.how === 'clear') hint = <b>清空这一拍的字（位置保留）</b>;
  else if (plan.how === 'fill')
    hint = (
      <>
        <b>
          {plan.n} 个字 · 按这一拍原来的 {plan.slots} 个位置依次填
        </b>
        <span className="k">节奏不变{plan.slots > plan.n ? `；后面 ${plan.slots - plan.n} 个位置清空` : ''}。</span>
      </>
    );
  else if (plan.how === 'split')
    hint = (
      <>
        <b>
          {plan.n} 个字 → 这一拍平分 {plan.n} 份（{SPLIT_NAMES[plan.n - 1]}）
        </b>
        {plan.slots > 0 && <span className="k">原来只有 {plan.slots} 个位置，放不下；回车后这一拍改成平分，原来的节奏不保留。</span>}
      </>
    );
  else if (plan.how === 'too-many') {
    warn = true;
    hint = (
      <>
        <b className="warn">一拍最多 {MAX_BEAT_CHARS} 个字（现在 {plan.n} 个）</b>
        <span className="k">要更密的节奏，先到「① 铺 flow」把这一拍分细；现在回车什么都不写。</span>
      </>
    );
  } else {
    warn = true;
    hint = (
      <>
        <b className="warn">这一拍有锁住的字，不能重新分</b>
        <span className="k">先解锁，或者只打 {plan.slots} 个字以内。</span>
      </>
    );
  }
  return (
    <div className="cell-edit" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <input
        className="cell-input"
        data-role="cell-editor"
        value={value}
        autoFocus
        aria-label={`改${cellName(global, beat)}的字：打几个字这一拍就排几个字，最多 ${MAX_BEAT_CHARS} 个`}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            const v = e.currentTarget.value;
            finish(() => store.commitBeatText(global, beat, v));
          } else if (e.key === 'Escape') finish(() => store.cancelEdit());
        }}
        onBlur={(e) => {
          const v = e.currentTarget.value;
          finish(() => (v === initial ? store.cancelEdit() : store.commitBeatText(global, beat, v)));
        }}
      />
      <div className={`edit-tip${warn ? ' bad' : ''}`} data-role="edit-tip" role="status">
        {hint}
        <span className="k">
          只改{cellName(global, beat)}，<b>下一拍不动</b>。<span className="kbd">Enter</span> 确定（算一步，可撤销）· <span className="kbd">Esc</span> 取消
        </span>
      </div>
    </div>
  );
}

type FlowFocus = NonNullable<EditorState['flowEdit']>;

const canSplit = (box: number, n: number) => Number.isInteger(box / n) && box / n >= MIN_SQUARE_TICKS;

/**
 * 第 1 步改方格：一个看不见的输入框贴在光标方格上（真焦点，输入法才能用），下面一个按键气泡。
 * 空格一分二（0.4 秒内两下 = 空音）、Shift+空格三连、⌫ 清字 / 合并、Tab / 方向键换格、Enter / Esc 退出；
 * 输入法正在拼字时（isComposing / keyCode 229）这些键一概不接，交给输入法。规则见 design/DESIGN_v32.md 第 3 节。
 */
function SquareEditor({ focus, global, beat, box, text }: { focus: FlowFocus; global: number; beat: number; box: number; text: string }) {
  const { store } = useServices();
  const input = useRef<HTMLInputElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const rest = focus.rest !== null;
  const off = focus.abs % TICKS_PER_BEAT;
  const len = rest ? focus.rest! : box;
  // 每次光标落到（或重新点到）一个方格都把焦点放回输入框
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, [focus]);
  // 桌面上气泡放在方格下面，下面放不下就翻到上面（手机上 CSS 固定在底部）
  useLayoutEffect(() => {
    const el = tip.current;
    if (!el) return;
    el.classList.remove('up');
    if (window.innerWidth > 600 && el.getBoundingClientRect().bottom > window.innerHeight - 8) el.classList.add('up');
  }, [focus]);
  const take = (el: HTMLInputElement) => {
    const v = el.value;
    el.value = '';
    if (v) store.typeSquare(v);
  };
  const keep = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();
  const act = (label: string, keys: React.ReactNode, name: string, disabled: boolean, run: () => void) => (
    <button className="act" data-role="square-action" data-act={name} disabled={disabled} onPointerDown={keep} onMouseDown={keep} onClick={run}>
      <b>{label}</b>
      <span>{keys}</span>
    </button>
  );
  return (
    <>
      <input
        ref={input}
        className="sq-input"
        data-role="square-input"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        aria-label={`${cellName(global, beat)}${rest ? '的空音' : `的 ${squareName(box)} 方格`}：打字写进这一格；空格一分二，Shift+空格三连，两下空格变空音，退格合并`}
        style={{ '--t': off, '--l': len } as Css}
        onKeyDown={(e) => {
          const ne = e.nativeEvent;
          e.stopPropagation();
          if (ne.isComposing || ne.keyCode === 229 || composing.current) return;
          const k = e.key;
          const stop = () => e.preventDefault();
          if (e.metaKey || e.ctrlKey) {
            const low = k.toLowerCase();
            if (low === 'z') {
              stop();
              if (e.shiftKey) store.redo();
              else store.undo();
            } else if (low === 'y') {
              stop();
              store.redo();
            }
            return;
          }
          if (k === ' ' || k === 'Spacebar') {
            stop();
            if (e.shiftKey) store.splitFocus(3);
            else store.spaceKey(ne.timeStamp);
            return;
          }
          if (k === 'Shift') return;
          store.resetSpace();
          if (k === 'Backspace' || k === 'Delete') {
            stop();
            store.backspaceSquare();
          } else if (k === 'Tab' || k === 'ArrowRight' || k === 'ArrowLeft') {
            stop();
            store.moveSquare(k === 'ArrowLeft' || (k === 'Tab' && e.shiftKey) ? -1 : 1);
          } else if (k === 'Enter' || k === 'Escape') {
            stop();
            store.endFlowEdit();
          } else if (k === '-' || k === '=') {
            stop();
            store.extendCursor(k === '-' ? 1 : -1);
          }
        }}
        onCompositionStart={() => {
          composing.current = true;
          store.resetSpace();
        }}
        onCompositionEnd={(e) => {
          composing.current = false;
          take(e.currentTarget);
        }}
        onChange={(e) => {
          if (composing.current || (e.nativeEvent as InputEvent).isComposing) return;
          take(e.currentTarget);
        }}
        onBlur={() => {
          // 点到别处（不是另一个方格的输入框、不是气泡按钮）就退出改字
          setTimeout(() => {
            if ((document.activeElement as HTMLElement | null)?.dataset?.role !== 'square-input') store.endFlowEdit();
          }, 0);
        }}
      />
      <div ref={tip} className="sq-tip" data-role="square-tip" role="status" onClick={(e) => e.stopPropagation()} onPointerDown={keep}>
        {rest ? (
          <>
            <b>{cellName(global, beat)} · 空音</b>
            <span className="k">这里不唱。在这里打字 = 放回一个方格并写上字{len < TICKS_PER_BEAT ? '；按退格和旁边那一半合并' : ''}。</span>
          </>
        ) : (
          <>
            <b>
              {cellName(global, beat)} · {squareName(box)} 方格
            </b>
            <span className="k">打字写进这一格（一格一个字，再打一个就替换）{text ? `；分开后「${text}」留在左边` : ''}</span>
          </>
        )}
        <div className="acts">
          {act('一分二', <span className="kbd">空格</span>, 'split', rest || !canSplit(box, 2), () => store.splitFocus(2))}
          {act('三连', <><span className="kbd">Shift</span><span className="kbd">空格</span></>, 'triplet', rest || !canSplit(box, 3), () => store.splitFocus(3))}
          {act('空音', <><span className="kbd">空格</span>×2</>, 'rest', rest, () => store.restFocus())}
          {act('合并', <span className="kbd">退格</span>, 'merge', len >= TICKS_PER_BEAT || (!rest && !!text), () => store.backspaceSquare())}
        </div>
        <span className="k">
          <span className="kbd">Tab</span> 下一格 · <span className="kbd">Enter</span> / <span className="kbd">Esc</span> 结束 · <span className="kbd">Ctrl</span>+<span className="kbd">Z</span> 撤销（每一下都算一步）
        </span>
      </div>
    </>
  );
}

/** 第 1 步的三连标记：整拍三连（落点只在 0 / 16 / 32）标整拍；有 8 / 16（前半）、32 / 40（后半）落点的半拍标那半拍 */
function flowTriplets(offs: number[]): { full: boolean; h1: boolean; h2: boolean } {
  const full = offs.some((o) => o === 16 || o === 32) && offs.every((o) => o === 0 || o === 16 || o === 32);
  if (full) return { full, h1: false, h2: false };
  return { full, h1: offs.some((o) => o === 8 || o === 16), h2: offs.some((o) => o === 32 || o === 40) };
}

/** 一段拖音浅底在这一格里的位置（左右各留 1px 缝；接着下一格的那头盖住格线） */
function tintStyle(s: number, e: number, head: boolean, tail: boolean, c0: number): Css {
  const pct = (t: number) => ((t - c0) / TICKS_PER_BEAT) * 100;
  return {
    left: head ? `calc(${pct(s)}% + 1px)` : '-1px',
    right: tail ? `calc(${100 - pct(e)}% + 1px)` : '-1px',
  };
}

interface CellProps {
  cell: CellView;
  step: 1 | 2;
  sizing: Sizing;
  selected: boolean;
  /** 只选了这一格（触屏上这时才显示改长度的把手） */
  solo: boolean;
  cursor: number | null;
  editing: boolean;
  nowAbs: number | null;
  nowCell: boolean;
  holdTip: EditorState['holdTip'];
  /** 正在拖长度的字（预览经过这一格时画出来） */
  stretch: Stretch | null;
  /** 第 1 步光标在这一格里的方格 / 空音 */
  flowFocus: FlowFocus | null;
}

const Cell = memo(function Cell(p: CellProps) {
  const { store } = useServices();
  const beginStretch = useContext(StretchCtx);
  const c = p.cell;
  const c0 = c.global * TICKS_PER_BAR + c.beat * TICKS_PER_BEAT;

  const cls = ['cell'];
  if (c.rule) cls.push('painted');
  if (c.lockedCell) cls.push('locked');
  if (p.selected) cls.push('sel');
  if (p.solo) cls.push('solo');
  if (p.nowCell) cls.push('now');
  if (p.editing || p.flowFocus) cls.push('editing');
  if (p.holdTip?.key === c.key) cls.push('hold-hit');

  const tickAt = (e: { clientX: number }, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(el.clientWidth - 0.01, e.clientX - r.left - el.clientLeft));
    return Math.floor((x / el.clientWidth) * TICKS_PER_BEAT);
  };

  const onCellClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (p.step === 1) store.flowPick(c0 + tickAt(e, e.currentTarget));
    else store.clickCell(c.global, c.beat);
  };
  const ff = p.flowFocus;
  const flow = p.step === 1;
  const trips = flow ? flowTriplets(c.words.map((w) => w.off)) : null;
  const sqBox = (w: WordView) => Math.min(w.len, TICKS_PER_BEAT - w.off);
  const focusWord = ff && ff.rest === null ? c.words.find((w) => w.abs === ff.abs) : undefined;

  // 把手：放在字结束的地方（字没拖长 = 字的右边；拖长了 = 浅底最后一段的右边）
  const grip = (w: WordView) => (
    <span
      className="grip"
      data-role="hold-grip"
      data-word={w.id}
      title="左右拖：改这个字的长度（吸附到第 1 步选的精度）"
      onPointerDown={(e) => beginStretch(w, e)}
    ></span>
  );
  const wordById = (id: string) => c.words.find((w) => w.id === id);

  const stretch = p.stretch;
  const pv = stretch && stretch.abs < c0 + TICKS_PER_BEAT && stretch.end > c0 ? { s: Math.max(stretch.abs, c0), e: Math.min(stretch.end, c0 + TICKS_PER_BEAT) } : null;

  return (
    <div
      className={cls.join(' ')}
      data-role="cell"
      data-bar={c.global + 1}
      data-beat={c.beat}
      data-content={c.content}
      data-key={c.key}
      data-selected={p.selected ? '1' : undefined}
      style={{ '--h': c.rule?.hue } as Css}
      onClick={onCellClick}
      onDoubleClick={() => {
        if (p.step === 2) store.editCell(c.global, c.beat);
      }}
    >
      {[0, 1, 2, 3].map((k) => (
        <span key={k} className="tk" data-role="tick-line" style={{ left: `${k * 25}%` }}></span>
      ))}
      {c.cellLockIcon && (
        <span className="clock" data-role="lock-icon">
          <Icon.lock />
        </span>
      )}
      {flow && trips!.full && (
        <span className="trip" data-role="triplet-mark">
          <b>3</b>
        </span>
      )}
      {flow &&
        (['h1', 'h2'] as const).map(
          (h) =>
            trips![h] && (
              <span key={h} className={`trip half${h === 'h2' ? ' h2' : ''}`} data-role="triplet-mark">
                <b>3</b>
              </span>
            ),
        )}
      {!flow && c.words.length > 0 && c.mode === 't3' && (
        <span className="trip" data-role="triplet-mark">
          <b>3</b>
        </span>
      )}
      {!flow && c.words.length > 0 && c.mode === 't6' && (
        <>
          <span className="trip half" data-role="triplet-mark">
            <b>3</b>
          </span>
          <span className="trip half h2" data-role="triplet-mark">
            <b>3</b>
          </span>
        </>
      )}
      {c.tints.map((t: TintView) => (
        <span
          key={t.wordId}
          className={`tint ${t.tone}${t.head ? '' : ' cont'}${t.tail ? '' : ' more'}${p.cursor === t.s && t.head ? ' cur' : ''}`}
          data-role="hold-tint"
          data-word={t.wordId}
          data-from={`${t.fromBar + 1}:${t.fromBeat}:${t.fromOff}`}
          data-s={t.s}
          data-e={t.e}
          style={{ ...tintStyle(t.s, t.e, t.head, t.tail, c0), '--h': t.hue ?? undefined } as Css}
        >
          {t.tail && grip(wordById(t.wordId) ?? holdWord(t))}
        </span>
      ))}
      {flow &&
        c.words.map((w) => {
          const box = sqBox(w);
          const k = ['sq', w.text ? 'filled' : 'empty'];
          if (w.final) k.push('rp');
          if (focusWord === w) k.push('focus');
          if (box <= 6) k.push('w32');
          return (
            <span
              key={`sq${w.id}`}
              className={k.join(' ')}
              data-role="square"
              data-square={w.text ? 'filled' : 'empty'}
              data-abs={w.abs}
              data-tick={w.off}
              data-box={box}
              data-focus={focusWord === w ? '1' : undefined}
              style={{ '--t': w.off, '--l': box, '--h': w.hue ?? undefined, '--cw': w.text ? `${wordSize(w.box, p.sizing.cell, p.sizing.base).font}px` : '0px' } as Css}
            >
              {focusWord === w && <span className="caret" aria-hidden="true"></span>}
            </span>
          );
        })}
      {flow && ff && ff.rest !== null && (
        <span className="rest focus" data-role="rest" data-focus="1" data-abs={ff.abs} data-tick={ff.abs % TICKS_PER_BEAT} data-len={ff.rest} style={{ '--t': ff.abs % TICKS_PER_BEAT, '--l': ff.rest } as Css}>
          {(ff.rest / TICKS_PER_BEAT) * p.sizing.cell >= 34 && <em>空音</em>}
        </span>
      )}
      {pv && (
        <span className={`tint preview${pv.s === stretch!.abs ? '' : ' cont'}${pv.e === stretch!.end ? '' : ' more'}`} data-role="hold-preview" data-s={pv.s} data-e={pv.e} style={tintStyle(pv.s, pv.e, pv.s === stretch!.abs, pv.e === stretch!.end, c0)}></span>
      )}
      {c.words.map((w) => {
        const size = wordSize(w.box, p.sizing.cell, p.sizing.base);
        const k = ['wd'];
        if (w.final) k.push('rp');
        if (!w.text) k.push('blank');
        if (size.font < p.sizing.base) k.push('narrow');
        if (w.mismatch) k.push('miss');
        if (p.cursor === w.abs && !p.editing) k.push('cur');
        if (p.nowAbs === w.abs) k.push('now');
        return (
          <span
            key={w.id}
            className={k.join(' ')}
            data-role="word"
            data-kind="word"
            data-word={w.id}
            data-tick={w.off}
            data-len={w.len}
            data-box={w.box}
            data-abs={w.abs}
            data-rhyme={w.final ?? undefined}
            data-mismatch={w.mismatch ? `${w.mismatch.got}≠${w.mismatch.want}` : undefined}
            data-locked={w.locked ? '1' : undefined}
            style={{ '--t': w.off, '--l': w.box, '--fs': `${size.font}px`, '--h': w.hue ?? undefined } as Css}
            onClick={(e) => {
              // 第 1 步点字 = 点它的方格（进入改字）；第 2 步字不接点击，点的是整格
              if (p.step !== 1) return;
              e.stopPropagation();
              store.flowPick(w.abs);
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
            {w.len <= w.box && grip(w)}
          </span>
        );
      })}
      {flow && ff && (focusWord || ff.rest !== null) && <SquareEditor focus={ff} global={c.global} beat={c.beat} box={focusWord ? sqBox(focusWord) : 0} text={focusWord?.text ?? ''} />}
      {p.editing && <CellEditor global={c.global} beat={c.beat} initial={c.words.map((w) => w.text).join('')} />}
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

/** 拖进别的格子的浅底最后一段：把手要知道是哪个字（只用到起点和 id） */
function holdWord(t: TintView): WordView {
  const abs = t.fromBar * TICKS_PER_BAR + t.fromBeat * TICKS_PER_BEAT + t.fromOff;
  return { id: t.wordId, abs, tick: abs % TICKS_PER_BAR, off: t.fromOff, len: t.e - abs, box: 0, text: '', final: null, hue: t.hue, locked: false, rhymeLocked: false, mismatch: null };
}

interface RowProps {
  row: RowView;
  state: EditorState;
  sizing: Sizing;
  nowAbs: number | null;
  nowKey: string | null;
  selected: Set<string>;
  rowOn: boolean;
  stretch: Stretch | null;
}

const Row = memo(function Row({ row, state, sizing, nowAbs, nowKey, selected, rowOn, stretch }: RowProps) {
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
  const rowStart = row.global * TICKS_PER_BAR;
  const rowStretch = stretch && stretch.abs < rowStart + TICKS_PER_BAR && stretch.end > rowStart ? stretch : null;
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
      {row.cells.map((c) => {
        const c0 = c.global * TICKS_PER_BAR + c.beat * TICKS_PER_BEAT;
        return (
          <Cell
            key={c.key}
            cell={c}
            step={state.step}
            sizing={sizing}
            selected={selected.has(c.key)}
            solo={selected.size === 1 && selected.has(c.key)}
            cursor={state.cursor !== null && state.cursor >= c0 && state.cursor < c0 + TICKS_PER_BEAT ? state.cursor : null}
            editing={state.editing?.key === c.key}
            nowAbs={nowAbs}
            nowCell={nowKey === c.key}
            holdTip={state.holdTip}
            stretch={rowStretch && rowStretch.abs < c0 + TICKS_PER_BEAT && rowStretch.end > c0 ? rowStretch : null}
            flowFocus={state.step === 1 && state.flowEdit && state.flowEdit.abs >= c0 && state.flowEdit.abs < c0 + TICKS_PER_BEAT ? state.flowEdit : null}
          />
        );
      })}
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

const SECTION_HINTS: Record<SectionKind, string> = {
  intro: '开头',
  verse: '主体叙事',
  hook: '反复唱的记忆点',
  bridge: '转折过渡',
  outro: '收尾',
};

/** 「+ 段落」：先选段落类型，加在最后（4 小节） */
function AddSection() {
  const { store } = useServices();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const items: MenuItem[] = SECTION_KINDS.map((k) => ({ label: `${SECTION_KIND_NAMES[k]} · ${SECTION_HINTS[k]}`, onClick: () => store.addSection(k) }));
  return (
    <>
      <button
        className={`btn sm${menu ? ' on' : ''}`}
        data-role="add-section"
        aria-haspopup="menu"
        aria-expanded={!!menu}
        title="加一段：选 Intro / Verse / Hook / Bridge / Outro，加在最后（4 小节）"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu(menu ? null : { x: r.left, y: r.top - (items.length * 30 + 14) });
        }}
      >
        <Icon.plus />
        段落
      </button>
      {menu && <Menu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </>
  );
}

interface Box {
  l: number;
  t: number;
  w: number;
  h: number;
}

/**
 * 选中框：量出选中格子的位置，拼成尽量少的几个矩形——同一行连着的几拍并成一段，上下相邻小节（跨段落也算相邻）同样的几拍再并成一块。
 * 一块里夹着段落标题时，标题那一行同一列垫一层浅色，看起来不断开。
 */
function useSelectionBoxes(sheet: React.RefObject<HTMLDivElement | null>, selection: string[], deps: unknown[]): { boxes: Box[]; bands: Box[] } {
  const [out, setOut] = useState<{ boxes: Box[]; bands: Box[] }>({ boxes: [], bands: [] });
  const [bump, setBump] = useState(0);
  useEffect(() => {
    const el = sheet.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBump((n) => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [sheet]);
  useLayoutEffect(() => {
    const el = sheet.current;
    if (!el || !selection.length) {
      setOut((o) => (o.boxes.length || o.bands.length ? { boxes: [], bands: [] } : o));
      return;
    }
    const keys = new Set(selection);
    const cells = [...el.querySelectorAll<HTMLElement>('[data-role="cell"]')].filter((c) => keys.has(c.dataset.key!));
    const byBar = new Map<number, Map<number, HTMLElement>>();
    for (const c of cells) {
      const g = Number(c.dataset.bar);
      if (!byBar.has(g)) byBar.set(g, new Map());
      byBar.get(g)!.set(Number(c.dataset.beat), c);
    }
    interface Run {
      b0: number;
      b1: number;
      first: HTMLElement;
      last: HTMLElement;
      bar: number;
    }
    const done: Run[] = [];
    let open: Run[] = [];
    for (const g of [...byBar.keys()].sort((a, b) => a - b)) {
      const beats = byBar.get(g)!;
      const runs: { b0: number; b1: number }[] = [];
      for (const b of [...beats.keys()].sort((a, b2) => a - b2)) {
        const r = runs[runs.length - 1];
        if (r && r.b1 === b - 1) r.b1 = b;
        else runs.push({ b0: b, b1: b });
      }
      const next: Run[] = [];
      for (const r of runs) {
        const prev = open.find((o) => o.bar === g - 1 && o.b0 === r.b0 && o.b1 === r.b1);
        if (prev) {
          prev.last = beats.get(r.b1)!;
          prev.bar = g;
          next.push(prev);
          open = open.filter((o) => o !== prev);
        } else next.push({ b0: r.b0, b1: r.b1, first: beats.get(r.b0)!, last: beats.get(r.b1)!, bar: g });
      }
      done.push(...open);
      open = next;
    }
    done.push(...open);
    const sr = el.getBoundingClientRect();
    const heads = [...el.querySelectorAll<HTMLElement>('[data-role="section-header"]')].map((h) => h.getBoundingClientRect());
    const boxes: Box[] = [];
    const bands: Box[] = [];
    for (const r of done) {
      const a = r.first.getBoundingClientRect();
      const b = r.last.getBoundingClientRect();
      const box = { l: a.left - sr.left - 1, t: a.top - sr.top - 1, w: b.right - a.left + 1, h: b.bottom - a.top + 1 };
      boxes.push(box);
      for (const h of heads) if (h.top > a.top && h.bottom < b.bottom) bands.push({ l: box.l + 1, t: h.top - sr.top, w: box.w - 1, h: h.height });
    }
    setOut({ boxes, bands });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, selection, bump, ...deps]);
  return out;
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
  const { boxes, bands } = useSelectionBoxes(sheetRef, s.selection, [view, sizing.cell, scroll]);

  // ---- 拖字的长度：吸附到第 1 步的精度，最多到下一个字的起点 / 全曲末尾 ----
  const [stretch, setStretch] = useState<Stretch | null>(null);
  const starts = useMemo(() => view.rows.flatMap((r) => r.cells.flatMap((c) => c.words.map((w) => w.abs))), [view]);
  const total = totalTicks(s.doc.grid);
  const live = useRef({ precision: s.precision, starts, total });
  useEffect(() => {
    live.current = { precision: s.precision, starts, total };
  }, [s.precision, starts, total]);
  const beginStretch = useCallback(
    (w: WordView, e: RPointerEvent<HTMLSpanElement>) => {
      e.stopPropagation();
      const id = e.pointerId;
      const x0 = e.clientX;
      let moved = false;
      const rawEnd = (ev: { clientX: number; clientY: number }) => {
        const under = document.elementsFromPoint(ev.clientX, ev.clientY).find((el) => (el as HTMLElement).dataset?.role === 'cell') as HTMLElement | undefined;
        if (!under) return null;
        const g = Number(under.dataset.bar) - 1;
        const beat = Number(under.dataset.beat);
        const r = under.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (ev.clientX - r.left - under.clientLeft) / under.clientWidth));
        return g * TICKS_PER_BAR + beat * TICKS_PER_BEAT + Math.round(frac * TICKS_PER_BEAT);
      };
      const snapped = (end: number) => {
        const { precision, starts: st, total } = live.current;
        const unit = precisionUnit(precision);
        const len = Math.max(Math.min(unit, w.len), Math.round(Math.max(1, end - w.abs) / unit) * unit);
        const limit = (st.find((x) => x > w.abs) ?? total) - w.abs;
        return w.abs + Math.max(1, Math.min(limit, len));
      };
      // 监听挂在 window 上：拖动中格子会重画，把手元素可能被换掉，松手照样收得到
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== id) return;
        if (Math.abs(ev.clientX - x0) > 3) moved = true;
        if (!moved) return;
        const end = rawEnd(ev);
        if (end !== null) setStretch({ abs: w.abs, end: snapped(end), x: ev.clientX, y: ev.clientY });
      };
      const up = (ev: PointerEvent) => {
        if (ev.pointerId !== id) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        setStretch(null);
        if (moved) {
          // 拖完松手时浏览器还会补一次点击：吞掉，免得第 1 步在松手的地方又放一个字
          const eat = (c: MouseEvent) => c.stopPropagation();
          window.addEventListener('click', eat, { capture: true, once: true });
          setTimeout(() => window.removeEventListener('click', eat, { capture: true }), 0);
        }
        // 只按了一下没拖（例如单击 / 双击正好点在把手上）：不改长度，照常当成点格子
        const end = ev.type === 'pointercancel' || !moved ? null : rawEnd(ev);
        if (end !== null && end > w.abs) store.stretchWord(w.abs, end);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
    [store],
  );
  const tipText = stretch
    ? `拖到 第 ${Math.floor(stretch.end / TICKS_PER_BAR) + 1} 小节第 ${Math.floor((stretch.end % TICKS_PER_BAR) / TICKS_PER_BEAT) + 1} 拍 · 第 ${Math.floor((stretch.end % TICKS_PER_BEAT) / 12) + 1} 个 16 分`
    : '';

  return (
    <StretchCtx.Provider value={beginStretch}>
      <div
        className={`sheet${scroll ? ' scroll' : ''}${stretch ? ' stretching' : ''}`}
        data-role="lyrics-sheet"
        data-step={s.step}
        ref={sheetRef}
        style={{ '--cell-min': scroll ? `${minCell + 1}px` : '0px', minWidth } as Css}
      >
        <div className="sh-head">
          <div className="corner">小节 \ 拍</div>
          {[0, 1, 2, 3].map((bi) => (
            <div key={bi} className={`colh${s.selColumn === bi ? ' on' : ''}`} data-role="beat-head" data-beat={bi}>
              <button className="bn" data-role="beat-head-btn" aria-label={`选中第 ${bi + 1} 拍整列`} title={`点：选中整首第 ${bi + 1} 拍这一列（空格子不算）`} onClick={() => store.selectColumn(bi)}>
                <span className="num">
                  {bi + 1}
                  {locks.beats.includes(bi) && (
                    <span data-role="lock-icon">
                      <Icon.lock />
                    </span>
                  )}
                </span>
                <span className="rul" aria-hidden="true">
                  {[0, 1, 2, 3].map((k) => (
                    <i key={k} style={{ left: `${k * 25}%` }}></i>
                  ))}
                </span>
              </button>
            </div>
          ))}
          <div className="lab-h">韵脚</div>
        </div>
        {view.sections.map((sec) => (
          <div className="sec" key={sec.id} data-role="section">
            <SectionHeader index={sec.index} label={sec.label} kind={sec.kind} bars={sec.rows.length} />
            {sec.rows.map((row) => (
              <Row key={row.barId} row={row} state={s} sizing={sizing} nowAbs={nowAbs} nowKey={nowKey} selected={selected} rowOn={rowOn(row)} stretch={stretch} />
            ))}
          </div>
        ))}
        {bands.map((b, i) => (
          <span key={`b${i}`} className="selband" data-role="selection-band" style={{ left: b.l, top: b.t, width: b.w, height: b.h }}></span>
        ))}
        {boxes.map((b, i) => (
          <span key={i} className="selbox" data-role="selection-box" style={{ left: b.l, top: b.t, width: b.w, height: b.h }}></span>
        ))}
        <div className="add-row">
          <button className="btn sm" data-role="add-bar" onClick={() => store.addBar()}>
            <Icon.plus />
            小节
          </button>
          <AddSection />
        </div>
      </div>
      {stretch && (
        <div className="drag-tip" data-role="drag-tip" style={{ left: Math.max(8, Math.min(stretch.x, window.innerWidth - 8)), top: stretch.y + 18 }}>
          {tipText}
        </div>
      )}
    </StretchCtx.Provider>
  );
}
