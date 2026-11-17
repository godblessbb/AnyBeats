"""AnyBeats v3 构建产物检查：用 Chromium 打开 dist/index.html（file://），在浏览器里实测断言。

用法：python -I e2e/check_app_v3.py dist/index.html [--shots 目录]

断言读的都是浏览器里量出来的值（计算样式、元素位置、可见文字、localStorage），不 grep 源码。
思路沿用 design/check_mockups_v3.py：通用断言 + 表格几何 + 场景操作后的状态。

通用（桌面 1280×800 / 手机 390×844 × 浅 / 深，各截一张）：
  - 无控制台错误 / 页面异常；无外网请求（只许 file: / data: / about: / blob:）
  - 没有 text-transform: uppercase；强调色、播放键和任何可见元素的字色 / 底色 / 边线都不是紫色（250–310°）
  - 可见文字里没有 ∅、Worker、录音、AI、中文段落名；表格里没有「续」；没有可见的录音键；AI 入口不挂载
  - 撤销、重做键都在；可见播放键正好 1 个；段落标签全是英文；深色确实更暗；手机押韵抽屉贴底、收起 ≤ 64px
  - 数据里只有字：表格里没有 data-kind 不是 word 的字格（拖音不是单独的格子）
表格几何（只量看得见的格子）：
  - 字框按 tick 摆：左 = 格左 + tick/48 × 格宽 + 1，右 = 格左 + (tick + 框长)/48 × 格宽 − 1（±1.5px）
  - 字不挤出格子：字形在字框里、字框在格子里；字号 ≥ 11px（手机 390 下三连、半拍三连也一样）
  - 字的长度细线：从字框右边画到字结束的 tick；跨格时在格线处接上；折行时上一行画到最后、下一行从第一格开头接着画；
    线色跟字走（韵脚字 = 这一格的颜色，没涂色 = 字色）
  - 只有拖音、没有新字的格子没有颜色
场景：
  1 跨格 / 跨行细线：「夜车」第 5 小节「拍」拖进第 3 拍；第 6 小节「口」拖到第 7 小节开头
  2 只有拖音的格不能涂色：点第 7 小节第 2 拍出「这一拍只有拖音」；整行涂金色时这一格被跳过、没颜色
  3 折行无「续」：行头只有两位小节号；表格里没有「续」
  4 两色同韵自动合并：新建颜色定成双押 u · ou → 合并进粉色（先涂的格子变粉）、提示「合并」、只算一步，撤销一次回来
  5 严格韵母比对：蓝色 i · ang 的「方」改成「想」（iang）→ 标出对不上；改回「方」→ 提示消失
  6 撤销后新改动清掉重做；7 刷新后历史还在（还能撤销、历史面板列着）
  8 换伴奏 BPM 弹窗：100 BPM 的伴奏 → 弹窗两个选项，默认推荐、默认聚焦「改用新 BPM」；选了以后字的 tick 不变
  9 手机 390：三连字不溢出；带 1/32 的作品整张表左右滑（每拍 ≥ 112px），字不溢出、字号 ≥ 11px；桌面不滑
  10 铺 flow：放一个字、按 - 多拖一个精度单位、拖右边缘拉过格线 → 字的长度变、细线跟着画
  11 存量作品迁移：本机存着 v2 作品时打开 → 迁成 v3（英文段落名、延音变成字的长度），原文留在备份键
任何一项不满足，退出码 1。只用标准库 + playwright（sync API）。

v3.1 调整（ct_602f941f：用户要求格子里去掉一个个字框、拖音改成同色浅底、不再画细线、双击一格改这一拍的字）：
  - 字的选择器 data-role="slot" → "word"，拖音 data-role="drag-line" → "hold-tint"，改字的输入框 word-input → cell-editor
    （单击字框改一个字 → 双击格子改这一拍：edit_word 把这一拍现在的字换掉第 which 个再整拍回车），拉长把手 stretch-handle → hold-grip。
    这些只是换了元素名 / 操作方式，断言的意思不变。
  - 删掉的断言（都绑在已经删掉的字框上，没有字框就无从量起）：
      1. 「字框右边 = 格左 + (tick + 框长)/48 × 格宽 − 1」——字框没了；字的左边按 tick 摆照样查。
      2. 「字挤出字框」「字框出了格子」——字框没了；改查字形不出格子。
      3. 「细线从字框右边开始」——细线没了，拖音浅底从字的落点开始，改查「浅底从字的落点开始」。
    其余细线断言（经过的格子、跨格接上、折行接到下一行开头、画到字结束、颜色跟字走）原样换成查浅底。
  - check_app_v3 从来没用过「整列」选法按钮、拍头下面的 16 分小格，没有要删的断言。
"""

import json
import math
import pathlib
import random
import re
import struct
import sys
import tempfile
import wave

from playwright.sync_api import sync_playwright

