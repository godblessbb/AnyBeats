/**
 * 只给测试用的 AiProvider：结果固定、可设延迟和失败，不发任何请求。
 * 产品代码不引用它（开发服务器里 ?ai=fake 才会按需加载，生产构建里不存在）。
 */

import type { AiLyricData, AiLyricItem } from '../core';
import { abortError, AiNotConnectedError, type AiProvider, type AiRequest, type AiStatus } from './AiProvider';

export interface FakeProviderOptions {
  connected?: boolean;
  worker?: string;
  delayMs?: number;
  /** 设了就让 generate 抛这个错 */
  failWith?: string;
  /** 续写时依次给出的句子 */
  lines?: string[];
}

export const FAKE_LINES = ['一句一句把门敲开', '汗水换来今天的喝彩', '灯光照亮我的未来', '从来不怕重新再来'];

/** 一句话 → 一小节：每字一个 1/16 格（4 单位），从第 1 格起；最后一个字拖到下一拍 */
export function lineToMeasure(text: string, measureIndex: number, unitsPerChar = 4): AiLyricData['measures'][number] {
  const chars = Array.from(text).slice(0, 16);
  const lyrics: AiLyricItem[] = chars.map((ch, i) => ({ text: ch, startBeat: i * unitsPerChar, duration: unitsPerChar }));
  const last = lyrics[lyrics.length - 1];
  if (last) last.duration = Math.min(64 - last.startBeat, unitsPerChar * 3);
  return { measureIndex, lyrics };
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
      : { state: 'connected', worker: this.options.worker ?? '测试 Worker', detail: '已登录' };
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

    switch (req.task) {
      case 'continue': {
        const lines = this.options.lines ?? FAKE_LINES;
        const n = req.bars ?? 2;
        return { bpm: req.bpm, timeSignature: '4/4', measures: Array.from({ length: n }, (_, i) => lineToMeasure(lines[i % lines.length], i)) };
      }
      case 'rhyme': {
        const chars = Array.from(req.target ?? '');
        const text = chars.slice(0, Math.max(0, chars.length - 2)).join('') + '一行';
        return { bpm: req.bpm, timeSignature: '4/4', measures: [lineToMeasure(text, 0)] };
      }
      case 'fit': {
        const want = req.chars ?? 8;
        const chars = Array.from(req.target ?? '');
        const text = chars.slice(0, want).join('').padEnd(want, '啊');
        // 均匀落在 4 拍上：每字占 64 / want 单位
        const unit = Math.floor(64 / Math.max(1, want));
        return {
          bpm: req.bpm,
          timeSignature: '4/4',
          measures: [{ measureIndex: 0, lyrics: Array.from(text).map((ch, i) => ({ text: ch, startBeat: i * unit, duration: unit })) }],
        };
      }
    }
  }
}
