import { useMemo, useState, type CSSProperties } from 'react';
import {
  allBars,
  COUNT_NAMES,
  finalsOfGroup,
  groupOfWant,
  mismatches,
  parseCellKey,
  previewRhymeMatch,
  RHYME_GROUP_NAMES,
  rhymeMatchOf,
  rhymeSlots,
  ruleName,
  zheName,
  type RhymeGroup,
  type RhymeMatchMode,
  type RhymeRule,
} from '../core';
import { recolorText, type SelMode } from '../engine/editorStore';
import { ruleCandidates } from '../engine/rhymeSearch';
import { cellName } from '../engine/view';
import { Icon } from './icons';
import { useEditor, useServices } from './services';

type Css = CSSProperties & Record<`--${string}`, string | number | undefined>;

export function Swatches() {
  const { store } = useServices();
  const s = useEditor();
  return (
    <div className="swatches" data-role="swatches">
      {s.doc.rules.map((r) => (
        <button
          key={r.id}
          className={`sw${s.activeRule === r.id ? ' on' : ''}`}
          data-role="swatch"
          data-rule={r.id}
          data-count={r.count}
          data-finals={r.finals.join(' ')}
          style={{ '--h': r.hue } as Css}
          aria-label={`${ruleName(r)} · ${COUNT_NAMES[r.count - 1]} ${r.finals.join(' ') || '还没定韵母'}`}
          aria-pressed={s.activeRule === r.id}
          title={`${ruleName(r)} · ${COUNT_NAMES[r.count - 1]} ${r.finals.join(' · ')}`}
          onClick={() => store.setActiveRule(r.id)}
        ></button>
      ))}
      <button className="sw add" data-role="add-rule" aria-label="新建颜色" title="新建颜色（一种颜色 = 一条韵脚规则）" onClick={() => store.addRule()}>
        +
      </button>
    </div>
  );
}

const SEL_MODES: [SelMode, string][] = [
  ['cell', '单格'],
  ['row', '整行'],
  ['box', '框选'],
];

