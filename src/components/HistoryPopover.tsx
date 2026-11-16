import { useEffect, useRef, useState, type ReactElement } from 'react';
import { HISTORY_KIND_NAMES, type HistoryKind, type HistoryStep } from '../core';
import { Icon } from './icons';
import { useEditor } from './services';

const KIND_ICON: Record<HistoryKind, () => ReactElement> = {
  fill: Icon.typeT,
  flow: Icon.flow,
  paint: Icon.paint,
  lock: Icon.lock,
  beat: Icon.swap,
  ai: Icon.edit,
  edit: Icon.edit,
};

function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 30) return '刚刚';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} 分钟前`;
  if (s < 86400) return `${Math.round(s / 3600)} 小时前`;
  const d = new Date(at);
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

function Entry({ step, redo, small }: { step: HistoryStep; redo?: boolean; small: string }) {
  const I = KIND_ICON[step.kind] ?? Icon.edit;
  return (
    <div className={`he${redo ? ' redo' : ''}`} data-role="history-entry" data-type={step.kind} title={HISTORY_KIND_NAMES[step.kind]}>
      <span className="ic">
        <I />
      </span>
      <span>{step.label}</span>
      <small>{small}</small>
    </div>
  );
}

/** 操作历史：上面灰色的是还能重做的，「现在在这里」下面是做过的（新的在上） */
export function HistoryPopover({ onClose }: { onClose: () => void }) {
  const s = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest?.('[data-role="history-btn"]')) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);
  const h = s.history;
  // 面板每次打开时取一次当前时间，算「几分钟前」
  const [now] = useState(() => Date.now());
  const redo = [...h.redo].reverse();
  const done = [...h.done].reverse();
  return (
    <div className="hist-pop" data-role="history" ref={ref} role="dialog" aria-label="操作历史">
      <div className="menu-h">操作历史{h.redo.length ? ` · 撤销了 ${h.redo.length} 步，还能重做` : ''}</div>
      {redo.map((st, i) => (
        <Entry key={`r${i}`} step={st} redo small={i === redo.length - 1 ? '下一步重做' : '可重做'} />
      ))}
      <div className="cur-line" data-role="history-current">
        现在在这里
      </div>
      {done.map((st, i) => (
        <Entry key={`d${i}`} step={st} small={ago(st.at, now)} />
      ))}
      {!done.length && !redo.length && <div className="he-empty">还没有改动。</div>}
      <div className="hist-foot">
        撤销 / 重做只走这一条历史：填字、铺 flow、涂色、锁定、换伴奏都在里面。历史跟作品一起存在本机浏览器，<b>刷新页面后还在</b>，能接着撤销、重做；在中间做了新改动，上面灰色的步骤会丢掉。
      </div>
    </div>
  );
}
