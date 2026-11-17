"""AnyBeats v3.2 视觉稿自动检查（浏览器实测，不 grep 源码）。

用法：python -I design/check_mockups_v32.py design [证据目录]

对 design/mockups_v32/ 的 7 个画面 × 桌面 1280×800 / 手机 390×844 × 浅 / 深色：
截图到 design/screenshots_v32/<画面>_<desktop|mobile>_<light|dark>.png（给了证据目录就再拷一份到 <证据目录>/screenshots_v32/），
再在浏览器里量算断言。

通用：
  - 无控制台错误 / 页面异常；无外网请求；页面不左右溢出（scrollWidth ≤ 视口宽）
  - 第 1 步是当前步骤；看得见「清空全部 flow…」按钮或它的就地确认
  - 方格（data-role=square）：都在自己那一格里（不越过格线）；左边 = 格左 + tick/48 × 格宽 + 2px（±1.5px）；
    有可见边线（≥1px，颜色和格子底色明显不同）；空方格的底色和格子底色明显不同（看得出「这里有一个字」）
  - 空音（data-role=rest）：没有光标时完全不画（没有边线、没有底色）—— 和方格一眼分开
  - 写了字的方格：字形在方格里，字号 ≥ 11px
画面专属：
  default  每一格正好一个空方格，占满一拍（box 48）；没有空音；引导提示看得见
  edit     第 3 小节第 3 拍：一个 1/4 方格，光标在上面（强调色边），里面是「把」；按键气泡在视口里，有 一分二 / 三连 / 空音 / 合并 四个按钮
  split8   第 4 小节第 1 拍：两个 24 tick 方格，「我」在左边，光标在左边
  split16  第 4 小节第 1 拍：12 / 6 / 6 / 24，「我」在第一个；光标在 tick 12 那个 1/32；提示写着 1/32；「一分二」按钮不可点
  triplet  第 5 小节第 2 拍：三个 16 tick 方格 + 一个「3」标记；第 2 小节第 4 拍：24 + 8 + 8 + 8，后半拍有「3」
  rest     第 6 小节第 3 拍：一个 24 tick 方格 + tick 24 的空音（光标在空音上：强调色虚线，没有底色）；提示写着「只记一步」
  clear    就地确认看得见、在视口里，有「清空」「取消」两个按钮，「清空」按钮的字和底色对比 ≥ 3
任何一项不满足，退出码 1。只用标准库 + playwright（sync API）。
"""

import pathlib
import shutil
import sys

from playwright.sync_api import sync_playwright

SIZES = {"desktop": (1280, 800), "mobile": (390, 844)}
SCHEMES = ("light", "dark")
SCREENS = ("default", "edit", "split8", "split16", "triplet", "rest", "clear")

