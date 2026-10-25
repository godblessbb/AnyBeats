"""反证：把视觉稿故意改坏，确认 check_mockups.py 会变红。

用法：python -I design/evidence/run_negative_checks.py design
每条变异都在 $TMPDIR 下的临时副本里做（只拷 editor.html + 共享 css/js），不碰仓库里的文件。
结果写到 design/evidence/negative_checks.md。基线（不改）必须退出 0；每条变异必须退出非 0，且输出里出现对应断言的报错。
"""

import pathlib
import shutil
import subprocess
import sys
import tempfile

MUTATIONS = [
    ("基线（不改）", "OK：", None),
    ("强调色改成紫色 #7C3AED", "强调色是紫色", ("mockups/shared.css", "--ab-accent: #C2410C;", "--ab-accent: #7C3AED;")),
    ("网格挪到首屏以下（上方加 400px）", "歌词网格不在首屏", ("mockups/shared.css", ".grid-wrap { flex: 1;", ".grid-wrap { padding-top: 400px !important; flex: 1;")),
    ("段落标题加 text-transform:uppercase", "uppercase", ("mockups/shared.css", ".sec-h b { color: var(--ab-text);", ".sec-h b { text-transform: uppercase; color: var(--ab-text);")),
    ("引一个外网字体", "外网请求", ("mockups/editor.html", '<link rel="stylesheet" href="shared.css">',
                     '<link rel="stylesheet" href="shared.css">\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">')),
    ("页面里打一条 console.error", "控制台错误：boom", ("mockups/editor.html", "</head>", "<script>console.error('boom')</script>\n</head>")),
    ("歌词字改成 #CCCCCC 浅灰", "对比度", ("mockups/shared.css", ".slot .ch { position: relative; z-index: 1; color: var(--ab-text); }",
                            ".slot .ch { position: relative; z-index: 1; color: #CCCCCC; }")),
    ("删掉网格的 data-role（网格不存在）", "找不到歌词网格", ("mockups/shared.js", 'data-role="lyrics-grid"', 'data-role="x"')),
    ("页面底色写死白色（深色模式失效）", "深色模式没生效", ("mockups/shared.css", "  -webkit-font-smoothing: antialiased;\n}",
                                 "  -webkit-font-smoothing: antialiased;\n  background: #FFFFFF !important;\n}")),
]


def main():
    design = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "design").resolve()
    rows = []
    ok = True
    for title, keyword, mut in MUTATIONS:
        with tempfile.TemporaryDirectory(prefix="ab-neg-") as tmp:
            t = pathlib.Path(tmp)
            (t / "mockups").mkdir()
            for f in ("editor.html", "shared.css", "shared.js"):
                shutil.copy(design / "mockups" / f, t / "mockups" / f)
            shutil.copy(design / "check_mockups.py", t / "check_mockups.py")
            if mut:
                path, old, new = mut
                p = t / path
                text = p.read_text(encoding="utf-8")
                if old not in text:
                    print(f"变异锚点没找到：{title}")
                    return 2
                p.write_text(text.replace(old, new, 1), encoding="utf-8")
            r = subprocess.run([sys.executable, "-I", str(t / "check_mockups.py"), str(t)],
                               capture_output=True, text=True)
            out = (r.stdout + r.stderr).strip().splitlines()
            hit = next((l.strip() for l in out if keyword in l), "")
            expect_zero = mut is None
            passed = ((r.returncode == 0) == expect_zero) and bool(hit)
            first = hit or (out[0] if out else "")
            ok = ok and passed
            rows.append((title, r.returncode, "符合预期" if passed else "不符合预期", first[:150]))
            print(f"{title}: exit={r.returncode} {'OK' if passed else 'UNEXPECTED'}")

    md = ["# check_mockups.py 反证记录", "",
          "由 `python -I design/evidence/run_negative_checks.py design` 生成。每条变异只改临时副本里的 editor.html / 共享 css / js。", "",
          "| 变异 | 退出码 | 结论 | 脚本报出的对应断言 |", "|---|---|---|---|"]
    for title, code, verdict, first in rows:
        md.append(f"| {title} | {code} | {verdict} | {first.replace('|', '/')} |")
    (design / "evidence" / "negative_checks.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
