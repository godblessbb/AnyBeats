/**
 * v3.4 段 1：十三辙判韵（DESIGN_v34 §4、§5）。
 * - 十三辙全表每个韵母一条；「摇 愿 远 弯 完 忘 月 云 用 翁 儿 日」逐字（§4.3 表）；
 * - v4 样例（design/fixtures_v34，主会话给的文件原样）：严格 0 处不押；切十三辙后 15 条规则合并成 6 条、117 格颜色不变、0 处不押；
 * - 用 v4 构造「每种颜色一条规则」：严格 56 处、十三辙 0 处（§4.1 表的分色数字也逐个对）；
 * - 没有 rhymeMatch 字段的文件 = strict；'loose' 读作 thirteen；别的值当没有；有才写。
 * 夹具里没有 v1 那份 58 格的作品，不硬造。
 */
import { describe, expect, it } from 'vitest';
import v4Raw from '../../../design/fixtures_v34/koi_zh_lyrics_v4_nopickup.anybeats?raw';
import { lockedWordTicks } from '../locks';
import { planRhymeFill } from '../aiEdit';
import { docCodec, deserializeProject, serializeProject, type Doc, type Project } from '../project';
import {
  canonicalFinal,
  finalOfChar,
  finalsMatch,
  groupOfWant,
  mismatches,
  previewRhymeMatch,
  readRhymeMatch,
  rhymeMatchOf,
  rhymeSlots,
  sameRhyme,
  switchRhymeMatch,
  zheName,
  type RhymeRule,
} from '../rhymeRules';
import { analyze, RHYME_GROUP_NAMES, type RhymeGroup } from '../rhyme/syllable';
import { History, restoreHistory, serializeHistory } from '../history';

/** 十三辙原表（DESIGN_v34 §4.2；和 src/core/rhyme/syllable.ts 的 FINAL_TO_GROUP 一致） */
const TABLE: [RhymeGroup, string, string[]][] = [
  ['fahua', '发花', ['a', 'ia', 'ua']],
  ['suobo', '梭波', ['o', 'e', 'uo']],
  ['miexie', '乜斜', ['ie', 'üe', 'ê']],
  ['yiqi', '一七', ['i', 'ü', '-i', 'er']],
  ['gusu', '姑苏', ['u']],
  ['huailai', '怀来', ['ai', 'uai']],
  ['huidui', '灰堆', ['ei', 'ui']],
  ['yaotiao', '遥条', ['ao', 'iao']],
  ['youqiu', '由求', ['ou', 'iu']],
  ['yanqian', '言前', ['an', 'ian', 'uan', 'üan']],
  ['renchen', '人辰', ['en', 'in', 'un', 'ün']],
  ['jiangyang', '江阳', ['ang', 'iang', 'uang']],
  ['zhongdong', '中东', ['eng', 'ing', 'ong', 'iong', 'ueng']],
];
const ROWS = TABLE.flatMap(([g, name, fs]) => fs.map((f) => [f, g, name] as const));

