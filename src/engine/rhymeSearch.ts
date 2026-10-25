/**
 * 同韵候选：默认走 core/rhyme 的本地韵表（不调 AI、不联网）；
 * 「主题联想」可选走现有 backend/ 的本机向量服务，服务没起时界面灰掉这一栏，不报错。
 */

import { getDefaultLexicon, type PartOfSpeech, type RhymeQuery, type Syllable } from '../core';

export type ToneFilter = 'all' | '平' | '仄' | 1 | 2 | 3 | 4;
export type PosFilter = 'all' | PartOfSpeech;

export interface RhymeFilter {
  length: number;
  tone: ToneFilter;
  pos: PosFilter;
}

export interface CandidateWord {
  word: string;
  /** 词尾字的声调 */
  tone: number;
  pos: PartOfSpeech;
}

export const POS_NAMES: Record<PartOfSpeech, string> = { n: '名词', v: '动词', a: '形容词', d: '副词', o: '其他' };

export const PAGE_SIZE = 12;

function toneQuery(tone: ToneFilter): Pick<RhymeQuery, 'tone' | 'toneClass'> {
  if (tone === 'all') return {};
  if (tone === '平' || tone === '仄') return { toneClass: tone };
  return { tone };
}

/** 按句尾字的韵部（十三辙）找候选，返回全部匹配（不分页），供统计词性数量 */
export function localMatches(target: Syllable, filter: Omit<RhymeFilter, 'pos'>): CandidateWord[] {
  const lex = getDefaultLexicon();
  const tq = toneQuery(filter.tone);
  if (filter.length === 1) {
    // 词表只有 2–4 字词：单字候选取同韵词的尾字
    const seen = new Set<string>();
    const out: CandidateWord[] = [];
    for (const c of lex.candidates({ group: target.group, ...tq })) {
      const last = c.tail[c.tail.length - 1];
      if (seen.has(last.char) || last.char === target.char) continue;
      seen.add(last.char);
      out.push({ word: last.char, tone: last.tone, pos: 'o' });
    }
    return out;
  }
  const all = lex.candidates({ group: target.group, length: filter.length, ...tq });
  // 同一韵部里，韵母完全相同的排前面（眼 ian → 先「从前」后「永远」），各自保持词频顺序
  const exact = all.filter((c) => c.tail[c.tail.length - 1].final === target.final);
  const near = all.filter((c) => c.tail[c.tail.length - 1].final !== target.final);
  return [...exact, ...near].map((c) => ({ word: c.word, tone: c.tail[c.tail.length - 1].tone, pos: c.pos }));
}

export function posCounts(words: CandidateWord[]): Record<PosFilter, number> {
  const counts: Record<PosFilter, number> = { all: words.length, n: 0, v: 0, a: 0, d: 0, o: 0 };
  for (const w of words) counts[w.pos] += 1;
  return counts;
}

/**
 * 取一页候选：跳过 exclude 里的词；全都排除完了就从头再来（返回 wrapped = true）。
 * exclude 只收字符串 —— 旧界面「换一批」把点击事件当成排除词传进去，这里类型上就挡掉了。
 */
export function pageOf(words: CandidateWord[], exclude: readonly string[], size = PAGE_SIZE): { page: CandidateWord[]; wrapped: boolean } {
  const ex = new Set(exclude);
  const fresh = words.filter((w) => !ex.has(w.word));
  if (fresh.length === 0) return { page: words.slice(0, size), wrapped: true };
  return { page: fresh.slice(0, size), wrapped: false };
}

/** 「换一批」：把当前这页加进排除表 */
export function nextExclude(exclude: readonly string[], shown: readonly CandidateWord[]): string[] {
  return [...new Set([...exclude, ...shown.map((w) => w.word)])];
}

// ---------- 主题联想：本机韵脚服务（backend/app.py） ----------

export const RHYME_SERVICE_URL: string = import.meta.env.VITE_RHYME_API_URL || 'http://localhost:8000';

export type ServiceStatus = { state: 'unknown' } | { state: 'checking' } | { state: 'online' } | { state: 'offline'; reason: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function withTimeout(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(ms) : undefined;
}

export async function checkRhymeService(base = RHYME_SERVICE_URL, fetchImpl: FetchLike = fetch): Promise<ServiceStatus> {
  try {
    const res = await fetchImpl(`${base}/`, { signal: withTimeout(2500) });
    const data = (await res.json()) as { db_ready?: boolean };
    return data.db_ready ? { state: 'online' } : { state: 'offline', reason: '本机韵脚服务在跑，但词库还没初始化' };
  } catch {
    return { state: 'offline', reason: '本机韵脚服务没启动（npm run backend）' };
  }
}

/** 后端的韵母写法：ü 写 v，üe / üan / ün 归到 ue / uan / un，-i 归到 i */
export function backendFinal(final: string): string {
  if (final === '-i') return 'i';
  if (final === 'üe') return 'ue';
  if (final === 'üan') return 'uan';
  if (final === 'ün') return 'un';
  return final.replace(/ü/g, 'v');
}

const BACKEND_POS: Record<string, PartOfSpeech> = { 名词: 'n', 动词: 'v', 形容词: 'a', 副词: 'd' };

export async function themeCandidates(
  target: Syllable,
  filter: RhymeFilter,
  theme: string,
  exclude: readonly string[],
  base = RHYME_SERVICE_URL,
  fetchImpl: FetchLike = fetch,
): Promise<CandidateWord[]> {
  const body: Record<string, unknown> = {
    rhyme: backendFinal(target.final),
    word_length: filter.length,
    theme,
    limit: 60,
    shuffle: true,
    exclude: [...exclude],
  };
  if (filter.tone === '平' || filter.tone === '仄') body.tone_cat = filter.tone;
  else if (filter.tone !== 'all') body.tone = filter.tone;
  const res = await fetchImpl(`${base}/rhyme`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: withTimeout(8000),
  });
  if (!res.ok) throw new Error(`韵脚服务返回 ${res.status}`);
  const data = (await res.json()) as { words?: { word: string; tone?: number; part_of_speech?: string }[] };
  return (data.words ?? []).map((w) => ({ word: w.word, tone: w.tone ?? 0, pos: BACKEND_POS[w.part_of_speech ?? ''] ?? 'o' }));
}
