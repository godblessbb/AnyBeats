import { describe, expect, it, vi } from 'vitest';
import { barAt, cellKey, importAiLyrics, TICKS_PER_BAR } from '../../core';
import { FakeTimers, MemoryStore } from '../../core/__tests__/fakeTime';
import { AiController } from '../../engine/aiController';
import { EditorStore } from '../../engine/editorStore';
import { ProjectLibrary } from '../../storage/library';
import { MemoryStorage } from '../../storage/StorageAdapter';
import { AI_TASK_NAMES, AiNotConnectedError, parseAiLyrics, type AiRequest } from '../AiProvider';
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

const fillReq: AiRequest = { task: 'fill', bpm: 90, lines: ['第一句', ''], targets: [{ bar: 1, startBeat: 60, final: 'ang' }] };

describe('AlphieBridgeProvider', () => {
  it('未接通（默认）：状态「未连接」，generate 抛 AiNotConnectedError，一条消息都不发、不 fetch', async () => {
    const { channel, sent } = fakeChannel();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const p = new AlphieBridgeProvider({ channel });
    expect(await p.status()).toEqual({ state: 'disconnected', reason: expect.stringContaining('没接通') });
    await expect(p.generate(fillReq)).rejects.toBeInstanceOf(AiNotConnectedError);
    expect(sent).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('不传通道也一样不发（产品里就是这样构造的）', async () => {
    const p = new AlphieBridgeProvider();
    expect((await p.status()).state).toBe('disconnected');
    await expect(p.generate({ task: 'polish', bpm: 90, lines: [] })).rejects.toBeInstanceOf(AiNotConnectedError);
  });

  it('接通后按 postMessage 请求 / 响应形状收发（id 对应）', async () => {
    const lyric = JSON.stringify({ bpm: 90, timeSignature: '4/4', measures: [{ measureIndex: 1, lyrics: [{ text: '方', startBeat: 60, duration: 4 }] }] });
    const { channel, sent } = fakeChannel((req) =>
      req.capability === 'worker.status'
        ? { type: BRIDGE_RESPONSE, id: req.id, ok: true, result: { worker: '本机 Claude CLI' } }
        : { type: BRIDGE_RESPONSE, id: req.id, ok: true, result: { text: '好的：\n' + lyric } },
    );
    const p = new AlphieBridgeProvider({ enabled: true, channel });
    expect(await p.status()).toEqual({ state: 'connected', worker: '本机 Claude CLI', detail: undefined });
    const data = await p.generate(fillReq);
    expect(data.measures[0]).toEqual({ measureIndex: 1, lyrics: [{ text: '方', startBeat: 60, duration: 4 }] });
    expect(sent.map((m) => [m.type, m.capability])).toEqual([
      [BRIDGE_REQUEST, 'worker.status'],
      [BRIDGE_REQUEST, 'ai.lyrics'],
    ]);
    expect(sent[1].payload).toMatchObject({ task: 'fill', bpm: 90 });
    expect(Object.keys(sent[1].payload).sort()).toEqual(['bpm', 'system', 'task', 'user']);
    expect(String(sent[1].payload.user)).toContain('第一句');
    expect(String(sent[1].payload.user)).toContain('押 ang');
    expect(new Set(sent.map((m) => m.id)).size).toBe(2);
    // 不带任何 Key
    expect(JSON.stringify(sent)).not.toMatch(/key|Bearer|sk-/i);
  });

  it('润色请求：task = polish', async () => {
    const lyric = JSON.stringify({ measures: [{ measureIndex: 0, lyrics: [] }] });
    const { channel, sent } = fakeChannel((req) => ({ type: BRIDGE_RESPONSE, id: req.id, ok: true, result: { text: lyric } }));
    const p = new AlphieBridgeProvider({ enabled: true, channel });
    await p.generate({ task: 'polish', bpm: 92, lines: ['a'], keepSkeleton: true, selection: [{ bar: 0, words: [{ startBeat: 0, duration: 4, text: 'a', editable: true }] }] });
    expect(sent[0].payload).toMatchObject({ task: 'polish', bpm: 92 });
    expect(String(sent[0].payload.user)).toContain('保持骨架');
  });

  it('宿主报错 / 超时 / 回复里没有文字都变成可读的错误', async () => {
    const err = fakeChannel((req) => ({ type: BRIDGE_RESPONSE, id: req.id, ok: false, error: 'Worker 没登录' }));
    await expect(new AlphieBridgeProvider({ enabled: true, channel: err.channel }).generate(fillReq)).rejects.toThrow('Worker 没登录');
    const silent = fakeChannel();
    await expect(new AlphieBridgeProvider({ enabled: true, channel: silent.channel, timeoutMs: 10 }).generate(fillReq)).rejects.toThrow('超时');
    const empty = fakeChannel((req) => ({ type: BRIDGE_RESPONSE, id: req.id, ok: true, result: {} }));
    await expect(new AlphieBridgeProvider({ enabled: true, channel: empty.channel }).generate(fillReq)).rejects.toThrow('没有返回文字');
  });

  it('取消：抛 AbortError', async () => {
    const silent = fakeChannel();
    const abort = new AbortController();
    const run = new AlphieBridgeProvider({ enabled: true, channel: silent.channel }).generate(fillReq, abort.signal);
    abort.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('FakeProvider + core/importAi', () => {
  it('两个动作（一次填韵 / 选区润色）的结果都能被 importAiLyrics 无损导入', async () => {
    expect(Object.keys(AI_TASK_NAMES).sort()).toEqual(['fill', 'polish']);
    const p = new FakeProvider();
    const fill = await p.generate(fillReq);
    expect(fill.measures).toEqual([{ measureIndex: 1, lyrics: [{ text: '方', startBeat: 60, duration: 4 }] }]);
    const polish = await p.generate({
      task: 'polish',
      bpm: 90,
      lines: ['凌晨'],
      keepSkeleton: true,
      selection: [{ bar: 0, words: [{ startBeat: 0, duration: 4, text: '凌', editable: true }, { startBeat: 4, duration: 4, text: '晨', editable: false }] }],
    });
    expect(polish.measures[0].lyrics.map((l) => l.text)).toEqual(['新', '晨']);
    for (const data of [fill, polish]) {
      const r = importAiLyrics(data);
      expect(r.warnings).toEqual([]);
      expect(r.bars.length).toBeGreaterThan(0);
    }
    expect(p.calls.map((c) => c.task)).toEqual(['fill', 'polish']);
  });

  it('parseAiLyrics 容忍前后说明文字，拒绝没有小节的 JSON', () => {
    expect(parseAiLyrics('```json\n{"measures":[{"measureIndex":0,"lyrics":[]}]}\n```').measures).toHaveLength(1);
    expect(() => parseAiLyrics('{"measures":[]}')).toThrow();
    expect(() => parseAiLyrics('{"measures":[{"measureIndex":0.5,"lyrics":[]}]}')).toThrow();
    expect(() => parseAiLyrics('没有 JSON')).toThrow();
  });
});

describe('提示词', () => {
  const noSecrets = /api\.|openai|deepseek|claude|anthropic|gpt|key|https?:\/\//i;

  it('一次填韵：不含模型名、Key、接口地址；全文按小节编号，列出每个要填的位置和韵母', () => {
    const { system, user } = buildPrompt({
      task: 'fill',
      bpm: 92,
      lines: ['凌晨三点', ''],
      instruction: ' 写夜里开车 ',
      targets: [
        { bar: 0, startBeat: 60, final: 'ang' },
        { bar: 1, startBeat: 4, final: 'ou' },
      ],
    });
    expect(system + user).not.toMatch(noSecrets);
    expect(system).toContain('BPM 92');
    expect(user).toContain('0. 凌晨三点');
    expect(user).toContain('1. （空）');
    expect(user).toContain('第 0 小节 startBeat 60：押 ang');
    expect(user).toContain('第 1 小节 startBeat 4：押 ou');
    expect(user).toContain('补充要求：写夜里开车');
  });

  it('选区润色：保持骨架时说明字数和落点不变；不许改的字标出来；允许改 flow 时换一条规则', () => {
    const base: AiRequest = {
      task: 'polish',
      bpm: 92,
      lines: ['凌晨三点'],
      selection: [{ bar: 0, words: [{ startBeat: 0, duration: 4, text: '凌', editable: true }, { startBeat: 4, duration: 4, text: '晨', editable: false }, { startBeat: 8, duration: 4, text: '', editable: true }] }],
    };
    const keep = buildPrompt({ ...base, keepSkeleton: true });
    expect(keep.system + keep.user).not.toMatch(noSecrets);
    expect(keep.user).toContain('保持骨架');
    expect(keep.user).toContain('第 0 小节：凌@0/4 晨@4/4（不许改） □@8/4');
    const flow = buildPrompt({ ...base, keepSkeleton: false });
    expect(flow.user).not.toContain('保持骨架');
    expect(flow.user).toContain('可以改 flow');
  });
});

describe('AiController', () => {
  function setup(provider = new FakeProvider()) {
    const storage = new MemoryStorage('测试');
    const library = new ProjectLibrary(storage);
    const store = new EditorStore({ storage, library, timers: new FakeTimers(), now: () => 1 });
    return { store, provider, ai: new AiController(provider, store) };
  }

  const at = (bar: number, tick: number) => bar * TICKS_PER_BAR + tick;
  const layout = (store: EditorStore, global: number) => barAt(store.grid, global)!.words.map((w) => [w.tick, w.text]);
  const keyOf = (store: EditorStore, global: number, beat: number) => cellKey(barAt(store.grid, global)!.id, beat);
  const barText = (store: EditorStore, global: number) => barAt(store.grid, global)!.words.map((w) => w.text).join('');

  /**
   * 空工程：第 1 小节第 1 拍两个空字（涂色，要填）；第 2 小节第 1 拍「我」+ 空字（涂色，但已经写了字，整格跳过）；
   * 第 3 小节第 1 拍一个空字（没涂色，不填）。颜色：单押 ang。
   */
  function fillable(store: EditorStore) {
    store.newProject();
    for (const abs of [at(0, 0), at(0, 12), at(1, 0), at(1, 12), at(2, 0)]) store.flowClick(abs);
    store.commitText(at(1, 0), '我');
    store.addRule();
    store.setRuleFinal(store.getState().activeRule!, 0, 'ang');
    store.selectBox({ bar: 0, beat: 0 }, { bar: 1, beat: 0 });
    store.paintSelection();
  }

  it('连接状态', async () => {
    const { ai } = setup();
    await ai.check();
    expect(ai.getState()).toMatchObject({ checking: false, status: { state: 'connected' } });
  });

  it('一次填韵：AI 的字只填进涂了色、还没写字的格子的韵脚位置，作为一步「AI 改写」', async () => {
    const { store, provider, ai } = setup(new FakeProvider({ fillChars: ['方'] }));
    fillable(store);
    const depth = store.getState().history.done.length;
    expect(await ai.fill()).toBe(true);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({ task: 'fill', bpm: store.doc.bpm, targets: [{ bar: 0, startBeat: 4, final: 'ang' }] });
    expect(provider.calls[0].lines.slice(0, 3)).toEqual(['', '我', '']);
    expect(layout(store, 0)).toEqual([
      [0, ''],
      [12, '方'],
    ]);
    expect(layout(store, 1)).toEqual([
      [0, '我'],
      [12, ''],
    ]);
    expect(layout(store, 2)).toEqual([[0, '']]);
    expect(store.getState().history.done).toHaveLength(depth + 1);
    expect(store.getState().history.done.at(-1)?.kind).toBe('ai');
    expect(ai.getState()).toMatchObject({ generating: false, error: null, rejected: null });
  });

  it('一次填韵：AI 多写了一个不该写的位置 → 整份作废，表格不动，记下被拒的改动', async () => {
    const { store, ai } = setup(new FakeProvider({ fillChars: ['方'], rogue: { measureIndex: 2, startBeat: 0, text: '坏' } }));
    fillable(store);
    const doc = store.doc;
    const depth = store.getState().history.done.length;
    expect(await ai.fill()).toBe(false);
    expect(store.doc).toBe(doc);
    expect(store.getState().history.done).toHaveLength(depth);
    const rejected = ai.getState().rejected!;
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected).toContainEqual(expect.objectContaining({ abs: at(2, 0), after: '坏', reason: 'outside' }));
    expect(store.getState().notice?.text).toMatch(/作废/);
  });

  it('一次填韵：没有要填的位置时给提示，不调用 AI', async () => {
    const { provider, ai } = setup(); // 夜车：涂了色的格子都写了字
    expect(await ai.fill()).toBe(false);
    expect(ai.getState().error).toMatch(/没有要填的韵脚位置/);
    expect(provider.calls).toHaveLength(0);
  });

  it('选区润色（保持骨架）：只换选区里可改的字；锁住的、选区外的都不动', async () => {
    const { store, provider, ai } = setup(new FakeProvider({ polishChar: '新' }));
    store.clickCell(1, 1);
    store.lockCells(true); // 「街灯在」锁住
    const others = [0, 2, 3, 4, 5, 6, 7, 8].map((g) => barText(store, g));
    const scope = [keyOf(store, 1, 0), keyOf(store, 1, 1)];
    expect(await ai.polish(scope)).toBe(true);
    const req = provider.calls[0];
    expect(req).toMatchObject({ task: 'polish', keepSkeleton: true });
    expect(req.selection!.map((l) => l.bar)).toEqual([1]);
    expect(req.selection![0].words.map((w) => w.editable)).toEqual([true, true, true, true, ...Array(11).fill(false)]);
    expect(req.selection![0].words[1]).toMatchObject({ startBeat: 4, duration: 4, text: '晨' });
    expect(barText(store, 1)).toBe('新新新新街灯在还在路上找个地方');
    expect([0, 2, 3, 4, 5, 6, 7, 8].map((g) => barText(store, g))).toEqual(others);
    expect(store.getState().history.done.at(-1)?.kind).toBe('ai');
  });

  it('选区润色（允许改 flow）：请求里 keepSkeleton = false，结果照样逐字比对后上屏', async () => {
    const { store, provider, ai } = setup(new FakeProvider({ polishChar: '新' }));
    ai.setOptions({ allowFlow: true });
    expect(ai.getState().options).toEqual({ keepSkeleton: false, allowFlow: true });
    expect(await ai.polish([keyOf(store, 1, 0)])).toBe(true);
    expect(provider.calls[0].keepSkeleton).toBe(false);
    expect(barText(store, 1)).toBe('新新新新街灯在还在路上找个地方');
    ai.setOptions({ keepSkeleton: true });
    expect(ai.getState().options).toEqual({ keepSkeleton: true, allowFlow: false });
  });

  it('选区润色：AI 动了选区外的字 → 整份作废', async () => {
    const { store, ai } = setup(new FakeProvider({ rogue: { measureIndex: 2, startBeat: 0, text: '坏' } }));
    const doc = store.doc;
    expect(await ai.polish([keyOf(store, 1, 0)])).toBe(false);
    expect(store.doc).toBe(doc);
    expect(ai.getState().rejected).toContainEqual(expect.objectContaining({ abs: at(2, 0), reason: 'outside' }));
  });

  it('没选格子就润色：给提示，不调用 AI', async () => {
    const { provider, ai } = setup();
    expect(await ai.polish([])).toBe(false);
    expect(ai.getState().error).toMatch(/先框选/);
    expect(provider.calls).toHaveLength(0);
  });

  it('Worker 未连接：报错、表格不动，并回到未连接状态', async () => {
    const { store, ai } = setup(new FakeProvider({ connected: false }));
    const doc = store.doc;
    expect(await ai.polish([keyOf(store, 1, 0)])).toBe(false);
    expect(ai.getState().error).toBeTruthy();
    expect(ai.getState().generating).toBe(false);
    expect(store.doc).toBe(doc);
    await new Promise((r) => setTimeout(r, 0));
    expect(ai.getState().status?.state).toBe('disconnected');
  });

  it('生成失败：错误信息原样给界面', async () => {
    const { ai } = setup(new FakeProvider({ failWith: 'Worker 忙' }));
    expect(await ai.polish(['x:0'])).toBe(false);
    expect(ai.getState().error).toBe('Worker 忙');
  });

  it('可以取消：不报错、表格不动', async () => {
    const { store, ai } = setup(new FakeProvider({ delayMs: 50 }));
    const doc = store.doc;
    const run = ai.polish([keyOf(store, 1, 0)]);
    expect(ai.getState().generating).toBe(true);
    ai.cancel();
    expect(await run).toBe(false);
    expect(ai.getState()).toMatchObject({ generating: false, error: null });
    expect(store.doc).toBe(doc);
  });
});

describe('存储没有用到真实 localStorage', () => {
  it('MemoryStore 只是测试辅助', () => {
    expect(new MemoryStore().getItem('x')).toBeNull();
  });
});
