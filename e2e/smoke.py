"""AnyBeats 界面冒烟测试（Playwright，sync API，只用标准库 + playwright）。

用法：python e2e/smoke.py            （先 npm run build；没有 dist 时会自己 build）

自己起 vite preview（随机端口，用完关掉），逐条驱动并断言：
  1. 首屏写词区可见（桌面 999×581、手机 356×624）
  2. 输入歌词 → 刷新仍在（core/autosave 落盘）
  3. 播放后 2 秒内高亮格变化
  4. 停止后没有高亮
  5. 双击标重音
  6. 撤销生效
  7. 导出 LRC，内容含时间戳
  8. 在 sandbox="allow-scripts" 的 iframe 里加载构建产物不白屏，并显示「本次不保存」
  另外全程断言：没有页面异常、没有发往本机以外的请求。
并对 浅 / 深色 × 999×581 / 356×624（外加 1134×675）截图到 e2e/shots/。

任何一条失败退出码 1。
环境变量：
  ANYBEATS_ROOT      跑哪个目录的 dist（默认本仓库；反证脚本用它指向改坏的副本）
  ANYBEATS_CHROMIUM  浏览器可执行文件（playwright 自带浏览器装不上时用）
"""

import glob
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("ANYBEATS_ROOT") or HERE.parent).resolve()
SHOTS = HERE / "shots"
SIZES = {"desktop": (999, 581), "wide": (1134, 675), "mobile": (356, 624)}

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    print(("PASS " if ok else "FAIL ") + name + (f" —— {detail}" if detail else ""), flush=True)
    if not ok:
        failures.append(name)
    return ok


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def vite_cmd() -> list[str]:
    local = ROOT / "node_modules" / ".bin" / ("vite.cmd" if os.name == "nt" else "vite")
    if local.exists():
        return [str(local)]
    return [shutil.which("npx") or "npx", "--no-install", "vite"]


def ensure_build():
    if (ROOT / "dist" / "index.html").exists():
        return
    print("dist 不存在，先 npm run build", flush=True)
    subprocess.run([shutil.which("npm") or "npm", "run", "build"], cwd=ROOT, check=True)