describe('十三辙全表：每个韵母一条', () => {
  it('表里 13 辙、38 个韵母，辙名和 syllable.ts 一致', () => {
    expect(TABLE).toHaveLength(13);
    expect(ROWS).toHaveLength(38);
    for (const [g, name] of TABLE) expect(RHYME_GROUP_NAMES[g]).toBe(name);
  });

  it.each(ROWS)('%s 属 %s：同辙每个韵母都押（十三辙），别的辙都不押；严格档只押自己', (f, g, name) => {
    expect(groupOfWant(f)).toBe(g);
    expect(zheName(f)).toBe(`${name}辙`);
    const got = f === '-i' ? 'i' : f; // 字取出来的是字面韵母（zhi 的韵母字面就是 i）
    for (const [other, og] of ROWS) {
      expect(finalsMatch(got, other, 'thirteen')).toBe(og === g);
      expect(finalsMatch(got, other, 'strict')).toBe(canonicalFinal(other) === canonicalFinal(f));
    }
    // 规则里直接写辙名也认
    expect(finalsMatch(got, name, 'thirteen')).toBe(true);
    expect(finalsMatch(got, `${name}辙`, 'strict')).toBe(true);
  });

  it('in / ing 不同辙（人辰 / 中东，拍板 Q5=A）', () => {
    expect(finalsMatch('in', 'ing', 'thirteen')).toBe(false);
    expect(finalsMatch('en', 'eng', 'thirteen')).toBe(false);
    expect(finalsMatch('ing', 'ong', 'thirteen')).toBe(true);
  });

  it('规则里写整音节 / v / 辙名都先还原：yuan = üan、wan = uan、v = ü、「言前」', () => {
    expect(groupOfWant('yuan')).toBe('yanqian');
    expect(groupOfWant('wang')).toBe('jiangyang');
    expect(groupOfWant('lv')).toBe('yiqi');
    expect(groupOfWant('言前')).toBe('yanqian');
    expect(groupOfWant('言前辙')).toBe('yanqian');
    expect(groupOfWant('')).toBeNull();
    expect(groupOfWant('xyz')).toBeNull();
    expect(canonicalFinal('yuan')).toBe('üan');
    expect(canonicalFinal('zhi')).toBe('i');
    expect(finalsMatch('üan', 'yuan', 'strict')).toBe(true);
    expect(finalsMatch('an', 'yuan', 'strict')).toBe(false);
    expect(finalsMatch('an', 'yuan', 'thirteen')).toBe(true);
  });

  it('同韵合并按档：十三辙 an / ian 同韵，严格不同；空韵母不算', () => {
    const a = { count: 1 as const, finals: ['an'] };
    const b = { count: 1 as const, finals: ['ian'] };
    expect(sameRhyme(a, b, 'thirteen')).toBe(true);
    expect(sameRhyme(a, b, 'strict')).toBe(false);
    expect(sameRhyme({ count: 1, finals: [''] }, { count: 1, finals: [''] }, 'thirteen')).toBe(false);
    expect(sameRhyme({ count: 2, finals: ['i', 'ang'] }, { count: 2, finals: ['ü', 'uang'] }, 'thirteen')).toBe(true);
    expect(sameRhyme({ count: 1, finals: ['言前'] }, { count: 1, finals: ['an'] }, 'thirteen')).toBe(true);
    expect(sameRhyme({ count: 1, finals: ['言前'] }, { count: 1, finals: ['an'] }, 'strict')).toBe(false);
  });
});

describe('y / w 开头的字逐字（§4.3 表）', () => {
  // [字, pinyin-pro, 还原成, 辙, 严格档里它算什么]
  const CHARS: [string, string, string, RhymeGroup, string][] = [
    ['摇', 'yao', 'iao', 'yaotiao', 'iao'],
    ['愿', 'yuan', 'üan', 'yanqian', 'üan'],
    ['远', 'yuan', 'üan', 'yanqian', 'üan'],
    ['弯', 'wan', 'uan', 'yanqian', 'uan'],
    ['完', 'wan', 'uan', 'yanqian', 'uan'],
    ['忘', 'wang', 'uang', 'jiangyang', 'uang'],
    ['月', 'yue', 'üe', 'miexie', 'üe'],
    ['云', 'yun', 'ün', 'renchen', 'ün'],
    ['用', 'yong', 'iong', 'zhongdong', 'iong'],
    ['翁', 'weng', 'ueng', 'zhongdong', 'ueng'],
    ['儿', 'er', 'er', 'yiqi', 'er'],
    ['日', 'ri', '-i', 'yiqi', 'i'],
  ];
  it.each(CHARS)('%s：%s → %s，%s；严格档算 %s', (ch, py, fin, g, strict) => {
    const s = analyze(ch)[0]!;
    expect(s.pinyin).toBe(py);
    expect(s.final).toBe(fin);
    expect(s.group).toBe(g);
    expect(finalOfChar(ch)).toBe(strict);
    expect(groupOfWant(finalOfChar(ch)!)).toBe(g);
  });

  it('严格档里「摇 愿 远 弯 完 忘」只押自己那个带介音的韵母，十三辙回到该押的辙', () => {
    const want: Record<string, string> = { 摇: 'ao', 愿: 'an', 远: 'an', 弯: 'an', 完: 'an', 忘: 'ang' };
    for (const [ch, w] of Object.entries(want)) {
      expect(finalsMatch(finalOfChar(ch)!, w, 'strict')).toBe(false);
      expect(finalsMatch(finalOfChar(ch)!, w, 'thirteen')).toBe(true);
    }
  });
});

