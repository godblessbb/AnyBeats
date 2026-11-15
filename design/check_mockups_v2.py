"""AnyBeats v2 视觉稿自动检查。

用法：python -I design/check_mockups_v2.py design

对 design/mockups_v2/*.html 的每个画面 × 两个真实窗口尺寸（桌面 1280×800、手机 390×844）× 浅/深色：
  - 截图到 design/screenshots_v2/<画面>_<desktop|mobile>_<light|dark>.png
  - 通用断言：无控制台错误 / 页面异常；无外网请求（只允许 file: / data:）；
    任何可见元素都没有 text-transform: uppercase；强调色（--ab-accent 和播放键底色）色相不在 250–310°；
    主要文字（h1–h4、[data-contrast]、网格字 .s .ch、草稿字 .dl-text）对比度 ≥ 4.5:1；深色确实生效；
    页面可见文本里没有「∅」「Worker」「AI 写词」；
    手机画面：押韵抽屉 [data-role=rhyme-drawer] 可见、贴底、收起高度 ≤ 64px。
  - 本单专属断言（按画面文件名写死，页面不能自己声明跳过）：
    草稿画面（draft / draft_back）：[data-role=draft-editor] 可见，且有可见的「铺到拍子上」按钮；
    网格画面（grid）：同一行里至少一处 ≥2 个字带同一押韵类且底色相同、非透明、和普通格不同（一个双押块只算一处）；
      至少一处连续 ≥2 字的双押块（格子首尾相接、同一底色、外面有一个盖住这几格的可见框）；图例可见并说明双押；
    网格画面（grid / record）：每拍边界（第 5、9、13 格左边线）和拍内边界的线样式可区分；
    伴奏空态（empty）：[data-role=beat-empty] 里「选择伴奏文件」和「先用节拍器写」两个入口都在首屏可见；
    录音（record）：轨道区里至少 3 条可见音轨（每条有波形），录音键和音轨在同一个轨道区。
任何一项不满足，退出码 1。只用标准库 + playwright（sync API）。
"""

import colorsys
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

SIZES = {
    "desktop": (1280, 800),
    "mobile": (390, 844),
}
SCHEMES = ("light", "dark")
PURPLE_HUE = (250.0, 310.0)
MIN_CONTRAST = 4.5
MAX_DRAWER = 64
BANNED_TEXT = ("∅", "Worker", "AI 写词")

# 每个画面必须过的专属断言。文件缺了也算失败。
REQUIRED = {
    "empty": {"empty"},
    "draft": {"draft"},
    "grid": {"rhyme", "block", "beats", "legend"},
    "draft_back": {"draft"},
    "record": {"record", "beats"},
}

