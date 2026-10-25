import { describe, expect, it } from 'vitest';
import { createAutosave } from '../autosave';
import { createGrid, createSection, insertClip, toggleAccent } from '../grid';
import {
  createProject,
  deserializeProject,
  exportLrc,
  exportTxt,
  formatLrcTime,
  migrateLegacyStorage,
  ProjectFormatError,
  serializeProject,
  timeOfStep,
  type Project,
} from '../project';
import { FakeTimers, MemoryStore } from './fakeTime';

function demo(): Project {
  let grid = createGrid([createSection('verse', 2), createSection('chorus', 1)]);
  grid = insertClip(grid, { section: 0, bar: 0 }, { start: 0, length: 2, text: '我' });
  grid = insertClip(grid, { section: 0, bar: 0 }, { start: 4, length: 4, text: '来' });
  grid = insertClip(grid, { section: 0, bar: 0 }, { start: 8, length: 2, text: '', hold: true });
  grid = insertClip(grid, { section: 0, bar: 1 }, { start: 6, length: 1, text: '了' });
  grid = insertClip(grid, { section: 1, bar: 0 }, { start: 2, length: 2, text: '嘿' });
  grid = toggleAccent(grid, grid.sections[1].bars[0].clips[0].id);
  return createProject({ name: '测试', createdAt: 1, updatedAt: 2, bpm: 90, offsetMs: 250, grid });
}

describe('工程序列化', () => {
  it('v2 往返无损（含 BPM、偏移、段落、重音、延音、id）', () => {
    const p = demo();
    const json = serializeProject(p);
    expect(JSON.parse(json)).toMatchObject({ schema: 'anybeats.project', version: 2, stepsPerBar: 16 });
    expect(deserializeProject(json)).toEqual(p);
  });

  it('读 v1（旧界面 localStorage）：每格 1 拍，格内字平分这一拍，空格=空拍，- =延音，重音落在第一个字', () => {
    const legacy = JSON.stringify([
      {
        name: '老歌',
        createdAt: 5,
        updatedAt: 6,
        measures: [
          [
            { text: '我', isAccented: true },
            { text: '走在', isAccented: false },
            { text: ' 街-', isAccented: true },
            { text: '一二三四五', isAccented: false },
          ],
        ],
      },
    ]);
    const [p] = migrateLegacyStorage(legacy, { defaultBpm: 88 });
    expect(p).toMatchObject({ name: '老歌', createdAt: 5, updatedAt: 6, bpm: 88, offsetMs: 0 });
    const clips = p.grid.sections[0].bars[0].clips.map((c) => [c.start, c.length, c.hold ? '-' : c.text, c.accent]);
    expect(clips).toEqual([
      [0, 4, '我', true],
      [4, 2, '走', false],
      [6, 2, '在', false],
      [9, 1, '街', true],
      [10, 2, '-', false],
      [12, 1, '一二', false],
      [13, 1, '三', false],
      [14, 1, '四', false],
      [15, 1, '五', false],
    ]);
  });

  it('坏输入给出明确错误', () => {
    expect(() => deserializeProject('{')).toThrow(ProjectFormatError);
    expect(() => deserializeProject({ schema: 'anybeats.project', version: 99 })).toThrow(/版本 99/);
    expect(() => deserializeProject({ foo: 1 })).toThrow(ProjectFormatError);
    expect(migrateLegacyStorage(null)).toEqual([]);
  });
});

describe('导出', () => {
  it('时间 = 偏移 + 绝对 1/16 × (60 / BPM / 4)', () => {
    const p = demo();
    // 90 BPM：一格 1/6 秒；第 2 小节第 6 格 = 22 格
    expect(timeOfStep(p, 22)).toBeCloseTo(0.25 + 22 / 6, 12);
    expect(formatLrcTime(3.9166666)).toBe('00:03.92');
    expect(formatLrcTime(75.004)).toBe('01:15.00');
  });

  it('LRC 行时间戳', () => {
    expect(exportLrc(demo())).toBe(['[ti:测试]', '[re:AnyBeats]', '[00:00.25]我来', '[00:03.92]了', '[00:05.92]嘿', ''].join('\n'));
  });

  it('LRC 逐字时间戳', () => {
    const lrc = exportLrc(demo(), { wordTimestamps: true });
    expect(lrc.split('\n')[2]).toBe('[00:00.25]<00:00.25>我<00:00.92>来');
  });

  it('txt：段落标题 + 每小节一行，跳过延音和空小节', () => {
    expect(exportTxt(demo())).toBe(['[主歌]', '我来', '了', '', '[副歌]', '嘿', ''].join('\n'));
    expect(exportTxt(createProject())).toBe('');
  });
});

describe('自动保存', () => {
  it('节流写入：连续改动在 debounce 内只写一次，写的是最新版本', () => {
    const store = new MemoryStore();
    const timers = new FakeTimers();
    const auto = createAutosave({ store, timers, debounceMs: 500 });
    const p = demo();
    auto.notify({ ...p, bpm: 91 });
    timers.advance(200);
    auto.notify({ ...p, bpm: 92 });
    expect(store.map.size).toBe(0);
    timers.advance(300);
    expect(auto.restore()?.bpm).toBe(92);
    expect(auto.pending).toBe(false);
  });

  it('flush 立即写；clear 删除草稿；坏草稿 restore 返回 null 并报错', () => {
    const store = new MemoryStore();
    const timers = new FakeTimers();
    const errors: unknown[] = [];
    const auto = createAutosave({ store, timers, onError: (e) => errors.push(e) });
    auto.notify(demo());
    auto.flush();
    expect(timers.pendingCount).toBe(0);
    expect(auto.restore()?.name).toBe('测试');
    auto.clear();
    expect(auto.restore()).toBeNull();
    store.setItem('anybeats.autosave.v2', '{bad');
    expect(auto.restore()).toBeNull();
    expect(errors.length).toBe(1);
  });
});
