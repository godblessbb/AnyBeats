import { describe, expect, it } from 'vitest';
import {
  absoluteStep,
  clipAt,
  copyClips,
  createGrid,
  createSection,
  deleteBars,
  deleteClips,
  deleteSection,
  duplicateSection,
  findClip,
  GridError,
  insertBars,
  insertClip,
  insertSection,
  locateStep,
  moveBar,
  moveClip,
  moveSection,
  pasteClips,
  toggleAccent,
  totalSteps,
  updateClip,
  type Grid,
} from '../grid';
import { command, History } from '../history';

const texts = (g: Grid, s = 0, b = 0) => g.sections[s].bars[b].clips.map((c) => `${c.start}:${c.text}/${c.length}`);

function sample(): Grid {
  let g = createGrid([createSection('verse', 2), createSection('chorus', 2)]);
  g = insertClip(g, { section: 0, bar: 0 }, { start: 0, length: 2, text: '我' });
  g = insertClip(g, { section: 0, bar: 0 }, { start: 2, length: 1, text: '走' });
  g = insertClip(g, { section: 0, bar: 0 }, { start: 3, length: 1, text: '', hold: true });
  return g;
}

describe('grid 模型', () => {
  it('段落 → 小节 → 1/16：定位与绝对位置互逆', () => {
    const g = sample();
    expect(totalSteps(g)).toBe(64);
    expect(locateStep(g, 37)).toEqual({ section: 1, bar: 0, step: 5 });
    expect(absoluteStep(g, { section: 1, bar: 0, step: 5 })).toBe(37);
    expect(locateStep(g, 64)).toBeNull();
    expect(locateStep(g, -1)).toBeNull();
    expect(clipAt(g, { section: 0, bar: 0, step: 1 })?.text).toBe('我');
    expect(clipAt(g, { section: 0, bar: 0, step: 3 })?.hold).toBe(true);
    expect(clipAt(g, { section: 0, bar: 0, step: 4 })).toBeNull();
  });

  it('插入会覆盖重叠片段；起点/时长越界报错', () => {
    let g = sample();
    g = insertClip(g, { section: 0, bar: 0 }, { start: 1, length: 2, text: '跑' });
    expect(texts(g)).toEqual(['1:跑/2', '3:/1']);
    expect(() => insertClip(g, { section: 0, bar: 0 }, { start: 15, length: 2, text: 'x' })).toThrow(GridError);
    expect(() => insertClip(g, { section: 0, bar: 0 }, { start: 16, length: 1, text: 'x' })).toThrow(GridError);
    expect(() => insertClip(g, { section: 0, bar: 9 }, { start: 0, length: 1, text: 'x' })).toThrow(GridError);
  });

  it('不可变：操作返回新对象，原 grid 不变', () => {
    const g = sample();
    const snapshot = JSON.stringify(g);
    deleteClips(g, [g.sections[0].bars[0].clips[0].id]);
    expect(JSON.stringify(g)).toBe(snapshot);
  });

  it('移动片段可跨小节、跨段落', () => {
    const g = sample();
    const id = g.sections[0].bars[0].clips[0].id;
    const moved = moveClip(g, id, { section: 1, bar: 1, step: 14 });
    expect(texts(moved)).toEqual(['2:走/1', '3:/1']);
    expect(texts(moved, 1, 1)).toEqual(['14:我/2']);
    expect(() => moveClip(g, id, { section: 1, bar: 1, step: 15 })).toThrow(GridError); // 时长 2 放不下
  });

  it('更新与重音切换', () => {
    const g = sample();
    const id = g.sections[0].bars[0].clips[1].id;
    const accented = toggleAccent(g, id);
    expect(findClip(accented, id)?.clip.accent).toBe(true);
    expect(findClip(toggleAccent(accented, id), id)?.clip.accent).toBe(false);
    const longer = updateClip(g, id, { length: 3 });
    expect(texts(longer)).toEqual(['0:我/2', '2:走/3']); // 吃掉了后面的延音
  });

  it('复制粘贴：保持相对节奏，可跨小节，越出小节末尾截短', () => {
    const g = sample();
    const clip = copyClips(g, g.sections[0].bars[0].clips.map((c) => c.id));
    expect(clip.map((c) => c.offset)).toEqual([0, 2, 3]);
    const pasted = pasteClips(g, { section: 0, bar: 0, step: 14 }, clip);
    expect(texts(pasted).slice(-1)).toEqual(['14:我/2']);
    expect(texts(pasted, 0, 1)).toEqual(['0:走/1', '1:/1']);
    // 粘到全曲最后一格：越出全曲的部分丢掉
    const tail = pasteClips(g, { section: 1, bar: 1, step: 15 }, clip);
    expect(texts(tail, 1, 1)).toEqual(['15:我/1']);
  });

  it('小节 / 段落：插入、删除、移动、整段复制', () => {
    let g = sample();
    g = insertBars(g, 0, 0, 2);
    expect(g.sections[0].bars.length).toBe(4);
    expect(texts(g, 0, 2)).toEqual(['0:我/2', '2:走/1', '3:/1']);
    g = moveBar(g, { section: 0, bar: 2 }, { section: 1, bar: 0 });
    expect(texts(g, 1, 0)).toEqual(['0:我/2', '2:走/1', '3:/1']);
    g = deleteBars(g, 0, 0, 3);
    expect(g.sections[0].bars.length).toBe(0);
    g = duplicateSection(g, 1);
    expect(g.sections.map((s) => s.kind)).toEqual(['verse', 'chorus', 'chorus']);
    expect(texts(g, 2, 0)).toEqual(texts(g, 1, 0));
    expect(g.sections[2].bars[0].clips[0].id).not.toBe(g.sections[1].bars[0].clips[0].id);
    g = moveSection(g, 0, 2);
    expect(g.sections.map((s) => s.kind)).toEqual(['chorus', 'chorus', 'verse']);
    g = insertSection(g, 0, createSection('hook', 1));
    g = deleteSection(g, 3);
    expect(g.sections.map((s) => s.label)).toEqual(['Hook', '副歌', '副歌']);
  });
});

