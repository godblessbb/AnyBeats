"""AI 面板「已连接 + 虚线预览」状态的截图（对照 design/mockups/ai.html）。

产品里的 AiProvider 是 AlphieBridgeProvider，画布能力没接通前永远是「未连接」，所以生产构建里到不了这个状态。
这里起 vite 开发服务器，用 ?ai=fake 换成只给测试用的 FakeProvider（生产构建里这段代码被裁掉），
点「续写」生成虚线预览后截图到 e2e/shots/ai_<尺寸>_<配色>.png。

用法：python e2e/ai_preview_shots.py
"""

import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke import SHOTS, SIZES, free_port, launch, stop_preview, vite_cmd  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def start_dev(port: int) -> subprocess.Popen:
    env = dict(os.environ, BROWSER="none")
    proc = subprocess.Popen(
        vite_cmd() + ["--host", "127.0.0.1", "--port", str(port), "--strictPort"],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    for _ in range(150):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1).read()
            return proc
        except Exception:
            time.sleep(0.2)
    stop_preview(proc)
    raise RuntimeError("vite 开发服务器没起来")


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    port = free_port()
    proc = start_dev(port)
    try:
        with sync_playwright() as p:
            browser = launch(p)
            for scheme in ("light", "dark"):
                for size, (w, h) in SIZES.items():
                    ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=scheme)
                    page = ctx.new_page()
                    page.goto(f"http://127.0.0.1:{port}/?ai=fake")
                    page.wait_for_selector("[data-role=lyrics-grid] .row", timeout=30000)
                    if size == "mobile":
                        page.click(".tabbar button:has-text('AI')")
                    else:
                        page.click(".tabs .tab:has-text('AI 写词')")
                    page.click("[data-role=ai-generate]")
                    page.wait_for_selector("[data-role=ai-preview]")
                    page.wait_for_timeout(200)
                    page.screenshot(path=str(SHOTS / f"ai_{size}_{scheme}.png"))
                    ctx.close()
            browser.close()
    finally:
        stop_preview(proc)
    print(f"截图已存到 {SHOTS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
