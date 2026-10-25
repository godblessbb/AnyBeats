import { useEffect, useState, type ReactElement } from 'react';
import { Icon } from './icons';
import { useEditor, useRecorder } from './services';

export type PanelKey = 'rhyme' | 'ai' | 'rec' | 'export';
export type MobileTab = 'write' | 'rhyme' | 'ai' | 'rec' | 'proj';

export function PanelTabs({ panel, onPanel, onCollapse }: { panel: PanelKey; onPanel: (p: PanelKey) => void; onCollapse: () => void }) {
  if (panel === 'export') {
    return (
      <div className="tabs">
        <span className="tab on">工程与导出</span>
        <button className="ibtn x" style={{ marginLeft: 'auto' }} title="关闭" aria-label="关闭工程与导出" onClick={() => onPanel('rhyme')}>
          <Icon.close />
        </button>
      </div>
    );
  }
  const tabs: [PanelKey, string][] = [
    ['rhyme', '押韵'],
    ['ai', 'AI 写词'],
    ['rec', '录音'],
  ];
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={panel === k} className={`tab${panel === k ? ' on' : ''}`} onClick={() => onPanel(k)}>
          {label}
        </button>
      ))}
      <button className="ibtn x collapse" title="收起面板" aria-label="收起面板" data-role="collapse-panel" onClick={onCollapse}>
        ›
      </button>
    </div>
  );
}

export function TabBar({ tab, onTab }: { tab: MobileTab; onTab: (t: MobileTab) => void }) {
  const tabs: [MobileTab, string, () => ReactElement][] = [
    ['write', '写词', Icon.pen],
    ['rhyme', '押韵', Icon.rhyme],
    ['ai', 'AI', Icon.ai],
    ['rec', '录音', Icon.mic],
    ['proj', '工程', Icon.proj],
  ];
  return (
    <nav className="tabbar">
      {tabs.map(([k, label, I]) => (
        <button key={k} className={k === tab ? 'on' : ''} onClick={() => onTab(k)}>
          <I />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

const STATUS_LEFT: Record<PanelKey, [string, string][]> = {
  rhyme: [
    ['← → ↑ ↓', '移动'],
    ['Enter', '编辑'],
    ['A', '重音'],
    ['-', '延音'],
    ['_', '空拍'],
    ['⌘C/⌘V', '复制粘贴'],
    ['⌫', '删除'],
  ],
  rec: [
    ['R', '录音 / 停止'],
    ['空格', '播放 / 停止'],
    ['⌘Z', '撤销'],
  ],
  ai: [
    ['⌘Enter', '全部采用'],
    ['Esc', '放弃'],
    ['⌘Z', '采用后也能撤销'],
  ],
  export: [
    ['⌘Z', '撤销'],
    ['⇧⌘Z', '重做'],
    ['⌘S', '立即保存'],
    ['⌘E', '导出'],
  ],
};

export function StatusBar({ panel }: { panel: PanelKey }) {
  const s = useEditor();
  const r = useRecorder();
  const bars = s.grid.sections.reduce((n, sec) => n + sec.bars.length, 0);
  const right =
    panel === 'export'
      ? `可撤销 ${s.undoDepth} 步 · ${s.save.kind === 'memory' ? '本次不保存' : '本机自动保存'}`
      : panel === 'rec'
        ? `${r.takes.length} 个 take · 延迟补偿 ${r.latencyMs === null ? '未校准' : `${r.latencyMs} ms`}`
        : panel === 'ai'
        ? s.preview
          ? 'AI 结果是预览，采用前不改动歌词'
          : '写词、押韵不依赖 Worker'
        : `4/4 · 1/16 网格 · ${bars} 小节`;
  return (
    <footer className="status">
      {panel === 'ai' && <span>虚线行 = AI 预览</span>}
      {panel === 'rec' && (r.phase === 'recording' || r.phase === 'starting') && <span style={{ color: 'var(--ab-rec)' }}>● 录音中 {r.recordingName}</span>}
      {STATUS_LEFT[panel].map(([k, label], i) => (
        <span key={k} className={i >= 6 ? 'hide-narrow' : undefined}>
          <kbd>{k}</kbd> {label}
        </span>
      ))}
      <span className="r">{right}</span>
    </footer>
  );
}

/** 一句提示（导入失败、没选格子等），显示 4 秒 */
export function Toast() {
  const s = useEditor();
  const [hidden, setHidden] = useState<number | null>(null);
  const at = s.notice?.at ?? null;
  useEffect(() => {
    if (at === null) return;
    const id = setTimeout(() => setHidden(at), 4000);
    return () => clearTimeout(id);
  }, [at]);
  if (!s.notice || hidden === at) return null;
  return (
    <div className="toast" role="status">
      {s.notice.text}
    </div>
  );
}
