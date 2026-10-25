/**
 * 编辑器状态：界面和 src/core 之间唯一的一层。
 *
 * - 歌词数据就是 core 的 Grid，所有改动都是 core/grid 的纯函数，经 core/history 的 History 执行（可撤销）。
 * - 鼠标手势走 core/cellGesture（单击编辑、双击重音）。
 * - 工程元数据 + Grid 组成 core/project 的 Project，交给 core/autosave 落盘（经 StorageAdapter / 作品库）。
 * - 不依赖 React：组件用 useSyncExternalStore 订阅 getState()。
 */

import {
  absoluteStep,
  clipAt,
  copyClips,
  createAutosave,
  createSection,
  deleteBars,
  deleteClips,
  deleteSection,
  deserializeProject,
  duplicateSection,
  findClip,
  History,
  initialGestureState,
  insertBars,
  insertClip,
  insertSection,
  iterateClips,
  locateStep,
  moveBar,
  moveClip,
  pasteClips,
  reduceGesture,
  serializeProject,
  SECTION_KIND_NAMES,
  STEPS_PER_BAR,
  toggleAccent,
  totalSteps,
  updateClip,
  updateSection,
  type Autosave,
  type Bar,
  type BarAddress,
  type ClipboardItem,
  type GestureEvent,
  type GestureState,
  type Grid,
  type KeyValueStore,
  type Project,
  type SectionKind,
  type StepAddress,
  type TimerApi,
} from '../core';
import type { AiTask } from '../ai';
import { projectKey, type ProjectLibrary } from '../storage/library';
import type { StorageAdapter } from '../storage/StorageAdapter';
import { emptyProject, EXAMPLES, nightDriveProject, type ExampleKey } from './demo';
import { barText } from './view';

export interface Selection {
  /** 全曲绝对 1/16 位置 */
  anchor: number;
  focus: number;
}

export type SaveStatus =
  | { kind: 'saved'; at: number | null }
  | { kind: 'pending' }
  | { kind: 'memory'; reason: string }
  | { kind: 'error'; message: string };

export interface AiPreview {
  task: AiTask;
  /** fill：从 at 起往后填（空小节直接填，不够就插新小节）；replace：替换 at 这一小节 */
  mode: 'fill' | 'replace';
  section: number;
  /** 段落内第几小节 */
  at: number;
  bars: Bar[];
  lines: string[];
  /** replace 时原来的文字 */
  before: string[];
  createdAt: number;
  warnings: string[];
}

export interface EditorState {
  projectId: string;
  name: string;
  createdAt: number;
  bpm: number;
  /** BPM 来自伴奏自动检测（还没手动改过） */
  bpmAuto: boolean;
  offsetMs: number;
  grid: Grid;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  undoDepth: number;
  selection: Selection | null;
  gesture: GestureState;
  save: SaveStatus;
  preview: AiPreview | null;
  clipboard: number;
  /** 最近一次提示（导入失败等），界面显示一会儿 */
  notice: { text: string; at: number } | null;
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

export class EditorStore {
  private readonly storage: StorageAdapter;
  private readonly library: ProjectLibrary;
  private readonly timers: TimerApi;
  private readonly now: () => number;
  private readonly debounceMs: number;
  private history: History<Grid>;
  private autosave!: Autosave;
  private depth = 0;
  private clip: ClipboardItem[] = [];
  private listeners = new Set<() => void>();
  private state: EditorState;

  constructor(options: EditorStoreOptions) {
    this.storage = options.storage;
    this.library = options.library;
    this.timers = options.timers ?? browserTimers;
    this.now = options.now ?? (() => Date.now());
    this.debounceMs = options.debounceMs ?? 1000;

    this.library.migrateLegacy();
    let id = this.library.currentId ?? this.library.list()[0]?.id ?? null;
    let project = id ? this.library.load(id) : null;
    if (!id || !project) {
      // 第一次打开：放视觉稿里那首「夜车」，打开就是稿子的样子
      project = nightDriveProject(this.now());
      id = this.library.create(project);
    }
    this.library.setCurrent(id);
    this.history = new History(project.grid);
    this.state = this.initialState(id, project);
    this.attachAutosave(id);
  }

  // ---------- 订阅 ----------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): EditorState => this.state;

  get project(): Project {
    const s = this.state;
    return { name: s.name, createdAt: s.createdAt, updatedAt: this.now(), bpm: s.bpm, offsetMs: s.offsetMs, grid: s.grid };
  }

  get persistent(): boolean {
    return this.storage.persistent;
  }

