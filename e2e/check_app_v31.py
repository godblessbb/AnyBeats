"""AnyBeats v3.1 构建产物检查：用 Chromium 打开 dist/index.html（file://），用真实的鼠标 / 键盘操作，在浏览器里量算断言。

用法：python -I e2e/check_app_v31.py dist/index.html [--shots 目录]

断言读的都是浏览器里量出来的值（元素位置、计算样式、data-* 属性、localStorage），不 grep 源码。

通用（桌面 1280×800 / 手机 390×844 × 浅 / 深，各截一张）：
  - 无控制台错误 / 页面异常；无外网请求
  - 一拍 = 一格：表格里没有 v3 的字框（data-role=slot）、没有拖音细线（drag-line）、没有能点的 16 分小格（sub-tick）、没有 1/16 竖条（.band）；
    每个拍头里正好一个按钮；字（data-role=word）没有边线、没有底色；格子自己不画选中框（选中只能是 selection-box）
  - 字的左边按 tick 摆；字形不出格子；字号 ≥ 11px
  - 拖音浅底：比字框长的字从落点铺到结束（±1.5px），跨格接上，跨小节从下一行第一格左边接着铺；韵脚字的浅底和这一格同色相
  - 步骤按钮：当前步骤是强调色实底（和播放键同色）；「夜车」写过字，打开在第 2 步
场景：
  1 打字绝不改下一拍（桌面 + 手机）：双击格子、用键盘打字、回车——
      3 个位置打 3 个字按原节奏填；打 4 个字平分成 1/16；空拍打 1 / 2 / 3 个字 = 1/4、1/8、三连（标「3」）；
      位置不够又超过 4 个字 → 什么都不写、出「最多 4 个字」提示；每一次这一拍以外的字逐个不变；撤销一次回到上一步。
      反向探针：真的去改下一拍，确认「这一拍以外不变」的比对会报出来（比对不是摆设）。
      单击只选中、不进入改字。
  2 点拍头选整列跨 Verse / Hook（桌面 + 手机）：先用「+ 段落」加一段空的 Outro；点第 3 拍拍头的下半截（以前 16 分小格的位置）——
      拍头高亮；选中的正好是第 3 拍里有东西的格子（第 2–9 小节），一个连续的选中框，左右正好是这一列、上下从第 2 到第 9 小节，
      穿过 Hook 段落标题（标题那一行同一列垫了浅色）；第 1 小节、Outro 的空格子不在框里；表头别的拍没有强调色块。
      反向探针：同一个判定换成第 2 拍必须判不过。之后单击一格只选中这一格（选法没被切成整列）。
  3 「+ 段落」菜单依次是 Intro / Verse / Hook / Bridge / Outro，每种都能加
  4 新建作品（一个字都没写）打开在第 1 步；刷新以后还是第 1 步
  5 拖浅底右边缘改长度：第 1 步放一个字，拖把手跨过小节线 → 字变长、下一行第一格接着铺；第 2 步指针停在格子上出现把手，拖回来变短
任何一项不满足，退出码 1。只用标准库 + playwright（sync API）。

v3.2 调整（ct_afdb4134：用户要求第 1 步每个 1/4 拍默认一个占位方格，点方格进入改字；见 design/DESIGN_v32.md）：
  - 改掉的断言 1：场景 4「新建作品里不该有字」（info["words"] == 0）。v3.2 起新作品每拍有一个空方格（一个文字为空的字），
    所以看得见的字不再是 0。换成等价的新行为检查：新建作品里一个字都没写（每个字的文字都是空的），而且每一格正好一个占满整拍的空方格
    （data-role=square，data-box=48，data-square=empty）；「打开在第 1 步、刷新后还是第 1 步」原样保留。
  - 改掉的断言 2：场景 5 一开始「在新作品第 1 小节第 4 拍 80% 处点一下放一个 tick 36 的字」。v3.2 起那一拍本来就有一个方格，
    点它是进入改字，不再放字。换成：先用真实键盘把第 1 小节第 4 拍、第 2 小节第 1 拍各按两下空格变成空音（新行为），
    再在空出来的第 4 拍 80% 处点一下——点空白照旧按精度放一个 tick 36 的字（同一条断言），后面拖把手跨小节线、第 2 步拖回来的断言一条不改。
"""

import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

