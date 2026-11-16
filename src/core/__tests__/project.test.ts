import { describe, expect, it } from 'vitest';
import { createAutosave } from '../autosave';
import { planBeatSwap, RECOMMENDED_BEAT_SWAP } from '../bpm';
import { allWords, createBar, createSection, createWord, insertWord, TICKS_PER_BAR, type Grid } from '../grid';
import { History, restoreHistory, serializeHistory } from '../history';
import {
  createProject,
  deserializeProject,
  docCodec,
  exportLrc,
  exportTxt,
  formatLrcTime,
  migrateLegacyStorage,
  PROJECT_VERSION,
  ProjectFormatError,
  serializeProject,
  timeOfTick,
  type Doc,
  type Project,
} from '../project';
import { FakeTimers, MemoryStore } from './fakeTime';
import { V2_NIGHT_DRIVE, V2_SECTIONS } from './fixtures/v2project';

function demo(): Project {
  const verse = createSection('verse', 2, 'Verse 1');
  const hook = createSection('hook', 1, 'Hook');
  verse.bars[0] = { ...createBar([createWord({ tick: 0, len: 24, text: '我' }), createWord({ tick: 48, len: 96, text: '来' })]), id: 'bar0' };
  verse.bars[1].words = [createWord({ tick: 72, len: 12, text: '了' })];
  hook.bars[0].words = [createWord({ tick: 24, len: 24, text: '嘿' })];
  return createProject({
    name: '测试',
    createdAt: 1,
    updatedAt: 2,
    bpm: 90,
    offsetMs: 250,
    grid: { sections: [verse, hook] },
    rules: [{ id: 'r1', hue: 215, count: 1, finals: ['ai'] }],
    paint: { 'bar0:1': 'r1' },
    locks: { bars: ['bar0'], beats: [2], cells: [], rhyme: true },
    beat: { name: '夜车_beat.mp3', bpm: 92, rate: 1, durationSec: 112 },
  });
}

interface V2Clip {
  id: string;
  start: number;
  length: number;
  text: string;
  hold?: boolean;
}
interface V2File {
  name: string;
  bpm: number;
  offsetMs: number;
  sections: { id: string; kind: string; label: string; bars: { id: string; clips: V2Clip[] }[] }[];
}

/** 按 v2 的语义独立算出每个字在新模型里应该在哪：起点 ×12，延音并进前一个字（可跨小节），空拍丢掉 */
function expectedWords(file: V2File): { abs: number; len: number; text: string }[] {
  const out: { abs: number; len: number; text: string }[] = [];
  let g = 0;
  for (const s of file.sections) {
    for (const b of s.bars) {
      for (const c of [...b.clips].sort((x, y) => x.start - y.start)) {
        const abs = g * 192 + c.start * 12;
        const last = out[out.length - 1];
        if (c.hold) {
          if (last && last.abs + last.len === abs) last.len += c.length * 12;
          continue;
        }
        if (!c.text) {
          out.push({ abs, len: 0, text: '' }); // 空拍：占位，后面去掉，保证延音不会接到空拍前面的字上
          continue;
        }
        const chars = Array.from(c.text);
        chars.forEach((ch, i) => {
          const s0 = abs + Math.floor((i * c.length * 12) / chars.length);
          const s1 = abs + Math.floor(((i + 1) * c.length * 12) / chars.length);
          out.push({ abs: s0, len: s1 - s0, text: ch });
        });
      }
      g += 1;
    }
  }
  return out.filter((w) => w.len > 0);
}

describe('工程序列化 v3', () => {
  it('v3 往返无损（字、长度、规则、涂色、锁定、伴奏、id）', () => {
    const p = demo();
    const json = serializeProject(p);
    expect(JSON.parse(json)).toMatchObject({ schema: 'anybeats.project', version: 3, ticksPerBeat: 48 });
    expect(PROJECT_VERSION).toBe(3);
    expect(deserializeProject(json)).toEqual(p);
  });

  it('坏输入给出明确错误', () => {
    expect(() => deserializeProject('{')).toThrow(ProjectFormatError);
    expect(() => deserializeProject({ schema: 'anybeats.project', version: 99 })).toThrow(/版本 99/);
    expect(() => deserializeProject({ foo: 1 })).toThrow(ProjectFormatError);
    expect(() => deserializeProject({ schema: 'anybeats.project', version: 2, stepsPerBar: 16 })).toThrow(ProjectFormatError);
    expect(migrateLegacyStorage(null)).toEqual([]);
  });
});

