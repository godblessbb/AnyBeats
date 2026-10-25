import { useEffect, useState, useSyncExternalStore } from 'react';
import { AiPanel } from './components/AiPanel';
import { PanelTabs, StatusBar, TabBar, Toast, type MobileTab, type PanelKey } from './components/Chrome';
import { ExportPanel } from './components/ExportPanel';
import { LyricsGrid } from './components/LyricsGrid';
import { RecordPanel } from './components/RecordPanel';
import { RhymePanel } from './components/RhymePanel';
import { useEditor, useServices } from './components/services';
import { MobileTransport, TopBar } from './components/TopBar';
import { TrackStrip } from './components/TrackStrip';
import { playFrom } from './engine/view';
import './App.css';

const MOBILE_QUERY = '(max-width: 600px)';

function useMobile(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(MOBILE_QUERY);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(MOBILE_QUERY).matches,
  );
}

const MOBILE_PANEL: Record<MobileTab, PanelKey> = { write: 'rhyme', rhyme: 'rhyme', ai: 'ai', rec: 'rec', proj: 'export' };

function isTyping(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  if (!n || !n.tagName) return false;
  return n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable;
}

/** 编辑器快捷键（状态栏里列的那些）；焦点在输入框里时不接管 */
function useShortcuts(openExport: () => void) {
  const { store, transport } = useServices();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.isComposing) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key;
      const s = store.getState();
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (mod) {
        const low = k.toLowerCase();
        if (low === 'z') {
          if (e.shiftKey) store.redo();
          else store.undo();
          handled();
        } else if (low === 'y') {
          store.redo();
          handled();
        } else if (low === 's') {
          store.flush();
          handled();
        } else if (low === 'e') {
          openExport();
          handled();
        } else if (low === 'c' && s.selection) {
          store.copySelection();
          handled();
        } else if (low === 'v' && s.selection) {
          store.paste();
          handled();
        } else if (k === 'Enter' && s.preview) {
          store.adoptPreview();
          handled();
        }
        return;
      }
      if (e.altKey) return;
      switch (k) {
        case ' ':
          transport.toggle(playFrom(s.selection));
          handled();
          return;
        case 'Escape':
          if (s.preview) store.setPreview(null);
          else store.clearSelection();
          handled();
          return;
        case 'ArrowLeft':
          store.moveFocus(-1, 0, e.shiftKey);
          handled();
          return;
        case 'ArrowRight':
          store.moveFocus(1, 0, e.shiftKey);
          handled();
          return;
        case 'ArrowUp':
          store.moveFocus(0, -1, e.shiftKey);
          handled();
          return;
        case 'ArrowDown':
          store.moveFocus(0, 1, e.shiftKey);
          handled();
          return;
      }
      if (!s.selection) return;
      if (k === 'Enter') {
        store.editFocused();
        handled();
      } else if (k === 'a' || k === 'A') {
        store.toggleAccentFocused();
        handled();
      } else if (k === '-') {
        store.markFocused('hold');
        handled();
      } else if (k === '_') {
        store.markFocused('rest');
        handled();
      } else if (k === 'Backspace' || k === 'Delete') {
        store.deleteSelection();
        handled();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, transport, openExport]);
}

export default function App() {
  const { storage } = useServices();
  const s = useEditor();
  const mobile = useMobile();
  const [panel, setPanel] = useState<PanelKey>('rhyme');
  const [mtab, setMtab] = useState<MobileTab>('write');
  const [lastPanel, setLastPanel] = useState<PanelKey>('rhyme');
  const [collapsed, setCollapsed] = useState(false);

  const openExport = () => {
    if (panel !== 'export') setLastPanel(panel);
    setPanel('export');
    setMtab('proj');
    setCollapsed(false);
  };
  useShortcuts(openExport);

  const shown: PanelKey = mobile ? MOBILE_PANEL[mtab] : panel;
  const peek = mobile && mtab === 'write';
  const tall = mobile && !peek;

  return (
    <div className="app" data-panel={shown} data-persistent={storage.persistent ? '1' : '0'}>
      <TopBar onExport={openExport} />
      <MobileTransport />
      <TrackStrip />
      <main className={`main${collapsed && !mobile ? ' collapsed' : ''}`}>
        <section className="editor" aria-label="歌词网格">
          <div className="grid-wrap">
            <LyricsGrid foldInactive={tall} />
          </div>
        </section>
        <aside className={`panel${peek ? ' peek' : ''}${tall ? ' tall' : ''}`} data-role="panel">
          <div className="sheet-grip" onClick={() => setMtab(peek ? 'rhyme' : 'write')}></div>
          <PanelTabs panel={shown} onPanel={(p) => setPanel(p === 'rhyme' && panel === 'export' ? lastPanel : p)} onCollapse={() => setCollapsed(true)} />
          <div className="pbody">
            {shown === 'rhyme' && <RhymePanel peek={peek} />}
            {shown === 'ai' && <AiPanel />}
            {shown === 'rec' && <RecordPanel />}
            {shown === 'export' && <ExportPanel />}
          </div>
        </aside>
        {collapsed && !mobile && (
          <button className="panel-open" title="展开面板" aria-label="展开面板" data-role="expand-panel" onClick={() => setCollapsed(false)}>
            ‹ 押韵 · AI
          </button>
        )}
      </main>
      <StatusBar panel={shown} />
      <TabBar tab={mtab} onTab={setMtab} />
      {s.save.kind === 'memory' && <span className="sr-only">本次不保存</span>}
      <Toast />
    </div>
  );
}
