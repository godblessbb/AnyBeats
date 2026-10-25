/**
 * AI 面板的状态：Worker 连接状态、当前页签、生成中 / 失败。
 * 只经 AiProvider 接口调用 AI；返回的歌词用 core/importAi 导入，再交给 EditorStore 做虚线预览。
 */

import { importAiLyrics } from '../core';
import { AI_TASK_NAMES, type AiProvider, type AiRequest, type AiStatus, type AiTask } from '../ai';
import type { EditorStore } from './editorStore';
import { allBars, barText, rhymeView } from './view';

export interface AiState {
  status: AiStatus | null;
  checking: boolean;
  checkedAt: number | null;
  task: AiTask;
  bars: number;
  chars: number;
  instruction: string;
  generating: boolean;
  error: string | null;
}

export class AiController {
  readonly provider: AiProvider;
  private readonly store: EditorStore;
  private abort: AbortController | null = null;
  private listeners = new Set<() => void>();
  private state: AiState = {
    status: null,
    checking: false,
    checkedAt: null,
    task: 'continue',
    bars: 2,
    chars: 8,
    instruction: '',
    generating: false,
    error: null,
  };

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
    this.set({ status, checking: false, checkedAt: Date.now() });
  }

  setTask(task: AiTask) {
    this.set({ task, error: null });
  }

  setBars(bars: number) {
    this.set({ bars });
  }

  setChars(chars: number) {
    this.set({ chars });
  }

  setInstruction(instruction: string) {
    this.set({ instruction });
  }

  /** 改押韵 / 调字数作用的那一小节：选中格所在的小节 */
  targetBar(): { section: number; bar: number; global: number; text: string } | null {
    const s = this.store.getState();
    const sel = s.selection;
    if (!sel) return null;
    const bars = allBars(s.grid);
    const b = bars[Math.floor(sel.focus / 16)];
    return b ? { section: b.section, bar: b.bar, global: b.global, text: barText(b.data) } : null;
  }

  /** 改押韵时要押的韵：目标小节所在段落里最多的那个韵 */
  targetRhyme(section: number): string | null {
    const stats = rhymeView(this.store.getState().grid).sections[section] ?? [];
    const top = [...stats].sort((a, b) => b.count - a.count)[0];
    return top?.final ?? null;
  }

  buildRequest(): AiRequest | string {
    const s = this.store.getState();
    const lines = this.store.writtenLines();
    const base = { bpm: s.bpm, lines, instruction: this.state.instruction };
    if (this.state.task === 'continue') return { ...base, task: 'continue', bars: this.state.bars };
    const target = this.targetBar();
    if (!target || !target.text) return `先选中要${AI_TASK_NAMES[this.state.task]}的那一小节`;
    if (this.state.task === 'rhyme') return { ...base, task: 'rhyme', target: target.text, rhyme: this.targetRhyme(target.section) ?? '' };
    return { ...base, task: 'fit', target: target.text, chars: this.state.chars };
  }

  async generate(): Promise<void> {
    const req = this.buildRequest();
    if (typeof req === 'string') {
      this.set({ error: req });
      return;
    }
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    this.set({ generating: true, error: null });
    try {
      const data = await this.provider.generate(req, abort.signal);
      const { bars, warnings } = importAiLyrics(data);
      const lines = bars.map(barText);
      if (req.task === 'continue') {
        const at = this.store.continuePoint();
        this.store.setPreview({ task: req.task, mode: 'fill', ...at, bars, lines, before: [], warnings });
      } else {
        const t = this.targetBar()!;
        this.store.setPreview({ task: req.task, mode: 'replace', section: t.section, at: t.bar, bars: bars.slice(0, 1), lines: lines.slice(0, 1), before: [t.text], warnings });
      }
      this.set({ generating: false });
    } catch (e) {
      const err = e as Error;
      if (err.name === 'AbortError') this.set({ generating: false });
      else this.set({ generating: false, error: err.message || '生成失败' });
      if (err.name === 'AiNotConnectedError') void this.check();
    } finally {
      if (this.abort === abort) this.abort = null;
    }
  }

  cancel() {
    this.abort?.abort();
    this.abort = null;
    this.set({ generating: false });
  }
}
