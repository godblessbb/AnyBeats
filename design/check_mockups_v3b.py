"""AnyBeats v3b 补充视觉稿自动检查（浏览器实测，不 grep 源码）。

用法：python -I design/check_mockups_v3b.py design [证据目录]

对 design/mockups_v3b/ 的 3 个画面（drag / wrap / dense）× 桌面 1280×800 / 手机 390×844 × 浅 / 深色：
截图到 design/screenshots_v3b/<画面>_<desktop|mobile>_<light|dark>.png（给了证据目录就再拷一份到 <证据目录>/screenshots_v3b/），
再在浏览器里量算断言。

通用：
  - 无控制台错误 / 页面异常；无外网请求；无 text-transform: uppercase；任何可见元素的字色 / 底色 / 边线不是紫色（250–310°）
  - 可见文字里没有：∅、Worker、录音、AI、中文段落名；表格里没有「续」；段落标签全是英文；撤销、重做可见；可见播放键正好 1 个
  - 数据里只有字：表格里不能有 data-kind 不是 word 的字格（v3 的拖音格 / 空音格作废）
  - 手机：押韵抽屉贴底、收起 ≤ 64px
表格（只量看得见的格子）：
  - 字不挤出格子：每个字的字形框在它的字框里、字框在它的格子里（±0.5px）；字号 ≥ 11px
  - 字框按 tick 摆：左边 = 格左 + tick/48 × 格宽，右边 = 格左 + (tick + 框长)/48 × 格宽（±1.5px），1/32 也一样（不上下叠）
  - 拖音细线：每个比字框长的字，细线从字框右边一直画到它结束的 tick；跨格时相邻两段在格线处接上（缝 ≤ 1.5px），
    跨行时上一行画到最后一格右边、下一行从第一格左边接着画；线色跟字走（韵脚字 = 这一格的颜色，没涂色 = 字色）
  - 只有拖音、没有新字的格子不能涂色（没有彩色底）
画面专属：
  drag  有拖满本拍的字、有字 + 空音、有拖过格线的字、有拖到下一行的字、有只有拖音的格子；
        点过的那一格旁边看得见「这一拍只有拖音」「不能涂色」的提示
  wrap  有一句话的字跨两行；那一行的行头只有小节号（两位数字），没有任何别的标记；上下两行的列对齐
  dense 手机上：作品里有 1/32 → 整张表左右滑（每拍格子里面 ≥ 112px），有去边线的半拍三连字框，三连格一个「3」、半拍三连两个「3」；
        桌面上不滑。哪里都没有上下叠的字框（用户 11-16 定：1/32 不上下叠，改成整张表可左右滑）
任何一项不满足，退出码 1。只用标准库 + playwright（sync API）。
"""

import pathlib
import re
import shutil
import sys

from playwright.sync_api import sync_playwright

