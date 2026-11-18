"""AnyBeats v3.3 视觉稿自动检查（浏览器实测，不 grep 源码）：断句（句首 / 句尾）。

用法：python -I design/check_mockups_v33.py design [证据目录]
      （不给证据目录时读环境变量 ANYBEATS_EVIDENCE；都没有就只存仓库里的截图）

对 design/mockups_v33/ 的 7 个画面 × 桌面 1280×800 / 手机 390×844 × 浅 / 深色：
截图到 design/screenshots_v33/<画面>_<desktop|mobile>_<light|dark>.png（有证据目录就再拷一份到 <证据目录>/screenshots_v33/），
再在浏览器里量算断言。

通用：
  - 无控制台错误 / 页面异常；无外网请求；页面不左右溢出（scrollWidth ≤ 视口宽）；当前步骤对
  - 句首（data-role=phrase-start）/ 句尾（phrase-end）竖线：
      看得见（宽 ≥ 2.5px，高 ≥ 同一行方格高度，颜色和格子底色对比 ≥ 3）；
      不越格（左右都在自己那一格里，上下在这一行里）；
      落点对（句首左边 = 格左 + tick/48 × 格宽，句尾右边 = 格左 + 结束 tick/48 × 格宽，±1.5px）；
      句尾是红色、句首是中性色（浅 / 深色都量）
  - 同一行里所有竖线和序号（phrase-num）两两不重叠；序号不压到方格 / 字上
  - 同一格里不同句子的横线（phrase-band）不重叠，横线不出格
  - 断句位置和 design/fixtures_v33/koi_phrases.json 对得上：看得见的每一根句尾都在样例里，
    样例里结束点落在看得见的格子里的句尾一根不少（按歌词断 = lyricSentences，自动断句 = guessEnds）
画面专属：
  phrases  ≥ 6 句完整可见；有跨小节的长句（句首和句尾在不同的行）；有一小节两句
  dense    S1 一小节 4 根句尾、相邻句尾 / 句首紧挨着（间距 0–1.5px）但不重叠；S2 有三连中间断句、1/32 中间断句
  mark     光标方格就是刚标的句尾；气泡里有「到这里一句」（按下）和「从这里起一句」；提示条、两格之间的「点这里断开」都看得见
  auto     横幅看得见、写明「漏」、有全部接受 / 全部不要；所有句尾都是虚线（待确认）；「可能漏断」提示条看得见且在视口里，提示范围里没有句尾
  rhyme    第 2 步、「句尾」涂法按下；每一句的韵脚字正好是这一句最后 n 个字；选中那一句押最后 2 个字，按格子算会押到的那个字在句尾红线右边（是下一句的）
  spacing  （桌面）韵脚栏 ≥ 6 个标签、其中 ≥ 3 个是间隔，都不出栏；写的拍数和 tick 差对得上
  touch    句尾小菜单在视口里，有 是句尾 / 不是句尾 / 往前 / 往后 四个按钮，手机上每个按钮高 ≥ 36px；选中的句尾描强调色圈、是待确认

反向探针（每次都跑，在 dense / auto 桌面浅色上故意改坏）：句尾挪 4px 压到句首、句首挪出格、句尾颜色改成格子底色、
删掉一根句尾、页面加一个超宽元素、两句横线叠在一起、句子序号压到竖线上、横幅被滚到工具条底下、把待确认的句尾改成实线。每一条都必须让检查报错，否则本脚本退出 1。

任何一项不满足，退出码 1。只用标准库 + playwright（sync API）。
"""

import json
import os
import pathlib
import shutil
import sys

from playwright.sync_api import sync_playwright

SIZES = {"desktop": (1280, 800), "mobile": (390, 844)}
SCHEMES = ("light", "dark")
SCREENS = ("phrases", "dense", "mark", "auto", "rhyme", "spacing", "touch")
STEP = {"rhyme": "2", "spacing": "2"}