describe('迁移 v2 → v3（用 v2 代码生成的夹具）', () => {
  const file = JSON.parse(V2_NIGHT_DRIVE) as V2File;
  const p = deserializeProject(V2_NIGHT_DRIVE);

  it('元数据、小节 id、段落都对得上；段落名换成英文', () => {
    expect(p).toMatchObject({ name: '夜车', bpm: 92, offsetMs: 120, createdAt: 1731628800000, updatedAt: 1731630000000 });
    expect(p.grid.sections.map((s) => [s.kind, s.label])).toEqual([
      ['verse', 'Verse 1'],
      ['hook', 'Hook'],
      ['verse', 'Verse 2'],
    ]);
    expect(p.grid.sections.map((s) => s.id)).toEqual(file.sections.map((s) => s.id));
    expect(p.grid.sections.flatMap((s) => s.bars.map((b) => b.id))).toEqual(file.sections.flatMap((s) => s.bars.map((b) => b.id)));
    expect(p.rules).toEqual([]);
    expect(p.paint).toEqual({});
  });

  it('每个字的起点 = 1/16 × 12、长度含原来的延音；字一个不少、顺序不变', () => {
    const got = allWords(p.grid).map((w) => ({ abs: w.abs, len: w.word.len, text: w.word.text }));
    expect(got).toEqual(expectedWords(file));
    const v2Text = file.sections.flatMap((s) => s.bars.flatMap((b) => b.clips.filter((c) => !c.hold).map((c) => c.text))).join('');
    expect(got.map((w) => w.text).join('')).toBe(v2Text);
  });

  it('具体落点：第 1 小节「凌晨三点.我还在路-上----.」', () => {
    const bar = p.grid.sections[0].bars[0].words.map((w) => [w.tick, w.len, w.text]);
    expect(bar).toEqual([
      [0, 12, '凌'],
      [12, 12, '晨'],
      [24, 12, '三'],
      [36, 12, '点'],
      [60, 12, '我'],
      [72, 12, '还'],
      [84, 12, '在'],
      [96, 24, '路'], // 「路-」：延音变成长度
      [120, 60, '上'], // 「上----」
    ]);
  });

  it('旧段落名全换成 Intro / Verse / Hook / Bridge / Outro；开头的延音丢掉；延音跨小节、跨段落接到前一个字上；多字片段平分成 1/32', () => {
    const q = deserializeProject(V2_SECTIONS);
    expect(q.grid.sections.map((s) => s.label)).toEqual(['Intro', 'Bridge 1', 'Hook', 'Bridge 2', 'Outro']);
    expect(q.grid.sections.map((s) => s.kind)).toEqual(['intro', 'bridge', 'hook', 'bridge', 'outro']);
    const words = allWords(q.grid).map((w) => [w.global, w.word.tick, w.word.len, w.word.text]);
    expect(words).toEqual([
      [0, 144, 72, '走'], // 第 1 小节第 4 拍起，延音 2 格 + 下一段开头的延音 2 格 → 拖进第 2 小节
      [1, 48, 6, '在'],
      [1, 54, 6, '节'],
      [1, 72, 36, '拍'],
      [3, 180, 36, '口'], // 副歌最后一格，延音接到「桥段」第一小节开头
      [4, 96, 12, '桥'],
      [5, 0, 48, '完'],
    ]);
    expect(expectedWords(JSON.parse(V2_SECTIONS) as V2File).map((w) => w.text).join('')).toBe('走在节拍口桥完');
  });

  it('v1（旧界面 localStorage）也能读：经 v2 迁到 v3', () => {
    const legacy = JSON.stringify([
      { name: '老歌', createdAt: 5, updatedAt: 6, measures: [[{ text: '我', isAccented: true }, { text: '走在', isAccented: false }, { text: ' 街-', isAccented: true }, { text: '一二三四五', isAccented: false }]] },
    ]);
    const [q] = migrateLegacyStorage(legacy, { defaultBpm: 88 });
    expect(q).toMatchObject({ name: '老歌', createdAt: 5, updatedAt: 6, bpm: 88, offsetMs: 0 });
    expect(q.grid.sections[0].label).toBe('Verse 1');
    expect(q.grid.sections[0].bars[0].words.map((w) => [w.tick, w.len, w.text])).toEqual([
      [0, 48, '我'],
      [48, 24, '走'],
      [72, 24, '在'],
      [108, 36, '街'], // 「街-」：延音变成长度
      [144, 6, '一'],
      [150, 6, '二'],
      [156, 12, '三'],
      [168, 12, '四'],
      [180, 12, '五'],
    ]);
  });
});

