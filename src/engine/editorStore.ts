/**
 * 编辑器状态：界面和 src/core 之间唯一的一层。
 *
 * - 撤销历史跟踪的是 core/project 的 Doc（歌词、规则、涂色、锁定、BPM、伴奏）。填字、铺 flow、涂色、锁定、
 *   换伴奏都走这一条（core/history，单线：撤销后做新改动就丢掉可重做的步骤）；历史随作品存进本机，刷新后还在。
 * - 每一步改动都先过锁定检查：锁住的字不能改字、不能挪落点、不能改长度。
 * - 不依赖 React：组件用 useSyncExternalStore 订阅 getState()。
 */

import {
  addRule,
  allBars,
  applyPolish,
  applyRhymeFill,
  barAt,
  boxKeys,
  canPaint,
  cellContent,
  cellKey,
  checkChanges,
  clearBar,
  columnKeys,
  copyFlowToNextBar,
  createAutosave,
  createSection,
  deleteBars,
  deleteRule,
  deleteSection,
  deserializeProject,
  docCodec,
  duplicateSection,
  erasePaint,
  extendWord,
  fillTexts,
  findWord,
  History,
  holdInto,
  insertBars,
  insertSection,
  isCellLocked,
  locateTick,
  mismatches,
  paintCells,
  parseCellKey,
  placeWord,
  planBeatSwap,
  relabelSections,
  removeWords,
  restoreHistory,
  rhymeSlots,
  rowKeys,
  ruleName,
  sameBpm,
  sectionLabel,
  serializeHistory,
  serializeProject,
  setBarLocks,
  setBeatLocks,
  setCellLocks,
  setRhymeLock,
  setWordText,
  snapTick,
  stretchWordTo,
  tidyDoc,
  TICKS_PER_BAR,
  TICKS_PER_BEAT,
  toggleKeys,
  totalTicks,
  updateRule,
  updateSection,
  wordStartingAt,
  type Autosave,
  type BeatRef,
  type BeatSwapChoice,
  type BeatSwapPlan,
  type Change,
  type Doc,
  type FillAnswer,
  type Grid,
  type HistoryKind,
  type HistoryStep,
  type KeyValueStore,
  type MergeInfo,
  type PolishOptions,
  type Precision,
  type Project,
  type SectionKind,
  type TimerApi,
} from '../core';
import { historyKey, projectKey, type ProjectLibrary } from '../storage/library';
import type { StorageAdapter } from '../storage/StorageAdapter';
import { emptyProject, EXAMPLES, nightDriveProject, type ExampleKey } from './demo';
import { cellName } from './view';

export type SaveStatus =
  | { kind: 'saved'; at: number | null }
  | { kind: 'pending' }
  | { kind: 'memory'; reason: string }
  | { kind: 'error'; message: string };

export type Step = 1 | 2;
export type SelMode = 'cell' | 'row' | 'col' | 'box';

export interface HistoryView {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  /** 做过的（从早到晚） */
  done: HistoryStep[];
  /** 还能重做的（下一步重做的在最前） */
  redo: HistoryStep[];
}

/** 新伴奏 BPM 和工程不一样时，等用户在弹窗里二选一 */
export interface PendingBeatSwap {
  name: string;
  bpm: number;
  durationSec: number | null;
  firstBeatMs: number;
  plan: BeatSwapPlan;
}

export interface EditorState {
  projectId: string;
  name: string;
  createdAt: number;
  doc: Doc;
  step: Step;
  precision: Precision;
  /** 当前颜色（规则 id） */
  activeRule: string | null;
  selMode: SelMode;
  invert: boolean;
  /** 选中的格子（CellKey） */
  selection: string[];
  /** 框选的第一个角 */
  anchor: { bar: number; beat: number } | null;
  /** 选中的字（全曲绝对起点） */
  cursor: number | null;
  /** 正在打字的字（全曲绝对起点） */
  editing: number | null;
  /** 列头点了某拍的某个 16 分：整首这一列框出来 */
  band: { beat: number; sub: number } | null;
  history: HistoryView;
  save: SaveStatus;
  notice: { text: string; at: number } | null;
  /** 点了只有拖音的格子 */
  holdTip: { key: string; global: number; beat: number; fromBar: number; fromBeat: number; text: string } | null;
  beatSwap: PendingBeatSwap | null;
}

export interface EditorStoreOptions {
  storage: StorageAdapter;
  library: ProjectLibrary;
  timers?: TimerApi;
  now?: () => number;
  /** 默认 1000ms（core/autosave 的默认值） */
  debounceMs?: number;
}

export const BPM_MIN = 40;
export const BPM_MAX = 220;

const browserTimers: TimerApi = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

function docOf(p: Project): Doc {
  return { bpm: p.bpm, offsetMs: p.offsetMs, beat: p.beat, grid: p.grid, rules: p.rules, paint: p.paint, locks: p.locks };
}

const sameDoc = (a: Doc, b: Doc) => docCodec.split(a).join('\u0000') === docCodec.split(b).join('\u0000');