PROBE_JS = r"""
([screen, fx]) => {
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
  // 竖线 / 横线自己的颜色：实心的取底色，虚线（渐变）取渐变里第一个颜色
  const inkOf = (el) => {
    const cs = getComputedStyle(el);
    const c = parse(cs.backgroundColor);
    if (c && c[3] > 0.5) return c;
    return parse(cs.backgroundImage);
  };
  const isDashed = (el) => getComputedStyle(el).backgroundImage.includes('gradient');
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth)) return false;
    // 被固定在底部的抽屉 / 气泡挡住的不算看得见
    const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y);
    if (!hit) return false;
    if (hit === el || el.contains(hit)) return true;
    if (hit.closest('[data-role="square-tip"], [data-role="phrase-pop"]') && !el.closest('[data-role="square-tip"], [data-role="phrase-pop"]')) return false;
    // 压在别的表格内容（竖线、方格）下面也算看得见——那正是「重叠」检查要抓的
    return !!hit.closest('[data-role="cell"]') && !!el.closest('[data-role="cell"]');
  };
  const inView = (el, name) => {
    const r = el.getBoundingClientRect();
    if (r.left < -0.5 || r.right > innerWidth + 0.5 || r.top < -0.5 || r.bottom > innerHeight + 0.5) { fail(`${name} 不在视口里 (${r.left.toFixed(0)},${r.top.toFixed(0)},${r.right.toFixed(0)},${r.bottom.toFixed(0)})`); return; }
    // 四个角（往里缩 4px）都要点得到它自己：没被工具条、抽屉、别的浮层盖住，也没被滚出容器
    for (const [x, y] of [[r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4]]) {
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === el || el.contains(hit))) { fail(`${name} 有一角被挡住了（${x.toFixed(0)},${y.toFixed(0)} 处是 ${hit ? (hit.dataset.role || hit.className || hit.tagName) : '空'}）`); return; }
    }
  };
  const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const isRed = (c) => c && c[0] > c[1] + 60 && c[0] > c[2] + 50;
  const isNeutral = (c) => c && Math.abs(c[0] - c[1]) < 30 && Math.abs(c[1] - c[2]) < 30;

  if (document.documentElement.scrollWidth > innerWidth + 1) fail(`页面左右溢出：scrollWidth ${document.documentElement.scrollWidth} > ${innerWidth}`);
  const step = document.querySelector('[data-role="steps"] button.on');
  if (!step || step.dataset.step !== fx.step) fail(`当前步骤不是第 ${fx.step} 步`);

  const cellName = (cell) => `第 ${cell.dataset.bar} 小节第 ${Number(cell.dataset.beat) + 1} 拍`;
  const xAt = (cell, off) => { const cr = cell.getBoundingClientRect(); return cr.left + cell.clientLeft + (off / 48) * cell.clientWidth; };
  const markers = [...document.querySelectorAll('[data-role="cell"] [data-role="phrase-start"], [data-role="cell"] [data-role="phrase-end"]')];
  const visMarkers = markers.filter(vis);
  const visEnds = visMarkers.filter((m) => m.dataset.role === 'phrase-end');
  const visStarts = visMarkers.filter((m) => m.dataset.role === 'phrase-start');

  // ---- 竖线：看得见、不越格、落点对、颜色 ----
  for (const m of visMarkers) {
    const cell = m.closest('[data-role="cell"]'), row = m.closest('[data-role="row"]');
    const r = m.getBoundingClientRect(), cr = cell.getBoundingClientRect(), rr = row.getBoundingClientRect();
    const isEnd = m.dataset.role === 'phrase-end';
    const what = `${cellName(cell)} 的${isEnd ? '句尾' : '句首'}（tick ${m.dataset.abs}）`;
    if (r.left < cr.left - 0.5 || r.right > cr.right + 0.5) fail(`${what} 越过格线`);
    if (r.top < rr.top - 0.5 || r.bottom > rr.bottom + 0.5) fail(`${what} 出了这一行`);
    if (r.width < 2.5) fail(`${what} 太细（${r.width.toFixed(1)}px）`);
    const sq = cell.querySelector('[data-role="square"], [data-role="word"]') || row.querySelector('[data-role="square"], [data-role="word"]');
    if (sq && r.height < sq.getBoundingClientRect().height) fail(`${what} 比方格还矮`);
    const ink = inkOf(m), bg = bgOf(cell);
    if (!ink || contrast(ink, bg) < 3) fail(`${what} 和格子底色对比 ${ink ? contrast(ink, bg).toFixed(2) : '?'} < 3`);
    if (isEnd && !isRed(ink)) fail(`${what} 不是红色`);
    if (!isEnd && !isNeutral(ink)) fail(`${what} 不是中性色（应该是正文色）`);
    const c0 = Number(cell.dataset.c0);
    if (isEnd) {
      const want = xAt(cell, Number(m.dataset.end) - c0);
      if (Math.abs(r.right - want) > 1.5) fail(`${what} 右边 ${r.right.toFixed(1)} ≠ 结束点 ${want.toFixed(1)}`);
    } else {
      const want = xAt(cell, Number(m.dataset.abs) - c0);
      if (Math.abs(r.left - want) > 1.5) fail(`${what} 左边 ${r.left.toFixed(1)} ≠ 句首 ${want.toFixed(1)}`);
    }
    if (isEnd && m.dataset.state === 'guess' && !isDashed(m)) fail(`${what} 待确认却不是虚线`);
    if (isEnd && m.dataset.state === 'end' && isDashed(m)) fail(`${what} 已确认却画成虚线`);
  }

  // ---- 同一行：竖线、序号两两不重叠；序号不压方格 ----
  for (const row of document.querySelectorAll('[data-role="row"]')) {
    const items = [...row.querySelectorAll('[data-role="phrase-start"], [data-role="phrase-end"], [data-role="phrase-num"]')].filter(vis);
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i].getBoundingClientRect(), b = items[j].getBoundingClientRect();
      if (overlap(a, b) > 0.5) fail(`第 ${row.dataset.bar} 小节：${items[i].dataset.role} tick ${items[i].dataset.abs || ''} 和 ${items[j].dataset.role} tick ${items[j].dataset.abs || ''} 重叠`);
    }
    const nums = items.filter((x) => x.dataset.role === 'phrase-num');
    const glyphs = [...row.querySelectorAll('[data-role="square"], [data-role="word"]')];
    for (const n of nums) for (const g of glyphs) if (overlap(n.getBoundingClientRect(), g.getBoundingClientRect()) > 0.5) fail(`第 ${row.dataset.bar} 小节：句子序号压到了方格 / 字上`);
  }

  // ---- 横线：同一格不同句子不重叠、不出格 ----
  for (const cell of document.querySelectorAll('[data-role="cell"]')) {
    const bands = [...cell.querySelectorAll('[data-role="phrase-band"]')].filter(vis);
    const cr = cell.getBoundingClientRect();
    for (const b of bands) { const r = b.getBoundingClientRect(); if (r.left < cr.left - 0.5 || r.right > cr.right + 0.5) fail(`${cellName(cell)} 的句子横线出格`); }
    for (let i = 0; i < bands.length; i++) for (let j = i + 1; j < bands.length; j++) {
      const a = bands[i].getBoundingClientRect(), b = bands[j].getBoundingClientRect();
      if (bands[i].dataset.phrase !== bands[j].dataset.phrase && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5) fail(`${cellName(cell)} 两句的横线叠在一起`);
    }
  }

  // ---- 和样例数据对得上 ----
  if (fx.ends) {
    const truth = new Set(fx.ends);
    const shownCells = [...document.querySelectorAll('[data-role="cell"]')].filter(vis);
    for (const m of visEnds) if (!truth.has(Number(m.dataset.abs))) fail(`句尾 tick ${m.dataset.abs} 不在样例断句里`);
    const visAbs = new Set(visEnds.map((m) => Number(m.dataset.abs)));
    for (const c of shownCells) {
      const c0 = Number(c.dataset.c0);
      if (c0 >= 200 * 192) continue;
      for (const [last, end] of fx.endPairs) if (end > c0 && end <= c0 + 48 && !visAbs.has(last)) fail(`${cellName(c)} 少了一根句尾（样例里最后一个字在 tick ${last}）`);
    }
  }

  const btn = (root, role, act) => root && root.querySelector(`[data-role="${role}"][data-act="${act}"]`);
  const toast = document.querySelector('[data-role="notice"]');
  const rowOf = (bar) => document.querySelector(`[data-role="row"][data-bar="${bar}"]`);

  if (screen === 'phrases') {
    const ids = new Set(visStarts.map((m) => m.dataset.phrase).filter((id) => visEnds.some((e) => e.dataset.phrase === id)));
    if (ids.size < 6) fail(`完整可见的句子只有 ${ids.size} 句`);
    const rows = [...document.querySelectorAll('[data-role="row"]')].filter(vis);
    const rowsOf = {};
    for (const b of document.querySelectorAll('[data-role="phrase-band"]')) if (vis(b)) (rowsOf[b.dataset.phrase] = rowsOf[b.dataset.phrase] || new Set()).add(b.closest('[data-role="row"]').dataset.bar);
    const long = Object.entries(rowsOf).filter(([id, set]) => set.size >= 2 && visStarts.some((m) => m.dataset.phrase === id) && visEnds.some((m) => m.dataset.phrase === id));
    if (!long.length) fail('看不出跨小节的长句（没有一句的句首和句尾在不同的行）');
    if (!rows.some((r) => [...r.querySelectorAll('[data-role="phrase-start"]')].filter(vis).length >= 2)) fail('没有一小节两句的例子');
  } else if (screen === 'dense') {
    const s1 = rowOf('S1'), s2 = rowOf('S2');
    if (!s1 || !vis(s1.querySelector('[data-role="cell"]'))) fail('压力样例 S1 看不见');
    else {
      const ends = [...s1.querySelectorAll('[data-role="phrase-end"]')].filter(vis), starts = [...s1.querySelectorAll('[data-role="phrase-start"]')].filter(vis);
      if (ends.length !== 4) fail(`S1 应该一小节 4 根句尾，现在 ${ends.length}`);
      for (const e of ends) {
        const er = e.getBoundingClientRect();
        const nx = starts.map((s) => s.getBoundingClientRect()).filter((r) => r.left >= er.left).sort((a, b) => a.left - b.left)[0];
        if (!nx) { fail(`S1 句尾 tick ${e.dataset.abs} 后面没有紧跟的句首`); continue; }
        const gap = nx.left - er.right;
        if (gap < -0.5 || gap > 1.5) fail(`S1 句尾和下一句句首间距 ${gap.toFixed(1)}px（应该紧挨着、不重叠）`);
      }
    }
    if (!s2) fail('没有压力样例 S2');
    else {
      const tripCell = [...s2.querySelectorAll('[data-role="cell"]')].find((c) => c.querySelector('[data-role="triplet-mark"]'));
      if (!tripCell || !tripCell.querySelector('[data-role="phrase-end"]')) fail('S2 没有「三连中间断句」');
      const fine = [...s2.querySelectorAll('[data-role="phrase-end"]')].find((e) => {
        const sq = e.closest('[data-role="cell"]').querySelectorAll('[data-role="square"][data-box="6"]');
        return sq.length >= 2;
      });
      if (!fine) fail('S2 没有「1/32 中间断句」');
    }
  } else if (screen === 'mark') {
    const f = document.querySelector('[data-role="square"][data-focus]');
    if (!f) fail('没有光标方格');
    else {
      const e = document.querySelector(`[data-role="phrase-end"][data-abs="${f.dataset.abs}"]`);
      if (!e || !e.dataset.fresh) fail('光标方格不是刚标上的句尾');
    }
    const tip = document.querySelector('[data-role="square-tip"]');
    if (!tip) fail('没有气泡');
    else {
      inView(tip, '气泡');
      const end = btn(tip, 'phrase-action', 'end'), start = btn(tip, 'phrase-action', 'start');
      if (!end || end.getAttribute('aria-pressed') !== 'true') fail('气泡里没有按下的「到这里一句」');
      if (!start) fail('气泡里没有「从这里起一句」');
      if (!tip.textContent.includes('Shift') || !tip.textContent.includes('Enter')) fail('气泡里没写 Shift+Enter');
      const acts = [...tip.querySelectorAll('[data-role="square-action"]')].map((b) => b.dataset.act).join(',');
      if (acts !== 'split,triplet,rest,merge') fail(`v3.2 的四个分格按钮变了：${acts}`);
    }
    if (!toast || !vis(toast) || !toast.textContent.includes('句尾')) fail('没有「标成句尾」的提示');
    else inView(toast, '提示条');
    const g = document.querySelector('[data-role="gap-hint"]');
    if (!g || !vis(g)) fail('看不到两格之间的「点这里断开」');
  } else if (screen === 'auto') {
    const b = document.querySelector('[data-role="phrase-banner"]');
    if (!b || !vis(b)) fail('看不到自动断句横幅');
    else {
      inView(b, '横幅');
      if (!b.textContent.includes('漏')) fail('横幅没写快嘴段会漏');
      if (!b.querySelector('[data-role="phrase-accept-all"]') || !b.querySelector('[data-role="phrase-dismiss-all"]')) fail('横幅里没有「全部接受 / 全部不要」');
    }
    if (!visEnds.length) fail('一根建议的句尾都看不见');
    for (const e of visEnds) if (e.dataset.state !== 'guess' || !isDashed(e)) fail(`句尾 tick ${e.dataset.abs} 不是待确认的虚线`);
    const w = document.querySelector('[data-role="miss-warn"]');
    if (!w || !vis(w)) fail('看不到「可能漏断」提示');
    else {
      inView(w, '漏断提示');
      if (!w.textContent.includes('漏')) fail('漏断提示没写「漏」');
      for (const rh of document.querySelectorAll('.rh.miss')) {
        const row = rh.closest('[data-role="row"]');
        if ([...row.querySelectorAll('[data-role="phrase-end"]')].some((e) => Number(e.dataset.end) < Number(fx.missEnd))) fail(`第 ${row.dataset.bar} 小节标了「可能漏断」却有句尾`);
      }
    }
  } else if (screen === 'rhyme' || screen === 'spacing') {
    const mode = document.querySelector('[data-role="paint-mode"] button.on');
    if (!mode || mode.dataset.mode !== 'phrase') fail('涂法默认不是「句尾」');
    // 每一句的韵脚字正好是这一句最后 n 个字
    const byPhrase = {};
    for (const w of document.querySelectorAll('[data-role="word"]')) (byPhrase[w.dataset.phrase] = byPhrase[w.dataset.phrase] || []).push(w);
    let rhymed = 0;
    for (const [id, ws] of Object.entries(byPhrase)) {
      ws.sort((a, b) => a.dataset.abs - b.dataset.abs);
      const k = ws.filter((w) => w.dataset.rhyme).length;
      if (!k) continue;
      rhymed++;
      const tail = ws.slice(ws.length - k);
      if (!tail.every((w) => w.dataset.rhyme)) fail(`第 ${id} 句的韵脚字不是这一句最后 ${k} 个字`);
      const end = document.querySelector(`[data-role="phrase-end"][data-phrase="${id}"]`);
      if (end && vis(end)) for (const w of tail) if (vis(w) && w.getBoundingClientRect().left > end.getBoundingClientRect().right) fail(`第 ${id} 句的韵脚字跑到句尾红线右边去了`);
    }
    if (rhymed < 4) fail(`押了韵的句子只有 ${rhymed} 句`);
    if (screen === 'rhyme') {
      const sel = document.querySelector('[data-role="phrase-end"][data-sel]');
      if (!sel || !vis(sel)) fail('看不到选中的那一句');
      else {
        const ws = (byPhrase[sel.dataset.phrase] || []).sort((a, b) => a.dataset.abs - b.dataset.abs);
        if (ws.filter((w) => w.dataset.rhyme).length !== 2) fail('选中那一句不是双押最后 2 个字');
        const old = document.querySelector('[data-role="word"][data-old-rule]');
        if (!old || !vis(old)) fail('看不到「按格子算会押到的字」');
        else {
          if (old.dataset.phrase === sel.dataset.phrase) fail('「按格子算会押到的字」应该是下一句的');
          if (old.getBoundingClientRect().left < sel.getBoundingClientRect().right - 0.5) fail('「按格子算会押到的字」不在句尾红线右边');
          if (old.dataset.rhyme) fail('按格子算的那个字不该被押上');
        }
      }
      if (!toast || !vis(toast)) fail('没有涂色提示'); else inView(toast, '提示条');
    } else {
      const gaps = [...document.querySelectorAll('[data-role="rhyme-gap"]')].filter((g) => g.getBoundingClientRect().width > 0);
      if (innerWidth > 600) {
        const n = gaps.filter((g) => Number(g.dataset.ticks) > 0).length;
        if (gaps.length < 6 || n < 3) fail(`韵脚栏标签 ${gaps.length} 个、其中间隔 ${n} 个（要 ≥ 6 个、间隔 ≥ 3 个）`);
        for (const g of gaps) {
          const lab = g.closest('.lab').getBoundingClientRect(), r = g.getBoundingClientRect();
          if (r.right > lab.right + 0.5 || r.left < lab.left - 0.5) fail(`间隔标签「${g.textContent}」出了韵脚栏`);
          const t = Number(g.dataset.ticks);
          if (t > 0) {
            const b = t / 48, txt = g.textContent;
            const whole = Math.floor(b);
            if (!txt.includes(String(whole || ''))) fail(`间隔标签「${txt}」和 ${t} tick 对不上`);
          }
        }
      }
    }
  } else if (screen === 'touch') {
    const pop = document.querySelector('[data-role="phrase-pop"]');
    if (!pop || !vis(pop)) fail('看不到句尾小菜单');
    else {
      inView(pop, '句尾小菜单');
      for (const a of ['confirm', 'remove', 'left', 'right']) {
        const b = btn(pop, 'phrase-pop-act', a);
        if (!b) { fail(`小菜单里没有 ${a}`); continue; }
        inView(b, `小菜单按钮 ${a}`);
        if (innerWidth <= 600 && b.getBoundingClientRect().height < 36) fail(`手机上「${b.textContent}」按钮太小`);
      }
    }
    const sel = document.querySelector('[data-role="phrase-end"][data-sel]');
    if (!sel || !vis(sel)) fail('看不到选中的句尾');
    else {
      if (sel.dataset.state !== 'guess') fail('选中的句尾应该是待确认');
      if (getComputedStyle(sel).boxShadow === 'none') fail('选中的句尾没有描圈');
    }
  }
  return fails;
}
"""

