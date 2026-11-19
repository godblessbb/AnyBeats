"""AnyBeats v3.4 段 1 构建产物检查：十三辙判韵。用 Chromium 打开 dist/index.html（file://），用真实的鼠标 / 键盘操作，在浏览器里量算断言。

用法：python -I e2e/check_app_v34_rhyme.py dist/index.html [--shots 目录]

断言读的都是浏览器里的值（data-* 属性、计算样式、可见文字、localStorage），不 grep 源码。
样例：design/fixtures_v34/koi_zh_lyrics_v4_nopickup.anybeats（用户的 v4 中文词，15 条规则、117 格涂色，没有 rhymeMatch 字段 = 旧作品）。
场景（编号对应 design/DESIGN_v34.md §9「段 1」那一行 / 合同）：
  1 导入 v4（「作品」面板点「导入」→ 文件选择框）：仍按严格判、0 处对不上、15 个色块；顶上迁移横幅写「15 条规则里同辙的会合并成 6 种颜色，
    格子颜色都不变」，横幅上的数字（data-miss-before / after、data-rules-before / after）= 0 / 0、15 / 6；右栏「判押韵」是「严格韵母」
  2 点「改用十三辙」：色块 6 个、117 格每一格的计算底色和点之前逐个相等、0 处对不上、横幅消失、右栏「十三辙」按下
  3 Ctrl+Z：一步回到 15 个色块、横幅回来、117 格颜色仍逐个相等；Ctrl+Shift+Z 再回到 6 个
  4 用 v4 构造「每种颜色一条规则」（蓝 an、绿 ong、粉 ao、金 ang、青 ei、草绿 i）导入：表格里正好 56 个字标着对不上、横幅写「全曲 56 处「不押」会消失」；
    点「改用十三辙」后 0 处、色块仍 6 个、颜色不变
    反向探针：把档写死成 strict（右栏点「严格韵母」，等于 App 不认作品设置、永远按严格判）→ 拿场景 2/4 的「十三辙 0 处对不上」判定去判，必须判红
  5 「先不改」：横幅消失、右栏是「严格韵母」、本机存的作品里写着 rhymeMatch: "strict"；刷新页面后不再出横幅
  6 新建作品默认十三辙：本机存的作品 rhymeMatch: "thirteen"、不出横幅、右栏「十三辙」按下；第 1 步在第 1–3 小节第 4 拍打「边 / 完 / 半」，
    第 2 步新建颜色定韵母 an、三格涂上 → 0 处对不上；切「严格韵母」→ 正好「边」「完」两处对不上（这一档的判法真的不同）
通用（桌面 1280×800 / 手机 390×844 × 浅 / 深）：导入 v4 后横幅在屏幕里、四个角没被盖住、不左右溢出、文字不出横幅；判押韵两档都截图
（横幅 + 严格韵母、改用十三辙以后的十三辙）；无控制台错误、无外网请求。
任何一项不满足，退出码 1。只用标准库 + playwright（sync API）。
"""

import json
import pathlib
import re
import sys
import tempfile

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "design" / "fixtures_v34" / "koi_zh_lyrics_v4_nopickup.anybeats"
SIZES = {"desktop": (1280, 800), "mobile": (390, 844)}
SCHEMES = ("light", "dark")
ONE_PER_HUE = {215: "an", 150: "ong", 340: "ao", 42: "ang", 185: "ei", 100: "i"}

# 页面状态：横幅、色块、判押韵档、每个涂了色的格子的计算底色、表格里标着对不上的字
STATE_JS = r"""
() => {
  const R = (el) => el.getBoundingClientRect();
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
  const b = document.querySelector('[data-role="migrate-banner"]');
  const sheet = document.querySelector('[data-role="lyrics-sheet"]');
  const sw = document.querySelector('[data-role="swatches"]');
  const judge = document.querySelector('[data-role="judge"]');
  const pressed = judge ? judge.querySelector('[data-role="judge-mode"] button[aria-pressed="true"]') : null;
  return {
    banner: b && rendered(b) ? { text: b.innerText.replace(/\s+/g, ' ').trim(), missBefore: +b.dataset.missBefore, missAfter: +b.dataset.missAfter,
                                  rulesBefore: +b.dataset.rulesBefore, rulesAfter: +b.dataset.rulesAfter, recolor: +b.dataset.recolor } : null,
    swatches: sw ? sw.querySelectorAll('[data-role="swatch"]').length : -1,
    judge: pressed ? pressed.dataset.mode : null,
    painted: sheet ? [...sheet.querySelectorAll('[data-role="cell"].painted')].map(c => c.dataset.bar + ':' + c.dataset.beat + '=' + getComputedStyle(c).backgroundColor) : [],
    miss: sheet ? [...sheet.querySelectorAll('[data-role="word"][data-mismatch]')].map(w => w.innerText.trim() + ' ' + w.dataset.mismatch) : [],
    toast: (document.querySelector('[data-role="toast"]') || {}).innerText || '',
  };
}
"""

