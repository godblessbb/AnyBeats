import { describe, expect, it, vi } from 'vitest';
import { importAiLyrics } from '../../core';
import { FakeTimers, MemoryStore } from '../../core/__tests__/fakeTime';
import { AiController } from '../../engine/aiController';
import { EditorStore } from '../../engine/editorStore';
import { ProjectLibrary } from '../../storage/library';
import { MemoryStorage } from '../../storage/StorageAdapter';
import { AiNotConnectedError, parseAiLyrics } from '../AiProvider';
import { AlphieBridgeProvider, BRIDGE_REQUEST, BRIDGE_RESPONSE, type BridgeChannel, type BridgeRequest } from '../AlphieBridgeProvider';
import { FakeProvider } from '../FakeProvider';
import { buildPrompt } from '../prompt';

function fakeChannel(reply?: (req: BridgeRequest) => unknown) {
  const sent: BridgeRequest[] = [];
  let handler: ((d: unknown) => void) | null = null;
  const channel: BridgeChannel = {
    post: (m) => {
      sent.push(m);
      if (reply) {
        const r = reply(m);
        if (r !== undefined) queueMicrotask(() => handler?.(r));
      }
    },
    listen: (h) => {
      handler = h;
      return () => {
        handler = null;
      };
    },
  };
  return { channel, sent };
}

