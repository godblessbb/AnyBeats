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

/** 图例：一拍里的方格（[起点, 宽, 字]）；没列出来的地方就是空音 */
function Sample({ items, trip }: { items: [number, number, string][]; trip?: boolean }) {
  return (
    <div className="mini sq-mini" style={{ width: 114 }}>
      <div className="mrow" style={{ '--n': 1 } as Css}>
        <div className="mc">
          {trip && (
            <span className="trip">
              <b>3</b>
            </span>
          )}
          {items.map(([t, l, ch]) => (
            <span key={t} className={`sq ${ch ? 'filled' : 'empty'}`} data-role="legend-square" style={{ '--t': t, '--l': l } as Css}>
              {ch && <span className="ch">{ch}</span>}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Key({ k, children }: { k: React.ReactNode; children: React.ReactNode }) {
  return (
    <li>
      <span className="keys">{k}</span>
      <span>{children}</span>
    </li>
  );
}

export function FlowPanel() {
  const { store } = useServices();
  const s = useEditor();
  const unit = precisionUnit(s.precision);
  const label = PRECISIONS.find((p) => p.key === s.precision)?.label ?? s.precision;
  const bar = s.cursor !== null ? Math.floor(s.cursor / TICKS_PER_BAR) : s.flowEdit ? Math.floor(s.flowEdit.abs / TICKS_PER_BAR) : null;
  const words = bar !== null ? (barAt(s.doc.grid, bar)?.words.length ?? 0) : 0;
  return (
    <div className="pn" data-role="flow-panel">
      <div className="pn-h">
        <h2>铺 flow</h2>
        <span>第一步：先定每个字落在哪</span>
      </div>
      <div className="blk" data-role="slot-legend">
        <div className="blk-h">
          <b>方格和空音</b>
        </div>
        <div className="lg-row">
          <Sample items={[[0, 48, '']]} />
          <p className="note">
            <b>方格</b> = 这里唱一个字（还没写字）。每一拍默认一个。
          </p>
        </div>
        <div className="lg-row">
          <Sample items={[[0, 24, '夜'], [24, 24, '']]} />
          <p className="note">写了字的方格：字在格子里。</p>
        </div>
        <div className="lg-row">
          <Sample items={[[0, 24, '']]} />
          <p className="note">
            <b>空音</b>：没有方格，只是空白，这里不唱。
          </p>
        </div>
        <div className="lg-row">
          <Sample items={[[0, 16, ''], [16, 16, ''], [32, 16, '']]} trip />
          <p className="note">
            <b>三连</b>：格子上方标「3」。
          </p>
        </div>
      </div>
      <div className="blk" data-role="key-help">
        <div className="blk-h">
          <b>点方格以后</b>
        </div>
        <ul className="keylist">
          <Key k="打字">写进这一格（一格一个字）</Key>
          <Key k={<span className="kbd">空格</span>}>一分为二：1/4 → 1/8 → 1/16 → 1/32（最细）</Key>
          <Key k={<><span className="kbd">Shift</span>+<span className="kbd">空格</span></>}>分成三连</Key>
          <Key k={<><span className="kbd">空格</span><span className="kbd">空格</span></>}>0.4 秒内两下：变成空音（只算一步）</Key>
          <Key k={<span className="kbd">退格</span>}>有字先清字；空方格和旁边那一半合回去</Key>
          <Key k={<><span className="kbd">Ctrl</span>+<span className="kbd">Z</span></>}>撤销，每一下都能撤</Key>
        </ul>
        <p className="note">输入法正在拼字时按空格是选字，不会分格。写了字的格子分开后，字留在左边那一半。点空白的地方按下面的精度放一个方格。</p>
      </div>
      <div className="blk">
        <div className="blk-h">
          <b>精度 · 拖长度</b>
        </div>
        <PrecisionChips />
        <p className="note">
          点空白放方格、拖字的长度都吸附到这里。拖字（或它后面浅底）的<b>右边缘</b>改长度，可以拖过拍线、拖到下一行开头；或者按 <span className="kbd">-</span> / <span className="kbd">=</span>，每次一个精度单位（现在 {label} = {unit} tick）。
        </p>
      </div>
      <div className="blk">
        <div className="blk-h">
          <b>{bar !== null ? `第 ${bar + 1} 小节` : '这一行'}</b>
          {bar !== null ? `${words} 个方格` : '先点一个方格'}
        </div>
        <div className="row-btns">
          <button className="btn sm" disabled={bar === null} onClick={() => bar !== null && store.copyFlowToNext(bar)}>
            复制到下一行
          </button>
          <button className="btn sm" disabled={bar === null} onClick={() => bar !== null && store.clearBarFlow(bar)}>
            清空这一行
          </button>
        </div>
        <p className="note">要整首重来，用工具条上的「清空全部 flow…」：每一拍变回一个方格。</p>
      </div>
    </div>
  );
}
