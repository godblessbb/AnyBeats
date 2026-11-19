/**
 * v3.4 段 1：编辑器里的判押韵档（DESIGN_v34 §4.7）。
 * 旧作品打开仍是严格 + 横幅；「改用十三辙」= 一步（改档 + 合并），撤销一次逐字节回到原样；「先不改」写下 strict、以后不再问；
 * 新建作品 / 示例 / 第一次打开的夜车默认十三辙。
 */
import { describe, expect, it } from 'vitest';
import v4Raw from '../../../design/fixtures_v34/koi_zh_lyrics_v4_nopickup.anybeats?raw';
import { serializeProject } from '../../core';
import { FakeTimers, MemoryStore } from '../../core/__tests__/fakeTime';
import { V2_NIGHT_DRIVE } from '../../core/__tests__/fixtures/v2project';
import { ProjectLibrary } from '../../storage/library';
import { WebStorage, type StorageAdapter } from '../../storage/StorageAdapter';
import { EditorStore } from '../editorStore';

function setup(storage: StorageAdapter = new WebStorage(new MemoryStore() as unknown as Storage)) {
  const timers = new FakeTimers();
  const library = new ProjectLibrary(storage, () => 1000);
  const store = new EditorStore({ storage, library, timers, now: () => 1000 });
  return { storage, timers, library, store };
}

const hues = (store: EditorStore) => {
  const hue = new Map(store.doc.rules.map((r) => [r.id, r.hue]));
  return Object.fromEntries(Object.entries(store.doc.paint).map(([k, v]) => [k, hue.get(v)]));
};

describe('新作品默认十三辙', () => {
  it('第一次打开的夜车、新建作品、两个示例都是 thirteen，不出横幅', () => {
    const { store } = setup();
    expect(store.doc.rhymeMatch).toBe('thirteen');
    expect(store.needsRhymeMigration()).toBe(false);
    store.newProject();
    expect(store.doc.rhymeMatch).toBe('thirteen');
    expect(JSON.parse(serializeProject(store.project)).rhymeMatch).toBe('thirteen');
    store.openExample('street');
    expect(store.rhymeMatch).toBe('thirteen');
    store.openExample('night');
    expect(store.rhymeMatch).toBe('thirteen');
  });

  it('新建作品写「边 / 完 / 半」当韵脚（规则 an）不报不押；切严格后报 2 处', () => {
    const { store } = setup();
    store.newProject();
    store.addRule();
    const rule = store.getState().activeRule!;
    store.setRuleFinal(rule, 0, 'an');
    for (const [i, ch] of ['边', '完', '半'].entries()) {
      store.clickCell(i, 3);
      store.paintSelection();
      store.commitText(i * 192 + 144, ch);
    }
    expect(Object.keys(store.doc.paint)).toHaveLength(3);
    expect(store.mismatchCount()).toBe(0);
    store.setRhymeMatch('strict');
    expect(store.mismatchCount()).toBe(2);
  });

  it('v2 迁移来的作品、导入没有字段的 v3 文件：不写 rhymeMatch（= 严格）', () => {
    const { store } = setup();
    store.importProjectFile(V2_NIGHT_DRIVE);
    expect(store.doc.rhymeMatch).toBeUndefined();
    expect(store.rhymeMatch).toBe('strict');
  });
});