# 横幅的样子：在屏幕里、四角没被盖住、文字不出横幅、页面不左右溢出；和「清空全部 flow…」就地确认同一种边框 / 底色
LOOK_JS = r"""
() => {
  const errs = [];
  const b = document.querySelector('[data-role="migrate-banner"]');
  if (!b) return ['没有迁移横幅'];
  const r = b.getBoundingClientRect();
  if (r.left < -0.5 || r.right > innerWidth + 0.5 || r.top < 0 || r.bottom > innerHeight) errs.push('横幅不在屏幕里：' + JSON.stringify([r.left, r.top, r.right, r.bottom].map(Math.round)));
  for (const [x, y] of [[r.left + 3, r.top + 3], [r.right - 3, r.top + 3], [r.left + 3, r.bottom - 3], [r.right - 3, r.bottom - 3]]) {
    const h = document.elementFromPoint(x, y);
    if (!h || !(h === b || b.contains(h))) errs.push('横幅有一角被盖住了（' + Math.round(x) + ',' + Math.round(y) + ' 是 ' + (h ? h.tagName.toLowerCase() + '.' + h.className : '空') + '）');
  }
  for (const el of b.querySelectorAll('.q, button')) {
    const e = el.getBoundingClientRect();
    if (e.left < r.left - 0.5 || e.right > r.right + 0.5 || e.top < r.top - 0.5 || e.bottom > r.bottom + 0.5) errs.push('横幅里的「' + el.innerText.slice(0, 8) + '」出了横幅');
    if (el.scrollWidth > el.clientWidth + 1) errs.push('横幅里的「' + el.innerText.slice(0, 8) + '」文字被截');
  }
  const se = document.scrollingElement;
  if (se.scrollWidth > innerWidth + 1) errs.push('页面左右溢出 ' + se.scrollWidth + ' > ' + innerWidth);
  const cs = getComputedStyle(b);
  const probe = document.createElement('div');
  probe.style.borderColor = getComputedStyle(document.documentElement).getPropertyValue('--ab-warn-line').trim();
  probe.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--ab-warn-soft').trim();
  document.body.appendChild(probe);
  const want = getComputedStyle(probe);
  if (cs.borderTopColor !== want.borderTopColor || cs.backgroundColor !== want.backgroundColor) errs.push('横幅不是「清空全部 flow…」就地确认那种警示边框 / 底色：' + cs.borderTopColor + ' / ' + cs.backgroundColor);
  probe.remove();
  const yes = b.querySelector('[data-role="migrate-yes"]'), no = b.querySelector('[data-role="migrate-no"]');
  if (!yes || !no) errs.push('横幅上缺「改用十三辙」/「先不改」');
  return errs;
}
"""

# 本机存的、名字是 name 的作品文件（作品库键名不写死：逐个找 schema 对得上的）
STORED_JS = r"""
(name) => {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i), v = localStorage.getItem(k);
    if (!v || v[0] !== '{') continue;
    try { const p = JSON.parse(v); if (p.schema === 'anybeats.project' && p.name === name) return { key: k, rhymeMatch: p.rhymeMatch === undefined ? null : p.rhymeMatch, rules: (p.rules || []).length }; } catch (e) {}
  }
  return null;
}
"""