SIZES = {"desktop": (1280, 800), "mobile": (390, 844)}
SCHEMES = ("light", "dark")
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
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  };
  const inView = (r) => !(r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth);
  const round = (v) => Math.round(v * 10) / 10;
  const glyphRect = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); };
  const bgOf = (el) => { const c = parse(getComputedStyle(el).backgroundColor); return c && c[3] >= 0.05 ? c : null; };
  const same = (a, b) => a && b && [0, 1, 2].every(i => Math.abs(a[i] - b[i]) < 3);
  const out = { errs: [], step: null, words: 0, tints: 0, minFont: 99 };
  const E = (m) => out.errs.push(m);

  // 步骤按钮
  const steps = [...document.querySelectorAll('[data-role="steps"] button')].filter(rendered);
  const on = steps.filter(b => b.classList.contains('on'));
  out.step = on.length === 1 ? on[0].dataset.step : null;
  if (on.length !== 1) E('当前步骤按钮应正好 1 个，实际 ' + on.length);
  const play = [...document.querySelectorAll('[data-role="play"]')].find(rendered);
  if (on[0] && play && !same(bgOf(on[0]), bgOf(play))) E('当前步骤按钮不是强调色实底（' + getComputedStyle(on[0]).backgroundColor + '）');

  const sheet = document.querySelector('[data-role="lyrics-sheet"]');
  if (!sheet) { E('没有歌词表格'); return out; }
  if (sheet.querySelector('[data-role="slot"]')) E('表格里还有 v3 的字框（data-role=slot）');
  if (sheet.querySelector('[data-role="drag-line"]')) E('表格里还有拖音细线（drag-line）');
  if (document.querySelector('[data-role="sub-tick"]')) E('拍头里还有能点的 16 分小格');
  if ([...sheet.querySelectorAll('.band')].some(rendered)) E('格子里有 1/16 竖条');
  for (const h of sheet.querySelectorAll('[data-role="beat-head"]')) {
    const n = h.querySelectorAll('button').length;
    if (n !== 1) E('拍头 ' + (+h.dataset.beat + 1) + ' 里有 ' + n + ' 个按钮（应该整个拍头一个）');
  }
  const cells = [...sheet.querySelectorAll('[data-role="cell"]')];
  for (const c of cells) {
    const cs = getComputedStyle(c);
    if (c.classList.contains('now')) continue;
    if (cs.boxShadow !== 'none' || (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && !c.classList.contains('hold-hit')))
      E('第 ' + c.dataset.bar + ' 小节第 ' + (+c.dataset.beat + 1) + ' 拍自己画了框（选中只能画一个总框）');
  }
  const words = [...sheet.querySelectorAll('[data-role="word"]')];
  for (const w of words) {
    const cs = getComputedStyle(w);
    if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') E('字 ' + w.dataset.abs + ' 有边线（字框）');
    if (bgOf(w) && !w.classList.contains('now')) E('字 ' + w.dataset.abs + ' 有底色（字框）');
  }
  const geo = (c) => { const r = R(c); return { left: r.left + c.clientLeft, w: c.clientWidth, r }; };
  const c0Of = (c) => (+c.dataset.bar - 1) * 192 + +c.dataset.beat * 48;
  for (const c of cells.filter(c => rendered(c) && inView(R(c)))) {
    const g = geo(c);
    for (const w of c.querySelectorAll('[data-role="word"]')) {
      out.words++;
      const t = +w.dataset.tick, r = R(w), want = g.left + g.w * t / 48 + 1;
      if (Math.abs(r.left - want) > 1.5) E('第 ' + c.dataset.bar + ' 小节第 ' + (+c.dataset.beat + 1) + ' 拍 tick ' + t + '：字的左边偏 ' + round(r.left - want) + 'px');
      const ch = w.querySelector('.ch');
      if (ch && text(ch)) {
        const fs = parseFloat(getComputedStyle(ch).fontSize), gr = glyphRect(ch);
        out.minFont = Math.min(out.minFont, fs);
        if (fs < args.minFont - 0.01) E('「' + text(ch) + '」字号 ' + fs + 'px');
        if (gr.left < g.r.left - 0.5 || gr.right > g.r.right + 0.5) E('「' + text(ch) + '」字形出了格子');
      }
    }
  }
  // 拖音浅底：按字查
  const segsOf = {};
  for (const s of sheet.querySelectorAll('[data-role="hold-tint"]')) (segsOf[s.dataset.word] = segsOf[s.dataset.word] || []).push(s);
  for (const w of words) {
    const id = w.dataset.word, len = +w.dataset.len, box = +w.dataset.box, abs = +w.dataset.abs;
    const segs = (segsOf[id] || []).sort((a, b) => a.dataset.s - b.dataset.s);
    const tag = '第 ' + (Math.floor(abs / 192) + 1) + ' 小节 tick ' + (abs % 192);
    if (len <= box) { if (segs.length) E(tag + '：没拖长却铺了浅底'); continue; }
    if (!segs.length) { E(tag + '：拖长了（' + len + ' tick）却没有浅底'); continue; }
    out.tints++;
    if (+segs[0].dataset.s !== abs) E(tag + '：浅底不是从字的落点开始');
    if (+segs[segs.length - 1].dataset.e !== abs + len) E(tag + '：浅底没铺到字结束');
    for (let i = 1; i < segs.length; i++) if (segs[i].dataset.s !== segs[i - 1].dataset.e) E(tag + '：浅底中间断了');
    const home = w.closest('[data-role="cell"]');
    for (const s of segs) {
      const sc = s.closest('[data-role="cell"]');
      if (!rendered(sc) || !inView(R(sc))) continue;
      const g = geo(sc), sc0 = c0Of(sc), r = R(s), ss = +s.dataset.s, se = +s.dataset.e;
      const wantL = ss === abs ? g.left + g.w * (ss - sc0) / 48 + 1 : g.left - 1;
      const wantR = se === abs + len ? g.left + g.w * (se - sc0) / 48 - 1 : g.left + g.w + 1;
      if (Math.abs(r.left - wantL) > 1.5) E(tag + '：浅底在第 ' + sc.dataset.bar + ' 小节第 ' + (+sc.dataset.beat + 1) + ' 拍左边偏 ' + round(r.left - wantL) + 'px');
      if (Math.abs(r.right - wantR) > 1.5) E(tag + '：浅底在第 ' + sc.dataset.bar + ' 小节第 ' + (+sc.dataset.beat + 1) + ' 拍右边偏 ' + round(r.right - wantR) + 'px');
      if (ss !== abs && ss % 192 === 0 && sc.dataset.beat !== '0') E(tag + '：跨小节后没从下一行第一格接着铺');
      if (w.dataset.rhyme && home.classList.contains('painted')) {
        const bc = bgOf(s), hc = bgOf(home);
        if (!bc || !hc || hueDist(hsl(bc).h, hsl(hc).h) > 15) E(tag + '：韵脚字的浅底不是这一格的颜色');
      }
    }
  }
  return out;
}
"""

# 这一拍以外所有字的快照：[小节, 拍, 拍内起点, 长度, 字]
OTHERS_JS = r"""
([bar, beat]) => [...document.querySelectorAll('[data-role="lyrics-sheet"] [data-role="cell"]')]
  .filter(c => !(c.dataset.bar === String(bar) && c.dataset.beat === String(beat)))
  .flatMap(c => [...c.querySelectorAll('[data-role="word"]')].map(w => [c.dataset.bar, c.dataset.beat, w.dataset.tick, w.dataset.len, w.innerText.trim()]))
