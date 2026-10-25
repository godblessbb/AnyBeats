import { pinyin } from 'pinyin-pro';

/** 十三辙：中文说唱最常用的韵部划分（忽略介音，ang/iang/uang 同押）。 */
export type RhymeGroup =
  | 'fahua' // 发花 a ia ua
  | 'suobo' // 梭波 o e uo
  | 'miexie' // 乜斜 ie üe
  | 'yiqi' // 一七 i ü -i er
  | 'gusu' // 姑苏 u
  | 'huailai' // 怀来 ai uai
  | 'huidui' // 灰堆 ei ui
  | 'yaotiao' // 遥条 ao iao
  | 'youqiu' // 由求 ou iu
  | 'yanqian' // 言前 an ian uan üan
  | 'renchen' // 人辰 en in un ün
  | 'jiangyang' // 江阳 ang iang uang
  | 'zhongdong'; // 中东 eng ing ong iong

export const RHYME_GROUP_NAMES: Record<RhymeGroup, string> = {
  fahua: '发花',
  suobo: '梭波',
  miexie: '乜斜',
  yiqi: '一七',
  gusu: '姑苏',
  huailai: '怀来',
  huidui: '灰堆',
  yaotiao: '遥条',
  youqiu: '由求',
  yanqian: '言前',
  renchen: '人辰',
  jiangyang: '江阳',
  zhongdong: '中东',
};

const FINAL_TO_GROUP: Record<string, RhymeGroup> = {
  a: 'fahua', ia: 'fahua', ua: 'fahua',
  o: 'suobo', e: 'suobo', uo: 'suobo',
  ie: 'miexie', üe: 'miexie', ê: 'miexie',
  i: 'yiqi', ü: 'yiqi', '-i': 'yiqi', er: 'yiqi',
  u: 'gusu',
  ai: 'huailai', uai: 'huailai',
  ei: 'huidui', ui: 'huidui',
  ao: 'yaotiao', iao: 'yaotiao',
  ou: 'youqiu', iu: 'youqiu',
  an: 'yanqian', ian: 'yanqian', uan: 'yanqian', üan: 'yanqian',
  en: 'renchen', in: 'renchen', un: 'renchen', ün: 'renchen',
  ang: 'jiangyang', iang: 'jiangyang', uang: 'jiangyang',
  eng: 'zhongdong', ing: 'zhongdong', ong: 'zhongdong', iong: 'zhongdong', ueng: 'zhongdong',
};

export interface Syllable {
  char: string;
  /** 无调拼音，如 "jiang" */
  pinyin: string;
  initial: string;
  /** 规范化韵母：ü 统一写 ü，y/w 零声母还原，zhi/chi/shi/ri/zi/ci/si 记为 "-i" */
  final: string;
  /** 1–4，轻声为 0 */
  tone: number;
  group: RhymeGroup;
}

const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's'];

const Y_FINALS: Record<string, string> = {
  yi: 'i', ya: 'ia', ye: 'ie', yao: 'iao', you: 'iu', yan: 'ian', yang: 'iang', yin: 'in', ying: 'ing',
  yong: 'iong', yu: 'ü', yue: 'üe', yuan: 'üan', yun: 'ün', yo: 'o',
};
const W_FINALS: Record<string, string> = {
  wu: 'u', wa: 'ua', wo: 'uo', wai: 'uai', wei: 'ui', wan: 'uan', wen: 'un', wang: 'uang', weng: 'ueng',
};

/** 把一个无调拼音音节拆成声母 + 规范化韵母。 */
export function splitSyllable(py: string): { initial: string; final: string } {
  const s = py.toLowerCase().replace(/v/g, 'ü').replace(/u:/g, 'ü');
  if (s in Y_FINALS) return { initial: '', final: Y_FINALS[s] };
  if (s in W_FINALS) return { initial: '', final: W_FINALS[s] };
  const initial = INITIALS.find((i) => s.startsWith(i)) ?? '';
  let final = s.slice(initial.length);
  if (final === 'i' && ['zh', 'ch', 'sh', 'r', 'z', 'c', 's'].includes(initial)) final = '-i';
  if (['j', 'q', 'x'].includes(initial) && final.startsWith('u')) final = 'ü' + final.slice(1);
  if (final === 'iou') final = 'iu';
  if (final === 'uei') final = 'ui';
  if (final === 'uen') final = 'un';
  return { initial, final };
}

export function groupOfFinal(final: string): RhymeGroup | null {
  return FINAL_TO_GROUP[final] ?? null;
}

const HAN = /[\u3400-\u9fff]/;

/**
 * 逐字分析一段文字（整句一起送进 pinyin-pro 以利用上下文消歧多音字）。
 * 非汉字返回 null。
 */
export function analyze(text: string): (Syllable | null)[] {
  const chars = Array.from(text);
  const plain = pinyin(text, { toneType: 'none', type: 'array' });
  const tones = pinyin(text, { pattern: 'num', type: 'array' });
  return chars.map((char, i) => {
    if (!HAN.test(char)) return null;
    const py = plain[i] ?? '';
    const { initial, final } = splitSyllable(py);
    const group = groupOfFinal(final);
    if (!group) return null;
    return { char, pinyin: py, initial, final, tone: Number(tones[i]) || 0, group };
  });
}
