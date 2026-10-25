import { Icon } from './icons';

/** 录音面板：入口位置留好，功能下一单做（录音 / 延迟校准 / take / .RPP 导出） */
export function RecordPanel() {
  return (
    <>
      <div className="note info" data-role="record-soon">
        <Icon.info />
        <span>
          <b>录音即将上线。</b>跟伴奏录多遍、挑一遍、裁头尾、首次延迟校准、蓝牙耳机提示，会在这一版合并后另外上线；录好的 take 会出现在上面轨道条的伴奏下方。
        </span>
      </div>
      <button className="btn primary block" disabled aria-disabled="true" title="即将上线">
        <Icon.rec />
        开始录音（即将上线）
      </button>
      <span className="lbl">现在可以先写词、对拍子、导出 txt / LRC。</span>
    </>
  );
}
