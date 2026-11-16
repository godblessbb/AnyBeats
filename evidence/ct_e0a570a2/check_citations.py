#!/usr/bin/env python3
"""回查 design/AGENT_DESIGN.md 里的每一处引用是不是真的。

四件事，任何一件不过退出码 1：

  1. citations.tsv 每一行：那个文件的那一行里确实有期望的字样。
  2. 设计稿里每一处带行号的引用（`路径:行号`，以及紧跟着的 –`行号` 区间尾）都在 citations.tsv 里。
     反过来，citations.tsv 里没被设计稿用到的行也报出来（防表和稿子漂开）。
  3. 设计稿里每一个不带行号的文件 / 目录路径：要么真实存在，要么在 planned_paths.txt 里
     （「实施单要新建的」）；planned_paths.txt 里的路径今天必须还不存在。
  4. symbols.tsv 每一行：那个文件里确实有这个定义（不看行号，防「函数名写错」）。

用法：
  python3 evidence/ct_e0a570a2/check_citations.py            # 核对
  python3 evidence/ct_e0a570a2/check_citations.py --dump     # 把稿里每处引用对应的实际那一行打出来（人工核对语义用）
  python3 evidence/ct_e0a570a2/check_citations.py --alphie /别处/Alphie

只读，不写任何文件。
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ANYBEATS = HERE.parent.parent
DOC = ANYBEATS / "design" / "AGENT_DESIGN.md"

# 这些前缀 / 文件名指 AnyBeats 仓库，其余指 Alphie 仓库（和设计稿开头的路径约定一致）
ANYBEATS_PREFIXES = ("src/", "design/", "e2e/", "backend/", "evidence/", "agent/")
ANYBEATS_FILES = ("vite.config.ts", "vitest.config.ts", "package.json", "package-lock.json", "index.html")

EXT = r"(?:py|ts|tsx|js|css|md|json|html|sh|txt|tsv)"
CITE_RE = re.compile(r"`([A-Za-z0-9_./-]+\." + EXT + r"):(\d+)`(?:\s*[–-]\s*`(\d+)`)?")
TOKEN_RE = re.compile(r"`([^`\n]+)`")
PATH_RE = re.compile(r"^/?[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*/?$")
FILE_RE = re.compile(r"\." + EXT + r"$")


def repo_of(path: str) -> str:
    if path.startswith(ANYBEATS_PREFIXES) or path in ANYBEATS_FILES:
        return "anybeats"
    return "alphie"


def strip_fences(text: str) -> str:
    """去掉 ``` 围起来的块（里面是草案目录树 / 清单草案，不是对现有文件的引用）。"""
    out, inside = [], False
    for line in text.splitlines():
        if line.lstrip().startswith("```"):
            inside = not inside
            out.append("")
            continue
        out.append("" if inside else line)
    return "\n".join(out)


def read_tsv(path: Path, ncols: int) -> list[list[str]]:
    rows = []
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.startswith("#"):
            continue
        cols = line.split("\t")
        if len(cols) != ncols:
            raise SystemExit(f"{path.name}:{n} 应该是 {ncols} 列，实际 {len(cols)} 列")
        rows.append(cols)
    return rows


def line_of(root: Path, rel: str, lineno: int) -> str | None:
    f = root / rel
    if not f.is_file():
        return None
    lines = f.read_text(encoding="utf-8", errors="replace").splitlines()
    return lines[lineno - 1] if 1 <= lineno <= len(lines) else None


def doc_citations(text: str) -> list[tuple[str, int]]:
    """稿里全部 (路径, 行号)，按出现顺序去重。区间 `a.py:10`–`12` 记成 10 和 12 两条。"""
    seen, out = set(), []
    for m in CITE_RE.finditer(text):
        for g in (m.group(2), m.group(3)):
            if g is None:
                continue
            key = (m.group(1), int(g))
            if key not in seen:
                seen.add(key)
                out.append(key)
    return out


