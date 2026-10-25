import type { TimeSource } from '../clock';
import type { TimerApi } from '../autosave';

/** 手动推进的时间源：测试里完全确定，不 sleep */
export class FakeTime implements TimeSource {
  t = 0;
  now() {
    return this.t;
  }
  advance(seconds: number) {
    this.t += seconds;
  }
}

/** 手动推进的定时器（给 autosave 用） */
export class FakeTimers implements TimerApi {
  private nowMs = 0;
  private seq = 0;
  private tasks = new Map<number, { at: number; fn: () => void }>();

  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.tasks.set(id, { at: this.nowMs + ms, fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  advance(ms: number) {
    const end = this.nowMs + ms;
    for (;;) {
      const due = [...this.tasks.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.tasks.delete(due[0]);
      this.nowMs = due[1].at;
      due[1].fn();
    }
    this.nowMs = end;
  }

  get pendingCount() {
    return this.tasks.size;
  }
}

/** 内存版 localStorage */
export class MemoryStore {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}
