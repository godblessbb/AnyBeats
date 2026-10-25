import { analyze, type RhymeGroup, type Syllable } from './syllable';

export interface LineEndRhyme {
  line: number;
  /** 句尾最后一个汉字的分析结果；整句没有汉字时为 null */
  syllable: Syllable | null;
  /** 押韵颜色序号（0 起）；该韵部在这些句子里只出现一次时为 null，不标色 */
  color: number | null;
}

export type RhymeKey = 'group' | 'final';

/**
 * 句尾押韵标色：取每句最后一个汉字，按韵部（默认，十三辙）或精确韵母分组，
 * 出现两次及以上的组按首次出现顺序分配颜色序号。
 */
export function colorLineEndRhymes(lines: string[], key: RhymeKey = 'group'): LineEndRhyme[] {
  const ends = lines.map((text) => {
    const syllables = analyze(text);
    for (let i = syllables.length - 1; i >= 0; i--) {
      if (syllables[i]) return syllables[i];
    }
    return null;
  });
  const keyOf = (s: Syllable) => (key === 'group' ? s.group : s.final);
  const counts = new Map<string, number>();
  for (const s of ends) if (s) counts.set(keyOf(s), (counts.get(keyOf(s)) ?? 0) + 1);
  const colors = new Map<string, number>();
  return ends.map((syllable, line) => {
    if (!syllable || (counts.get(keyOf(syllable)) ?? 0) < 2) return { line, syllable, color: null };
    const k = keyOf(syllable);
    if (!colors.has(k)) colors.set(k, colors.size);
    return { line, syllable, color: colors.get(k)! };
  });
}

/** 一句话最后 n 个字的韵脚（用于多押：比较尾部若干字的韵部序列）。 */
export function tailRhyme(text: string, n = 1): RhymeGroup[] {
  const syllables = analyze(text).filter((s): s is Syllable => s !== null);
  return syllables.slice(-n).map((s) => s.group);
}