# 反向探针：(画面, 说明, 改坏页面的 JS)。改完之后 PROBE_JS 必须报至少一条错
MUTATIONS = [
    ("dense", "句尾右挪 4px 压到下一句句首",
     "const e=[...document.querySelectorAll('[data-role=\"row\"][data-bar=\"S1\"] [data-role=\"phrase-end\"]')][0]; e.style.left='calc(var(--o) / 48 * 100% + 1px)';"),
    ("dense", "句首往左挪出格",
     "const s=document.querySelector('[data-role=\"row\"][data-bar=\"S1\"] [data-role=\"phrase-start\"]'); s.style.left='-10px';"),
    ("dense", "句尾颜色改成格子底色（看不见）",
     "for (const e of document.querySelectorAll('[data-role=\"phrase-end\"]')) e.style.background=getComputedStyle(e.closest('[data-role=\"cell\"]')).backgroundColor;"),
    ("dense", "删掉一根句尾",
     "document.querySelector('[data-role=\"row\"][data-bar=\"102\"] [data-role=\"phrase-end\"]').remove();"),
    ("dense", "页面加一个超宽元素（左右溢出）",
     "const d=document.createElement('div'); d.style.cssText='width:2000px;height:4px'; document.querySelector('.work').appendChild(d); document.body.style.overflowX='auto'; document.documentElement.style.overflowX='auto'; d.style.position='absolute'; document.body.appendChild(d);"),
    ("dense", "两句横线叠在一起",
     "const b=[...document.querySelectorAll('[data-role=\"row\"][data-bar=\"S1\"] [data-role=\"phrase-band\"]')].find(x=>x.style.getPropertyValue('--e')!=='48'); b.style.setProperty('--e','48');"),
    ("phrases", "句子序号挪到下一根竖线上（只有「不重叠」能抓到）",
     "const n=document.querySelector('[data-role=\"phrase-num\"]'); const e=n.closest('[data-role=\"row\"]').querySelector('[data-role=\"phrase-end\"]'); const nr=n.getBoundingClientRect(), er=e.getBoundingClientRect(); n.style.transform='translate(' + (er.left - nr.left) + 'px,' + (er.top + 20 - nr.top) + 'px)';"),
    ("auto", "横幅被滚到工具条底下（只露一半）",
     "document.querySelector('.work').scrollTop = 30;"),
    ("auto", "待确认的句尾画成实线",
     "for (const e of document.querySelectorAll('[data-role=\"phrase-end\"]')) { e.style.backgroundImage='none'; e.style.backgroundColor='rgb(220,38,38)'; }"),
]