  private set(patch: Partial<EditorState>, dirty = false) {
    this.state = { ...this.state, ...patch };
    if (dirty) {
      this.autosave.notify(this.project);
      if (this.storage.persistent && this.state.save.kind !== 'error') this.state = { ...this.state, save: { kind: 'pending' } };
    }
    for (const l of this.listeners) l();
  }

  private initialState(projectId: string, p: Project): EditorState {
    return {
      projectId,
      name: p.name,
      createdAt: p.createdAt,
      bpm: p.bpm,
      bpmAuto: false,
      offsetMs: p.offsetMs,
      grid: p.grid,
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      redoLabel: null,
      undoDepth: 0,
      selection: null,
      gesture: initialGestureState,
      save: this.storage.persistent
        ? { kind: 'saved', at: p.updatedAt || null }
        : { kind: 'memory', reason: this.storage.reason ?? '拿不到本机存储' },
      preview: null,
      clipboard: this.clip.length,
      notice: null,
    };
  }

  private attachAutosave(id: string) {
    const tracked = this.library.trackedStore();
    const store: KeyValueStore = {
      getItem: (k) => tracked.getItem(k),
      removeItem: (k) => tracked.removeItem(k),
      setItem: (k, v) => {
        tracked.setItem(k, v);
        if (this.storage.persistent) this.set({ save: { kind: 'saved', at: this.now() } });
      },
    };
    this.autosave = createAutosave({
      store,
      timers: this.timers,
      key: projectKey(id),
      debounceMs: this.debounceMs,
      onError: (e) => this.set({ save: { kind: 'error', message: (e as Error)?.message || '保存失败' } }),
    });
  }

  /** 立即落盘（⌘S、页面关闭） */
  flush(): void {
    this.autosave.flush();
  }

  // ---------- 撤销 / 重做 ----------

  private syncHistory(extra: Partial<EditorState> = {}) {
    const h = this.history;
    this.set(
      {
        grid: h.state,
        canUndo: h.canUndo,
        canRedo: h.canRedo,
        undoLabel: h.undoLabel,
        redoLabel: h.redoLabel,
        undoDepth: this.depth,
        ...extra,
      },
      true,
    );
  }

  /** 执行一条歌词命令（core/history）；命令抛错（越界等）时什么都不变 */
  exec(label: string, apply: (g: Grid) => Grid, extra: Partial<EditorState> = {}): boolean {
    const before = this.history.state;
    try {
      this.history.execute({ label, apply });
    } catch (e) {
      this.notify(`没做成：${(e as Error).message}`);
      return false;
    }
    if (this.history.state === before) return false;
    this.depth = Math.min(this.depth + 1, 200);
    this.syncHistory(extra);
    return true;
  }

  undo(): void {
    if (!this.history.canUndo) return;
    this.history.undo();
    this.depth = Math.max(0, this.depth - 1);
    this.syncHistory({ preview: null });
  }

  redo(): void {
    if (!this.history.canRedo) return;
    this.history.redo();
    this.depth += 1;
    this.syncHistory({ preview: null });
  }

  notify(text: string): void {
    this.set({ notice: { text, at: this.now() } });
  }

  // ---------- 选择与手势 ----------

  private clampAbs(abs: number): number {
    const total = totalSteps(this.state.grid);
    return Math.max(0, Math.min(total - 1, abs));
  }

  select(abs: number, extend = false): void {
    const a = this.clampAbs(abs);
    const sel = this.state.selection;
    this.set({ selection: extend && sel ? { anchor: sel.anchor, focus: a } : { anchor: a, focus: a } });
  }

  clearSelection(): void {
    this.set({ selection: null, gesture: initialGestureState });
  }

  /** 方向键：dx 格 / dy 小节 */
  moveFocus(dx: number, dy: number, extend = false): void {
    const sel = this.state.selection;
    if (!sel) {
      this.select(0);
      return;
    }
    this.select(sel.focus + dx + dy * STEPS_PER_BAR, extend);
  }

  selectionRange(): [number, number] | null {
    const sel = this.state.selection;
    if (!sel) return null;
    return [Math.min(sel.anchor, sel.focus), Math.max(sel.anchor, sel.focus)];
  }

  /** 单击 / 双击都走 core/cellGesture：单击选中并进入编辑，双击切换重音 */
  gesture(event: GestureEvent): void {
    const r = reduceGesture(this.state.gesture, event);
    let selection = this.state.selection;
    if (event.type === 'click' || event.type === 'dblclick') {
      const abs = Number(event.target.id);
      selection = { anchor: abs, focus: abs };
    }
    this.set({ gesture: r.state, selection });
    for (const fx of r.effects) if (fx.type === 'toggleAccent') this.toggleAccentAt(Number(fx.id));
  }

