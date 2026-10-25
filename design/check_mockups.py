"""AnyBeats 视觉稿自动检查。

用法：python -I design/check_mockups.py design

对 design/mockups/*.html 的每个画面 × 三个画布内框尺寸 × 浅/深色：
  - 截图到 design/screenshots/<画面>_<尺寸>_<配色>.png
  - 断言：无控制台错误 / 页面异常；无外网请求（只允许 file: 和 data:）；
    歌词网格 [data-role=lyrics-grid] 存在且顶边在视口高度一半以内；
    任何可见元素都没有 text-transform: uppercase；
    主强调色（:root 的 --ab-accent 及播放键底色）色相不在 250–310°；
    主要文字（h1–h4、[data-contrast]、歌词字 .slot .ch）与实际背景对比度 ≥ 4.5:1；
    深色模式确实生效（深色截图的页面底色比浅色暗）。
任何一项不满足，退出码 1。只用标准库 + playwright（sync API）。
"""

import colorsys
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

# 画布内框尺寸：10-24 在 dev 上用 Playwright 实测 Alphie Agent 工作区 iframe（ws-iframe-wrap）所得
SIZES = {
    "desktop": (999, 581),   # 1280×800 窗口
    "wide": (1134, 675),     # 1440×900 窗口
    "mobile": (356, 624),    # 390×844 手机
}
SCHEMES = ("light", "dark")
PURPLE_HUE = (250.0, 310.0)
MIN_CONTRAST = 4.5

PROBE_JS = r"""
() => {
  const parse = (s) => {
    const m = s && s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
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
  // 从根往下把各层背景叠起来，得到元素实际的底色
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

  const out = { grid: null, uppercase: [], contrast: [], checked: 0, accent: [], pageBg: null };

  const g = document.querySelector('[data-role="lyrics-grid"]');
  if (g) {
    const r = g.getBoundingClientRect();
    out.grid = { top: r.top, height: r.height, visible: visible(g) };
  }

  for (const el of document.querySelectorAll('body *')) {
    if (getComputedStyle(el).textTransform === 'uppercase' && el.textContent.trim() && visible(el)) {
      out.uppercase.push(el.tagName.toLowerCase() + '.' + el.className + ' "' + el.textContent.trim().slice(0, 20) + '"');
    }
  }

  const sel = 'h1, h2, h3, h4, [data-contrast], .slot .ch';
  for (const el of document.querySelectorAll(sel)) {
    if (!el.textContent.trim() || !visible(el)) continue;
    const fg = parse(getComputedStyle(el).color);
    if (!fg) continue;
    const bg = bgOf(el);
    const c = blend(fg, bg);
    const r = ratio(c, bg);
    out.checked += 1;
    if (r < 4.5) out.contrast.push({ text: el.textContent.trim().slice(0, 16), ratio: Math.round(r * 100) / 100,
      fg: getComputedStyle(el).color, bg: 'rgb(' + bg.slice(0, 3).map(Math.round).join(',') + ')' });
  }

  const probe = document.createElement('div');
  probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--ab-accent').trim();
  document.body.appendChild(probe);
  out.accent.push({ src: '--ab-accent', color: getComputedStyle(probe).color });
  probe.remove();
  const play = document.querySelector('[data-role="play"]');
  if (play) out.accent.push({ src: 'play button', color: getComputedStyle(play).backgroundColor });

  const pb = parse(getComputedStyle(document.body).backgroundColor);
  out.pageBg = pb ? lum(pb) : null;
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


def main():
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "design").resolve()
    mockups = sorted((root / "mockups").glob("*.html"))
    shots = root / "screenshots"
    shots.mkdir(parents=True, exist_ok=True)
    failures = []
    if not mockups:
        failures.append(f"{root / 'mockups'} 下没有 .html 视觉稿")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for page_file in mockups:
            name = page_file.stem
            for size_name, (w, h) in SIZES.items():
                page_bg = {}
                for scheme in SCHEMES:
                    tag = f"{name} {size_name} {w}x{h} {scheme}"
                    ctx = browser.new_context(
                        viewport={"width": w, "height": h},
                        color_scheme=scheme,
                        device_scale_factor=2 if size_name == "mobile" else 1,
                        is_mobile=size_name == "mobile",
                        has_touch=size_name == "mobile",
                    )
                    page = ctx.new_page()
                    errors, external = [], []
                    page.on("console", lambda m, e=errors: e.append(m.text) if m.type == "error" else None)
                    page.on("pageerror", lambda exc, e=errors: e.append(str(exc)))

                    # 只放行本地文件；任何别的请求都记下来并掐掉，免得卡住加载
                    page.on("request", lambda r, ext=external: ext.append(r.url)
                            if not r.url.startswith(("file:", "data:", "about:", "blob:")) else None)
                    page.route(re.compile(r"^(?!file:|data:|about:|blob:)"), lambda route: route.abort())
                    try:
                        page.goto(page_file.as_uri(), timeout=15000)
                        page.wait_for_timeout(150)
                        page.screenshot(path=str(shots / f"{name}_{size_name}_{scheme}.png"))
                        info = page.evaluate(PROBE_JS)
                    except Exception as exc:  # 打不开也算失败，但继续检查其它画面
                        failures.append(f"[{tag}] 页面打不开或检查出错：{str(exc).splitlines()[0]}")
                        ctx.close()
                        continue
                    ctx.close()

                    for e in errors:
                        failures.append(f"[{tag}] 控制台错误：{e}")
                    for u in external:
                        failures.append(f"[{tag}] 外网请求：{u}")
                    g = info["grid"]
                    if not g:
                        failures.append(f"[{tag}] 找不到歌词网格 [data-role=lyrics-grid]")
                    elif not g["visible"] or g["top"] < 0 or g["top"] > h / 2:
                        failures.append(f"[{tag}] 歌词网格不在首屏：顶边 {g['top']:.0f}px，视口一半 {h / 2:.0f}px")
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
