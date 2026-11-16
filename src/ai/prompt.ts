/**
 * 发给 Worker 的提示词（不含模型、Key 和接口地址：用哪个模型由 Alphie Worker 决定）。
 * 时值约定：每小节 64 个单位（1 单位 = 3 tick）。
 */

import type { AiRequest } from './AiProvider';

const FORMAT = `只返回 JSON，不要其他文字。格式：
{"bpm": <BPM>, "timeSignature": "4/4", "measures": [{"measureIndex": <小节号>, "lyrics": [{"text": "我", "startBeat": 0, "duration": 4}]}]}
- startBeat 和 duration 以 1/16 拍为单位，每小节 64 个单位（1 拍 = 16 单位）。
- 每个 lyrics 条目只放一个字；同一小节内不要重叠，总长不超过 64。
- measureIndex 用下面给出的小节号（从 0 起），只返回要改的小节。`;

export function buildPrompt(req: AiRequest): { system: string; user: string } {
  const system = `你是说唱歌词助手。一行歌词就是一小节（4/4 拍），BPM ${req.bpm}。\n${FORMAT}`;
  const written = req.lines.length ? req.lines.map((l, i) => `${i}. ${l || '（空）'}`).join('\n') : '（还没写）';
  const extra = req.instruction?.trim() ? `\n补充要求：${req.instruction.trim()}` : '';
  if (req.task === 'fill') {
    const targets = (req.targets ?? []).map((t) => `第 ${t.bar} 小节 startBeat ${t.startBeat}：押 ${t.final}`).join('\n');
    return {
      system,
      user: `全文（每行一小节，行号 = 小节号）：\n${written}\n\n只在下面这些位置各填一个字，押对给出的韵母，别的位置一个字都不要动：\n${targets}${extra}`,
    };
  }
  const sel = (req.selection ?? [])
    .map((l) => `第 ${l.bar} 小节：${l.words.map((w) => `${w.text || '□'}@${w.startBeat}/${w.duration}${w.editable ? '' : '（不许改）'}`).join(' ')}`)
    .join('\n');
  const rule = req.keepSkeleton
    ? '保持骨架：每个字的 startBeat 和 duration 原样不变、字数不变，只换字。'
    : '可以改 flow：可以增减字、改 startBeat / duration，但不许越出这些小节。';
  return {
    system,
    user: `全文都是上下文（每行一小节，行号 = 小节号）：\n${written}\n\n只改选区里的这些小节，标了「不许改」的字原样保留：\n${sel}\n${rule}${extra}`,
  };
}
