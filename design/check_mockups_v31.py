"""AnyBeats v3.1 视觉稿自动检查（浏览器实测，不 grep 源码）。

用法：python -I design/check_mockups_v31.py design [证据目录]

对 design/mockups_v31/ 的 7 个画面 × 桌面 1280×800 / 手机 390×844 × 浅 / 深色：
截图到 design/screenshots_v31/<画面>_<desktop|mobile>_<light|dark>.png（给了证据目录就再拷一份到 <证据目录>/screenshots_v31/），
再在浏览器里量算断言。

通用：
  - 无控制台错误 / 页面异常；无外网请求；无 text-transform: uppercase；任何可见元素的字色 / 底色 / 边线不是紫色（250–310°）
  - 可见文字里没有 ∅、Worker、录音、AI、中文段落名；段落标签全是英文；撤销、重做可见
  - 步骤按钮：正好一个是当前步骤，当前步骤是强调色实底（和播放键同色）
  - 一拍 = 一格：表格里没有 v3 的字框（data-role=slot）、没有拖音细线（drag-line）、没有能点的 16 分小格（sub-tick）；
    每个字（data-role=word）没有边线、没有底色；每个拍头里正好一个按钮
  - 格子本身不画选中框（没有 inset box-shadow / outline）：选中只能是 selection-box 那一个框
表格几何（只量看得见的格子）：
  - 字按 tick 摆：字左边 = 格左 + tick/48 × 格宽 + 1（±1.5px）；字形在格子里；字号 ≥ 11px
  - 拖音浅底：每个比一个 16 分（三连 16 tick）长的字都有浅底，从字的落点一直铺到它结束（±1.5px），跨格在格线处接上，
    跨小节时下一行从第一格左边接着铺；韵脚字的浅底和字同一个色相；只有 16 分那么长的字没有浅底
画面专属：
  select  正好一个选中框，正好框住第 3 小节第 2 拍；看得见改长度的把手
  edit    第 4 小节第 2 拍变成输入框（在格子里）；提示看得见、写着「下一拍不动」；第 3 拍的字没变
  column  拍头「3」高亮；正好一个选中框，左右正好是第 3 拍那一列，上下从第 2 小节到第 9 小节（跨过 Hook 段落标题不断开，
          标题那一行同一列垫了浅色）；选中的格子全是第 3 拍、而且不是空格子；第 1 小节、Outro 的格子不在框里；
          表头里除了「3」那一格，没有别的强调色块（以前的 1/16 橙色竖条）
  hold    第 1 步；第 9 小节第 4 拍「口」正在拖：预览从字现在的结束处接着铺到第 10 小节第 1 拍 tick 24，
          下一行从第一格左边开始；拖到哪的小提示在屏幕里
  split   第 10 小节四拍分别是 1 / 2 / 3 / 4 个字、平分（48 / 24 / 16 / 12 tick），三连那一拍标「3」；
          第 11 小节第 2 拍没有字；「最多 4 个字」的提示看得见；右栏至少 7 个例子
  section 段落菜单看得见、在屏幕里，依次是 Intro / Verse / Hook / Bridge / Outro
  empty   第 1 步；表格里没有字；引导提示看得见
任何一项不满足，退出码 1。只用标准库 + playwright（sync API）。
"""

import pathlib
import re
import shutil
import sys

from playwright.sync_api import sync_playwright

SIZES = {"desktop": (1280, 800), "mobile": (390, 844)}
SCHEMES = ("light", "dark")
SCREENS = ("select", "edit", "column", "hold", "split", "section", "empty")
BANNED_TEXT = ("∅", "Worker", "录音", "AI", "前奏", "主歌", "副歌", "桥段", "尾奏")
SECTION_RE = re.compile(r"^(Intro|Verse|Hook|Bridge|Outro)( \d+)?$")
MIN_FONT = 11