def one_per_hue_project(v4):
    """v4 的词和涂色不动，规则换成每种颜色只有一条（§4.1 表第二行）。"""
    hue_of = {r["id"]: r["hue"] for r in v4["rules"]}
    p = json.loads(json.dumps(v4))
    p["name"] = "v4 一色一规则"
    p["rules"] = [{"id": f"h{h}", "hue": h, "count": 1, "finals": [f]} for h, f in ONE_PER_HUE.items()]
    p["paint"] = {k: f"h{hue_of[v]}" for k, v in v4["paint"].items()}
    return p


class Run:
    def __init__(self, target, shots):
        self.url = target.resolve().as_uri()
        self.shots = shots
        self.F = []

    def fail(self, tag, msg):
        self.F.append(f"[{tag}] {msg}")

    def page(self, browser, size="desktop", scheme="light"):
        w, h = SIZES[size]
        mobile = size == "mobile"
        ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=scheme, device_scale_factor=2,
                                  is_mobile=mobile, has_touch=mobile)
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

    def tail(self, tag, page):
        for e in page.errors:
            self.fail(tag, f"控制台错误：{e}")
        for u in page.external:
            self.fail(tag, f"外网请求：{u}")
        page.errors.clear()
        page.external.clear()

    def state(self, page):
        return page.evaluate(STATE_JS)

    def open_projects(self, page):
        page.locator('[data-role="open-projects"], [data-role="open-export-m"]').locator("visible=true").first.click()
        page.wait_for_timeout(150)

    def close_projects(self, page):
        page.locator('[aria-label="关闭作品与导出"]').locator("visible=true").first.click()
        page.wait_for_timeout(150)
        if page.locator('[data-role="rhyme-drawer"].open').count():
            page.locator('[data-role="rhyme-drawer"] .grab').click()
            page.wait_for_timeout(150)

    def import_file(self, page, path):
        """「作品」面板点「导入」→ 文件选择框选文件（真实鼠标点按钮）。"""
        self.open_projects(page)
        with page.expect_file_chooser() as fc:
            page.locator('[data-role="project-list"] button', has_text="导入").click()
        fc.value.set_files(str(path))
        page.wait_for_timeout(400)
        self.close_projects(page)

    def click(self, page, sel):
        page.locator(sel).locator("visible=true").first.click()
        page.wait_for_timeout(150)

    @staticmethod
    def thirteen_ok(st, swatches, painted0):
        """「改用十三辙以后」的判定：十三辙按下、横幅没了、色块数对、颜色逐格不变、0 处对不上。返回问题列表（空 = 过）。"""
        errs = []
        if st["judge"] != "thirteen":
            errs.append(f"右栏「判押韵」应该是十三辙，现在 {st['judge']}")
        if st["banner"]:
            errs.append("改用十三辙以后横幅还在")
        if st["swatches"] != swatches:
            errs.append(f"色块应该 {swatches} 个，现在 {st['swatches']} 个")
        if len(st["painted"]) != len(painted0):
            errs.append(f"涂了色的格子 {len(painted0)} → {len(st['painted'])}")
        elif st["painted"] != painted0:
            diff = [f"{a} → {b}" for a, b in zip(painted0, st["painted"]) if a != b]
            errs.append(f"{len(diff)} 格颜色变了：{diff[:3]}")
        if st["miss"]:
            errs.append(f"还有 {len(st['miss'])} 处对不上：{st['miss'][:4]}")
        return errs

    # ---------- 1–3 v4 样例：横幅 → 改用十三辙 → 撤销 / 重做 ----------
    def v4_migrate(self, browser):
        tag = "v4 改用十三辙"
        ctx, page = self.page(browser)
        try:
            self.import_file(page, FIXTURE)
            st = self.state(page)
            b = st["banner"]
            if not b:
                self.fail(tag, "1 导入没有 rhymeMatch 的 v4 后没有迁移横幅")
                return
            if (b["missBefore"], b["missAfter"], b["rulesBefore"], b["rulesAfter"], b["recolor"]) != (0, 0, 15, 6, 0):
                self.fail(tag, f"1 横幅数字应该是 不押 0→0、规则 15→6、变色 0 格，现在 {b}")
            for want in ("按旧规则判押韵", "15 条规则里同辙的会合并成 6 种颜色", "格子颜色都不变", "可以撤销"):
                if want not in b["text"]:
                    self.fail(tag, f"1 横幅里没写「{want}」：{b['text']}")
            if st["judge"] != "strict":
                self.fail(tag, f"1 旧作品打开应该还是严格韵母，右栏是 {st['judge']}")
            if st["swatches"] != 15:
                self.fail(tag, f"1 导入后应该 15 个色块，现在 {st['swatches']}")
            if len(st["painted"]) != 117:
                self.fail(tag, f"1 应该 117 格涂了色，现在 {len(st['painted'])}")
            if st["miss"]:
                self.fail(tag, f"1 严格档下 v4 本来 0 处对不上，现在 {st['miss'][:3]}")
            if not page.locator('[data-role="migrate-preview"]').locator("visible=true").count():
                self.fail(tag, "1 右栏没有「改用十三辙会怎样」")
            painted0 = st["painted"]

            self.click(page, '[data-role="migrate-yes"]')
            st = self.state(page)
            for e in self.thirteen_ok(st, 6, painted0):
                self.fail(tag, "2 " + e)
            if "15 条规则合并成 6 种颜色" not in st["toast"]:
                self.fail(tag, f"2 改完没有提示合并：{st['toast']}")

            page.keyboard.press("Control+z")
            page.wait_for_timeout(200)
            st = self.state(page)
            if st["swatches"] != 15 or not st["banner"] or st["judge"] != "strict":
                self.fail(tag, f"3 Ctrl+Z 一次应该回到 15 个色块、严格、横幅回来：色块 {st['swatches']}、{st['judge']}、横幅 {bool(st['banner'])}")
            if st["painted"] != painted0:
                self.fail(tag, "3 撤销后格子颜色和原来不一样")
            page.keyboard.press("Control+Shift+z")
            page.wait_for_timeout(200)
            st = self.state(page)
            for e in self.thirteen_ok(st, 6, painted0):
                self.fail(tag, "3 重做 " + e)
            self.tail(tag, page)
        finally:
            ctx.close()

    # ---------- 4 一色一规则：56 → 0；反向探针 ----------
    def one_per_hue(self, browser, path):
        tag = "一色一规则"
        ctx, page = self.page(browser)
        try:
            self.import_file(page, path)
            st = self.state(page)
            b = st["banner"] or {}
            if b.get("missBefore") != 56 or b.get("missAfter") != 0 or "全曲 56 处「不押」会消失" not in b.get("text", ""):
                self.fail(tag, f"4 横幅应该写全曲 56 处「不押」会消失：{b}")
            if len(st["miss"]) != 56:
                self.fail(tag, f"4 严格档下表格里应该正好 56 个字标着对不上，现在 {len(st['miss'])}")
            if st["swatches"] != 6:
                self.fail(tag, f"4 应该 6 个色块，现在 {st['swatches']}")
            painted0 = st["painted"]
            self.click(page, '[data-role="migrate-yes"]')
            st = self.state(page)
            for e in self.thirteen_ok(st, 6, painted0):
                self.fail(tag, "4 " + e)
            # 反向探针：档写死成 strict —— 同一个判定必须判红
            self.click(page, '[data-role="judge-mode"] button[data-mode="strict"]')
            probe = self.state(page)
            errs = self.thirteen_ok(probe, 6, painted0)
            if not any("对不上" in e for e in errs) or not any("十三辙" in e for e in errs):
                self.fail(tag, f"反向探针没咬住：档写死成 strict 以后「十三辙 0 处对不上」的判定还是过了（{errs}）")
            if len(probe["miss"]) != 56:
                self.fail(tag, f"反向探针：切回严格应该又是 56 处对不上，现在 {len(probe['miss'])}")
            self.tail(tag, page)
        finally:
            ctx.close()

    # ---------- 5 先不改 ----------
    def dismiss(self, browser):
        tag = "先不改"
        ctx, page = self.page(browser)
        try:
            self.import_file(page, FIXTURE)
            name = json.loads(FIXTURE.read_text(encoding="utf-8"))["name"]
            self.click(page, '[data-role="migrate-no"]')
            st = self.state(page)
            if st["banner"] or st["judge"] != "strict" or st["swatches"] != 15:
                self.fail(tag, f"5 点「先不改」后应该没有横幅、严格、15 个色块：横幅 {bool(st['banner'])}、{st['judge']}、{st['swatches']}")
            page.keyboard.press("Control+s")
            page.wait_for_timeout(200)
            stored = page.evaluate(STORED_JS, name)
            if not stored or stored["rhymeMatch"] != "strict":
                self.fail(tag, f"5 本机存的作品里应该写着 rhymeMatch: strict，现在 {stored}")
            page.reload()
            page.wait_for_selector('[data-role="lyrics-sheet"]', timeout=15000)
            page.wait_for_timeout(300)
            st = self.state(page)
            if st["banner"]:
                self.fail(tag, "5 刷新以后又问了（横幅又出来了）")
            if st["judge"] != "strict":
                self.fail(tag, f"5 刷新以后应该还是严格韵母，现在 {st['judge']}")
            self.tail(tag, page)
        finally:
            ctx.close()

    # ---------- 6 新建作品默认十三辙；边 / 完 / 半 ----------
    def new_project(self, browser):
        tag = "新建作品"
        ctx, page = self.page(browser)
        try:
            self.open_projects(page)
            page.locator('[data-role="new-project"]').click()
            page.wait_for_timeout(250)
            self.close_projects(page)
            stored = page.evaluate("""() => { const id = localStorage.getItem('anybeats.current.v2'); const v = id && localStorage.getItem('anybeats.project.v2.' + id); return v ? JSON.parse(v).rhymeMatch || null : 'none'; }""")
            if stored != "thirteen":
                self.fail(tag, f"6 新建作品本机存的 rhymeMatch 应该是 thirteen，现在 {stored}")
            # 第 1 步：第 1–3 小节第 4 拍的方格里打「边 / 完 / 半」
            for bar, ch in ((1, "边"), (2, "完"), (3, "半")):
                c = page.locator(f'[data-role="lyrics-sheet"] [data-role="cell"][data-bar="{bar}"][data-beat="3"]')
                c.scroll_into_view_if_needed()
                bb = c.bounding_box()
                page.mouse.click(bb["x"] + bb["width"] * 0.3, bb["y"] + bb["height"] / 2)
                page.wait_for_timeout(100)
                page.keyboard.type(ch)
                page.wait_for_timeout(100)
                page.keyboard.press("Escape")
                page.wait_for_timeout(80)
            self.click(page, '[data-role="steps"] button[data-step="2"]')
            st = self.state(page)
            if st["banner"]:
                self.fail(tag, "6 新建作品不该出迁移横幅")
            if st["judge"] != "thirteen":
                self.fail(tag, f"6 新建作品右栏应该是十三辙，现在 {st['judge']}")
            self.click(page, '[data-role="add-rule"]')
            fin = page.locator('[data-role="final-input"]').locator("visible=true").first
            fin.click()
            fin.fill("an")
            fin.press("Enter")
            page.wait_for_timeout(100)
            for bar in (1, 2, 3):
                page.locator(f'[data-role="lyrics-sheet"] [data-role="cell"][data-bar="{bar}"][data-beat="3"]').click(position={"x": 4, "y": 4})
                self.click(page, '[data-role="paint"]')
            st = self.state(page)
            if len(st["painted"]) != 3:
                self.fail(tag, f"6 应该涂上 3 格，现在 {len(st['painted'])}")
            rhymes = page.evaluate("""() => [...document.querySelectorAll('[data-role="lyrics-sheet"] [data-role="word"][data-rhyme]')].map(w => w.innerText.trim())""")
            if sorted(rhymes) != sorted(["边", "完", "半"]):
                self.fail(tag, f"6 韵脚字应该是 边 完 半，现在 {rhymes}")
            if st["miss"]:
                self.fail(tag, f"6 十三辙下「边 / 完 / 半」押 an 不该报对不上：{st['miss']}")
            hint = page.locator('[data-role="zhe-hint"]').locator("visible=true")
            if not hint.count() or "言前辙" not in hint.first.inner_text():
                self.fail(tag, "6 规则块里没写「言前辙 · an ian uan üan 都算」")
            self.click(page, '[data-role="judge-mode"] button[data-mode="strict"]')
            st = self.state(page)
            got = sorted(m.split(" ")[0] for m in st["miss"])
            if got != sorted(["边", "完"]):
                self.fail(tag, f"6 切严格韵母后应该正好「边」「完」对不上，现在 {st['miss']}")
            self.tail(tag, page)
        finally:
            ctx.close()

    # ---------- 截图 + 横幅样子：桌面 / 手机 × 浅 / 深 ----------
    def looks(self, browser):
        for size in SIZES:
            for scheme in SCHEMES:
                tag = f"截图 {size} {scheme}"
                ctx, page = self.page(browser, size, scheme)
                try:
                    if size == "mobile":
                        # 手机抽屉里「作品与导出」的标题行（带关闭键）被现网 CSS 藏了（.drawer .dbody .pn > .pn-h:first-child，改动前就这样），
                        # 导入后回不到押韵面板：先用桌面宽度导入、点关闭，再把窗口改回 390 宽（同一页、同一份状态，布局按宽度切成手机版）
                        page.set_viewport_size({"width": SIZES["desktop"][0], "height": SIZES["desktop"][1]})
                        page.wait_for_timeout(150)
                        self.import_file(page, FIXTURE)
                        page.set_viewport_size({"width": SIZES["mobile"][0], "height": SIZES["mobile"][1]})
                        page.wait_for_timeout(300)
                    else:
                        self.import_file(page, FIXTURE)
                    page.evaluate("() => document.querySelector('[data-role=\"work\"]').scrollTo(0, 0)")
                    page.wait_for_timeout(100)
                    for e in page.evaluate(LOOK_JS):
                        self.fail(tag, e)
                    self.shot(page, f"banner_{size}_{scheme}")
                    if size == "mobile":
                        page.locator('[data-role="rhyme-drawer"] .grab').click()
                        page.wait_for_timeout(250)
                    judge = page.locator('[data-role="judge"]').locator("visible=true").first
                    judge.scroll_into_view_if_needed()
                    page.wait_for_timeout(100)
                    if judge.get_attribute("data-mode") != "strict":
                        self.fail(tag, "旧作品右栏判押韵应该是严格韵母")
                    if page.locator('[data-role="zhe-table"]').locator("visible=true").count() != 1:
                        self.fail(tag, "严格档的判押韵块里应该有十三辙全表")
                    elif page.locator('[data-role="zhe-table"] > span').count() != 13:
                        self.fail(tag, "十三辙全表应该 13 行")
                    self.shot(page, f"judge_strict_{size}_{scheme}")
                    self.click(page, '[data-role="judge-mode"] button[data-mode="thirteen"]')
                    page.wait_for_timeout(150)
                    judge = page.locator('[data-role="judge"]').locator("visible=true").first
                    judge.scroll_into_view_if_needed()
                    page.wait_for_timeout(100)
                    if judge.get_attribute("data-mode") != "thirteen":
                        self.fail(tag, "右栏点「十三辙」没切过去")
                    if page.locator('[data-role="migrate-banner"]').count():
                        self.fail(tag, "右栏切十三辙以后横幅还在")
                    # 提示条 4 秒后消失：等它走了再截，免得盖住「判押韵」两档
                    page.locator('[data-role="toast"]').wait_for(state="detached", timeout=8000)
                    page.wait_for_timeout(100)
                    self.shot(page, f"judge_thirteen_{size}_{scheme}")
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
    if not FIXTURE.exists():
        print(f"FAIL：找不到样例 {FIXTURE}")
        return 1
    run = Run(target, shots)
    v4 = json.loads(FIXTURE.read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as tmp:
        one = pathlib.Path(tmp) / "v4_一色一规则.anybeats"
        one.write_text(json.dumps(one_per_hue_project(v4), ensure_ascii=False), encoding="utf-8")
        with sync_playwright() as p:
            browser = p.chromium.launch()
            steps = [run.v4_migrate, lambda b: run.one_per_hue(b, one), run.dismiss, run.new_project, run.looks]
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
    print("OK：v3.4 段 1 十三辙判韵全部断言通过（旧作品横幅数字、改用十三辙 15→6 色块颜色不变 0 处对不上、Ctrl+Z 一步回来、一色一规则 56→0、"
          "反向探针咬住、先不改写 strict 不再问、新建作品默认十三辙「边 / 完 / 半」不报不押、桌面 / 手机 × 浅 / 深截图）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
