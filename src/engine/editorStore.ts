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
  copyFlowToNextBar,
  fillRest,
  mergeSquare,
  resetFlow,
  restSquare,
  splitSquare,
  squareAt,
  squareBox,
  squareName,
  typeIntoSquares,
  wordAt,
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
  findWord,
  History,
  hasAnyText,
  holdInto,
  insertBars,
  insertSection,
  isBlankFlow,
  isCellLocked,
  locateTick,
  lockedWordTicks,
  MAX_BEAT_CHARS,
  mismatches,
  paintCells,
  parseCellKey,
  previewRhymeMatch,
  RHYME_MATCH_NAMES,
  rhymeMatchOf,
  switchRhymeMatch,
  zheName,
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
  setBeatText,
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
  type RecolorInfo,
  type RhymeMatchMode,
  type RhymeMatchPreview,
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
/** 点格子时的选法（整列只能点拍头选，不再是一种选法） */
export type SelMode = 'cell' | 'row' | 'box';

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
  /** 点拍头选中的是第几拍整列（拍头高亮用）；选了别的就清掉 */
  selColumn: number | null;
  /** 框选的第一个角 */
  anchor: { bar: number; beat: number } | null;
  /** 选中的字（全曲绝对起点） */
  cursor: number | null;
  /** 正在改字的那一拍（双击格子 / 选中字按回车） */
  editing: { key: string; global: number; beat: number } | null;
  /** 第 1 步正在改的方格（字的全曲起点）；rest 不是 null 时光标停在一段空音上（长度 rest） */
  flowEdit: { abs: number; rest: number | null } | null;
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
/** 两下空格算「空音」的时间窗（毫秒，按 keydown 的 timeStamp 量） */
export const DOUBLE_SPACE_MS = 400;
export const BPM_MAX = 220;

const browserTimers: TimerApi = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

