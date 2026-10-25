import { useEffect, useState } from 'react';
import { AI_TASK_NAMES, type AiTask } from '../ai';
import { finalLabel, previewRhymes, rhymeClass } from '../engine/view';
import { Icon } from './icons';
import { useAi, useEditor, useServices } from './services';

const TASKS: AiTask[] = ['continue', 'rhyme', 'fit'];

function ago(ms: number, now: number) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  return s < 60 ? `${s} 秒前` : `${Math.round(s / 60)} 分钟前`;
}

/** 画面 3b：Worker 未连接时的引导（ai-login.html） */
function AiLogin() {
  const { ai } = useServices();
  const st = useAi();
  const [hint, setHint] = useState(false);
  const reason = st.status?.state === 'disconnected' ? st.status.reason : '';
  return (
    <>
      <div className="note warn" data-role="ai-login">
        <Icon.warn />
        <span>
          <b>AI 写词还没连上 Worker。</b>押韵候选、编辑、导出照常可用。
        </span>
      </div>
      <div className="card">
        <div className="ph">
          <h3>方式一：本机 CLI（推荐）</h3>
        </div>
        <span className="lbl">在跑 Alphie 的那台电脑终端里执行，然后回来点“重新检测”：</span>
        <div className="code">claude login</div>
        <div className="ph">
          <button className="btn sm primary" disabled={st.checking} onClick={() => void ai.check()} data-role="ai-recheck">
            {st.checking ? '检测中…' : '重新检测'}
          </button>
          <span className="r lbl" title={reason}>
            上次检测：{st.checking ? '检测中' : '未连接'}
          </span>
        </div>
      </div>
      <div className="card soft">
        <div className="ph">
          <h3>方式二：API</h3>
        </div>
        <span className="lbl">在 Alphie 的 Agent 设置 → Worker 里填 API Key（DeepSeek / OpenAI 兼容）。Key 不经过这个页面。</span>
        <div className="ph">
          <button className="btn sm" onClick={() => setHint(true)}>
            打开 Agent 设置
          </button>
        </div>
        {hint && <span className="lbl">画布里没法直接跳过去：请在 Alphie 左侧当前 Agent 的「设置 → Worker」里打开。</span>}
      </div>
    </>
  );
}

export function AiPanel() {
  const { ai, store } = useServices();
  const st = useAi();
  const s = useEditor();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!s.preview) return;
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [s.preview]);

  if (st.status === null) return <span className="lbl">正在检测 Worker…</span>;
  if (st.status.state === 'disconnected') return <AiLogin />;

  const written = store.writtenLines().length;
  const target = ai.targetBar();
  const p = s.preview;
  const rhymes = p ? previewRhymes(s.grid, p.lines) : [];
  const firstNo = p ? s.grid.sections.slice(0, p.section).reduce((n, sec) => n + sec.bars.length, 0) + p.at + 1 : 0;

  return (
    <>
      <div className="card soft">
        <div className="ph">
          <span className="dot"></span>
          <span data-contrast>Worker：{st.status.worker}</span>
          <button className="btn sm ghost r" onClick={() => void ai.check()}>
            重新检测
          </button>
        </div>
        <span className="lbl desk-only">{st.status.detail ?? '已连接'} · 走你这个 Alphie Agent 的 Worker，不在页面里存 Key</span>
      </div>
      <div className="seg">
        {TASKS.map((k) => (
          <button key={k} className={st.task === k ? 'on' : ''} onClick={() => ai.setTask(k)}>
            {AI_TASK_NAMES[k]}
          </button>
        ))}
      </div>
      <div className="kv desk-only">
        <span className="muted">参考</span>
        <span data-contrast>
          已写的 {written} 小节 · BPM {Math.round(s.bpm)}
        </span>
      </div>
      {st.task === 'continue' ? (
        <div className="kv">
          <span className="muted">续写</span>
          <span className="seg mini">
            {[1, 2, 4].map((n) => (
              <button key={n} className={st.bars === n ? 'on' : ''} onClick={() => ai.setBars(n)}>
                {n} 小节
              </button>
            ))}
          </span>
        </div>
      ) : (
        <div className="kv">
          <span className="muted">{st.task === 'rhyme' ? '改押韵' : '调字数'}</span>
          <span data-contrast>{target?.text ? `第 ${target.global + 1} 小节` : '先在网格里选中一小节'}</span>
        </div>
      )}
      {st.task === 'fit' && (
        <div className="kv">
          <span className="muted">改成</span>
          <span className="seg mini">
            {[4, 6, 8, 12, 16].map((n) => (
              <button key={n} className={st.chars === n ? 'on' : ''} onClick={() => ai.setChars(n)}>
                {n} 字
              </button>
            ))}
          </span>
        </div>
      )}
      <textarea
        className="field area desk-only"
        placeholder="可选：补一句要求，例如「讲从地下室到舞台」。没写过词时这里就是“按主题写一段”。"
        value={st.instruction}
        onChange={(e) => ai.setInstruction(e.currentTarget.value)}
      />
      {st.generating ? (
        <div className="card">
          <div className="ph">
            <span className="lbl">生成中…</span>
            <button className="btn sm ghost r" onClick={() => ai.cancel()}>
              取消
            </button>
          </div>
          <div className="skeleton"></div>
          <div className="skeleton"></div>
        </div>
      ) : (
        !p && (
          <button className="btn primary" data-role="ai-generate" onClick={() => void ai.generate()}>
            {AI_TASK_NAMES[st.task]}
          </button>
        )
      )}
      {st.error && (
        <div className="note warn">
          <Icon.warn />
          <span>{st.error}</span>
        </div>
      )}
      {p && (
        <div className="card" data-role="ai-preview">
          <div className="ph">
            <span className="lbl">
              预览 · 第 {firstNo}
              {p.lines.length > 1 ? `–${firstNo + p.lines.length - 1}` : ''} 小节
            </span>
            <span className="r lbl">{ago(p.createdAt, Math.max(now, p.createdAt))}</span>
          </div>
          {p.mode === 'replace' && (
            <div className="diff">
              <span className="muted">{AI_TASK_NAMES[p.task]}</span>
              <del>{p.before[0]}</del>
              <span>→</span>
              <ins>{p.lines[0]}</ins>
            </div>
          )}
          {p.mode === 'fill' &&
            p.lines.map((l, i) => (
              <div className="diff" key={i}>
                {rhymes[i]?.syllable && (
                  <span className={`chip ${rhymes[i].color === null ? 'plain' : rhymeClass(rhymes[i].color)}`}>{finalLabel(rhymes[i].syllable!.final)}</span>
                )}
                <ins>{l}</ins>
                <button className="ibtn r" title="只采用这行" aria-label="只采用这行" onClick={() => store.adoptPreview(i)}>
                  ✓
                </button>
              </div>
            ))}
          {p.warnings.length > 0 && <span className="lbl">{p.warnings[0]}</span>}
          <div className="ph">
            <button className="btn sm primary" data-role="ai-adopt" onClick={() => store.adoptPreview()}>
              全部采用
            </button>
            <button className="btn sm" onClick={() => void ai.generate()}>
              再写一版
            </button>
            <button className="btn sm ghost r" onClick={() => store.setPreview(null)}>
              放弃
            </button>
          </div>
        </div>
      )}
    </>
  );
}