PROBE_JS = r"""
(args) => {
  const parse = (s) => {
    const m = s && s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const hsl = (c) => {
    const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (d < 1e-6) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
    return { h, s, l };
  };
  const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
  const R = (el) => el.getBoundingClientRect();
  const text = (el) => (el.innerText || el.textContent || '').trim();
  const rendered = (el) => {
    if (!el) return false;
    const r = R(el);
    if (r.width < 1 || r.height < 1) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  const inView = (r) => !(r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth);
  const fullyIn = (r) => r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5;
  const round = (v) => Math.round(v * 10) / 10;
  const glyphRect = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); };
  const bgOf = (el) => { const c = parse(getComputedStyle(el).backgroundColor); return c && c[3] >= 0.1 ? c : null; };
  const sameColor = (a, b) => a && b && Math.abs(a[0] - b[0]) < 3 && Math.abs(a[1] - b[1]) < 3 && Math.abs(a[2] - b[2]) < 3;

  const out = { uppercase: [], purple: [], banned: [], undo: 0, redo: 0, sections: [], errs: [] };
  const E = (m) => out.errs.push(m);
  for (const el of document.querySelectorAll('body *')) {
    if (!rendered(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.textTransform === 'uppercase' && el.textContent.trim()) out.uppercase.push(el.className);
    const cands = [['底色', cs.backgroundColor]];
    if ([...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) cands.push(['字色', cs.color]);
    if (parseFloat(cs.borderTopWidth) >= 1 && cs.borderTopStyle !== 'none') cands.push(['边线', cs.borderTopColor]);
    for (const [k, v] of cands) {
      const c = parse(v);
      if (!c || c[3] < 0.2) continue;
      const x = hsl(c);
      if (x.s > 0.3 && x.l > 0.1 && x.l < 0.95 && x.h >= 250 && x.h <= 310) { out.purple.push(k + ' ' + v + ' @' + el.className); break; }
    }
  }
  const vt = document.body.innerText || '';
  for (const w of args.words) if (vt.includes(w)) out.banned.push(w);
  const big = (el) => rendered(el) && inView(R(el)) && R(el).width >= 28 && R(el).height >= 28;
  out.undo = [...document.querySelectorAll('[data-role="undo"]')].filter(big).length;
  out.redo = [...document.querySelectorAll('[data-role="redo"]')].filter(big).length;
  out.sections = [...document.querySelectorAll('[data-role="section-header"] [data-role="section-label"]')].filter(rendered).map(text);

  // ---- 步骤按钮 ----
  const stepBtns = [...document.querySelectorAll('[data-role="steps"] button')].filter(rendered);
  const on = stepBtns.filter(b => b.classList.contains('on'));
  out.step = on.length === 1 ? on[0].dataset.step : null;
  if (on.length !== 1) E('步骤按钮：当前步骤应正好 1 个，实际 ' + on.length);
  const play = [...document.querySelectorAll('[data-role="play"]')].find(rendered);
  if (on[0] && play && !sameColor(bgOf(on[0]), bgOf(play))) E('当前步骤按钮不是强调色实底（' + getComputedStyle(on[0]).backgroundColor + '）');

  // ---- 一拍 = 一格 ----
  const sheet = document.querySelector('[data-role="lyrics-sheet"]');
  if (!sheet) { E('没有表格'); return out; }
  if (sheet.querySelector('[data-role="slot"]')) E('表格里还有 v3 的字框（data-role=slot）');
  if (sheet.querySelector('[data-role="drag-line"]')) E('表格里还有拖音细线（drag-line）');
  if (document.querySelector('[data-role="sub-tick"], .sub')) E('拍头里还有能点的 16 分小格');
  for (const h of sheet.querySelectorAll('[data-role="beat-head"]')) {
    const n = h.querySelectorAll('button').length;
    if (n !== 1) E('拍头 ' + (+h.dataset.beat + 1) + ' 里有 ' + n + ' 个按钮（应该整个拍头一个）');
  }
  const cells = [...sheet.querySelectorAll('[data-role="cell"]')];
  for (const c of cells) {
    const cs = getComputedStyle(c);
    if (cs.boxShadow !== 'none' || (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0)) E('第 ' + c.dataset.key + ' 格自己画了框（选中只能画一个总框）');
  }
  const words = [...sheet.querySelectorAll('[data-role="word"]')];
  for (const w of words) {
    const cs = getComputedStyle(w);
    if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') E('字 ' + w.dataset.word + ' 有边线（字框）');
    if (bgOf(w)) E('字 ' + w.dataset.word + ' 有底色（字框）');
  }

  // ---- 几何 ----
  const geo = (c) => { const r = R(c); return { left: r.left + c.clientLeft, w: c.clientWidth, r }; };
  const vis = cells.filter(c => rendered(c) && inView(R(c)));
  const T = { cells: vis.length, minFont: 99, words: 0, tints: 0 };
  out.sheet = T;
  const cellByKey = {};
  for (const c of cells) cellByKey[c.dataset.key] = c;
  const order = cells.map(c => c.dataset.key);   // 全曲顺序：小节 → 拍
  for (const c of vis) {
    const g = geo(c);
    for (const w of c.querySelectorAll('[data-role="word"]')) {
      T.words++;
      const t = +w.dataset.tick, r = R(w), want = g.left + g.w * t / 48 + 1;
      if (Math.abs(r.left - want) > 1.5) E(w.dataset.word + ' 字的左边偏 ' + round(r.left - want) + 'px');
      const ch = w.querySelector('.ch');
      if (ch && text(ch)) {
        const fs = parseFloat(getComputedStyle(ch).fontSize), gr = glyphRect(ch);
        T.minFont = Math.min(T.minFont, fs);
        if (fs < args.minFont - 0.01) E(w.dataset.word + ' 字号 ' + fs + 'px');
        if (gr.left < g.r.left - 0.5 || gr.right > g.r.right + 0.5) E(w.dataset.word + '「' + text(ch) + '」字形出了格子');
      }
    }
  }
  // 拖音浅底：按字查
  const tintsOf = {};
  for (const s of sheet.querySelectorAll('[data-role="hold-tint"]')) (tintsOf[s.dataset.word] = tintsOf[s.dataset.word] || []).push(s);
  for (const w of words) {
    const id = w.dataset.word, len = +w.dataset.len, box = +w.dataset.box, segs = (tintsOf[id] || []).sort((a, b) => a.dataset.s - b.dataset.s);
    const c = w.closest('[data-role="cell"]');
    const c0 = (+c.dataset.bar - 1) * 192 + +c.dataset.beat * 48, abs = c0 + +w.dataset.tick;
    if (len <= box) { if (segs.length) E(id + ' 只有一个 16 分长，不该有浅底'); continue; }
    if (!segs.length) { E(id + ' 拖长了（' + len + ' tick）却没有浅底'); continue; }
    T.tints++;
    if (+segs[0].dataset.s !== abs) E(id + ' 浅底不是从字的落点开始');
    if (+segs[segs.length - 1].dataset.e !== abs + len) E(id + ' 浅底没铺到字结束');
    for (let i = 1; i < segs.length; i++) if (segs[i].dataset.s !== segs[i - 1].dataset.e) E(id + ' 浅底中间断了');
    const wh = w.style.getPropertyValue('--h');
    for (const s of segs) {
      const sc = s.closest('[data-role="cell"]'), g = geo(sc), sc0 = (+sc.dataset.bar - 1) * 192 + +sc.dataset.beat * 48;
      if (!rendered(sc) || !inView(R(sc))) continue;
      const r = R(s), ss = +s.dataset.s, se = +s.dataset.e;
      const wantL = ss === abs ? g.left + g.w * (ss - sc0) / 48 + 1 : g.left - 1;
      const wantR = se === abs + len ? g.left + g.w * (se - sc0) / 48 - 1 : g.left + g.w + 1;
      if (Math.abs(r.left - wantL) > 1.5) E(id + ' 浅底在 ' + sc.dataset.key + ' 左边偏 ' + round(r.left - wantL) + 'px');
      if (Math.abs(r.right - wantR) > 1.5) E(id + ' 浅底在 ' + sc.dataset.key + ' 右边偏 ' + round(r.right - wantR) + 'px');
      if (ss !== abs && ss % 192 === 0 && sc.dataset.beat !== '0') E(id + ' 跨小节后没从下一行第一格接着铺');
      if (wh) {
        const bc = bgOf(s);
        if (!bc || hueDist(hsl(bc).h, +wh) > 12) E(id + ' 韵脚字的浅底颜色和字不是同一个色相');
      }
    }
  }

  // ---- 选中框 ----
  const boxes = [...sheet.querySelectorAll('[data-role="selection-box"]')].filter(rendered);
  out.boxes = boxes.map(b => { const r = R(b); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
  const cellRect = (k) => cellByKey[k] && R(cellByKey[k]);
  const S = args.screen;
  const near = (a, b, tol) => Math.abs(a - b) <= (tol || 2.5);
  if (S === 'select') {
    if (boxes.length !== 1) E('应该正好 1 个选中框，实际 ' + boxes.length);
    const r = cellRect('3:1'), b = out.boxes[0];
    if (b && r && !(near(b.l, r.left - 1) && near(b.r, r.right) && near(b.t, r.top - 1) && near(b.b, r.bottom))) E('选中框没正好框住第 3 小节第 2 拍');
    if (![...document.querySelectorAll('[data-role="hold-grip"]')].some(g => rendered(g) && inView(R(g)))) E('看不到改长度的把手');
  }
  if (S === 'edit') {
    const ed = document.querySelector('[data-role="cell-editor"]'), c = cellByKey['4:1'];
    if (!ed || !rendered(ed) || !c || !c.contains(ed)) E('第 4 小节第 2 拍没变成输入框');
    else { const a = R(ed), r = R(c); if (a.left < r.left - 0.5 || a.right > r.right + 0.5 || a.top < r.top - 0.5 || a.bottom > r.bottom + 0.5) E('输入框出了格子'); }
    const tip = document.querySelector('[data-role="edit-tip"]');
    if (!tip || !rendered(tip) || !fullyIn(R(tip))) E('改字提示看不全');
    else if (!text(tip).includes('下一拍不动')) E('改字提示没写「下一拍不动」');
    const nx = cellByKey['4:2'];
    if (!nx || [...nx.querySelectorAll('[data-role="word"] .ch')].map(text).join('') !== '只要心里') E('第 4 小节第 3 拍的字变了');
  }
  if (S === 'column') {
    const head = sheet.querySelector('[data-role="beat-head"][data-beat="2"]');
    if (!head || !head.classList.contains('on')) E('拍头「3」没有高亮');
    for (const h of sheet.querySelectorAll('[data-role="beat-head"]')) {
      if (h === head) continue;
      for (const el of [h, ...h.querySelectorAll('*')]) {
        const bc = bgOf(el);
        if (bc && hsl(bc).s > 0.4 && hueDist(hsl(bc).h, 20) < 25 && rendered(el)) E('拍头 ' + (+h.dataset.beat + 1) + ' 里有强调色块（橙色竖条）');
      }
    }
    for (const el of sheet.querySelectorAll('.band, [data-role="band"]')) if (rendered(el)) E('格子里还有 1/16 竖条');
    if (boxes.length !== 1) E('整列应该是 1 个连续的选中框，实际 ' + boxes.length + ' 个');
    const sel = cells.filter(c => c.dataset.selected === '1');
    if (sel.some(c => c.dataset.beat !== '2')) E('选中了第 3 拍以外的格子');
    if (sel.some(c => c.dataset.content === 'empty')) E('选中了空格子');
    const bars = sel.map(c => +c.dataset.bar).sort((a, b) => a - b);
    if (bars.join(',') !== '2,3,4,5,6,7,8,9') E('整列选中的小节应该是 2–9，实际 ' + bars.join(','));
    const b = out.boxes[0], top = cellRect('2:2'), bot = cellRect('9:2');
    if (b && top && bot) {
      if (!(near(b.l, top.left - 1) && near(b.r, top.right))) E('选中框左右不是第 3 拍那一列');
      if (!(near(b.t, top.top - 1) && near(b.b, bot.bottom))) E('选中框上下不是第 2 到第 9 小节');
      const hooks = [...sheet.querySelectorAll('[data-role="section-header"]')].filter(h => text(h).startsWith('Hook'));
      const hk = hooks[0] && R(hooks[0]);
      if (!hk || !(hk.top > b.t && hk.bottom < b.b)) E('选中框没有穿过 Hook 段落标题');
      if (!hooks[0] || !hooks[0].querySelector('[data-role="selection-band"]')) E('Hook 标题那一行同一列没垫浅色（会断开）');
      for (const k of ['1:2', '10:2', '11:2']) { const r = cellRect(k); if (r && r.top < b.b - 1 && r.bottom > b.t + 1) E('第 ' + k + ' 格（空格子）在选中框里'); }
    }
  }
  if (S === 'hold') {
    const pv = [...sheet.querySelectorAll('[data-role="hold-preview"]')].sort((a, b) => a.dataset.s - b.dataset.s);
    const end = 8 * 192 + 3 * 48 + 12 + 36, to = 9 * 192 + 24;
    if (!pv.length) E('没有拖长预览');
    else {
      if (+pv[0].dataset.s !== end) E('预览不是从「口」现在的结束处接着铺');
      if (+pv[pv.length - 1].dataset.e !== to) E('预览没铺到第 10 小节第 1 拍 tick 24');
      const first = pv.find(p => +p.dataset.s === 9 * 192), c = first && first.closest('[data-role="cell"]');
      if (!c || c.dataset.key !== '10:0') E('跨小节后预览没从第 10 小节第一格开始');
      else if (!near(R(first).left, geo(c).left - 1, 1.5)) E('下一行的预览没贴着第一格左边');
    }
    const tip = document.querySelector('[data-role="drag-tip"]');
    if (!tip || !rendered(tip) || !fullyIn(R(tip))) E('拖到哪的小提示不在屏幕里');
  }
  if (S === 'split') {
    const want = [[0], [0, 24], [0, 16, 32], [0, 12, 24, 36]], lens = [48, 24, 16, 12];
    for (let bi = 0; bi < 4; bi++) {
      const c = cellByKey['10:' + bi], ws = c ? [...c.querySelectorAll('[data-role="word"]')] : [];
      if (ws.map(w => +w.dataset.tick).join(',') !== want[bi].join(',')) E('第 10 小节第 ' + (bi + 1) + ' 拍没有平分成 ' + (bi + 1) + ' 份');
      if (ws.some(w => +w.dataset.len !== lens[bi])) E('第 10 小节第 ' + (bi + 1) + ' 拍每个字不是 ' + lens[bi] + ' tick');
    }
    const t3 = cellByKey['10:2'];
    if (!t3 || ![...t3.querySelectorAll('[data-role="triplet-mark"]')].some(m => text(m) === '3')) E('三连那一拍没标「3」');
    if (cellByKey['11:1'] && cellByKey['11:1'].querySelector('[data-role="word"]')) E('打了 6 个字的那一拍不该写进字');
    const n = document.querySelector('[data-role="notice"]');
    if (!n || !rendered(n) || !fullyIn(R(n)) || !text(n).includes('最多 4 个字')) E('「最多 4 个字」的提示看不到');
    if (args.desktop && document.querySelectorAll('[data-role="split-case"]').length < 7) E('右栏例子少于 7 个');
  }
  if (S === 'section') {
    const m = document.querySelector('[data-role="section-picker"]');
    if (!m || !rendered(m) || !fullyIn(R(m))) E('段落菜单看不全');
    else {
      const kinds = [...m.querySelectorAll('[data-role="section-kind"]')].map(i => i.querySelector('b').textContent.trim());
      if (kinds.join(',') !== 'Intro,Verse,Hook,Bridge,Outro') E('段落菜单应依次是 Intro/Verse/Hook/Bridge/Outro，实际 ' + kinds.join(','));
    }
  }
  if (S === 'empty') {
    if (words.length) E('空作品里不该有字');
    const t = document.querySelector('[data-role="empty-tip"]');
    if (!t || !rendered(t) || !inView(R(t))) E('看不到空作品的引导');
  }
  return out;
}
"""

