import { analyze, groupOfFinal, splitSyllable, type RhymeGroup, type Syllable } from './syllable';
import { DEFAULT_LEXICON_DATA } from './lexiconData';

export type PartOfSpeech = 'n' | 'v' | 'a' | 'd' | 'o';

export interface LexiconEntry {
  word: string;
  pos: PartOfSpeech;
}

export interface RhymeCandidate extends LexiconEntry {
  /** 词尾 n 个字的分析（n = 查询里的 tailLength） */
  tail: Syllable[];
}

export interface RhymeQuery {
  /** 按韵部匹配（十三辙）；与 final 二选一，都给时 final 优先 */
  group?: RhymeGroup;
  /** 按精确韵母匹配，如 "iang" */
  final?: string;
  /** 多押：要求词尾连续若干字都同韵；给了 like 时按 like 的尾部逐字比较 */
  like?: string;
  /** like 模式下比较的尾字数，默认 1 */
  tailLength?: number;
  /** 词尾字的声调 1–4 */
  tone?: number;
  /** 平（1、2 声）/ 仄（3、4 声） */
  toneClass?: '平' | '仄';
  /** 词长（字数） */
  length?: number;
  pos?: PartOfSpeech;
  exclude?: Iterable<string>;
  limit?: number;
}

/**
 * 同韵词候选的本地词表。只依赖这个接口，以后可以换成更大的词表
 * （例如运行时 fetch 一份完整 jieba 词典再 createLexicon）。
 */
export interface RhymeLexicon {
  readonly size: number;
  candidates(query: RhymeQuery): RhymeCandidate[];
}

/** 解析 lexiconData 的紧凑格式：`n:词 词|v:词 ...` */
export function parseLexiconData(data: string): LexiconEntry[] {
  const entries: LexiconEntry[] = [];
  for (const part of data.split('|')) {
    const sep = part.indexOf(':');
    if (sep < 0) continue;
    const pos = part.slice(0, sep) as PartOfSpeech;
    for (const word of part.slice(sep + 1).split(' ')) if (word) entries.push({ word, pos });
  }
  return entries;
}

interface Indexed extends LexiconEntry {
  syllables: Syllable[];
}

export function createLexicon(entries: Iterable<LexiconEntry>): RhymeLexicon {
  const source = Array.from(entries);
  let index: Indexed[] | null = null;
  // 词表首次查询时才逐词注音，避免模块加载就付出几十毫秒
  const build = () => {
    index = [];
    for (const e of source) {
      const syllables = analyze(e.word);
      if (syllables.every((s) => s !== null)) index.push({ ...e, syllables: syllables as Syllable[] });
    }
    return index;
  };

  return {
    size: source.length,
    candidates(query) {
      const all = index ?? build();
      const exclude = new Set(query.exclude ?? []);
      const likeTail = query.like
        ? analyze(query.like).filter((s): s is Syllable => s !== null).slice(-(query.tailLength ?? 1))
        : null;
      const tailLength = likeTail ? likeTail.length : 1;
      const wantFinal = query.final ? splitSyllable(query.final).final || query.final : undefined;
      if (wantFinal && !groupOfFinal(wantFinal)) return [];

      const out: RhymeCandidate[] = [];
      for (const e of all) {
        if (exclude.has(e.word) || e.word === query.like) continue;
        if (query.length && e.syllables.length !== query.length) continue;
        if (query.pos && e.pos !== query.pos) continue;
        if (e.syllables.length < tailLength) continue;
        const tail = e.syllables.slice(-tailLength);
        const last = tail[tail.length - 1];
        if (wantFinal && last.final !== wantFinal) continue;
        if (!wantFinal && query.group && last.group !== query.group) continue;
        if (likeTail && !tail.every((s, i) => s.group === likeTail[i].group)) continue;
        if (query.tone && last.tone !== query.tone) continue;
        if (query.toneClass === '平' && !(last.tone === 1 || last.tone === 2)) continue;
        if (query.toneClass === '仄' && !(last.tone === 3 || last.tone === 4)) continue;
        out.push({ word: e.word, pos: e.pos, tail });
        if (query.limit && out.length >= query.limit) break;
      }
      return out;
    },
  };
}

let defaultLexicon: RhymeLexicon | null = null;

/** 内置词表（约 3 万词，见 lexiconData.ts 头注释）。 */
export function getDefaultLexicon(): RhymeLexicon {
  defaultLexicon ??= createLexicon(parseLexiconData(DEFAULT_LEXICON_DATA));
  return defaultLexicon;
}
