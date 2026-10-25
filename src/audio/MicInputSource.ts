/**
 * 本页自己开麦克风：getUserMedia → MediaStreamSource → AudioWorklet（无损 PCM，不用 MediaRecorder）。
 *
 * 拿不到麦克风的情况都先判出来、把原因写给界面，不让录音按钮点了没反应：
 * - 不是安全上下文 / 没有 mediaDevices（Alphie 画布的 sandbox iframe 就是这样）
 * - 权限策略不允许 microphone
 * - 用户拒绝、没有设备、15 秒没响应
 */

import { InputError, type AudioInputSource, type InputAvailability, type InputContext, type InputStarted, type PcmChunk } from './AudioInputSource';
import { loadRecorderWorklet, RECORDER_PROCESSOR } from './recorderWorklet';

const OPEN_TIMEOUT_MS = 15000;

interface PolicyDoc {
  permissionsPolicy?: { allowsFeature(f: string): boolean };
  featurePolicy?: { allowsFeature(f: string): boolean };
}

function inFrame(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function micAvailability(): InputAvailability {
  const where = inFrame() ? '画布 iframe 里浏览器不给开麦克风' : '这个页面不是安全连接（https 或 localhost）';
  if (typeof window === 'undefined') return { ok: false, reason: '这个环境没有麦克风' };
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: `拿不到麦克风：${where}。之后会由外层页面录音、把声音传进来` };
  }
  if (typeof AudioWorkletNode === 'undefined') return { ok: false, reason: '这个浏览器不支持 AudioWorklet，没法无损录音' };
  const doc = document as unknown as PolicyDoc;
  const policy = doc.permissionsPolicy ?? doc.featurePolicy;
  try {
    if (policy && !policy.allowsFeature('microphone')) {
      return { ok: false, reason: '拿不到麦克风：页面的权限策略不允许 microphone' };
    }
  } catch {
    // 拿不准就交给 getUserMedia 去试
  }
  return { ok: true };
}

function explain(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return '麦克风权限被拒绝：在浏览器地址栏允许麦克风后再点录音';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return '没找到麦克风：插上麦克风或耳机后再试';
  if (name === 'NotReadableError') return '麦克风被别的程序占用了';
  return `麦克风打不开：${(e as Error)?.message || String(e)}`;
}

export class MicInputSource implements AudioInputSource {
  readonly kind = 'mic' as const;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  availability(): InputAvailability {
    return micAvailability();
  }

  /** 麦克风的可用性只在页面环境变化时变，没有可通知的事件 */
  subscribe(): () => void {
    return () => {};
  }

  async start(ctx: InputContext, onChunk: (chunk: PcmChunk) => void): Promise<InputStarted> {
    const base = micAvailability();
    if (!base.ok) throw new InputError(base.reason);
    if (!ctx.audioWorklet || !ctx.createMediaStreamSource) throw new InputError('声卡上下文不支持录音');
    this.stop();
    let stream: MediaStream;
    try {
      stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new InputError('麦克风 15 秒没有响应，检查浏览器的权限弹窗')), OPEN_TIMEOUT_MS)),
      ]);
    } catch (e) {
      throw new InputError(e instanceof InputError ? e.message : explain(e));
    }
    try {
      await loadRecorderWorklet(ctx as BaseAudioContext);
      const audio = ctx as AudioContext;
      const node = new AudioWorkletNode(audio, RECORDER_PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 0 });
      const sr = ctx.sampleRate;
      node.port.onmessage = (e: MessageEvent<{ frame: number; samples: Float32Array }>) => {
        onChunk({ samples: e.data.samples, time: e.data.frame / sr });
      };
      const source = audio.createMediaStreamSource(stream);
      source.connect(node);
      this.stream = stream;
      this.node = node;
      this.source = source;
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      throw new InputError(`录音模块加载失败：${(e as Error).message}`);
    }
    return { label: stream.getAudioTracks()[0]?.label ?? '' };
  }

  stop(): void {
    try {
      this.node?.port.postMessage('stop');
      this.source?.disconnect();
    } catch {
      // 已经断开
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.node = null;
    this.source = null;
  }
}