def load_fixture(root: pathlib.Path) -> dict:
    fx = json.loads((root / "fixtures_v33" / "koi_phrases.json").read_text(encoding="utf-8"))
    notes = {t: ln for t, ln in fx["notes"]}
    lyric = [[s["last"], s["end"]] for s in fx["lyricSentences"]]
    guess = [[t, t + notes[t]] for t in fx["guessEnds"]]
    run = next(r for r in fx["stats"]["longRuns"] if r["start"] // 192 == 98)
    return {"lyric": lyric, "guess": guess, "missEnd": run["end"]}


def fixture_for(screen: str, fx: dict) -> dict:
    out = {"step": STEP.get(screen, "1"), "missEnd": fx["missEnd"]}
    src = {"phrases": "lyric", "dense": "lyric", "rhyme": "lyric", "spacing": "lyric", "auto": "guess", "touch": "guess"}.get(screen)
    if src:
        pairs = fx[src]
        if screen == "dense":   # 压力样例不在样例数据里
            pairs = pairs + [[200 * 192 + t, 200 * 192 + t + 12] for t in (24, 72, 120, 168)] + \
                [[201 * 192 + 16, 201 * 192 + 32], [201 * 192 + 102, 201 * 192 + 108], [201 * 192 + 144, 202 * 192]]
        out["ends"] = [p[0] for p in pairs]
        out["endPairs"] = pairs
    return out


def open_page(browser, mock, screen, w, h, scheme):
    page = browser.new_page(viewport={"width": w, "height": h}, color_scheme=scheme)
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(f"页面异常 {e}"))
    page.on("console", lambda m: errors.append(f"控制台 {m.text}") if m.type == "error" else None)
    page.on("request", lambda r: errors.append(f"外网请求 {r.url}") if not r.url.startswith("file:") else None)
    page.goto((mock / f"{screen}.html").as_uri())
    page.wait_for_timeout(150)
    return page, errors


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    root = pathlib.Path(sys.argv[1]).resolve()
    ev = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("ANYBEATS_EVIDENCE")
    evidence = pathlib.Path(ev).resolve() if ev else None
    mock = root / "mockups_v33"
    shots = root / "screenshots_v33"
    shots.mkdir(parents=True, exist_ok=True)
    if evidence:
        (evidence / "screenshots_v33").mkdir(parents=True, exist_ok=True)
    fx = load_fixture(root)
    bad = 0
    log: list[str] = []

    def say(line: str) -> None:
        print(line)
        log.append(line)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for screen in SCREENS:
            for size, (w, h) in SIZES.items():
                for scheme in SCHEMES:
                    tag = f"{screen}_{size}_{scheme}"
                    page, errors = open_page(browser, mock, screen, w, h, scheme)
                    page.screenshot(path=str(shots / f"{tag}.png"))
                    if evidence:
                        shutil.copy(shots / f"{tag}.png", evidence / "screenshots_v33" / f"{tag}.png")
                    fails = errors + page.evaluate(PROBE_JS, [screen, fixture_for(screen, fx)])
                    page.close()
                    if fails:
                        bad += 1
                        say(f"✗ {tag}")
                        for f in fails:
                            say(f"    {f}")
                    else:
                        say(f"✓ {tag}")
        total = len(SCREENS) * len(SIZES) * len(SCHEMES)
        say(f"{total - bad}/{total} 个组合通过")

        # 反向探针：故意改坏，检查必须报错
        missed = 0
        say("反向探针（故意改坏，检查必须报错）：")
        for screen, what, js in MUTATIONS:
            page, errors = open_page(browser, mock, screen, 1280, 800, "light")
            base = errors + page.evaluate(PROBE_JS, [screen, fixture_for(screen, fx)])
            page.evaluate("() => {" + js + "}")
            fails = page.evaluate(PROBE_JS, [screen, fixture_for(screen, fx)])
            page.close()
            if base:
                missed += 1
                say(f"  ✗ {what}：改坏之前就不过（{base[0]}），探针无效")
            elif not fails:
                missed += 1
                say(f"  ✗ {what}：改坏了检查却没报错")
            else:
                say(f"  ✓ {what} → {fails[0]}")
        browser.close()

    if evidence:
        (evidence / "check_mockups_v33.log").write_text("\n".join(log) + "\n", encoding="utf-8")
    return 1 if bad or missed else 0


if __name__ == "__main__":
    sys.exit(main())
