import { lazy, Suspense, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
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
import { previewRhymeMatch, rhymeMatchOf, ruleName } from './core';
import { migrationSummary } from './engine/editorStore';
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
      } else if (s.step === 1 && k === 'Enter' && s.cursor !== null) {
        // 第 1 步选中的字按回车：进入改它的方格
        store.flowPick(s.cursor);
        done();
      } else if (s.step === 1 && (k === 'Backspace' || k === 'Delete')) {
        store.deleteCursorWord();
        done();
      } else if (s.step === 2 && k === 'Enter' && (s.selection.length === 1 || s.cursor !== null)) {
        // 回车 = 改选中那一格（或选中的字所在那一拍）的字，和双击一样
        const c = store.cursorCell();
        if (c) store.editCell(c.global, c.beat);
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

/** 「清空全部 flow…」：和导出面板「清空当前文字…」一样先就地确认；确定后每一拍变回一个方格（一步，可以撤销） */
function ClearFlow() {
  const { store } = useServices();
  const [ask, setAsk] = useState(false);
  if (!ask)
    return (
      <button className="btn sm ghost danger clear-flow" data-role="clear-flow" title="每一拍变回一个方格（段落和小节留着，可以撤销）" onClick={() => setAsk(true)}>
        <Icon.hist />
        清空全部 flow…
      </button>
    );
  return (
    <div className="clear-confirm" data-role="clear-flow-confirm" role="alertdialog" aria-label="清空全部 flow">
      <span className="q">
        每一拍变回<b>一个方格</b>？段落和小节留着，字和拖音清掉，可以撤销。
      </span>
      <button
        className="btn sm danger solid"
        data-role="clear-flow-yes"
        autoFocus
        onClick={() => {
          store.clearAllFlow();
          setAsk(false);
        }}
      >
        清空
      </button>
      <button className="btn sm ghost" data-role="clear-flow-no" onClick={() => setAsk(false)}>
        取消
      </button>
    </div>
  );
}

/**
 * 旧作品（文件里没有 rhymeMatch）打开时顶上的迁移横幅（DESIGN_v34 §4.7，和「清空全部 flow…」就地确认同一种样子）：
 * 仍按严格判，写清改成十三辙会少几处「不押」、哪些颜色合并；「改用十三辙」= 一步（可撤销），「先不改」= 写下 strict、以后不再问。
 */
function MigrateBanner() {
  const { store } = useServices();
  const s = useEditor();
  // 旧作品（没有 rhymeMatch）而且有颜色规则才出横幅（= store.needsRhymeMigration()）
  const p = useMemo(() => (s.doc.rhymeMatch === undefined && s.doc.rules.length ? previewRhymeMatch(s.doc.grid, s.doc, rhymeMatchOf(s.doc), 'thirteen') : null), [s.doc]);
  if (!p) return null;
  return (
    <div
      className="mig"
      data-role="migrate-banner"
      role="region"
      aria-label="判押韵改成十三辙"
      data-miss-before={p.missBefore}
      data-miss-after={p.missAfter}
      data-rules-before={p.rulesBefore}
      data-rules-after={p.rulesAfter}
      data-recolor={p.recolorCells}
    >
      <span className="q">
        <b>这个作品按旧规则判押韵（韵母一字不差）。</b>改成十三辙：{migrationSummary(p, s.doc.rules)}。可以撤销。
      </span>
      <button className="btn sm primary" data-role="migrate-yes" onClick={() => store.setRhymeMatch('thirteen')}>
        改用十三辙
      </button>
      <button className="btn sm ghost" data-role="migrate-no" onClick={() => store.dismissRhymeMigration()}>
        先不改
      </button>
    </div>
  );
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
          <b>点方格打字</b> · 空格分格 · 两下空格空音
        </span>
        <span className="spacer desk-only"></span>
        <ClearFlow />
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
            <MigrateBanner />
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