describe('AlphieBridgeProvider', () => {
  it('未接通（默认）：状态「未连接」，generate 抛 AiNotConnectedError，一条消息都不发、不 fetch', async () => {
    const { channel, sent } = fakeChannel();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const p = new AlphieBridgeProvider({ channel });
    expect(await p.status()).toEqual({ state: 'disconnected', reason: expect.stringContaining('没接通') });
    await expect(p.generate({ task: 'continue', bpm: 90, lines: [] })).rejects.toBeInstanceOf(AiNotConnectedError);
    expect(sent).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('不传通道也一样不发（产品里就是这样构造的）', async () => {
    const p = new AlphieBridgeProvider();
    expect((await p.status()).state).toBe('disconnected');
  });

  it('接通后按 postMessage 请求 / 响应形状收发（id 对应）', async () => {
    const lyric = JSON.stringify({ bpm: 90, timeSignature: '4/4', measures: [{ measureIndex: 0, lyrics: [{ text: '我', startBeat: 0, duration: 4 }] }] });
    const { channel, sent } = fakeChannel((req) =>
      req.capability === 'worker.status'
        ? { type: BRIDGE_RESPONSE, id: req.id, ok: true, result: { worker: '本机 Claude CLI' } }
        : { type: BRIDGE_RESPONSE, id: req.id, ok: true, result: { text: '好的：\n' + lyric } },
    );
    const p = new AlphieBridgeProvider({ enabled: true, channel });
    expect(await p.status()).toEqual({ state: 'connected', worker: '本机 Claude CLI', detail: undefined });
    const data = await p.generate({ task: 'continue', bpm: 90, lines: ['第一句'], bars: 1 });
    expect(data.measures[0].lyrics[0].text).toBe('我');
    expect(sent.map((m) => [m.type, m.capability])).toEqual([
      [BRIDGE_REQUEST, 'worker.status'],
      [BRIDGE_REQUEST, 'ai.lyrics'],
    ]);
    expect(sent[1].payload).toMatchObject({ task: 'continue', bpm: 90 });
    expect(String(sent[1].payload.user)).toContain('第一句');
    // 不带任何 Key
    expect(JSON.stringify(sent)).not.toMatch(/key|Bearer|sk-/i);
  });

  it('宿主报错 / 超时都变成可读的错误', async () => {
    const err = fakeChannel((req) => ({ type: BRIDGE_RESPONSE, id: req.id, ok: false, error: 'Worker 没登录' }));
    await expect(new AlphieBridgeProvider({ enabled: true, channel: err.channel }).generate({ task: 'continue', bpm: 90, lines: [] })).rejects.toThrow('Worker 没登录');
    const silent = fakeChannel();
    await expect(
      new AlphieBridgeProvider({ enabled: true, channel: silent.channel, timeoutMs: 10 }).generate({ task: 'continue', bpm: 90, lines: [] }),
    ).rejects.toThrow('超时');
  });
});

describe('FakeProvider + core/importAi', () => {
  it('三个动作的结果都能被 importAiLyrics 无损导入', async () => {
    const p = new FakeProvider();
    for (const task of ['continue', 'rhyme', 'fit'] as const) {
      const data = await p.generate({ task, bpm: 90, lines: ['霓虹灯把影子拉得很长'], target: '霓虹灯把影子拉得很长', bars: 2, chars: 8 });
      const r = importAiLyrics(data);
      expect(r.warnings).toEqual([]);
      expect(r.bars.length).toBeGreaterThan(0);
    }
  });

  it('parseAiLyrics 容忍前后说明文字，拒绝没有小节的 JSON', () => {
    expect(parseAiLyrics('```json\n{"measures":[{"measureIndex":0,"lyrics":[]}]}\n```').measures).toHaveLength(1);
    expect(() => parseAiLyrics('{"measures":[]}')).toThrow();
    expect(() => parseAiLyrics('没有 JSON')).toThrow();
  });

  it('提示词不含模型名、Key、接口地址', () => {
    const { system, user } = buildPrompt({ task: 'rhyme', bpm: 92, lines: ['a'], target: '拉得很长', rhyme: 'ang' });
    expect(system + user).not.toMatch(/api\.|openai|deepseek|key/i);
    expect(user).toContain('拉得很长');
  });
});

describe('AiController', () => {
  function setup(provider = new FakeProvider()) {
    const storage = new MemoryStorage('测试');
    const library = new ProjectLibrary(storage);
    const store = new EditorStore({ storage, library, timers: new FakeTimers(), now: () => 1 });
    return { store, ai: new AiController(provider, store) };
  }

  it('续写 → 虚线预览（未改动歌词）→ 全部采用 → 能撤销', async () => {
    const { store, ai } = setup();
    const before = store.getState().grid;
    await ai.check();
    expect(ai.getState().status).toMatchObject({ state: 'connected' });
    await ai.generate();
    const p = store.getState().preview!;
    expect(p.mode).toBe('fill');
    expect(p.lines).toEqual(['一句一句把门敲开', '汗水换来今天的喝彩']);
    expect(store.getState().grid).toBe(before);
    store.adoptPreview();
    expect(store.writtenLines().slice(-2)).toEqual(['一句一句把门敲开', '汗水换来今天的喝彩']);
    store.undo();
    expect(store.getState().grid).toBe(before);
  });

  it('改押韵没选中小节时给提示，不调用 AI', async () => {
    const provider = new FakeProvider();
    const { ai } = setup(provider);
    ai.setTask('rhyme');
    await ai.generate();
    expect(ai.getState().error).toMatch(/先选中/);
    expect(provider.calls).toHaveLength(0);
  });

  it('选中小节后改押韵是替换预览', async () => {
    const { store, ai } = setup();
    store.select(16 + 3); // 第 2 小节
    ai.setTask('rhyme');
    await ai.generate();
    const p = store.getState().preview!;
    expect(p).toMatchObject({ mode: 'replace', section: 0, at: 1, before: ['霓虹灯把影子拉得很长'] });
    expect(p.lines[0].endsWith('一行')).toBe(true);
  });

  it('Worker 未连接：报错并回到 ai-login 状态', async () => {
    const { ai } = setup(new FakeProvider({ connected: false }));
    await ai.generate();
    expect(ai.getState().error).toBeTruthy();
    await new Promise((r) => setTimeout(r, 0));
    expect(ai.getState().status?.state).toBe('disconnected');
  });

  it('可以取消', async () => {
    const { store, ai } = setup(new FakeProvider({ delayMs: 50 }));
    const run = ai.generate();
    ai.cancel();
    await run;
    expect(ai.getState().generating).toBe(false);
    expect(store.getState().preview).toBeNull();
  });
});

describe('存储没有用到真实 localStorage', () => {
  it('MemoryStore 只是测试辅助', () => {
    expect(new MemoryStore().getItem('x')).toBeNull();
  });
});
