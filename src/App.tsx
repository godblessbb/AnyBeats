import { lazy, Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { BpmDialog } from './components/BpmDialog';
import { Toast } from './components/Chrome';
import { ExportPanel } from './components/ExportPanel';
import { FlowPanel, PrecisionChips } from './components/FlowPanel';
import { HistoryPopover } from './components/HistoryPopover';
import { Icon } from './components/icons';
import { LyricsGrid } from './components/LyricsGrid';
import { RulePanel, SelChips, Swatches } from './components/RulePanel';
import { useEditor, useServices } from './components/services';
import { TopBar } from './components/TopBar';
import { TrackStrip } from './components/TrackStrip';
import { ruleName } from './core';
import { playFrom } from './engine/view';
import './App.css';

// 录音面板：只在打开构建开关（VITE_ANYBEATS_RECORDING=1）、recorder 存在时才加载和挂载
const RecordPanel = lazy(() => import('./components/RecordPanel').then((m) => ({ default: m.RecordPanel })));

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

function isTyping(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  if (!n || !n.tagName) return false;
  return n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable;
}

/** 快捷键；焦点在输入框里时不接管 */
function useShortcuts(closeAll: () => void) {
  const { store, transport } = useServices();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.isComposing) return;
      const s = store.getState();
      const k = e.key;
      const done = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.metaKey || e.ctrlKey) {
        const low = k.toLowerCase();
        if (low === 'z') {
          if (e.shiftKey) store.redo();
          else store.undo();
          done();
        } else if (low === 'y') {
          store.redo();
          done();
        } else if (low === 's') {
          store.flush();
          done();
        }
        return;
      }
      if (e.altKey) return;
      if (k === ' ') {
        transport.toggle(playFrom(s.cursor === null ? null : { focus: s.cursor }));
        done();
      } else if (k === 'Escape') {
        closeAll();
        store.clearSelection();
        done();
      } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
        store.moveCursor(k === 'ArrowLeft' ? -1 : 1);
        done();
      } else if (k === 'ArrowUp' || k === 'ArrowDown') {
        store.moveCursor(0, k === 'ArrowUp' ? -1 : 1);
        done();
      } else if (s.step === 1 && k === '-') {
        store.extendCursor(1);
        done();
      } else if (s.step === 1 && k === '=') {
        store.extendCursor(-1);
        done();
      } else if (s.step === 1 && (k === 'Backspace' || k === 'Delete')) {
        store.deleteCursorWord();
        done();
      } else if (s.step === 2 && k === 'Enter' && s.cursor !== null) {
        store.startEdit(s.cursor);
        done();
      } else if (s.step === 2 && (k === 'Backspace' || k === 'Delete') && s.cursor !== null) {
        store.commitText(s.cursor, '');
        done();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, transport, closeAll]);
}

function Tools({ lockOpen, onToggleLock }: { lockOpen: boolean; onToggleLock: () => void }) {
  const s = useEditor();
  const rule = s.doc.rules.find((r) => r.id === s.activeRule);
  if (s.step === 1) {
    return (
      <div className="tools" data-role="tools">
        <span className="lbl">精度</span>
        <PrecisionChips />
        <span className="status desk-only">
          <b>点格子放字</b> · 拖字框右边缘或按 - 拉长 · 删掉留下的空白就是空音
        </span>
      </div>
    );
  }
  return (
    <div className="tools" data-role="tools">
      <span className="lbl">选格子</span>
      <SelChips />
      <div className="chips">
        <button className={lockOpen ? 'on-soft' : ''} aria-pressed={lockOpen} data-role="lock-btn" onClick={onToggleLock}>
          <Icon.lock />
          锁定
        </button>
      </div>
      <span className="status desk-only">
        {rule ? (
          <>
            <b>{ruleName(rule)}</b> · {s.selection.length ? `已选 ${s.selection.length} 格` : '点格子选中，再点「涂上」'}
          </>
        ) : (
          '先在押韵面板新建一种颜色'
        )}
      </span>
    </div>
  );
}

function Drawer({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  const s = useEditor();
  const { store } = useServices();
  const miss = store.mismatchCount();
  return (
    <div className={`drawer${open ? ' open' : ''}`} data-role="rhyme-drawer">
      <button className="grab" aria-label={open ? '收起' : '展开'} onClick={onToggle}></button>
      <div className="dh">
        <h2>{s.step === 1 ? '铺 flow' : '押韵'}</h2>
        {s.step === 1 ? <PrecisionChips /> : <Swatches />}
        {!open && miss > 0 && s.step === 2 ? (
          <span className="miss-tag" data-role="mismatch" onClick={onToggle}>
            {miss} 处对不上
          </span>
        ) : (
          <button className="more" onClick={onToggle}>
            {open ? '下滑收起' : '上滑展开'}
            <Icon.up />
          </button>
        )}
      </div>
      {open && <div className="dbody">{children}</div>}
    </div>
  );
}

export default function App() {
  const { storage, recorder } = useServices();
  const s = useEditor();
  const mobile = useMobile();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [closeAll] = useState(() => () => {
    setHistoryOpen(false);
    setLockOpen(false);
  });
  useShortcuts(closeAll);

  const panel = projectsOpen ? (
    <ExportPanel
      onClose={() => {
        setProjectsOpen(false);
        setDrawerOpen(false);
      }}
    />
  ) : s.step === 1 ? (
    <FlowPanel />
  ) : (
    <RulePanel lockOpen={lockOpen} onCloseLock={() => setLockOpen(false)} />
  );

  return (
    <>
      <div className="app" data-step={s.step} data-persistent={storage.persistent ? '1' : '0'}>
        <TopBar
          historyOpen={historyOpen}
          onHistory={() => setHistoryOpen(!historyOpen)}
          onProjects={() => {
            setProjectsOpen(true);
            setDrawerOpen(true);
          }}
        />
        <TrackStrip />
        <div className="main">
          <main className="work" data-role="work" aria-label="歌词表格">
            <Tools
              lockOpen={lockOpen}
              onToggleLock={() => {
                setLockOpen(!lockOpen);
                if (!lockOpen) setDrawerOpen(true);
              }}
            />
            <LyricsGrid />
          </main>
          {!mobile && (
            <aside className="side" data-role="side">
              {panel}
              {recorder && (
                <Suspense fallback={null}>
                  <RecordPanel />
                </Suspense>
              )}
            </aside>
          )}
        </div>
      </div>
      {mobile && (
        <Drawer open={drawerOpen} onToggle={() => setDrawerOpen(!drawerOpen)}>
          {panel}
        </Drawer>
      )}
      {historyOpen && <HistoryPopover onClose={() => setHistoryOpen(false)} />}
      <BpmDialog />
      <Toast />
    </>
  );
}