  slotHasText(abs: number): boolean {
    const addr = locateStep(this.state.grid, abs);
    const c = addr ? clipAt(this.state.grid, addr) : null;
    return !!c && !c.hold && !!c.text;
  }

  /** 键盘 Enter：在选中格打开编辑框 */
  editFocused(): void {
    const sel = this.state.selection;
    if (!sel) return;
    this.gesture({ type: 'click', target: { id: String(sel.focus), hasText: this.slotHasText(sel.focus) } });
  }

  /** 编辑框提交：写入文字，选中格移到写完的后面一格 */
  commitEdit(text: string): void {
    const editing = this.state.gesture.editing;
    this.gesture({ type: 'commit' });
    if (editing === null) return;
    const abs = Number(editing);
    const before = this.state.grid;
    const written = this.writeText(abs, text);
    if (this.state.grid !== before && written > 0) this.select(abs + written);
  }

  cancelEdit(): void {
    this.gesture({ type: 'cancel' });
  }

  // ---------- 写字 ----------

  /**
   * 在 abs 起写入文字，一格一个字；'-' 延音、'_' 空拍；空字符串 = 清掉这一格。
   * 起点格原来有片段时保留它的时长和重音（换字不换节奏）。返回占用了几格。
   */
  writeText(abs: number, raw: string): number {
    const addr = locateStep(this.state.grid, abs);
    if (!addr) return 0;
    const text = raw.replace(/\s+/g, '');
    if (!text) {
      this.clearSlots(abs, abs);
      return 0;
    }
    let used = 0;
    this.exec('输入歌词', (g) => {
      const r = writeAt(g, addr, text);
      used = r.used;
      return r.grid;
    });
    return used;
  }

  /** 在选中格写延音 / 空拍并右移（键盘 - 和 _） */
  markFocused(kind: 'hold' | 'rest'): void {
    const sel = this.state.selection;
    if (!sel) return;
    const addr = locateStep(this.state.grid, sel.focus);
    if (!addr) return;
    if (this.exec(kind === 'hold' ? '延音' : '空拍', (g) => place(g, addr, { length: 1, text: '', hold: kind === 'hold', accent: false })))
      this.select(sel.focus + 1);
  }

  toggleAccentAt(abs: number): void {
    const addr = locateStep(this.state.grid, abs);
    const c = addr ? clipAt(this.state.grid, addr) : null;
    if (!c || c.hold || !c.text) return;
    this.exec(c.accent ? '取消重音' : '标重音', (g) => toggleAccent(g, c.id));
  }

  toggleAccentFocused(): void {
    const sel = this.state.selection;
    if (sel) this.toggleAccentAt(sel.focus);
  }

  /** 删除 [from, to] 范围：起点在范围里的片段删掉，从前面伸进来的片段截短 */
  clearSlots(from: number, to: number): void {
    this.exec('删除', (g) => clearRange(g, from, to));
  }

  deleteSelection(): void {
    const r = this.selectionRange();
    if (r) this.clearSlots(r[0], r[1]);
  }

  // ---------- 复制粘贴 / 拖动 ----------

  copySelection(): number {
    const r = this.selectionRange();
    if (!r) return 0;
    const ids = clipIdsInRange(this.state.grid, r[0], r[1]);
    this.clip = copyClips(this.state.grid, ids);
    this.set({ clipboard: this.clip.length });
    return this.clip.length;
  }

  paste(): void {
    const r = this.selectionRange();
    if (!r || this.clip.length === 0) return;
    const at = locateStep(this.state.grid, r[0]);
    if (!at) return;
    const span = Math.max(...this.clip.map((c) => c.offset + c.length));
    const items = this.clip;
    if (this.exec('粘贴', (g) => pasteClips(clearRange(g, r[0], r[0]), at, items))) this.select(r[0] + span);
  }

  /** 格子拖到格子：移动覆盖源格的片段 */
  moveSlot(fromAbs: number, toAbs: number): void {
    if (fromAbs === toAbs) return;
    const g = this.state.grid;
    const from = locateStep(g, fromAbs);
    const to = locateStep(g, toAbs);
    const c = from ? clipAt(g, from) : null;
    if (!c || !to) return;
    const fit = { ...to, step: Math.min(to.step, STEPS_PER_BAR - c.length) };
    if (this.exec('移动片段', (x) => moveClip(x, c.id, fit))) this.select(absoluteStep(this.state.grid, fit));
  }

  /** 拖动小节号重排 */
  moveBarTo(from: BarAddress, to: BarAddress): void {
    if (from.section === to.section && from.bar === to.bar) return;
    this.exec('移动小节', (g) => moveBar(g, from, to), { selection: null });
  }

