import type { CSSProperties } from 'react';
import { barAt, PRECISIONS, precisionUnit, TICKS_PER_BAR } from '../core';
import { useEditor, useServices } from './services';

type Css = CSSProperties & Record<`--${string}`, string | number | undefined>;

export function PrecisionChips() {
  const { store } = useServices();
  const s = useEditor();
  return (
    <div className="chips" data-role="precision">
      {PRECISIONS.map((p) => (
        <button key={p.key} className={s.precision === p.key ? 'on' : ''} aria-pressed={s.precision === p.key} onClick={() => store.setPrecision(p.key)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

/** 图例：字写在落点上；拖长了的字后面铺一块同色浅底到它结束（拖音 = 字的长度） */
function Sample({ drag, label }: { drag: boolean; label: string }) {
  return (
    <div className="mini" style={{ width: 118 }}>
      <div className="mrow" style={{ '--n': 1 } as Css}>
        <div className="mc">
          {drag && <span className="tint ink" style={{ left: '1px', right: '2px' }}></span>}
          <span className="wd" data-kind="word" style={{ '--t': 0, '--l': 12 } as Css}>
            <span className="ch">{label}</span>
          </span>
          {!drag && (
            <span className="wd" data-kind="word" style={{ '--t': 24, '--l': 12 } as Css}>
              <span className="ch">去</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function FlowPanel() {
  const { store } = useServices();
  const s = useEditor();
  const unit = precisionUnit(s.precision);
  const label = PRECISIONS.find((p) => p.key === s.precision)?.label ?? s.precision;
  const bar = s.cursor !== null ? Math.floor(s.cursor / TICKS_PER_BAR) : null;
  const words = bar !== null ? (barAt(s.doc.grid, bar)?.words.length ?? 0) : 0;
  return (
    <div className="pn" data-role="flow-panel">
      <div className="pn-h">
        <h2>铺 flow</h2>
        <span>第一步：先铺字的位置，第二步再填字</span>
      </div>
      <div className="legend" data-role="slot-legend">
        <div className="stretch">
          <Sample drag label="字" />
          <p className="note">
            <b>拖音 = 字的长度</b>：字靠左写在落点上，后面一块同色浅底一直铺到它唱完；可以拖过格线、拖到下一行开头。
          </p>
        </div>
        <div className="stretch">
          <Sample drag={false} label="字" />
          <p className="note">
            <b>空音</b>就是字和字之间留出的空白，不另外画。
          </p>
        </div>
      </div>
      <div className="blk">
        <div className="blk-h">
          <b>落点精度</b>
        </div>
        <PrecisionChips />
        <p className="note">每拍 48 tick：1/8 = 24、1/16 = 12、1/32 = 6、三连 = 16、半拍三连 = 8。点格子里的位置就放一个字；一拍里放 3 个字时格子上方标「3」。</p>
      </div>
      <div className="blk">
        <div className="blk-h">
          <b>怎么拉长</b>
        </div>
        <p className="note">
          拖字（或它后面浅底）的<b>右边缘</b>：往右拉长、往左缩短，吸附到这里的精度（第 2 步指针停在格子上也能拖）；或者选中按 <span className="kbd">-</span>，每按一次多拖一个精度单位（现在 {label} = {unit} tick），按 <span className="kbd">=</span> 缩回一个单位。
          按 <span className="kbd">⌫</span> 删掉这个字，留下的就是空音。拉长不会改字，也不会挪后面的字。
        </p>
      </div>
      <div className="blk">
        <div className="blk-h">
          <b>{bar !== null ? `第 ${bar + 1} 小节` : '这一行'}</b>
          {bar !== null ? `${words} 个字` : '先点一个字'}
        </div>
        <div className="row-btns">
          <button className="btn sm" disabled={bar === null} onClick={() => bar !== null && store.copyFlowToNext(bar)}>
            复制到下一行
          </button>
          <button className="btn sm" disabled={bar === null} onClick={() => bar !== null && store.clearBarFlow(bar)}>
            清空这一行
          </button>
        </div>
      </div>
    </div>
  );
}