export function SelChips() {
  const { store } = useServices();
  const s = useEditor();
  return (
    <>
      <div className="chips" data-role="sel-chips">
        {SEL_MODES.map(([k, label]) => (
          <button key={k} className={s.selMode === k ? 'on' : ''} aria-pressed={s.selMode === k} onClick={() => store.setSelMode(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="chips">
        <button className={s.invert ? 'on-soft' : ''} aria-pressed={s.invert} data-role="invert" onClick={() => store.toggleInvert()} title="开着时点格子：已选的去掉，没选的加上">
          反选
        </button>
      </div>
    </>
  );
}

function FinalInput({ rule, index }: { rule: RhymeRule; index: number }) {
  const { store } = useServices();
  const value = rule.finals[index] ?? '';
  return (
    <input
      key={`${rule.id}-${index}-${value}`}
      className="fin"
      data-role="final-input"
      defaultValue={value}
      aria-label={`第 ${index + 1} 个韵母`}
      placeholder="韵母"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur();
        e.stopPropagation();
      }}
      onBlur={(e) => store.setRuleFinal(rule.id, index, e.currentTarget.value)}
    />
  );
}

/** 规则按档怎么说：十三辙「言前辙」（认不出辙的位写原样），严格「韵母 ian」 */
function ruleRhymeText(rule: RhymeRule, mode: RhymeMatchMode): string {
  if (!rule.finals.some((f) => f.trim())) return '还没定韵母';
  if (mode === 'strict') return `韵母 ${rule.finals.join(' · ')}`;
  return rule.finals.map((f) => zheName(f) ?? (f || '？')).join(' · ');
}

/** 韵母框后面的小字：十三辙「言前辙 · an ian uan üan 都算」，严格「严格：只认 ian」 */
function ZheHint({ rule, mode }: { rule: RhymeRule; mode: RhymeMatchMode }) {
  if (!rule.finals.every((f) => f.trim())) return null;
  if (mode === 'strict')
    return (
      <span className="zhe" data-role="zhe-hint">
        严格：只认 <b>{rule.finals.join(' · ')}</b>
      </span>
    );
  const groups = rule.finals.map((f) => groupOfWant(f));
  if (groups.some((g) => !g)) return null;
  if (groups.length === 1)
    return (
      <span className="zhe" data-role="zhe-hint">
        <b>{RHYME_GROUP_NAMES[groups[0]!]}辙</b> · {finalsOfGroup(groups[0]!).join(' ')} 都算
      </span>
    );
  return (
    <span className="zhe" data-role="zhe-hint">
      <b>{groups.map((g) => `${RHYME_GROUP_NAMES[g!]}辙`).join(' · ')}</b> · 每一位同辙就算
    </span>
  );
}

function RuleBlock({ rule }: { rule: RhymeRule }) {
  const { store } = useServices();
  const s = useEditor();
  const mode = rhymeMatchOf(s.doc);
  const used = Object.values(s.doc.paint).filter((v) => v === rule.id).length;
  return (
    <div className="blk" style={{ '--h': rule.hue } as Css} data-role="rule-editor">
      <div className="rule-h">
        <i></i>
        <b>{ruleName(rule)}</b>
        <span>
          {ruleRhymeText(rule, mode)} · 已涂 {used} 格
        </span>
        <button className="ibtn" aria-label={`删掉${ruleName(rule)}`} title="删掉这种颜色（涂了它的格子一起擦掉，可以撤销）" onClick={() => store.removeRule(rule.id)}>
          <Icon.close />
        </button>
      </div>
      <div className="seg" data-role="rhyme-count">
        {COUNT_NAMES.map((x, i) => (
          <button key={x} data-role="count-opt" className={rule.count === i + 1 ? 'on' : ''} aria-pressed={rule.count === i + 1} onClick={() => store.setRuleCount(rule.id, i + 1)}>
            {x}
          </button>
        ))}
      </div>
      <div className="finals" data-role="finals">
        <label>{mode === 'strict' ? '韵母串' : '韵'}</label>
        {rule.finals.map((_, i) => (
          <span key={i} style={{ display: 'contents' }}>
            {i > 0 && <span className="fin-sep">·</span>}
            <FinalInput rule={rule} index={i} />
          </span>
        ))}
        <ZheHint rule={rule} mode={mode} />
      </div>
      <p className="note">
        押在每个涂了{ruleName(rule)}的格子里<b>最后 {rule.count} 个字</b>上，拖的长度不算。整首作品里{ruleName(rule)}都按这一条检查；
        {mode === 'strict' ? '韵母严格按字面比（iang 不算押 ang）' : '按十三辙判，同一辙就算押上（写 an、ian、yuan 或「言前」都行）'}。两种颜色定成同一个韵会自动合并。
      </p>
    </div>
  );
}

export function LockPanel({ onClose }: { onClose: () => void }) {
  const { store } = useServices();
  const s = useEditor();
  const bars = allBars(s.doc.grid);
  const locks = s.doc.locks;
  const sel = s.selection.map(parseCellKey);
  const selBars = [...new Set(sel.map((p) => p.barId))];
  const selBeats = [...new Set(sel.map((p) => p.beat))];
  const allRowsLocked = selBars.length > 0 && selBars.every((id) => locks.bars.includes(id));
  const allColsLocked = selBeats.length > 0 && selBeats.every((b) => locks.beats.includes(b));
  const allCellsLocked = s.selection.length > 0 && s.selection.every((k) => locks.cells.includes(k));
  const barNames = (ids: string[]) =>
    ids
      .map((id) => bars.findIndex((b) => b.data.id === id) + 1)
      .filter((n) => n > 0)
      .sort((a, b) => a - b)
      .join('、');
  const rhymeCount = locks.rhyme ? rhymeSlots(s.doc.grid, s.doc.rules, s.doc.paint, rhymeMatchOf(s.doc)).length : 0;
  return (
    <div className="blk" data-role="lock-tools" style={{ borderTop: 0, paddingTop: 0 }}>
      <div className="pn-h">
        <h2>锁定</h2>
        <span>锁住的字不能改字、不能挪落点</span>
        <button className="ibtn" aria-label="收起锁定" onClick={onClose}>
          <Icon.close />
        </button>
      </div>
      <button className={`mi${locks.bars.length ? ' on' : ''}`} data-role="lock-opt" data-lock="row" onClick={() => store.lockRows(!allRowsLocked)}>
        <Icon.lock />
        {allRowsLocked ? '解锁整行' : '锁整行'}
        <span>{locks.bars.length ? `第 ${barNames(locks.bars)} 小节 · 已锁` : '选中行后点'}</span>
      </button>
      <button className={`mi${locks.beats.length ? ' on' : ''}`} data-role="lock-opt" data-lock="col" onClick={() => store.lockColumns(!allColsLocked)}>
        <Icon.lock />
        {allColsLocked ? '解锁整列' : '锁整列'}
        <span>{locks.beats.length ? `第 ${locks.beats.map((b) => b + 1).join('、')} 拍 · 已锁` : '选中列后点'}</span>
      </button>
      <button className={`mi${locks.cells.length ? ' on' : ''}`} data-role="lock-opt" data-lock="cell" onClick={() => store.lockCells(!allCellsLocked)}>
        <Icon.lock />
        {allCellsLocked ? '解锁选中的格子' : '锁选中的格子'}
        <span>{locks.cells.length ? `${locks.cells.length} 格 · 已锁` : s.selection.length ? `已选 ${s.selection.length} 格` : '先选格子'}</span>
      </button>
      <button className={`mi${locks.rhyme ? ' on' : ''}`} data-role="lock-opt" data-lock="rhyme" aria-pressed={locks.rhyme} onClick={() => store.lockRhyme(!locks.rhyme)}>
        <Icon.lock />
        {locks.rhyme ? '解锁全部韵脚位置' : '锁全部韵脚位置'}
        <span>{locks.rhyme ? `开 · ${rhymeCount} 个字` : '关'}</span>
      </button>
      <p className="note">
        表格里：<b>斜纹</b>＝这一格锁了；行头 / 列头 / 格角 / 字角上的<b>小锁</b>＝锁的范围。
      </p>
    </div>
  );
}

/** 十三辙全表：[辙, 例字]（韵母取 core 的辙表 finalsOfGroup，和 src/core/rhyme/syllable.ts 的 FINAL_TO_GROUP 一致） */
const ZHE_TABLE: [RhymeGroup, string][] = [
  ['fahua', '花 家'],
  ['suobo', '波 歌'],
  ['miexie', '街 月'],
  ['yiqi', '记 雨'],
  ['gusu', '路 苦'],
  ['huailai', '来 怀'],
  ['huidui', '累 泪'],
  ['yaotiao', '跑 跳'],
  ['youqiu', '走 求'],
  ['yanqian', '半 边'],
  ['renchen', '人 心'],
  ['jiangyang', '光 香'],
  ['zhongdong', '风 星'],
];

/** 「判押韵：十三辙 | 严格韵母」：整个作品一个设置；改档 = 一步（同辙颜色一起合并），可以撤销 */
export function JudgeBlock({ full }: { full: boolean }) {
  const { store } = useServices();
  const s = useEditor();
  const mode = rhymeMatchOf(s.doc);
  const active = s.doc.rules.find((r) => r.id === s.activeRule);
  const activeGroup = active && active.finals.length ? groupOfWant(active.finals[active.finals.length - 1]) : null;
  const opts: [RhymeMatchMode, string][] = [
    ['thirteen', '十三辙'],
    ['strict', '严格韵母'],
  ];
  return (
    <div className="blk" data-role="judge" data-mode={mode}>
      <div className="blk-h">
        <b>判押韵</b>整个作品一个设置
      </div>
      <div className="seg two" data-role="judge-mode">
        {opts.map(([m, label]) => (
          <button key={m} data-mode={m} className={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => store.setRhymeMatch(m)}>
            {label}
          </button>
        ))}
      </div>
      {full ? (
        <>
          <p className="note">
            <b>十三辙</b>：介音不算（an / ian / uan / üan 都押言前）；前后鼻音分开（in 属人辰、ing 属中东）。<b>严格</b>：韵母一个字母都不差（老作品打开时是这一档）。
          </p>
          <div className="zhe-tab" data-role="zhe-table">
            {ZHE_TABLE.map(([g, eg]) => {
              const on = activeGroup === g ? 'on' : undefined;
              return (
                <span key={g} style={{ display: 'contents' }}>
                  <b className={on}>{RHYME_GROUP_NAMES[g]}</b>
                  <span className={on}>{finalsOfGroup(g).join(' ')}</span>
                  <i className={on}>{eg}</i>
                </span>
              );
            })}
          </div>
        </>
      ) : (
        <p className="note">
          现在按<b>十三辙</b>判：同一辙就算押上（an / ian / uan / üan 都是言前）。
        </p>
      )}
    </div>
  );
}

/** 旧作品右栏：改用十三辙会怎样（按这个作品现在的涂色算） */
function MigratePreview() {
  const s = useEditor();
  const p = useMemo(() => previewRhymeMatch(s.doc.grid, s.doc, rhymeMatchOf(s.doc), 'thirteen'), [s.doc]);
  const name = (hue: number) => ruleName({ hue });
  return (
    <div className="blk" data-role="migrate-preview">
      <div className="blk-h">
        <b>改用十三辙会怎样</b>按这个作品现在的涂色算
      </div>
      <p className="note">
        「不押」
        <b>
          {p.missBefore} → {p.missAfter}
        </b>
        {p.resolved.length ? '：' + p.resolved.map((r) => `${name(r.hue)} ${r.count} 处（「${r.chars.slice(0, 3).join(' ')}」${r.chars.length > 3 ? '…' : ''}）`).join('、') : ''}。
        <br />
        颜色合并：
        {p.merged.length
          ? `${p.rulesBefore} 条规则合并成 ${p.rulesAfter} 种颜色，${p.recolorCells ? recolorText(p.merged, s.doc) : '格子颜色都不变'}`
          : '没有（一种颜色本来就只有一条规则）'}
        。
      </p>
    </div>
  );
}

export function RulePanel({ lockOpen = false, onCloseLock = () => {} }: { lockOpen?: boolean; onCloseLock?: () => void }) {
  const { store } = useServices();
  const s = useEditor();
  const rule = s.doc.rules.find((r) => r.id === s.activeRule) ?? null;
  const bars = useMemo(() => allBars(s.doc.grid), [s.doc.grid]);
  const mode = rhymeMatchOf(s.doc);
  const migrating = store.needsRhymeMigration();
  const miss = useMemo(() => mismatches(s.doc.grid, s.doc.rules, s.doc.paint, rhymeMatchOf(s.doc)), [s.doc]);
  const [page, setPage] = useState(0);
  const cands = useMemo(() => (rule ? ruleCandidates(rule.finals, mode, 9 * (page + 1)).slice(page * 9) : []), [rule, page, mode]);
  const target = store.cursorCell();
  const targetRule = target ? s.doc.paint[target.key] : null;
  const name = (key: string) => {
    const { barId, beat } = parseCellKey(key);
    return cellName(bars.findIndex((b) => b.data.id === barId), beat);
  };
  return (
    <div className="pn" data-role="rhyme-panel">
      {lockOpen && <LockPanel onClose={onCloseLock} />}
      <div className="pn-h">
        <h2>押韵</h2>
        <span>一种颜色 = 一条韵脚规则</span>
      </div>
      {migrating && (
        <>
          <JudgeBlock full />
          <MigratePreview />
        </>
      )}
      <Swatches />
      {rule ? (
        <RuleBlock rule={rule} />
      ) : (
        <p className="note">还没有颜色。点「+」新建一种颜色，定押数和韵母，再选格子涂上。</p>
      )}
      <div className="blk" data-role="sel-tools">
        <div className="blk-h">
          <b>选格子</b>先选颜色，再选格子
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <SelChips />
        </div>
        <p className="note">
          {s.selection.length ? (
            <>
              已选 <b>{s.selection.length} 格</b>
              {s.selection.length === 1 ? `（${name(s.selection[0])}）` : ''}。只有拖音、还没铺字的格子涂不上，<b>一格只能一种颜色</b>。
            </>
          ) : (
            '单击格子选中、双击改这一拍的字；整行点小节号，整列点拍头，框选点两个角。'
          )}
        </p>
        <div className="row-btns">
          <button className="btn primary" data-role="paint" disabled={!rule || !s.selection.length} onClick={() => store.paintSelection()}>
            {rule ? `涂上${ruleName(rule)}（${s.selection.length} 格）` : '涂上颜色'}
          </button>
          <button className="btn" data-role="erase" disabled={!s.selection.length} onClick={() => store.eraseSelection()}>
            擦掉颜色
          </button>
        </div>
      </div>
      {miss.length > 0 && (
        <div className="blk">
          <div className="blk-h">
            <b>对不上本格颜色</b>
            {miss.length} 处 · 只提示，不会自动改
          </div>
          <div className="mismatch-list">
            {miss.slice(0, 6).map((m) => (
              <button key={m.abs} className="miss-tag" data-role="mismatch" onClick={() => store.focusWord(m.abs)}>
                {mode === 'strict' ? `${name(m.key)}「${m.word.text}」韵母是 ${m.got}，这一位要 ${m.want}` : `${name(m.key)}「${m.word.text}」是${zheName(m.got ?? '') ?? m.got}（${m.got}），这一位要押${zheName(m.want) ?? m.want}`}
              </button>
            ))}
          </div>
        </div>
      )}
      {rule && (
        <div className="blk" data-role="candidates">
          <div className="blk-h">
            <b>候选</b>押 {ruleName(rule)} · {!rule.finals.some((f) => f.trim()) ? '先填韵母' : mode === 'strict' ? rule.finals.join(' · ') : ruleRhymeText(rule, mode)}
            {target && targetRule === rule.id ? ` · 填进${cellName(target.global, target.beat)}` : ''}
          </div>
          {cands.length ? (
            <div className="cands">
              {cands.map((w) => (
                <button
                  key={w}
                  className="cand"
                  title={target && targetRule === rule.id ? '填进选中格的韵脚位置' : '先选一个涂了这种颜色的格子'}
                  disabled={!target || targetRule !== rule.id}
                  onClick={() => target && store.fillRhyme(target.key, w)}
                >
                  {w}
                </button>
              ))}
            </div>
          ) : (
            <p className="note">{rule.finals.every(Boolean) ? '本机韵表里没找到，换个韵母试试。' : '韵母填好后这里出候选。'}</p>
          )}
          <div className="row-btns">
            {cands.length > 0 && (
              <button className="btn sm" onClick={() => setPage(page + 1)}>
                换一批
              </button>
            )}
          </div>
          <p className="note">
            候选来自本机韵表，不联网{mode === 'thirteen' ? '；按十三辙找，韵母完全相同的排前面' : ''}。选中一个涂了这种颜色的格子，点一下填进它的韵脚位置。
          </p>
        </div>
      )}
      {!migrating && <JudgeBlock full={mode === 'strict'} />}
    </div>
  );
}