WANT_STEP = {"hold": "1", "empty": "1"}


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    design = pathlib.Path(sys.argv[1]).resolve()
    evidence = pathlib.Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else None
    mock = design / "mockups_v31"
    shots = design / "screenshots_v31"
    shots.mkdir(parents=True, exist_ok=True)
    fails = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for screen in SCREENS:
            for size, (w, h) in SIZES.items():
                for scheme in SCHEMES:
                    tag = f"{screen}_{size}_{scheme}"
                    page = browser.new_page(viewport={"width": w, "height": h}, color_scheme=scheme)
                    errs, ext = [], []
                    page.on("console", lambda m, errs=errs: m.type == "error" and errs.append(m.text))
                    page.on("pageerror", lambda e, errs=errs: errs.append(str(e)))
                    page.on("request", lambda r, ext=ext: (not r.url.startswith(("file:", "data:", "about:", "blob:"))) and ext.append(r.url))
                    page.goto((mock / f"{screen}.html").as_uri(), timeout=20000)
                    page.wait_for_timeout(250)
                    page.screenshot(path=str(shots / f"{tag}.png"))
                    info = page.evaluate(PROBE_JS, {"words": list(BANNED_TEXT), "minFont": MIN_FONT, "screen": screen, "desktop": size == "desktop"})
                    page.close()
                    f = []
                    f += [f"控制台错误：{e}" for e in errs]
                    f += [f"外网请求：{u}" for u in ext]
                    if info["uppercase"]:
                        f.append(f"uppercase：{info['uppercase'][:3]}")
                    if info["purple"]:
                        f.append(f"紫色：{info['purple'][:3]}")
                    if info["banned"]:
                        f.append(f"出现了不该有的字：{info['banned']}")
                    if info["undo"] < 1 or info["redo"] < 1:
                        f.append("撤销 / 重做键看不到")
                    bad = [s for s in info["sections"] if not SECTION_RE.match(s)]
                    if not info["sections"] or bad:
                        f.append(f"段落标签不是英文：{bad or '没有段落'}")
                    if info.get("step") != WANT_STEP.get(screen, "2"):
                        f.append(f"当前步骤应是 {WANT_STEP.get(screen, '2')}，实际 {info.get('step')}")
                    f += info["errs"]
                    if screen != "empty" and info["sheet"]["words"] == 0:
                        f.append("看得见的格子里一个字都没有")
                    if screen != "empty" and info["sheet"]["tints"] == 0:
                        f.append("看得见的格子里没有拖音浅底")
                    print(f"{'OK ' if not f else 'BAD'} {tag}  格子 {info['sheet']['cells']} · 字 {info['sheet']['words']} · 浅底 {info['sheet']['tints']} · 最小字号 {info['sheet']['minFont']}")
                    for x in f:
                        print("    -", x)
                    fails += [f"{tag}: {x}" for x in f]
        browser.close()
    if evidence:
        dst = evidence / "screenshots_v31"
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(shots, dst)
        mdst = evidence / "mockups_v31"
        if mdst.exists():
            shutil.rmtree(mdst)
        shutil.copytree(mock, mdst)
    print(f"\n{len(SCREENS) * 4} 张截图在 {shots}" + (f"（另拷到 {evidence}）" if evidence else ""))
    if fails:
        print(f"不通过：{len(fails)} 项")
        return 1
    print("全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