function docOf(p: Project): Doc {
  return { bpm: p.bpm, offsetMs: p.offsetMs, beat: p.beat, grid: p.grid, rules: p.rules, paint: p.paint, locks: p.locks, ...(p.rhymeMatch ? { rhymeMatch: p.rhymeMatch } : {}) };
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
  /** 第 1 步上一下空格：时间、按在哪个方格、有没有真的分开、分开后的那份 Doc（两下空格时用来确认能撤回） */
  private lastSpace: { at: number; abs: number; split: Doc | null } | null = null;

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

  /** 作品的判押韵档（没有字段的旧作品 = 严格） */
  get rhymeMatch(): RhymeMatchMode {
    return rhymeMatchOf(this.state.doc);
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
      // 一个字都没写的作品打开在第 1 步（铺 flow），写过字的打开在第 2 步
      step: hasAnyText(p.grid) ? 2 : 1,
      precision: '1/16',
      activeRule: p.rules[0]?.id ?? null,
      selMode: 'cell',
      invert: false,
      selection: [],
      selColumn: null,
      anchor: null,
      cursor: null,
      editing: null,
      flowEdit: null,
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
    this.lastSpace = null;
    const doc = this.history.undo();
    this.set({ doc, history: this.historyView(), holdTip: null, editing: null, flowEdit: this.refocus(doc.grid) }, true);
  }

  redo(): void {
    if (!this.history.canRedo) return;
    this.lastSpace = null;
    const doc = this.history.redo();
    this.set({ doc, history: this.historyView(), holdTip: null, editing: null, flowEdit: this.refocus(doc.grid) }, true);
  }

  /** 撤销 / 重做后光标还停在原来的位置：那里有方格就是方格，是空白就是空音，都不是就退出改字 */
  private refocus(grid: Grid): EditorState['flowEdit'] {
    const f = this.state.flowEdit;
    if (!f) return null;
    if (wordStartingAt(grid, f.abs)) return { abs: f.abs, rest: null };
    const len = restLenAt(grid, f.abs);
    return len ? { abs: f.abs, rest: f.rest !== null ? Math.min(f.rest, len) : len } : null;
  }

  // ---------- 步骤 / 精度 ----------

  setStep(step: Step): void {
    if (step !== this.state.step) this.set({ step, editing: null, flowEdit: null, holdTip: null, selection: [], selColumn: null, anchor: null });
  }

  setPrecision(precision: Precision): void {
    this.set({ precision });
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

  /** 清空全部 flow：段落、小节都留着，每一拍变回一个空方格（文字、拖音清掉），算一步 */
  clearAllFlow(): boolean {
    this.lastSpace = null;
    return this.exec('铺 flow 清空全部 flow（每拍一个方格）', 'flow', (d) => ({ ...d, grid: resetFlow(d.grid) }), { cursor: null, flowEdit: null, selection: [], selColumn: null });
  }

  // ---------- 第 1 步：方格（v3.2） ----------

  private squareWhere(abs: number): string {
    return cellName(Math.floor(abs / TICKS_PER_BAR), Math.floor((abs % TICKS_PER_BAR) / TICKS_PER_BEAT));
  }

  /** 第 1 步点格子：点在方格上 → 改这个方格；点在空白上 → 按精度放一个方格（v3.1 的放字规则）再改它 */
  flowPick(absTick: number): void {
    this.lastSpace = null;
    const hit = squareAt(this.grid, absTick);
    if (hit !== null) {
      this.set({ flowEdit: { abs: hit, rest: null }, cursor: hit, holdTip: null, selection: [], selColumn: null });
      return;
    }
    const at = snapTick(absTick, this.state.precision);
    if (wordStartingAt(this.grid, at) || this.exec(`铺 flow ${this.squareWhere(at)}放一个方格`, 'flow', (d) => ({ ...d, grid: placeWord(d.grid, at, this.state.precision) }))) {
      this.set({ flowEdit: { abs: at, rest: null }, cursor: at, holdTip: null, selection: [], selColumn: null });
    }
  }

  /** 退出改方格（Enter / Esc / 点别处） */
  endFlowEdit(): void {
    this.lastSpace = null;
    if (this.state.flowEdit) this.set({ flowEdit: null });
  }

  /** 两下空格之间按了别的键：不再等第二下 */
  resetSpace(): void {
    this.lastSpace = null;
  }

  /** 在光标方格里打字（输入法上屏的一整串也走这里）：写进这一格，多的字往后填这一拍里的方格；空音里打字 = 放回方格并写上字 */
  typeSquare(raw: string): void {
    this.lastSpace = null;
    const f = this.state.flowEdit;
    const chars = Array.from(raw.replace(/\s+/g, ''));
    if (!f || !chars.length) return;
    if (f.rest !== null) {
      const r = fillRest(this.grid, f.abs, f.rest, chars[0]);
      if (r.ok && this.exec(`铺 flow ${this.squareWhere(f.abs)}空音放回方格「${chars[0]}」`, 'flow', (d) => ({ ...d, grid: r.grid }))) {
        this.set({ flowEdit: { abs: f.abs, rest: null }, cursor: f.abs });
        if (chars.length > 1) this.notify(`一格一个字：多打的 ${chars.length - 1} 个字没写`);
      }
      return;
    }
    const r = typeIntoSquares(this.grid, f.abs, chars);
    if (!r.written) return;
    this.exec(`填字 ${this.squareWhere(f.abs)}「${chars.slice(0, r.written).join('')}」`, 'fill', (d) => ({ ...d, grid: r.grid }));
    if (r.dropped) this.notify(`这一拍后面没有方格了：多打的 ${r.dropped} 个字没写（不会写进下一拍）`);
  }

  /** 一分为 n（2 = 空格，3 = Shift+空格）；光标留在第一块。返回分了没有 */
  splitFocus(n: 2 | 3, viaSpace = false): boolean {
    if (!viaSpace) this.lastSpace = null;
    const f = this.state.flowEdit;
    if (!f || f.rest !== null) return false;
    const loc = wordStartingAt(this.grid, f.abs);
    if (!loc) return false;
    const b = squareBox(loc.word);
    const r = splitSquare(this.grid, f.abs, n);
    if (!r.ok) {
      if (r.reason === 'finest') this.notify('已经是 1/32，最细了，不能再分。要空音按两下空格；要合回去按 ⌫');
      else if (r.reason === 'triplet') this.notify(`${squareName(b)}的格子分不成三连（每块会比 1/32 还细，或者分不均）`);
      return false;
    }
    const what = n === 2 ? `一分二（${squareName(b)} → 两个 ${squareName(b / 2)}）` : `分成三连（${squareName(b)} → 3 个 ${squareName(b / 3)}）`;
    return this.exec(`铺 flow ${this.squareWhere(f.abs)}${what}`, 'flow', (d) => ({ ...d, grid: r.grid }), { cursor: f.abs });
  }

  /**
   * 空格键（at = keydown 的 timeStamp）：一分二；0.4 秒内同一格的第二下 → 撤回刚才那一下分格，这一格变成空音，合起来只算历史里的一步。
   * 第一下没分成（例如 1/32），第二下照样变成空音。
   */
  spaceKey(at: number): void {
    const f = this.state.flowEdit;
    const last = this.lastSpace;
    this.lastSpace = null;
    if (!f) return;
    if (last && last.abs === f.abs && at >= last.at && at - last.at <= DOUBLE_SPACE_MS) {
      const undid = !!last.split && this.history.state === last.split && this.history.canUndo;
      if (last.split && !undid) return;
      if (undid) {
        this.history.undo();
        this.state = { ...this.state, doc: this.history.state };
      }
      if (!this.restFocusNow(f.abs) && undid) this.history.redo();
      this.set({ doc: this.history.state, history: this.historyView() }, true);
      return;
    }
    if (f.rest !== null) return;
    const ok = this.splitFocus(2, true);
    this.lastSpace = { at, abs: f.abs, split: ok ? this.history.state : null };
  }

  private restFocusNow(abs: number): boolean {
    const loc = wordStartingAt(this.grid, abs);
    if (!loc) return false;
    const len = squareBox(loc.word);
    const r = restSquare(this.grid, abs);
    if (!r.ok) return false;
    const half = abs % TICKS_PER_BEAT === 0 && len === TICKS_PER_BEAT ? '' : `里 ${squareName(len)} 那一格`;
    return this.exec(`铺 flow ${this.squareWhere(abs)}${half} → 空音`, 'flow', (d) => ({ ...d, grid: r.grid }), { flowEdit: { abs, rest: len }, cursor: null });
  }

  /** 气泡里的「空音」按钮：直接变成空音（一步） */
  restFocus(): void {
    this.lastSpace = null;
    const f = this.state.flowEdit;
    if (f && f.rest === null) this.restFocusNow(f.abs);
  }

  /** ⌫：方格有字先清字；空方格（或空音）和另一半合并 */
  backspaceSquare(): void {
    this.lastSpace = null;
    const f = this.state.flowEdit;
    if (!f) return;
    const loc = f.rest === null ? wordStartingAt(this.grid, f.abs) : null;
    if (loc?.word.text) {
      this.exec(`填字 删掉${this.squareWhere(f.abs)}「${loc.word.text}」`, 'fill', (d) => ({ ...d, grid: setWordText(d.grid, loc.word.id, '') }));
      return;
    }
    const r = mergeSquare(this.grid, f.abs, f.rest ?? undefined);
    if (!r.ok) {
      const why: Record<string, string> = {
        whole: '整拍一个方格，不能再合；要空音按两下空格',
        finer: '旁边那一半分得更细，先把它合回来',
        'both-text': '要合的几格都有字，先删掉多的字',
        hold: '前面是上一拍拖过来的音，合不了',
        'no-square': '旁边都是空音，没有可以合的方格',
      };
      this.notify(why[r.reason] ?? '合不了');
      return;
    }
    const after = wordStartingAt(r.grid, r.focus);
    const size = after ? squareName(squareBox(after.word)) : '';
    this.exec(`铺 flow ${this.squareWhere(r.focus)}合并成一个 ${size}`, 'flow', (d) => ({ ...d, grid: r.grid }), { flowEdit: { abs: r.focus, rest: null }, cursor: r.focus });
  }

  /** Tab / 方向键：光标去下一个（上一个）方格，可以跨拍、跨小节 */
  moveSquare(dx: number): void {
    this.lastSpace = null;
    const f = this.state.flowEdit;
    const starts = this.wordStarts();
    if (!starts.length) return;
    const from = f?.abs ?? this.state.cursor ?? -1;
    const next = dx > 0 ? starts.find((t) => t > from) : [...starts].reverse().find((t) => t < from);
    if (next === undefined) return;
    this.set({ flowEdit: { abs: next, rest: null }, cursor: next });
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

  /** 双击格子：改这一拍的字（只有拖音 / 空着的格子也能改：打了字就按字数平分这一拍） */
  editCell(global: number, beat: number): void {
    const bar = barAt(this.grid, global);
    if (!bar || beat < 0 || beat > 3) return;
    const key = cellKey(bar.id, beat);
    this.set({ editing: { key, global, beat }, selection: [key], selColumn: null, anchor: null, holdTip: null });
  }

  /** 选中的字按回车：改它所在那一拍 */
  startEdit(abs: number): void {
    const w = wordStartingAt(this.grid, abs);
    if (!w) return;
    this.set({ cursor: abs });
    this.editCell(w.global, Math.floor(w.word.tick / TICKS_PER_BEAT));
  }

  cancelEdit(): void {
    if (this.state.editing !== null) this.set({ editing: null });
  }

  /** 一拍改字的规则说明（输入框下面实时显示、回车后被拒时提示） */
  beatTextPlan(global: number, beat: number, raw: string): { n: number; slots: number; how: 'fill' | 'split' | 'clear' | 'too-many' | 'locked' } {
    const chars = Array.from(raw.replace(/\s+/g, ''));
    const bar = barAt(this.grid, global);
    const slots = bar ? bar.words.filter((w) => Math.floor(w.tick / TICKS_PER_BEAT) === beat).length : 0;
    if (!bar) return { n: chars.length, slots, how: 'too-many' };
    const r = setBeatText(this.grid, global, beat, chars, this.beatLocks(bar.id, beat));
    if (!r.ok) return { n: chars.length, slots, how: r.reason };
    return { n: chars.length, slots, how: chars.length ? r.how : 'clear' };
  }

  private beatLocks(barId: string, beat: number) {
    return { cellLocked: isCellLocked(this.doc.locks, barId, beat), lockedAbs: lockedWordTicks(this.grid, this.doc) };
  }

  /**
   * 回车：把这一拍的字改成 raw（core/grid 的 setBeatText，永远不碰下一拍），一次算历史里一步。
   * 打了几个字就排几个字；位置不够又超过 4 个字、或者要重排的地方锁着，什么都不写、出提示。返回是否写了。
   */
  commitBeatText(global: number, beat: number, raw: string): boolean {
    const chars = Array.from(raw.replace(/\s+/g, ''));
    this.set({ editing: null });
    const bar = barAt(this.grid, global);
    if (!bar) return false;
    const where = cellName(global, beat);
    const r = setBeatText(this.grid, global, beat, chars, this.beatLocks(bar.id, beat));
    if (!r.ok) {
      if (r.reason === 'too-many')
        this.notify(`一拍最多 ${MAX_BEAT_CHARS} 个字（这次打了 ${chars.length} 个），什么都没写。要更密的节奏，先到「① 铺 flow」把${where}分细`);
      else this.notify(`${where}有锁住的字，不能重新分；先解锁，或者只打 ${r.slots} 个字以内`);
      return false;
    }
    const label = chars.length ? `填字 ${where}「${chars.join('')}」` : `填字 清空${where}的字`;
    const ok = this.exec(label, 'fill', (d) => ({ ...d, grid: r.grid }));
    if (ok && r.written.length) this.set({ cursor: r.written[r.written.length - 1] });
    return ok;
  }

  /** 改一个字的文字（选中字按 ⌫ 清掉、测试里直接填一个字用）：一个位置只放一个字，不会写到别的位置 */
  commitText(abs: number, raw: string): void {
    const chars = Array.from(raw.replace(/\s+/g, ''));
    const w = wordStartingAt(this.grid, abs);
    this.set({ editing: null });
    if (!w) return;
    if (chars.length > 1) {
      this.notify('一个位置只放一个字；要改一整拍，双击那一格');
      return;
    }
    const text = chars[0] ?? '';
    if (text === w.word.text) return;
    const label = text ? `填字 第 ${w.global + 1} 小节「${text}」` : `填字 删掉第 ${w.global + 1} 小节「${w.word.text}」`;
    if (this.exec(label, 'fill', (d) => ({ ...d, grid: setWordText(d.grid, w.word.id, text) })) && text) {
      const next = this.wordStarts().find((t) => t > abs);
      this.set({ cursor: next ?? abs });
    }
  }

  /** 候选词填进一格的韵脚位置（最后 n 个字） */
  fillRhyme(key: string, word: string): void {
    const slots = rhymeSlots(this.grid, this.doc.rules, this.doc.paint, this.rhymeMatch).filter((s) => s.key === key);
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
    this.lastSpace = null;
    this.set({ selection: [], selColumn: null, anchor: null, holdTip: null, cursor: null, editing: null, flowEdit: null });
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
      this.set({ holdTip: this.holdTipFor(global, beat), selection: s.invert ? s.selection : [], selColumn: null });
      return;
    }
    let selection: string[];
    let anchor = s.anchor;
    if (s.invert && s.selection.length) selection = toggleKeys(s.selection, [key]);
    else if (s.selMode === 'row') selection = rowKeys(this.grid, global);
    else if (s.selMode === 'box') {
      if (anchor) {
        selection = boxKeys(this.grid, anchor, { bar: global, beat });
        anchor = null;
      } else {
        selection = [key];
        anchor = { bar: global, beat };
      }
    } else selection = [key];
    this.set({ selection, selColumn: null, anchor, holdTip: null });
  }

  /** 点小节号：选中整行（不改「选格子」的选法，之后点格子照旧按原来的选法） */
  selectRow(global: number): void {
    this.set({ selection: rowKeys(this.grid, global), selColumn: null, anchor: null, holdTip: null });
  }

  /**
   * 点拍头：选中整首这一拍里有东西的格子（有字，或有前面拖过来的音）；完全空的格子不选。
   * 整首这一拍都还空着时才选全部（好让空作品也能锁整列）。不改「选格子」的选法。
   */
  selectColumn(beat: number): void {
    const bars = allBars(this.grid);
    const filled = bars.filter((b) => cellContent(this.grid, b.global, beat) !== 'empty');
    const selection = (filled.length ? filled : bars).map((b) => cellKey(b.data.id, beat));
    this.set({ selection, selColumn: beat, anchor: null, holdTip: null });
  }

  selectBox(a: { bar: number; beat: number }, b: { bar: number; beat: number }): void {
    this.set({ selection: boxKeys(this.grid, a, b), selColumn: null, anchor: null, holdTip: null, selMode: 'box' });
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
    const rule = (id: string) => before.rules.find((x) => x.id === id);
    const name = (id: string) => {
      const r = rule(id);
      return r ? ruleName(r) : '另一种颜色';
    };
    if (rhymeMatchOf(before) === 'thirteen') {
      // 十三辙：「绿色（ian）和蓝色（an）都是言前辙，已合并成蓝色（12 格从绿变蓝），可以撤销」
      return (
        merged
          .map((m) => {
            const a = rule(m.removed);
            const b = rule(m.kept);
            const zhe = b ? b.finals.map((f) => zheName(f) ?? f).join(' · ') : '同一个韵';
            const cells = Object.values(before.paint).filter((v) => v === m.removed).length;
            const recolor = a && b && a.hue !== b.hue && cells ? `（${cells} 格从${name(m.removed)}变${name(m.kept)}）` : '';
            return `${name(m.removed)}（${a?.finals.join(' · ') ?? ''}）和${name(m.kept)}（${b?.finals.join(' · ') ?? ''}）都是${zhe}，已合并成${name(m.kept)}${recolor}`;
          })
          .join('；') + '，可以撤销'
      );
    }
    return merged.map((m) => `${name(m.removed)}和${name(m.kept)}押的是同一个韵，已合并成${name(m.kept)}`).join('；') + '（可以撤销）';
  }

  addRule(): void {
    const r = addRule(this.doc, this.rhymeMatch);
    if (!r.rule) {
      this.notify('最多 8 种颜色');
      return;
    }
    const rule = r.rule;
    this.exec(`涂色 新建${ruleName(rule)}`, 'paint', (d) => ({ ...d, rules: r.rules, paint: r.paint }), { activeRule: rule.id });
  }

  private changeRule(id: string, patch: { count?: number; finals?: string[] }, label: string): void {
    const before = this.doc;
    const r = updateRule(before, id, patch, this.rhymeMatch);
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

  // ---------- 判押韵的档（DESIGN_v34 §4.6 / §4.7） ----------

  /** 旧作品（没有 rhymeMatch 字段）而且有颜色规则：顶上出迁移横幅 */
  needsRhymeMigration(): boolean {
    return this.doc.rhymeMatch === undefined && this.doc.rules.length > 0;
  }

  /** 改成另一档会怎样（横幅 / 右栏上的数字）：「不押」少几处、哪些颜色合并、哪些格子变色 */
  rhymeMatchPreview(to: RhymeMatchMode = 'thirteen'): RhymeMatchPreview {
    return previewRhymeMatch(this.grid, this.doc, this.rhymeMatch, to);
  }

  /** 改判押韵的档：换档 + 按新档合并同韵颜色，算一步（撤销一次回到原样） */
  setRhymeMatch(mode: RhymeMatchMode): boolean {
    const before = this.doc;
    if (before.rhymeMatch === mode) return false;
    const preview = previewRhymeMatch(this.grid, before, rhymeMatchOf(before), mode);
    const r = switchRhymeMatch(before, mode);
    const active = this.state.activeRule;
    const kept = active ? r.merged.find((m) => m.removed === active)?.kept : undefined;
    const merge = r.merged.length ? `，${preview.rulesBefore} 条规则合并成 ${preview.rulesAfter} 种颜色` : '';
    const ok = this.exec(`判押韵 改成${RHYME_MATCH_NAMES[mode]}${merge}`, 'paint', (d) => ({ ...d, rules: r.rules, paint: r.paint, rhymeMatch: mode }), kept ? { activeRule: kept } : {});
    if (ok) this.notify(this.rhymeMatchNotice(mode, preview, before));
    return ok;
  }

  /** 迁移横幅点「先不改」：在作品里写下 strict（一步），以后不再问；右栏随时能切 */
  dismissRhymeMigration(): boolean {
    if (this.doc.rhymeMatch !== undefined) return false;
    const ok = this.exec('判押韵 先不改（保持严格韵母）', 'paint', (d) => ({ ...d, rhymeMatch: 'strict' }));
    if (ok) this.notify('保持严格韵母判押韵，以后不再问；右栏「判押韵」随时能改');
    return ok;
  }

  private rhymeMatchNotice(mode: RhymeMatchMode, p: RhymeMatchPreview, before: Doc): string {
    const parts = [`改成${RHYME_MATCH_NAMES[mode]}判押韵`];
    if (p.missBefore !== p.missAfter) parts.push(`「不押」${p.missBefore} → ${p.missAfter} 处`);
    if (p.merged.length) parts.push(`${p.rulesBefore} 条规则合并成 ${p.rulesAfter} 种颜色`);
    if (p.merged.length) parts.push(p.recolorCells ? recolorText(p.merged, before) : '格子颜色都不变');
    return parts.join('，') + '（可以撤销）';
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
    // 只有新作品默认的每拍一个空方格、还没铺 flow 也没写字：当成空工程，不弹窗
    const hasWords = !isBlankFlow(this.grid);
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
    return mismatches(this.grid, this.doc.rules, this.doc.paint, this.rhymeMatch).length;
  }

  canPaintKey(key: string): boolean {
    return canPaint(this.grid, key).ok;
  }
}

/** 不同色相合并会变色时逐条写出「绿色并进蓝色：12 格从绿色变蓝色」 */
export function recolorText(merged: RecolorInfo[], before: Pick<Doc, 'rules'>): string {
  const name = (id: string) => {
    const r = before.rules.find((x) => x.id === id);
    return r ? ruleName(r) : '另一种颜色';
  };
  return merged
    .filter((m) => m.recolor && m.cells)
    .map((m) => `${name(m.removed)}并进${name(m.kept)}：${m.cells} 格从${name(m.removed)}变${name(m.kept)}`)
    .join('；');
}

/** 迁移横幅上那几个数字的长句：「全曲 56 处『不押』会消失，格子颜色不变」 */
export function migrationSummary(p: RhymeMatchPreview, rules: Doc['rules']): string {
  const parts: string[] = [];
  if (p.missBefore > p.missAfter) parts.push(p.missAfter === 0 ? `全曲 ${p.missBefore} 处「不押」会消失` : `全曲「不押」从 ${p.missBefore} 处变成 ${p.missAfter} 处`);
  if (p.merged.length) parts.push(`${p.rulesBefore} 条规则里同辙的会合并成 ${p.rulesAfter} 种颜色`);
  if (p.recolorCells) parts.push(recolorText(p.merged, { rules }));
  else if (parts.length) parts.push(p.merged.length ? '格子颜色都不变' : '格子颜色不变');
  if (!parts.length) parts.push('现在的「不押」和颜色都不变，以后 an / ian / uan / üan 这类同辙的都算押上');
  return parts.join('，');
}

/** abs 这里是空白（没有字在发声）时，到下一个字 / 这一拍末尾有多长；不是空白返回 0 */
function restLenAt(grid: Grid, abs: number): number {
  if (wordAt(grid, abs)) return 0;
  const beatEnd = (Math.floor(abs / TICKS_PER_BEAT) + 1) * TICKS_PER_BEAT;
  let end = beatEnd;
  const bar = barAt(grid, Math.floor(abs / TICKS_PER_BAR));
  for (const w of bar?.words ?? []) {
    const a = Math.floor(abs / TICKS_PER_BAR) * TICKS_PER_BAR + w.tick;
    if (a > abs && a < end) end = a;
  }
  return end - abs;
}

function findWordAt(grid: Grid, abs: number) {
  const w = wordStartingAt(grid, abs);
  return w ? findWord(grid, w.word.id) : null;
}
