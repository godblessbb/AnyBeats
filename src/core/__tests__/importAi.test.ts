import { describe, expect, it } from 'vitest';
import { importAiLyrics } from '../importAi';

const layout = (r: ReturnType<typeof importAiLyrics>, bar = 0) => r.bars[bar].words.map((w) => [w.text, w.tick, w.len]);

describe('importAi', () => {
  it('64 单位/小节 → 192 tick（1 单位 = 3 tick），逐字保留起点与时长；「-」把前一个字拖长', () => {
    const r = importAiLyrics({
      bpm: 92,
      measures: [{ measureIndex: 1, lyrics: [{ text: '冲', startBeat: 8, duration: 8 }, { text: '-', startBeat: 16, duration: 8 }] }],
    });
    expect(r.bars.length).toBe(2);
    expect(r.bars[0].words).toEqual([]);
    expect(layout(r, 1)).toEqual([['冲', 24, 48]]);
    expect(r.bpm).toBe(92);
    expect(r.warnings).toEqual([]);
  });

  it('多字条目在时长够分时拆成每字一个；三连 / 1/32 这类细分也能原样保留', () => {
    const r = importAiLyrics({ measures: [{ measureIndex: 0, lyrics: [{ text: '街上', startBeat: 0, duration: 8 }, { text: '我', startBeat: 16, duration: 2 }, { text: '们', startBeat: 18, duration: 2 }] }] });
    expect(layout(r)).toEqual([['街', 0, 12], ['上', 12, 12], ['我', 48, 6], ['们', 54, 6]]);
    expect(r.warnings).toEqual([]);
  });

  it('不在 tick 上的时值就近对齐并给出警告；重叠顺延；越过小节线截断', () => {
    const r = importAiLyrics(
      {
        timeSignature: '3/4',
        measures: [
          {
            measureIndex: 0,
            lyrics: [
              { text: '一', startBeat: 0, duration: 6.1 },
              { text: '二', startBeat: 4, duration: 4 },
              { text: '三', startBeat: 56, duration: 16 },
            ],
          },
        ],
      },
    );
    expect(layout(r)).toEqual([['一', 0, 18], ['二', 18, 6], ['三', 168, 24]]);
    expect(r.warnings.join('\n')).toMatch(/3\/4/);
    expect(r.warnings.join('\n')).toMatch(/就近对齐/);
    expect(r.warnings.join('\n')).toMatch(/顺延/);
    expect(r.warnings.join('\n')).toMatch(/截到小节末/);
  });

  it('可指定 AI 单位（例如以后提示词改成 16 单位/小节）', () => {
    const r = importAiLyrics({ measures: [{ measureIndex: 0, lyrics: [{ text: '快', startBeat: 3, duration: 1 }] }] }, { unitsPerBar: 16, sectionKind: 'hook' });
    expect(layout(r)).toEqual([['快', 36, 12]]);
    expect(r.grid.sections[0].kind).toBe('hook');
  });
});