PROBE_JS = r"""
() => {
  const parse = (s) => {
    const m = s && s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const inView = (r) => !(r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth);
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || !inView(r)) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  const blend = (top, bottom) => {
    const a = top[3];
    return [0, 1, 2].map(i => top[i] * a + bottom[i] * (1 - a)).concat([1]);
  };
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
  const text = (el) => (el.innerText || el.textContent || '').trim();

  const out = { uppercase: [], contrast: [], checked: 0, accent: [], pageBg: null, banned: [],
                drawer: null, draft: null, rhyme: null, block: null, beats: null, legend: null, empty: null, record: null };

  // 通用：全大写
  for (const el of document.querySelectorAll('body *')) {
    if (getComputedStyle(el).textTransform === 'uppercase' && el.textContent.trim() && visible(el)) {
      out.uppercase.push(el.tagName.toLowerCase() + '.' + el.className + ' "' + el.textContent.trim().slice(0, 20) + '"');
    }
  }
  // 通用：对比度
  for (const el of document.querySelectorAll('h1, h2, h3, h4, [data-contrast], .s .ch, .dl-text')) {
    if (!text(el) || !visible(el)) continue;
    const fg = parse(getComputedStyle(el).color);
    if (!fg) continue;
    const bg = bgOf(el);
    const r = ratio(blend(fg, bg), bg);
    out.checked += 1;
    if (r < 4.5) out.contrast.push({ text: text(el).slice(0, 16), ratio: Math.round(r * 100) / 100,
      fg: getComputedStyle(el).color, bg: 'rgb(' + bg.slice(0, 3).map(Math.round).join(',') + ')' });
  }
  // 通用：强调色
  const probe = document.createElement('div');
  probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--ab-accent').trim();
  document.body.appendChild(probe);
  out.accent.push({ src: '--ab-accent', color: getComputedStyle(probe).color });
  probe.remove();
  for (const sel of ['[data-role="play"]', '[data-role="play-m"]']) {
    const play = document.querySelector(sel);
    if (visible(play)) out.accent.push({ src: 'play button ' + sel, color: getComputedStyle(play).backgroundColor });
  }
  const pb = parse(getComputedStyle(document.body).backgroundColor);
  out.pageBg = pb ? lum(pb) : null;

  // 通用：可见文本里的禁词（innerText 只含渲染出来的文字），外加可见输入框的占位文字
  let visibleText = document.body.innerText || '';
  for (const el of document.querySelectorAll('[placeholder]')) if (visible(el)) visibleText += '\n' + el.getAttribute('placeholder');
  for (const w of WORDS) if (visibleText.includes(w)) {
    const i = visibleText.indexOf(w);
    out.banned.push({ word: w, ctx: visibleText.slice(Math.max(0, i - 12), i + w.length + 12).replace(/\s+/g, ' ') });
  }

  // 押韵抽屉
  const dr = document.querySelector('[data-role="rhyme-drawer"]');
  if (dr) {
    const r = dr.getBoundingClientRect();
    out.drawer = { visible: visible(dr), height: r.height, bottom: r.bottom };
  }

  // 草稿
  const de = document.querySelector('[data-role="draft-editor"]');
  const btns = [...document.querySelectorAll('button, [role="button"]')].filter(b => visible(b) && text(b).includes('铺到拍子上'));
  out.draft = { editor: visible(de), button: btns.length > 0 };

  // 网格：押韵格
  const grid = document.querySelector('[data-role="lyrics-grid"]');
  const rows = grid ? [...grid.querySelectorAll('.row')].filter(visible) : [];
  const hasCh = (s) => { const c = s.querySelector('.ch'); return !!(c && text(c) && visible(c)); };
  const bgKey = (el) => { const c = parse(getComputedStyle(el).backgroundColor); return c && c[3] > 0.02 ? c.map(v => Math.round(v * 100) / 100).join(',') : null; };
  if (grid) {
    let best = { row: null, n: 0, group: null };
    for (const row of rows) {
      const slots = [...row.querySelectorAll('[data-i]')];
      const plain = slots.filter(s => hasCh(s) && !s.hasAttribute('data-rhyme')).map(bgKey);
      // 一个双押块只算一个「位置」：要求句内还有块以外的同韵字，不能光靠一个块凑出 2 个字
      const groups = {}, seenBlock = {};
      for (const s of slots) {
        if (!s.hasAttribute('data-rhyme') || !hasCh(s)) continue;
        const k = bgKey(s);
        if (!k || plain.includes(k)) continue;   // 透明或和普通格一样 = 看不出来，不算
        const g = s.getAttribute('data-rhyme') + '|' + k;
        const blk = s.getAttribute('data-block');
        if (blk) { if (seenBlock[g + blk]) continue; seenBlock[g + blk] = 1; }
        groups[g] = (groups[g] || 0) + 1;
      }
      for (const g in groups) if (groups[g] > best.n) best = { row: row.getAttribute('data-bar'), n: groups[g], group: g.split('|')[0] };
    }
    out.rhyme = best;

    // 双押块
    const blocks = [];
    for (const row of rows) {
      const by = {};
      for (const s of row.querySelectorAll('[data-block]')) {
        if (!s.hasAttribute('data-i')) continue;
        (by[s.getAttribute('data-block')] = by[s.getAttribute('data-block')] || []).push(s);
      }
      for (const id in by) {
        const ss = by[id].sort((a, b) => +a.dataset.i - +b.dataset.i);
        const why = [];
        if (ss.length < 2) why.push('不足 2 格');
        if (!ss.every(hasCh)) why.push('有格子没字');
        for (let i = 1; i < ss.length; i++) {
          if (+ss[i].dataset.i !== +ss[i - 1].dataset.i + 1) why.push('格子不连续');
          if (Math.abs(ss[i].getBoundingClientRect().left - ss[i - 1].getBoundingClientRect().right) > 1.5) why.push('格子没首尾相接');
        }
        const keys = ss.map(bgKey);
        if (keys.some(k => !k)) why.push('底色透明');
        else if (new Set(keys).size !== 1) why.push('底色不一致');
        const box = row.querySelector('[data-role="rhyme-block"][data-block="' + id + '"]');
        if (!visible(box)) why.push('没有可见的块框');
        else {
          const br = box.getBoundingClientRect(), a = ss[0].getBoundingClientRect(), z = ss[ss.length - 1].getBoundingClientRect();
          if (br.left > a.left + 4 || br.right < z.right - 4) why.push('块框没盖住这几格');
          const cs = getComputedStyle(box);
          if (!(parseFloat(cs.borderTopWidth) >= 1 && parse(cs.borderTopColor) && parse(cs.borderTopColor)[3] > 0)) why.push('块框没有边线');
        }
        blocks.push({ row: row.getAttribute('data-bar'), id, n: ss.length, ok: why.length === 0, why: [...new Set(why)].join('、') });
      }
    }
    out.block = blocks;

    // 拍线：每拍边界（data-sub=0 且不是小节第一格）vs 拍内边界（data-sub>0）
    const sig = (s) => { const cs = getComputedStyle(s); return [cs.borderLeftStyle, cs.borderLeftWidth, cs.borderLeftColor].join(' '); };
    const beatSigs = new Set(), subSigs = new Set();
    let thin = 0;
    for (const row of rows) {
      for (const s of row.querySelectorAll('[data-i]')) {
        if (s.dataset.sub === '0' && s.dataset.beat !== '0') {
          beatSigs.add(sig(s));
          const cs = getComputedStyle(s);
          if (cs.borderLeftStyle === 'none' || parseFloat(cs.borderLeftWidth) < 1 || !(parse(cs.borderLeftColor) || [0, 0, 0, 0])[3]) thin++;
        } else if (s.dataset.sub !== '0') subSigs.add(sig(s));
      }
    }
    out.beats = { rows: rows.length, beat: [...beatSigs], sub: [...subSigs], overlap: [...beatSigs].filter(x => subSigs.has(x)), invisible: thin };
  }

  const lg = document.querySelector('[data-role="rhyme-legend"]');
  out.legend = { visible: visible(lg), text: lg ? text(lg) : '' };

  // 伴奏空态
  const be = document.querySelector('[data-role="beat-empty"]');
  const entry = (sel) => {
    const el = be && be.querySelector(sel);
    if (!el) return { ok: false, why: '不存在' };
    const r = el.getBoundingClientRect();
    if (!visible(el)) return { ok: false, why: '不可见' };
    if (r.top < 0 || r.bottom > innerHeight) return { ok: false, why: '不在首屏' };
    if (r.height < 24 || !text(el)) return { ok: false, why: '太小或没字' };
    return { ok: true, label: text(el) };
  };
  out.empty = { block: visible(be), load: entry('[data-role="load-beat"]'), metro: entry('[data-role="metronome-start"]') };

  // 录音
  const ta = document.querySelector('[data-role="track-area"]');
  const tracks = [...document.querySelectorAll('[data-role="take-track"]')];
  const goodTracks = tracks.filter(t => visible(t) && ta && ta.contains(t) && [...t.querySelectorAll('svg')].some(visible));
  const rec = document.querySelector('[data-role="record"]');
  const recVisible = [...document.querySelectorAll('[data-role="record"]')].filter(visible);
  out.record = { tracks: goodTracks.length, all: tracks.length, recInArea: recVisible.some(r => ta && ta.contains(r)), rec: !!rec };
  return out;
}
"""