def doc_paths(text: str) -> list[str]:
    """稿里不带行号、看起来是文件或目录的反引号内容。以 /api/、/pkg-static/ 开头的是网址，不算。"""
    seen, out = set(), []
    for m in TOKEN_RE.finditer(text):
        tok = m.group(1).strip()
        if CITE_RE.fullmatch(f"`{tok}`") or not PATH_RE.match(tok):
            continue
        if tok.startswith(("/api/", "/pkg-static")):
            continue
        is_dir = tok.endswith("/") and "/" in tok.rstrip("/") or tok.endswith("/") and tok.rstrip("/") in (
            "src", "e2e", "backend", "design", "agent", "static", "tests", ".git")
        if not (FILE_RE.search(tok) or is_dir or tok.startswith("/opt/")):
            continue
        if tok not in seen:
            seen.add(tok)
            out.append(tok)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--alphie", default="/opt/Alphie")
    ap.add_argument("--dump", action="store_true")
    args = ap.parse_args()
    roots = {"anybeats": ANYBEATS, "alphie": Path(args.alphie)}

    text = strip_fences(DOC.read_text(encoding="utf-8"))
    cites = doc_citations(text)

    if args.dump:
        for path, lineno in cites:
            got = line_of(roots[repo_of(path)], path, lineno)
            print(f"{repo_of(path)}\t{path}\t{lineno}\t{'<<没有这一行>>' if got is None else got.strip()}")
        return 0

    bad: list[str] = []

    def head(root: Path) -> str:
        try:
            return subprocess.run(["git", "-C", str(root), "rev-parse", "--short=8", "HEAD"],
                                  capture_output=True, text=True, check=True).stdout.strip()
        except Exception:
            return "?"

    print(f"AnyBeats {ANYBEATS} @ {head(ANYBEATS)}")
    print(f"Alphie   {roots['alphie']} @ {head(roots['alphie'])}")

    # 1. 表里每一行
    table = read_tsv(HERE / "citations.tsv", 4)
    known: set[tuple[str, int]] = set()
    for repo, path, lineno, want in table:
        if repo not in roots:
            bad.append(f"citations.tsv: 不认得的仓库 {repo!r}（{path}:{lineno}）")
            continue
        if repo != repo_of(path):
            bad.append(f"citations.tsv: {path} 按路径约定属于 {repo_of(path)}，表里写的是 {repo}")
        known.add((path, int(lineno)))
        got = line_of(roots[repo], path, int(lineno))
        if got is None:
            bad.append(f"{repo}:{path}:{lineno} 没有这个文件或这一行")
        elif want not in got:
            near = ""
            f = (roots[repo] / path).read_text(encoding="utf-8", errors="replace").splitlines()
            hits = [i for i, s in enumerate(f, 1) if want in s]
            if hits:
                near = f"（这段字样实际在第 {', '.join(map(str, hits[:5]))} 行）"
            bad.append(f"{repo}:{path}:{lineno} 这一行里没有 {want!r}{near}；实际是：{got.strip()[:120]}")
    print(f"1. citations.tsv：{len(table)} 行")

    # 2. 稿 ↔ 表
    used = set(cites)
    for path, lineno in cites:
        if (path, lineno) not in known:
            bad.append(f"设计稿引用了 {path}:{lineno}，citations.tsv 里没有这一行")
    for path, lineno in sorted(known - used):
        bad.append(f"citations.tsv 里的 {path}:{lineno} 设计稿没有用到")
    print(f"2. 设计稿里带行号的引用：{len(cites)} 处（去重后）")

    # 3. 不带行号的路径
    planned = [s.strip() for s in (HERE / "planned_paths.txt").read_text(encoding="utf-8").splitlines()
               if s.strip() and not s.startswith("#")]
    cited_names = {Path(p).name for p, _ in cites}
    paths = doc_paths(text)
    n_exist = n_planned = 0
    for tok in paths:
        if tok in planned:
            n_planned += 1
            continue
        if tok.startswith("/"):
            if Path(tok).exists():
                n_exist += 1
            else:
                bad.append(f"设计稿里的绝对路径 {tok} 不存在，也不在 planned_paths.txt 里")
            continue
        rel = tok.rstrip("/")
        if (roots[repo_of(tok)] / rel).exists():
            n_exist += 1
            continue
        if "/" not in rel and (rel in cited_names or any((r / rel).exists() for r in roots.values())):
            n_exist += 1  # 只写了文件名：稿里别处带全路径引用过它，或者它就在某个仓库的根下
            continue
        if "/" not in rel:
            hits = [p for p in paths if p.endswith("/" + rel) and (roots[repo_of(p)] / p).exists()]
            if hits:
                n_exist += 1  # 只写了文件名，全路径在稿里别处出现过而且存在
                continue
        bad.append(f"设计稿里的路径 {tok} 在 {repo_of(tok)} 仓库里不存在，也不在 planned_paths.txt 里")
    for p in planned:
        if p not in paths:
            bad.append(f"planned_paths.txt 里的 {p} 设计稿没有用到")
            continue
        target = Path(p) if p.startswith("/") else roots[repo_of(p)] / p.rstrip("/")
        if "/" in p.rstrip("/") and target.exists():
            bad.append(f"planned_paths.txt 说 {p} 是要新建的，但它已经存在了")
    print(f"3. 设计稿里不带行号的路径：{len(paths)} 个（存在 {n_exist}，计划新建 {n_planned}）")

    # 4. 符号定义
    symbols = read_tsv(HERE / "symbols.tsv", 3)
    for repo, path, want in symbols:
        f = roots[repo] / path
        if not f.is_file():
            bad.append(f"symbols.tsv: {repo}:{path} 不存在")
        elif want not in f.read_text(encoding="utf-8", errors="replace"):
            bad.append(f"symbols.tsv: {repo}:{path} 里没有 {want!r}")
    print(f"4. symbols.tsv：{len(symbols)} 个定义")

    if bad:
        print(f"\n不过：{len(bad)} 处")
        for b in bad:
            print("  - " + b)
        return 1
    print("\n全部核对通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