describe('存档：rhymeMatch 可选字段（版本号不升）', () => {
  const v4 = JSON.parse(v4Raw) as Record<string, unknown>;

  it('v4 样例没有 rhymeMatch（phrasing 草稿字段照旧不读）→ 旧作品 = strict', () => {
    expect(v4.version).toBe(3);
    expect('rhymeMatch' in v4).toBe(false);
    const p = deserializeProject(v4Raw);
    expect(p.rhymeMatch).toBeUndefined();
    expect(rhymeMatchOf(p)).toBe('strict');
    expect(JSON.parse(serializeProject(p))).not.toHaveProperty('rhymeMatch');
  });

  it("只认 'thirteen' | 'strict'；'loose' 读作 thirteen；别的值当没有；有才写、读回来一样", () => {
    expect(readRhymeMatch('thirteen')).toBe('thirteen');
    expect(readRhymeMatch('strict')).toBe('strict');
    expect(readRhymeMatch('loose')).toBe('thirteen');
    expect(readRhymeMatch('STRICT')).toBeUndefined();
    expect(readRhymeMatch(1)).toBeUndefined();
    const with_ = (v: unknown) => deserializeProject(JSON.stringify({ ...v4, rhymeMatch: v }));
    expect(with_('thirteen').rhymeMatch).toBe('thirteen');
    expect(with_('strict').rhymeMatch).toBe('strict');
    expect(with_('loose').rhymeMatch).toBe('thirteen');
    expect(with_('wide').rhymeMatch).toBeUndefined();
    const p = with_('thirteen');
    const file = JSON.parse(serializeProject(p));
    expect(file.version).toBe(3);
    expect(file.rhymeMatch).toBe('thirteen');
    expect(serializeProject(deserializeProject(serializeProject(p)))).toBe(serializeProject(p));
  });

  it('撤销历史（docCodec）多存这一段；旧历史没有这一段读回来也是没有', () => {
    const p = deserializeProject(v4Raw);
    const doc: Doc = { ...p };
    const h = new History<Doc>(doc, { now: () => 1 });
    h.push({ ...doc, rhymeMatch: 'thirteen' }, { label: 'x', kind: 'paint', at: 1 });
    const back = restoreHistory(serializeHistory(h, docCodec), docCodec);
    expect(back.state.rhymeMatch).toBe('thirteen');
    expect(back.undo().rhymeMatch).toBeUndefined();
    expect(docCodec.split({ ...doc, rhymeMatch: 'strict' }).join()).not.toBe(docCodec.split(doc).join());
  });
});

const hueOfCell = (p: Pick<Project, 'rules' | 'paint'>) => {
  const hue = new Map(p.rules.map((r) => [r.id, r.hue]));
  return Object.fromEntries(Object.entries(p.paint).map(([k, v]) => [k, hue.get(v)]));
};

describe('v4 样例：15 条规则 → 6 种颜色', () => {
  const p = deserializeProject(v4Raw);

  it('严格档 0 处不押（就是为了绕开严格判韵才拆成 15 条）', () => {
    expect(p.rules).toHaveLength(15);
    expect(Object.keys(p.paint)).toHaveLength(117);
    expect(mismatches(p.grid, p.rules, p.paint, 'strict')).toHaveLength(0);
    expect(rhymeSlots(p.grid, p.rules, p.paint, 'strict').filter((s) => s.ok === true)).toHaveLength(117);
  });

  it('切十三辙：合并成 6 条、117 格颜色（色相）一个不变、0 处不押；规则里的韵母不改写', () => {
    const r = switchRhymeMatch(p, 'thirteen');
    expect(r.rules.map((x) => [x.id, x.hue, x.finals])).toEqual([
      ['r_ian', 215, ['ian']],
      ['r_ing', 150, ['ing']],
      ['r_iao', 340, ['iao']],
      ['r_ang', 42, ['ang']],
      ['r_ei', 185, ['ei']],
      ['r_i', 100, ['i']],
    ]);
    expect(Object.keys(r.paint)).toHaveLength(117);
    expect(hueOfCell(r)).toEqual(hueOfCell(p));
    expect(r.merged).toHaveLength(9);
    expect(r.merged.every((m) => !m.recolor)).toBe(true);
    expect(mismatches(p.grid, r.rules, r.paint, 'thirteen')).toHaveLength(0);
    const pre = previewRhymeMatch(p.grid, p, 'strict', 'thirteen');
    expect([pre.missBefore, pre.missAfter, pre.rulesBefore, pre.rulesAfter, pre.recolorCells]).toEqual([0, 0, 15, 6, 0]);
  });

  it('不切档时同一份规则在十三辙下也是 0 处不押', () => {
    expect(mismatches(p.grid, p.rules, p.paint, 'thirteen')).toHaveLength(0);
  });
});

