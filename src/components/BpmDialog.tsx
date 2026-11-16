import { useEffect } from 'react';
import { formatClock } from '../engine/view';
import { Icon } from './icons';
import { useEditor, useServices } from './services';

/** 新伴奏的 BPM 和工程不一样：二选一，默认推荐「改用新 BPM」 */
export function BpmDialog() {
  const { store } = useServices();
  const s = useEditor();
  const p = s.beatSwap;
  useEffect(() => {
    if (!p) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.cancelBeatSwap();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [p, store]);
  if (!p) return null;
  const { keep, adopt, recommended } = p.plan;
  const pct = Math.round(Math.abs(1 - keep.rate) * 100);
  const slower = keep.rate < 1;
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  return (
    <div className="backdrop" onClick={() => store.cancelBeatSwap()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="bpm-t" data-role="bpm-dialog" onClick={(e) => e.stopPropagation()}>
        <button className="ibtn x" aria-label="取消，不换伴奏" title="取消，不换伴奏" onClick={() => store.cancelBeatSwap()}>
          <Icon.close />
        </button>
        <h3 id="bpm-t">新伴奏的 BPM 不一样</h3>
        <div className="bpm-cmp">
          <span className="muted">原来</span>
          <b>{fmt(p.plan.oldBpm)}</b>
          <span className="muted">→ {p.name}</span>
          <b>{fmt(p.plan.newBpm)}</b>
          <span className="muted">BPM</span>
        </div>
        <div className="why">
          歌词记的是「第几小节、第几拍、第几个 tick」，<b>跟着拍子走，不跟秒数走</b>。不管选哪个，每个字都还在原来那一拍上，不会错位；变的只是播放快慢。
        </div>
        <div className="opts">
          <button className={`opt${recommended === 'keep' ? ' rec' : ''}`} data-role="bpm-option" data-choice="keep" data-recommended={recommended === 'keep' ? '1' : undefined} autoFocus={recommended === 'keep'} onClick={() => store.confirmBeatSwap('keep')}>
            <b>保留原 BPM（{fmt(keep.bpm)}）</b>
            <span>
              新伴奏变速到 {fmt(keep.bpm)} 播放（{slower ? '慢' : '快'} {pct}%），整首速度不变，{formatClock(keep.songSeconds, false)}。
            </span>
            <em>{recommended === 'keep' ? '推荐' : '已经录过 / 练熟的作品可以选这个'}</em>
          </button>
          <button className={`opt${recommended === 'adopt' ? ' rec' : ''}`} data-role="bpm-option" data-choice="adopt" data-recommended={recommended === 'adopt' ? '1' : undefined} autoFocus={recommended === 'adopt'} onClick={() => store.confirmBeatSwap('adopt')}>
            <b>改用新 BPM（{fmt(adopt.bpm)}）</b>
            <span>
              整首按 {fmt(adopt.bpm)} 走，字跟着拍子一起{adopt.bpm > keep.bpm ? '变快' : '变慢'}，一首从 {formatClock(keep.songSeconds, false)} 变成 {formatClock(adopt.songSeconds, false)}。
            </span>
            {recommended === 'adopt' && <em>推荐</em>}
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          新伴奏首拍已自动对齐第 1 小节。换伴奏也记进撤销历史，可以撤回。
        </p>
      </div>
    </div>
  );
}
