import { useMemo, useState } from 'react';
import { playheadAt, STEPS_PER_BAR, type PartOfSpeech, type Syllable } from '../core';
import {
  checkRhymeService,
  localMatches,
  nextExclude,
  pageOf,
  POS_NAMES,
  posCounts,
  themeCandidates,
  type CandidateWord,
  type PosFilter,
  type ServiceStatus,
  type ToneFilter,
} from '../engine/rhymeSearch';
import { allBars, finalLabel, rhymeClass, rhymeView, toneMark } from '../engine/view';
import { Icon } from './icons';
import { DRAG_WORD } from './LyricsGrid';
import { useEditor, useServices, useTransport } from './services';

const LENGTHS = [1, 2, 3, 4];
const TONES: { v: ToneFilter; label: string }[] = [
  { v: 'all', label: '不限' },
  { v: '平', label: '平声' },
  { v: '仄', label: '仄声' },
  { v: 1, label: '1 声' },
  { v: 2, label: '2 声' },
  { v: 3, label: '3 声' },
  { v: 4, label: '4 声' },
];
const POS_ORDER: PartOfSpeech[] = ['n', 'v', 'a', 'd', 'o'];

/** 押韵面板以哪一句为准：选中格所在小节 → 正在播放的小节 → 最后一个有字的小节 */
function useTarget(): { global: number; syllable: Syllable; color: number | null } | null {
  const s = useEditor();
  const t = useTransport();
  const view = useMemo(() => rhymeView(s.grid), [s.grid]);
  const candidates: number[] = [];
  if (s.selection) candidates.push(Math.floor(s.selection.focus / STEPS_PER_BAR));
  const head = playheadAt(s.grid, t.position);
  if (head) candidates.push(Math.floor(head.absStep / STEPS_PER_BAR));
  for (let i = view.lines.length - 1; i >= 0; i--) if (view.lines[i].syllable) {
    candidates.push(i);
    break;
  }
  for (const g of candidates) {
    const line = view.lines[g];
    if (line?.syllable) return { global: g, syllable: line.syllable, color: line.color };
  }
  return null;
}