describe('撤销 / 重做命令栈', () => {
  it('执行、撤销、重做；新命令清空重做栈', () => {
    const h = new History(sample());
    const id = h.state.sections[0].bars[0].clips[0].id;
    h.execute(command('重音', (g) => toggleAccent(g, id)));
    h.execute(command('移动', (g) => moveClip(g, id, { section: 0, bar: 1, step: 0 })));
    expect(findClip(h.state, id)).toMatchObject({ bar: 1, clip: { accent: true } });
    expect(h.undoLabel).toBe('移动');

    h.undo();
    expect(findClip(h.state, id)).toMatchObject({ bar: 0, clip: { accent: true } });
    h.undo();
    expect(findClip(h.state, id)?.clip.accent).toBe(false);
    expect(h.canUndo).toBe(false);
    h.undo(); // 空栈无事发生

    h.redo();
    expect(findClip(h.state, id)?.clip.accent).toBe(true);
    expect(h.redoLabel).toBe('移动');
    h.execute(command('删除', (g) => deleteClips(g, [id])));
    expect(h.canRedo).toBe(false);
    expect(findClip(h.state, id)).toBeNull();
    h.undo();
    expect(findClip(h.state, id)).not.toBeNull();
  });

  it('命令抛错时状态和栈都不变；无变化的命令不入栈；容量上限', () => {
    const h = new History(sample(), 3);
    const before = h.state;
    expect(() => h.execute(command('坏', () => { throw new GridError('x'); }))).toThrow(GridError);
    expect(h.state).toBe(before);
    h.execute(command('空', (g) => g));
    expect(h.canUndo).toBe(false);
    for (let i = 0; i < 5; i++) h.execute(command(`加${i}`, (g) => insertBars(g, 0, 0)));
    let undos = 0;
    while (h.canUndo) {
      h.undo();
      undos++;
    }
    expect(undos).toBe(3);
  });
});