export class EditorStore {
  private readonly storage: StorageAdapter;
  private readonly library: ProjectLibrary;
  private readonly timers: TimerApi;
  private readonly now: () => number;
  private readonly debounceMs: number;
  private history: History<Doc>;
  private autosave!: Autosave;
  private listeners = new Set<() => void>();
  private state: EditorState;

  constructor(options: EditorStoreOptions) {
    this.storage = options.storage;
    this.library = options.library;
    this.timers = options.timers ?? browserTimers;
    this.now = options.now ?? (() => Date.now());
    this.debounceMs = options.debounceMs ?? 1000;

    this.library.migrateLegacy();
    let id: string | null = this.library.currentId ?? this.library.list()[0]?.id ?? null;
    let project = id ? this.library.load(id) : null;
    let unreadable = false;
    if (id && !project) {
      // 读不出来（迁移失败等）：原文和备份都留在本机，换一个能读的作品打开
      unreadable = true;
      const other = this.library.list().find((m) => m.id !== id && this.library.load(m.id));
      id = other?.id ?? null;
      project = other ? this.library.load(other.id) : null;
    }
    if (!id || !project) {
      // 第一次打开：放视觉稿里那首「夜车」
      project = nightDriveProject(this.now());
      id = this.library.create(project);
    }
    this.library.setCurrent(id);
    this.history = this.loadHistory(id, docOf(project));
    this.state = this.initialState(id, project);
    this.attachAutosave(id);
    if (unreadable) this.notify('有一个作品读不出来，原文已保留在本机（没有删除）');
  }

  // ---------- 订阅 ----------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): EditorState => this.state;

  get doc(): Doc {
    return this.state.doc;
  }

  get grid(): Grid {
    return this.state.doc.grid;
  }

  get project(): Project {
    const s = this.state;
    return { name: s.name, createdAt: s.createdAt, updatedAt: this.now(), ...s.doc };
  }