def start_preview(port: int) -> subprocess.Popen:
    kwargs = {"start_new_session": True} if os.name != "nt" else {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    proc = subprocess.Popen(
        vite_cmd() + ["preview", "--host", "127.0.0.1", "--port", str(port), "--strictPort"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        **kwargs,
    )
    url = f"http://127.0.0.1:{port}/"
    for _ in range(100):
        try:
            urllib.request.urlopen(url, timeout=1).read()
            return proc
        except Exception:
            if proc.poll() is not None:
                raise RuntimeError("vite preview 没起来")
            time.sleep(0.2)
    stop_preview(proc)
    raise RuntimeError("vite preview 20 秒内没响应")


def stop_preview(proc: subprocess.Popen):
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            proc.terminate()
        else:
            os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=5)
    except Exception:
        proc.kill()


def launch(p):
    exe = os.environ.get("ANYBEATS_CHROMIUM")
    if exe:
        return p.chromium.launch(executable_path=exe)
    try:
        return p.chromium.launch()
    except Exception:
        found = sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux*/chrome"))
        if not found:
            raise
        return p.chromium.launch(executable_path=found[-1])


class Watch:
    """收集页面异常和发往本机以外的请求"""

    def __init__(self, page, origin: str):
        self.errors: list[str] = []
        self.external: list[str] = []
        page.on("pageerror", lambda e: self.errors.append(str(e)))
        page.on("request", self.on_request)
        self.origin = origin

    def on_request(self, req):
        url = req.url
        if url.startswith(("data:", "blob:", "about:")) or url.startswith(self.origin):
            return
        self.external.append(url)


def grid_on_first_screen(page) -> tuple[bool, str]:
    info = page.evaluate(
        """() => {
          const g = document.querySelector('[data-role=lyrics-grid]');
          if (!g) return null;
          const r = g.getBoundingClientRect();
          const slots = [...document.querySelectorAll('.row .slot')].filter(s => {
            const b = s.getBoundingClientRect();
            return b.width > 0 && b.top >= 0 && b.bottom <= innerHeight && b.left < innerWidth;
          });
          return { top: r.top, h: innerHeight, visibleSlots: slots.length };
        }"""
    )
    if not info:
        return False, "没有找到歌词网格"
    ok = info["top"] < info["h"] / 2 and info["visibleSlots"] >= 16
    return ok, f"网格顶边 {info['top']:.0f}px / 视口 {info['h']}px，首屏可见格 {info['visibleSlots']}"


def find_slot(page, js_filter: str) -> str | None:
    return page.evaluate(
        f"""() => {{
          const s = [...document.querySelectorAll('.row:not(.ghost-row) .slot')].find(el => {{ {js_filter} }});
          return s ? s.dataset.abs : null;
        }}"""
    )


def run(p, url: str):
    SHOTS.mkdir(parents=True, exist_ok=True)
    browser = launch(p)
    try:
        # ---------- 1. 首屏写词区可见 ----------
        for size in ("desktop", "mobile"):
            w, h = SIZES[size]
            ctx = browser.new_context(viewport={"width": w, "height": h})
            page = ctx.new_page()
            watch = Watch(page, url)
            page.goto(url)
            page.wait_for_selector("[data-role=lyrics-grid] .row")
            ok, detail = grid_on_first_screen(page)
            check(f"首屏写词区可见（{w}×{h}）", ok, detail)
            check(f"无页面异常（{w}×{h}）", not watch.errors, "; ".join(watch.errors))
            ctx.close()

        w, h = SIZES["desktop"]
        ctx = browser.new_context(viewport={"width": w, "height": h}, accept_downloads=True)
        page = ctx.new_page()
        watch = Watch(page, url)
        page.goto(url)
        page.wait_for_selector("[data-role=lyrics-grid] .row")

        # ---------- 2. 输入歌词 → 刷新仍在 ----------
        abs_empty = find_slot(page, "return !el.querySelector('.ch') && !el.classList.contains('sus');")
        page.click(f'.slot[data-abs="{abs_empty}"]')
        page.wait_for_selector("[data-role=slot-input]")
        page.keyboard.type("测试歌")
        page.keyboard.press("Enter")
        typed = page.evaluate(
            f"""() => [0,1,2].map(i => document.querySelector('.slot[data-abs="' + ({abs_empty} + i) + '"] .ch')?.textContent).join('')"""
        )
        check("输入歌词写进网格（一格一个字）", typed == "测试歌", f"格 {abs_empty} 起读到「{typed}」")
        page.wait_for_timeout(1500)
        page.reload()
        page.wait_for_selector("[data-role=lyrics-grid] .row")
        after = page.evaluate(
            f"""() => [0,1,2].map(i => document.querySelector('.slot[data-abs="' + ({abs_empty} + i) + '"] .ch')?.textContent).join('')"""
        )
        check("输入歌词 → 刷新仍在", after == "测试歌", f"刷新后读到「{after}」")

        # ---------- 3. 播放后 2 秒内高亮格变化 ----------
        page.click("[data-role=play]")
        seen: list[str] = []
        t0 = time.time()
        while time.time() - t0 < 2.0:
            seen.append(page.evaluate("() => [...document.querySelectorAll('.slot.now')].map(e => e.dataset.abs).join(',')"))
            page.wait_for_timeout(100)
        distinct = {s for s in seen if s}
        check("播放后 2 秒内高亮格变化", len(distinct) >= 2, f"2 秒内高亮过 {sorted(distinct, key=lambda x: int(x.split(',')[0]))[:8]}")
        rows = page.locator(".row.cur").count()
        check("播放中当前行高亮", rows == 1, f".row.cur ×{rows}")

        # ---------- 4. 停止后无高亮 ----------
        page.click("[data-role=play]")
        page.wait_for_timeout(300)
        now_n = page.locator(".slot.now").count()
        cur_n = page.locator(".row.cur").count()
        check("停止后无高亮", now_n == 0 and cur_n == 0, f".slot.now ×{now_n}，.row.cur ×{cur_n}")

        # ---------- 5. 双击标重音 ----------
        abs_char = find_slot(page, "return el.querySelector('.ch') && !el.classList.contains('acc') && !el.classList.contains('rest');")
        sel = f'.slot[data-abs="{abs_char}"]'
        page.dblclick(sel)
        page.wait_for_timeout(100)
        cls = page.get_attribute(sel, "class") or ""
        check("双击标重音", "acc" in cls.split(), f"格 {abs_char} class=「{cls}」")
        page.keyboard.press("Escape")

        # ---------- 6. 撤销生效 ----------
        page.click("[data-role=undo]")
        page.wait_for_timeout(100)
        cls2 = page.get_attribute(sel, "class") or ""
        check("撤销生效（重音被撤掉）", "acc" not in cls2.split(), f"撤销后 class=「{cls2}」")

        # ---------- 附：键盘导航、拖候选词进格子（DESIGN.md §6 #13 #15） ----------
        page.click(sel)
        page.keyboard.press("Escape")  # 单击进了编辑，Esc 退出编辑、保留选中
        page.keyboard.press("ArrowRight")
        focus = page.evaluate("() => document.querySelector('.slot.focus')?.dataset.abs")
        page.keyboard.press("Enter")
        editing = page.locator("[data-role=slot-input]").count()
        page.keyboard.press("Escape")
        check("键盘导航：→ 移动、Enter 编辑", focus == str(int(abs_char) + 1) and editing == 1, f"选中格 {abs_char} → {focus}，编辑框 ×{editing}")
        word = page.locator("[data-role=rhyme-words] .word").first
        word_text = word.evaluate("e => e.firstChild.textContent")
        abs_drop = find_slot(page, "return !el.querySelector('.ch') && !el.classList.contains('sus');")
        word.drag_to(page.locator(f'.slot[data-abs="{abs_drop}"]'))
        dropped = page.evaluate(
            f"""() => [...document.querySelector('.slot[data-abs="{abs_drop}"]').parentElement.querySelectorAll('.slot .ch')]
                  .map(e => e.textContent).join('')"""
        )
        check("押韵候选拖进格子", word_text in dropped, f"拖「{word_text}」到格 {abs_drop}，这一小节变成「{dropped}」")

        # ---------- 7. 导出 LRC ----------
        page.click("[data-role=open-export]")
        page.wait_for_selector("[data-role=export]")
        for fmt in ("txt", "project"):
            if page.is_checked(f"[data-role=export-{fmt}]"):
                page.click(f"label:has([data-role=export-{fmt}])")
        with page.expect_download() as dl:
            page.click("[data-role=export]")
        path = dl.value.path()
        lrc = Path(path).read_text(encoding="utf-8") if path else ""
        stamps = re.findall(r"^\[\d{2}:\d{2}\.\d{2}\].+$", lrc, flags=re.M)
        check(
            "导出 LRC 内容含时间戳",
            dl.value.suggested_filename.endswith(".lrc") and len(stamps) >= 3 and "测试歌" in lrc,
            f"{dl.value.suggested_filename}，{len(stamps)} 行带时间戳，首行「{stamps[0] if stamps else ''}」",
        )
        rpp = page.locator(".disabled-row").inner_text()
        check("Reaper 导出是禁用态并写明原因", "录音上线后可用" in rpp, rpp.replace("\n", " "))
        rec = page.locator("[data-role=play] ~ .recbtn")
        check("录音入口是禁用态并写明「即将上线」", rec.is_disabled() and "即将上线" in (rec.get_attribute("title") or ""))

        check("桌面流程无页面异常", not watch.errors, "; ".join(watch.errors))
        check("没有发往本机以外的请求", not watch.external, ", ".join(watch.external[:5]))
        ctx.close()

        # ---------- 8. sandbox iframe ----------
        ctx = browser.new_context(viewport={"width": w, "height": h})
        page = ctx.new_page()
        watch = Watch(page, url)
        console_errors: list[str] = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.set_content(
            f'<!doctype html><html><body style="margin:0"><iframe id="canvas" sandbox="allow-scripts" src="{url}" '
            f'style="border:0;width:{w}px;height:{h}px"></iframe></body></html>'
        )
        frame = page.frame_locator("#canvas")
        try:
            frame.locator("[data-role=lyrics-grid] .row").first.wait_for(timeout=10000)
            rows = frame.locator("[data-role=lyrics-grid] .row").count()
        except Exception:
            rows = 0
        check("sandbox=allow-scripts 的 iframe 里不白屏", rows > 0, f"{rows} 行歌词网格")
        status = frame.locator("[data-role=save-status]").inner_text() if rows else ""
        check("iframe 里顶栏提示「本次不保存」", "本次不保存" in status, f"顶栏：「{status}」")
        if rows:
            # 不能存也能照常编辑
            frame.locator(".row .slot").first.click()
            page.keyboard.type("在")
            page.keyboard.press("Enter")
            first = frame.locator(".row .slot").first.inner_text()
            check("iframe 里照常能编辑", "在" in first, f"第一格「{first}」")
            page.screenshot(path=str(SHOTS / "iframe_sandbox_desktop_light.png"))
        check("iframe 里没有脚本错误", not console_errors and not watch.errors, "; ".join(console_errors + watch.errors))
        ctx.close()

        # ---------- 截图 ----------
        for scheme in ("light", "dark"):
            for size, (sw, sh) in SIZES.items():
                ctx = browser.new_context(viewport={"width": sw, "height": sh}, color_scheme=scheme)
                page = ctx.new_page()
                page.goto(url)
                page.wait_for_selector("[data-role=lyrics-grid] .row")
                page.screenshot(path=str(SHOTS / f"editor_{size}_{scheme}.png"))
                # 播放中（和 editor.html 一样的状态：高亮跟着走）
                page.click("[data-role=play-m]" if size == "mobile" else "[data-role=play]")
                page.wait_for_timeout(1200)
                page.screenshot(path=str(SHOTS / f"editor-playing_{size}_{scheme}.png"))
                page.click("[data-role=play-m]" if size == "mobile" else "[data-role=play]")
                # AI 面板：Worker 未连接（ai-login.html）
                if size == "mobile":
                    page.click(".tabbar button:has-text('AI')")
                else:
                    page.click(".tabs .tab:has-text('AI 写词')")
                page.wait_for_selector("[data-role=ai-login]")
                page.screenshot(path=str(SHOTS / f"ai-login_{size}_{scheme}.png"))
                # 工程与导出（export.html）
                if size == "mobile":
                    page.click(".tabbar button:has-text('工程')")
                else:
                    page.click("[data-role=open-export]")
                page.wait_for_selector("[data-role=export]")
                page.screenshot(path=str(SHOTS / f"export_{size}_{scheme}.png"))
                ctx.close()
        print(f"截图已存到 {SHOTS}", flush=True)
    finally:
        browser.close()


def main() -> int:
    ensure_build()
    port = free_port()
    proc = start_preview(port)
    try:
        with sync_playwright() as p:
            run(p, f"http://127.0.0.1:{port}/")
    finally:
        stop_preview(proc)
    if failures:
        print(f"\n{len(failures)} 条失败：" + "、".join(failures), flush=True)
        return 1
    print("\n全部通过", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
