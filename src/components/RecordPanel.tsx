import { useState } from 'react';
import { BLUETOOTH_MS, isLikelyBluetooth } from '../audio/latency';
import type { CalibrationState } from '../audio/RecordController';
import type { TakeMeta } from '../audio/takes';
import { formatClock } from '../engine/view';
import { Icon } from './icons';
import { useEditor, useRecorder, useServices, useTransport } from './services';

const fmtMs = (ms: number) => `${Number.isInteger(ms) ? ms : ms.toFixed(1)} ms`;

/** 首次录音前的 3 步延迟校准（calibrate.html） */
function Calibration({ cal }: { cal: CalibrationState }) {
  const { recorder } = useServices();
  const steps = [cal.step >= 1, cal.step >= 2, cal.step >= 3];
  const avg = cal.step === 3 ? cal.result : cal.currentMs;
  return (
    <>
      <div className="ph">
        <h3>录音前先校准延迟</h3>
        <span className="r lbl">{cal.step} / 3</span>
      </div>
      <div className="steps">
        {steps.map((on, i) => (
          <i key={i} className={on ? 'on' : ''}></i>
        ))}
      </div>
      <div className="list" data-role="calibrate-steps">
        <div className={`li${cal.step === 1 ? ' on' : ''}`}>
          <span className={cal.step > 1 ? 'check on' : 'radio on'}></span>
          <span data-contrast={cal.step === 1 ? '' : undefined}>耳机贴近麦克风（或先用外放），音量调到平时录音的大小</span>
        </div>
        <div className={`li${cal.step === 2 ? ' on' : ''}`}>
          <span className={cal.step > 2 ? 'check on' : `radio${cal.step === 2 ? ' on' : ''}`}></span>
          <span data-contrast={cal.step === 2 ? '' : undefined} className={cal.step < 2 ? 'muted' : undefined}>
            放 {cal.total} 声「嘀」，麦克风收回来，自动量往返延迟（不用出声）
          </span>
        </div>
        <div className={`li${cal.step === 3 ? ' on' : ''}`}>
          <span className={`radio${cal.step === 3 ? ' on' : ''}`}></span>
          <span data-contrast={cal.step === 3 ? '' : undefined} className={cal.step < 3 ? 'muted' : undefined}>
            确认结果，之后每次录音自动补偿
          </span>
        </div>
      </div>
      <div className="taps" title={`已完成 ${cal.done} / ${cal.total} 次`} data-role="calibrate-taps">
        {Array.from({ length: cal.total }, (_, i) => (
          <i key={i} className={i < cal.done ? 'on' : ''}></i>
        ))}
      </div>
      <div className="card soft">
        <span className="lbl">{cal.step === 3 ? '测到的往返延迟' : `目前测到的平均延迟（${cal.done} / ${cal.total} 次）`}</span>
        <span className="big-num" data-contrast data-role="calibrate-ms">
          {avg === null ? '— ms' : fmtMs(avg)}
        </span>
        <span className="lbl desk-only">有线耳机通常 20–60 ms；超过 {BLUETOOTH_MS} ms 多半是蓝牙。</span>
        {cal.step === 3 && cal.result !== null && (
          <div className="ph">
            <span className="lbl">听着还是不齐可以微调</span>
            <button className="btn sm r" onClick={() => recorder.adjustCalibration(-5)}>
              −5 ms
            </button>
            <button className="btn sm" onClick={() => recorder.adjustCalibration(5)}>
              +5 ms
            </button>
          </div>
        )}
      </div>
      {cal.step === 3 && isLikelyBluetooth(cal.result) && (
        <div className="note warn" data-role="bt-warn">
          <Icon.bt />
          <span>
            <b>超过 {BLUETOOTH_MS} ms，多半是蓝牙耳机</b>：蓝牙会晚 150–250 ms 而且不稳定。建议换有线耳机再校准；继续用就按这个结果补偿。
          </span>
        </div>
      )}
      {cal.error && (
        <div className="note warn" data-role="calibrate-error">
          <Icon.warn />
          <span>{cal.error}</span>
        </div>
      )}
      <div className="ph">
        <button className="btn ghost" data-role="calibrate-skip" onClick={() => recorder.skipCalibration()}>
          跳过，以后再说
        </button>
        {cal.step === 3 ? (
          <>
            <button className="btn r" onClick={() => recorder.openCalibration(cal.thenRecord)}>
              重来
            </button>
            <button className="btn primary" data-role="calibrate-accept" onClick={() => recorder.acceptCalibration()}>
              {cal.thenRecord ? '用这个值，开始录音' : '用这个值'}
            </button>
          </>
        ) : (
          <button className="btn primary r" data-role="calibrate-start" disabled={cal.running} onClick={() => void recorder.runCalibration()}>
            {cal.running ? '正在测…' : cal.error ? '重来' : '开始测'}
          </button>
        )}
      </div>
    </>
  );
}

