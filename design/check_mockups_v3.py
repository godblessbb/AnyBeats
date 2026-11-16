"""AnyBeats v3 视觉稿自动检查（浏览器实测，不 grep 源码）。

用法：python -I design/check_mockups_v3.py design

对 design/mockups_v3/ 里规定的 9 个画面 × 桌面 1280×800 / 手机 390×844 × 浅 / 深色：
  截图到 design/screenshots_v3/<画面>_<desktop|mobile>_<light|dark>.png，再在浏览器里量算断言。

通用断言（每张都查）：
  - 无控制台错误 / 页面异常；无外网请求（只允许 file: / data: / about:）
  - 没有 text-transform: uppercase；强调色和播放键色相不在紫区 250–310°；任何可见元素的字色 / 底色 / 边线也不是紫色
  - 主要文字（h1–h4、[data-contrast]、表格里的字 .ch）对比度 ≥ 4.5:1；深色页底确实比浅色暗
  - 可见文字里没有：∅、Worker、录音、AI 写词、中文段落名（前奏 / 主歌 / 副歌 / 桥段 / 尾奏）；页面上没有可见的录音键 / 音轨
  - 可见文字里出现「AI」的地方，必须落在一个可见的「接入后」框里（虚线框 + 写着「接入后」的标签）
  - 撤销、重做按钮都可见且够大；可见的播放键正好 1 个
  - 段落标签全是英文：Intro / Verse / Hook / Bridge / Outro（可带数字）
  - 手机：押韵抽屉贴底；除了「抽屉展开」画面，收起高度 ≤ 64px
表格断言（每张都查，只量在屏幕里看得见的格子）：
  - 列头 4 拍，标 1–4；每拍 4 个可点的小刻度，和格底刻度线对齐
  - 每格底部 4 条淡 16 分刻度线，在 0 / ¼ / ½ / ¾ 处，颜色很淡（对比度 < 2.2）
  - 每个字位 / 拖音 / 空音的左右边按 tick 落点摆（左边 = 格左 + tick/48 × 格宽，±2.5px）
  - 一拍里是三连（落点在 16、32 tick）的格子必须有可见的「3」，不是三连的不能有
  - 字不用下划线
  - 字位 / 拖音 / 空音三种样式两两至少有 2 项可见特征不同（边线样式、是不是横条、底色）；拖音紧接在前一个字后面
  - 一格只能有一种颜色：格子和格里所有元素的彩色底只能有一个色相；涂了色的格子色相要对得上某个色块
  - 押韵落在格内最后的字上：涂色格里带色的字必须正好是最后 n 个字位（n = 这个颜色的押数）；
    还没写字的韵脚位置要显示该位的韵母占位
画面专属断言（按文件名写死，页面不能自己声明跳过）：
  flow 字位 / 拖音 / 空音都看得见、图例样式和表格一致；有「一个字拖两个位置」和「一个字 + 一个空音」的格子；
       导唱入口在「后续实现」框里，导唱块数 = 字位数
  paint 色块是一排彩色矩形且只选中一个；押数四档、韵母框个数 = 押数；一行里既有选中格又有反选去掉的格、行头标出整行；
       韵母占位 ≥ 4 个；桌面上画了「接入后」的 AI 一次填韵按钮
  full 所有字位都写了字；有「韵母对不上」的提示且字没被改
  lock 4 种锁的入口；整行、整列、选中格都锁了且带锁标记；全部韵脚位置带锁标记；锁定格样式和未锁格不同
  ai / ai_reject 选区框可见；「保持骨架」默认开、「允许改 flow」默认关；说明只改选区、锁定的字不许改
  ai 结果预览可见；ai_reject 作废提示可见（作废、没有上屏、选区外、锁定），表格内容和完整稿逐字一致
  beat 替换伴奏入口可见；BPM 弹窗完整在屏内、正好两个选项（保留原 BPM / 改用新 BPM）、说明跟着拍子走不跟秒数
  history 历史列表含 填字 / 铺 flow / 涂色 / 锁定 / AI 改写 / 换伴奏；有「现在在这里」；可重做的步骤和已做的样式不同；写明刷新后还在
  drawer 手机抽屉展开（≥ 50% 屏高），里面有色块、押数、韵母框、候选；桌面右栏押韵面板可见
任何一项不满足，退出码 1。只用标准库 + playwright（sync API）。
"""

import colorsys
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

SIZES = {"desktop": (1280, 800), "mobile": (390, 844)}
SCHEMES = ("light", "dark")
SCREENS = ("flow", "paint", "full", "lock", "ai", "ai_reject", "beat", "history", "drawer")
PURPLE_HUE = (250.0, 310.0)
MIN_CONTRAST = 4.5
MAX_DRAWER = 64
BANNED_TEXT = ("∅", "Worker", "录音", "AI 写词", "前奏", "主歌", "副歌", "桥段", "尾奏")

