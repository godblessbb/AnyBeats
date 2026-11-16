/**
 * 撤销 / 重做：一条线。状态是不可变的，历史里存的是每一步之后的快照（结构共享，开销很小）。
 *
 * - states[0..n] 是一条线上的快照，cursor 指当前；undo / redo 就是挪 cursor。
 * - 撤销之后又做新改动：cursor 后面（可重做）的步骤全部丢掉。
 * - 填字、铺 flow、涂色、锁定、换伴奏、AI 改写都走这一条（kind 区分）。
 * - 能序列化：跟作品一起存进本机，刷新页面后还在（serializeHistory / restoreHistory）。
 */

export type HistoryKind = 'fill' | 'flow' | 'paint' | 'lock' | 'beat' | 'ai' | 'edit';

export const HISTORY_KIND_NAMES: Record<HistoryKind, string> = {
  fill: '填字',
  flow: '铺 flow',
  paint: '涂色',
  lock: '锁定',
  beat: '换伴奏',
  ai: 'AI 改写',
  edit: '编辑',
};

export interface Command<T> {
  label: string;
  kind?: HistoryKind;
  apply(state: T): T;
}

export interface HistoryStep {
  label: string;
  kind: HistoryKind;
  /** 做这一步的时间（毫秒时间戳） */
  at: number;
}

export interface HistoryOptions {
  /** 最多留多少步，默认 200 */
  limit?: number;
  now?: () => number;
}

export class History<T> {
  private states: T[];
  private steps: HistoryStep[];
  private cursor: number;
  private readonly limit: number;
  private readonly now: () => number;

  constructor(initial: T, options: HistoryOptions | number = {}) {
    const o = typeof options === 'number' ? { limit: options } : options;
    this.limit = o.limit ?? 200;
    this.now = o.now ?? (() => Date.now());
    this.states = [initial];
    this.steps = [];
    this.cursor = 0;
  }

  get state(): T {
    return this.states[this.cursor];
  }

  get canUndo(): boolean {
    return this.cursor > 0;
  }

  get canRedo(): boolean {
    return this.cursor < this.states.length - 1;
  }

  /** 下一次撤销 / 重做会作用的那一步，给界面显示「撤销：锁定第 3 小节整行」用 */
  get undoLabel(): string | null {
    return this.canUndo ? this.steps[this.cursor - 1].label : null;
  }

  get redoLabel(): string | null {
    return this.canRedo ? this.steps[this.cursor].label : null;
  }

  /** 做过的步骤（从早到晚） */
  get done(): HistoryStep[] {
    return this.steps.slice(0, this.cursor);
  }

  /** 还能重做的步骤（下一步重做的在最前） */
  get redoable(): HistoryStep[] {
    return this.steps.slice(this.cursor);
  }

  get depth(): number {
    return this.cursor;
  }

  /** 执行命令；命令抛错时状态和历史都不变；结果与原状态相同（无变化）时不记一步 */
  execute(command: Command<T>): T {
    const before = this.state;
    const after = command.apply(before);
    if (after === before) return before;
    this.push(after, { label: command.label, kind: command.kind ?? 'edit', at: this.now() });
    return after;
  }

  /** 直接记一步（状态已经算好） */
  push(state: T, step: HistoryStep): void {
    this.states = this.states.slice(0, this.cursor + 1);
    this.steps = this.steps.slice(0, this.cursor);
    this.states.push(state);
    this.steps.push(step);
    this.cursor += 1;
    while (this.steps.length > this.limit) {
      this.states.shift();
      this.steps.shift();
      this.cursor -= 1;
    }
  }

  undo(): T {
    if (this.canUndo) this.cursor -= 1;
    return this.state;
  }

  redo(): T {
    if (this.canRedo) this.cursor += 1;
    return this.state;
  }

  /** 载入工程等场景：替换状态并清空历史 */
  reset(state: T): void {
    this.states = [state];
    this.steps = [];
    this.cursor = 0;
  }

  /** 导出整条线（给序列化用） */
  snapshot(): { states: T[]; steps: HistoryStep[]; cursor: number } {
    return { states: [...this.states], steps: [...this.steps], cursor: this.cursor };
  }

  /** 从快照恢复；快照不合法时抛错 */
  static fromSnapshot<T>(snap: { states: T[]; steps: HistoryStep[]; cursor: number }, options: HistoryOptions = {}): History<T> {
    if (!snap.states.length || snap.steps.length !== snap.states.length - 1 || snap.cursor < 0 || snap.cursor >= snap.states.length) {
      throw new Error('撤销历史格式不对');
    }
    const h = new History<T>(snap.states[0], options);
    h.states = [...snap.states];
    h.steps = [...snap.steps];
    h.cursor = snap.cursor;
    return h;
  }
}

export function command<T>(label: string, apply: (state: T) => T, kind: HistoryKind = 'edit'): Command<T> {
  return { label, kind, apply };
}

// ---------- 序列化 ----------

/**
 * 每个快照拆成若干段字符串（例如元数据、规则、每个小节各一段），所有快照共用一张去重的字符串表。
 * 大多数改动只动一个小节，所以整条历史存下来只比一份作品大一点。
 */
export interface Codec<T> {
  split(state: T): string[];
  join(parts: string[], parse: (s: string) => unknown): T;
}

export interface SerializedHistory {
  v: 1;
  table: string[];
  states: number[][];
  steps: HistoryStep[];
  cursor: number;
}

export function serializeHistory<T>(h: History<T>, codec: Codec<T>, maxChars = 1_500_000): string {
  const snap = h.snapshot();
  const build = (from: number): SerializedHistory => {
    const table: string[] = [];
    const index = new Map<string, number>();
    const states = snap.states.slice(from).map((s) =>
      codec.split(s).map((part) => {
        let i = index.get(part);
        if (i === undefined) {
          i = table.length;
          table.push(part);
          index.set(part, i);
        }
        return i;
      }),
    );
    return { v: 1, table, states, steps: snap.steps.slice(from), cursor: snap.cursor - from };
  };
  // 太大（本机存储有配额）就从最早的步骤开始丢，至少保留当前状态
  let from = 0;
  let out = JSON.stringify(build(from));
  while (out.length > maxChars && from < snap.cursor) {
    from = Math.min(snap.cursor, from + Math.max(1, Math.ceil((snap.cursor - from) / 4)));
    out = JSON.stringify(build(from));
  }
  return out;
}

export function restoreHistory<T>(raw: string, codec: Codec<T>, options: HistoryOptions = {}): History<T> {
  const data = JSON.parse(raw) as SerializedHistory;
  if (data?.v !== 1 || !Array.isArray(data.table) || !Array.isArray(data.states) || !Array.isArray(data.steps)) throw new Error('撤销历史格式不对');
  const cache = new Map<string, unknown>();
  const parse = (s: string) => {
    if (!cache.has(s)) cache.set(s, JSON.parse(s));
    return cache.get(s);
  };
  const states = data.states.map((idx) => codec.join(idx.map((i) => data.table[i]), parse));
  return History.fromSnapshot({ states, steps: data.steps, cursor: data.cursor }, options);
}