function TrimField({ label, value, onChange, role }: { label: string; value: number; onChange: (v: number) => void; role: string }) {
  return (
    <div className="kv">
      <span>{label}</span>
      <span className="trim-field">
        <button className="ibtn" aria-label={`${label}减 0.05 秒`} onClick={() => onChange(value - 0.05)}>
          <Icon.minus />
        </button>
        <input
          className="mono trim-input"
          type="number"
          step={0.01}
          min={0}
          value={value.toFixed(2)}
          aria-label={`${label}（秒）`}
          data-role={role}
          onChange={(e) => onChange(Number(e.currentTarget.value) || 0)}
        />
        <span className="muted">s</span>
        <button className="ibtn" aria-label={`${label}加 0.05 秒`} onClick={() => onChange(value + 0.05)}>
          <Icon.plus />
        </button>
      </span>
    </div>
  );
}

function TakeRow({ take, recording }: { take: TakeMeta; recording: boolean }) {
  const { recorder } = useServices();
  const r = useRecorder();
  const t = useTransport();
  const auditioning = t.playing && r.auditionId === take.id;
  return (
    <div className={`li${take.selected ? ' on' : ''}`} data-role="take" data-take={take.id} data-selected={take.selected ? '1' : '0'}>
      <button
        className={`ibtn star-btn${take.selected ? ' star' : ' faint'}`}
        title={take.selected ? '已选用（再点取消）' : '★ 选用这一遍'}
        aria-label={take.selected ? `取消选用 ${take.name}` : `选用 ${take.name}`}
        aria-pressed={take.selected}
        data-role="take-star"
        onClick={() => recorder.select(take.id)}
      >
        {take.selected ? '★' : '☆'}
      </button>
      <span data-contrast={take.selected ? '' : undefined}>
        {take.name}
        {take.selected ? ' · 选用' : ''}
      </span>
      <small className="mono">{formatClock(take.duration - take.trimStart - take.trimEnd, false)}</small>
      <span className="r">
        <button
          className="ibtn"
          title={auditioning ? '停止' : '试听（伴奏 + 这一遍，歌词同步高亮）'}
          aria-label={auditioning ? `停止试听 ${take.name}` : `试听 ${take.name}`}
          disabled={recording}
          onClick={() => recorder.playTake(take.id)}
        >
          {auditioning ? <Icon.pause /> : <Icon.play />}
        </button>
      </span>
    </div>
  );
}

