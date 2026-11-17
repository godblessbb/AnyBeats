"""AnyBeats v3.2 构建产物检查：第 1 步方格。用 Chromium 打开 dist/index.html（file://），用真实的鼠标 / 键盘操作，在浏览器里量算断言。

用法：python -I e2e/check_app_v32.py dist/index.html [--shots 目录]

断言读的都是浏览器里的值（data-* 属性、计算样式、元素位置、历史面板条目），不 grep 源码。
场景（编号对应 design/DESIGN_v32.md / 合同）：
  1 默认方格：新建作品打开在第 1 步，每一格正好一个占满整拍的空方格（data-role=square，box 48），没有字
  2 点方格打字：点第 2 小节第 2 拍的方格 → 焦点在方格输入框；键盘打「我」→ 写进这一格（只改这一格，别的格逐个不变）
  3 空格一分二：1/4 → 1/8 → 1/16 → 1/32（每两下之间等 0.6 秒），字留在左边那一块；1/32 上再按空格被拒（格子不变、提示写 1/32）
  4 Shift+空格三连：三个 16 tick 方格 + 「3」标记
  5 两下空格（间隔 0.25 秒）→ 空音：这一拍没有方格；历史面板只多一条；Ctrl+Z 一次回到按空格前的整格（不是分开的两格），Ctrl+Shift+Z 回到空音
    反向探针：同样两下空格但间隔 0.6 秒，必须是两次分格、历史多两条——拿「只多一步、变成空音」的判定去判它必须判不过
  6 间隔超过 0.4 秒的两下空格是两次分格，不是空音（同上）
  7 输入法拼字中的空格不分格：用 CDP 开一段输入法组字（Input.imeSetComposition）再按空格、再上屏「你」→ 格子不分、字写进去、历史没有分格；
    另外派发 isComposing / keyCode 229 的空格 keydown → 什么都不做
  8 写了字的方格分开后字在左边（场景 3 里查）
  9 退格：空方格和另一半合回去；有字的先清字；整拍方格按退格不合
  10 清空全部 flow（「夜车」）：先就地确认（取消 = 不变）；确定后每一格一个空方格，段落标签、小节数、小节都在；历史多一条；
     Ctrl+Z 一次恢复到清空前逐字节一样（每个字的位置 / 长度 / 文字、每格的涂色）
     反向探针：比对函数拿改过一个字的快照去比，必须报出不同
  11 手机 390：点方格、打字、空格、Shift+空格、两下空格都能用；按键气泡在屏幕里
通用（桌面 1280×800 / 手机 390×844 × 浅 / 深）：方格和空音分得开（空方格有边线、底色和格子不同；空音那里没有方格）、
  方格在自己那一格里、字形在方格里、页面不左右溢出、无控制台错误、无外网请求；各状态截图存到 --shots。
任何一项不满足，退出码 1。只用标准库 + playwright（sync API）。
"""

import json
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

SIZES = {"desktop": (1280, 800), "mobile": (390, 844)}
SCHEMES = ("light", "dark")

# 一格里的方格：[拍内起点, 方格宽, 文字, empty/filled]
BEAT_JS = r"""
([bar, beat]) => {
  const c = document.querySelector(`[data-role="lyrics-sheet"] [data-role="cell"][data-bar="${bar}"][data-beat="${beat}"]`);
  if (!c) return null;
  const words = [...c.querySelectorAll('[data-role="word"]')];
  return [...c.querySelectorAll('[data-role="square"]')].map(s => {
    const w = words.find(x => x.dataset.tick === s.dataset.tick);
    const ch = w && w.querySelector('.ch');
    return [+s.dataset.tick, +s.dataset.box, w ? (ch ? ch.textContent.trim() : '') : '?', s.dataset.square];
  });
}
"""