  get persistent(): boolean {
    return this.storage.persistent;
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  private set(patch: Partial<EditorState>, dirty = false) {
    this.state = { ...this.state, ...patch };
    if (dirty) {
      this.autosave.notify(this.project, () => serializeHistory(this.history, docCodec));
      if (this.storage.persistent && this.state.save.kind !== 'error') this.state = { ...this.state, save: { kind: 'pending' } };
    }
    this.emit();
  }

  private historyView(): HistoryView {
    const h = this.history;
    return { canUndo: h.canUndo, canRedo: h.canRedo, undoLabel: h.undoLabel, redoLabel: h.redoLabel, done: h.done, redo: h.redoable };
  }

  private initialState(projectId: string, p: Project): EditorState {
    return {
      projectId,
      name: p.name,
      createdAt: p.createdAt,
      doc: this.history.state,
      step: 2,
      precision: '1/16',
      activeRule: p.rules[0]?.id ?? null,
      selMode: 'cell',
      invert: false,
      selection: [],
      anchor: null,
      cursor: null,
      editing: null,
      band: null,
      history: this.historyView(),
      save: this.storage.persistent ? { kind: 'saved', at: p.updatedAt || null } : { kind: 'memory', reason: this.storage.reason ?? '拿不到本机存储' },
      notice: null,
      holdTip: null,
      beatSwap: null,
    };
  }

  /** 读回存着的撤销历史；和作品正文对不上（例如历史没来得及写）就从头开始 */
  private loadHistory(id: string, doc: Doc): History<Doc> {
    const raw = this.library.loadHistory(id);
    if (raw) {
      try {
        const h = restoreHistory(raw, docCodec, { now: this.now });
        if (sameDoc(h.state, doc)) return h;
      } catch {
        // 历史坏了：作品本身照样能打开
      }
    }
    return new History<Doc>(doc, { now: this.now });
  }

  private attachAutosave(id: string) {
    const tracked = this.library.trackedStore();
    const store: KeyValueStore = {
      getItem: (k) => tracked.getItem(k),
      removeItem: (k) => tracked.removeItem(k),
      setItem: (k, v) => {
        tracked.setItem(k, v);
        if (k === projectKey(id) && this.storage.persistent) this.set({ save: { kind: 'saved', at: this.now() } });
      },
    };
    this.autosave = createAutosave({
      store,
      timers: this.timers,
      key: projectKey(id),
      historyKey: historyKey(id),
      debounceMs: this.debounceMs,
      onError: (e) => this.set({ save: { kind: 'error', message: (e as Error)?.message || '保存失败' } }),
    });
  }

  /** 立即落盘（⌘S、页面关闭） */
  flush(): void {
    this.autosave.flush();
  }

  notify(text: string): void {
    this.set({ notice: { text, at: this.now() } });
  }

  // ---------- 撤销 / 重做 ----------

  /**
   * 执行一步改动（core/history）。改动先过锁定检查：碰到锁住的字整步不做。
   * 返回是否真的改了。
   */
  exec(label: string, kind: HistoryKind, apply: (d: Doc) => Doc, extra: Partial<EditorState> = {}): boolean {
    const before = this.history.state;
    let after: Doc;
    try {
      after = tidyDoc(apply(before));
    } catch (e) {
      this.notify(`没做成：${(e as Error).message}`);
      return false;
    }
    if (after === before || sameDoc(after, before)) return false;
    if (kind !== 'lock' && after.grid !== before.grid) {
      const blocked = this.lockViolations(before, after);
      if (blocked.length) {
        this.notify(`${cellName(blocked[0].bar, blocked[0].beat)}锁住了：锁住的字不能改字、不能挪落点`);
        return false;
      }
    }
    this.history.push(after, { label, kind, at: this.now() });
    this.set({ doc: after, history: this.historyView(), ...extra }, true);
    return true;
  }

  private lockViolations(before: Doc, after: Doc): Change[] {
    const scope = new Set(allBars(before.grid).flatMap((b) => [0, 1, 2, 3].map((beat) => cellKey(b.data.id, beat))));
    const sameBars = allBars(before.grid).length === allBars(after.grid).length;
    if (!sameBars) {
      // 增删小节：被删掉的小节里不能有锁
      const ids = new Set(allBars(after.grid).map((b) => b.data.id));
      return allBars(before.grid)
        .filter((b) => !ids.has(b.data.id) && [0, 1, 2, 3].some((beat) => isCellLocked(before.locks, b.data.id, beat) && b.data.words.length))
        .map((b) => ({ bar: b.global, beat: 0, abs: b.global * TICKS_PER_BAR, before: null, after: null, reason: 'locked' as const }));
    }
    return checkChanges(before.grid, after.grid, { ...before, scope, keepSkeleton: false }).violations.filter((v) => v.reason === 'locked');
  }

  undo(): void {
    if (!this.history.canUndo) return;
    this.set({ doc: this.history.undo(), history: this.historyView(), holdTip: null, editing: null }, true);
  }

  redo(): void {
    if (!this.history.canRedo) return;
    this.set({ doc: this.history.redo(), history: this.historyView(), holdTip: null, editing: null }, true);
  }

  // ---------- 步骤 / 精度 ----------

  setStep(step: Step): void {
    if (step !== this.state.step) this.set({ step, editing: null, holdTip: null, selection: [], anchor: null });
  }

  setPrecision(precision: Precision): void {
    this.set({ precision });
  }

  setBand(band: { beat: number; sub: number } | null): void {
    const cur = this.state.band;
    this.set({ band: band && cur && cur.beat === band.beat && cur.sub === band.sub ? null : band });
  }

  // ---------- 铺 flow ----------

  /** 第一步点格子里的位置：那里已经有字就选中它，否则按精度放一个空字 */
  flowClick(absTick: number): void {
    const at = snapTick(absTick, this.state.precision);
    const exist = wordStartingAt(this.grid, at);
    if (exist) {
      this.set({ cursor: at });
      return;
    }
    const bar = Math.floor(at / TICKS_PER_BAR) + 1;
    if (this.exec(`铺 flow 第 ${bar} 小节`, 'flow', (d) => ({ ...d, grid: placeWord(d.grid, at, this.state.precision) }))) this.set({ cursor: at });
  }

  /** 按 - 键：选中的字多拖一个精度单位（steps < 0 往回缩） */
  extendCursor(steps = 1): void {
    const cur = this.state.cursor;
    if (cur === null) return;
    const w = wordStartingAt(this.grid, cur);
    if (!w) return;
    this.exec(`铺 flow 拖长「${w.word.text || '字'}」`, 'flow', (d) => ({ ...d, grid: extendWord(d.grid, w.word.id, this.state.precision, steps) }));
  }

  /** 拖字框右边缘：结束位置吸附到精度 */
  stretchWord(absTick: number, endAbs: number): void {
    const w = wordStartingAt(this.grid, absTick);
    if (!w) return;
    this.exec(`铺 flow 拖长「${w.word.text || '字'}」`, 'flow', (d) => ({ ...d, grid: stretchWordTo(d.grid, w.word.id, endAbs, this.state.precision) }), { cursor: absTick });
  }

  /** 删掉选中的字（留下的空白就是空音） */
  deleteCursorWord(): void {
    const cur = this.state.cursor;
    if (cur === null) return;
    const w = wordStartingAt(this.grid, cur);
    if (!w) return;
    const prev = this.prevWordAbs(cur);
    this.exec(`铺 flow 删掉第 ${w.global + 1} 小节的一个字`, 'flow', (d) => ({ ...d, grid: removeWords(d.grid, [w.word.id]) }), { cursor: prev });
  }

  copyFlowToNext(globalBar: number): void {
    if (!barAt(this.grid, globalBar + 1)) {
      this.notify('已经是最后一小节了');
      return;
    }
    this.exec(`铺 flow 第 ${globalBar + 1} 小节复制到第 ${globalBar + 2} 小节`, 'flow', (d) => ({ ...d, grid: copyFlowToNextBar(d.grid, globalBar) }));
  }

  clearBarFlow(globalBar: number): void {
    this.exec(`铺 flow 清空第 ${globalBar + 1} 小节`, 'flow', (d) => ({ ...d, grid: clearBar(d.grid, globalBar) }), { cursor: null });
  }

  private wordStarts(): number[] {
    const out: number[] = [];
    allBars(this.grid).forEach((b) => b.data.words.forEach((w) => out.push(b.global * TICKS_PER_BAR + w.tick)));
    return out;
  }

  private prevWordAbs(abs: number): number | null {
    const before = this.wordStarts().filter((t) => t < abs);
    return before.length ? before[before.length - 1] : null;
  }

  /** 方向键：前后一个字（dx）/ 上下一小节同一位置附近的字（dy） */
  moveCursor(dx: number, dy = 0): void {
    const starts = this.wordStarts();
    if (!starts.length) return;
    const cur = this.state.cursor;
    if (cur === null) {
      this.set({ cursor: starts[0] });
      return;
    }
    if (dy) {
      const target = cur + dy * TICKS_PER_BAR;
      const near = starts.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a), starts[0]);
      this.set({ cursor: near });
      return;
    }
    const i = starts.indexOf(cur);
    const j = Math.max(0, Math.min(starts.length - 1, (i < 0 ? starts.findIndex((t) => t > cur) : i) + dx));
    this.set({ cursor: starts[j] });
  }

  // ---------- 填字 ----------

  focusWord(abs: number | null): void {
    this.set({ cursor: abs, holdTip: null });
  }

  startEdit(abs: number): void {
    if (!wordStartingAt(this.grid, abs)) return;
    this.set({ cursor: abs, editing: abs, holdTip: null });
  }

  cancelEdit(): void {
    if (this.state.editing !== null) this.set({ editing: null });
  }

  /** 从 abs 这个字起往后依次填字（一个字一个位置）；空字符串 = 清掉这个字的文字。填完选中下一个字 */
  commitText(abs: number, raw: string): void {
    const chars = Array.from(raw.replace(/\s+/g, ''));
    const w = wordStartingAt(this.grid, abs);
    this.set({ editing: null });
    if (!w) return;
    if (!chars.length) {
      if (w.word.text) this.exec(`填字 删掉第 ${w.global + 1} 小节「${w.word.text}」`, 'fill', (d) => ({ ...d, grid: setWordText(d.grid, w.word.id, '') }));
      return;
    }
    let written: number[] = [];
    const ok = this.exec(`填字 第 ${w.global + 1} 小节「${chars.join('')}」`, 'fill', (d) => {
      const r = fillTexts(d.grid, abs, chars);
      written = r.written.map((x) => x.abs);
      return { ...d, grid: r.grid };
    });
    if (ok && written.length) {
      const next = this.wordStarts().find((t) => t > written[written.length - 1]);
      this.set({ cursor: next ?? written[written.length - 1] });
    }
  }

  /** 候选词填进一格的韵脚位置（最后 n 个字） */
  fillRhyme(key: string, word: string): void {
    const slots = rhymeSlots(this.grid, this.doc.rules, this.doc.paint).filter((s) => s.key === key);
    if (!slots.length) {
      this.notify('先选一个涂了色、铺了字的格子');
      return;
    }
    const chars = Array.from(word);
    const take = chars.slice(Math.max(0, chars.length - slots.length));
    const targets = slots.slice(slots.length - take.length);
    const { barId, beat } = parseCellKey(key);
    const g = allBars(this.grid).findIndex((b) => b.data.id === barId);
    this.exec(`填字 ${cellName(g, beat)}「${take.join('')}」`, 'fill', (d) => {
      let grid = d.grid;
      targets.forEach((t, i) => {
        grid = setWordText(grid, t.word.id, take[i]);
      });
      return { ...d, grid };
    });
  }

  // ---------- 选格子 / 涂色 ----------

  setSelMode(selMode: SelMode): void {
    this.set({ selMode, anchor: null });
  }

  toggleInvert(): void {
    this.set({ invert: !this.state.invert });
  }

  clearSelection(): void {
    this.set({ selection: [], anchor: null, holdTip: null, cursor: null, editing: null });
  }

  private holdTipFor(global: number, beat: number): EditorState['holdTip'] {
    const from = holdInto(this.grid, global, beat);
    const bar = barAt(this.grid, global);
    if (!from || !bar) return null;
    return { key: cellKey(bar.id, beat), global, beat, fromBar: from.global, fromBeat: Math.floor(from.word.tick / TICKS_PER_BEAT), text: from.word.text };
  }

  /** 点一格：按当前选法选格子；只有拖音的格子出提示、选不上 */
  clickCell(global: number, beat: number): void {
    const bar = barAt(this.grid, global);
    if (!bar) return;
    const key = cellKey(bar.id, beat);
    const s = this.state;
    if (cellContent(this.grid, global, beat) === 'hold-only' && (s.selMode === 'cell' || s.invert)) {
      this.set({ holdTip: this.holdTipFor(global, beat), selection: s.invert ? s.selection : [] });
      return;
    }
    let selection: string[];
    let anchor = s.anchor;
    if (s.invert && s.selection.length) selection = toggleKeys(s.selection, [key]);
    else if (s.selMode === 'row') selection = rowKeys(this.grid, global);
    else if (s.selMode === 'col') selection = columnKeys(this.grid, beat);
    else if (s.selMode === 'box') {
      if (anchor) {
        selection = boxKeys(this.grid, anchor, { bar: global, beat });
        anchor = null;
      } else {
        selection = [key];
        anchor = { bar: global, beat };
      }
    } else selection = [key];
    this.set({ selection, anchor, holdTip: null });
  }

  selectRow(global: number): void {
    this.set({ selection: rowKeys(this.grid, global), anchor: null, holdTip: null, selMode: 'row' });
  }

  selectColumn(beat: number): void {
    this.set({ selection: columnKeys(this.grid, beat), anchor: null, holdTip: null, selMode: 'col' });
  }

  selectBox(a: { bar: number; beat: number }, b: { bar: number; beat: number }): void {
    this.set({ selection: boxKeys(this.grid, a, b), anchor: null, holdTip: null, selMode: 'box' });
  }

  setActiveRule(id: string | null): void {
    this.set({ activeRule: id });
  }

  /** 把选中的格子涂成当前颜色；只有拖音 / 还没铺字的格子跳过 */
  paintSelection(): void {
    const rule = this.doc.rules.find((r) => r.id === this.state.activeRule);
    if (!rule) {
      this.notify('先选一种颜色');
      return;
    }
    const keys = this.state.selection;
    if (!keys.length) {
      this.notify('先选格子');
      return;
    }
    const r = paintCells(this.grid, this.doc.paint, keys, rule.id);
    const skipped = r.refused.length ? `；跳过 ${r.refused.length} 格（只有拖音或还没铺字）` : '';
    if (!r.painted.length) {
      const hold = r.refused.find((x) => x.reason === 'hold-only');
      if (hold && keys.length === 1) {
        const { barId, beat } = parseCellKey(hold.key);
        const g = allBars(this.grid).findIndex((b) => b.data.id === barId);
        this.set({ holdTip: this.holdTipFor(g, beat) });
      } else this.notify(r.refused.length ? `这些格子涂不上${skipped}` : '这些格子已经是这个颜色');
      return;
    }
    const where = this.describeKeys(r.painted);
    if (this.exec(`涂色 ${ruleName(rule)} · ${where}`, 'paint', (d) => ({ ...d, paint: r.paint }))) {
      if (skipped) this.notify(`涂上 ${r.painted.length} 格${skipped}`);
    }
  }

  eraseSelection(): void {
    const keys = this.state.selection.filter((k) => k in this.doc.paint);
    if (!keys.length) return;
    this.exec(`涂色 擦掉 ${this.describeKeys(keys)}`, 'paint', (d) => ({ ...d, paint: erasePaint(d.paint, keys) }));
  }

  private describeKeys(keys: string[]): string {
    const bars = allBars(this.grid);
    const pos = keys.map((k) => {
      const { barId, beat } = parseCellKey(k);
      return { bar: bars.findIndex((b) => b.data.id === barId), beat };
    });
    if (pos.length === 1) return cellName(pos[0].bar, pos[0].beat);
    const barsSet = [...new Set(pos.map((p) => p.bar))].sort((a, b) => a - b);
    const beats = [...new Set(pos.map((p) => p.beat))].sort();
    const barText = barsSet.length === 1 ? `第 ${barsSet[0] + 1} 小节` : `第 ${barsSet[0] + 1}–${barsSet[barsSet.length - 1] + 1} 小节`;
    const beatText = beats.length === 4 ? '整行' : `第 ${beats.map((b) => b + 1).join('、')} 拍`;
    return `${barText}${beatText} · ${pos.length} 格`;
  }

  /** 点一格的提示可以关掉 */
  dismissHoldTip(): void {
    if (this.state.holdTip) this.set({ holdTip: null });
  }

  // ---------- 颜色规则 ----------

  private mergedNotice(merged: MergeInfo[], before: Doc): string | null {
    if (!merged.length) return null;
    const name = (id: string) => {
      const r = before.rules.find((x) => x.id === id);
      return r ? ruleName(r) : '另一种颜色';
    };
    return merged.map((m) => `${name(m.removed)}和${name(m.kept)}押的是同一个韵，已合并成${name(m.kept)}`).join('；') + '（可以撤销）';
  }

  addRule(): void {
    const r = addRule(this.doc);
    if (!r.rule) {
      this.notify('最多 8 种颜色');
      return;
    }
    const rule = r.rule;
    this.exec(`涂色 新建${ruleName(rule)}`, 'paint', (d) => ({ ...d, rules: r.rules, paint: r.paint }), { activeRule: rule.id });
  }

  private changeRule(id: string, patch: { count?: number; finals?: string[] }, label: string): void {
    const before = this.doc;
    const r = updateRule(before, id, patch);
    const notice = this.mergedNotice(r.merged, before);
    const kept = r.merged.find((m) => m.removed === id)?.kept;
    const merge = notice ? `，合并进${ruleName(before.rules.find((x) => x.id === kept) ?? { hue: 0 })}` : '';
    const ok = this.exec(`${label}${merge}`, 'paint', (d) => ({ ...d, rules: r.rules, paint: r.paint }), kept ? { activeRule: kept } : {});
    if (ok && notice) this.notify(notice);
  }

  setRuleCount(id: string, count: number): void {
    const rule = this.doc.rules.find((r) => r.id === id);
    if (!rule || rule.count === count) return;
    this.changeRule(id, { count }, `涂色 ${ruleName(rule)}改成${['单押', '双押', '三押', '四押'][count - 1]}`);
  }

  setRuleFinal(id: string, index: number, value: string): void {
    const rule = this.doc.rules.find((r) => r.id === id);
    if (!rule) return;
    const finals = rule.finals.map((f, i) => (i === index ? value : f));
    if (finals.join('|') === rule.finals.join('|')) return;
    this.changeRule(id, { finals }, `涂色 ${ruleName(rule)}韵母改成 ${finals.join(' · ')}`);
  }

  removeRule(id: string): void {
    const rule = this.doc.rules.find((r) => r.id === id);
    if (!rule) return;
    const next = this.doc.rules.find((r) => r.id !== id)?.id ?? null;
    this.exec(`涂色 删掉${ruleName(rule)}`, 'paint', (d) => ({ ...d, ...deleteRule(d, id) }), { activeRule: next });
  }

  // ---------- 锁定 ----------

  private selectionParts() {
    const bars = allBars(this.grid);
    const pos = this.state.selection.map((k) => ({ k, ...parseCellKey(k) }));
    const rows = bars.filter((b) => [0, 1, 2, 3].every((beat) => pos.some((p) => p.barId === b.data.id && p.beat === beat)));
    const cols = [0, 1, 2, 3].filter((beat) => bars.length > 0 && bars.every((b) => pos.some((p) => p.barId === b.data.id && p.beat === beat)));
    return { bars, pos, rows, cols };
  }

  /** 锁整行：选中的整行（没选整行时用选中格所在的小节） */
  lockRows(on: boolean): void {
    const { bars, pos, rows } = this.selectionParts();
    const ids = rows.length ? rows.map((r) => r.data.id) : [...new Set(pos.map((p) => p.barId))];
    if (!ids.length) {
      this.notify('先选一行');
      return;
    }
    const names = ids.map((id) => bars.findIndex((b) => b.data.id === id) + 1).sort((a, b) => a - b);
    this.exec(`锁定 ${on ? '' : '解锁 '}第 ${names.join('、')} 小节整行`, 'lock', (d) => ({ ...d, locks: setBarLocks(d.locks, ids, on) }));
  }

  lockColumns(on: boolean): void {
    const { pos, cols } = this.selectionParts();
    const beats = cols.length ? cols : [...new Set(pos.map((p) => p.beat))];
    if (!beats.length) {
      this.notify('先选一列');
      return;
    }
    this.exec(`锁定 ${on ? '' : '解锁 '}第 ${beats.map((b) => b + 1).join('、')} 拍整列`, 'lock', (d) => ({ ...d, locks: setBeatLocks(d.locks, beats, on) }));
  }

  lockCells(on: boolean): void {
    const keys = this.state.selection;
    if (!keys.length) {
      this.notify('先选格子');
      return;
    }
    this.exec(`锁定 ${on ? '' : '解锁 '}${this.describeKeys(keys)}`, 'lock', (d) => ({ ...d, locks: setCellLocks(d.locks, keys, on) }));
  }

  lockRhyme(on: boolean): void {
    this.exec(`锁定 ${on ? '' : '解锁 '}全部韵脚位置`, 'lock', (d) => ({ ...d, locks: setRhymeLock(d.locks, on) }));
  }

  // ---------- BPM / 伴奏 ----------

  setBpm(bpm: number): void {
    if (!Number.isFinite(bpm)) return;
    const v = Math.round(Math.max(BPM_MIN, Math.min(BPM_MAX, bpm)) * 100) / 100;
    if (v === this.doc.bpm) return;
    this.exec(`BPM 改成 ${v}`, 'edit', (d) => ({ ...d, bpm: v }));
  }

  setOffsetMs(ms: number): void {
    const v = Math.round(Math.max(0, Math.min(5000, ms)));
    if (v !== this.doc.offsetMs) this.exec(`首拍偏移改成 ${v} ms`, 'edit', (d) => ({ ...d, offsetMs: v }));
  }

  /**
   * 载入 / 替换伴奏（transport 解码、检测 BPM 后调用）。BPM 和工程不一样、而且已经写了东西时弹窗二选一，
   * 否则直接换。歌词跟着拍子走：tick 不变，只重算秒数。
   */
  requestBeat(info: { name: string; bpm: number | null; durationSec: number | null; firstBeatMs: number }): void {
    const hasWords = allBars(this.grid).some((b) => b.data.words.length > 0);
    if (info.bpm !== null && !sameBpm(info.bpm, this.doc.bpm) && hasWords) {
      this.set({
        beatSwap: { name: info.name, bpm: info.bpm, durationSec: info.durationSec, firstBeatMs: info.firstBeatMs, plan: planBeatSwap(this.doc.bpm, info.bpm, totalTicks(this.grid), this.doc.offsetMs) },
      });
      return;
    }
    const bpm = info.bpm ?? this.doc.bpm;
    this.applyBeat(info.name, info.bpm, info.durationSec, info.firstBeatMs, info.bpm !== null && hasWords ? this.doc.bpm : bpm, 1);
  }

  confirmBeatSwap(choice: BeatSwapChoice): void {
    const p = this.state.beatSwap;
    if (!p) return;
    const opt = choice === 'keep' ? p.plan.keep : p.plan.adopt;
    this.set({ beatSwap: null });
    this.applyBeat(p.name, p.bpm, p.durationSec, p.firstBeatMs, opt.bpm, opt.rate);
  }

  cancelBeatSwap(): void {
    if (this.state.beatSwap) this.set({ beatSwap: null });
  }

  private applyBeat(name: string, beatBpm: number | null, durationSec: number | null, firstBeatMs: number, bpm: number, rate: number) {
    const old = this.doc.beat;
    const beat: BeatRef = { name, bpm: beatBpm, rate, durationSec };
    const offsetMs = Math.round(Math.max(0, Math.min(5000, firstBeatMs / rate)));
    const how = rate !== 1 ? `（保留 ${bpm} BPM）` : old && beatBpm !== null ? `（改用 ${bpm} BPM）` : '';
    const label = old ? `换伴奏 ${old.name} → ${name}${how}` : `换伴奏 载入 ${name}`;
    this.exec(label, 'beat', (d) => ({ ...d, beat, bpm, offsetMs }));
  }

  removeBeat(): void {
    const old = this.doc.beat;
    if (old) this.exec(`换伴奏 移除 ${old.name}`, 'beat', (d) => ({ ...d, beat: null }));
  }

  // ---------- 小节 / 段落 ----------

  addBar(section = this.grid.sections.length - 1): void {
    const s = this.grid.sections[section];
    if (!s) return;
    this.exec(`铺 flow 在 ${s.label} 末尾加一小节`, 'flow', (d) => ({ ...d, grid: insertBars(d.grid, section, s.bars.length, 1) }));
  }

  deleteBar(global: number): void {
    const bars = allBars(this.grid);
    const b = bars[global];
    if (!b) return;
    if (this.grid.sections[b.section].bars.length <= 1) {
      this.notify('段落里至少留一个小节；要删整段请用「删除段落」');
      return;
    }
    this.exec(`铺 flow 删除第 ${global + 1} 小节`, 'flow', (d) => ({ ...d, grid: deleteBars(d.grid, b.section, b.bar, 1) }), { selection: [], cursor: null });
  }

  addSection(kind: SectionKind = 'verse'): void {
    const index = this.grid.sections.length;
    this.exec(`编辑 添加 ${sectionLabel(kind)} 段`, 'edit', (d) => ({ ...d, grid: relabelSections(insertSection(d.grid, index, createSection(kind, 4))) }));
  }

  setSectionKind(index: number, kind: SectionKind): void {
    const s = this.grid.sections[index];
    if (!s || s.kind === kind) return;
    this.exec(`编辑 ${s.label} 改成 ${sectionLabel(kind)}`, 'edit', (d) => ({ ...d, grid: relabelSections(updateSection(d.grid, index, { kind })) }));
  }

  duplicateSection(index: number): void {
    const s = this.grid.sections[index];
    if (s) this.exec(`编辑 复制 ${s.label}`, 'edit', (d) => ({ ...d, grid: relabelSections(duplicateSection(d.grid, index)) }));
  }

  deleteSection(index: number): void {
    if (this.grid.sections.length <= 1) {
      this.notify('至少留一个段落');
      return;
    }
    const s = this.grid.sections[index];
    this.exec(`编辑 删除 ${s.label}`, 'edit', (d) => ({ ...d, grid: relabelSections(deleteSection(d.grid, index)) }), { selection: [], cursor: null });
  }

  clearLyrics(): void {
    this.exec('填字 清空全部文字', 'fill', (d) => {
      let grid = d.grid;
      for (const b of allBars(grid)) for (const w of b.data.words) if (w.text) grid = setWordText(grid, w.id, '');
      return { ...d, grid };
    });
  }

  rename(name: string): void {
    const clean = name.trim();
    if (clean && clean !== this.state.name) this.set({ name: clean }, true);
  }

  // ---------- AI（静态版界面不挂载入口，接上 AI 后用） ----------

  /** AI 一次填韵：只填空位，其余有任何改动整份作废 */
  applyAiFill(answers: FillAnswer[]): { ok: boolean; violations: Change[] } {
    const r = applyRhymeFill(this.grid, this.doc, answers);
    if (!r.ok) {
      this.notify('这一版作废了，没有上屏：AI 动了不该动的位置');
      return { ok: false, violations: r.check.violations };
    }
    this.exec(`AI 改写 填入 ${answers.length} 个韵脚`, 'ai', (d) => ({ ...d, grid: r.grid }));
    return { ok: true, violations: [] };
  }

  /** AI 选区润色：先逐字比对，选区外 / 锁定位置有改动就整份作废 */
  applyAiPolish(scope: string[], options: PolishOptions, result: Parameters<typeof applyPolish>[4]): { ok: boolean; violations: Change[] } {
    const r = applyPolish(this.grid, this.doc, new Set(scope), options, result);
    if (!r.ok) {
      this.notify('这一版作废了，没有上屏：AI 动了选区外或锁定的字');
      return { ok: false, violations: r.check.violations };
    }
    this.exec(`AI 改写 ${this.describeKeys(scope)}`, 'ai', (d) => ({ ...d, grid: r.grid }));
    return { ok: true, violations: [] };
  }

  // ---------- 作品库 ----------

  private switchTo(id: string, project: Project) {
    this.autosave.flush();
    this.library.setCurrent(id);
    this.history = this.loadHistory(id, docOf(project));
    this.attachAutosave(id);
    this.state = this.initialState(id, project);
    this.emit();
  }

  newProject(): void {
    const p = emptyProject(this.library.nextUntitledName(), this.now(), this.doc.bpm);
    this.switchTo(this.library.create(p), p);
  }

  openProject(id: string): void {
    if (id === this.state.projectId) return;
    const p = this.library.load(id);
    if (!p) {
      this.notify('这个作品读不出来了（原文已保留在本机）');
      return;
    }
    this.switchTo(id, p);
  }

  openExample(key: ExampleKey): void {
    const ex = EXAMPLES.find((e) => e.key === key);
    if (!ex) return;
    const p = ex.build(this.now());
    this.switchTo(this.library.create(p), p);
  }

  saveAs(name?: string): void {
    const p = { ...this.project, name: name?.trim() || `${this.state.name} 副本`, createdAt: this.now() };
    this.switchTo(this.library.create(p), p);
  }

  renameProject(id: string, name: string): void {
    if (id === this.state.projectId) {
      this.rename(name);
      return;
    }
    const p = this.library.load(id);
    const clean = name.trim();
    if (!p || !clean) return;
    this.library.trackedStore().setItem(projectKey(id), serializeProject({ ...p, name: clean, updatedAt: this.now() }));
  }

  deleteProject(id: string): void {
    if (id === this.state.projectId) {
      const next = this.library.list().find((m) => m.id !== id);
      if (next) this.openProject(next.id);
      else this.newProject();
    }
    this.library.remove(id);
  }

  /** 导入工程文件（v3 JSON，也认旧版 v1 / v2） */
  importProjectFile(text: string, fallbackName = '导入的作品'): boolean {
    try {
      const p = deserializeProject(text);
      const project = { ...p, name: p.name || fallbackName, updatedAt: this.now() };
      this.switchTo(this.library.create(project), project);
      return true;
    } catch (e) {
      this.notify(`导入失败：${(e as Error).message}`);
      return false;
    }
  }

  // ---------- 查询（给界面） ----------

  /** 选中的字所在的格（填字面板 / 候选用） */
  cursorCell(): { key: string; global: number; beat: number } | null {
    const s = this.state;
    if (s.selection.length === 1) {
      const { barId, beat } = parseCellKey(s.selection[0]);
      const g = allBars(this.grid).findIndex((b) => b.data.id === barId);
      if (g >= 0) return { key: s.selection[0], global: g, beat };
    }
    if (s.cursor === null) return null;
    const a = locateTick(this.grid, s.cursor);
    const w = findWordAt(this.grid, s.cursor);
    if (!a || !w) return null;
    const g = Math.floor(s.cursor / TICKS_PER_BAR);
    const beat = Math.floor(a.tick / TICKS_PER_BEAT);
    return { key: cellKey(w.barId, beat), global: g, beat };
  }

  mismatchCount(): number {
    return mismatches(this.grid, this.doc.rules, this.doc.paint).length;
  }

  canPaintKey(key: string): boolean {
    return canPaint(this.grid, key).ok;
  }
}

function findWordAt(grid: Grid, abs: number) {
  const w = wordStartingAt(grid, abs);
  return w ? findWord(grid, w.word.id) : null;
}
