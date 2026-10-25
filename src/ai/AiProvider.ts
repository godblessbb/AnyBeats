/**
 * AI 写词的唯一入口。界面只认这个接口，不知道背后是哪个模型、在哪台机器上跑。
 *
 * 模型和 Key 都交给 Alphie Worker（DESIGN.md §9 第 5 条），页面里不放 Key、不直连任何模型 API。
 * 返回的歌词一律是 core/importAi 能读的 AiLyricData（每小节 64 单位），由界面用 importAiLyrics 导入网格。
 */

import type { AiLyricData } from '../core';

/** 续写 / 改押韵 / 按拍子调字数 */
export type AiTask = 'continue' | 'rhyme' | 'fit';

export const AI_TASK_NAMES: Record<AiTask, string> = {
  continue: '续写',
  rhyme: '改押韵',
  fit: '按拍子调字数',
};

export interface AiRequest {
  task: AiTask;
  bpm: number;
  /** 已写的歌词，每小节一行（空小节不传） */
  lines: string[];
  /** continue：续写几小节 */
  bars?: number;
  /** rhyme / fit：要改的那一小节 */
  target?: string;
  /** rhyme：要押的韵（韵母或十三辙名，如 "ai"） */
  rhyme?: string;
  /** fit：改成几个字 */
  chars?: number;
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