describe('旧作品（v4 样例）：横幅 → 改用十三辙 / 先不改', () => {
  it('打开仍是严格：横幅数字 = 0 → 0 处不押、15 条规则合并成 6 种颜色、0 格变色；打开不改文档', () => {
    const { store } = setup();
    expect(store.importProjectFile(v4Raw)).toBe(true);
    expect(store.rhymeMatch).toBe('strict');
    expect(store.needsRhymeMigration()).toBe(true);
    expect(store.getState().history.canUndo).toBe(false);
    const p = store.rhymeMatchPreview();
    expect([p.missBefore, p.missAfter, p.rulesBefore, p.rulesAfter, p.recolorCells]).toEqual([0, 0, 15, 6, 0]);
  });

  it('改用十三辙 = 历史里一步：6 种颜色、117 格颜色不变、0 处不押；撤销一次逐字节回到原样，重做再回来', () => {
    const { store } = setup();
    store.importProjectFile(v4Raw);
    const before = serializeProject(store.project);
    const hueBefore = hues(store);
    const depth = store.getState().history.done.length;
    expect(store.setRhymeMatch('thirteen')).toBe(true);
    expect(store.getState().history.done.length).toBe(depth + 1);
    expect(store.getState().history.undoLabel).toContain('判押韵 改成十三辙');
    expect(store.doc.rules).toHaveLength(6);
    expect(store.doc.rhymeMatch).toBe('thirteen');
    expect(hues(store)).toEqual(hueBefore);
    expect(Object.keys(store.doc.paint)).toHaveLength(117);
    expect(store.mismatchCount()).toBe(0);
    expect(store.needsRhymeMigration()).toBe(false);
    expect(store.getState().notice?.text).toContain('15 条规则合并成 6 种颜色');
    const after = serializeProject(store.project);

    store.undo();
    expect(serializeProject(store.project)).toBe(before);
    expect(store.doc.rules).toHaveLength(15);
    expect(store.needsRhymeMigration()).toBe(true);
    store.redo();
    expect(serializeProject(store.project)).toBe(after);
  });

  it('切回严格不拆颜色（规则里的韵母按写的样子留着），也是一步', () => {
    const { store } = setup();
    store.importProjectFile(v4Raw);
    store.setRhymeMatch('thirteen');
    const depth = store.getState().history.done.length;
    store.setRhymeMatch('strict');
    expect(store.getState().history.done.length).toBe(depth + 1);
    expect(store.doc.rules.map((r) => r.finals[0])).toEqual(['ian', 'ing', 'iao', 'ang', 'ei', 'i']);
    expect(store.mismatchCount()).toBeGreaterThan(0); // 蓝色 = ian 管着 an / uan 的格子
    expect(store.setRhymeMatch('strict')).toBe(false); // 同一档不记一步
  });

  it('先不改 = 写下 strict（一步），以后不再问：刷新后照样不出横幅，文件里有 rhymeMatch: strict', () => {
    const storage = new WebStorage(new MemoryStore() as unknown as Storage);
    const { store } = setup(storage);
    store.importProjectFile(v4Raw);
    const depth = store.getState().history.done.length;
    expect(store.dismissRhymeMigration()).toBe(true);
    expect(store.getState().history.done.length).toBe(depth + 1);
    expect(store.doc.rhymeMatch).toBe('strict');
    expect(store.doc.rules).toHaveLength(15);
    expect(store.needsRhymeMigration()).toBe(false);
    expect(store.dismissRhymeMigration()).toBe(false);
    store.flush();
    const again = setup(storage).store;
    expect(again.doc.rhymeMatch).toBe('strict');
    expect(again.needsRhymeMigration()).toBe(false);
    expect(JSON.parse(serializeProject(again.project)).rhymeMatch).toBe('strict');
  });

  it('十三辙下改韵母触发同辙合并，提示写「都是言前辙」、变色的格数', () => {
    const { store } = setup();
    store.newProject();
    store.addRule();
    const blue = store.getState().activeRule!;
    store.setRuleFinal(blue, 0, 'an');
    store.clickCell(0, 3);
    store.paintSelection();
    store.commitText(144, '半');
    store.addRule();
    const green = store.getState().activeRule!;
    store.clickCell(1, 3);
    store.paintSelection();
    store.commitText(192 + 144, '边');
    const depth = store.getState().history.done.length;
    store.setRuleFinal(green, 0, 'ian');
    expect(store.getState().history.done.length).toBe(depth + 1);
    expect(store.doc.rules.map((r) => r.id)).toEqual([blue]);
    const text = store.getState().notice!.text;
    expect(text).toContain('都是言前辙');
    expect(text).toContain('1 格从绿色变蓝色');
  });
});