"""

BEAT_JS = r"""
([bar, beat]) => { const c = document.querySelector(`[data-role="lyrics-sheet"] [data-role="cell"][data-bar="${bar}"][data-beat="${beat}"]`);
  return c ? [...c.querySelectorAll('[data-role="word"]')].map(w => [+w.dataset.tick, +w.dataset.len, w.innerText.trim()]) : null; }
"""

# 整列选中的判定：给定第几拍（0 起），返回不满足的地方（空 = 通过）
COLUMN_JS = r"""
(beat) => {
  const errs = [];
  const sheet = document.querySelector('[data-role="lyrics-sheet"]');
  const R = (el) => el.getBoundingClientRect();
  const near = (a, b) => Math.abs(a - b) <= 2.5;
  const cells = [...sheet.querySelectorAll('[data-role="cell"]')];
  const head = sheet.querySelector(`[data-role="beat-head"][data-beat="${beat}"]`);
  if (!head || !head.classList.contains('on')) errs.push('拍头「' + (beat + 1) + '」没有高亮');
  const sel = cells.filter(c => c.dataset.selected === '1');
  if (sel.some(c => c.dataset.beat !== String(beat))) errs.push('选中了第 ' + (beat + 1) + ' 拍以外的格子');
  if (sel.some(c => c.dataset.content === 'empty')) errs.push('选中了空格子');
  const want = cells.filter(c => c.dataset.beat === String(beat) && c.dataset.content !== 'empty').map(c => c.dataset.bar);
  const got = sel.map(c => c.dataset.bar);
  if (want.join() !== got.join()) errs.push('选中的小节 ' + got.join(',') + '，应该是 ' + want.join(','));
  const boxes = [...sheet.querySelectorAll('[data-role="selection-box"]')];
  if (boxes.length !== 1) { errs.push('应该是 1 个连续的选中框，实际 ' + boxes.length + ' 个'); return { errs, got }; }
  const b = R(boxes[0]);
  const top = sheet.querySelector(`[data-role="cell"][data-bar="${want[0]}"][data-beat="${beat}"]`);
  const bot = sheet.querySelector(`[data-role="cell"][data-bar="${want[want.length - 1]}"][data-beat="${beat}"]`);
  if (top && bot) {
    const t = R(top), u = R(bot);
    if (!(near(b.left, t.left - 1) && near(b.right, t.right))) errs.push('选中框左右不是第 ' + (beat + 1) + ' 拍那一列');
    if (!(near(b.top, t.top - 1) && near(b.bottom, u.bottom))) errs.push('选中框上下不是第 ' + want[0] + ' 到第 ' + want[want.length - 1] + ' 小节');
  }
  const hook = [...sheet.querySelectorAll('[data-role="section-header"]')].find(h => h.innerText.trim().startsWith('Hook'));
  if (!hook) errs.push('没有 Hook 段落');
  else {
    const h = R(hook);
    if (!(h.top > b.top && h.bottom < b.bottom)) errs.push('选中框没有穿过 Hook 段落标题');
    const band = [...sheet.querySelectorAll('[data-role="selection-band"]')].some(x => { const r = R(x); return Math.abs(r.top - h.top) < 1.5 && near(r.left, b.left + 1) && near(r.right, b.right); });
    if (!band) errs.push('Hook 标题那一行同一列没垫浅色（会断开）');
  }
  for (const c of cells.filter(c => c.dataset.beat === String(beat) && c.dataset.content === 'empty')) {
    const r = R(c);
    if (r.top < b.bottom - 1 && r.bottom > b.top + 1) errs.push('空格子 第 ' + c.dataset.bar + ' 小节 在选中框里');
  }
  // 表头别的拍不能有强调色块（以前 1/16 小格的橙色竖条）
  const parse = (s) => { const m = s && s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const probe = document.createElement('div'); probe.style.color = 'var(--ab-accent)'; document.body.appendChild(probe);
  const ac = parse(getComputedStyle(probe).color); probe.remove();
  for (const h of sheet.querySelectorAll('[data-role="beat-head"]')) {
    if (h.dataset.beat === String(beat)) continue;
    for (const el of [h, ...h.querySelectorAll('*')]) {
      const c = parse(getComputedStyle(el).backgroundColor);
      if (c && c[3] > 0.5 && ac && [0, 1, 2].every(i => Math.abs(c[i] - ac[i]) < 8)) errs.push('拍头 ' + (+h.dataset.beat + 1) + ' 里有强调色块');
    }
  }
  return { errs, got };
}
"""


class Run:
    def __init__(self, target, shots):
        self.url = target.resolve().as_uri()
        self.shots = shots
        self.F = []

    def fail(self, tag, msg):
        self.F.append(f"[{tag}] {msg}")

    def page(self, browser, size="desktop", scheme="light", fresh=True):
        w, h = SIZES[size]
        mobile = size == "mobile"
        ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=scheme, device_scale_factor=2 if mobile else 1)
        page = ctx.new_page()
        page.errors, page.external = [], []
        page.on("console", lambda m: page.errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda exc: page.errors.append(str(exc)))
        page.on("request", lambda r: page.external.append(r.url) if not r.url.startswith(("file:", "data:", "about:", "blob:")) else None)
        page.route(re.compile(r"^(?!file:|data:|about:|blob:)"), lambda route: route.abort())
        page.goto(self.url, timeout=20000)
        page.wait_for_selector('[data-role="lyrics-sheet"]', timeout=15000)
        page.wait_for_timeout(300)
        return ctx, page

    def shot(self, page, name):
        if self.shots:
            page.screenshot(path=str(self.shots / f"{name}.png"))

    def tail(self, tag, page):
        for e in page.errors:
            self.fail(tag, f"控制台错误：{e}")
        for u in page.external:
            self.fail(tag, f"外网请求：{u}")
        page.errors.clear()
        page.external.clear()

    def probe(self, tag, page, want_step):
        info = page.evaluate(PROBE_JS, {"minFont": MIN_FONT})
        for e in info["errs"][:12]:
            self.fail(tag, e)
        if len(info["errs"]) > 12:
            self.fail(tag, f"另有 {len(info['errs']) - 12} 处")
        if want_step and info["step"] != want_step:
            self.fail(tag, f"当前步骤应该是 {want_step}，实际 {info['step']}")
        return info

    def cell(self, page, bar, beat):
        return page.locator(f'[data-role="lyrics-sheet"] [data-role="cell"][data-bar="{bar}"][data-beat="{beat}"]')

    def type_beat(self, page, bar, beat, text):
        """真实输入：双击格子，键盘打字，回车。"""
        c = self.cell(page, bar, beat)
        c.scroll_into_view_if_needed()
        c.dblclick(position={"x": 3, "y": 3})
        inp = page.locator('[data-role="cell-editor"]')
        inp.wait_for(timeout=3000)
        page.keyboard.press("Control+A")
        page.keyboard.type(text)
        page.wait_for_timeout(60)
        tip = page.locator('[data-role="edit-tip"]').inner_text()
        page.keyboard.press("Enter")
        page.wait_for_timeout(120)
        return tip

    # ---------- 通用 ----------
    def baseline(self, browser):
        for size in SIZES:
            for scheme in SCHEMES:
                tag = f"首屏 {size} {scheme}"
                ctx, page = self.page(browser, size, scheme)
                try:
                    self.shot(page, f"app_{size}_{scheme}")
                    info = self.probe(tag, page, "2")
                    if info["words"] < 30:
                        self.fail(tag, f"看得见的字太少（{info['words']}）")
                    if info["tints"] < 2:
                        self.fail(tag, f"看得见的拖音浅底太少（{info['tints']}）")
                    self.tail(tag, page)
                finally:
                    ctx.close()

    # ---------- 1 打字绝不改下一拍 ----------
    def typing(self, browser):
        for size in SIZES:
            tag = f"打字不改下一拍 {size}"
            ctx, page = self.page(browser, size)
            try:
                # 单击只选中，不进入改字
                self.cell(page, 2, 1).click(position={"x": 3, "y": 3})
                page.wait_for_timeout(80)
                sel = page.evaluate("""() => [...document.querySelectorAll('[data-role="cell"][data-selected="1"]')].map(c => c.dataset.bar + ':' + c.dataset.beat)""")
                if sel != ["2:1"] or page.locator('[data-role="cell-editor"]').count():
                    self.fail(tag, f"单击应该只选中第 2 小节第 2 拍、不进入改字（选中 {sel}）")
                if page.locator('[data-role="selection-box"]').count() != 1:
                    self.fail(tag, "单击一格应该正好一个选中框")
                cases = [
                    (2, 1, "灯火亮", [[0, 12, "灯"], [12, 12, "火"], [36, 12, "亮"]], "按这一拍原来的 3 个位置"),
                    (2, 1, "走得太慢", [[0, 12, "走"], [12, 12, "得"], [24, 12, "太"], [36, 12, "慢"]], "平分 4 份"),
                    (1, 0, "走", [[0, 48, "走"]], "平分 1 份"),
                    (1, 1, "夜色", [[0, 24, "夜"], [24, 24, "色"]], "平分 2 份"),
                    (1, 2, "慢慢走", [[0, 16, "慢"], [16, 16, "慢"], [32, 16, "走"]], "三连"),
                    (2, 0, "一二三四五六", None, "最多 4 个字"),
                ]
                for bar, beat, text, want, hint in cases:
                    before_beat = page.evaluate(BEAT_JS, [bar, beat])
                    others = page.evaluate(OTHERS_JS, [bar, beat])
                    tip = self.type_beat(page, bar, beat, text)
                    if hint not in tip:
                        self.fail(tag, f"第 {bar} 小节第 {beat + 1} 拍打「{text}」：输入框下面的说明不对（{tip[:60]}）")
                    got = page.evaluate(BEAT_JS, [bar, beat])
                    if want is None:
                        if got != before_beat:
                            self.fail(tag, f"打「{text}」（超过 4 个字）不该写进去：{before_beat} → {got}")
                        toast = page.locator('[data-role="toast"]')
                        if not toast.count() or "最多 4 个字" not in toast.inner_text():
                            self.fail(tag, "超过 4 个字没有出「最多 4 个字」的提示")
                        else:
                            self.shot(page, f"typing_too_many_{size}")
                    elif got != want:
                        self.fail(tag, f"第 {bar} 小节第 {beat + 1} 拍打「{text}」应该排成 {want}，实际 {got}")
                    after = page.evaluate(OTHERS_JS, [bar, beat])
                    if after != others:
                        diff = [x for x in after if x not in others][:3] + [x for x in others if x not in after][:3]
                        self.fail(tag, f"第 {bar} 小节第 {beat + 1} 拍打「{text}」改动了别的拍：{diff}")
                tri = self.cell(page, 1, 2).locator('[data-role="triplet-mark"]')
                if not tri.count() or tri.first.inner_text().strip() != "3":
                    self.fail(tag, "三连那一拍没标「3」")
                self.shot(page, f"typing_{size}")
                # 撤销一次：回到上一步（一次回车 = 一步）
                undo_beat = page.evaluate(BEAT_JS, [1, 2])
                page.locator('[data-role="undo"]').click()
                page.wait_for_timeout(120)
                if page.evaluate(BEAT_JS, [1, 2]) == undo_beat or page.evaluate(BEAT_JS, [1, 1]) != [[0, 24, "夜"], [24, 24, "色"]]:
                    self.fail(tag, "撤销一次应该正好撤掉最后一次回车（「慢慢走」）")
                # 反向探针：真的去改下一拍，「这一拍以外不变」的比对必须报出来
                others = page.evaluate(OTHERS_JS, [2, 1])
                self.type_beat(page, 2, 2, "风")
                if page.evaluate(OTHERS_JS, [2, 1]) == others:
                    self.fail(tag, "反向探针：改了第 2 小节第 3 拍，比对却没发现——「下一拍不变」的检查是摆设")
                self.probe(tag, page, "2")
                self.tail(tag, page)
            finally:
                ctx.close()

    # ---------- 2 点拍头选整列，跨段落 ----------
    def add_section(self, page, kind):
        page.locator('[data-role="add-section"]').scroll_into_view_if_needed()
        page.locator('[data-role="add-section"]').click()
        page.wait_for_timeout(80)
        page.locator('[role="menuitem"]').filter(has_text=re.compile(rf"^{kind}\b")).click()
        page.wait_for_timeout(120)

    def column(self, browser):
        for size in SIZES:
            tag = f"拍头选整列 {size}"
            ctx, page = self.page(browser, size)
            try:
                self.add_section(page, "Outro")
                labels = page.locator('[data-role="section-header"] [data-role="section-label"]').all_inner_texts()
                if labels[-1:] != ["Outro"]:
                    self.fail(tag, f"「+ 段落」选 Outro 没加上 Outro：{labels}")
                page.evaluate("() => document.querySelector('[data-role=\"work\"], main.work').scrollTop = 0")
                head = page.locator('[data-role="beat-head"][data-beat="2"]')
                hb = head.bounding_box()
                # 点拍头下半截：以前这里是 16 分小格（点了会冒出橙色竖条），现在整格都是选这一列
                page.mouse.click(hb["x"] + hb["width"] * 0.35, hb["y"] + hb["height"] - 5)
                page.wait_for_timeout(150)
                r = page.evaluate(COLUMN_JS, 2)
                for e in r["errs"]:
                    self.fail(tag, e)
                if r["got"] != [str(b) for b in range(2, 10)]:
                    self.fail(tag, f"「夜车」第 3 拍整列应该是第 2–9 小节，实际 {r['got']}")
                # 滚到 Verse / Hook 交界截图
                page.evaluate("""() => { const h = [...document.querySelectorAll('[data-role="section-header"]')].find(x => x.innerText.trim().startsWith('Hook')); h.scrollIntoView({ block: 'center' }); }""")
                page.wait_for_timeout(120)
                self.shot(page, f"column_{size}")
                r2 = page.evaluate(COLUMN_JS, 2)
                for e in r2["errs"]:
                    self.fail(tag + " 滚动后", e)
                # 反向探针：同一个判定拿第 2 拍来判，必须判不过
                neg = page.evaluate(COLUMN_JS, 1)
                if not neg["errs"]:
                    self.fail(tag, "反向探针：拿第 2 拍去判也判过了——整列的检查是摆设")
                # 再点一格：只选这一格，拍头不再高亮（选法没被切成整列）
                self.cell(page, 6, 0).click(position={"x": 3, "y": 3})
                page.wait_for_timeout(100)
                sel = page.evaluate("""() => [...document.querySelectorAll('[data-role="cell"][data-selected="1"]')].map(c => c.dataset.bar + ':' + c.dataset.beat)""")
                if sel != ["6:0"]:
                    self.fail(tag, f"点完拍头再单击一格应该只选这一格，实际 {sel}")
                if page.locator('[data-role="beat-head"].on').count():
                    self.fail(tag, "单击格子以后拍头还高亮着")
                self.probe(tag, page, "2")
                self.tail(tag, page)
            finally:
                ctx.close()

    # ---------- 3 段落类型 ----------
    def sections(self, browser):
        tag = "加段落选类型"
        ctx, page = self.page(browser)
        try:
            page.locator('[data-role="add-section"]').scroll_into_view_if_needed()
            page.locator('[data-role="add-section"]').click()
            page.wait_for_timeout(80)
            items = [t.split("·")[0].strip() for t in page.locator('[role="menuitem"]').all_inner_texts()]
            if items != ["Intro", "Verse", "Hook", "Bridge", "Outro"]:
                self.fail(tag, f"段落菜单应依次是 Intro / Verse / Hook / Bridge / Outro，实际 {items}")
            self.shot(page, "section_menu_desktop")
            page.keyboard.press("Escape")
            for kind in ("Bridge", "Intro", "Hook", "Outro", "Verse"):
                self.add_section(page, kind)
                label = page.locator('[data-role="section-header"] [data-role="section-label"]').all_inner_texts()[-1]
                if not label.startswith(kind):
                    self.fail(tag, f"选 {kind} 加出来的是 {label}")
            self.tail(tag, page)
        finally:
            ctx.close()

    # ---------- 4 空作品打开在第 1 步 ----------
    def empty(self, browser):
        for size in SIZES:
            tag = f"空作品在第 1 步 {size}"
            ctx, page = self.page(browser, size)
            try:
                page.locator('[data-role="open-export"], [data-role="open-export-m"]').locator("visible=true").first.click()
                page.locator('[data-role="new-project"]').click()
                page.wait_for_timeout(200)
                page.keyboard.press("Escape")
                page.wait_for_timeout(100)
                info = self.probe(tag, page, "1")
                cells = page.evaluate("""() => [...document.querySelectorAll('[data-role="lyrics-sheet"] [data-role="cell"]')].map(c => ({
                    k: c.dataset.bar + ':' + c.dataset.beat,
                    sq: [...c.querySelectorAll('[data-role="square"]')].map(s => s.dataset.box + '/' + s.dataset.square),
                    text: [...c.querySelectorAll('[data-role="word"]')].map(w => w.innerText.trim()).join('') }))""")
                if not cells or any(c["text"] for c in cells):
                    self.fail(tag, "新建作品里不该写着字")
                bad = [c["k"] for c in cells if c["sq"] != ["48/empty"]]
                if bad:
                    self.fail(tag, f"新建作品每一格应该正好一个空的 1/4 方格，这些格子不是：{bad[:6]}")
                self.shot(page, f"empty_{size}")
                page.wait_for_timeout(1300)
                page.reload()
                page.wait_for_selector('[data-role="lyrics-sheet"]')
                page.wait_for_timeout(250)
                self.probe(tag + " 刷新后", page, "1")
                self.tail(tag, page)
            finally:
                ctx.close()

    # ---------- 5 拖浅底右边缘改长度 ----------
    def drag(self, page, grip, to_cell, frac):
        g = grip.bounding_box()
        t = to_cell.bounding_box()
        page.mouse.move(g["x"] + g["width"] / 2, g["y"] + g["height"] / 2)
        page.mouse.down()
        page.mouse.move(t["x"] + t["width"] * frac, t["y"] + t["height"] / 2, steps=8)
        page.wait_for_timeout(60)
        preview = page.locator('[data-role="hold-preview"]').count()
        tip = page.locator('[data-role="drag-tip"]')
        tip_text = tip.inner_text() if tip.count() else ""
        page.mouse.up()
        page.wait_for_timeout(150)
        return preview, tip_text

    def hold(self, browser):
        tag = "拖浅底改长度"
        ctx, page = self.page(browser)
        try:
            page.locator('[data-role="open-export"]').click()
            page.locator('[data-role="new-project"]').click()
            page.wait_for_timeout(200)
            page.keyboard.press("Escape")
            # v3.2：新作品每拍一个方格。先把第 1 小节第 4 拍、第 2 小节第 1 拍按两下空格变成空音，空出位置
            for bar, beat in ((1, 3), (2, 0)):
                self.cell(page, bar, beat).click(position={"x": 6, "y": 25})
                page.wait_for_timeout(80)
                page.keyboard.press("Space")
                page.keyboard.press("Space")
                page.wait_for_timeout(120)
                page.keyboard.press("Escape")
                if self.cell(page, bar, beat).locator('[data-role="word"]').count():
                    self.fail(tag, f"第 {bar} 小节第 {beat + 1} 拍按两下空格没有变成空音")
            # 第 1 步：在第 1 小节第 4 拍 80% 处放一个字（1/16 → tick 36）
            c = self.cell(page, 1, 3)
            b = c.bounding_box()
            c.click(position={"x": b["width"] * 0.8, "y": b["height"] / 2})
            page.wait_for_timeout(100)
            w = c.locator('[data-role="word"]')
            if w.count() != 1 or w.first.get_attribute("data-tick") != "36":
                self.fail(tag, f"第 1 步点第 4 拍 80% 处应该放一个 tick 36 的字（{w.count()} 个）")
                return
            wid = w.first.get_attribute("data-word")
            grip = page.locator(f'[data-role="hold-grip"][data-word="{wid}"]')
            op = page.evaluate(f"""() => getComputedStyle(document.querySelector('[data-role="hold-grip"][data-word="{wid}"]')).opacity""")
            if float(op) < 0.5:
                self.fail(tag, f"第 1 步选中的字看不到改长度的把手（opacity {op}）")
            preview, tip = self.drag(page, grip, self.cell(page, 2, 0), 0.5)
            if not preview:
                self.fail(tag, "拖的时候没有预览")
            if "第 2 小节第 1 拍" not in tip:
                self.fail(tag, f"拖的时候小提示应该写拖到第 2 小节第 1 拍（{tip}）")
            ln = page.locator(f'[data-role="word"][data-word="{wid}"]').get_attribute("data-len")
            if ln != "36":
                self.fail(tag, f"从第 1 小节 tick 180 拖到第 2 小节第 1 拍中间应该长 36，实际 {ln}")
            nxt = self.cell(page, 2, 0).locator(f'[data-role="hold-tint"][data-word="{wid}"]')
            if not nxt.count():
                self.fail(tag, "拖过小节线以后，下一行第一格没有接着铺浅底")
            else:
                left = nxt.first.bounding_box()["x"]
                cl = page.evaluate("""() => { const c = document.querySelector('[data-role="cell"][data-bar="2"][data-beat="0"]'); return c.getBoundingClientRect().left + c.clientLeft; }""")
                if abs(left - (cl - 1)) > 1.5:
                    self.fail(tag, f"下一行的浅底没从第一格左边接着铺（差 {left - cl + 1:.1f}px）")
            self.probe(tag + " 第 1 步", page, "1")
            self.shot(page, "hold_step1_desktop")
            # 第 2 步：指针停在格子上出现把手，拖回来变短
            page.locator('[data-role="steps"] button[data-step="2"]').first.click()
            page.wait_for_timeout(100)
            tail_cell = self.cell(page, 2, 0)
            tail_cell.hover(position={"x": 2, "y": 4})
            page.wait_for_timeout(80)
            op = page.evaluate(f"""() => getComputedStyle(document.querySelector('[data-role="cell"][data-bar="2"][data-beat="0"] [data-role="hold-grip"][data-word="{wid}"]')).opacity""")
            if float(op) < 0.5:
                self.fail(tag, f"第 2 步指针停在格子上看不到把手（opacity {op}）")
            grip2 = tail_cell.locator(f'[data-role="hold-grip"][data-word="{wid}"]')
            self.drag(page, grip2, self.cell(page, 2, 0), 0.25)
            ln = page.locator(f'[data-role="word"][data-word="{wid}"]').get_attribute("data-len")
            if ln != "24":
                self.fail(tag, f"第 2 步拖回第 2 小节 tick 12 应该长 24，实际 {ln}")
            # 只点一下把手、不拖：不改长度
            tail_cell.hover(position={"x": 2, "y": 4})
            grip3 = page.locator(f'[data-role="hold-grip"][data-word="{wid}"]')
            gb = grip3.bounding_box()
            page.mouse.click(gb["x"] + gb["width"] / 2, gb["y"] + gb["height"] / 2)
            page.wait_for_timeout(100)
            if page.locator(f'[data-role="word"][data-word="{wid}"]').get_attribute("data-len") != "24":
                self.fail(tag, "只点了一下把手没拖，长度却变了")
            if page.locator('[data-role="drag-tip"]').count():
                self.fail(tag, "松手以后拖动小提示没消失")
            self.probe(tag + " 第 2 步", page, "2")
            self.tail(tag, page)
        finally:
            ctx.close()


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
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for step in (run.baseline, run.typing, run.column, run.sections, run.empty, run.hold):
            try:
                step(browser)
            except Exception as exc:  # noqa: BLE001  一个场景出错不影响其它场景，但算失败
                run.fail(step.__name__, f"检查出错：{str(exc).splitlines()[0]}")
        browser.close()
    if run.F:
        print(f"FAIL：{len(run.F)} 项不满足")
        for f in run.F:
            print("  - " + f)
        return 1
    print("OK：v3.1 构建产物全部断言通过（一拍一格、打字不改下一拍、拍头选整列跨段落、段落类型、空作品在第 1 步、拖浅底改长度）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