PROBE_JS = r"""
(screen) => {
  const fails = [];
  const fail = (m) => fails.push(m);
  const parse = (s) => {
    const c = s && s.match(/color\(srgb ([^)]+)\)/);
    if (c) {
      const p = c[1].split(/[ \/]+/).filter(Boolean).map(Number);
      return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1];
    }
    const m = s && s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // 一层层往上找第一个不透明底色（半透明的按比例混进去）
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c[3] > 0) { stack.push(c); if (c[3] >= 1) break; }
    }
    let out = [255, 255, 255];
    for (let i = stack.length - 1; i >= 0; i--) {
      const c = stack[i];
      out = [0, 1, 2].map((k) => c[k] * c[3] + out[k] * (1 - c[3]));
    }
    return out;
  };
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
  const inView = (el, name) => {
    const r = el.getBoundingClientRect();
    if (r.left < -0.5 || r.right > innerWidth + 0.5 || r.top < -0.5 || r.bottom > innerHeight + 0.5) fail(`${name} 不在视口里 (${r.left.toFixed(0)},${r.top.toFixed(0)},${r.right.toFixed(0)},${r.bottom.toFixed(0)})`);
  };

  if (document.documentElement.scrollWidth > innerWidth + 1) fail(`页面左右溢出：scrollWidth ${document.documentElement.scrollWidth} > ${innerWidth}`);
  const step = document.querySelector('[data-role="steps"] button.on');
  if (!step || step.dataset.step !== '1') fail('当前步骤不是「① 铺 flow」');
  const clearBtn = [...document.querySelectorAll('[data-role="clear-flow"], [data-role="clear-flow-confirm"]')].filter(vis);
  if (!clearBtn.length) fail('看不到「清空全部 flow…」按钮');

  const cellOf = (bar, beat) => document.querySelector(`[data-role="cell"][data-bar="${bar}"][data-beat="${beat}"]`);
  const squaresIn = (cell) => [...cell.querySelectorAll('[data-role="square"]')].sort((a, b) => a.dataset.tick - b.dataset.tick);
  const restsIn = (cell) => [...cell.querySelectorAll('[data-role="rest"]')];

  for (const cell of document.querySelectorAll('[data-role="cell"]')) {
    if (!vis(cell)) continue;
    const cr = cell.getBoundingClientRect();
    const cellBg = bgOf(cell);
    const name = `第 ${cell.dataset.bar} 小节第 ${Number(cell.dataset.beat) + 1} 拍`;
    for (const sq of squaresIn(cell)) {
      const r = sq.getBoundingClientRect();
      const cs = getComputedStyle(sq);
      const t = Number(sq.dataset.tick);
      if (r.left < cr.left - 0.5 || r.right > cr.right + 0.5) fail(`${name} tick ${t} 的方格越过格线`);
      const want = cr.left + cell.clientLeft + (t / 48) * cell.clientWidth + 2;
      if (Math.abs(r.left - want) > 1.5) fail(`${name} tick ${t} 的方格左边 ${r.left.toFixed(1)} ≠ ${want.toFixed(1)}`);
      const bw = parseFloat(cs.borderTopWidth);
      const bc = parse(cs.borderTopColor);
      if (!(bw >= 1) || !bc || contrast(bc, cellBg) < 1.6) fail(`${name} tick ${t} 的方格没有看得见的边线`);
      if (sq.dataset.square === 'empty' && contrast(bgOf(sq), cellBg) < 1.08) fail(`${name} tick ${t} 的空方格底色和格子一样，看不出占位`);
      const ch = sq.querySelector('.ch');
      if (ch) {
        const fs = parseFloat(getComputedStyle(ch).fontSize);
        if (fs < 11) fail(`${name}「${ch.textContent}」字号 ${fs} < 11`);
        const hr = ch.getBoundingClientRect();
        if (hr.right > r.right + 0.5 || hr.left < r.left - 0.5) fail(`${name}「${ch.textContent}」字形出了方格`);
      }
    }
    for (const rest of restsIn(cell)) {
      if (rest.dataset.focus) continue;
      const cs = getComputedStyle(rest);
      const bg = parse(cs.backgroundColor);
      if (parseFloat(cs.borderTopWidth) > 0 || (bg && bg[3] > 0)) fail(`${name} 的空音画了边线或底色（应该只是空白）`);
    }
  }

  const boxes = (cell) => squaresIn(cell).map((s) => Number(s.dataset.box)).join(',');
  const focus = [...document.querySelectorAll('[data-role="square"][data-focus], [data-role="rest"][data-focus]')];
  const tip = document.querySelector('[data-role="square-tip"]');
  const accentOf = (el) => parse(getComputedStyle(el).borderTopColor);
  const isAccent = (c) => c && c[0] > c[2] + 60 && c[0] > 150;   // 朱橙
  const needTip = () => {
    if (!tip) { fail('没有改字气泡'); return; }
    inView(tip, '改字气泡');
    const acts = [...tip.querySelectorAll('[data-role="square-action"]')].map((b) => b.dataset.act).join(',');
    if (acts !== 'split,triplet,rest,merge') fail(`改字气泡按钮是 ${acts}`);
  };
  const needFocus = (bar, beat, tick, kind) => {
    if (focus.length !== 1) { fail(`光标应该正好在一个地方，现在 ${focus.length} 个`); return null; }
    const f = focus[0];
    const cell = f.closest('[data-role="cell"]');
    if (!cell || cell.dataset.bar !== String(bar) || cell.dataset.beat !== String(beat) || f.dataset.tick !== String(tick) || f.dataset.role !== kind)
      fail(`光标不在第 ${bar} 小节第 ${beat + 1} 拍 tick ${tick} 的${kind === 'rest' ? '空音' : '方格'}上`);
    if (!isAccent(accentOf(f))) fail('光标那一格没有描强调色');
    return f;
  };
  const toast = () => document.querySelector('[data-role="notice"]');

  if (screen === 'default') {
    for (const cell of document.querySelectorAll('[data-role="cell"]')) {
      if (boxes(cell) !== '48' || squaresIn(cell)[0].dataset.square !== 'empty') fail(`默认：第 ${cell.dataset.bar} 小节第 ${Number(cell.dataset.beat) + 1} 拍不是一个空的 1/4 方格（${boxes(cell)}）`);
    }
    if (document.querySelector('[data-role="rest"]')) fail('默认画面里不该有空音');
    const t = document.querySelector('[data-role="empty-tip"]');
    if (!t || !vis(t)) fail('引导提示看不见');
  } else if (screen === 'edit') {
    const c = cellOf(3, 2);
    if (boxes(c) !== '48') fail(`第 3 小节第 3 拍应是一个 1/4 方格（${boxes(c)}）`);
    const f = needFocus(3, 2, 0, 'square');
    if (f && f.dataset.text !== '把') fail('正在改的方格里不是「把」');
    needTip();
  } else if (screen === 'split8') {
    const c = cellOf(4, 0), sq = squaresIn(c);
    if (boxes(c) !== '24,24') fail(`第 4 小节第 1 拍应是两个 1/8（${boxes(c)}）`);
    if (sq[0] && sq[0].dataset.text !== '我') fail('「我」不在左边那一半');
    if (sq[1] && sq[1].dataset.text) fail('右边那一半应该是空方格');
    needFocus(4, 0, 0, 'square');
    needTip();
  } else if (screen === 'split16') {
    const c = cellOf(4, 0), sq = squaresIn(c);
    if (boxes(c) !== '12,6,6,24') fail(`第 4 小节第 1 拍应是 12,6,6,24（${boxes(c)}）`);
    if (sq[0] && sq[0].dataset.text !== '我') fail('「我」不在第一个方格');
    needFocus(4, 0, 12, 'square');
    needTip();
    const split = tip && tip.querySelector('[data-act="split"]');
    if (!split || !split.disabled) fail('1/32 上「一分二」应该不可点');
    const t = toast();
    if (!t || !vis(t) || !t.textContent.includes('1/32')) fail('没有「已经是 1/32」的提示');
    else inView(t, '提示条');
  } else if (screen === 'triplet') {
    const c = cellOf(5, 1);
    if (boxes(c) !== '16,16,16') fail(`第 5 小节第 2 拍应是三连（${boxes(c)}）`);
    if (c.querySelectorAll('[data-role="triplet-mark"]').length !== 1) fail('第 5 小节第 2 拍没有一个「3」标记');
    const h = cellOf(2, 3);
    if (boxes(h) !== '24,8,8,8') fail(`第 2 小节第 4 拍应是 24,8,8,8（${boxes(h)}）`);
    if (!h.querySelector('[data-role="triplet-mark"].h2')) fail('第 2 小节第 4 拍后半拍没有「3」');
    needFocus(5, 1, 0, 'square');
    needTip();
  } else if (screen === 'rest') {
    const c = cellOf(6, 2);
    if (boxes(c) !== '24') fail(`第 6 小节第 3 拍应剩一个 1/8 方格（${boxes(c)}）`);
    const r = restsIn(c);
    if (r.length !== 1 || r[0].dataset.tick !== '24' || r[0].dataset.len !== '24') fail('第 6 小节第 3 拍后半拍不是空音');
    const f = needFocus(6, 2, 24, 'rest');
    if (f) {
      const cs = getComputedStyle(f);
      if (cs.borderTopStyle !== 'dashed') fail('光标停在空音上应该是虚线');
      const bg = parse(cs.backgroundColor);
      if (bg && bg[3] > 0) fail('空音不该有底色');
    }
    needTip();
    const t = toast();
    if (!t || !vis(t) || !t.textContent.includes('一步')) fail('没有「历史里只记一步」的提示');
    else inView(t, '提示条');
  } else if (screen === 'clear') {
    const box = document.querySelector('[data-role="clear-flow-confirm"]');
    if (!box || !vis(box)) fail('看不到清空确认');
    else {
      inView(box, '清空确认');
      const yes = box.querySelector('[data-role="clear-flow-yes"]'), no = box.querySelector('[data-role="clear-flow-no"]');
      if (!yes || !no || !vis(yes) || !vis(no)) fail('清空确认里没有「清空」「取消」');
      else {
        inView(yes, '「清空」');
        const k = contrast(parse(getComputedStyle(yes).color), bgOf(yes));
        if (k < 3) fail(`「清空」按钮字和底色对比 ${k.toFixed(2)} < 3`);
      }
    }
  }
  return fails;
}
"""


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    root = pathlib.Path(sys.argv[1]).resolve()
    evidence = pathlib.Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else None
    mock = root / "mockups_v32"
    shots = root / "screenshots_v32"
    shots.mkdir(parents=True, exist_ok=True)
    if evidence:
        (evidence / "screenshots_v32").mkdir(parents=True, exist_ok=True)
    bad = 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for screen in SCREENS:
            for size, (w, h) in SIZES.items():
                for scheme in SCHEMES:
                    tag = f"{screen}_{size}_{scheme}"
                    page = browser.new_page(viewport={"width": w, "height": h}, color_scheme=scheme)
                    errors: list[str] = []
                    page.on("pageerror", lambda e, errors=errors: errors.append(f"页面异常 {e}"))
                    page.on("console", lambda m, errors=errors: errors.append(f"控制台 {m.text}") if m.type == "error" else None)
                    page.on("request", lambda r, errors=errors: errors.append(f"外网请求 {r.url}") if not r.url.startswith("file:") else None)
                    page.goto((mock / f"{screen}.html").as_uri())
                    page.wait_for_timeout(120)
                    page.screenshot(path=str(shots / f"{tag}.png"))
                    if evidence:
                        shutil.copy(shots / f"{tag}.png", evidence / "screenshots_v32" / f"{tag}.png")
                    fails = errors + page.evaluate(PROBE_JS, screen)
                    page.close()
                    if fails:
                        bad += 1
                        print(f"✗ {tag}")
                        for f in fails:
                            print(f"    {f}")
                    else:
                        print(f"✓ {tag}")
        browser.close()
    total = len(SCREENS) * len(SIZES) * len(SCHEMES)
    print(f"{total - bad}/{total} 个组合通过")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