SIZES = {"desktop": (1280, 800), "mobile": (390, 844)}
SCHEMES = ("light", "dark")
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
  const visible = (el) => {
    if (!rendered(el) || !inView(R(el))) return false;
    const r = R(el), cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return false;
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n), nr = R(n);
      if ((cs.overflowX !== 'visible' || cs.overflowY !== 'visible') && !(cx >= nr.left && cx <= nr.right && cy >= nr.top && cy <= nr.bottom)) return false;
    }
    for (const h of document.elementsFromPoint(cx, cy)) {
      if (h === el || el.contains(h) || h.contains(el)) return true;
      if (getComputedStyle(h).pointerEvents === 'none') continue;
      return false;
    }
    return false;
  };
  // 看得见的部分（被吸顶表头 / 抽屉盖住的不算）：至少中心点在屏幕里、没被裁掉
  const shown = (el) => {
    if (!rendered(el) || !inView(R(el))) return false;
    const r = R(el), cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n), nr = R(n);
      if ((cs.overflowX !== 'visible' || cs.overflowY !== 'visible') && !(cx >= nr.left - 0.5 && cx <= nr.right + 0.5 && cy >= nr.top - 0.5 && cy <= nr.bottom + 0.5)) return false;
    }
    return cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight;
  };
  const chroma = (el) => {
    const c = parse(getComputedStyle(el).backgroundColor);
    if (!c || c[3] < 0.1) return null;
    const x = hsl(c);
    if (x.s < 0.2 || x.l < 0.06 || x.l > 0.97) return null;
    return x;
  };
  const round = (v) => Math.round(v * 10) / 10;
  const glyphRect = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); };

  const out = { uppercase: [], purple: [], banned: [], undo: 0, redo: 0, play: 0, rec: 0, ai: 0, sections: [], drawer: null, nonWord: 0, accent: null,
                pageBg: null };
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
      if (x.s > 0.3 && x.l > 0.1 && x.l < 0.95 && x.h >= 250 && x.h <= 310) { out.purple.push(k + ' ' + v + ' @' + el.tagName.toLowerCase() + '.' + el.className); break; }
    }
    if (out.purple.length > 5) break;
  }
  const probe = document.createElement('div');
  probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--ab-accent').trim();
  document.body.appendChild(probe);
  const ac = parse(getComputedStyle(probe).color);
  out.accent = ac ? hsl(ac) : null;
  probe.remove();
  const pb = parse(getComputedStyle(document.body).backgroundColor);
  out.pageBg = pb ? (0.2126 * pb[0] + 0.7152 * pb[1] + 0.0722 * pb[2]) : null;
  let vt = document.body.innerText || '';
  for (const el of document.querySelectorAll('input')) if (rendered(el)) vt += '\n' + el.value;
  for (const w of args.words) if (vt.includes(w)) { const i = vt.indexOf(w); out.banned.push(w + '：…' + vt.slice(Math.max(0, i - 12), i + 12).replace(/\s+/g, ' ') + '…'); }
  const big = (el) => rendered(el) && R(el).width >= 28 && R(el).height >= 28;
  out.undo = [...document.querySelectorAll('[data-role="undo"]')].filter(big).length;
  out.redo = [...document.querySelectorAll('[data-role="redo"]')].filter(big).length;
  out.play = [...document.querySelectorAll('[data-role="play"], [aria-label*="播放"]')].filter(visible).length;
  out.rec = [...document.querySelectorAll('[data-role^="record"], [data-role="take-lane"], [aria-label*="录"], [title*="录音"]')].filter(rendered).length;
  out.ai = [...document.querySelectorAll('[data-role^="ai"], [data-role="worker"]')].filter(rendered).length;
  out.sections = [...document.querySelectorAll('[data-role="section-label"]')].filter(rendered).map(text);
  const dr = document.querySelector('[data-role="rhyme-drawer"]');
  if (dr && rendered(dr)) out.drawer = { height: R(dr).height, bottom: R(dr).bottom };
  out.nonWord = [...document.querySelectorAll('[data-role="lyrics-sheet"] [data-role="word"]')].filter(s => s.dataset.kind !== 'word').length;

  // ---- 表格 ----
  const sheet = document.querySelector('[data-role="lyrics-sheet"]');
  const T = { cells: 0, overflow: [], small: [], place: [], line: [], lineColor: [], holdPainted: [], minFont: 99, crossCell: [], wrap: [], fullBeat: 0,
              holdOnly: [], rowHeadBad: [], sheetText: '', trip: [], scroll: null, cellW: 0, glyphs: 0 };
  out.sheet = T;
  if (!sheet) return out;
  T.sheetText = sheet.innerText || '';
  const work = sheet.closest('[data-role="work"]');
  T.scroll = work ? { scrollW: work.scrollWidth, clientW: work.clientWidth } : null;
  const cells = [...sheet.querySelectorAll('[data-role="cell"]')];
  const vis = cells.filter(shown);
  T.cells = vis.length;
  T.cellW = vis.length ? Math.min(...vis.map(c => c.clientWidth)) : 0;
  const geo = (c) => { const r = R(c); return { left: r.left + c.clientLeft, w: c.clientWidth, r }; };
  for (const h of sheet.querySelectorAll('[data-role="row-head"]')) if (!/^\d{2}$/.test(text(h))) T.rowHeadBad.push(text(h));
  for (const c of vis) {
    const g = geo(c), tag = '第 ' + c.dataset.bar + ' 小节第 ' + (+c.dataset.beat + 1) + ' 拍';
    const slots = [...c.querySelectorAll('[data-role="word"]')].filter(rendered);
    for (const s of slots) {
      const r = R(s), t = +s.dataset.tick;
      // v3.1：没有字框了，字框右边的断言删掉；字的左边照样按 tick 摆
      const wantL = g.left + g.w * t / 48 + 1;
      if (Math.abs(r.left - wantL) > 1.5) T.place.push(tag + ' tick ' + t + '：左边偏 ' + round(r.left - wantL) + 'px');
      const ch = s.querySelector('.ch');
      if (ch && text(ch)) {
        T.glyphs++;
        const gr = glyphRect(ch), fs = parseFloat(getComputedStyle(ch).fontSize);
        T.minFont = Math.min(T.minFont, fs);
        if (fs < args.minFont - 0.01) T.small.push(tag + '「' + text(ch) + '」字号 ' + fs + 'px');
        const gy = (gr.top + gr.bottom) / 2;   // Range 量到的是行框；CJK 字形高 = 字号
        // v3.1：「字挤出字框」改成字形不出格子
        if (gr.left < g.r.left - 0.5 || gr.right > g.r.right + 0.5 || gy - fs / 2 < g.r.top - 0.5 || gy + fs / 2 > g.r.bottom + 0.5)
          T.overflow.push(tag + '「' + text(ch) + '」字形出了格子（字 ' + round(gr.width) + 'px）');
      }
    }
    const marks = [...c.querySelectorAll('[data-role="triplet-mark"]')].filter(m => rendered(m) && text(m) === '3').length;
    const ticks = slots.map(s => +s.dataset.tick);
    if (ticks.some(t => t === 16 || t === 32 || t === 8 || t === 40)) T.trip.push({ tag, marks, t6: ticks.some(t => t === 8 || t === 40) });
    if (c.dataset.content === 'hold-only') { T.holdOnly.push(c.dataset.bar + ':' + c.dataset.beat); if (chroma(c)) T.holdPainted.push(tag); }
  }
  // 字的长度（v3.1：同色浅底，原来是细线）：按字逐个查（只查画出来的行）
  const rowsOrder = [...sheet.querySelectorAll('[data-role="row"]')].map(r => r.dataset.bar);
  const segsOf = {};
  for (const l of sheet.querySelectorAll('[data-role="hold-tint"]')) (segsOf[l.dataset.word] = segsOf[l.dataset.word] || []).push(l);
  for (const s of sheet.querySelectorAll('[data-role="word"]')) {
    const c = s.closest('[data-role="cell"]'), bar = c.dataset.bar, beat = +c.dataset.beat, t = +s.dataset.tick;
    const len = +s.dataset.len, box = +s.dataset.box, abs = +s.dataset.abs, tag = '第 ' + bar + ' 小节第 ' + (beat + 1) + ' 拍 tick ' + t;
    const id = [...Object.keys(segsOf)].find(k => segsOf[k].some(l => l.dataset.from === bar + ':' + beat + ':' + t));
    const segs = (id ? segsOf[id] : []).map(l => ({ l, c: l.closest('[data-role="cell"]') }));
    if (box >= len) { if (segs.length) T.line.push(tag + '：没拖却铺了浅底'); continue; }
    if (!segs.length) { T.line.push(tag + '：字拖了 ' + (len - box) + ' tick，却没有浅底'); continue; }
    const cellAbs = (x) => (rowsOrder.indexOf(x.c.dataset.bar)) * 192 + (+x.c.dataset.beat) * 48;
    segs.sort((a, b) => cellAbs(a) - cellAbs(b));
    const want = [];
    for (let a = Math.floor(abs / 48) * 48; a < abs + len; a += 48) want.push(a);
    if (want.join() !== segs.map(cellAbs).join()) { T.line.push(tag + '：浅底经过的格子不对'); continue; }
    if (len >= 48 - (t % 48) + 0 && segs.length === 1 && segs[0].c === c) T.fullBeat++;
    if (segs.some(x => x.c !== c && x.c.dataset.bar === bar)) T.crossCell.push(tag);
    if (segs.some(x => x.c.dataset.bar !== bar)) T.wrap.push(tag);
    if (!segs.every(x => shown(x.l) || rendered(x.l)) || !shown(s)) continue;
    // v3.1：「细线从字框右边开始」删掉（没有字框了），改成浅底从字的落点开始
    const first = R(segs[0].l), sr = R(s);
    if (Math.abs(first.left - sr.left) > 3) T.line.push(tag + '：浅底没从字的落点开始（差 ' + round(first.left - sr.left) + 'px）');
    const last = segs[segs.length - 1], lg = geo(last.c), endX = lg.left + lg.w * ((abs + len - cellAbs(last)) / 48);
    if (Math.abs(R(last.l).right - endX) > 4) T.line.push(tag + '：浅底没铺到字结束的地方（差 ' + round(R(last.l).right - endX) + 'px）');
    for (let i = 1; i < segs.length; i++) {
      const p = segs[i - 1], q = segs[i], pr = R(p.l), qr = R(q.l);
      if (p.c.dataset.bar === q.c.dataset.bar) {
        if (qr.left - pr.right > 1.5) T.line.push(tag + '：浅底在格线处断开 ' + round(qr.left - pr.right) + 'px');
      } else {
        if (Math.abs(pr.right - R(p.c).right) > 1.5) T.line.push(tag + '：折行前浅底没铺到这一行最后');
        if (+q.c.dataset.beat !== 0 || Math.abs(qr.left - geo(q.c).left) > 1.5) T.line.push(tag + '：折行后浅底没从下一行开头接着铺');
      }
    }
    // 颜色跟字走：韵脚字 = 这一格的颜色（同一色相）；没涂色的字 = 字色的淡色（同一个颜色、带透明度）
    const lc = parse(getComputedStyle(segs[0].l).backgroundColor), ch = s.querySelector('.ch');
    const cellC = chroma(c);
    if (s.dataset.rhyme && cellC) {
      const x = lc && hsl(lc);
      if (!x || x.s < 0.2 || hueDist(x.h, cellC.h) > 15) T.lineColor.push(tag + '：韵脚字的浅底不是这一格的颜色');
    } else if (ch && text(ch)) {
      const cc = parse(getComputedStyle(ch).color);
      if (!lc || !cc || lc[3] > 0.5 || [0, 1, 2].some(i => Math.abs(lc[i] - cc[i]) > 2)) T.lineColor.push(tag + '：浅底颜色不是字色的淡色');
    }
  }
  return out;
}
"""


def hue_purple(h):
    return h is not None and 250 <= h["h"] <= 310 and h["s"] > 0.1


class Run:
    def __init__(self, target, shots):
        self.url = target.resolve().as_uri()
        self.shots = shots
        self.F = []

    def fail(self, tag, msg):
        self.F.append(f"[{tag}] {msg}")

    def page(self, browser, size="desktop", scheme="light", init=None):
        w, h = SIZES[size]
        mobile = size == "mobile"
        ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=scheme, device_scale_factor=2 if mobile else 1,
                                  is_mobile=mobile, has_touch=mobile)
        if init:
            ctx.add_init_script(init)
        page = ctx.new_page()
        page.errors, page.external = [], []
        page.on("console", lambda m: page.errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda exc: page.errors.append(str(exc)))
        page.on("request", lambda r: page.external.append(r.url) if not r.url.startswith(("file:", "data:", "about:", "blob:")) else None)
        page.route(re.compile(r"^(?!file:|data:|about:|blob:)"), lambda route: route.abort())
        page.goto(self.url, timeout=20000)
        page.wait_for_selector('[data-role="lyrics-sheet"]', timeout=15000)
        page.wait_for_timeout(250)
        return ctx, page

    def shot(self, page, name):
        if self.shots:
            page.screenshot(path=str(self.shots / f"{name}.png"))

    def probe(self, page):
        return page.evaluate(PROBE_JS, {"words": list(BANNED_TEXT), "minFont": MIN_FONT})

    def tail(self, tag, page):
        for e in page.errors:
            self.fail(tag, f"控制台错误：{e}")
        for u in page.external:
            self.fail(tag, f"外网请求：{u}")
        page.errors.clear()
        page.external.clear()

    # ---------- 通用 + 表格 ----------
    def common(self, tag, info, mobile, h):
        for u in info["uppercase"][:3]:
            self.fail(tag, f"用了 text-transform:uppercase：{u}")
        for p in info["purple"][:3]:
            self.fail(tag, f"页面上有紫色：{p}")
        if hue_purple(info["accent"]) or info["accent"] is None:
            self.fail(tag, f"强调色是紫色或读不到：{info['accent']}")
        for b in info["banned"]:
            self.fail(tag, f"可见文本含 {b}")
        if info["rec"]:
            self.fail(tag, f"录音：页面上有 {info['rec']} 个录音键 / 音轨")
        if info["ai"]:
            self.fail(tag, f"AI 入口：页面上挂着 {info['ai']} 个 AI / Worker 元素")
        if info["undo"] < 1 or info["redo"] < 1:
            self.fail(tag, f"撤销 / 重做键不全（{info['undo']} / {info['redo']}）")
        if info["play"] != 1:
            self.fail(tag, f"可见的播放键 {info['play']} 个，应该正好 1 个")
        if not info["sections"] or any(not SECTION_RE.match(s) for s in info["sections"]):
            self.fail(tag, f"段落标签不是英文 Intro/Verse/Hook/Bridge/Outro：{info['sections']}")
        if info["nonWord"]:
            self.fail(tag, f"表格里有 {info['nonWord']} 个不是「字」的字格（拖音应该是字的长度，不是单独的格子）")
        if mobile:
            d = info["drawer"]
            if not d or d["bottom"] < h - 2 or d["height"] > 64:
                self.fail(tag, f"手机押韵抽屉没贴底或没收起：{d}")
        T = info["sheet"]
        if not T["cells"]:
            self.fail(tag, "找不到看得见的歌词表格")
            return
        if "续" in T["sheetText"]:
            self.fail(tag, "表格里出现「续」（一句超过一小节折到下一行，不加续行标记）")
        if T["rowHeadBad"]:
            self.fail(tag, f"行头不只是两位小节号：{T['rowHeadBad'][:3]}")
        for key, label in (("overflow", "字挤出格子"), ("small", "字号小于最小字宽 11px"), ("place", "tick 落点"), ("line", "字的长度浅底"),
                           ("lineColor", "浅底颜色"), ("holdPainted", "只有拖音的格子被涂了色")):
            for x in T[key][:5]:
                self.fail(tag, f"{label}：{x}")
            if len(T[key]) > 5:
                self.fail(tag, f"{label}：另有 {len(T[key]) - 5} 处")
        for tr in T["trip"]:
            if tr["marks"] != (2 if tr["t6"] else 1):
                self.fail(tag, f"{tr['tag']} 三连标记 {tr['marks']} 个")

    # ---------- 场景 ----------
    def baseline(self, browser):
        bg = {}
        for size, (w, h) in SIZES.items():
            for scheme in SCHEMES:
                tag = f"首屏 {size} {scheme}"
                ctx, page = self.page(browser, size, scheme)
                try:
                    self.shot(page, f"app_{size}_{scheme}")
                    info = self.probe(page)
                    self.common(tag, info, size == "mobile", h)
                    bg[(size, scheme)] = info["pageBg"]
                    T = info["sheet"]
                    if size == "desktop":
                        if not T["crossCell"]:
                            self.fail(tag, "跨格浅底：没有一个字的浅底越过格线拖进下一格（夜车第 5 小节「拍」）")
                        if not T["wrap"]:
                            self.fail(tag, "跨行浅底：没有一个字的浅底拖到下一行开头（夜车第 6 小节「口」）")
                        if not T["holdOnly"]:
                            self.fail(tag, "没有只有拖音的格子（夜车第 7 小节第 2 拍）")
                        if not T["fullBeat"]:
                            self.fail(tag, "没有拖满本拍的字（夜车第 3 小节「霓」）")
                    else:
                        if not T["trip"]:
                            self.fail(tag, "手机首屏看不到三连的格子")
                        if T["glyphs"] < 40:
                            self.fail(tag, f"手机首屏量到的字太少（{T['glyphs']}）")
                        if T["scroll"] and T["scroll"]["scrollW"] > T["scroll"]["clientW"] + 1:
                            self.fail(tag, f"没有 1/32 的作品在手机上不该左右滑（{T['scroll']}）")
                    self.tail(tag, page)
                finally:
                    ctx.close()
        for size in SIZES:
            if bg.get((size, "dark")) is not None and bg.get((size, "light")) is not None and bg[(size, "dark")] >= bg[(size, "light")]:
                self.fail(f"首屏 {size}", "深色模式没生效")

    def hold_only(self, browser):
        tag = "只有拖音的格不能涂色"
        ctx, page = self.page(browser)
        try:
            cell = page.locator('[data-role="row"][data-bar="7"] [data-role="cell"][data-beat="1"]')
            if cell.get_attribute("data-content") != "hold-only":
                self.fail(tag, f"第 7 小节第 2 拍应该只有拖音，现在 {cell.get_attribute('data-content')}")
            cell.click(position={"x": 30, "y": 8})
            page.wait_for_timeout(100)
            tip = page.locator('[data-role="hold-only-tip"]')
            if not tip.is_visible() or "这一拍只有拖音" not in tip.inner_text() or "不能涂色" not in tip.inner_text():
                self.fail(tag, "点只有拖音的格子没有出「这一拍只有拖音 · 不能涂色」的提示")
            self.shot(page, "hold_only_tip_desktop_light")
            page.locator('[data-role="row-head"][data-bar="7"]').click()
            page.locator('[data-role="swatch"]').nth(3).click()
            page.locator('[data-role="paint"]').click()
            page.wait_for_timeout(150)
            toast = page.locator('[data-role="toast"]')
            if not toast.count() or "跳过" not in toast.inner_text():
                self.fail(tag, "整行涂色时没提示跳过只有拖音的格子")
            bg = page.evaluate("""() => getComputedStyle(document.querySelector('[data-role="row"][data-bar="7"] [data-role="cell"][data-beat="1"]')).backgroundColor""")
            painted = page.evaluate("""() => [...document.querySelectorAll('[data-role="row"][data-bar="7"] [data-role="cell"]')].map(c => c.classList.contains('painted'))""")
            if painted[1] or "rgb(255, 255, 255)" not in bg:
                self.fail(tag, f"只有拖音的格子被涂上了颜色（{bg}，{painted}）")
            if not painted[0]:
                self.fail(tag, f"同一行有字的格子应该涂上（{painted}）")
            stored = page.evaluate("""() => { const id = localStorage.getItem('anybeats.current.v2'); return null; }""")
            del stored
            self.tail(tag, page)
        finally:
            ctx.close()

    def merge(self, browser):
        tag = "两色同韵自动合并"
        ctx, page = self.page(browser)
        try:
            n0 = page.locator('[data-role="swatches"] [data-role="swatch"]').count()
            page.locator('[data-role="add-rule"]').first.click()
            page.wait_for_timeout(80)
            if page.locator('[data-role="swatches"] [data-role="swatch"]').count() != n0 + 1:
                self.fail(tag, "点「+」没有新建颜色")
            # 先用新颜色涂第 2 小节第 1 拍
            page.locator('[data-role="row"][data-bar="2"] [data-role="cell"][data-beat="0"]').click(position={"x": 4, "y": 4})
            page.locator('[data-role="paint"]').click()
            page.locator('[data-role="count-opt"]').nth(1).click()
            fins = page.locator('[data-role="final-input"]')
            fins.nth(0).fill("u")
            fins.nth(0).press("Enter")
            page.wait_for_timeout(50)
            fins = page.locator('[data-role="final-input"]')
            fins.nth(1).fill("ou")
            fins.nth(1).press("Enter")
            page.wait_for_timeout(150)
            n1 = page.locator('[data-role="swatches"] [data-role="swatch"]').count()
            if n1 != n0:
                self.fail(tag, f"定成和粉色同韵（双押 u · ou）后没合并：色块 {n0} → {n1}")
            toast = page.locator('[data-role="toast"]')
            if not toast.count() or "合并" not in toast.inner_text():
                self.fail(tag, "合并后没有提示")
            hue = page.evaluate("""() => { const c = getComputedStyle(document.querySelector('[data-role="row"][data-bar="2"] [data-role="cell"][data-beat="0"]')).backgroundColor;
              const m = c.match(/\\d+(\\.\\d+)?/g).map(Number); const r=m[0]/255,g=m[1]/255,b=m[2]/255, mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
              if (d < 1e-6) return null; let h = mx===r?((g-b)/d)%6:mx===g?(b-r)/d+2:(r-g)/d+4; h*=60; if(h<0)h+=360; return h; }""")
            if hue is None or min(abs(hue - 340), 360 - abs(hue - 340)) > 12:
                self.fail(tag, f"新颜色涂过的格子没改成先建的粉色（色相 {hue}）")
            self.shot(page, "merge_desktop_light")
            page.locator('[data-role="undo"]').click()
            page.wait_for_timeout(100)
            if page.locator('[data-role="swatches"] [data-role="swatch"]').count() != n0 + 1:
                self.fail(tag, "合并应该只算一步：撤销一次没回到两种颜色")
            self.tail(tag, page)
        finally:
            ctx.close()

    def edit_word(self, page, bar, beat, which, text):
        """v3.1：双击格子改这一拍的字——把这一拍现在的字换掉第 which 个，整拍回车（位置够，按原节奏填）。"""
        cell = page.locator(f'[data-role="row"][data-bar="{bar}"] [data-role="cell"][data-beat="{beat}"]')
        words = cell.locator('[data-role="word"]')
        chars = [w.inner_text().strip() for w in words.all()]
        chars[which] = text
        cell.dblclick(position={"x": 3, "y": 3})
        inp = page.locator('[data-role="cell-editor"]')
        inp.wait_for(timeout=3000)
        inp.fill("".join(chars))
        inp.press("Enter")
        page.wait_for_timeout(60)
        if page.locator('[data-role="cell-editor"]').count():
            page.locator('[data-role="cell-editor"]').press("Escape")
        page.wait_for_timeout(60)
        return words.nth(which)

    def strict(self, browser):
        tag = "严格韵母比对"
        ctx, page = self.page(browser)
        try:
            sel = '[data-role="row"][data-bar="2"] [data-role="cell"][data-beat="3"] [data-role="word"]'
            if page.locator(sel).last.get_attribute("data-rhyme") != "ang":
                self.fail(tag, "第 2 小节第 4 拍最后一个字应该押 ang（蓝色 i · ang）")
            self.edit_word(page, 2, 3, -1, "想")
            mm = page.locator(sel).last.get_attribute("data-mismatch")
            outline = page.evaluate(f"""() => getComputedStyle(document.querySelectorAll('{sel}')[3]).outlineStyle""")
            if mm != "iang≠ang" or outline != "dashed":
                self.fail(tag, f"「想」（iang）押 ang 应该标出对不上（data-mismatch={mm}，描边 {outline}）")
            if not page.locator('[data-role="mismatch"]').filter(has_text="iang").count():
                self.fail(tag, "没有「对不上本格颜色」的提示")
            self.shot(page, "strict_mismatch_desktop_light")
            self.edit_word(page, 2, 3, -1, "方")
            if page.locator(sel).last.get_attribute("data-mismatch"):
                self.fail(tag, "改回「方」以后还标着对不上")
            self.tail(tag, page)
        finally:
            ctx.close()

    def history(self, browser):
        tag = "撤销 / 重做 / 刷新"
        ctx, page = self.page(browser)
        try:
            self.edit_word(page, 2, 0, 0, "早")
            self.edit_word(page, 2, 0, 1, "上")
            page.locator('[data-role="undo"]').click()
            page.wait_for_timeout(80)
            if page.locator('[data-role="redo"]').is_disabled():
                self.fail(tag, "撤销以后重做键应该能点")
            self.edit_word(page, 3, 1, 0, "雨")
            if not page.locator('[data-role="redo"]').is_disabled():
                self.fail(tag, "撤销后又做了新改动，可重做的步骤应该丢掉（重做键还能点）")
            page.locator('[data-role="history-btn"]').click()
            page.wait_for_timeout(80)
            redo_rows = page.locator('[data-role="history-entry"].redo').count()
            entries = page.locator('[data-role="history-entry"]').all_inner_texts()
            if redo_rows:
                self.fail(tag, f"历史面板里还有 {redo_rows} 条可重做的步骤")
            if not any("填字" in e and "雨" in e for e in entries):
                self.fail(tag, f"历史面板里没有最后那步填字：{entries[:3]}")
            if not page.locator('[data-role="history-current"]').is_visible():
                self.fail(tag, "历史面板没有「现在在这里」")
            self.shot(page, "history_desktop_light")
            page.keyboard.press("Escape")
            page.wait_for_timeout(1300)  # 等自动保存（1 秒）
            page.reload()
            page.wait_for_selector('[data-role="lyrics-sheet"]')
            page.wait_for_timeout(250)
            if page.locator('[data-role="undo"]').is_disabled():
                self.fail(tag, "刷新以后撤销键不能点：历史没跟作品一起存")
            page.locator('[data-role="history-btn"]').click()
            page.wait_for_timeout(80)
            entries = page.locator('[data-role="history-entry"]').all_inner_texts()
            if not any("雨" in e for e in entries) or not any("早" in e for e in entries):
                self.fail(tag, f"刷新以后历史面板里没有刚才的步骤：{entries[:4]}")
            page.keyboard.press("Escape")
            first = '[data-role="row"][data-bar="3"] [data-role="cell"][data-beat="1"] [data-role="word"] .ch'
            before = page.locator(first).first.inner_text()
            page.locator('[data-role="undo"]').click()
            page.wait_for_timeout(100)
            after = page.locator(first).first.inner_text()
            if before != "雨" or after == "雨":
                self.fail(tag, f"刷新以后撤销没生效（{before} → {after}）")
            self.tail(tag, page)
        finally:
            ctx.close()

    def bpm(self, browser, wav):
        for size in ("desktop", "mobile"):
            tag = f"换伴奏 BPM 弹窗 {size}"
            ctx, page = self.page(browser, size)
            try:
                ticks0 = page.evaluate("""() => [...document.querySelectorAll('[data-role="word"]')].map(s => s.dataset.abs).join()""")
                page.locator('[data-role="beat-file"]').set_input_files(str(wav))
                try:
                    page.wait_for_selector('[data-role="bpm-dialog"]', timeout=15000)
                except Exception:  # noqa: BLE001
                    self.fail(tag, f"载入 100 BPM 的伴奏后没弹出 BPM 二选一（{page.locator('[data-role=track-area]').inner_text()[:80]}）")
                    continue
                page.wait_for_timeout(150)
                opts = page.locator('[data-role="bpm-option"]')
                if opts.count() != 2:
                    self.fail(tag, f"弹窗应该正好两个选项，现在 {opts.count()} 个")
                texts = opts.all_inner_texts()
                rec = page.evaluate("""() => [...document.querySelectorAll('[data-role="bpm-option"]')].map(o => ({ choice: o.dataset.choice, rec: o.dataset.recommended === '1',
                    focused: document.activeElement === o, border: getComputedStyle(o).borderTopColor, text: o.innerText }))""")
                accent = page.evaluate("""() => { const p = document.createElement('div'); p.style.color = getComputedStyle(document.documentElement).getPropertyValue('--ab-accent'); document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; }""")
                adopt = [o for o in rec if o["choice"] == "adopt"]
                keep = [o for o in rec if o["choice"] == "keep"]
                if not adopt or not keep or "改用新 BPM" not in adopt[0]["text"] or "保留原 BPM" not in keep[0]["text"]:
                    self.fail(tag, f"弹窗选项不对：{texts}")
                elif not (adopt[0]["rec"] and adopt[0]["focused"] and "推荐" in adopt[0]["text"] and adopt[0]["border"] == accent) or keep[0]["rec"] or "推荐" == keep[0]["text"].split("\n")[-1]:
                    self.fail(tag, f"默认应该推荐并聚焦「改用新 BPM」：{rec}")
                dlg = page.locator('[data-role="bpm-dialog"]').inner_text()
                for w in ("跟着拍子走", "不跟秒数"):
                    if w not in dlg:
                        self.fail(tag, f"弹窗没说明歌词「{w}」")
                self.shot(page, f"bpm_dialog_{size}_light")
                page.keyboard.press("Enter")
                page.wait_for_timeout(200)
                if page.locator('[data-role="bpm-dialog"]').count():
                    self.fail(tag, "回车（默认选项）以后弹窗没关")
                bpm = page.locator('[data-role="bpm"]').first.inner_text()
                if bpm.strip() != "100":
                    self.fail(tag, f"选了「改用新 BPM」以后 BPM 应该是 100，现在 {bpm}")
                ticks1 = page.evaluate("""() => [...document.querySelectorAll('[data-role="word"]')].map(s => s.dataset.abs).join()""")
                if ticks0 != ticks1:
                    self.fail(tag, "换 BPM 以后字的 tick 变了（应该跟着拍子走，tick 不变）")
                page.locator('[data-role="history-btn"]').click()
                if not page.locator('[data-role="history-entry"][data-type="beat"]').count():
                    self.fail(tag, "换伴奏没进撤销历史")
                self.tail(tag, page)
            finally:
                ctx.close()

    def dense(self, browser, project_file):
        for size in ("mobile", "desktop"):
            tag = f"1/32 和三连 {size}"
            ctx, page = self.page(browser, size)
            try:
                page.locator('[data-role="open-export"], [data-role="open-export-m"]').locator("visible=true").first.click()
                page.locator('[data-role="import-file"]').set_input_files(str(project_file))
                page.wait_for_timeout(300)
                if size == "mobile":
                    page.locator('[data-role="rhyme-drawer"] .grab').click()
                    page.wait_for_timeout(150)
                info = self.probe(page)
                T = info["sheet"]
                self.common(tag, info, size == "mobile", SIZES[size][1])
                self.shot(page, f"dense_{size}_light")
                sc = T["scroll"] or {}
                if size == "mobile":
                    if not (sc.get("scrollW", 0) > sc.get("clientW", 0) + 20):
                        self.fail(tag, f"带 1/32 的作品在手机 390 上应该整张表左右滑（{sc}）")
                    if T["cellW"] < 110:
                        self.fail(tag, f"左右滑时每拍至少 112px，现在最窄 {T['cellW']}px")
                    page.evaluate("""() => { const w = document.querySelector('[data-role="work"]'); w.scrollLeft = w.scrollWidth; }""")
                    page.wait_for_timeout(100)
                    info2 = self.probe(page)
                    for x in info2["sheet"]["overflow"][:3] + info2["sheet"]["small"][:3]:
                        self.fail(tag + " 滑到右边", x)
                    head = page.evaluate("""() => { const h = document.querySelector('[data-role="row-head"]'); const w = document.querySelector('[data-role="work"]');
                        return h.getBoundingClientRect().left - w.getBoundingClientRect().left; }""")
                    if head > 12:
                        self.fail(tag, f"左右滑时行头应该贴在左边（离左边 {head}px）")
                    self.shot(page, f"dense_{size}_light_scrolled")
                elif sc.get("scrollW", 0) > sc.get("clientW", 0) + 1:
                    self.fail(tag, f"桌面格子够宽，不该左右滑（{sc}）")
                if T["glyphs"] < 20:
                    self.fail(tag, f"量到的字太少（{T['glyphs']}）")
                if not any(t["t6"] for t in T["trip"]) or not any(not t["t6"] for t in T["trip"]):
                    self.fail(tag, "画面里应该同时有三连和半拍三连")
                self.tail(tag, page)
            finally:
                ctx.close()

    def flow(self, browser):
        tag = "铺 flow：字的长度"
        ctx, page = self.page(browser)
        try:
            page.locator('[data-role="steps"] button[data-step="1"]').first.click()
            cell = page.locator('[data-role="row"][data-bar="1"] [data-role="cell"][data-beat="0"]')
            box = cell.bounding_box()
            cell.click(position={"x": box["width"] * 0.3, "y": box["height"] / 2})
            page.wait_for_timeout(100)
            slots = cell.locator('[data-role="word"]')
            if slots.count() != 1 or slots.first.get_attribute("data-tick") != "12" or slots.first.get_attribute("data-len") != "12":
                self.fail(tag, f"按 1/16 点在第 1 拍 30% 处应该放一个 tick 12、长 12 的字（{slots.count()} 个）")
            page.keyboard.press("-")
            page.wait_for_timeout(80)
            if slots.first.get_attribute("data-len") != "24":
                self.fail(tag, f"按 - 应该多拖一个精度单位（长 24），现在 {slots.first.get_attribute('data-len')}")
            if not cell.locator('[data-role="hold-tint"]').count():
                self.fail(tag, "字拖长以后后面没有浅底")
            grip = page.locator(f'[data-role="hold-grip"][data-word="{slots.first.get_attribute("data-word")}"]')
            g = grip.bounding_box()
            target = page.locator('[data-role="row"][data-bar="1"] [data-role="cell"][data-beat="1"]').bounding_box()
            page.mouse.move(g["x"] + g["width"] / 2, g["y"] + g["height"] / 2)
            page.mouse.down()
            page.mouse.move(target["x"] + target["width"] * 0.5, target["y"] + target["height"] / 2, steps=6)
            page.mouse.up()
            page.wait_for_timeout(120)
            ln = slots.first.get_attribute("data-len")
            if ln != "60":
                self.fail(tag, f"拖右边缘到第 2 拍中间应该拉到长 60（12 → 72 tick），现在 {ln}")
            nxt = page.locator('[data-role="row"][data-bar="1"] [data-role="cell"][data-beat="1"] [data-role="hold-tint"]')
            if not nxt.count():
                self.fail(tag, "拉过格线以后，下一格里没有接着铺的浅底")
            info = self.probe(page)
            for x in info["sheet"]["line"][:3]:
                self.fail(tag, x)
            self.shot(page, "flow_desktop_light")
            page.locator('[data-role="history-btn"]').click()
            if page.locator('[data-role="history-entry"][data-type="flow"]').count() < 3:
                self.fail(tag, "铺 flow 的每一步都应该进撤销历史")
            self.tail(tag, page)
        finally:
            ctx.close()

    def migrate(self, browser):
        tag = "存量 v2 作品迁移"
        v2 = json.dumps(V2_PROJECT, ensure_ascii=False)
        init = ("if (!localStorage.getItem('e2e.seeded')) { localStorage.clear();"
                f"localStorage.setItem('anybeats.project.v2.pold', {json.dumps(v2)});"
                "localStorage.setItem('anybeats.library.v2', JSON.stringify([{id:'pold', name:'旧作品', updatedAt: 5, bars: 2}]));"
                "localStorage.setItem('anybeats.current.v2', 'pold'); localStorage.setItem('e2e.seeded', '1'); }")
        ctx, page = self.page(browser, init=init)
        try:
            info = self.probe(page)
            labels = info["sections"]
            if "Verse 1" not in labels or "Hook" not in labels:
                self.fail(tag, f"迁移后段落名应该是英文（Verse 1 / Hook），现在 {labels}")
            words = page.evaluate("""() => [...document.querySelectorAll('[data-role="lyrics-sheet"] [data-role="word"]')].map(s => [s.closest('[data-role="cell"]').dataset.bar, s.dataset.abs, s.dataset.len, s.innerText.trim()])""")
            want = [["1", "0", "12", "我"], ["1", "12", "36", "来"], ["2", "264", "60", "了"]]
            got = [w for w in words if w[3]]
            if got != want:
                self.fail(tag, f"迁移后的字 / 落点 / 长度不对：{got}，应该 {want}")
            backup = page.evaluate("() => localStorage.getItem('anybeats.backup.v2.pold')")
            if backup != v2:
                self.fail(tag, "迁移前的原文没留在备份键 anybeats.backup.v2.<id>")
            self.edit_word(page, 1, 0, 0, "你")
            page.wait_for_timeout(1300)
            raw = page.evaluate("() => localStorage.getItem('anybeats.project.v2.pold')")
            backup2 = page.evaluate("() => localStorage.getItem('anybeats.backup.v2.pold')")
            if not raw or json.loads(raw).get("version") != 3 or backup2 != v2:
                self.fail(tag, "改动后正文应该存成 v3，备份键里的原文不变")
            self.tail(tag, page)
        finally:
            ctx.close()


# 第一期（v2）格式的小作品：「我」1 格，「来」1 格 + 延音 2 格，第 2 小节「了」2 格 + 下一小节开头的延音 3 格
V2_PROJECT = {
    "schema": "anybeats.project", "version": 2, "name": "旧作品", "createdAt": 1, "updatedAt": 5, "bpm": 90, "offsetMs": 0,
    "timeSignature": "4/4", "stepsPerBar": 16,
    "sections": [
        {"id": "s1", "kind": "verse", "label": "主歌 1", "bars": [
            {"id": "b1", "clips": [{"id": "c1", "start": 0, "length": 1, "text": "我", "accent": True, "hold": False},
                                   {"id": "c2", "start": 1, "length": 1, "text": "来", "accent": False, "hold": False},
                                   {"id": "c3", "start": 2, "length": 2, "text": "", "accent": False, "hold": True}]}]},
        {"id": "s2", "kind": "chorus", "label": "副歌", "bars": [
            {"id": "b2", "clips": [{"id": "c4", "start": 6, "length": 2, "text": "了", "accent": False, "hold": False},
                                   {"id": "c5", "start": 8, "length": 3, "text": "", "accent": False, "hold": True}]}]},
    ],
}


def write_beat(path, bpm=100.0, seconds=14.0, sr=44100):
    """一段 100 BPM 的鼓：每拍底鼓、二四拍军鼓、八分踩镲。"""
    rnd = random.Random(7)
    n = int(seconds * sr)
    buf = [0.0] * n
    beat = 60.0 / bpm
    t = 0.0
    k = 0
    while t < seconds:
        start = int(t * sr)
        for i in range(int(0.18 * sr)):
            if start + i >= n:
                break
            x = i / sr
            buf[start + i] += 0.9 * math.sin(2 * math.pi * (55 + 90 * math.exp(-x * 30)) * x) * math.exp(-x * 18)
        if k % 2 == 1:
            for i in range(int(0.12 * sr)):
                if start + i < n:
                    buf[start + i] += 0.45 * (rnd.random() * 2 - 1) * math.exp(-i / sr * 30)
        for half in (0, 1):
            hs = int((t + half * beat / 2) * sr)
            for i in range(int(0.03 * sr)):
                if hs + i < n:
                    buf[hs + i] += 0.12 * (rnd.random() * 2 - 1) * math.exp(-i / sr * 120)
        t += beat
        k += 1
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"".join(struct.pack("<h", max(-32767, min(32767, int(v * 26000)))) for v in buf))


def dense_project():
    """一首带三连、半拍三连、1/32 的 v3 作品（导入用）。"""
    def word(i, tick, ln, text):
        return {"id": f"w{i}", "tick": tick, "len": ln, "text": text}
    bars = []
    seq = 0

    def bar(ws):
        nonlocal seq
        seq += 1
        return {"id": f"d{seq}", "words": [word(f"{seq}_{i}", t, ln, x) for i, (t, ln, x) in enumerate(ws)]}
    plain = [(i * 12, 12, c) for i, c in enumerate("凌晨三点街灯还在路上找个地方吹向")]
    trip3 = [(b * 48 + j * 16, 16, c) for b in range(4) for j, c in enumerate("我不怕走得慢风在吹灯在闪"[b * 3:b * 3 + 3])]
    trip6 = [(b * 48 + j * 8, 8, c) for b in range(2) for j, c in enumerate("不管路有多远我们一起往前"[b * 6:b * 6 + 6])] + [(96 + j * 12, 12, c) for j, c in enumerate("冲过路口灯火")]
    w32 = [(0, 12, "踩"), (12, 6, "在"), (18, 6, "节"), (24, 24, "拍"), (48, 6, "一"), (54, 6, "个"), (60, 6, "一"), (66, 6, "个"), (72, 12, "往"), (84, 12, "前"),
           (96, 12, "每"), (108, 6, "一"), (114, 6, "步"), (120, 24, "都"), (144, 12, "到"), (156, 6, "地"), (162, 30, "方")]
    bars = [bar(plain), bar(trip3), bar(trip6), bar(w32)]
    return {
        "schema": "anybeats.project", "version": 3, "name": "密集", "createdAt": 1, "updatedAt": 2, "bpm": 92, "offsetMs": 0,
        "timeSignature": "4/4", "ticksPerBeat": 48, "beat": None,
        "sections": [{"id": "sv", "kind": "verse", "label": "Verse 1", "bars": bars[:1]}, {"id": "sb", "kind": "bridge", "label": "Bridge", "bars": bars[1:]}],
        "rules": [{"id": "rA", "hue": 215, "count": 2, "finals": ["i", "ang"]}], "paint": {"d4:3": "rA"},
        "locks": {"bars": [], "beats": [], "cells": [], "rhyme": False},
    }


def main():
    args = sys.argv[1:]
    shots = None
    if "--shots" in args:
        i = args.index("--shots")
        shots = pathlib.Path(args[i + 1]).resolve()
        shots.mkdir(parents=True, exist_ok=True)
        del args[i:i + 2]
    target = pathlib.Path(args[0] if args else "dist/index.html")
    if not target.exists():
        print(f"FAIL：找不到构建产物 {target}（先 npm run build）")
        return 1
    run = Run(target, shots)
    with tempfile.TemporaryDirectory() as tmp:
        wav = pathlib.Path(tmp) / "雨夜_beat.wav"
        write_beat(wav)
        proj = pathlib.Path(tmp) / "密集.anybeats"
        proj.write_text(json.dumps(dense_project(), ensure_ascii=False), encoding="utf-8")
        with sync_playwright() as p:
            browser = p.chromium.launch()
            steps = [run.baseline, run.hold_only, run.merge, run.strict, run.history, lambda b: run.bpm(b, wav), lambda b: run.dense(b, proj), run.flow, run.migrate]
            for step in steps:
                try:
                    step(browser)
                except Exception as exc:  # noqa: BLE001  一个场景出错不影响其它场景，但算失败
                    run.fail(getattr(step, "__name__", "场景"), f"检查出错：{str(exc).splitlines()[0]}")
            browser.close()
    if run.F:
        print(f"FAIL：{len(run.F)} 项不满足")
        for f in run.F:
            print("  - " + f)
        return 1
    print("OK：构建产物在桌面 / 手机 × 浅 / 深色下全部断言通过（拖音浅底、只有拖音不能涂色、折行无续、同韵合并、严格韵母、单线撤销、刷新保留历史、BPM 默认推荐新 BPM、无录音 / AI、1/32 左右滑、铺 flow、v2 迁移）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