def hue_of(css_color):
    m = re.search(r"rgba?\(([^)]+)\)", css_color or "")
    if not m:
        return None, 0.0
    parts = [float(x) for x in re.split(r"[ ,/]+", m.group(1).strip()) if x][:3]
    h, _l, s = colorsys.rgb_to_hls(*(v / 255 for v in parts))
    return h * 360, s


def check_special(tag, kinds, info, size_name, failures):
    if "draft" in kinds:
        d = info["draft"]
        if not d["editor"]:
            failures.append(f"[{tag}] 草稿：找不到可见的 [data-role=draft-editor]")
        if not d["button"]:
            failures.append(f"[{tag}] 草稿：没有可见的「铺到拍子上」按钮")
    if "rhyme" in kinds:
        r = info["rhyme"]
        if not r or r["n"] < 2:
            failures.append(f"[{tag}] 句内同韵：没有任何一行有 ≥2 个字带同一押韵类且底色相同、看得出来（最多 {r['n'] if r else 0} 个）")
    if "block" in kinds:
        blocks = info["block"] or []
        if not any(b["ok"] for b in blocks):
            detail = "；".join(f"第 {b['row']} 行 {b['id']}：{b['why']}" for b in blocks) or "网格里没有标 data-block 的格子"
            failures.append(f"[{tag}] 双押块：找不到合格的连续 ≥2 字双押块（{detail}）")
    if "beats" in kinds:
        b = info["beats"]
        if not b or b["rows"] == 0:
            failures.append(f"[{tag}] 拍线：找不到可见的网格行")
        else:
            if not b["beat"] or not b["sub"]:
                failures.append(f"[{tag}] 拍线：拍边界或拍内边界的格子缺失")
            if b["overlap"]:
                failures.append(f"[{tag}] 拍线：每拍边界和拍内边界样式一样，分不出拍子（{b['overlap'][0]}）")
            if b["invisible"]:
                failures.append(f"[{tag}] 拍线：有 {b['invisible']} 处拍边界没有可见的线")
    if "legend" in kinds:
        lg = info["legend"]
        if not lg["visible"] or "双押" not in lg["text"]:
            failures.append(f"[{tag}] 图例：押韵图例不可见或没说明双押")
    if "empty" in kinds:
        e = info["empty"]
        if not e["block"]:
            failures.append(f"[{tag}] 伴奏空态：找不到可见的 [data-role=beat-empty]")
        for key, name in (("load", "选择伴奏文件"), ("metro", "先用节拍器写")):
            if not e[key]["ok"]:
                failures.append(f"[{tag}] 伴奏空态：「{name}」入口{e[key]['why']}")
    if "record" in kinds:
        r = info["record"]
        if r["tracks"] < 3:
            failures.append(f"[{tag}] 录音音轨：轨道区里只有 {r['tracks']} 条可见音轨（带波形），至少要 3 条")
        if not r["recInArea"]:
            failures.append(f"[{tag}] 录音音轨：录音键不在音轨所在的轨道区里")