PROBE_JS = r"""
(args) => {
  const WORDS = args.words;
  const parse = (s) => {
    const m = s && s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const inView = (r) => !(r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth);
  const rendered = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  // 看得见 = 渲染出来 + 中心点在屏幕里 + 没被滚动容器裁掉 + 中心点上最上层的就是它（被抽屉 / 手机面板 / 吸顶表头 / 弹出菜单 / 弹窗盖住的不算；
  // 半透明的全屏遮罩不算盖住）。列头这类吸顶元素只要求 shown（不被裁掉），不要求最上层
  const centre = (el) => { const r = el.getBoundingClientRect(); return [(r.left + r.right) / 2, (r.top + r.bottom) / 2]; };
  const inside = (x, y, r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  const shown = (el) => {
    if (!rendered(el) || !inView(el.getBoundingClientRect())) return false;
    const [cx, cy] = centre(el);
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if ((cs.overflowX !== 'visible' || cs.overflowY !== 'visible') && !inside(cx, cy, n.getBoundingClientRect())) return false;
    }
    return true;
  };
  const visible = (el) => {
    if (!shown(el)) return false;
    const [cx, cy] = centre(el);
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return false;
    for (const h of document.elementsFromPoint(cx, cy)) {
      if (h === el || el.contains(h) || h.contains(el)) return true;
      const cs = getComputedStyle(h), bg = parse(cs.backgroundColor);
      const veil = cs.position === 'fixed' && (!bg || bg[3] < 0.7) && ![...h.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!veil) return false;
    }
    return false;
  };
  const blend = (top, bottom) => { const a = top[3]; return [0, 1, 2].map(i => top[i] * a + bottom[i] * (1 - a)).concat([1]); };
  const bgOf = (el) => {
    const chain = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.push(n);
    let bg = [255, 255, 255, 1];
    for (let i = chain.length - 1; i >= 0; i--) {
      const c = parse(getComputedStyle(chain[i]).backgroundColor);
      if (c && c[3] > 0) bg = blend(c, bg);
    }
    return bg;
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
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
  // 彩色底：不透明度够、饱和度够、不是接近黑白
  const chroma = (el) => {
    const c = parse(getComputedStyle(el).backgroundColor);
    if (!c || c[3] < 0.1) return null;
    const x = hsl(c);
    if (x.s < 0.2 || x.l < 0.06 || x.l > 0.97) return null;
    return x;
  };
  const text = (el) => (el.innerText || el.textContent || '').trim();
  const R = (el) => el.getBoundingClientRect();
  const round = (v) => Math.round(v * 10) / 10;

  const out = { uppercase: [], contrast: [], checked: 0, accent: [], purple: [], pageBg: null, banned: [], aiText: [],
                undo: 0, redo: 0, play: 0, rec: 0, sections: [], drawer: null };

  // ---- 通用 ----
  for (const el of document.querySelectorAll('body *')) {
    if (getComputedStyle(el).textTransform === 'uppercase' && el.textContent.trim() && visible(el))
      out.uppercase.push(el.tagName.toLowerCase() + '.' + el.className + ' "' + el.textContent.trim().slice(0, 20) + '"');
  }
  for (const el of document.querySelectorAll('h1, h2, h3, h4, [data-contrast], .ch')) {
    if (!text(el) || !visible(el)) continue;
    const fg = parse(getComputedStyle(el).color);
    if (!fg) continue;
    const bg = bgOf(el), r = ratio(blend(fg, bg), bg);
    out.checked += 1;
    if (r < 4.5) out.contrast.push({ text: text(el).slice(0, 16), ratio: Math.round(r * 100) / 100, fg: getComputedStyle(el).color,
      bg: 'rgb(' + bg.slice(0, 3).map(Math.round).join(',') + ')' });
  }
  const probe = document.createElement('div');
  probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--ab-accent').trim();
  document.body.appendChild(probe);
  const accent = parse(getComputedStyle(probe).color);
  out.accent.push({ src: '--ab-accent', color: getComputedStyle(probe).color });
  probe.remove();
  for (const play of document.querySelectorAll('[data-role="play"]')) if (visible(play)) out.accent.push({ src: 'play', color: getComputedStyle(play).backgroundColor });
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
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
  const pb = parse(getComputedStyle(document.body).backgroundColor);
  out.pageBg = pb ? lum(pb) : null;

  let visibleText = document.body.innerText || '';
  for (const el of document.querySelectorAll('[placeholder]')) if (visible(el)) visibleText += '\n' + el.getAttribute('placeholder');
  for (const el of document.querySelectorAll('input')) if (visible(el)) visibleText += '\n' + el.value;
  for (const w of WORDS) if (visibleText.includes(w)) {
    const i = visibleText.indexOf(w);
    out.banned.push({ word: w, ctx: visibleText.slice(Math.max(0, i - 12), i + w.length + 12).replace(/\s+/g, ' ') });
  }
  // 「AI」只能出现在可见的「接入后」框里
  const dashed = (el) => { const cs = getComputedStyle(el); return ['Top', 'Bottom', 'Left', 'Right'].some(s => cs['border' + s + 'Style'] === 'dashed' && parseFloat(cs['border' + s + 'Width']) >= 1); };
  const frameOk = (f, label) => {
    if (!f || !rendered(f) || !dashed(f)) return false;
    const b = f.querySelector('.after-b');
    return !!(b && rendered(b) && text(b).startsWith(label));
  };
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (!/AI/.test(n.textContent) || !n.parentElement || !visible(n.parentElement)) continue;
    const f = n.parentElement.closest('[data-role="after-connect"]');
    if (!frameOk(f, '接入后')) out.aiText.push(n.textContent.trim().slice(0, 30));
  }
  const big = (el) => visible(el) && R(el).width >= 28 && R(el).height >= 28;
  out.undo = [...document.querySelectorAll('[data-role="undo"]')].filter(big).length;
  out.redo = [...document.querySelectorAll('[data-role="redo"]')].filter(big).length;
  out.play = [...document.querySelectorAll('[data-role="play"], [aria-label*="播放"]')].filter(visible).length;
  out.rec = [...document.querySelectorAll('[data-role="record"], [data-role="take-track"], [aria-label*="录"]')].filter(visible).length;
  out.sections = [...document.querySelectorAll('[data-role="section-label"]')].filter(visible).map(text);
  const dr = document.querySelector('[data-role="rhyme-drawer"]');
  if (dr) {
    const r = R(dr);
    out.drawer = { visible: rendered(dr), height: r.height, bottom: r.bottom,
      swatches: [...dr.querySelectorAll('[data-role="swatch"]')].filter(visible).length,
      counts: [...dr.querySelectorAll('[data-role="count-opt"]')].filter(visible).map(text),
      finals: [...dr.querySelectorAll('[data-role="final-input"]')].filter(visible).length,
      cands: [...dr.querySelectorAll('.cand')].filter(visible).length };
  }

  // ---- 色块 ----
  const swatchSets = [];
  for (const box of document.querySelectorAll('[data-role="swatches"]')) {
    if (!visible(box)) continue;
    const sws = [...box.querySelectorAll('[data-role="swatch"]')].filter(visible).map(s => {
      const c = parse(getComputedStyle(s).backgroundColor), r = R(s);
      return { id: s.dataset.rule, count: +s.dataset.count, finals: (s.dataset.finals || '').split(' '), hue: c ? hsl(c).h : null,
               sat: c ? hsl(c).s : 0, w: r.width, h: r.height, ring: getComputedStyle(s).boxShadow !== 'none' };
    });
    swatchSets.push(sws);
  }
  out.swatches = swatchSets;
  // 涂色比对用页面上所有色块（含当前隐藏的那一份，例如 AI 画面右栏换成了 AI 面板），颜色照样从浏览器里读
  const allSw = [...document.querySelectorAll('[data-role="swatch"]')].map(s => { const c = parse(getComputedStyle(s).backgroundColor);
    return { id: s.dataset.rule, count: +s.dataset.count, finals: (s.dataset.finals || '').split(' '), hue: c && hsl(c).s > 0.2 ? hsl(c).h : null }; });

  // ---- 表格 ----
  const sheet = document.querySelector('[data-role="lyrics-sheet"]');
  const S = { present: !!sheet, heads: [], cells: 0, tickBad: [], slotBad: [], tripBad: [], underline: [], colorBad: [], paintBad: [],
              rhymeBad: [], sigs: { word: [], hold: [], rest: [] }, holdBad: [], painted: 0, placeholders: 0, chips: 0,
              emptyWords: 0, words: 0, halves: { wordHold: 0, wordRest: 0 }, selIn: [], selOut: [], rowHeadOn: [], locked: [],
              text: '' };
  out.sheet = S;
  if (sheet) {
    const allSlots = [...sheet.querySelectorAll('[data-role="slot"]')];
    S.text = allSlots.map(s => { const c = s.closest('[data-role="cell"]'); const ch = s.querySelector('.ch');
      return c.dataset.bar + ':' + c.dataset.beat + ':' + s.dataset.tick + ':' + s.dataset.kind + ':' + (ch ? text(ch) : ''); }).join('|');
    for (const s of allSlots) if (s.dataset.kind === 'word') { S.words++; const ch = s.querySelector('.ch'); if (!ch || !text(ch)) S.emptyWords++; }

    const cellsAll = [...sheet.querySelectorAll('[data-role="cell"]')];
    const cells = cellsAll.filter(visible);
    S.cells = cells.length;
    const geo = (c) => { const r = R(c); return { left: r.left + c.clientLeft, w: c.clientWidth, r }; };

    // 列头
    for (const h of sheet.querySelectorAll('[data-role="beat-head"]')) {
      const bi = +h.dataset.beat, bn = h.querySelector('.bn'), subs = [...h.querySelectorAll('[data-role="sub-tick"]')].filter(shown);
      const col = cells.find(c => +c.dataset.beat === bi && [...c.querySelectorAll('[data-role="tick-line"]')].filter(rendered).length === 4);
      const why = [];
      if (!shown(h)) why.push('列头不可见');
      if (!bn || !shown(bn) || !text(bn).startsWith(String(bi + 1))) why.push('拍号不是 ' + (bi + 1));
      if (subs.length !== 4) why.push('可见小刻度 ' + subs.length + ' 个');
      else {
        if (subs.some(s => R(s).width < 14 || R(s).height < 10)) why.push('小刻度太小点不中');
        if (col) {
          const tks = [...col.querySelectorAll('[data-role="tick-line"]')].map(t => R(t).left).sort((a, b) => a - b);
          subs.forEach((s, i) => { if (Math.abs(R(s).left - tks[i]) > 2.5) why.push('第 ' + (i + 1) + ' 个小刻度和格底刻度线差 ' + round(R(s).left - tks[i]) + 'px'); });
        }
      }
      S.heads.push({ beat: bi, ok: why.length === 0, why: why.join('、') });
    }

    const accentKey = accent ? accent.slice(0, 3).map(Math.round).join(', ') : 'x';
    const rowsOf = {};
    for (const c of cells) {
      const g = geo(c), tag = '第 ' + c.dataset.bar + ' 小节第 ' + (+c.dataset.beat + 1) + ' 拍';
      (rowsOf[c.dataset.bar] = rowsOf[c.dataset.bar] || []).push(c);
      // 刻度线
      const tks = [...c.querySelectorAll('[data-role="tick-line"]')].filter(rendered);
      if (tks.length !== 4) S.tickBad.push(tag + '：刻度线 ' + tks.length + ' 条');
      else {
        const cbg = bgOf(c);
        tks.map(t => R(t)).sort((a, b) => a.left - b.left).forEach((r, i) => {
          const want = g.left + g.w * i / 4;
          if (Math.abs(r.left - want) > 2) S.tickBad.push(tag + '：第 ' + (i + 1) + ' 条刻度线偏 ' + round(r.left - want) + 'px');
          if (r.width > 2 || r.bottom < g.r.bottom - 3 || r.height > 12) S.tickBad.push(tag + '：刻度线不在格底或太粗');
        });
        const t0 = parse(getComputedStyle(tks[1]).backgroundColor) || [0, 0, 0, 0];
        const cr = ratio(blend(t0, cbg), cbg);
        if (cr >= 2.2) S.tickBad.push(tag + '：刻度线太重（对比度 ' + round(cr) + '）');
        if (cr < 1.05) S.tickBad.push(tag + '：刻度线看不见');
      }
      // 字的 tick 落点
      const slots = [...c.querySelectorAll('[data-role="slot"]')];
      for (const s of slots) {
        if (!rendered(s)) continue;
        const t = +s.dataset.tick, l = +s.dataset.len, r = R(s);
        const wantL = g.left + g.w * t / 48, wantR = g.left + g.w * (t + l) / 48;
        if (Math.abs(r.left - wantL) > 2.5) S.slotBad.push(tag + ' tick ' + t + '：左边偏 ' + round(r.left - wantL) + 'px');
        if (Math.abs(r.right - wantR) > 3.5) S.slotBad.push(tag + ' tick ' + t + '：右边偏 ' + round(r.right - wantR) + 'px');
        const cs = getComputedStyle(s);
        if (parseFloat(cs.borderBottomWidth) > parseFloat(cs.borderTopWidth) + 0.5) S.underline.push(tag + ' 字底有单独的线');
        for (const e of [s, ...s.querySelectorAll('*')]) if (getComputedStyle(e).textDecorationLine.includes('underline')) S.underline.push(tag + ' 用了下划线');
        // 样式特征
        const bg = parse(cs.backgroundColor);
        const sig = [cs.borderTopStyle === 'none' || parseFloat(cs.borderTopWidth) === 0 ? 'none' : cs.borderTopStyle,
                     r.height <= 10 ? 'bar' : 'box', bg && bg[3] > 0.05 ? cs.backgroundColor : 'none'].join('|');
        const k = s.dataset.kind;
        if (S.sigs[k] && !S.sigs[k].includes(sig)) S.sigs[k].push(sig);
      }
      // 三连
      const isTrip = slots.some(s => (+s.dataset.tick % 16 === 0 && +s.dataset.tick % 12 !== 0) || (+s.dataset.len === 16));
      const mark = [...c.querySelectorAll('[data-role="triplet-mark"]')].some(m => rendered(m) && text(m) === '3');
      if (isTrip && !mark) S.tripBad.push(tag + '：三连但没有「3」');
      if (!isTrip && mark) S.tripBad.push(tag + '：不是三连却标了「3」');
      // 一格两个位置的组合
      const at = (tk, kind, len) => slots.some(s => +s.dataset.tick === tk && s.dataset.kind === kind && (len == null || +s.dataset.len === len));
      for (const h0 of [0, 24]) {
        if (at(h0, 'word', 12) && at(h0 + 12, 'hold', 12)) S.halves.wordHold++;
        if (at(h0, 'word', 12) && at(h0 + 12, 'rest', 12)) S.halves.wordRest++;
      }
      // 一格一种颜色
      const hues = [c, ...c.querySelectorAll('*')].filter(rendered).map(chroma).filter(Boolean).map(x => x.h);
      for (let i = 0; i < hues.length; i++) for (let j = i + 1; j < hues.length; j++)
        if (hueDist(hues[i], hues[j]) > 15) { S.colorBad.push(tag + '：格里有两种颜色（色相 ' + Math.round(hues[i]) + '° 和 ' + Math.round(hues[j]) + '°）'); i = hues.length; break; }
      // 涂色 + 韵脚位置
      const own = chroma(c);
      const words = slots.filter(s => s.dataset.kind === 'word').sort((a, b) => +a.dataset.tick - +b.dataset.tick);
      const chipFlags = words.map(w => !!chroma(w));
      const nChips = chipFlags.filter(Boolean).length;
      S.chips += nChips;
      if (own) {
        S.painted++;
        const sw = allSw.filter(x => x.hue != null && hueDist(x.hue, own.h) <= 15);
        if (!sw.length) S.paintBad.push(tag + '：涂的颜色（' + Math.round(own.h) + '°）对不上任何色块');
        else {
          const n = sw[0].count, fins = sw[0].finals;
          const suffixOk = nChips === n && chipFlags.slice(words.length - n).every(Boolean);
          if (!suffixOk) S.rhymeBad.push(tag + '：带色的字不是格内最后 ' + n + ' 个字（现在 ' + chipFlags.map(f => f ? '■' : '□').join('') + '）');
          words.slice(words.length - n).forEach((w, j) => {
            const ch = w.querySelector('.ch');
            if (ch && text(ch)) return;
            const ph = w.querySelector('[data-role="placeholder"]');
            if (!ph || !rendered(ph) || text(ph) !== fins[j]) S.rhymeBad.push(tag + '：空着的韵脚位置没显示韵母「' + fins[j] + '」');
            else S.placeholders++;
          });
        }
      } else if (nChips) S.rhymeBad.push(tag + '：没涂色却有带色的字');
      // 选中 / 反选
      const cs = getComputedStyle(c);
      if (cs.boxShadow.includes(accentKey)) S.selIn.push(c.dataset.bar);
      if (cs.outlineStyle === 'dashed' && parseFloat(cs.outlineWidth) >= 1.5) S.selOut.push(c.dataset.bar);
      if (cs.backgroundImage.includes('gradient')) S.locked.push(c.dataset.bar + ':' + c.dataset.beat);
    }
    // 拖音紧接前一个字
    for (const bar in rowsOf) {
      const row = sheet.querySelector('[data-role="row"][data-bar="' + bar + '"]');
      const list = [...row.querySelectorAll('[data-role="slot"]')].map(s => ({ s, abs: +s.closest('[data-role="cell"]').dataset.beat * 48 + +s.dataset.tick }))
        .sort((a, b) => a.abs - b.abs);
      list.forEach((x, i) => {
        if (x.s.dataset.kind !== 'hold' || !visible(x.s)) return;
        const p = list[i - 1];
        if (!p) { S.holdBad.push('第 ' + bar + ' 小节：拖音前面没有字'); return; }
        if (p.s.dataset.kind === 'rest') S.holdBad.push('第 ' + bar + ' 小节：拖音接在空音后面');
        const gap = R(x.s).left - R(p.s).right;
        if (gap > 3 || gap < -4) S.holdBad.push('第 ' + bar + ' 小节 tick ' + x.abs + '：拖音和前一个字隔了 ' + round(gap) + 'px');
      });
    }
    // 行头
    const heads = [...sheet.querySelectorAll('[data-role="row-head"]')].filter(visible);
    const hbg = heads.map(h => getComputedStyle(h).backgroundColor);
    const common = hbg.sort((a, b) => hbg.filter(x => x === a).length - hbg.filter(x => x === b).length).pop();
    S.rowHeadOn = heads.filter(h => getComputedStyle(h).backgroundColor !== common).map(h => h.dataset.bar);
    S.rowLockIcon = heads.filter(h => [...h.querySelectorAll('[data-role="lock-icon"]')].some(visible)).map(h => h.dataset.bar);
    S.colLockIcon = [...sheet.querySelectorAll('[data-role="beat-head"]')].filter(h => [...h.querySelectorAll('[data-role="lock-icon"]')].some(visible)).map(h => h.dataset.beat);
    S.cellLockIcon = cells.filter(c => [...c.querySelectorAll(':scope > [data-role="lock-icon"]')].some(visible)).map(c => c.dataset.bar + ':' + c.dataset.beat);
    S.visCells = cells.map(c => c.dataset.bar + ':' + c.dataset.beat);
    const chipSlots = [...sheet.querySelectorAll('[data-role="slot"]')].filter(s => visible(s) && chroma(s));
    S.chipLocked = chipSlots.filter(s => [...s.querySelectorAll('[data-role="lock-icon"]')].some(visible)).length;
    S.chipVisible = chipSlots.length;
    S.mismatchSlots = [...sheet.querySelectorAll('[data-role="slot"]')].filter(s => visible(s) && getComputedStyle(s).outlineStyle === 'dashed'
      && s.querySelector('.ch') && text(s.querySelector('.ch'))).length;
    S.blocked = [...sheet.querySelectorAll('[data-role="blocked"]')].filter(visible).length;
    const ais = sheet.querySelector('[data-role="ai-selection"]');
    S.aiSel = ais ? { visible: visible(ais), shadow: getComputedStyle(ais).boxShadow.includes(accentKey) && /\b[2-9]px/.test(getComputedStyle(ais).boxShadow) } : null;
  }

  // 图例 / 画笔样本
  const legendSigs = { word: [], hold: [], rest: [] };
  for (const lg of document.querySelectorAll('[data-role="slot-legend"]')) {
    if (!visible(lg)) continue;
    for (const s of lg.querySelectorAll('.slot')) {
      if (!rendered(s)) continue;
      const cs = getComputedStyle(s), r = R(s), bg = parse(cs.backgroundColor);
      const sig = [cs.borderTopStyle === 'none' || parseFloat(cs.borderTopWidth) === 0 ? 'none' : cs.borderTopStyle,
                   r.height <= 10 ? 'bar' : 'box', bg && bg[3] > 0.05 ? cs.backgroundColor : 'none'].join('|');
      const k = s.dataset.kind;
      if (legendSigs[k] && !legendSigs[k].includes(sig)) legendSigs[k].push(sig);
    }
  }
  out.legendSigs = legendSigs;

  // 导唱
  const ge = [...document.querySelectorAll('[data-role="guide-entry"]')].filter(visible);
  out.guide = { entry: ge.length, framed: ge.some(e => frameOk(e.closest('[data-role="later"], [data-role="after-connect"]'), e.closest('[data-role="later"]') ? '后续实现' : '接入后')),
                blips: document.querySelectorAll('[data-role="guide-blip"]').length,
                blipsVisible: [...document.querySelectorAll('[data-role="guide-blip"]')].filter(visible).length };

  // 押韵规则编辑
  const vcount = [...document.querySelectorAll('[data-role="count-opt"]')].filter(visible);
  const activeIdx = vcount.map(b => { const c = parse(getComputedStyle(b).backgroundColor); return c && c[3] > 0.5; });
  out.rule = { labels: vcount.map(text), active: activeIdx.filter(Boolean).length, activeAt: activeIdx.indexOf(true),
               finals: [...document.querySelectorAll('[data-role="final-input"]')].filter(visible).length };
  const mrb = document.querySelector('[data-role="m-rule-bar"]');
  out.mRuleBar = mrb && visible(mrb) ? text(mrb) : '';
  const chipsBox = [...document.querySelectorAll('[data-role="sel-chips"]')].filter(visible);
  out.selChips = chipsBox.length ? text(chipsBox[0]) : '';
  out.invert = [...document.querySelectorAll('button')].filter(b => visible(b) && text(b) === '反选').length;
  const selTools = [...document.querySelectorAll('[data-role="sel-tools"]')].filter(visible);
  out.selTools = selTools.length ? text(selTools[0]) : '';
  const af = [...document.querySelectorAll('[data-role="ai-fill"]')].filter(visible);
  out.aiFill = af.some(e => frameOk(e.closest('[data-role="after-connect"]'), '接入后'));

  // 韵母对不上
  out.mismatch = [...document.querySelectorAll('[data-role="mismatch"]')].filter(visible).map(text);

  // 锁定
  out.lockOpts = [...document.querySelectorAll('[data-role="lock-opt"]')].filter(visible).map(text);

  // AI
  const sw = (role) => { const e = [...document.querySelectorAll('[data-role="' + role + '"]')].find(rendered);
    if (!e) return null;
    const c = parse(getComputedStyle(e).backgroundColor), x = c ? hsl(c) : null;
    return { checked: e.getAttribute('aria-checked'), accentish: !!(x && accent && x.s > 0.3 && hueDist(x.h, hsl(accent).h) < 15) }; };
  const panels = [...document.querySelectorAll('[data-role="ai-panel"]')].filter(rendered);
  out.ai = { keep: sw('keep-skeleton'), flow: sw('allow-flow'), panelText: panels.map(text).join('\n'),
             proposal: [...document.querySelectorAll('[data-role="ai-proposal"]')].filter(rendered).length,
             rejected: [...document.querySelectorAll('[data-role="ai-rejected"]')].filter(visible).map(text) };

  // 换伴奏
  const rb = [...document.querySelectorAll('[data-role="replace-beat"]')].filter(visible);
  const dlg = document.querySelector('[role="dialog"]');
  let dlgInfo = null;
  if (dlg) {
    const r = R(dlg);
    const opts = [...dlg.querySelectorAll('[data-role="bpm-option"]')].filter(visible);
    let backdrop = false;
    for (let n = dlg.parentElement; n && n !== document.body; n = n.parentElement) {
      const nr = R(n), c = parse(getComputedStyle(n).backgroundColor);
      if (getComputedStyle(n).position === 'fixed' && nr.left <= 0 && nr.top <= 0 && nr.right >= innerWidth && nr.bottom >= innerHeight && c && c[3] >= 0.2) backdrop = true;
    }
    dlgInfo = { visible: visible(dlg), inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5,
                opts: opts.map(text), text: text(dlg), backdrop };
  }
  out.beat = { replace: rb.map(text), dialog: dlgInfo };

  // 历史
  const hp = document.querySelector('[data-role="history"]');
  if (hp && visible(hp)) {
    const kids = [...hp.querySelectorAll('[data-role="history-entry"], [data-role="history-current"]')];
    const cur = kids.findIndex(k => k.dataset.role === 'history-current');
    const ents = kids.filter(k => k.dataset.role === 'history-entry' && visible(k));
    const colorOf = (e) => getComputedStyle(e.querySelector('small') || e).color;
    const before = kids.slice(0, Math.max(cur, 0)).filter(k => k.dataset.role === 'history-entry' && visible(k));
    const after = kids.slice(cur + 1).filter(k => visible(k));
    const bc = new Set(before.map(colorOf)), ac = new Set(after.map(colorOf));
    out.history = { entries: ents.map(text), current: cur >= 0 && visible(kids[cur]), redo: before.length, done: after.length,
                    distinct: [...bc].every(c => !ac.has(c)), text: text(hp),
                    undoOn: [...document.querySelectorAll('[data-role="undo"]')].some(b => visible(b) && !b.disabled),
                    redoOn: [...document.querySelectorAll('[data-role="redo"]')].some(b => visible(b) && !b.disabled) };
  } else out.history = null;

  const rp = [...document.querySelectorAll('[data-role="rhyme-panel"]')].filter(visible);
  out.rhymePanel = rp.length;
  return out;
}
"""

