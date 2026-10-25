import { describe, expect, it } from 'vitest';
import type { Take } from '../../audio/takes';
import { MemoryStorage, WebStorage } from '../StorageAdapter';
import { createTakeStore, MemoryTakeStore } from '../takeStore';

const persistent = new WebStorage({ getItem: () => null, setItem: () => {}, removeItem: () => {} } as unknown as Storage);

function take(id: string, createdAt: number, projectId = 'p'): Take {
  return {
    id,
    projectId,
    name: id,
    createdAt,
    sampleRate: 48000,
    songStart: 0,
    latencyMs: 0,
    trimStart: 0,
    trimEnd: 0,
    duration: 0.001,
    peaks: [],
    selected: false,
    samples: new Float32Array(48).fill(createdAt),
  };
}

describe('createTakeStore：跟着 StorageAdapter 选存储', () => {
  it('StorageAdapter 不持久（画布 iframe）→ 内存，原因沿用', async () => {
    const s = await createTakeStore(new MemoryStorage('画布里拿不到本机存储'));
    expect(s.persistent).toBe(false);
    expect(s.reason).toMatch(/画布/);
  });

  it('没有 IndexedDB → 内存', async () => {
    const s = await createTakeStore(persistent, () => undefined);
    expect(s.persistent).toBe(false);
    expect(s.reason).toMatch(/IndexedDB/);
  });

  it('IndexedDB 一打开就抛错 → 内存，不白屏', async () => {
    const broken = { open: () => { throw new DOMException('denied', 'SecurityError'); } } as unknown as IDBFactory;
    const s = await createTakeStore(persistent, () => broken);
    expect(s.persistent).toBe(false);
    expect(s.reason).toMatch(/打不开/);
  });
});

describe('MemoryTakeStore', () => {
  it('按作品分开、按录制先后排；改信息不动音频；删除', async () => {
    const s = new MemoryTakeStore();
    await s.put(take('b', 2));
    await s.put(take('a', 1));
    await s.put(take('x', 0, 'other'));
    expect((await s.list('p')).map((t) => t.id)).toEqual(['a', 'b']);
    await s.putMeta({ ...take('a', 1), selected: true, trimStart: 0.5 });
    const [a] = await s.list('p');
    expect(a.selected).toBe(true);
    expect(a.trimStart).toBe(0.5);
    expect(a.samples[0]).toBe(1);
    await s.remove('a');
    expect((await s.list('p')).map((t) => t.id)).toEqual(['b']);
  });
});
