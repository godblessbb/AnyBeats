/**
 * AI 的两种改写（静态版界面不挂载入口，接上 AI 后用）：
 *   一次填韵 —— 只填涂了色、还一个字都没写的格子的韵脚位置；
 *   选区润色 —— 全文当上下文、只改选区；默认保持骨架，另有「允许改 flow」开关。
 * 只经 AiProvider 接口调用 AI；结果换成 tick 后交给 EditorStore（core/aiEdit 逐字比对，
 * 选区外或锁定位置有任何改动就整份作废，表格保持原样）。
 */

import { allBars, buildPolishRequest, DEFAULT_POLISH, planRhymeFill, TICKS_PER_BAR, type AiLyricData, type Change, type PolishOptions } from '../core';
import type { AiProvider, AiRequest, AiStatus } from '../ai';
import type { EditorStore } from './editorStore';

/** 64 单位制 ↔ tick：1 单位 = 3 tick */
const UNIT = TICKS_PER_BAR / 64;

export interface AiState {
  status: AiStatus | null;
  checking: boolean;
  generating: boolean;
  options: PolishOptions;
  instruction: string;
  error: string | null;
  /** 上一次被整份作废的改动（界面上打「!」） */
  rejected: Change[] | null;
}

export class AiController {
  readonly provider: AiProvider;
  private readonly store: EditorStore;
  private abort: AbortController | null = null;
  private listeners = new Set<() => void>();
  private state: AiState = { status: null, checking: false, generating: false, options: DEFAULT_POLISH, instruction: '', error: null, rejected: null };

  constructor(provider: AiProvider, store: EditorStore) {
    this.provider = provider;
    this.store = store;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): AiState => this.state;

  private set(patch: Partial<AiState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  async check(): Promise<void> {
    this.set({ checking: true });
    const status = await this.provider.status();
    this.set({ status, checking: false });
  }

  setOptions(patch: Partial<PolishOptions>) {
    const options = { ...this.state.options, ...patch };
    if (patch.allowFlow) options.keepSkeleton = false;
    if (patch.keepSkeleton) options.allowFlow = false;
    this.set({ options });
  }

  setInstruction(instruction: string) {
    this.set({ instruction });
  }

  private lines(): string[] {
    return allBars(this.store.grid).map((b) => b.data.words.map((w) => w.text).join(''));
  }

  private async run(req: AiRequest): Promise<AiLyricData | null> {
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    this.set({ generating: true, error: null, rejected: null });
    try {
      const data = await this.provider.generate(req, abort.signal);
      this.set({ generating: false });
      return data;
    } catch (e) {
      const err = e as Error;
      this.set({ generating: false, error: err.name === 'AbortError' ? null : err.message || '生成失败' });
      if (err.name === 'AiNotConnectedError') void this.check();
      return null;
    } finally {
      if (this.abort === abort) this.abort = null;
    }
  }

  /** 一次填韵 */
  async fill(): Promise<boolean> {
    const doc = this.store.doc;
    const targets = planRhymeFill(doc.grid, doc);
    if (!targets.length) {
      this.set({ error: '没有要填的韵脚位置：涂了色、还没写字的格子才会填' });
      return false;
    }
    const data = await this.run({
      task: 'fill',
      bpm: doc.bpm,
      lines: this.lines(),
      instruction: this.state.instruction,
      targets: targets.map((t) => ({ bar: Math.floor(t.abs / TICKS_PER_BAR), startBeat: (t.abs % TICKS_PER_BAR) / UNIT, final: t.want })),
    });
    if (!data) return false;
    const answers = data.measures.flatMap((m) => m.lyrics.map((l) => ({ abs: m.measureIndex * TICKS_PER_BAR + Math.round(l.startBeat * UNIT), text: l.text })));
    const r = this.store.applyAiFill(answers);
    if (!r.ok) this.set({ rejected: r.violations });
    return r.ok;
  }

  /** 选区润色：scope = 选中的格子 */
  async polish(scope: string[]): Promise<boolean> {
    const doc = this.store.doc;
    if (!scope.length) {
      this.set({ error: '先框选要润色的格子' });
      return false;
    }
    const req = buildPolishRequest(doc.grid, doc, new Set(scope), this.state.options);
    const data = await this.run({
      task: 'polish',
      bpm: doc.bpm,
      lines: req.context,
      instruction: this.state.instruction,
      keepSkeleton: req.options.keepSkeleton,
      selection: req.lines.map((l) => ({
        bar: l.bar,
        words: l.words.map((w) => ({ startBeat: (w.abs % TICKS_PER_BAR) / UNIT, duration: w.len / UNIT, text: w.text, editable: w.editable })),
      })),
    });
    if (!data) return false;
    const items = data.measures.flatMap((m) =>
      m.lyrics.map((l) => ({ abs: m.measureIndex * TICKS_PER_BAR + Math.round(l.startBeat * UNIT), len: Math.max(1, Math.round(l.duration * UNIT)), text: l.text })),
    );
    const result = req.options.keepSkeleton ? { texts: items.map((i) => ({ abs: i.abs, text: i.text })) } : { words: items };
    const r = this.store.applyAiPolish(scope, req.options, result);
    if (!r.ok) this.set({ rejected: r.violations });
    return r.ok;
  }

  cancel() {
    this.abort?.abort();
    this.abort = null;
    this.set({ generating: false });
  }
}
