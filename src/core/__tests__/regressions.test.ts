/**
 * 5 个老问题的回归测试。每条都有两部分：
 *   「旧逻辑」——legacy.ts 里逐字复刻的旧写法，断言问题确实存在（复现依据）；
 *   「新核心」——同样的场景走 src/core，断言问题不再出现。把新核心改回旧写法时这一半会变红
 *   （变异反证记录在 .alphie_cloud/REPORT.md）。
 */
import { describe, expect, it } from 'vitest';
import { createAutosave } from '../autosave';
import { estimateBpm } from '../bpm';
import { initialGestureState, reduceGesture, type GestureEvent, type GestureState } from '../cellGesture';
import { Clock } from '../clock';
import { createGrid, createSection, findClip, insertClip, toggleAccent, type Grid } from '../grid';
import { importAiLyrics } from '../importAi';
import { playheadAt } from '../playhead';
import { createProject } from '../project';
import { FakeTime, FakeTimers, MemoryStore } from './fakeTime';
import { BACKBEAT, BACKBEAT_WITH_BASS, renderDrums } from './fixtures/drums';
import {
  legacyAppPlayback43c3370,
  legacyAutosave43c3370,
  legacyCellGesture43c3370,
  legacyDetectBPM43c3370,
  legacyGetCurrentPosition43c3370,
  legacyHighlight71565d9,
  legacyImportLyrics43c3370,
  legacyMetronomeBeats71565d9,
} from './legacy';

/** AILyricsGenerator.useExampleData 的第一小节（原样） */
const EXAMPLE_BAR = [
  { text: '我', startBeat: 0, duration: 4 },
  { text: '走', startBeat: 4, duration: 4 },
  { text: '在', startBeat: 8, duration: 4 },
  { text: '街', startBeat: 12, duration: 4 },
  { text: '上', startBeat: 16, duration: 8 },
  { text: '感', startBeat: 24, duration: 4 },
  { text: '受', startBeat: 28, duration: 4 },
  { text: '节', startBeat: 32, duration: 4 },
  { text: '奏', startBeat: 36, duration: 12 },
];

describe('回归 #1 播放高亮跟着时钟走，停止后复位', () => {
  it('旧逻辑（71565d9）：节拍器传 0–3，歌词区除以 4/16，高亮永远停在第 1 小节第 1 格', () => {
    const cells = new Set(legacyMetronomeBeats71565d9(32).map((b) => JSON.stringify(legacyHighlight71565d9(b, 16))));
    expect([...cells]).toEqual([JSON.stringify({ measureIndex: 0, cellIndex: 0 })]);
  });

  it('旧逻辑（43c3370 仍在）：停止后 App 的 isPlaying 仍为 true，高亮停在最后一拍', () => {
    const app = legacyAppPlayback43c3370();
    for (let beat = 1; beat <= 6; beat++) app.onBeatChange(beat);
    app.onMetronomeStop();
    expect(app.state.isPlaying).toBe(true);
    expect(legacyGetCurrentPosition43c3370(app.state.currentBeat, app.state.isPlaying, 16)).toEqual({ measureIndex: 1, cellIndex: 1 });
  });

  it('新核心：高亮逐个 1/16 前进、跨拍跨小节；停止后 playhead 为 null', () => {
    const grid = createGrid([createSection('verse', 2)]);
    const time = new FakeTime();
    const clock = new Clock({ time, bpm: 90, startDelay: 0 });
    clock.play();
    const dur = clock.stepSeconds;
    const visited: string[] = [];
    for (let i = 0; i < 32; i++) {
      time.t = (i + 0.5) * dur; // 每格中间采一次样
      const p = playheadAt(grid, clock.position());
      visited.push(`${p?.bar}.${p?.beat}.${p?.step}`);
    }
    const expected = Array.from({ length: 32 }, (_, i) => `${Math.floor(i / 16)}.${Math.floor((i % 16) / 4)}.${i % 16}`);
    expect(visited).toEqual(expected);
    clock.stop();
    expect(playheadAt(grid, clock.position())).toBeNull();
  });
});

