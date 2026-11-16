/**
 * AI 的唯一入口。界面只认这个接口，不知道背后是哪个模型、在哪台机器上跑。
 *
 * 模型和 Key 都交给 Alphie Worker，页面里不放 Key、不直连任何模型 API。
 * 返回的歌词一律是 AiLyricData（每小节 64 单位 = 每单位 3 tick），由 engine/aiController 换成 tick 后
 * 交给 core/aiEdit 逐字比对，选区外或锁定位置有任何改动就整份作废。
 *
 * 静态版（现在上线的这一版）不挂载 AI 入口；这里的代码留着，接上 AI 后用。
 */

import type { AiLyricData } from '../core';

/** 一次填韵 / 选区润色 */
export type AiTask = 'fill' | 'polish';

export const AI_TASK_NAMES: Record<AiTask, string> = {
  fill: '一次填韵',
  polish: '选区润色',
};

export interface AiFillTarget {
  /** 全曲第几个小节（0 起） */
  bar: number;
  /** 小节内起点，64 单位制 */
  startBeat: number;
  /** 这一位要押的韵母 */
  final: string;
}

export interface AiPolishLine {
  bar: number;
  /** 这一小节的字：64 单位制的起点 / 时长、原文、能不能改 */
  words: { startBeat: number; duration: number; text: string; editable: boolean }[];
}

export interface AiRequest {
  task: AiTask;
  bpm: number;
  /** 全文，每小节一行（空小节传空字符串，保证行号就是小节号） */
  lines: string[];
  /** fill：要填的韵脚位置 */
  targets?: AiFillTarget[];
  /** polish：选区里的小节 */
  selection?: AiPolishLine[];
  /** polish：保持骨架（字数、落点不变，只换字） */
  keepSkeleton?: boolean;
  /** 用户补充的一句要求 */
  instruction?: string;
}

export type AiStatus =
  | { state: 'connected'; worker: string; detail?: string }
  | { state: 'disconnected'; reason: string };

export interface AiProvider {
  /** 给界面显示用的实现名 */
  readonly id: string;
  /** 当前能不能用；不会抛错 */
  status(): Promise<AiStatus>;
  /** 未连接时抛 AiNotConnectedError；取消时抛 AbortError */
  generate(request: AiRequest, signal?: AbortSignal): Promise<AiLyricData>;
}

export class AiNotConnectedError extends Error {
  constructor(message = 'AI Worker 未连接') {
    super(message);
    this.name = 'AiNotConnectedError';
  }
}

export function abortError(): Error {
  const e = new Error('已取消');
  e.name = 'AbortError';
  return e;
}

/** 从模型回复里取出歌词 JSON（允许前后夹杂说明文字或 ``` 代码块） */
export function parseAiLyrics(text: string): AiLyricData {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('回复里没有歌词 JSON');
  const data = JSON.parse(match[0]) as AiLyricData;
  if (!Array.isArray(data.measures) || data.measures.length === 0) throw new Error('歌词 JSON 里没有小节');
  for (const m of data.measures) {
    if (!Number.isInteger(m.measureIndex) || !Array.isArray(m.lyrics)) throw new Error('歌词 JSON 的小节格式不对');
  }
  return data;
}