SECTION_RE = re.compile(r"^(Intro|Verse|Hook|Bridge|Outro)( \d+)?$")


def hue_of(css_color):
    m = re.search(r"rgba?\(([^)]+)\)", css_color or "")
    if not m:
        return None, 0.0
    parts = [float(x) for x in re.split(r"[ ,/]+", m.group(1).strip()) if x][:3]
    h, _l, s = colorsys.rgb_to_hls(*(v / 255 for v in parts))
    return h * 360, s


def hue_dist(a, b):
    d = abs(a - b) % 360
    return min(d, 360 - d)


def sig_diff(a, b):
    return sum(1 for x, y in zip(a.split("|"), b.split("|")) if x != y)


def check_common(tag, info, mobile, h, name, F):
    for u in info["uppercase"]:
        F.append(f"[{tag}] 用了 text-transform:uppercase：{u}")
    for a in info["accent"]:
        hue, sat = hue_of(a["color"])
        if hue is None:
            F.append(f"[{tag}] 读不到强调色（{a['src']}）")
        elif sat > 0.1 and PURPLE_HUE[0] <= hue <= PURPLE_HUE[1]:
            F.append(f"[{tag}] 强调色是紫色：{a['src']} {a['color']} 色相 {hue:.0f}°")
    for p in info["purple"]:
        F.append(f"[{tag}] 页面上有紫色：{p}")
    if info["checked"] == 0:
        F.append(f"[{tag}] 没有抽到任何主要文字元素做对比度检查")
    for c in info["contrast"]:
        F.append(f"[{tag}] 对比度 {c['ratio']} < {MIN_CONTRAST}：“{c['text']}” {c['fg']} on {c['bg']}")
    for b in info["banned"]:
        F.append(f"[{tag}] 可见文本含「{b['word']}」：…{b['ctx']}…")
    if info["rec"]:
        F.append(f"[{tag}] 录音：页面上有 {info['rec']} 个可见的录音键 / 音轨")
    for t in info["aiText"]:
        F.append(f"[{tag}] AI 文案不在「接入后」框里：{t}")
    if info["undo"] < 1 or info["redo"] < 1:
        F.append(f"[{tag}] 撤销/重做：撤销键 {info['undo']} 个、重做键 {info['redo']} 个可见（≥28px），两个都要有")
    if info["play"] != 1:
        F.append(f"[{tag}] 播放键：可见的播放键有 {info['play']} 个，应该正好 1 个")
    if not info["sections"]:
        F.append(f"[{tag}] 段落标签：一个可见的段落标签都没有")
    for s in info["sections"]:
        if not SECTION_RE.match(s):
            F.append(f"[{tag}] 段落标签不是英文 Intro/Verse/Hook/Bridge/Outro：「{s}」")
    if mobile:
        d = info["drawer"]
        if not d or not d["visible"]:
            F.append(f"[{tag}] 押韵抽屉：手机上找不到可见的 [data-role=rhyme-drawer]")
        else:
            if d["bottom"] < h - 2:
                F.append(f"[{tag}] 押韵抽屉：没贴在屏幕底部（底边 {d['bottom']:.0f}px）")
            if name != "drawer" and d["height"] > MAX_DRAWER:
                F.append(f"[{tag}] 押韵抽屉：收起高度 {d['height']:.0f}px > {MAX_DRAWER}px")