describe('导出', () => {
  it('时间 = 偏移 + 绝对 tick × (60 / BPM / 48)；换 BPM 时 tick 不变，只重算秒数', () => {
    const p = demo();
    expect(timeOfTick(p, 264)).toBeCloseTo(0.25 + (264 * 60) / 90 / 48, 12);
    expect(timeOfTick({ ...p, bpm: 120 }, 264)).toBeCloseTo(0.25 + (264 * 60) / 120 / 48, 12);
    expect(formatLrcTime(3.9166666)).toBe('00:03.92');
    expect(formatLrcTime(75.004)).toBe('01:15.00');
  });

  it('LRC 行时间戳 / 逐字时间戳', () => {
    expect(exportLrc(demo())).toBe(['[ti:测试]', '[re:AnyBeats]', '[00:00.25]我来', '[00:03.92]了', '[00:05.92]嘿', ''].join('\n'));
    expect(exportLrc(demo(), { wordTimestamps: true }).split('\n')[2]).toBe('[00:00.25]<00:00.25>我<00:00.92>来');
  });

  it('txt：段落标题 + 每小节一行，跳过空小节', () => {
    expect(exportTxt(demo())).toBe(['[Verse 1]', '我来', '了', '', '[Hook]', '嘿', ''].join('\n'));
  });
});

describe('自动保存（含撤销历史）', () => {
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

  it('历史跟作品一起落盘；刷新（新实例）后能读回并接着撤销', () => {
    const store = new MemoryStore();
    const timers = new FakeTimers();
    const p = demo();
    const doc: Doc = p;
    const h = new History<Doc>(doc, { now: () => 1000 });
    const grid2: Grid = insertWord(doc.grid, TICKS_PER_BAR + 0, 12, '你');
    h.execute({ label: '填字 第 2 小节', kind: 'fill', apply: (d) => ({ ...d, grid: grid2 }) });
    const auto = createAutosave({ store, timers, key: 'p', historyKey: 'p.history' });
    auto.notify({ ...p, grid: grid2 }, () => serializeHistory(h, docCodec));
    auto.flush();
    const again = createAutosave({ store, timers, key: 'p', historyKey: 'p.history' });
    const restored = restoreHistory(again.restoreHistory()!, docCodec);
    expect(restored.canUndo).toBe(true);
    expect(restored.undoLabel).toBe('填字 第 2 小节');
    expect(restored.done[0]).toMatchObject({ kind: 'fill', at: 1000 });
    expect(allWords(restored.undo().grid).map((w) => w.word.text).join('')).toBe('我来了嘿');
    again.clear();
    expect(store.map.size).toBe(0);
  });

  it('flush 立即写；坏草稿 restore 返回 null 并报错', () => {
    const store = new MemoryStore();
    const timers = new FakeTimers();
    const errors: unknown[] = [];
    const auto = createAutosave({ store, timers, onError: (e) => errors.push(e) });
    auto.notify(demo());
    auto.flush();
    expect(timers.pendingCount).toBe(0);
    expect(auto.restore()?.name).toBe('测试');
    store.setItem('anybeats.autosave.v3', '{bad');
    expect(auto.restore()).toBeNull();
    expect(errors.length).toBe(1);
  });
});

describe('换伴奏的 BPM 二选一', () => {
  it('默认推荐「改用新 BPM」；保留原 BPM 时新伴奏变速；歌词 tick 不变，只重算秒数', () => {
    const plan = planBeatSwap(92, 100, 9 * TICKS_PER_BAR, 0);
    expect(RECOMMENDED_BEAT_SWAP).toBe('adopt');
    expect(plan.recommended).toBe('adopt');
    expect(plan.keep).toMatchObject({ bpm: 92, rate: 0.92 });
    expect(plan.adopt).toMatchObject({ bpm: 100, rate: 1 });
    expect(plan.adopt.songSeconds).toBeLessThan(plan.keep.songSeconds);
    const p = demo();
    const before = allWords(p.grid).map((w) => w.abs);
    const adopted = { ...p, bpm: plan.adopt.bpm };
    expect(allWords(adopted.grid).map((w) => w.abs)).toEqual(before);
    expect(timeOfTick(adopted, before[1])).toBeLessThan(timeOfTick(p, before[1]));
  });
});
