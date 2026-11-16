"""e2e/check_app_v3.py 的反向探针：在临时副本里把构建产物 dist/index.html 改坏一处，检查脚本必须退出非 0。

用法（仓库根目录，先 npm run build）：python -I evidence/ct_6765fa8b/run_negative_checks.py dist/index.html [结果.md]

每条探针改的是构建产物里的一处（HTML / 内联 CSS / 打包后的 JS），用正则或字面量定位，定位不到算探针失效（也记失败）。
基线（不改）必须退出 0。临时副本放在 tempfile 默认目录（$TMPDIR），跑完删掉。
"""

import pathlib
import re
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
CHECK = ROOT / "e2e" / "check_app_v3.py"

# (名字, 'str' 字面量 / 're' 正则, 找什么, 换成什么, 要找到几处（None = 至少 1 处）)
PROBES = [
    ("加回录音键", "str", "</body>", '<button data-role="record" aria-label="录音" style="position:fixed;right:8px;bottom:70px;z-index:99">录音</button></body>', 1),
    ("挂出 AI 入口", "str", "</body>", '<button data-role="ai-tab" style="position:fixed;left:8px;bottom:70px;z-index:99">AI 写词</button></body>', 1),
    ("强调色改成紫色", "str", "--ab-accent: #C2410C", "--ab-accent: #7C3AED", 1),
    ("页面发外网请求", "str", "</body>", '<img src="https://example.com/x.png" alt="" style="width:1px;height:1px"></body>', 1),
    ("只有拖音的格子也能涂色", "re", r'return\{ok:(\w+)==="words",reason:', r'return{ok:\1!=="empty",reason:', 1),
    ("韵母比对改成忽略介音", "re", r'const (\w+)="strict",', r'const \1="loose",', 1),
    ("两色同韵不自动合并", "re", r'return (\w+)\.count===(\w+)\.count&&\1\.finals\.length===', r'return !1&&\1.finals.length===', 1),
    ("撤销后做新改动不丢可重做的步骤", "str", "this.states=this.states.slice(0,this.cursor+1),this.steps=this.steps.slice(0,this.cursor),", "this.states=this.states,this.steps=this.steps,", 1),
    ("撤销历史不随作品保存（刷新后丢）", "str", "v:1,table", "v:2,table", 1),
    ("BPM 弹窗默认推荐保留原 BPM", "re", r'const (\w+)="adopt";', r'const \1="keep";', 1),
    ("段落名换回中文", "str", '"Verse 1"', '"主歌 1"', None),
    ("折行的行头加「续」", "re", r'(String\(\w+\.global\+1\)\.padStart\(2,"0"\))', r'\1+"续"', 1),
    ("拖音画成单独的格子", "str", '"data-role":"drag-line"', '"data-role":"slot","data-kind":"hold"', 1),
    ("细线在格线处断开", "str", ':"-1px","--h"', ':"3px","--h"', 1),
    ("1/32 在手机上不左右滑（挤在 390 宽里）", "re", r'return Math\.ceil\(\((\w+)\+1\+(\w+)\)\*(\w+)/(\w+)\)', "return 0", 1),
]


def run_check(html: pathlib.Path) -> tuple[int, str]:
    r = subprocess.run([sys.executable, "-I", str(CHECK), str(html)], capture_output=True, text=True, timeout=600)
    lines = [l.strip() for l in r.stdout.splitlines() if l.strip()]
    first = next((l for l in lines if l.startswith("- ")), lines[0] if lines else r.stderr.strip()[:200])
    return r.returncode, first


def main():
    src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "dist/index.html").resolve()
    out_md = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else None
    html = src.read_text(encoding="utf-8")
    rows = []
    bad = 0
    code, first = run_check(src)
    rows.append(("基线（不改）", code, first, code == 0))
    bad += code != 0
    print(f"{'OK  ' if code == 0 else 'BAD '} 基线 → exit {code} | {first[:120]}", flush=True)
    with tempfile.TemporaryDirectory(prefix="v3_neg_") as tmp:
        for name, kind, pat, rep, want in PROBES:
            n = html.count(pat) if kind == "str" else len(re.findall(pat, html))
            if n == 0 or (want is not None and n != want):
                rows.append((name, None, f"探针失效：「{pat}」找到 {n} 处，应该 {want or '≥1'} 处", False))
                bad += 1
                print(f"BAD  {name} → 定位不到（{n} 处）", flush=True)
                continue
            mutated = html.replace(pat, rep) if kind == "str" else re.sub(pat, rep, html)
            path = pathlib.Path(tmp) / "index.html"
            path.write_text(mutated, encoding="utf-8")
            code, first = run_check(path)
            ok = code != 0
            bad += not ok
            rows.append((name, code, first, ok))
            print(f"{'OK  ' if ok else 'MISS'} {name} → exit {code} | {first[:120]}", flush=True)
    if out_md:
        lines = [
            "# e2e/check_app_v3.py 反向探针",
            "",
            "脚本：`python -I evidence/ct_6765fa8b/run_negative_checks.py dist/index.html evidence/ct_6765fa8b/negative_checks.md`（先 `npm run build`）。",
            "每条在临时副本里把构建产物 `dist/index.html` 改坏一处（HTML / 内联 CSS / 打包后的 JS），检查脚本都必须退出非 0；基线必须退出 0。",
            "",
            "| # | 改坏了什么 | 退出码 | 结果 | 检查脚本报的第一条 |",
            "|---|---|---|---|---|",
        ]
        for i, (name, code, first, ok) in enumerate(rows):
            res = "通过" if ok else "没拦住"
            lines.append(f"| {i} | {name} | {code if code is not None else '—'} | {res} | {first.lstrip('- ').replace('|', '｜')[:160]} |")
        lines += ["", f"共 {len(rows) - 1} 条探针，{sum(1 for r in rows[1:] if r[3])} 条让脚本退出非 0；基线 {'退出 0' if rows[0][3] else '没过'}。", ""]
        out_md.write_text("\n".join(lines), encoding="utf-8")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
