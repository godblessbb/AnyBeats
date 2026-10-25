"""反证：把关键接线临时改坏，smoke 对应的断言必须变红。

用法：python e2e/negative_checks.py

做法：把仓库（不含 node_modules / dist / .git）复制到临时目录（$TMPDIR），node_modules 用软链；
每条变异只改临时副本里的一行，vite build 后用副本里的 e2e/smoke.py 跑一遍（ANYBEATS_ROOT 指向副本），
断言预期的那条检查是 FAIL、smoke 退出码非 0。仓库本身一个字节不改。

变异：
  A 播放高亮接线改成不更新：transport.ts 每帧读到的新位置不再交给界面
  B 自动保存断开：editorStore.ts 改动后不再 notify core/autosave
"""

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MUTATIONS = [
    {
        "name": "A 播放高亮接线改成不更新",
        "file": "src/engine/transport.ts",
        "old": "if (abs !== this.state.position) this.set({ position: abs });",
        "new": "void abs; // 变异 A：位置不再交给界面",
        "expect_fail": "播放后 2 秒内高亮格变化",
    },
    {
        "name": "B 自动保存断开",
        "file": "src/engine/editorStore.ts",
        "old": "this.autosave.notify(this.project);",
        "new": "// 变异 B：不再通知 core/autosave",
        "expect_fail": "输入歌词 → 刷新仍在",
    },
]


def copy_repo(dst: Path):
    ignore = shutil.ignore_patterns("node_modules", "dist", ".git", "shots", "__pycache__")
    shutil.copytree(ROOT, dst, ignore=ignore, symlinks=True)
    os.symlink(ROOT / "node_modules", dst / "node_modules")


def main() -> int:
    bad = 0
    vite = str(ROOT / "node_modules" / ".bin" / "vite")
    for m in MUTATIONS:
        with tempfile.TemporaryDirectory(prefix="anybeats-neg-") as tmp:
            work = Path(tmp) / "repo"
            copy_repo(work)
            target = work / m["file"]
            src = target.read_text(encoding="utf-8")
            if src.count(m["old"]) != 1:
                print(f"[{m['name']}] 找不到要变异的那一行，脚本需要更新")
                bad += 1
                continue
            target.write_text(src.replace(m["old"], m["new"]), encoding="utf-8")
            subprocess.run([vite, "build", "--logLevel", "error"], cwd=work, check=True)
            env = dict(os.environ, ANYBEATS_ROOT=str(work))
            r = subprocess.run([sys.executable, str(work / "e2e" / "smoke.py")], cwd=work, env=env, capture_output=True, text=True)
            fail_lines = [line for line in r.stdout.splitlines() if line.startswith("FAIL ")]
            hit = any(line.startswith("FAIL " + m["expect_fail"]) for line in fail_lines)
            ok = r.returncode != 0 and hit
            print(f"[{m['name']}] smoke 退出码 {r.returncode}；{'变红（符合预期）' if ok else '没有变红！'}")
            for line in fail_lines:
                print("    " + line)
            if not ok:
                bad += 1
    print("反证全部成立" if bad == 0 else f"{bad} 条反证不成立")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