  // ---------- 小节 / 段落 ----------

  addBar(section = this.state.grid.sections.length - 1): void {
    const s = this.state.grid.sections[section];
    if (!s) return;
    this.exec('添加小节', (g) => insertBars(g, section, s.bars.length, 1));
  }

  deleteBar(section: number, bar: number): void {
    const s = this.state.grid.sections[section];
    if (!s || s.bars.length <= 1) {
      this.notify('段落里至少留一个小节；要删整段请用「删除段落」');
      return;
    }
    this.exec('删除小节', (g) => deleteBars(g, section, bar, 1), { selection: null, gesture: initialGestureState });
  }

  addSection(kind: SectionKind = 'verse'): void {
    const n = this.state.grid.sections.filter((s) => s.kind === kind).length + 1;
    const label = kind === 'verse' ? `主歌 ${n}` : SECTION_KIND_NAMES[kind];
    const index = this.state.grid.sections.length;
    this.exec('添加段落', (g) => insertSection(g, index, createSection(kind, 4, label)));
  }

  renameSection(index: number, label: string): void {
    const clean = label.trim();
    if (!clean || this.state.grid.sections[index]?.label === clean) return;
    this.exec('重命名段落', (g) => updateSection(g, index, { label: clean }));
  }

  setSectionKind(index: number, kind: SectionKind): void {
    this.exec('改段落类型', (g) => updateSection(g, index, { kind }));
  }

  duplicateSection(index: number): void {
    this.exec('复制段落', (g) => duplicateSection(g, index));
  }

  deleteSection(index: number): void {
    if (this.state.grid.sections.length <= 1) {
      this.notify('至少留一个段落');
      return;
    }
    this.exec('删除段落', (g) => deleteSection(g, index), { selection: null, gesture: initialGestureState });
  }

  clearLyrics(): void {
    this.exec('清空歌词', (g) => deleteClips(g, [...iterateClips(g)].map((c) => c.clip.id)), { selection: null });
  }

  // ---------- 工程元数据 ----------

  setBpm(bpm: number, auto = false): void {
    if (!Number.isFinite(bpm)) return;
    const v = Math.round(Math.max(BPM_MIN, Math.min(BPM_MAX, bpm)) * 100) / 100;
    if (v === this.state.bpm && auto === this.state.bpmAuto) return;
    this.set({ bpm: v, bpmAuto: auto }, true);
  }

  setOffsetMs(ms: number): void {
    const v = Math.round(Math.max(0, Math.min(5000, ms)));
    if (v !== this.state.offsetMs) this.set({ offsetMs: v }, true);
  }

  rename(name: string): void {
    const clean = name.trim();
    if (clean && clean !== this.state.name) this.set({ name: clean }, true);
  }

  // ---------- 作品库 ----------

  private switchTo(id: string, project: Project) {
    this.autosave.flush();
    this.library.setCurrent(id);
    this.history.reset(project.grid);
    this.depth = 0;
    this.attachAutosave(id);
    this.state = this.initialState(id, project);
    for (const l of this.listeners) l();
  }

  newProject(): void {
    const p = emptyProject(this.library.nextUntitledName(), this.now(), this.state.bpm);
    this.switchTo(this.library.create(p), p);
  }

