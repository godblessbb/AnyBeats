/**
 * 发给 Worker 的提示词。从旧 src/config/openai.config.ts 搬过来，去掉了模型、Key 和接口地址：
 * 用哪个模型由 Alphie Worker 决定。时值约定不变：每小节 64 单位（core/importAi 默认按 64 → 16 换算）。
 */

import type { AiRequest } from './AiProvider';

const FORMAT = `只返回 JSON，不要其他文字。格式：
{"bpm": <BPM>, "timeSignature": "4/4", "measures": [{"measureIndex": 0, "lyrics": [{"text": "我", "startBeat": 0, "duration": 4}]}]}
- startBeat 和 duration 以 1/16 拍为单位，每小节 64 个单位（1 拍 = 16 单位）。
- 一个字通常占 4 单位（一个十六分音符格），拖长的字占 8 或 12 单位。
- 每个 lyrics 条目只放一个字；同一小节内不要重叠，总长不超过 64。
- measureIndex 从 0 起，按返回的小节顺序编号。`;

export function buildPrompt(req: AiRequest): { system: string; user: string } {
  const system = `你是说唱歌词助手。一行歌词就是一小节（4/4 拍，16 个十六分音符格），句尾押韵。BPM ${req.bpm}。\n${FORMAT}`;
  const written = req.lines.length ? req.lines.map((l, i) => `${i + 1}. ${l}`).join('\n') : '（还没写）';
  const extra = req.instruction?.trim() ? `\n补充要求：${req.instruction.trim()}` : '';
  switch (req.task) {
    case 'continue':
      return {
        system,
        user: req.lines.length
          ? `已写的歌词（每行一小节）：\n${written}\n\n接着往下续写 ${req.bars ?? 2} 小节，风格和押韵跟上文一致。${extra}`
          : `按主题写一段 ${req.bars ?? 2} 小节的说唱歌词。${extra}`,
      };
    case 'rhyme':
      return {
        system,
        user: `上下文：\n${written}\n\n把这一小节改成押「${req.rhyme ?? ''}」韵，意思尽量不变，只返回这一小节：\n${req.target ?? ''}${extra}`,
      };
    case 'fit':
      return {
        system,
        user: `上下文：\n${written}\n\n把这一小节改成正好 ${req.chars ?? 8} 个字，均匀落在 4 拍上，只返回这一小节：\n${req.target ?? ''}${extra}`,
      };
  }
}