SIZES = {"desktop": (1280, 800), "mobile": (390, 844)}
SCHEMES = ("light", "dark")
SCREENS = ("drag", "wrap", "dense")
BANNED_TEXT = ("∅", "Worker", "录音", "AI", "前奏", "主歌", "副歌", "桥段", "尾奏")
SHEET_BANNED = ("续",)   # 一句折到下一行不加续行标记：表格里（行头、格子、行尾）不能出现
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
  const chroma = (el) => {
    const c = parse(getComputedStyle(el).backgroundColor);
    if (!c || c[3] < 0.1) return null;
    const x = hsl(c);
    if (x.s < 0.2 || x.l < 0.06 || x.l > 0.97) return null;
    return x;
  };
  const round = (v) => Math.round(v * 10) / 10;
  // 字形实际占的框：用 Range 量文字本身
  const glyphRect = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); };

  const out = { uppercase: [], purple: [], banned: [], undo: 0, redo: 0, play: 0, sections: [], drawer: null, nonWord: 0 };
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
  let vt = document.body.innerText || '';
  for (const el of document.querySelectorAll('input')) if (rendered(el)) vt += '\n' + el.value;
  for (const w of args.words) if (vt.includes(w)) { const i = vt.indexOf(w); out.banned.push(w + '：…' + vt.slice(Math.max(0, i - 12), i + 12).replace(/\s+/g, ' ') + '…'); }
  const big = (el) => visible(el) && R(el).width >= 28 && R(el).height >= 28;
  out.undo = [...document.querySelectorAll('[data-role="undo"]')].filter(big).length;
  out.redo = [...document.querySelectorAll('[data-role="redo"]')].filter(big).length;
  out.play = [...document.querySelectorAll('[data-role="play"], [aria-label*="播放"]')].filter(visible).length;
  out.sections = [...document.querySelectorAll('[data-role="section-label"]')].filter(rendered).map(text);
  const dr = document.querySelector('[data-role="rhyme-drawer"]');
  if (dr && rendered(dr)) out.drawer = { height: R(dr).height, bottom: R(dr).bottom };
  out.nonWord = [...document.querySelectorAll('[data-role="slot"]')].filter(s => s.dataset.kind !== 'word').length;
  const sh = document.querySelector('[data-role="lyrics-sheet"]');
  out.sheetBanned = sh ? args.sheetWords.filter(w => (sh.innerText || '').includes(w)) : [];

  // ---- 表格 ----
  const sheet = document.querySelector('[data-role="lyrics-sheet"]');
  const wk = document.querySelector('main.work');
  const T = { cells: 0, overflow: [], small: [], place: [], stack: [], line: [], lineColor: [], holdPainted: [], minFont: 99,
              scroll: wk ? { sw: wk.scrollWidth, cw: wk.clientWidth } : null, cellW: 0,
              stacked: 0, dense: 0, trip3: [], trip6: [], cases: {}, holdOnly: [], tip: null, wrapSent: null, rowHeadBad: [], colAlign: [] };
  out.sheet = T;
  if (!sheet) return out;
  const cells = [...sheet.querySelectorAll('[data-role="cell"]')];
  const vis = cells.filter(c => rendered(c) && inView(R(c)));
  T.cells = vis.length;
  T.cellW = vis.length ? Math.min(...vis.map(c => c.clientWidth)) : 0;
  const geo = (c) => { const r = R(c); return { left: r.left + c.clientLeft, w: c.clientWidth, r }; };
  const keyOf = (c) => c.dataset.bar + ':' + c.dataset.beat;
  const cellAt = {};
  for (const c of cells) cellAt[keyOf(c)] = c;
  const rowsOrder = [...sheet.querySelectorAll('[data-role="row"]')].map(r => +r.dataset.bar);

  for (const c of vis) {
    const g = geo(c), tag = '第 ' + c.dataset.bar + ' 小节第 ' + (+c.dataset.beat + 1) + ' 拍';
    const slots = [...c.querySelectorAll('[data-role="slot"]')].filter(rendered);
    const pairs = {};
    for (const s of slots) {
      const r = R(s), t = +s.dataset.tick, box = +s.dataset.box, stk = s.dataset.stack;
      if (stk) T.stack.push(tag + ' tick ' + t + '：字框上下叠了（应该整张表左右滑）');
      // 字框在格子里
      if (r.left < g.r.left - 0.5 || r.right > g.r.right + 0.5 || r.top < g.r.top - 0.5 || r.bottom > g.r.bottom + 0.5)
        T.overflow.push(tag + ' tick ' + t + '：字框出了格子');
      const ch = s.querySelector('.ch');
      if (ch && text(ch)) {
        const gr = glyphRect(ch), fs = parseFloat(getComputedStyle(ch).fontSize);
        T.minFont = Math.min(T.minFont, fs);
        if (fs < args.minFont - 0.01) T.small.push(tag + '「' + text(ch) + '」字号 ' + fs + 'px');
        const gy = (gr.top + gr.bottom) / 2, gTop = gy - fs / 2, gBot = gy + fs / 2;   // Range 量到的是行框；CJK 字形高 = 字号
        if (gr.left < r.left - 0.5 || gr.right > r.right + 0.5 || gTop < r.top - 0.5 || gBot > r.bottom + 0.5)
          T.overflow.push(tag + '「' + text(ch) + '」字挤出字框（字 ' + round(gr.width) + 'px，框 ' + round(r.width) + 'px）');
      }
      if (getComputedStyle(s).borderTopStyle === 'none' || parseFloat(getComputedStyle(s).borderTopWidth) === 0) T.dense++;
      // tick 落点
      if (stk) {
        T.stacked++;
        const b0 = t - t % 12, wantL = g.left + g.w * b0 / 48 + 1, wantR = g.left + g.w * (b0 + 12) / 48 - 1;
        if (Math.abs(r.left - wantL) > 1.5 || Math.abs(r.right - wantR) > 1.5) T.place.push(tag + ' tick ' + t + '：上下叠的字框没占满它那个 16 分');
        if ((t % 12 === 0) !== (stk === 'upper')) T.stack.push(tag + ' tick ' + t + '：前半个应该在上、后半个在下');
        (pairs[b0] = pairs[b0] || []).push({ stk, r });
      } else {
        const wantL = g.left + g.w * t / 48 + 1, wantR = g.left + g.w * (t + box) / 48 - 1;   // 左右各留 1px 缝
        if (Math.abs(r.left - wantL) > 1.5) T.place.push(tag + ' tick ' + t + '：左边偏 ' + round(r.left - wantL) + 'px');
        if (Math.abs(r.right - wantR) > 1.5) T.place.push(tag + ' tick ' + t + '：右边偏 ' + round(r.right - wantR) + 'px');
      }
    }
    for (const b0 in pairs) {
      const top = pairs[b0].find(p => p.stk === 'upper'), bot = pairs[b0].find(p => p.stk === 'lower');
      if (top && bot && top.r.bottom > bot.r.top + 1) T.stack.push(tag + '：上下叠的两个字框重叠');
    }
    // 三连
    const marks = [...c.querySelectorAll('[data-role="triplet-mark"]')].filter(m => rendered(m) && text(m) === '3').length;
    const ticks = slots.map(s => +s.dataset.tick);
    if (ticks.some(t => t % 12 !== 0 && t % 8 === 0 && t % 16 !== 0)) T.trip6.push(marks);
    else if (ticks.some(t => t % 16 === 0 && t % 12 !== 0)) T.trip3.push(marks);
    // 只有拖音的格子
    const lines = [...c.querySelectorAll('[data-role="drag-line"]')].filter(rendered);
    if (!slots.length && lines.length) {
      T.holdOnly.push(keyOf(c));
      if (chroma(c)) T.holdPainted.push(tag);
    }
  }

  // 拖音细线：按字逐个查
  const allSlots = [...sheet.querySelectorAll('[data-role="slot"]')];
  const segsOf = {};
  for (const l of sheet.querySelectorAll('[data-role="drag-line"]')) (segsOf[l.dataset.from] = segsOf[l.dataset.from] || []).push(l);
  const absOf = (bar, beat, tick) => (rowsOrder.indexOf(bar)) * 192 + beat * 48 + tick;
  for (const s of allSlots) {
    const c = s.closest('[data-role="cell"]'), bar = +c.dataset.bar, beat = +c.dataset.beat, t = +s.dataset.tick;
    const len = +s.dataset.len, box = +s.dataset.box, stk = null, tag = '第 ' + bar + ' 小节第 ' + (beat + 1) + ' 拍 tick ' + t;
    const start = stk ? t - t % 12 + 12 : t + box;
    const segs = (segsOf[bar + ':' + beat + ':' + t] || []).map(l => ({ l, c: l.closest('[data-role="cell"]') }));
    if (start >= t + len) { if (segs.length) T.line.push(tag + '：没拖却画了细线'); continue; }
    if (!segs.length) { T.line.push(tag + '：字拖了 ' + (t + len - start) + ' tick，却没有细线'); continue; }
    segs.sort((a, b) => absOf(+a.c.dataset.bar, +a.c.dataset.beat, 0) - absOf(+b.c.dataset.bar, +b.c.dataset.beat, 0));
    // 应该经过哪些格
    const a0 = absOf(bar, beat, start), a1 = absOf(bar, beat, t + len);
    const want = [];
    for (let a = Math.floor(a0 / 48) * 48; a < a1; a += 48) want.push(a);
    const got = segs.map(x => absOf(+x.c.dataset.bar, +x.c.dataset.beat, 0));
    if (want.join() !== got.join()) { T.line.push(tag + '：细线经过的格子不对'); continue; }
    if (!segs.every(x => rendered(x.l))) continue;    // 不在屏幕上的行不量
    const first = R(segs[0].l), sr = R(s);
    if (Math.abs(first.left - sr.right) > 3) T.line.push(tag + '：细线没从字框右边开始（差 ' + round(first.left - sr.right) + 'px）');
    const lastC = segs[segs.length - 1].c, lg = geo(lastC), endX = lg.left + lg.w * ((a1 - got[got.length - 1]) / 48);
    if (Math.abs(R(segs[segs.length - 1].l).right - endX) > 4) T.line.push(tag + '：细线没画到字结束的地方（差 ' + round(R(segs[segs.length - 1].l).right - endX) + 'px）');
    for (let i = 1; i < segs.length; i++) {
      const p = segs[i - 1], q = segs[i], pr = R(p.l), qr = R(q.l);
      if (p.c.dataset.bar === q.c.dataset.bar) {
        if (qr.left - pr.right > 1.5) T.line.push(tag + '：细线在第 ' + (+q.c.dataset.beat + 1) + ' 拍格线处断开 ' + round(qr.left - pr.right) + 'px');
      } else {
        if (Math.abs(pr.right - R(p.c).right) > 1.5) T.line.push(tag + '：折行前细线没画到这一行最后');
        if (+q.c.dataset.beat !== 0 || Math.abs(qr.left - geo(q.c).left) > 1.5) T.line.push(tag + '：折行后细线没从下一行开头接着画');
      }
    }
    if (segs.some(x => x.c.dataset.bar === String(bar) && x.c !== c)) T.cases.crossCell = (T.cases.crossCell || 0) + 1;
    if (segs.some(x => x.c.dataset.bar !== String(bar))) T.cases.wrap = (T.cases.wrap || 0) + 1;
    // 线色跟字走
    const lc = parse(getComputedStyle(segs[0].l).backgroundColor), chip = chroma(s), ch = s.querySelector('.ch');
    if (chip) {
      const x = lc && hsl(lc);
      if (!x || x.s < 0.2 || hueDist(x.h, chip.h) > 15) T.lineColor.push(tag + '：韵脚字的细线不是这种颜色');
    } else if (ch && text(ch)) {
      const cc = parse(getComputedStyle(ch).color);
      if (!lc || !cc || [0, 1, 2].some(i => Math.abs(lc[i] - cc[i]) > 2)) T.lineColor.push(tag + '：细线颜色和字不一样');
    }
    if (t === 0 && box < 48 && t + len >= 48 && got.length === 1) T.cases.fullBeat = (T.cases.fullBeat || 0) + 1;
  }
  // 字 + 空音：同一格里前一个字结束到后一个字开始之间留了空
  for (const c of cells) {
    const ws = [...c.querySelectorAll('[data-role="slot"]')].map(s => [+s.dataset.tick, +s.dataset.len]).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ws.length; i++) if (ws[i - 1][0] + ws[i - 1][1] < ws[i][0]) T.cases.gap = (T.cases.gap || 0) + 1;
  }
  // 提示
  const tip = [...document.querySelectorAll('[data-role="hold-only-tip"]')].find(visible);
  if (tip) {
    const host = tip.closest('[data-role="cell"]');
    T.tip = { text: text(tip), host: host ? keyOf(host) : null, holdOnly: !!(host && host.dataset.holdOnly === '1'), hostHit: host ? getComputedStyle(host).outlineStyle : '' };
  }
  // 一句跨两行
  const sentRows = {};
  for (const s of allSlots) { const b = +s.closest('[data-role="cell"]').dataset.bar; (sentRows[s.dataset.sent] = sentRows[s.dataset.sent] || new Set()).add(b); }
  const multi = Object.entries(sentRows).filter(([, v]) => v.size > 1);
  if (multi.length) {
    const bars = [...multi[0][1]].sort((a, b) => a - b);
    const heads = bars.map(b => sheet.querySelector('[data-role="row-head"][data-bar="' + b + '"]'));
    T.wrapSent = { bars };
    for (const h of heads) {
      if (!/^\d{2}$/.test(text(h)) || h.children.length !== 1) T.rowHeadBad.push('第 ' + h.dataset.bar + ' 小节行头：「' + text(h) + '」，' + h.children.length + ' 个子元素');
      const bg = getComputedStyle(h).backgroundColor, ref = getComputedStyle(sheet.querySelector('[data-role="row-head"]')).backgroundColor;
      if (bg !== ref) T.rowHeadBad.push('第 ' + h.dataset.bar + ' 小节行头底色和别的行不一样');
    }
    for (let bi = 0; bi < 4; bi++) {
      const xs = bars.map(b => R(cellAt[b + ':' + bi]).left);
      if (Math.max(...xs) - Math.min(...xs) > 0.5) T.colAlign.push('第 ' + (bi + 1) + ' 拍列没对齐');
    }
  }
  return out;
}
"""


def check(name, tag, info, mobile, h, F):
    for u in info["uppercase"][:3]:
        F.append(f"[{tag}] 用了 text-transform:uppercase：{u}")
    for p in info["purple"][:3]:
        F.append(f"[{tag}] 页面上有紫色：{p}")
    for b in info["banned"]:
        F.append(f"[{tag}] 可见文本含 {b}")
    if info["undo"] < 1 or info["redo"] < 1:
        F.append(f"[{tag}] 撤销 / 重做键不全（{info['undo']} / {info['redo']}）")
    if info["play"] != 1:
        F.append(f"[{tag}] 可见的播放键 {info['play']} 个，应该正好 1 个")
    if not info["sections"] or any(not SECTION_RE.match(s) for s in info["sections"]):
        F.append(f"[{tag}] 段落标签不是英文：{info['sections']}")
    for w in info["sheetBanned"]:
        F.append(f"[{tag}] 表格里出现「{w}」（折行不加续行标记）")
    if info["nonWord"]:
        F.append(f"[{tag}] 表格里还有 {info['nonWord']} 个不是「字」的字格（拖音 / 空音格应该作废）")
    if mobile:
        d = info["drawer"]
        if not d or d["bottom"] < h - 2 or d["height"] > 64:
            F.append(f"[{tag}] 押韵抽屉没贴底或没收起：{d}")
    T = info["sheet"]
    if not T or not T["cells"]:
        F.append(f"[{tag}] 找不到可见的歌词表格")
        return
    for key, label in (("overflow", "字挤出格子"), ("small", "字号小于最小字宽"), ("place", "tick 落点"), ("stack", "1/32 不该上下叠"),
                       ("line", "拖音细线"), ("lineColor", "细线颜色"), ("holdPainted", "只有拖音的格子被涂了色")):
        for x in T[key][:6]:
            F.append(f"[{tag}] {label}：{x}")
        if len(T[key]) > 6:
            F.append(f"[{tag}] {label}：另有 {len(T[key]) - 6} 处")
    if any(m != 1 for m in T["trip3"]):
        F.append(f"[{tag}] 三连格应该正好一个「3」：{T['trip3']}")
    if any(m != 2 for m in T["trip6"]):
        F.append(f"[{tag}] 半拍三连格应该两个「3」：{T['trip6']}")
    c = T["cases"]
    if name == "drag":
        for k, label in (("fullBeat", "一个字拖满本拍"), ("gap", "一个字 + 一个空音"), ("crossCell", "从本格拖进下一格"), ("wrap", "跨行拖到下一行开头")):
            if not c.get(k):
                F.append(f"[{tag}] 拖音：没有「{label}」的例子")
        if not T["holdOnly"]:
            F.append(f"[{tag}] 拖音：没有只有拖音、没有新字的格子")
        tip = T["tip"]
        if not tip:
            F.append(f"[{tag}] 拖音：看不到「这一拍只有拖音」的提示")
        else:
            for w in ("这一拍只有拖音", "不能涂色"):
                if w not in tip["text"]:
                    F.append(f"[{tag}] 拖音提示里没有「{w}」")
            if not tip["holdOnly"] or tip["hostHit"] != "dashed":
                F.append(f"[{tag}] 拖音提示没挂在被点的那个只有拖音的格子上（{tip}）")
    if name == "wrap":
        if not T["wrapSent"]:
            F.append(f"[{tag}] 折行：没有哪一句的字跨两行")
        for x in T["rowHeadBad"] + T["colAlign"]:
            F.append(f"[{tag}] 折行：{x}")
    if name == "dense":
        if mobile:
            sc = T["scroll"] or {}
            if not sc or sc["sw"] <= sc["cw"] + 20:
                F.append(f"[{tag}] 手机最小字宽：有 1/32 的作品应该整张表左右滑（{sc}）")
            if T["cellW"] < 111.5:
                F.append(f"[{tag}] 手机最小字宽：左右滑时每拍格子里面至少 112px，现在 {T['cellW']}px")
        elif (T["scroll"] or {}).get("sw", 0) > (T["scroll"] or {}).get("cw", 0) + 1:
            F.append(f"[{tag}] 桌面格子够宽，不该左右滑（{T['scroll']}）")
        if not T["trip3"] or not T["trip6"]:
            F.append(f"[{tag}] 最小字宽画面里要同时有三连和半拍三连")


def run_page(browser, page_file, size_name, scheme, shot):
    w, h = SIZES[size_name]
    mobile = size_name == "mobile"
    ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=scheme,
                              device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile)
    page = ctx.new_page()
    errors, external = [], []
    page.on("console", lambda m, e=errors: e.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda exc, e=errors: e.append(str(exc)))
    page.on("request", lambda r, ext=external: ext.append(r.url) if not r.url.startswith(("file:", "data:", "about:")) else None)
    page.route(re.compile(r"^(?!file:|data:|about:)"), lambda route: route.abort())
    try:
        page.goto(page_file.as_uri(), timeout=15000)
        page.wait_for_timeout(150)
        page.screenshot(path=str(shot))
        info = page.evaluate(PROBE_JS, {"words": list(BANNED_TEXT), "sheetWords": list(SHEET_BANNED), "minFont": MIN_FONT})
        bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
    finally:
        ctx.close()
    return info, errors, external, bg


def lum(css):
    m = re.search(r"rgba?\(([^)]+)\)", css or "")
    if not m:
        return None
    r, g, b = [float(x) for x in re.split(r"[ ,/]+", m.group(1).strip()) if x][:3]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def main():
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "design").resolve()
    evid = pathlib.Path(sys.argv[2]).resolve() / "screenshots_v3b" if len(sys.argv) > 2 else None
    src, shots = root / "mockups_v3b", root / "screenshots_v3b"
    shots.mkdir(parents=True, exist_ok=True)
    if evid:
        evid.mkdir(parents=True, exist_ok=True)
    F, count = [], 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for name in SCREENS:
            page_file = src / f"{name}.html"
            if not page_file.exists():
                F.append(f"缺少画面 {page_file}")
                continue
            for size_name, (w, h) in SIZES.items():
                bgs = {}
                for scheme in SCHEMES:
                    tag = f"{name} {size_name} {w}x{h} {scheme}"
                    shot = shots / f"{name}_{size_name}_{scheme}.png"
                    try:
                        info, errors, external, bg = run_page(browser, page_file, size_name, scheme, shot)
                    except Exception as exc:  # noqa: BLE001
                        F.append(f"[{tag}] 页面打不开或检查出错：{str(exc).splitlines()[0]}")
                        continue
                    count += 1
                    if evid:
                        shutil.copy(shot, evid / shot.name)
                    F.extend(f"[{tag}] 控制台错误：{e}" for e in errors)
                    F.extend(f"[{tag}] 外网请求：{u}" for u in external)
                    check(name, tag, info, size_name == "mobile", h, F)
                    bgs[scheme] = lum(bg)
                if None not in (bgs.get("dark"), bgs.get("light")) and bgs["dark"] >= bgs["light"]:
                    F.append(f"[{name} {size_name}] 深色模式没生效")
        browser.close()
    total = len(SCREENS) * len(SIZES) * len(SCHEMES)
    if F:
        print(f"FAIL：{len(F)} 项不满足（截图 {count}/{total} 张）")
        for f in F:
            print("  - " + f)
        return 1
    print(f"OK：{len(SCREENS)} 个画面 × {len(SIZES)} 尺寸 × {len(SCHEMES)} 配色 = {total} 张截图，全部断言通过 → {shots}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
