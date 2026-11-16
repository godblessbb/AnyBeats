import { useMemo, useState, type CSSProperties } from 'react';
import { allBars, COUNT_NAMES, mismatches, parseCellKey, rhymeSlots, ruleName, type RhymeRule } from '../core';
import type { SelMode } from '../engine/editorStore';
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
  ['col', '整列'],
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

function RuleBlock({ rule }: { rule: RhymeRule }) {
  const { store } = useServices();
  const s = useEditor();
  const used = Object.values(s.doc.paint).filter((v) => v === rule.id).length;
  return (
    <div className="blk" style={{ '--h': rule.hue } as Css} data-role="rule-editor">
      <div className="rule-h">
        <i></i>
        <b>{ruleName(rule)}</b>
        <span>已涂 {used} 格</span>
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
        <label>韵母串</label>
        {rule.finals.map((_, i) => (
          <span key={i} style={{ display: 'contents' }}>
            {i > 0 && <span className="fin-sep">·</span>}
            <FinalInput rule={rule} index={i} />
          </span>
        ))}
      </div>
      <p className="note">
        押在每个涂了{ruleName(rule)}的格子里<b>最后 {rule.count} 个字</b>上，拖的长度不算。整首作品里{ruleName(rule)}都按这一条检查；韵母严格按字面比（iang 不算押 ang）。两种颜色定成同一个韵会自动合并。
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
  const rhymeCount = locks.rhyme ? rhymeSlots(s.doc.grid, s.doc.rules, s.doc.paint).length : 0;
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

export function RulePanel({ lockOpen = false, onCloseLock = () => {} }: { lockOpen?: boolean; onCloseLock?: () => void }) {
  const { store } = useServices();
  const s = useEditor();
  const rule = s.doc.rules.find((r) => r.id === s.activeRule) ?? null;
  const bars = useMemo(() => allBars(s.doc.grid), [s.doc.grid]);
  const miss = useMemo(() => mismatches(s.doc.grid, s.doc.rules, s.doc.paint), [s.doc]);
  const [page, setPage] = useState(0);
  const cands = useMemo(() => (rule ? ruleCandidates(rule.finals, 9 * (page + 1)).slice(page * 9) : []), [rule, page]);
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
            '点格子选中；整行点行头，整列点列头，框选点两个角。'
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
                {name(m.key)}「{m.word.text}」韵母是 {m.got}，这一位要 {m.want}
              </button>
            ))}
          </div>
        </div>
      )}
      {rule && (
        <div className="blk" data-role="candidates">
          <div className="blk-h">
            <b>候选</b>押 {ruleName(rule)} · {rule.finals.join(' · ') || '先填韵母'}
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
          <p className="note">候选来自本机韵表，不联网。选中一个涂了这种颜色的格子，点一下填进它的韵脚位置。</p>
        </div>
      )}
    </div>
  );
}