describe('v4 每种颜色只建一条规则（§4.1）：严格 56 处，十三辙 0 处', () => {
  const p = deserializeProject(v4Raw);
  const ONE: Record<number, string> = { 215: 'an', 150: 'ong', 340: 'ao', 42: 'ang', 185: 'ei', 100: 'i' };
  const rules: RhymeRule[] = Object.entries(ONE).map(([hue, f]) => ({ id: `h${hue}`, hue: Number(hue), count: 1, finals: [f] }));
  const hueOf = new Map(p.rules.map((r) => [r.id, r.hue]));
  const paint = Object.fromEntries(Object.entries(p.paint).map(([k, v]) => [k, `h${hueOf.get(v)}`]));

  it('严格 56 / 117：蓝 20、粉 13、金 10、绿 8、青 5；十三辙 0', () => {
    const miss = mismatches(p.grid, rules, paint, 'strict');
    expect(miss).toHaveLength(56);
    const by: Record<string, number> = {};
    for (const m of miss) by[m.ruleId] = (by[m.ruleId] ?? 0) + 1;
    expect(by).toEqual({ h215: 20, h340: 13, h42: 10, h150: 8, h185: 5 });
    expect(mismatches(p.grid, rules, paint, 'thirteen')).toHaveLength(0);
  });

  it('迁移预览：不押 56 → 0、没有颜色合并、颜色不变；按颜色分的数字和 §4.1 一样', () => {
    const pre = previewRhymeMatch(p.grid, { rules, paint }, 'strict', 'thirteen');
    expect([pre.missBefore, pre.missAfter, pre.rulesBefore, pre.rulesAfter, pre.recolorCells, pre.merged.length]).toEqual([56, 0, 6, 6, 0, 0]);
    expect(pre.resolved.map((r) => [r.hue, r.count])).toEqual([
      [215, 20],
      [340, 13],
      [42, 10],
      [150, 8],
      [185, 5],
    ]);
  });
});

describe('不同色相合并会变色时写清楚', () => {
  it('绿色（ian）并进蓝色（an）：12 格从绿变蓝', () => {
    const p = deserializeProject(v4Raw);
    const rules: RhymeRule[] = [
      { id: 'B', hue: 215, count: 1, finals: ['an'] },
      { id: 'G', hue: 150, count: 1, finals: ['ian'] },
    ];
    const keys = Object.keys(p.paint);
    const paint = Object.fromEntries(keys.slice(0, 20).map((k, i) => [k, i < 12 ? 'G' : 'B']));
    const r = switchRhymeMatch({ rules, paint }, 'thirteen');
    expect(r.rules.map((x) => x.id)).toEqual(['B']);
    expect(r.merged).toEqual([{ removed: 'G', kept: 'B', cells: 12, recolor: true }]);
    expect(previewRhymeMatch(p.grid, { rules, paint }, 'strict', 'thirteen').recolorCells).toBe(12);
  });
});

describe('锁定 / AI 填韵：按作品存的档（位置和档无关）', () => {
  it('lockedWordTicks、planRhymeFill 在两档下韵脚位置一样，档从作品取', () => {
    const p = deserializeProject(v4Raw);
    const locks = { ...p.locks, rhyme: true };
    const a = lockedWordTicks(p.grid, { ...p, locks });
    const b = lockedWordTicks(p.grid, { ...p, locks, rhymeMatch: 'thirteen' });
    expect(a.size).toBe(117);
    expect([...a]).toEqual([...b]);
    expect(planRhymeFill(p.grid, { ...p, rhymeMatch: 'thirteen' })).toEqual(planRhymeFill(p.grid, p));
  });
});
