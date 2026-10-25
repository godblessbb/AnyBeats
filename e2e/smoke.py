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
  8. 在 sandbox="allow-scripts" 的 iframe 里加载构建产物不白屏，并显示「本次不保存」；
     录音按钮写明录不了的原因（画布里拿不到麦克风），点了不白屏、不报错
  9. 录音（Chromium 假麦克风 --use-fake-device-for-media-stream）：录一遍 → take 列表出现 → 再录一遍
     → ★ 选用第二遍 → 回放时高亮格变化 → 刷新后 take 还在（IndexedDB）→ 导出 zip 里有 .RPP 和非空 WAV，
     .RPP 的 SOURCE WAVE FILE 都指向 zip 里的文件
  另外全程断言：没有页面异常、没有发往本机以外的请求。
并对 浅 / 深色 × 999×581 / 356×624（外加 1134×675）截图到 e2e/shots/（编辑器 / AI / 录音 / 延迟校准 / 导出）。

任何一条失败退出码 1。
环境变量：
  ANYBEATS_ROOT      跑哪个目录的 dist（默认本仓库；反证脚本用它指向改坏的副本）
  ANYBEATS_CHROMIUM  浏览器可执行文件（playwright 自带浏览器装不上时用）
"""

import glob
import io
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
import wave
import zipfile
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


# 假麦克风（Chromium 自带的测试音）+ 自动同意权限弹窗
MEDIA_ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]


def launch(p):
    exe = os.environ.get("ANYBEATS_CHROMIUM")
    if exe:
        return p.chromium.launch(executable_path=exe, args=MEDIA_ARGS)
    try:
        return p.chromium.launch(args=MEDIA_ARGS)
    except Exception:
        found = sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux*/chrome"))
        if not found:
            raise
        return p.chromium.launch(executable_path=found[-1], args=MEDIA_ARGS)


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


def now_slots(page) -> str:
    return page.evaluate("() => [...document.querySelectorAll('.slot.now')].map(e => e.dataset.abs).join(',')")


def watch_highlight(page, seconds: float) -> set[str]:
    seen: list[str] = []
    t0 = time.time()
    while time.time() - t0 < seconds:
        seen.append(now_slots(page))
        page.wait_for_timeout(100)
    return {x for x in seen if x}


def wait_takes(page, n: int, timeout=8000) -> bool:
    try:
        page.wait_for_function(f"() => document.querySelectorAll('[data-role=take]').length === {n}", timeout=timeout)
        return True
    except Exception:
        return False


def finish_calibration(page, timeout=15000) -> str:
    """等校准跑完：返回 'result' / 'error' / ''（超时 = 挂住了）"""
    try:
        page.wait_for_function(
            "() => !!document.querySelector('[data-role=calibrate-accept]') || !!document.querySelector('[data-role=calibrate-error]')",
            timeout=timeout,
        )
    except Exception:
        return ""
    return "result" if page.locator("[data-role=calibrate-accept]").count() else "error"


def check_zip(data: bytes):
    """导出的 zip：有 .RPP、FILE 都指向 zip 里的文件、take WAV 非空"""
    zf = zipfile.ZipFile(io.BytesIO(data))
    names = zf.namelist()
    rpps = [n for n in names if n.upper().endswith(".RPP")]
    check("导出 zip 里有 .RPP", len(rpps) == 1, ", ".join(names))
    if not rpps:
        return
    rpp = zf.read(rpps[0]).decode("utf-8")
    files = re.findall(r'<SOURCE WAVE\s+FILE "([^"]+)"', rpp)
    check("RPP 的 SOURCE WAVE FILE 都指向 zip 里的文件", bool(files) and all(f in names for f in files), ", ".join(files))
    check(
        "RPP 有 TEMPO、段落 MARKER、歌词 region",
        re.search(r"^\s*TEMPO [\d.]+ 4 4$", rpp, re.M) is not None
        and re.search(r'^\s*MARKER \d+ [\d.]+ "[^"]+" 0$', rpp, re.M) is not None
        and re.search(r'^\s*MARKER \d+ [\d.]+ "[^"]+" 1$', rpp, re.M) is not None,
    )
    takes = [n for n in names if re.match(r"audio/take-\d+\.wav$", n)]
    info = []
    ok = len(takes) >= 2
    for n in takes:
        with wave.open(io.BytesIO(zf.read(n))) as w:
            frames = w.readframes(w.getnframes())
            loud = any(b != 0 for b in frames[: min(len(frames), 3 * 48000 * 3)])
            info.append(f"{n} {w.getnframes()} 帧 {w.getsampwidth() * 8}bit {w.getframerate()}Hz")
            ok = ok and w.getnframes() > 0 and loud and w.getsampwidth() == 3
    check("zip 里每个 take 是非空 24 bit WAV", ok, "；".join(info))
    sel = re.search(r'NAME "(Take \d+) ★"\n\s+VOLPAN [^\n]+\n\s+MUTESOLO 0 0 0', rpp)
    check("RPP 里选用的 take 那轨不静音（其余静音）", sel is not None and rpp.count("MUTESOLO 1 0 0") == len(takes) - 1, sel.group(1) if sel else "")


def run_recording(browser, url: str):
    w, h = SIZES["desktop"]
    ctx = browser.new_context(viewport={"width": w, "height": h}, accept_downloads=True)
    page = ctx.new_page()
    watch = Watch(page, url)
    page.goto(url)
    page.wait_for_selector("[data-role=lyrics-grid] .row")

    # 第一次录音先走延迟校准
    page.click("[data-role=record]")
    try:
        page.wait_for_selector("[data-role=calibrate-start]", timeout=5000)
        steps = page.locator("[data-role=calibrate-steps] .li").count()
    except Exception:
        steps = 0
    check("第一次点录音先走 3 步延迟校准", steps == 3, f"{steps} 步")
    page.click("[data-role=calibrate-start]")
    outcome = finish_calibration(page)
    detail = page.inner_text("[data-role=calibrate-ms]") if outcome == "result" else (page.locator("[data-role=calibrate-error]").inner_text() if outcome else "超时")
    # 假麦克风放的是自己的测试音，不是回环：多半判「没听到」，要的是给出结果或原因、不挂住
    check("校准跑完给出结果或原因（不挂住）", outcome != "", detail)
    page.click("[data-role=calibrate-skip]")  # 跳过 → 直接开录 Take 1

    try:
        page.wait_for_selector("[data-role=record].on", timeout=8000)
        title = page.inner_text("[data-role=rec-title]")
    except Exception:
        title = ""
    check("开始录音：录音键变红、面板显示「录音中 · Take 1」", "录音中" in title and "Take 1" in title, title.replace("\n", " "))
    seen = watch_highlight(page, 1.5)
    check("录音时歌词高亮跟着伴奏走", len(seen) >= 2, f"{len(seen)} 个不同的高亮位置")
    page.wait_for_timeout(800)
    page.click("[data-role=record]")
    check("录一遍 → take 列表出现", wait_takes(page, 1), page.locator("[data-role=take-list]").inner_text().replace("\n", " ") if page.locator("[data-role=take-list]").count() else "")
    lane = page.locator("[data-role=take-lane]").count()
    check("轨道条展开出 take 泳道", lane == 1, f"泳道 ×{lane}")

    # 第二遍
    page.click("[data-role=record]")
    page.wait_for_selector("[data-role=record].on", timeout=8000)
    page.wait_for_timeout(2200)
    page.click("[data-role=record]")
    check("再录一遍 → 两个 take", wait_takes(page, 2))

    # ★ 选用第二遍
    page.locator("[data-role=take-star]").nth(1).click()
    page.wait_for_timeout(100)
    sel = [e.get_attribute("data-selected") for e in page.locator("[data-role=take]").all()]
    check("★ 选用第二遍（只选一个）", sel == ["0", "1"], f"data-selected={sel}")

    # 裁头 +0.05 s
    page.click("[aria-label='裁头加 0.05 秒']")
    trim = page.input_value("[data-role=trim-start]")
    check("裁头可调", trim == "0.05", f"裁头 {trim}s")

    # 回放：歌词高亮跟着走
    page.click("[data-role=take-playback]")
    seen = watch_highlight(page, 2.0)
    cur = page.locator(".row.cur").count()
    check("回放选用的 take 时高亮格变化", len(seen) >= 2 and cur == 1, f"2 秒内高亮过 {len(seen)} 个位置，.row.cur ×{cur}")
    page.click("[data-role=take-playback]")
    page.wait_for_timeout(300)
    check("停止回放后没有高亮", page.locator(".slot.now").count() == 0)

    # 刷新后 take 还在（IndexedDB）
    page.reload()
    page.wait_for_selector("[data-role=lyrics-grid] .row")
    page.click(".tabs .tab:has-text('录音')")
    kept = wait_takes(page, 2)
    sel = [e.get_attribute("data-selected") for e in page.locator("[data-role=take]").all()]
    check("刷新后 take 还在、选用不变（IndexedDB）", kept and sel == ["0", "1"], f"data-selected={sel}")

    # 导出 zip
    page.click("[data-role=open-export]")
    page.wait_for_selector("[data-role=export]")
    for fmt in ("txt", "lrc", "project"):
        if page.is_checked(f"[data-role=export-{fmt}]"):
            page.click(f"label:has([data-role=export-{fmt}])")
    check("有 take 时 Reaper 导出默认勾上", page.is_checked("[data-role=export-rpp]"))
    page.click("[data-role=stem-metronome]")
    with page.expect_download() as dl:
        page.click("[data-role=export]")
    path = dl.value.path()
    check("导出的是 .zip", dl.value.suggested_filename.endswith(".zip"), dl.value.suggested_filename)
    if path:
        check_zip(Path(path).read_bytes())

    check("录音流程无页面异常", not watch.errors, "; ".join(watch.errors))
    check("录音流程没有发往本机以外的请求", not watch.external, ", ".join(watch.external[:5]))
    ctx.close()


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
        for fmt in ("txt", "project", "rpp"):
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
        # 界面 A 时这两个入口是禁用态（「录音上线后可用」「即将上线」）；本单把它们接通了，断言随之反过来
        rpp_box = page.locator("[data-role=export-rpp]")
        check("Reaper 导出入口已接通（不再是禁用态）", page.locator(".disabled-row").count() == 0 and rpp_box.is_enabled())
        rec = page.locator("[data-role=play] ~ .recbtn")
        rec_title = rec.get_attribute("title") or ""
        check("录音入口已接通（可点、不再写「即将上线」）", rec.is_enabled() and "即将上线" not in rec_title, f"title=「{rec_title}」")

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
            # 录音：画布里拿不到麦克风 → 按钮写明原因；点了打开录音面板显示原因，不假死、不白屏
            recbtn = frame.locator("[data-role=record]")
            title = recbtn.get_attribute("title") or ""
            check("iframe 里录音按钮写明录不了的原因", "麦克风" in title and recbtn.get_attribute("data-unavailable") == "1", f"title=「{title}」")
            recbtn.click()
            try:
                frame.locator("[data-role=rec-unavailable]").wait_for(timeout=5000)
                reason = frame.locator("[data-role=rec-unavailable]").inner_text()
            except Exception:
                reason = ""
            toggle_disabled = frame.locator("[data-role=rec-toggle]").is_disabled() if reason else False
            rows_after = frame.locator("[data-role=lyrics-grid] .row").count()
            check(
                "iframe 里点录音：面板显示原因、录音键禁用、网格还在",
                "麦克风" in reason and toggle_disabled and rows_after > 0,
                f"「{reason.replace(chr(10), ' ')}」，录音键禁用={toggle_disabled}，{rows_after} 行",
            )
            page.screenshot(path=str(SHOTS / "iframe_sandbox-record_desktop_light.png"))
        check("iframe 里没有脚本错误", not console_errors and not watch.errors, "; ".join(console_errors + watch.errors))
        ctx.close()

        # ---------- 9. 录音 ----------
        run_recording(browser, url)

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
                # 延迟校准（calibrate.html）：第一次点录音，第 2 步进行中
                rec_btn = "[data-role=record-m]" if size == "mobile" else "[data-role=record]"
                page.click(rec_btn)
                page.wait_for_selector("[data-role=calibrate-start]")
                page.click("[data-role=calibrate-start]")
                page.wait_for_timeout(2300)
                page.screenshot(path=str(SHOTS / f"calibrate_{size}_{scheme}.png"))
                finish_calibration(page)
                page.click("[data-role=calibrate-skip]")
                # 录音中（record.html）：录完 Take 1，正在录 Take 2
                page.wait_for_selector(f"{rec_btn}.on")
                page.wait_for_timeout(1500)
                page.click(rec_btn)
                wait_takes(page, 1)
                page.click(rec_btn)
                page.wait_for_selector(f"{rec_btn}.on")
                page.wait_for_timeout(1800)
                page.screenshot(path=str(SHOTS / f"record_{size}_{scheme}.png"))
                page.click(rec_btn)
                wait_takes(page, 2)
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
