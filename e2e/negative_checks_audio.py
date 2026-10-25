"""反证（录音 / 校准 / .RPP）：把关键的一行临时改坏，对应的 vitest 必须变红。

用法：python e2e/negative_checks_audio.py

做法和 negative_checks.py 一样：复制仓库到临时目录（$TMPDIR），node_modules 软链，只改副本里的一行，
在副本里跑 vitest，断言预期的测试 FAIL、退出码非 0。仓库本身一个字节不改。

变异：
  C 校准偏移不写进 ITEM POSITION：rpp.ts 的 takeItem 算位置时把延迟当 0
  D 延迟估计恒返回 0：latency.ts 的 estimateLatency 结果改成 0
  E 录音时不带上校准值：RecordController 新 take 的 latencyMs 写死 0
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
        "name": "C 校准偏移不写进 ITEM POSITION",
        "file": "src/export/rpp.ts",
        "old": "const r = alignedRegion(take);",
        "new": "const r = alignedRegion({ ...take, latencyMs: 0 }); // 变异 C",
        "expect_fail": ["ITEM POSITION = 录音起点 − 校准延迟", "不同校准值", "zip 里有 .RPP 和非空 WAV"],
    },
    {
        "name": "D 延迟估计恒返回 0",
        "file": "src/audio/latency.ts",
        "old": "return { ok: true, latencyMs: Math.round(median(kept) * 10) / 10,",
        "new": "return { ok: true, latencyMs: 0 * median(kept), // 变异 D\n   ",
        "expect_fail": ["真实延迟 40 ms", "真实延迟 180 ms", "回环 40 ms"],
    },
    {
        "name": "E 录音时不带上校准值",
        "file": "src/audio/RecordController.ts",
        "old": "latencyMs: this.state.latencyMs ?? 0,",
        "new": "latencyMs: 0, // 变异 E",
        "expect_fail": ["take 带上校准延迟"],
    },
]


def copy_repo(dst: Path):
    ignore = shutil.ignore_patterns("node_modules", "dist", ".git", "shots", "__pycache__", ".alphie_cloud")
    shutil.copytree(ROOT, dst, ignore=ignore, symlinks=True)
    os.symlink(ROOT / "node_modules", dst / "node_modules")


def main() -> int:
    bad = 0
    vitest = str(ROOT / "node_modules" / ".bin" / ("vitest.cmd" if os.name == "nt" else "vitest"))
    for m in MUTATIONS:
        with tempfile.TemporaryDirectory(prefix="anybeats-neg-audio-") as tmp:
            work = Path(tmp) / "repo"
            copy_repo(work)
            target = work / m["file"]
            src = target.read_text(encoding="utf-8")
            if src.count(m["old"]) != 1:
                print(f"[{m['name']}] 找不到要变异的那一行，脚本需要更新")
                bad += 1
                continue
            target.write_text(src.replace(m["old"], m["new"]), encoding="utf-8")
            r = subprocess.run(
                [vitest, "run", "src/audio", "src/export", "--reporter=verbose"],
                cwd=work,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            out = r.stdout + r.stderr
            failed = [line.strip() for line in out.splitlines() if line.strip().startswith("×")]
            missing = [e for e in m["expect_fail"] if not any(e in f for f in failed)]
            ok = r.returncode != 0 and not missing
            print(f"[{m['name']}] vitest 退出码 {r.returncode}，变红 {len(failed)} 条：")
            for f in failed:
                print(f"    {f}")
            if ok:
                print("    → 符合预期")
            else:
                print(f"    → 不符合预期：没变红的 {missing}")
                bad += 1
    print("\n反证全部成立" if bad == 0 else f"\n{bad} 条反证不成立")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