export function RhymePanel({ peek = false }: { peek?: boolean }) {
  const { store } = useServices();
  const s = useEditor();
  const target = useTarget();
  const [length, setLength] = useState(2);
  const [tone, setTone] = useState<ToneFilter>('all');
  const [pos, setPos] = useState<PosFilter>('all');
  const [exclude, setExclude] = useState<string[]>([]);
  const [theme, setTheme] = useState('');
  const [service, setService] = useState<ServiceStatus>({ state: 'unknown' });
  const [themed, setThemed] = useState<{ key: string; words: CandidateWord[] } | null>(null);
  const [themeError, setThemeError] = useState<string | null>(null);

  const targetKey = target ? `${target.syllable.group}|${target.syllable.char}` : '';
  const matches = useMemo(
    () => (target ? localMatches(target.syllable, { length, tone }) : []),
    // 只跟句尾韵部 / 字和筛选条件有关
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetKey, length, tone],
  );
  const counts = useMemo(() => posCounts(matches), [matches]);
  const filtered = pos === 'all' ? matches : matches.filter((w) => w.pos === pos);
  const filterKey = `${targetKey}|${length}|${String(tone)}|${pos}`;
  const themedWords = themed && themed.key === filterKey ? themed.words : null;
  const { page } = themedWords ? { page: themedWords.slice(0, 12) } : pageOf(filtered, exclude);

  const resetPaging = () => {
    setExclude([]);
    setThemed(null);
  };

  /** 「换一批」：不接收任何参数（旧界面把点击事件当排除词传了进去） */
  const refresh = async () => {
    const ex = nextExclude(exclude, page);
    setExclude(ex);
    if (theme.trim() && service.state === 'online' && target) {
      try {
        const words = await themeCandidates(target.syllable, { length, tone, pos }, theme.trim(), ex);
        setThemed({ key: filterKey, words: pos === 'all' ? words : words.filter((w) => w.pos === pos) });
        setThemeError(null);
      } catch (e) {
        setThemeError((e as Error).message);
        setThemed(null);
      }
    } else setThemed(null);
  };

  const ensureService = async () => {
    if (service.state !== 'unknown') return;
    setService({ state: 'checking' });
    setService(await checkRhymeService());
  };

  const insert = (word: string) => {
    const sel = s.selection;
    if (!sel) {
      store.notify('先点一个格子，再点候选词放进去（也可以直接拖到格子里）');
      return;
    }
    store.writeText(Math.min(sel.anchor, sel.focus), word);
  };

  if (!target) {
    return (
      <div className="note info">
        <Icon.info />
        <span>先在网格里写一句，句尾最后一个字决定押什么韵；候选来自<b>本机韵表</b>，不调用 AI。</span>
      </div>
    );
  }

  const barNo = target.global + 1;
  const sy = target.syllable;
  const offline = service.state === 'offline';
  const bars = allBars(s.grid);
  const sectionLabel = s.grid.sections[bars[target.global]?.section ?? 0]?.label;

  return (
    <>
      <div className="ph">
        <h3>
          句尾{' '}
          <span className={`chip ${target.color === null ? 'plain' : rhymeClass(target.color)}`} data-role="rhyme-target">
            {sy.char} {toneMark(sy.pinyin, sy.tone)} · {finalLabel(sy.final)}
          </span>
        </h3>
        <span className="r lbl" title={sectionLabel}>
          第 {barNo} 小节
        </span>
      </div>
      {!peek && (
        <>
          <div className="seg desk-only" title="字数">
            {LENGTHS.map((n) => (
              <button key={n} className={length === n ? 'on' : ''} onClick={() => { setLength(n); resetPaging(); }}>
                {n} 字
              </button>
            ))}
          </div>
          <div className="seg desk-only" title="声调筛选">
            {TONES.map((x) => (
              <button key={String(x.v)} className={tone === x.v ? 'on' : ''} onClick={() => { setTone(x.v); resetPaging(); }}>
                {x.label}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="words" data-role="rhyme-words">
        {page.length === 0 && <span className="lbl">这个筛选下没有候选，换个字数或声调试试</span>}
        {page.map((w, i) => (
          <button
            key={w.word}
            className={`word${i >= 6 ? ' desk-only' : ''}`}
            title="点一下放进选中格；也可以拖到格子里"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_WORD, w.word);
              e.dataTransfer.setData('text/plain', w.word);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => insert(w.word)}
          >
            {w.word}
            <small>{w.tone || ''}</small>
          </button>
        ))}
      </div>
      {!peek && (
        <>
          <div className="seg desk-only" title="词性">
            <button className={pos === 'all' ? 'on' : ''} onClick={() => { setPos('all'); resetPaging(); }}>
              全部 {counts.all}
            </button>
            {POS_ORDER.filter((p) => counts[p] > 0).map((p) => (
              <button key={p} className={pos === p ? 'on' : ''} onClick={() => { setPos(p); resetPaging(); }}>
                {POS_NAMES[p]} {counts[p]}
              </button>
            ))}
          </div>
          <div className={`field desk-only${offline ? ' off' : ''}`} title={offline ? service.reason : undefined}>
            <input
              className="field-input"
              placeholder={offline ? `主题联想不可用：${service.reason}` : '主题联想：如 街头、夜晚、兄弟'}
              value={theme}
              disabled={offline}
              aria-label="主题联想"
              onFocus={() => void ensureService()}
              onChange={(e) => setTheme(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) void refresh();
              }}
            />
            <button className="r link" data-role="rhyme-refresh" onClick={() => void refresh()}>
              换一批
            </button>
          </div>
          {themeError && <span className="lbl">主题联想出错：{themeError}，已用本机韵表</span>}
          <div className="note info desk-only">
            <Icon.info />
            <span>
              候选来自<b>本机韵表</b>，不调用 AI。拖到格子里放下；格子里的词也能拖走。
              {service.state === 'online' && ' 主题联想走本机韵脚服务。'}
            </span>
          </div>
        </>
      )}
    </>
  );
}