# 整首快照：段落标签、每个字（全曲起点、长度、文字）、每格涂色
SNAP_JS = r"""
() => {
  const sheet = document.querySelector('[data-role="lyrics-sheet"]');
  return {
    sections: [...sheet.querySelectorAll('[data-role="section-label"]')].map(x => x.innerText.trim()),
    bars: sheet.querySelectorAll('[data-role="row"]').length,
    words: [...sheet.querySelectorAll('[data-role="word"]')].map(w => [+w.dataset.abs, +w.dataset.len, w.innerText.trim()]),
    paint: [...sheet.querySelectorAll('[data-role="cell"]')].map(c => c.dataset.bar + ':' + c.dataset.beat + ':' + (c.classList.contains('painted') ? c.style.getPropertyValue('--h') : '-')),
  };
}
"""

# 每一格都是一个占满整拍的空方格？返回不是的格子
DEFAULT_JS = r"""
() => [...document.querySelectorAll('[data-role="lyrics-sheet"] [data-role="cell"]')]
  .filter(c => {
    const sq = [...c.querySelectorAll('[data-role="square"]')];
    // 只算写上的字（.ch）；涂了色的空方格里显示的韵母占位（.ph）不是字
    const text = [...c.querySelectorAll('[data-role="word"] .ch')].map(w => w.textContent.trim()).join('');
    return sq.length !== 1 || sq[0].dataset.box !== '48' || sq[0].dataset.tick !== '0' || sq[0].dataset.square !== 'empty' || text;
  }).map(c => c.dataset.bar + ':' + c.dataset.beat)
"""

# 看得见的方格 / 空音：画法检查
LOOK_JS = r"""
() => {
  const errs = [];
  const parse = (s) => {
    const c = s && s.match(/color\(srgb ([^)]+)\)/);
    if (c) { const p = c[1].split(/[ \/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]; }
    const m = s && s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) { stack.push(c); if (c[3] >= 1) break; } }
    let out = [255, 255, 255];
    for (let i = stack.length - 1; i >= 0; i--) { const c = stack[i]; out = [0, 1, 2].map(k => c[k] * c[3] + out[k] * (1 - c[3])); }
    return out;
  };
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
  if (document.documentElement.scrollWidth > innerWidth + 1) errs.push('页面左右溢出 ' + document.documentElement.scrollWidth);
  let n = 0;
  for (const cell of document.querySelectorAll('[data-role="lyrics-sheet"] [data-role="cell"]')) {
    if (!vis(cell)) continue;
    const cr = cell.getBoundingClientRect(), cbg = bgOf(cell);
    const name = '第 ' + cell.dataset.bar + ' 小节第 ' + (+cell.dataset.beat + 1) + ' 拍';
    for (const sq of cell.querySelectorAll('[data-role="square"]')) {
      n++;
      const r = sq.getBoundingClientRect(), cs = getComputedStyle(sq), t = +sq.dataset.tick, b = +sq.dataset.box;
      if (r.left < cr.left - 0.5 || r.right > cr.right + 0.5) errs.push(name + ' tick ' + t + ' 的方格越过格线');
      const want = cr.left + cell.clientLeft + cell.clientWidth * t / 48 + 2, wantW = cell.clientWidth * b / 48 - 4;
      if (Math.abs(r.left - want) > 1.5 || Math.abs(r.width - wantW) > 1.5) errs.push(name + ' tick ' + t + ' 的方格位置 / 宽度不对');
      const bc = parse(cs.borderTopColor);
      if (!(parseFloat(cs.borderTopWidth) >= 1) || !bc || contrast(bc, cbg) < 1.5) errs.push(name + ' tick ' + t + ' 的方格没有看得见的边线');
      if (sq.dataset.square === 'empty' && contrast(bgOf(sq), cbg) < 1.06) errs.push(name + ' tick ' + t + ' 的空方格底色和格子一样');
      const w = [...cell.querySelectorAll('[data-role="word"]')].find(x => x.dataset.tick === sq.dataset.tick);
      const ch = w && w.querySelector('.ch');
      if (ch && ch.textContent.trim()) {
        const rg = document.createRange(); rg.selectNodeContents(ch); const gr = rg.getBoundingClientRect();
        if (gr.left < r.left - 0.5 || gr.right > r.right + 0.5) errs.push(name + '「' + ch.textContent + '」字形出了方格');
        if (parseFloat(getComputedStyle(ch).fontSize) < 11) errs.push(name + '「' + ch.textContent + '」字号 < 11');
      }
    }
  }
  for (const r of document.querySelectorAll('[data-role="rest"]')) {
    const cs = getComputedStyle(r), bg = parse(cs.backgroundColor);
    if (bg && bg[3] > 0) errs.push('空音画了底色');
    if (r.dataset.focus && cs.borderTopStyle !== 'dashed') errs.push('光标停着的空音不是虚线');
  }
  for (const id of ['square-tip', 'clear-flow-confirm']) {
    const el = document.querySelector(`[data-role="${id}"]`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.left < -0.5 || r.right > innerWidth + 0.5 || r.top < -0.5 || r.bottom > innerHeight + 0.5) errs.push(id + ' 不在屏幕里');
  }
  return { errs, squares: n };
}
"""