def check_sheet(tag, info, F):
    S = info["sheet"]
    if not S["present"] or S["cells"] == 0:
        F.append(f"[{tag}] 表格：找不到可见的歌词表格")
        return
    if len(S["heads"]) != 4:
        F.append(f"[{tag}] 列头：应该 4 拍，现在 {len(S['heads'])} 个")
    for hd in S["heads"]:
        if not hd["ok"]:
            F.append(f"[{tag}] 列头第 {hd['beat'] + 1} 拍：{hd['why']}")
    for key, label in (("tickBad", "16 分刻度线"), ("slotBad", "tick 落点"), ("tripBad", "三连标记"), ("underline", "下划线"),
                       ("colorBad", "一格一种颜色"), ("paintBad", "涂色"), ("rhymeBad", "韵脚位置"), ("holdBad", "拖音")):
        for x in S[key][:6]:
            F.append(f"[{tag}] {label}：{x}")
        if len(S[key]) > 6:
            F.append(f"[{tag}] {label}：另有 {len(S[key]) - 6} 处")
    kinds = ("word", "hold", "rest")
    for i, a in enumerate(kinds):
        for b in kinds[i + 1:]:
            for sa in S["sigs"][a]:
                for sb in S["sigs"][b]:
                    if sig_diff(sa, sb) < 2:
                        F.append(f"[{tag}] 空字格样式：{a} 和 {b} 分不清（{sa} vs {sb}）")