describe('回归 #2 双击标重音', () => {
  it('旧逻辑（43c3370 仍在）：click → click → dblclick 后重音没变', () => {
    const g = legacyCellGesture43c3370();
    g.click();
    g.click();
    g.dblclick();
    expect(g.cell.isAccented).toBe(false);
  });

  it('新核心：同样的事件序列切换重音，并退出这次手势打开的编辑框', () => {
    let grid: Grid = insertClip(createGrid(), { section: 0, bar: 0 }, { start: 0, length: 4, text: '我' });
    const id = grid.sections[0].bars[0].clips[0].id;
    let state: GestureState = initialGestureState;
    const target = { id, hasText: true };
    const events: GestureEvent[] = [{ type: 'click', target }, { type: 'click', target }, { type: 'dblclick', target }];
    for (const e of events) {
      const r = reduceGesture(state, e);
      state = r.state;
      for (const fx of r.effects) grid = toggleAccent(grid, fx.id);
    }
    expect(findClip(grid, id)?.clip.accent).toBe(true);
    expect(state).toEqual({ selected: id, editing: null });
    // 空格子双击不产生重音
    expect(reduceGesture(state, { type: 'dblclick', target: { id: 'x', hasText: false } }).effects).toEqual([]);
  });
});

describe('回归 #3 AI 歌词导入保留 1/16 节奏', () => {
  it('旧逻辑（43c3370 仍在）：按整拍塞格子，「我走在街」挤进第 1 拍', () => {
    const cells = legacyImportLyrics43c3370({ measures: [{ measureIndex: 0, lyrics: EXAMPLE_BAR }] });
    expect(cells[0]).toEqual(['我走在街', '上感受', '节奏', '']);
  });

  it('新核心：每个字落在自己的 1/16 格上，时长不丢', () => {
    const r = importAiLyrics({ bpm: 90, timeSignature: '4/4', measures: [{ measureIndex: 0, lyrics: EXAMPLE_BAR }] });
    const clips = r.bars[0].clips.map((c) => [c.text, c.start, c.length]);
    expect(clips).toEqual([
      ['我', 0, 1],
      ['走', 1, 1],
      ['在', 2, 1],
      ['街', 3, 1],
      ['上', 4, 2],
      ['感', 6, 1],
      ['受', 7, 1],
      ['节', 8, 1],
      ['奏', 9, 3],
    ]);
    expect(r.warnings).toEqual([]);
  });
});

describe('回归 #4 刷新不丢数据', () => {
  it('旧逻辑（43c3370）：没起名的作品从不自动保存；起了名也会丢最近 60 秒', () => {
    const store = new Map<string, string>();
    const legacy = legacyAutosave43c3370(store);
    legacy.edit([[{ text: '我', isAccented: false }]]);
    legacy.advance(10 * 60 * 1000);
    expect(store.size).toBe(0); // 刷新 → 全丢
    legacy.name('新歌');
    legacy.edit([[{ text: '我们', isAccented: false }]]);
    legacy.advance(30 * 1000);
    expect(store.size).toBe(0); // 30 秒后刷新 → 仍然全丢
  });

  it('新核心：不论有没有名字，改动 1 秒内落盘；页面关闭时 flush 立即落盘；刷新后能恢复', () => {
    const store = new MemoryStore();
    const timers = new FakeTimers();
    let grid = createGrid();
    grid = insertClip(grid, { section: 0, bar: 0 }, { start: 0, length: 4, text: '我' });
    const project = createProject({ grid, bpm: 87, offsetMs: 120 });

    const session1 = createAutosave({ store, timers, debounceMs: 1000 });
    session1.notify(project);
    timers.advance(1000);
    const session2 = createAutosave({ store, timers }); // 刷新 = 新实例 + 同一个 localStorage
    expect(session2.restore()).toEqual(project);

    const edited = { ...project, bpm: 88 };
    session2.notify(edited);
    session2.flush(); // pagehide
    expect(createAutosave({ store, timers }).restore()).toEqual(edited);
  });
});

describe('回归 #5 BPM 检测', () => {
  it('旧逻辑（43c3370 仍在）：干净的 120 能测对，90 + 持续低音测错', () => {
    const clean = renderDrums({ bpm: 120, seconds: 20, bar: BACKBEAT, seed: 1 });
    expect(legacyDetectBPM43c3370(clean.samples, clean.sampleRate)).toBe(120);
    const withBass = renderDrums({ bpm: 90, seconds: 20, bar: BACKBEAT_WITH_BASS, seed: 1 });
    expect(Math.abs(legacyDetectBPM43c3370(withBass.samples, withBass.sampleRate) - 90)).toBeGreaterThan(20);
  });

  it('新核心：90 + 持续低音误差 ≤ 1 BPM', () => {
    const withBass = renderDrums({ bpm: 90, seconds: 20, bar: BACKBEAT_WITH_BASS, seed: 1 });
    expect(Math.abs(estimateBpm(withBass.samples, withBass.sampleRate).bpm - 90)).toBeLessThanOrEqual(1);
  });
});
