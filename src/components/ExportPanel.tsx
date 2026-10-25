import { useRef, useState } from 'react';
import { exportLrc, exportTxt, serializeProject } from '../core';
import { EXAMPLES } from '../engine/demo';
import { buildReaperZip, type StemChoice } from '../export/reaperZip';
import { Icon } from './icons';
import { useEditor, useLibrary, useRecorder, useServices, useTransport } from './services';

type Format = 'txt' | 'lrc' | 'project' | 'rpp';

const FORMATS: { key: Format; label: string; note: string; ext: string; mime: string }[] = [
  { key: 'txt', label: '歌词 .txt', note: '按段落分行', ext: 'txt', mime: 'text/plain' },
  { key: 'lrc', label: '同步歌词 .lrc', note: '每小节时间戳', ext: 'lrc', mime: 'text/plain' },
  { key: 'project', label: '工程文件 .anybeats', note: '可再导入', ext: 'anybeats', mime: 'application/json' },
];

function fileBase(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'AnyBeats';
}

function download(name: string, data: string | Uint8Array, mime: string) {
  const blob = typeof data === 'string' ? new Blob([data], { type: `${mime};charset=utf-8` }) : new Blob([data as Uint8Array<ArrayBuffer>], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function dateText(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === today.toDateString()) return `今天 ${hm}`;
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function timeText(ms: number) {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

function ProjectList() {
  const { store } = useServices();
  const s = useEditor();
  const list = useLibrary();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  return (
    <div className="proj-list" data-role="project-list">
      <input
        ref={importRef}
        type="file"
        accept=".anybeats,.json,application/json"
        hidden
        data-role="import-file"
        onChange={async (e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) store.importProjectFile(await file.text(), file.name.replace(/\.(anybeats|json)$/i, ''));
        }}
      />
      <div className="ph" style={{ marginBottom: 2 }}>
        <span className="lbl">作品</span>
        <button className="btn sm ghost r" data-role="new-project" onClick={() => store.newProject()}>
          新建
        </button>
        <button className="btn sm ghost" onClick={() => store.saveAs()}>
          另存为
        </button>
        <button className="btn sm ghost" onClick={() => importRef.current?.click()}>
          导入
        </button>
      </div>
      <div className="list">
        {list.map((m) => {
          const current = m.id === s.projectId;
          return (
            <div key={m.id} className={`li${current ? ' on' : ''}`} data-role="project-item">
              {renaming === m.id ? (
                <input
                  className="li-input"
                  defaultValue={m.name}
                  autoFocus
                  aria-label="作品名"
                  onBlur={(e) => {
                    store.renameProject(m.id, e.currentTarget.value);
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <button className="li-name" title={current ? '当前作品（双击改名）' : '打开（双击改名）'} onClick={() => store.openProject(m.id)} onDoubleClick={() => setRenaming(m.id)}>
                  <span data-contrast={current ? '' : undefined}>{m.name}</span>
                  <small>{current ? `当前 · ${m.bars} 小节` : `${m.bars} 小节`}</small>
                </button>
              )}
              <span className="r">
                <small>{dateText(m.updatedAt)}</small>
                <button className="ibtn" title="改名" aria-label={`给「${m.name}」改名`} onClick={() => setRenaming(m.id)}>
                  ✎
                </button>
                {confirmDelete === m.id ? (
                  <>
                    <button className="btn sm danger" onClick={() => { store.deleteProject(m.id); setConfirmDelete(null); }}>
                      确认删除
                    </button>
                    <button className="btn sm ghost" onClick={() => setConfirmDelete(null)}>
                      取消
                    </button>
                  </>
                ) : (
                  <button className="ibtn" title="删除" aria-label={`删除「${m.name}」`} onClick={() => setConfirmDelete(m.id)}>
                    <Icon.close />
                  </button>
                )}
              </span>
            </div>
          );
        })}
        {EXAMPLES.map((ex) => (
          <div key={ex.key} className="li">
            <button className="li-name" title="打开一份示例的副本" onClick={() => store.openExample(ex.key)}>
              <span>{ex.name}</span>
              <small>示例</small>
            </button>
            <span className="r">
              <small>内置</small>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ExportPanel() {
  const { store, storage, transport, recorder } = useServices();
  const s = useEditor();
  const t = useTransport();
  const rec = useRecorder();
  const list = useLibrary();
  const hasAudio = rec.takes.length > 0 || !!t.backing;
  const [picked, setPicked] = useState<Record<Format, boolean>>({ txt: true, lrc: true, project: true, rpp: hasAudio });
  const [stems, setStems] = useState<StemChoice>({ backing: true, takes: true, metronome: false, guide: false });
  const [result, setResult] = useState<{ files: string[]; preview: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showList, setShowList] = useState(false);
  const count = FORMATS.filter((f) => picked[f.key]).length + (picked.rpp ? 1 : 0);
  const selected = rec.takes.find((x) => x.selected);

  const doExport = () => {
    const project = store.project;
    const base = fileBase(project.name);
    const files: string[] = [];
    let preview = '';
    setError(null);
    for (const f of FORMATS) {
      if (!picked[f.key]) continue;
      const text = f.key === 'txt' ? exportTxt(project) : f.key === 'lrc' ? exportLrc(project) : serializeProject(project);
      const name = `${base}.${f.ext}`;
      download(name, text, f.mime);
      files.push(name);
      if (f.key === 'lrc' || (!preview && f.key === 'txt')) preview = text;
    }
    if (picked.rpp) {
      try {
        const backing = transport.backingAudio();
        const takes = recorder.allTakes();
        const sampleRate = transport.audioContext()?.sampleRate ?? backing?.sampleRate ?? takes[0]?.sampleRate ?? 48000;
        const out = buildReaperZip({ project, sampleRate, backing, takes, stems });
        const name = `${base}.zip`;
        download(name, out.zip, 'application/zip');
        files.push(`${name}（${out.files.join('、')}）`);
        if (!preview) preview = out.rpp;
      } catch (e) {
        setError(`Reaper 工程打包失败：${(e as Error).message}`);
      }
    }
    setResult({ files, preview });
  };

  const stemButtons: { key: keyof StemChoice; label: string; disabled: boolean; title: string }[] = [
    { key: 'backing', label: '伴奏', disabled: !t.backing, title: t.backing ? '伴奏一轨' : '还没载入伴奏' },
    {
      key: 'takes',
      label: selected ? `${selected.name} ★` : `Take ×${rec.takes.length}`,
      disabled: rec.takes.length === 0,
      title: rec.takes.length ? '每个 take 一轨：选用的那轨打开，其余静音' : '还没有录音',
    },
    { key: 'metronome', label: '节拍器', disabled: false, title: '节拍器渲染成一轨' },
    { key: 'guide', label: '导唱', disabled: false, title: '导唱打点渲染成一轨' },
  ];

  const saveInfo =
    s.save.kind === 'memory'
      ? `本次不保存：${s.save.reason}`
      : s.save.kind === 'error'
        ? `保存失败：${s.save.message}`
        : s.save.kind === 'pending'
          ? '改动后 1 秒存一次 · 正在保存'
          : `改动后 1 秒存一次${s.save.at ? ` · ${timeText(s.save.at)}` : ''}`;

  return (
    <>
      <div className="kv">
        <span>
          <span className={`dot${storage.persistent ? '' : ' warn'}`}></span>
          <span data-contrast>{storage.persistent ? '本机自动保存' : '本次不保存'}</span>
        </span>
        <span className="muted">{saveInfo}</span>
      </div>
      <button className="li mob-only li-btn" onClick={() => setShowList(!showList)}>
        <span>作品列表（{list.length}）</span>
        <span className="r">
          <small>新建 · 另存为 · 打开 {showList ? '‹' : '›'}</small>
        </span>
      </button>
      <div className={showList ? '' : 'desk-only'} style={{ flexDirection: 'column' }}>
        <ProjectList />
      </div>
      <div>
        <div className="ph" style={{ marginBottom: 2 }}>
          <span className="lbl">导出</span>
        </div>
        <div className="list">
          {FORMATS.map((f) => (
            <label key={f.key} className="li check-row">
              <input
                type="checkbox"
                className="sr-only"
                checked={picked[f.key]}
                data-role={`export-${f.key}`}
                onChange={(e) => setPicked({ ...picked, [f.key]: e.currentTarget.checked })}
              />
              <span className={`check${picked[f.key] ? ' on' : ''}`}></span>
              <span>{f.label}</span>
              <small>{f.note}</small>
            </label>
          ))}
          <label className="li check-row" title="一个 zip：.RPP + 对齐好的分轨 WAV（24 bit），Reaper 里直接打开">
            <input
              type="checkbox"
              className="sr-only"
              checked={picked.rpp}
              data-role="export-rpp"
              onChange={(e) => setPicked({ ...picked, rpp: e.currentTarget.checked })}
            />
            <span className={`check${picked.rpp ? ' on' : ''}`}></span>
            <span data-contrast={picked.rpp ? '' : undefined}>Reaper 工程 .RPP + 分轨</span>
            <small>zip</small>
          </label>
        </div>
        <div className="seg" style={{ paddingLeft: 28 }} data-role="rpp-stems">
          {stemButtons.map((b) => (
            <button
              key={b.key}
              className={stems[b.key] && !b.disabled ? 'on' : ''}
              disabled={!picked.rpp || b.disabled}
              title={b.title}
              aria-pressed={stems[b.key] && !b.disabled}
              data-role={`stem-${b.key}`}
              onClick={() => setStems({ ...stems, [b.key]: !stems[b.key] })}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
      <button className="btn primary block" data-role="export" disabled={count === 0} onClick={doExport}>
        导出 {count} 项到 下载/{fileBase(s.name)}
      </button>
      {error && (
        <div className="note warn" data-role="export-error">
          <Icon.warn />
          <span>{error}</span>
        </div>
      )}
      {result && (
        <div className="card soft" data-role="export-result">
          <span className="lbl">已生成：{result.files.join('、')}。没有开始下载（例如画布里不允许下载）时，可以从下面复制：</span>
          <textarea className="field area export-preview" readOnly value={result.preview} data-role="export-preview" onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
      {confirmClear ? (
        <div className="ph">
          <span className="lbl">清空当前作品的全部歌词？（可以撤销）</span>
          <button className="btn sm danger" onClick={() => { store.clearLyrics(); setConfirmClear(false); }}>
            清空
          </button>
          <button className="btn sm ghost" onClick={() => setConfirmClear(false)}>
            取消
          </button>
        </div>
      ) : (
        <button className="btn sm ghost danger desk-only" style={{ alignSelf: 'flex-start' }} onClick={() => setConfirmClear(true)}>
          清空当前歌词…
        </button>
      )}
    </>
  );
}