  openProject(id: string): void {
    if (id === this.state.projectId) return;
    const p = this.library.load(id);
    if (!p) {
      this.notify('这个作品读不出来了');
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
    const tracked = this.library.trackedStore();
    tracked.setItem(projectKey(id), serializeProject({ ...p, name: clean, updatedAt: this.now() }));
  }

  deleteProject(id: string): void {
    if (id === this.state.projectId) {
      const next = this.library.list().find((m) => m.id !== id);
      if (next) this.openProject(next.id);
      else this.newProject();
    }
    this.library.remove(id);
  }

  /** 导入工程文件（v2 JSON，也认旧版 v1） */
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

  // ---------- AI 预览 ----------

  /** AI 上下文：已写的每小节一行 */
  writtenLines(): string[] {
    return this.state.grid.sections.flatMap((s) => s.bars.map(barText)).filter(Boolean);
  }

  /** 续写的位置：最后一个有字的小节后面 */
  continuePoint(): { section: number; at: number } {
    const g = this.state.grid;
    for (let s = g.sections.length - 1; s >= 0; s--) {
      const bars = g.sections[s].bars;
      for (let b = bars.length - 1; b >= 0; b--) if (barText(bars[b])) return { section: s, at: b + 1 };
    }
    return { section: 0, at: 0 };
  }

  setPreview(preview: Omit<AiPreview, 'createdAt'> | null): void {
    this.set({ preview: preview ? { ...preview, createdAt: this.now() } : null });
  }

  /** 采用预览（全部或第 i 行）。经 History 执行，采用后也能撤销 */
  adoptPreview(index?: number): void {
    const p = this.state.preview;
    if (!p) return;
    const picks = index === undefined ? p.bars.map((_, i) => i) : [index];
    const ok = this.exec(index === undefined ? 'AI 全部采用' : 'AI 采用一行', (g) => applyPreview(g, p, picks));
    if (!ok) return;
    if (index === undefined || p.mode === 'replace') {
      this.set({ preview: null });
      return;
    }
    // 只采用了一行：它落在预览的第一个位置，剩下的预览行往后顺延一小节
    const rest = p.bars.map((b, i) => ({ b, l: p.lines[i], i })).filter((x) => x.i !== index);
    if (rest.length === 0) this.set({ preview: null });
    else this.set({ preview: { ...p, at: p.at + 1, bars: rest.map((x) => x.b), lines: rest.map((x) => x.l) } });
  }
}

// ---------- 纯函数小工具（只组合 core 的操作） ----------

/** 把从前面伸进 addr.step 的片段截到 addr.step 为止 */
function carve(g: Grid, addr: StepAddress): Grid {
  const c = clipAt(g, addr);
  if (c && c.start < addr.step) return updateClip(g, c.id, { length: addr.step - c.start });
  return g;
}

function place(g: Grid, addr: StepAddress, init: { length: number; text: string; hold: boolean; accent: boolean }): Grid {
  const carved = carve(g, addr);
  const length = Math.min(init.length, STEPS_PER_BAR - addr.step);
  return insertClip(carved, addr, { start: addr.step, ...init, length });
}

function writeAt(g: Grid, addr: StepAddress, text: string): { grid: Grid; used: number } {
  let out = g;
  let step = addr.step;
  let lastId: string | null = null;
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (step >= STEPS_PER_BAR) {
      // 写到小节末尾了：剩下的字并进最后一格，不越过小节线
      if (lastId) {
        const loc = findClip(out, lastId);
        if (loc) out = updateClip(out, lastId, { text: loc.clip.text + chars.slice(i).join('').replace(/[-_]/g, '') });
      }
      break;
    }
    const at = { ...addr, step };
    const existing = g.sections[addr.section].bars[addr.bar].clips.find((c) => c.start === step && !c.hold);
    const length = existing ? existing.length : 1;
    out = place(out, at, {
      length,
      text: ch === '-' || ch === '_' ? '' : ch,
      hold: ch === '-',
      accent: existing ? existing.accent && ch !== '-' && ch !== '_' : false,
    });
    lastId = clipAt(out, at)?.id ?? lastId;
    step += length;
  }
  return { grid: out, used: step - addr.step };
}

function clipIdsInRange(g: Grid, from: number, to: number): string[] {
  const ids: string[] = [];
  for (const c of iterateClips(g)) if (c.absStart >= from && c.absStart <= to) ids.push(c.clip.id);
  if (ids.length === 0) {
    const addr = locateStep(g, from);
    const c = addr ? clipAt(g, addr) : null;
    if (c) ids.push(c.id);
  }
  return ids;
}

function clearRange(g: Grid, from: number, to: number): Grid {
  const ids = [...iterateClips(g)].filter((c) => c.absStart >= from && c.absStart <= to).map((c) => c.clip.id);
  let out = ids.length ? deleteClips(g, ids) : g;
  const addr = locateStep(out, from);
  if (addr) out = carve(out, addr);
  return out;
}

function barIsEmpty(bar: Bar | undefined): boolean {
  return !!bar && bar.clips.length === 0;
}

function applyPreview(g: Grid, p: AiPreview, picks: number[]): Grid {
  let out = g;
  if (p.mode === 'replace') {
    const bar = out.sections[p.section]?.bars[p.at];
    if (!bar) return g;
    out = deleteClips(out, bar.clips.map((c) => c.id));
    for (const c of p.bars[0].clips) out = insertClip(out, { section: p.section, bar: p.at }, { ...c, id: c.id + 'r' });
    return out;
  }
  let at = p.at;
  for (const i of picks) {
    const target = out.sections[p.section]?.bars[at];
    if (!barIsEmpty(target)) out = insertBars(out, p.section, at, 1);
    for (const c of p.bars[i].clips) out = insertClip(out, { section: p.section, bar: at }, { ...c, id: `${c.id}a${at}` });
    at += 1;
  }
  return out;
}