def diff_snap(a, b):
    """两份整首快照的不同之处（空 = 逐字节一样）。"""
    out = []
    for k in ("sections", "bars", "words", "paint"):
        if json.dumps(a.get(k), ensure_ascii=False) != json.dumps(b.get(k), ensure_ascii=False):
            out.append(k)
    return out


def judge_double(before_rows, after_rows, before_hist, after_hist):
    """「两下空格 = 空音、只多一步」的判定：返回不满足的地方（空 = 通过）。"""
    errs = []
    if after_rows:
        errs.append(f"这一拍还有方格：{after_rows}（应该变成空音）")
    if after_hist != before_hist + 1:
        errs.append(f"历史应该只多一条，实际多了 {after_hist - before_hist} 条")
    return errs


class Run:
    def __init__(self, target, shots):
        self.url = target.resolve().as_uri()
        self.shots = shots
        self.F = []

    def fail(self, tag, msg):
        self.F.append(f"[{tag}] {msg}")

    def page(self, browser, size="desktop", scheme="light"):
        w, h = SIZES[size]
        ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=scheme, device_scale_factor=2 if size == "mobile" else 1)
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

    def look(self, tag, page):
        r = page.evaluate(LOOK_JS)
        for e in r["errs"][:10]:
            self.fail(tag, e)
        return r

    def new_project(self, page):
        page.locator('[data-role="open-export"], [data-role="open-export-m"]').locator("visible=true").first.click()
        page.locator('[data-role="new-project"]').click()
        page.wait_for_timeout(200)
        page.keyboard.press("Escape")
        if page.locator('[data-role="rhyme-drawer"].open').count():
            page.locator('[data-role="rhyme-drawer"] .grab').click()
        page.wait_for_timeout(150)

    def cell(self, page, bar, beat):
        return page.locator(f'[data-role="lyrics-sheet"] [data-role="cell"][data-bar="{bar}"][data-beat="{beat}"]')

    def beat(self, page, bar, beat):
        return page.evaluate(BEAT_JS, [bar, beat])

    def pick(self, page, bar, beat, tick):
        """真实鼠标点第 bar 小节第 beat 拍里 tick 那个位置。"""
        c = self.cell(page, bar, beat)
        c.scroll_into_view_if_needed()
        b = c.bounding_box()
        page.mouse.click(b["x"] + b["width"] * (tick + 1.5) / 48, b["y"] + b["height"] / 2)
        page.wait_for_timeout(100)

    def focused_input(self, page):
        return page.evaluate("() => document.activeElement && document.activeElement.dataset.role") == "square-input"

    def hist(self, page):
        """历史面板里「做过的」条数（打开面板数完再关上）。"""
        page.locator('[data-role="history-btn"]').locator("visible=true").first.click()
        page.wait_for_timeout(80)
        n = page.locator('[data-role="history-entry"]:not(.redo)').count()
        page.keyboard.press("Escape")
        page.wait_for_timeout(60)
        return n

    def space(self, page, gap_ms=None):
        page.keyboard.press("Space")
        if gap_ms is not None:
            page.wait_for_timeout(gap_ms)

    # ---------- 1–9 方格编辑（桌面） ----------
    def squares(self, browser):
        tag = "方格编辑"
        ctx, page = self.page(browser)
        try:
            self.new_project(page)
            step = page.locator('[data-role="steps"] button.on').first.get_attribute("data-step")
            if step != "1":
                self.fail(tag, f"新建作品应该在第 1 步，实际 {step}")
            bad = page.evaluate(DEFAULT_JS)
            if bad:
                self.fail(tag, f"1 默认：这些格子不是一个空的 1/4 方格：{bad[:6]}")
            self.look(tag + " 默认", page)
            snap0 = page.evaluate(SNAP_JS)

            # 2 点方格打字
            self.pick(page, 2, 1, 10)
            if not self.focused_input(page):
                self.fail(tag, "2 点方格以后焦点不在方格输入框里")
            if page.locator('[data-role="square"][data-focus="1"]').count() != 1:
                self.fail(tag, "2 点方格以后没有正好一个光标方格")
            page.keyboard.type("我")
            page.wait_for_timeout(120)
            if self.beat(page, 2, 1) != [[0, 48, "我", "filled"]]:
                self.fail(tag, f"2 打「我」应该写进第 2 小节第 2 拍：{self.beat(page, 2, 1)}")
            snap1 = page.evaluate(SNAP_JS)
            changed = [w for w in snap1["words"] if w not in snap0["words"]]
            if changed != [[192 + 48, 48, "我"]]:
                self.fail(tag, f"2 打字只该改这一格，实际改了 {changed}")
            self.shot(page, "v32_type_desktop")

            # 3 空格一分二到 1/32，字留左边；再分被拒
            want = [
                [[0, 24, "我", "filled"], [24, 24, "", "empty"]],
                [[0, 12, "我", "filled"], [12, 12, "", "empty"], [24, 24, "", "empty"]],
                [[0, 6, "我", "filled"], [6, 6, "", "empty"], [12, 12, "", "empty"], [24, 24, "", "empty"]],
            ]
            for i, w in enumerate(want):
                self.space(page, 650)
                got = self.beat(page, 2, 1)
                if got != w:
                    self.fail(tag, f"3 第 {i + 1} 下空格后应该是 {w}，实际 {got}")
            self.shot(page, "v32_split32_desktop")
            h_before = self.hist(page)
            self.pick(page, 2, 1, 1)
            self.space(page, 650)
            if self.beat(page, 2, 1) != want[-1]:
                self.fail(tag, f"3 1/32 上再按空格不该再分：{self.beat(page, 2, 1)}")
            toast = page.locator('[data-role="toast"], .toast').all_inner_texts()
            if not any("1/32" in t for t in toast):
                self.fail(tag, f"3 1/32 再分应该提示「已经是 1/32」：{toast}")
            if self.hist(page) != h_before:
                self.fail(tag, "3 被拒的分格不该进历史")

            # 9 退格合并：右边空的 1/32 合回去；整拍方格不合；有字先清字
            self.pick(page, 2, 1, 7)
            page.keyboard.press("Backspace")
            page.wait_for_timeout(100)
            if self.beat(page, 2, 1) != want[1]:
                self.fail(tag, f"9 空的 1/32 按退格应该和另一半合成 1/16：{self.beat(page, 2, 1)}")
            self.pick(page, 2, 1, 30)
            page.keyboard.press("Backspace")
            page.wait_for_timeout(100)
            if self.beat(page, 2, 1) != want[1]:
                self.fail(tag, f"9 另一半分得更细时不该合：{self.beat(page, 2, 1)}")
            self.pick(page, 2, 1, 1)
            page.keyboard.press("Backspace")
            page.wait_for_timeout(100)
            if self.beat(page, 2, 1) != [[0, 12, "", "empty"], [12, 12, "", "empty"], [24, 24, "", "empty"]]:
                self.fail(tag, f"9 有字的方格按退格应该先清字：{self.beat(page, 2, 1)}")
            page.keyboard.press("Backspace")
            page.keyboard.press("Backspace")
            page.wait_for_timeout(120)
            if self.beat(page, 2, 1) != [[0, 48, "", "empty"]]:
                self.fail(tag, f"9 连按退格应该一层层合回整拍：{self.beat(page, 2, 1)}")
            page.keyboard.press("Backspace")
            page.wait_for_timeout(100)
            if self.beat(page, 2, 1) != [[0, 48, "", "empty"]]:
                self.fail(tag, "9 整拍方格按退格不该有变化")

            # 4 Shift+空格三连
            self.pick(page, 3, 0, 10)
            page.keyboard.press("Shift+Space")
            page.wait_for_timeout(120)
            if self.beat(page, 3, 0) != [[0, 16, "", "empty"], [16, 16, "", "empty"], [32, 16, "", "empty"]]:
                self.fail(tag, f"4 Shift+空格应该分成三连：{self.beat(page, 3, 0)}")
            if self.cell(page, 3, 0).locator('[data-role="triplet-mark"]').count() != 1:
                self.fail(tag, "4 三连那一拍没有一个「3」标记")
            self.shot(page, "v32_triplet_desktop")

            # 5 两下空格（0.25 秒）→ 空音，只多一步；撤销一次回整格
            self.pick(page, 4, 2, 5)
            rows0 = self.beat(page, 4, 2)
            snap_before = page.evaluate(SNAP_JS)
            h0 = self.hist(page)
            self.pick(page, 4, 2, 5)
            self.space(page, 250)
            self.space(page, 150)
            rows1 = self.beat(page, 4, 2)
            h1 = self.hist(page)
            for e in judge_double(rows0, rows1, h0, h1):
                self.fail(tag, "5 " + e)
            rest = page.locator('[data-role="rest"][data-focus="1"]')
            undo_title = page.locator('[data-role="undo"]').locator("visible=true").first.get_attribute("title") or ""
            if "空音" not in undo_title:
                self.fail(tag, f"5 撤销键应该写着撤销「→ 空音」那一步：{undo_title}")
            page.keyboard.press("Control+z")
            page.wait_for_timeout(120)
            if self.beat(page, 4, 2) != rows0:
                self.fail(tag, f"5 撤销一次应该回到按空格之前的整格 {rows0}，实际 {self.beat(page, 4, 2)}")
            if diff_snap(snap_before, page.evaluate(SNAP_JS)):
                self.fail(tag, "5 撤销一次以后整首和按空格之前不一样")
            page.keyboard.press("Control+Shift+z")
            page.wait_for_timeout(120)
            if self.beat(page, 4, 2):
                self.fail(tag, f"5 重做应该回到空音：{self.beat(page, 4, 2)}")
            # 空音看起来：那里没有方格；光标停着时是虚线
            self.pick(page, 4, 1, 5)
            self.space(page, 250)
            self.space(page, 150)
            if not rest.count():
                self.fail(tag, "5 两下空格以后光标没停在空音上（虚线）")
            self.look(tag + " 空音", page)
            self.shot(page, "v32_rest_desktop")
            page.keyboard.press("Escape")

            # 6 + 反向探针：间隔 0.6 秒的两下空格 = 两次分格
            self.pick(page, 5, 0, 5)
            r0 = self.beat(page, 5, 0)
            h0 = self.hist(page)
            self.pick(page, 5, 0, 5)
            self.space(page, 600)
            self.space(page, 150)
            r1 = self.beat(page, 5, 0)
            h1 = self.hist(page)
            if r1 != [[0, 12, "", "empty"], [12, 12, "", "empty"], [24, 24, "", "empty"]]:
                self.fail(tag, f"6 间隔 0.6 秒的两下空格应该是两次分格：{r1}")
            if h1 != h0 + 2:
                self.fail(tag, f"6 两次分格应该多两条历史，实际 {h1 - h0}")
            if not judge_double(r0, r1, h0, h1):
                self.fail(tag, "反向探针：慢的两下空格也被判成「空音、只多一步」——判定是摆设")

            # 7 输入法拼字中的空格不分格
            self.pick(page, 6, 0, 5)
            h0 = self.hist(page)
            self.pick(page, 6, 0, 5)
            cdp = ctx.new_cdp_session(page)
            cdp.send("Input.imeSetComposition", {"text": "ni", "selectionStart": 2, "selectionEnd": 2})
            page.wait_for_timeout(60)
            page.keyboard.press("Space")
            page.wait_for_timeout(60)
            page.keyboard.press("Space")
            page.wait_for_timeout(60)
            mid = self.beat(page, 6, 0)
            if mid != [[0, 48, "", "empty"]]:
                self.fail(tag, f"7 输入法拼字中按两下空格，格子不该分也不该变空音：{mid}")
            cdp.send("Input.insertText", {"text": "你"})
            page.wait_for_timeout(150)
            got = self.beat(page, 6, 0)
            if got != [[0, 48, "你", "filled"]]:
                self.fail(tag, f"7 输入法拼字时按空格不该分格，上屏的字写进这一格：{got}")
            h1 = self.hist(page)
            if h1 != h0 + 1:
                self.fail(tag, f"7 输入法这一段只该多一条（写字），实际 {h1 - h0}")
            self.pick(page, 6, 0, 5)
            for code in ("isComposing", "229"):
                page.evaluate(
                    """(code) => { const el = document.activeElement;
                      const ev = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true, isComposing: code === 'isComposing' });
                      if (code === '229') Object.defineProperty(ev, 'keyCode', { get: () => 229 });
                      el.dispatchEvent(ev); }""",
                    code,
                )
                page.wait_for_timeout(80)
                if self.beat(page, 6, 0) != [[0, 48, "你", "filled"]]:
                    self.fail(tag, f"7 {code} 的空格 keydown 不该分格：{self.beat(page, 6, 0)}")
            page.keyboard.press("Escape")
            self.look(tag, page)
            self.tail(tag, page)
        finally:
            ctx.close()

    # ---------- 10 清空全部 flow ----------
    def clear(self, browser):
        tag = "清空全部 flow"
        ctx, page = self.page(browser)
        try:
            page.locator('[data-role="steps"] button[data-step="1"]').first.click()
            page.wait_for_timeout(150)
            before = page.evaluate(SNAP_JS)
            if len(before["words"]) < 30:
                self.fail(tag, f"「夜车」字太少（{len(before['words'])}）")
            h0 = self.hist(page)
            page.locator('[data-role="clear-flow"]').click()
            confirm = page.locator('[data-role="clear-flow-confirm"]')
            if not confirm.is_visible():
                self.fail(tag, "点「清空全部 flow…」以后没有就地确认")
            self.look(tag + " 确认", page)
            self.shot(page, "v32_clear_confirm_desktop")
            page.locator('[data-role="clear-flow-no"]').click()
            page.wait_for_timeout(100)
            if diff_snap(before, page.evaluate(SNAP_JS)):
                self.fail(tag, "点「取消」以后作品变了")
            page.locator('[data-role="clear-flow"]').click()
            page.locator('[data-role="clear-flow-yes"]').click()
            page.wait_for_timeout(150)
            after = page.evaluate(SNAP_JS)
            bad = page.evaluate(DEFAULT_JS)
            if bad:
                self.fail(tag, f"清空后这些格子不是一个空的 1/4 方格：{bad[:6]}")
            if after["sections"] != before["sections"] or after["bars"] != before["bars"]:
                self.fail(tag, f"清空后段落 / 小节变了：{after['sections']} {after['bars']} ≠ {before['sections']} {before['bars']}")
            if self.hist(page) != h0 + 1:
                self.fail(tag, "清空全部 flow 应该只算历史里的一步")
            self.shot(page, "v32_cleared_desktop")
            page.keyboard.press("Control+z")
            page.wait_for_timeout(150)
            back = page.evaluate(SNAP_JS)
            d = diff_snap(before, back)
            if d:
                self.fail(tag, f"Ctrl+Z 一次以后和清空前不一样：{d}")
            # 反向探针：比对函数拿改过一个字的快照去比必须报出不同
            fake = json.loads(json.dumps(back))
            fake["words"][5] = [fake["words"][5][0], fake["words"][5][1], fake["words"][5][2] + "x"]
            if not diff_snap(before, fake):
                self.fail(tag, "反向探针：改了一个字的快照也判成一样——比对是摆设")
            self.tail(tag, page)
        finally:
            ctx.close()

    # ---------- 11 手机 ----------
    def mobile(self, browser):
        tag = "手机方格"
        ctx, page = self.page(browser, "mobile")
        try:
            self.new_project(page)
            self.pick(page, 1, 1, 5)
            page.keyboard.type("夜")
            page.wait_for_timeout(100)
            self.space(page, 650)
            if self.beat(page, 1, 1) != [[0, 24, "夜", "filled"], [24, 24, "", "empty"]]:
                self.fail(tag, f"手机上空格一分二、字留左边：{self.beat(page, 1, 1)}")
            self.look(tag + " 改字", page)
            tip = page.locator('[data-role="square-tip"]')
            if not tip.is_visible():
                self.fail(tag, "手机上看不到按键气泡")
            page.locator('[data-role="square-action"][data-act="triplet"]').click()
            page.wait_for_timeout(100)
            if self.beat(page, 1, 1) != [[0, 8, "夜", "filled"], [8, 8, "", "empty"], [16, 8, "", "empty"], [24, 24, "", "empty"]]:
                self.fail(tag, f"手机上点气泡「三连」应该把 1/8 分成半拍三连：{self.beat(page, 1, 1)}")
            if not self.focused_input(page):
                self.fail(tag, "点气泡按钮以后焦点应该还在方格输入框里")
            self.pick(page, 1, 2, 5)
            self.space(page, 200)
            self.space(page, 150)
            if self.beat(page, 1, 2):
                self.fail(tag, "手机上两下空格应该变成空音")
            self.tail(tag, page)
        finally:
            ctx.close()

    # ---------- 各状态截图：桌面 / 手机 × 浅 / 深 ----------
    def gallery(self, browser):
        for size in SIZES:
            for scheme in SCHEMES:
                tag = f"截图 {size} {scheme}"
                ctx, page = self.page(browser, size, scheme)
                try:
                    self.new_project(page)
                    self.look(tag + " 默认", page)
                    self.shot(page, f"v32_default_{size}_{scheme}")
                    self.pick(page, 2, 0, 5)
                    page.keyboard.type("我")
                    self.space(page, 650)
                    self.space(page, 650)
                    self.pick(page, 2, 1, 5)
                    page.keyboard.press("Shift+Space")
                    self.pick(page, 3, 2, 5)
                    self.space(page, 200)
                    self.space(page, 150)
                    self.pick(page, 2, 2, 5)
                    page.keyboard.type("夜")
                    page.wait_for_timeout(150)
                    self.look(tag + " 改字", page)
                    self.shot(page, f"v32_edit_{size}_{scheme}")
                    self.pick(page, 3, 1, 30)
                    self.space(page, 200)
                    self.space(page, 150)
                    self.look(tag + " 空音", page)
                    self.shot(page, f"v32_rest_{size}_{scheme}")
                    page.keyboard.press("Escape")
                    page.locator('[data-role="clear-flow"]').click()
                    page.wait_for_timeout(100)
                    self.look(tag + " 清空确认", page)
                    self.shot(page, f"v32_clear_{size}_{scheme}")
                    self.tail(tag, page)
                finally:
                    ctx.close()


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    target = pathlib.Path(args[0])
    shots = None
    if "--shots" in args:
        shots = pathlib.Path(args[args.index("--shots") + 1])
        shots.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        print(f"FAIL：找不到 {target}（先 npm run build）")
        return 1
    run = Run(target, shots)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for step in (run.squares, run.clear, run.mobile, run.gallery):
            try:
                step(browser)
            except Exception as exc:  # noqa: BLE001
                run.fail(step.__name__, f"检查出错：{str(exc).splitlines()[0]}")
        browser.close()
    if run.F:
        print(f"FAIL：{len(run.F)} 项不满足")
        for f in run.F:
            print("  - " + f)
        return 1
    print("OK：v3.2 构建产物全部断言通过（默认方格、点方格打字、空格分到 1/32 并拒绝再分、Shift+空格三连、两下空格空音只算一步、慢两下是两次分格、输入法空格不分格、字留左边、退格合并、清空全部 flow 可撤销、手机）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