def main():
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "design").resolve()
    src = root / "mockups_v2"
    mockups = sorted(src.glob("*.html"))
    shots = root / "screenshots_v2"
    shots.mkdir(parents=True, exist_ok=True)
    failures = []
    names = {p.stem for p in mockups}
    for need in REQUIRED:
        if need not in names:
            failures.append(f"缺少画面 {src / (need + '.html')}")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for page_file in mockups:
            name = page_file.stem
            kinds = REQUIRED.get(name, set())
            for size_name, (w, h) in SIZES.items():
                page_bg = {}
                mobile = size_name == "mobile"
                for scheme in SCHEMES:
                    tag = f"{name} {size_name} {w}x{h} {scheme}"
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
                        page.screenshot(path=str(shots / f"{name}_{size_name}_{scheme}.png"))
                        info = page.evaluate(PROBE_JS.replace("WORDS", repr(list(BANNED_TEXT))))
                    except Exception as exc:  # 打不开也算失败，但继续检查其它画面
                        failures.append(f"[{tag}] 页面打不开或检查出错：{str(exc).splitlines()[0]}")
                        ctx.close()
                        continue
                    ctx.close()

                    for e in errors:
                        failures.append(f"[{tag}] 控制台错误：{e}")
                    for u in external:
                        failures.append(f"[{tag}] 外网请求：{u}")
                    for u in info["uppercase"]:
                        failures.append(f"[{tag}] 用了 text-transform:uppercase：{u}")
                    for a in info["accent"]:
                        hue, sat = hue_of(a["color"])
                        if hue is None:
                            failures.append(f"[{tag}] 读不到强调色（{a['src']}）")
                        elif sat > 0.1 and PURPLE_HUE[0] <= hue <= PURPLE_HUE[1]:
                            failures.append(f"[{tag}] 强调色是紫色：{a['src']} {a['color']} 色相 {hue:.0f}°")
                    if info["checked"] == 0:
                        failures.append(f"[{tag}] 没有抽到任何主要文字元素做对比度检查")
                    for c in info["contrast"]:
                        failures.append(f"[{tag}] 对比度 {c['ratio']} < {MIN_CONTRAST}：“{c['text']}” {c['fg']} on {c['bg']}")
                    for b in info["banned"]:
                        failures.append(f"[{tag}] 可见文本含「{b['word']}」：…{b['ctx']}…")
                    if mobile:
                        d = info["drawer"]
                        if not d or not d["visible"]:
                            failures.append(f"[{tag}] 押韵抽屉：手机上找不到可见的 [data-role=rhyme-drawer]")
                        else:
                            if d["height"] > MAX_DRAWER:
                                failures.append(f"[{tag}] 押韵抽屉：收起高度 {d['height']:.0f}px > {MAX_DRAWER}px")
                            if d["bottom"] < h - 2:
                                failures.append(f"[{tag}] 押韵抽屉：没贴在屏幕底部（底边 {d['bottom']:.0f}px）")
                    check_special(tag, kinds, info, size_name, failures)
                    page_bg[scheme] = info["pageBg"]
                if page_bg.get("dark") is not None and page_bg.get("light") is not None and page_bg["dark"] >= page_bg["light"]:
                    failures.append(f"[{name} {size_name}] 深色模式没生效：深色页底不比浅色暗")
        browser.close()

    total = len(mockups) * len(SIZES) * len(SCHEMES)
    if failures:
        print(f"FAIL：{len(failures)} 项不满足（共 {total} 张截图）")
        for f in failures:
            print("  - " + f)
        return 1
    print(f"OK：{len(mockups)} 个画面 × {len(SIZES)} 尺寸 × {len(SCHEMES)} 配色 = {total} 张截图，全部断言通过 → {shots}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
