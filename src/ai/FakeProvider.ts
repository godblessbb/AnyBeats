/**
 * 只给测试用的 AiProvider：结果固定、可设延迟和失败，不发任何请求。
 * 产品代码不引用它。
 */

import type { AiLyricData } from '../core';
import { abortError, AiNotConnectedError, type AiProvider, type AiRequest, type AiStatus } from './AiProvider';

export interface FakeProviderOptions {
  connected?: boolean;
  worker?: string;
  delayMs?: number;
  /** 设了就让 generate 抛这个错 */
  failWith?: string;
  /** 一次填韵时给的字（依次用） */
  fillChars?: string[];
  /** 选区润色时把每个可改的字换成这个 */
  polishChar?: string;
  /** 故意多改一个不该改的位置（测「整份作废」） */
  rogue?: { measureIndex: number; startBeat: number; text: string };
}

export class FakeProvider implements AiProvider {
  readonly id = 'fake';
  readonly calls: AiRequest[] = [];
  private readonly options: FakeProviderOptions;

  constructor(options: FakeProviderOptions = {}) {
    this.options = options;
  }

  async status(): Promise<AiStatus> {
    return this.options.connected === false
      ? { state: 'disconnected', reason: '测试：未连接' }
      : { state: 'connected', worker: this.options.worker ?? '测试', detail: '已登录' };
  }

  async generate(req: AiRequest, signal?: AbortSignal): Promise<AiLyricData> {
    this.calls.push(req);
    if (this.options.connected === false) throw new AiNotConnectedError();
    if (this.options.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, this.options.delayMs);
        signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(abortError());
        });
      });
    }
    if (signal?.aborted) throw abortError();
    if (this.options.failWith) throw new Error(this.options.failWith);
    const byBar = new Map<number, AiLyricData['measures'][number]>();
    const at = (bar: number) => {
      if (!byBar.has(bar)) byBar.set(bar, { measureIndex: bar, lyrics: [] });
      return byBar.get(bar)!;
    };
    if (req.task === 'fill') {
      const chars = this.options.fillChars ?? ['方', '场', '口', '走'];
      (req.targets ?? []).forEach((t, i) => at(t.bar).lyrics.push({ text: chars[i % chars.length], startBeat: t.startBeat, duration: 4 }));
    } else {
      for (const line of req.selection ?? []) {
        const m = at(line.bar);
        for (const w of line.words) m.lyrics.push({ text: w.editable ? (this.options.polishChar ?? '新') : w.text, startBeat: w.startBeat, duration: w.duration });
      }
    }
    if (this.options.rogue) at(this.options.rogue.measureIndex).lyrics.push({ text: this.options.rogue.text, startBeat: this.options.rogue.startBeat, duration: 4 });
    return { bpm: req.bpm, timeSignature: '4/4', measures: [...byBar.values()] };
  }
}