def check_special(name, tag, info, mobile, ref_text, F):
    S = info["sheet"]
    if name == "flow":
        for k, label in (("word", "字位"), ("hold", "拖音"), ("rest", "空音")):
            if not S["sigs"][k]:
                F.append(f"[{tag}] 铺 flow：表格里看不到{label}")
            ls = info["legendSigs"][k]
            if not ls:
                F.append(f"[{tag}] 铺 flow：图例 / 画笔里没有{label}样本")
            elif S["sigs"][k] and not any(x in S["sigs"][k] for x in ls):
                F.append(f"[{tag}] 铺 flow：图例里的{label}和表格里样式不一样（{ls[0]} vs {S['sigs'][k][0]}）")
        if S["halves"]["wordHold"] < 1:
            F.append(f"[{tag}] 铺 flow：没有「一个字拖两个位置」的格子")
        if S["halves"]["wordRest"] < 1:
            F.append(f"[{tag}] 铺 flow：没有「一个字 + 一个空音」的格子")
        g = info["guide"]
        if not g["entry"]:
            F.append(f"[{tag}] 导唱：没有可见的导唱入口")
        elif not g["framed"]:
            F.append(f"[{tag}] 导唱：入口没放在「后续实现」/「接入后」框里")
        if g["blips"] != S["words"] or g["blipsVisible"] == 0:
            F.append(f"[{tag}] 导唱：导唱块 {g['blips']} 个（可见 {g['blipsVisible']}），字位 {S['words']} 个，应该一样多")
    if name in ("paint", "full", "drawer", "lock"):
        sets = info["swatches"]
        if not sets:
            F.append(f"[{tag}] 色块：找不到可见的一排色块")
        for sws in sets:
            if len(sws) < 3:
                F.append(f"[{tag}] 色块：只有 {len(sws)} 个可见色块，至少 3 个")
            for s in sws:
                if s["w"] < s["h"] * 1.2:
                    F.append(f"[{tag}] 色块：{s['id']} 不是横向矩形（{s['w']:.0f}×{s['h']:.0f}）")
                if s["sat"] < 0.35:
                    F.append(f"[{tag}] 色块：{s['id']} 颜色太灰")
            for i, a in enumerate(sws):
                for b in sws[i + 1:]:
                    if a["hue"] is not None and b["hue"] is not None and hue_dist(a["hue"], b["hue"]) < 25:
                        F.append(f"[{tag}] 色块：{a['id']} 和 {b['id']} 颜色太像")
            if sum(1 for s in sws if s["ring"]) != 1:
                F.append(f"[{tag}] 色块：选中的色块应该正好 1 个，现在 {sum(1 for s in sws if s['ring'])} 个")
        need = 1 if (name == "drawer" and mobile) else 4   # 手机抽屉展开时表格只露出两行
        if S["painted"] < need:
            F.append(f"[{tag}] 涂色：可见的涂色格只有 {S['painted']} 个")
    if name == "paint" or (name == "drawer" and mobile):
        r = info["rule"]
        if not mobile or name == "drawer":
            if r["labels"] != ["单押", "双押", "三押", "四押"]:
                F.append(f"[{tag}] 押数：应该是 单押/双押/三押/四押 四档，现在 {r['labels']}")
            elif r["active"] != 1:
                F.append(f"[{tag}] 押数：选中的档应该正好 1 个，现在 {r['active']} 个")
            elif r["finals"] != r["activeAt"] + 1:
                F.append(f"[{tag}] 韵母串：选了{r['labels'][r['activeAt']]}，韵母框却有 {r['finals']} 个")
    if name == "paint":
        if mobile and not ("押" in info["mRuleBar"] and "涂上" in info["mRuleBar"]):
            F.append(f"[{tag}] 涂色：手机上没有显示当前颜色押数 / 韵母和「涂上」的条")
        for w in ("单格", "整行", "整列", "框选"):
            if w not in info["selChips"]:
                F.append(f"[{tag}] 选格子：工具条里没有「{w}」")
        if not info["invert"]:
            F.append(f"[{tag}] 选格子：没有可见的「反选」")
        rows = set(S["selIn"]) & set(S["selOut"])
        if not rows:
            F.append(f"[{tag}] 反选：没有一行里同时有选中格和反选去掉的格（选中 {S['selIn']}，去掉 {S['selOut']}）")
        elif not rows & set(S["rowHeadOn"]):
            F.append(f"[{tag}] 反选：选中的那一行行头没有标出整行选中")
        if S["placeholders"] < 4:
            F.append(f"[{tag}] 韵母占位：涂了色还没写字的韵脚位置只显示了 {S['placeholders']} 个占位")
        if not mobile and not info["aiFill"]:
            F.append(f"[{tag}] AI 填韵：桌面上没画「接入后」的 AI 一次填韵按钮")
    if name == "full":
        if S["emptyWords"]:
            F.append(f"[{tag}] 完整表格：还有 {S['emptyWords']} 个字位没写字")
        if not any(("对不上" in m or "≠" in m) for m in info["mismatch"]):
            F.append(f"[{tag}] 韵母对不上：没有可见的提示")
        if S["mismatchSlots"] < 1:
            F.append(f"[{tag}] 韵母对不上：表格里没有标出那个字（字要保留原样，只加提示框）")
    if name == "lock":
        opts = info["lockOpts"]
        for w in ("整行", "整列", "选中", "韵脚"):
            if not any(w in o for o in opts):
                F.append(f"[{tag}] 锁定：没有「锁{w}」的入口")
        locked, vis = set(S["locked"]), S["visCells"]
        rows = {}
        for c in vis:
            rows.setdefault(c.split(":")[0], []).append(c)
        full_rows = [b for b, cs in rows.items() if len(cs) == 4 and all(c in locked for c in cs)]
        cols = {}
        for c in vis:
            cols.setdefault(c.split(":")[1], []).append(c)
        full_cols = [b for b, cs in cols.items() if all(c in locked for c in cs)]
        if not set(full_rows) & set(S["rowLockIcon"]):
            F.append(f"[{tag}] 锁定：没有整行锁（4 格都锁、行头有锁标记）（整行锁 {full_rows}，行头锁 {S['rowLockIcon']}）")
        if not set(full_cols) & set(S["colLockIcon"]):
            F.append(f"[{tag}] 锁定：没有整列锁（整列都锁、列头有锁标记）（整列锁 {full_cols}，列头锁 {S['colLockIcon']}）")
        single = [c for c in locked if c.split(":")[0] not in full_rows and c.split(":")[1] not in full_cols]
        if not single or not all(c in S["cellLockIcon"] for c in single):
            F.append(f"[{tag}] 锁定：没有单独锁的格子，或锁了的格子没有锁标记（{single}）")
        if len(locked) == len(vis):
            F.append(f"[{tag}] 锁定：所有格子都一个样，看不出哪些锁了")
        if S["chipVisible"] == 0 or S["chipLocked"] != S["chipVisible"]:
            F.append(f"[{tag}] 锁定：全部韵脚位置应该都带锁标记（{S['chipLocked']}/{S['chipVisible']}）")
    if name in ("ai", "ai_reject"):
        a = info["ai"]
        if not S.get("aiSel") or not S["aiSel"]["visible"] or not S["aiSel"]["shadow"]:
            F.append(f"[{tag}] AI 润色：表格上没有可见的选区框")
        if not a["keep"] or a["keep"]["checked"] != "true" or not a["keep"]["accentish"]:
            F.append(f"[{tag}] AI 润色：「保持骨架」应该默认开着（{a['keep']}）")
        if not a["flow"] or a["flow"]["checked"] != "false" or a["flow"]["accentish"]:
            F.append(f"[{tag}] AI 润色：「允许改 flow」应该默认关着（{a['flow']}）")
        for w in ("只改选区", "锁定", "不许改", "上下文"):
            if w not in a["panelText"]:
                F.append(f"[{tag}] AI 润色：面板没写清「{w}」")
    if name == "ai" and not a["proposal"]:
        F.append(f"[{tag}] AI 润色：看不到结果预览")
    if name == "ai_reject":
        rj = " ".join(info["ai"]["rejected"])
        if not rj:
            F.append(f"[{tag}] AI 被拒：作废提示不在屏幕上")
        for w in ("作废", "没有上屏", "选区外", "锁定"):
            if rj and w not in rj:
                F.append(f"[{tag}] AI 被拒：提示里没有「{w}」")
        if info["ai"]["proposal"]:
            F.append(f"[{tag}] AI 被拒：被拒了还显示着结果预览")
        if S["blocked"] < 1:
            F.append(f"[{tag}] AI 被拒：表格上没标出它想改的位置")
        if ref_text is not None and S["text"] != ref_text:
            F.append(f"[{tag}] AI 被拒：表格内容和完整稿不一致（被拒的结果不能上屏）")
    if name == "beat":
        b = info["beat"]
        if not any("替换" in t for t in b["replace"]):
            F.append(f"[{tag}] 换伴奏：没有可见的「替换伴奏」入口")
        d = b["dialog"]
        if not d or not d["visible"]:
            F.append(f"[{tag}] BPM 弹窗：看不到弹窗")
        else:
            if not d["inside"]:
                F.append(f"[{tag}] BPM 弹窗：弹窗超出屏幕")
            if not d["backdrop"]:
                F.append(f"[{tag}] BPM 弹窗：后面没有遮罩")
            if len(d["opts"]) != 2:
                F.append(f"[{tag}] BPM 弹窗：应该正好两个选项，现在 {len(d['opts'])} 个")
            for w in ("保留原 BPM", "改用新 BPM"):
                if not any(w in o for o in d["opts"]):
                    F.append(f"[{tag}] BPM 弹窗：没有「{w}」选项")
            for w in ("跟着拍子走", "不跟秒数"):
                if w not in d["text"]:
                    F.append(f"[{tag}] BPM 弹窗：没说明歌词「{w}」")
    if name == "history":
        hs = info["history"]
        if not hs:
            F.append(f"[{tag}] 撤销/重做：看不到历史列表")
        else:
            joined = " ".join(hs["entries"])
            for w in ("填字", "铺 flow", "涂色", "锁定", "AI 改写", "换伴奏"):
                if w not in joined:
                    F.append(f"[{tag}] 撤销/重做：历史里没有「{w}」")
            if not hs["current"]:
                F.append(f"[{tag}] 撤销/重做：没标出「现在在这里」")
            if hs["redo"] < 1 or hs["done"] < 1:
                F.append(f"[{tag}] 撤销/重做：应该同时有可重做的和已做的步骤（{hs['redo']} / {hs['done']}）")
            elif not hs["distinct"]:
                F.append(f"[{tag}] 撤销/重做：可重做的步骤和已做的步骤样式一样")
            if "刷新" not in hs["text"]:
                F.append(f"[{tag}] 撤销/重做：没写刷新后历史还在")
            if not hs["undoOn"] or not hs["redoOn"]:
                F.append(f"[{tag}] 撤销/重做：撤销了几步之后，撤销和重做键都应该能点")
    if name == "drawer":
        if mobile:
            d = info["drawer"] or {}
            if d.get("height", 0) < 844 * 0.5:
                F.append(f"[{tag}] 抽屉展开：高度 {d.get('height', 0):.0f}px，不到半屏")
            if d.get("swatches", 0) < 3 or d.get("finals", 0) < 1 or d.get("cands", 0) < 6 or len(d.get("counts", [])) != 4:
                F.append(f"[{tag}] 抽屉展开：里面应该有色块、押数四档、韵母框、候选（{d}）")
        elif not info["rhymePanel"]:
            F.append(f"[{tag}] 押韵面板：桌面右栏看不到押韵面板")


