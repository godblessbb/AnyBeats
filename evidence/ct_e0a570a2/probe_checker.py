#!/usr/bin/env python3
"""回查器自检：故意改坏一处，回查器必须转红；不改时必须是绿的。

每个探针都在临时目录里放一份工作区副本（不含 .git），只改副本，不碰工作区和 Alphie 仓库。
临时目录走 tempfile 默认位置（平台已把 TMPDIR 指到任务自己的临时目录），跑完即删。

用法：python3 evidence/ct_e0a570a2/probe_checker.py [--alphie /别处/Alphie]
退出码 0 = 对照组是绿的，而且每个探针都让回查器退出码 1 并报出预期的那一句。
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
WS = HERE.parent.parent
REL = HERE.relative_to(WS)


def edit(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"探针前提不成立：{path.name} 里没有 {old!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def bad_table_line(root: Path) -> None:
    # 表里一行的行号 +1：那一行的字样对不上，稿和表也对不上
    edit(root / REL / "citations.tsv", "anybeats\tsrc/core/aiEdit.ts\t26\t", "anybeats\tsrc/core/aiEdit.ts\t27\t")


def bad_doc_line(root: Path) -> None:
    # 稿里一处行号写错：表里没有这一行
    edit(root / "design" / "AGENT_DESIGN.md", "`src/core/rhymeRules.ts:84`", "`src/core/rhymeRules.ts:85`")


def bad_doc_path(root: Path) -> None:
    # 稿里出现一个不存在的平台文件
    edit(root / "design" / "AGENT_DESIGN.md", "`scripts/usage_attribution_guard.py`", "`scripts/usage_attribution_guards.py`")


def bad_symbol(root: Path) -> None:
    # 函数名写错
    edit(root / REL / "symbols.tsv", "planRhymeFill", "planRhymeFil1")


def planned_exists(root: Path) -> None:
    # 「计划新建」的文件其实已经有了
    target = root / "src" / "core" / "aiGate.ts"
    target.write_text("// 探针\n", encoding="utf-8")


PROBES = [
    ("表里行号 +1", bad_table_line, "这一行里没有"),
    ("稿里行号写错", bad_doc_line, "citations.tsv 里没有这一行"),
    ("稿里写了不存在的平台文件", bad_doc_path, "不存在，也不在 planned_paths.txt 里"),
    ("函数名写错", bad_symbol, "symbols.tsv:"),
    ("计划新建的文件已经存在", planned_exists, "但它已经存在了"),
]


def run(root: Path, alphie: str) -> tuple[int, str]:
    r = subprocess.run([sys.executable, str(root / REL / "check_citations.py"), "--alphie", alphie],
                       capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--alphie", default="/opt/Alphie")
    args = ap.parse_args()
    failed = 0
    with tempfile.TemporaryDirectory(prefix="probe_checker_") as tmp:
        cases = [("对照组（不改）", None, "全部核对通过")] + PROBES
        for n, (name, mutate, want) in enumerate(cases):
            root = Path(tmp) / f"ws{n}"
            shutil.copytree(WS, root, ignore=shutil.ignore_patterns(".git", "node_modules", "dist"))
            if mutate:
                mutate(root)
            code, out = run(root, args.alphie)
            ok = (code == (1 if mutate else 0)) and want in out
            failed += not ok
            hit = next((line.strip() for line in out.splitlines() if want in line), "（没有找到预期的那一句）")
            print(f"{'过' if ok else '不过'}\t{name}\t退出码 {code}\t{hit[:150]}")
    print("\n自检通过：对照组是绿的，5 个探针都让回查器转红" if not failed else f"\n自检不过：{failed} 项")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
