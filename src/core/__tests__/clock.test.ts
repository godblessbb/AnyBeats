import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachBacking, attachMetronome, Clock, createTimeoutWaker, stepDuration, type StepEvent, type TransportEvent } from '../clock';
import { FakeTime } from './fakeTime';

function run(clock: Clock, time: FakeTime, until: number, wakeEvery: () => number) {
  while (time.now() < until) {
    time.advance(wakeEvery());
    clock.tick();
  }
}

function collect(clock: Clock, time: FakeTime) {
  const steps: (StepEvent & { scheduledAt: number })[] = [];
  const transport: TransportEvent[] = [];
  clock.onStep((e) => steps.push({ ...e, scheduledAt: time.now() }));
  clock.onTransport((e) => transport.push(e));
  return { steps, transport };
}

describe('Clock 前瞻调度', () => {
  it('120 BPM 下每个 1/16 的发声时刻 = 起点 + n × 0.125s，并且提前排好、不超过前瞻窗口', () => {
    const time = new FakeTime();
    const clock = new Clock({ time, bpm: 120, lookahead: 0.1, startDelay: 0.05 });
    const { steps } = collect(clock, time);
    clock.play();
    run(clock, time, 1.0, () => 0.02);

    expect(stepDuration(120)).toBe(0.125);
    expect(steps.map((s) => s.step)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    steps.forEach((s, i) => {
      expect(s.time).toBeCloseTo(0.05 + i * 0.125, 12);
      expect(s.scheduledAt).toBeLessThanOrEqual(s.time);
      expect(s.time - s.scheduledAt).toBeLessThanOrEqual(0.1 + 1e-12);
    });
  });

  it('唤醒间隔不规则（1–40ms 抖动）也不影响发声时刻——计时不靠唤醒器', () => {
    const times = (wake: () => number) => {
      const time = new FakeTime();
      const clock = new Clock({ time, bpm: 93, lookahead: 0.1 });
      const { steps } = collect(clock, time);
      clock.play();
      run(clock, time, 3, wake);
      return steps.map((s) => s.time);
    };
    let seed = 1;
    const jitter = () => {
      seed = (seed * 16807) % 2147483647;
      return 0.001 + (seed / 2147483647) * 0.039;
    };
    const regular = times(() => 0.025);
    const jittery = times(jitter);
    const n = Math.min(regular.length, jittery.length);
    expect(n).toBeGreaterThan(15);
    for (let i = 0; i < n; i++) expect(jittery[i]).toBeCloseTo(regular[i], 12);
  });

  it('第一拍偏移：歌曲时间 = 偏移 + 位置 × 步长，伴奏从对应位置起播', () => {
    const time = new FakeTime();
    time.t = 10;
    const clock = new Clock({ time, bpm: 90, offsetMs: 250, startDelay: 0.05 });
    const starts: [number, number][] = [];
    attachBacking(clock, { startAt: (t, s) => starts.push([t, s]), stopAt: () => {} });
    const { steps } = collect(clock, time);
    clock.play(16); // 从第 2 小节开始
    expect(starts).toEqual([[10.05, 0.25 + 16 * stepDuration(90)]]);
    expect(steps[0].step).toBe(16);
    expect(steps[0].songTime).toBeCloseTo(0.25 + 16 * (60 / 90 / 4), 12);
    expect(clock.songTimeOfStep(0)).toBe(0.25);
    expect(clock.stepOfSongTime(0.25 + 4 * (60 / 90 / 4))).toBeCloseTo(4, 12);
  });

  it('循环区间：到 end 折回 start，并在折回的精确时刻通知伴奏重起', () => {
    const time = new FakeTime();
    const clock = new Clock({ time, bpm: 120, loop: { start: 4, end: 8 }, startDelay: 0 });
    const backing: string[] = [];
    attachBacking(clock, {
      startAt: (t, s) => backing.push(`start@${t.toFixed(3)} from ${s.toFixed(3)}`),
      stopAt: (t) => backing.push(`stop@${t.toFixed(3)}`),
    });
    const { steps, transport } = collect(clock, time);
    clock.play(2);
    run(clock, time, 1.5, () => 0.03);

    expect(steps.slice(0, 12).map((s) => s.step)).toEqual([2, 3, 4, 5, 6, 7, 4, 5, 6, 7, 4, 5]);
    const jumps = transport.filter((e) => e.type === 'jump');
    expect(jumps[0]).toMatchObject({ step: 4, songTime: 0.5 });
    expect(jumps[0].time).toBeCloseTo(6 * 0.125, 12);
    expect(jumps[1].time).toBeCloseTo(10 * 0.125, 12);
    expect(backing.slice(0, 3)).toEqual(['start@0.000 from 0.250', 'stop@0.750', 'start@0.750 from 0.500']);
  });

  it('position() 按注入时间给出带小数的 1/16 位置，循环内折回', () => {
    const time = new FakeTime();
    const clock = new Clock({ time, bpm: 120, startDelay: 0, loop: { start: 0, end: 16 } });
    expect(clock.position()).toBeNull();
    clock.play();
    time.t = 0.3125; // 2.5 格
    expect(clock.position()).toBeCloseTo(2.5, 12);
    time.t = 2.0 + 0.125 * 3; // 一小节 2s 后又过 3 格
    expect(clock.position()).toBeCloseTo(3, 12);
  });

  it('播放中改 BPM：已排的格子不动，之后的格子按新步长接上', () => {
    const time = new FakeTime();
    const clock = new Clock({ time, bpm: 120, lookahead: 0.1, startDelay: 0 });
    const { steps, transport } = collect(clock, time);
    clock.play();
    run(clock, time, 0.3, () => 0.01);
    const before = steps.length;
    const lastOld = steps[before - 1];
    clock.setBpm(60);
    run(clock, time, 1.5, () => 0.01);
    const next = steps[before];
    expect(next.step).toBe(lastOld.step + 1);
    expect(next.time).toBeCloseTo(lastOld.time + 0.125, 12);
    expect(steps[before + 1].time - next.time).toBeCloseTo(0.25, 12);
    expect(transport.some((e) => e.type === 'retime')).toBe(true);
  });

  it('停止即复位：position 为 null、不再出格子、节拍器取消已排的声；再播从头开始', () => {
    const time = new FakeTime();
    const clock = new Clock({ time, bpm: 100, startDelay: 0 });
    const cancel = vi.fn();
    const clicks: number[] = [];
    attachMetronome(clock, { click: (t) => clicks.push(t), cancel });
    const { steps } = collect(clock, time);
    clock.play();
    run(clock, time, 1, () => 0.02);
    clock.stop();
    const count = steps.length;
    run(clock, time, 2, () => 0.02);
    expect(clock.state).toBe('stopped');
    expect(clock.position()).toBeNull();
    expect(steps.length).toBe(count);
    expect(cancel).toHaveBeenCalledTimes(1);
    clock.play();
    expect(steps[count].step).toBe(0);
  });

  it('节拍器：每 4 个 1/16 一声，小节第一拍重音，时刻精确', () => {
    const time = new FakeTime();
    const clock = new Clock({ time, bpm: 90, startDelay: 0.05 });
    const clicks: { t: number; accent: boolean }[] = [];
    attachMetronome(clock, { click: (t, accent) => clicks.push({ t, accent }) });
    clock.play();
    run(clock, time, 6, () => 0.025);
    const beat = 60 / 90;
    expect(clicks.length).toBeGreaterThanOrEqual(8);
    clicks.slice(0, 8).forEach((c, i) => {
      expect(c.t).toBeCloseTo(0.05 + i * beat, 12);
      expect(c.accent).toBe(i % 4 === 0);
    });
  });

  it('参数检查', () => {
    const time = new FakeTime();
    expect(() => new Clock({ time, bpm: 0 })).toThrow(RangeError);
    expect(() => new Clock({ time, bpm: 90, loop: { start: 8, end: 8 } })).toThrow(RangeError);
  });

  describe('默认唤醒器', () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('用 setTimeout 链唤醒，从不调用 setInterval；停止后不再唤醒', () => {
      vi.useFakeTimers();
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      const time = new FakeTime();
      const clock = new Clock({ time, bpm: 120, waker: createTimeoutWaker(25) });
      const { steps } = collect(clock, time);
      clock.play();
      for (let i = 0; i < 40; i++) {
        time.advance(0.025);
        vi.advanceTimersByTime(25);
      }
      expect(steps.length).toBeGreaterThan(7);
      clock.stop();
      const n = steps.length;
      time.advance(1);
      vi.advanceTimersByTime(1000);
      expect(steps.length).toBe(n);
      expect(setIntervalSpy).not.toHaveBeenCalled();
    });
  });
});