def run_page(browser, page_file, size_name, scheme, shot=None):
    w, h = SIZES[size_name]
    mobile = size_name == "mobile"
    ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=scheme,
                              device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile)
    page = ctx.new_page()
    errors, external = [], []
    page.on("console", lambda m, e=errors: e.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda exc, e=errors: e.append(str(exc)))
    page.on("request", lambda r, ext=external: ext.append(r.url)
            if not r.url.startswith(("file:", "data:", "about:")) else None)
    page.route(re.compile(r"^(?!file:|data:|about:)"), lambda route: route.abort())
    try:
        page.goto(page_file.as_uri(), timeout=15000)
        page.wait_for_timeout(150)
        if shot:
            page.screenshot(path=str(shot))
        info = page.evaluate(PROBE_JS, {"words": list(BANNED_TEXT)})
    finally:
        ctx.close()
    return info, errors, external


def main():
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "design").resolve()
    src = root / "mockups_v3"
    shots = root / "screenshots_v3"
    shots.mkdir(parents=True, exist_ok=True)
    F = []
    for need in SCREENS:
        if not (src / f"{need}.html").exists():
            F.append(f"缺少画面 {src / (need + '.html')}")
    count = 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ref_text = None
        if (src / "full.html").exists():
            try:
                ref_text = run_page(browser, src / "full.html", "desktop", "light")[0]["sheet"]["text"]
            except Exception as exc:  # noqa: BLE001
                F.append(f"[full] 取参照表格失败：{str(exc).splitlines()[0]}")
        for name in SCREENS:
            page_file = src / f"{name}.html"
            if not page_file.exists():
                continue
            for size_name, (w, h) in SIZES.items():
                page_bg = {}
                mobile = size_name == "mobile"
                for scheme in SCHEMES:
                    tag = f"{name} {size_name} {w}x{h} {scheme}"
                    try:
                        info, errors, external = run_page(browser, page_file, size_name, scheme, shots / f"{name}_{size_name}_{scheme}.png")
                    except Exception as exc:  # noqa: BLE001  打不开也算失败，但继续检查其它画面
                        F.append(f"[{tag}] 页面打不开或检查出错：{str(exc).splitlines()[0]}")
                        continue
                    count += 1
                    for e in errors:
                        F.append(f"[{tag}] 控制台错误：{e}")
                    for u in external:
                        F.append(f"[{tag}] 外网请求：{u}")
                    check_common(tag, info, mobile, h, name, F)
                    check_sheet(tag, info, F)
                    check_special(name, tag, info, mobile, ref_text, F)
                    page_bg[scheme] = info["pageBg"]
                if page_bg.get("dark") is not None and page_bg.get("light") is not None and page_bg["dark"] >= page_bg["light"]:
                    F.append(f"[{name} {size_name}] 深色模式没生效：深色页底不比浅色暗")
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
