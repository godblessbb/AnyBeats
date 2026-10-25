/**
 * 经 Alphie 画布宿主（父窗口）调用 Worker 的 AiProvider。
 *
 * Alphie 的「画布能力」原语还在设计，这里先把 postMessage 请求 / 响应的形状定下来：
 *
 *   画布 → 宿主  { type: 'alphie.canvas.request',  id, capability, payload }
 *   宿主 → 画布  { type: 'alphie.canvas.response', id, ok: true,  result }
 *                { type: 'alphie.canvas.response', id, ok: false, error }
 *
 *   capability = 'worker.status'  payload = {}                          result = { worker: string, detail?: string }
 *   capability = 'ai.lyrics'      payload = { task, system, user, bpm }  result = { text: string }（模型原文，内含歌词 JSON）
 *
 * 宿主那边没接通之前 enabled 默认 false：status() 直接回「未连接」，generate() 直接抛 AiNotConnectedError，
 * 一条消息都不发、不做任何网络请求，界面显示 ai-login 引导。
 */

import type { AiLyricData } from '../core';
import { abortError, AiNotConnectedError, parseAiLyrics, type AiProvider, type AiRequest, type AiStatus } from './AiProvider';
import { buildPrompt } from './prompt';

export const BRIDGE_REQUEST = 'alphie.canvas.request';
export const BRIDGE_RESPONSE = 'alphie.canvas.response';

export type BridgeCapability = 'worker.status' | 'ai.lyrics';

export interface BridgeRequest {
  type: typeof BRIDGE_REQUEST;
  id: string;
  capability: BridgeCapability;
  payload: Record<string, unknown>;
}

export interface BridgeResponse {
  type: typeof BRIDGE_RESPONSE;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** 收发消息的两端，可注入（测试里用假的）；默认是 window.parent 和 window 的 message 事件 */
export interface BridgeChannel {
  post(message: BridgeRequest): void;
  listen(handler: (data: unknown) => void): () => void;
}

export interface AlphieBridgeOptions {
  /** 宿主的画布能力接通后才设为 true；在那之前不发任何消息 */
  enabled?: boolean;
  channel?: BridgeChannel;
  timeoutMs?: number;
}

export const NOT_CONNECTED_REASON = 'Alphie 画布的 AI 能力还没接通';

let seq = 0;

export class AlphieBridgeProvider implements AiProvider {
  readonly id = 'alphie-bridge';
  private readonly enabled: boolean;
  private readonly channel: BridgeChannel | null;
  private readonly timeoutMs: number;

  constructor(options: AlphieBridgeOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.channel = options.channel ?? null;
    this.timeoutMs = options.timeoutMs ?? 60000;
  }

  async status(): Promise<AiStatus> {
    if (!this.enabled || !this.channel) return { state: 'disconnected', reason: NOT_CONNECTED_REASON };
    try {
      const result = (await this.request('worker.status', {}, undefined, 5000)) as { worker?: string; detail?: string };
      return { state: 'connected', worker: result?.worker || 'Alphie Worker', detail: result?.detail };
    } catch (e) {
      return { state: 'disconnected', reason: (e as Error).message || NOT_CONNECTED_REASON };
    }
  }

  async generate(req: AiRequest, signal?: AbortSignal): Promise<AiLyricData> {
    if (!this.enabled || !this.channel) throw new AiNotConnectedError(NOT_CONNECTED_REASON);
    const { system, user } = buildPrompt(req);
    const result = (await this.request('ai.lyrics', { task: req.task, system, user, bpm: req.bpm }, signal)) as {
      text?: string;
    };
    if (typeof result?.text !== 'string') throw new Error('Worker 没有返回文字');
    return parseAiLyrics(result.text);
  }

  private request(
    capability: BridgeCapability,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
    timeoutMs = this.timeoutMs,
  ): Promise<unknown> {
    const channel = this.channel!;
    seq += 1;
    const id = `ab-${Date.now().toString(36)}-${seq}`;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      let done = false;
      const finish = () => {
        done = true;
        clearTimeout(timer);
        unlisten();
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        if (done) return;
        finish();
        reject(abortError());
      };
      const timer = setTimeout(() => {
        if (done) return;
        finish();
        reject(new Error('Worker 没有响应（超时）'));
      }, timeoutMs);
      const unlisten = channel.listen((data) => {
        const msg = data as Partial<BridgeResponse> | null;
        if (done || !msg || msg.type !== BRIDGE_RESPONSE || msg.id !== id) return;
        finish();
        if (msg.ok) resolve(msg.result);
        else reject(new Error(msg.error || 'Worker 返回错误'));
      });
      signal?.addEventListener('abort', onAbort);
      channel.post({ type: BRIDGE_REQUEST, id, capability, payload });
    });
  }
}

/** 浏览器里的默认通道：发给父窗口（Alphie 画布宿主），收 window 的 message 事件 */
export function parentWindowChannel(win: Window = window): BridgeChannel {
  return {
    post: (message) => win.parent.postMessage(message, '*'),
    listen: (handler) => {
      const fn = (e: MessageEvent) => {
        if (e.source === win.parent) handler(e.data);
      };
      win.addEventListener('message', fn);
      return () => win.removeEventListener('message', fn);
    },
  };
}
