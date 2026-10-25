/**
 * 撤销/重做命令栈。命令是 state → state 的纯函数；因为模型是不可变的，
 * 栈里只存执行前后的快照引用（结构共享，开销很小）。
 */

export interface Command<T> {
  label: string;
  apply(state: T): T;
}

export interface HistoryEntry<T> {
  label: string;
  before: T;
  after: T;
}

export class History<T> {
  private undoStack: HistoryEntry<T>[] = [];
  private redoStack: HistoryEntry<T>[] = [];
  private current: T;
  private readonly limit: number;

  constructor(initial: T, limit = 200) {
    this.current = initial;
    this.limit = limit;
  }

  get state(): T {
    return this.current;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** 下一次撤销/重做会作用的命令名，给界面显示 "撤销 移动片段" 用 */
  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }

  /** 执行命令；命令抛错时状态和栈都不变。返回值与原状态相同（无变化）时不入栈。 */
  execute(command: Command<T>): T {
    const before = this.current;
    const after = command.apply(before);
    if (after === before) return before;
    this.undoStack.push({ label: command.label, before, after });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.current = after;
    return after;
  }

  undo(): T {
    const entry = this.undoStack.pop();
    if (!entry) return this.current;
    this.redoStack.push(entry);
    this.current = entry.before;
    return this.current;
  }

  redo(): T {
    const entry = this.redoStack.pop();
    if (!entry) return this.current;
    this.undoStack.push(entry);
    this.current = entry.after;
    return this.current;
  }

  /** 载入工程等场景：替换状态并清空历史 */
  reset(state: T): void {
    this.current = state;
    this.undoStack = [];
    this.redoStack = [];
  }
}

export function command<T>(label: string, apply: (state: T) => T): Command<T> {
  return { label, apply };
}