export function RecordPanel() {
  const { recorder } = useServices();
  const s = useEditor();
  const r = useRecorder();
  const t = useTransport();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  if (r.calibration) return <Calibration cal={r.calibration} />;

  const recording = r.phase === 'recording' || r.phase === 'starting';
  const selected = r.takes.find((x) => x.selected) ?? null;
  const bt = isLikelyBluetooth(r.latencyMs, r.deviceLabel);
  const elapsed = recording && t.position !== null ? t.position * (60 / s.bpm / 4) : 0;

  return (
    <>
      <div className="ph">
        {recording ? (
          <h3 data-role="rec-title">
            <span style={{ color: 'var(--ab-rec)' }}>●</span> 录音中 · {r.recordingName}
          </h3>
        ) : (
          <h3 data-role="rec-title">录音</h3>
        )}
        {recording && (
          <span className="r mono" data-contrast>
            {formatClock(elapsed)}
          </span>
        )}
      </div>
      {!r.available.ok && (
        <div className="note warn" data-role="rec-unavailable">
          <Icon.mic />
          <span>
            <b>现在录不了音。</b>
            {r.available.reason}
          </span>
        </div>
      )}
      {r.available.ok && bt && (
        <div className="note warn" data-role="bt-warn">
          <Icon.bt />
          <span>
            <b>{r.deviceLabel && /bluetooth|airpods|buds|蓝牙|hands-?free/i.test(r.deviceLabel) ? `检测到蓝牙耳机（${r.deviceLabel}）` : `延迟 ${fmtMs(r.latencyMs ?? 0)}，多半是蓝牙耳机`}</b>
            ：蓝牙会晚 150–250 ms，录出来会和伴奏对不齐。建议换有线耳机；继续用就按校准结果补偿。
          </span>
        </div>
      )}
      {r.message && (
        <div className="note warn" data-role="rec-message">
          <Icon.warn />
          <span>{r.message}</span>
        </div>
      )}
      <div className="kv">
        <span className="muted">延迟校准</span>
        <span>
          {r.latencyMs === null ? <span data-contrast>未校准（按 0 ms）</span> : <span data-contrast data-role="latency">已校准 {fmtMs(r.latencyMs)}</span>}
          {' · '}
          <button className="link-btn muted" disabled={recording || !r.available.ok} onClick={() => recorder.openCalibration(false)}>
            {r.latencyMs === null ? '校准' : '重新校准'}
          </button>
        </span>
      </div>
      <button
        className={`btn block ${recording ? 'rec-stop' : 'primary'}`}
        data-role="rec-toggle"
        disabled={!r.available.ok || r.phase === 'saving'}
        title={r.available.ok ? '录音 / 停止（R）' : r.available.reason}
        onClick={() => recorder.toggleRecord()}
      >
        <Icon.rec />
        {recording ? '停止录音' : r.phase === 'saving' ? '正在保存…' : r.available.ok ? '开始录音（跟伴奏，预备 1 小节）' : '录不了音（原因见上）'}
      </button>
      {r.takes.length > 0 || recording ? (
        <div>
          <div className="ph" style={{ marginBottom: 4 }}>
            <span className="lbl">这首的 {r.takes.length} 个 take</span>
            {!r.persistent && <span className="r lbl save-warn">只在这次打开时有效</span>}
          </div>
          <div className="list" data-role="take-list">
            {r.takes.map((take) => (
              <TakeRow key={take.id} take={take} recording={recording} />
            ))}
            {recording && (
              <div className="li">
                <span style={{ color: 'var(--ab-rec)' }}>●</span>
                <span>{r.recordingName}</span>
                <small>录音中</small>
              </div>
            )}
          </div>
        </div>
      ) : (
        <span className="lbl" data-role="take-empty">
          跟着伴奏录多遍，每遍是一条 take：★ 选用一遍、裁头尾，回放时歌词跟着亮。{!r.persistent && ` 录音只在这次打开时有效（${r.storeReason}）。`}
        </span>
      )}
      {selected && !recording && (
        <div className="card soft" data-role="trim-card">
          <div className="ph">
            <span className="lbl">{selected.name} 裁剪</span>
          </div>
          <TrimField label="裁头" role="trim-start" value={selected.trimStart} onChange={(v) => recorder.setTrim(selected.id, v, selected.trimEnd)} />
          <TrimField label="裁尾" role="trim-end" value={selected.trimEnd} onChange={(v) => recorder.setTrim(selected.id, selected.trimStart, v)} />
          <div className="ph">
            <button className="btn sm" data-role="take-playback" onClick={() => recorder.playTake()}>
              {t.playing && r.auditionId === selected.id ? <Icon.pause /> : <Icon.play />}
              {t.playing && r.auditionId === selected.id ? '停止回放' : '回放（歌词同步高亮）'}
            </button>
            {confirmDelete === selected.id ? (
              <>
                <button className="btn sm danger r" onClick={() => { recorder.remove(selected.id); setConfirmDelete(null); }}>
                  确认删除
                </button>
                <button className="btn sm ghost" onClick={() => setConfirmDelete(null)}>
                  取消
                </button>
              </>
            ) : (
              <button className="btn sm ghost danger r" onClick={() => setConfirmDelete(selected.id)}>
                删除 take
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
