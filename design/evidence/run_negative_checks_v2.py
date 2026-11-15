"""反证：把 v2 视觉稿故意改坏，确认 check_mockups_v2.py 会变红并报出对应断言。

用法：python -I design/evidence/run_negative_checks_v2.py design
每条变异都在 $TMPDIR 下的临时副本里做（拷 mockups_v2/ + check_mockups_v2.py），不碰仓库里的文件。
基线（不改）必须退出 0；每条变异必须退出 1，且输出里出现对应断言的报错。
结果写到 design/evidence/negative_checks_v2.md。
"""

import pathlib
import shutil
import subprocess
import sys
import tempfile

JS = "mockups_v2/v2.js"
CSS = "mockups_v2/v2.css"

# (标题, 期望在输出里看到的断言关键字, [(文件, 原文, 替换), ...])
MUTATIONS = [
    ("基线（不改）", "OK：", []),
    ("空拍恢复显示「∅」", "可见文本含「∅」",
     [(JS, "else if (c === '_') k.push('rest');", "else if (c === '_') { k.push('rest'); txt = '∅'; }")]),
    ("顶栏加回「Worker 未连接」", "可见文本含「Worker」",
     [(JS, "'<div class=\"spacer\"></div>' +\n      '<button class=\"btn ghost desk-only\"",
       "'<span class=\"worker\">Worker 未连接</span><div class=\"spacer\"></div>' +\n      '<button class=\"btn ghost desk-only\"")]),
    ("押韵面板加回「AI 写词」页签", "可见文本含「AI 写词」",
     [(JS, "<div class=\"rp-h\"><h2>押韵</h2><span class=\"r\">第 ' + (l6",
       "<div class=\"rp-h\"><h2>押韵</h2><button class=\"btn sm\">AI 写词</button><span class=\"r\">第 ' + (l6")]),
    ("去掉双押块（不画块框）", "双押块",
     [(JS, "if (bar.blk) {\n      var n", "if (false) {\n      var n")]),
    ("双押块格子底色变透明", "双押块",
     [(CSS, ".s.blk::after { left: 0; right: 0; }", ".s.blk::after { left: 0; right: 0; }\n.s.blk { background-color: transparent !important; }")]),
    ("句内同韵退回只标句尾", "句内同韵",
     [(JS, "if (txt && (inArr(bar.rh, i) || inBlk(bar, i)))",
       "if (txt && ((inArr(bar.rh, i) && i === bar.rh[bar.rh.length - 1]) || inBlk(bar, i)))")]),
    ("拍边界线改成和拍内线一样", "拍线",
     [(CSS, ".s.bs { border-left: 2px solid var(--beat-line); }", ".s.bs { border-left: 1px solid var(--sub-line); }")]),
    ("手机押韵抽屉默认展开（300px）", "押韵抽屉：收起高度",
     [(CSS, "box-shadow: 0 -4px 16px rgba(0, 0, 0, .08); height: 56px;", "box-shadow: 0 -4px 16px rgba(0, 0, 0, .08); height: 300px;")]),
    ("伴奏空态去掉「先用节拍器写」入口", "伴奏空态：「先用节拍器写」入口",
     [(CSS, "/* ---------- 6. 主区 ---------- */", "[data-role=\"metronome-start\"] { display: none; }\n/* ---------- 6. 主区 ---------- */")]),
    ("伴奏空态退回一条细虚线（整块不见）", "伴奏空态",
     [(CSS, "/* ---------- 6. 主区 ---------- */", ".beat-empty { display: none !important; }\n/* ---------- 6. 主区 ---------- */")]),
    ("录音只剩 2 条音轨", "录音音轨：轨道区里只有 2 条",
     [(JS, "        { n: 3, s: 31, t: '0:38', from: .43, to: .78 }\n", ""),
      (JS, "{ n: 2, s: 23, t: '0:44', from: .4, to: .8, sel: true },", "{ n: 2, s: 23, t: '0:44', from: .4, to: .8, sel: true }")]),
    ("录音键挪回顶栏（不在音轨区）", "录音键不在",
     [(JS, "var recBtn = '<button class=\"btn rec\" data-role=\"record\"", "var recBtn = '<button class=\"btn rec\" data-role=\"rec-old\""),
      (JS, "'<div class=\"pos\"><b class=\"mono\" data-contrast>' + o.posBar + '</b><span class=\"mono\">'",
       "'<button class=\"ibtn\" data-role=\"record\">录音</button><div class=\"pos\"><b class=\"mono\" data-contrast>' + o.posBar + '</b><span class=\"mono\">'")]),
    ("草稿按钮改名「应用」（没有「铺到拍子上」）", "草稿：没有可见的「铺到拍子上」按钮",
     [(JS, "var label = o.draftMode === 'back' ? '铺到拍子上（重铺 1 句）' : '铺到拍子上';", "var label = '应用';")]),
    ("删掉押韵图例", "图例",
     [(CSS, "/* ---------- 6. 主区 ---------- */", ".legend { display: none !important; }\n/* ---------- 6. 主区 ---------- */")]),
    ("强调色改成紫色 #7C3AED", "强调色是紫色",
     [(CSS, "--ab-accent: #C2410C;", "--ab-accent: #7C3AED;")]),
    ("段落名加 text-transform:uppercase", "uppercase",
     [(CSS, ".sec-h b { color: var(--ab-text); font-size: 14px; }", ".sec-h b { color: var(--ab-text); font-size: 14px; text-transform: uppercase; }")]),
    ("引一个外网字体", "外网请求",
     [("mockups_v2/grid.html", '<link rel="stylesheet" href="v2.css">',
       '<link rel="stylesheet" href="v2.css">\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">')]),
    ("页面底色写死白色（深色失效）", "深色模式没生效",
     [(CSS, "  overflow: hidden; -webkit-font-smoothing: antialiased;\n}", "  overflow: hidden; -webkit-font-smoothing: antialiased;\n  background: #FFFFFF !important;\n}")]),
]


def main():
    design = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "design").resolve()
    rows, ok = [], True
    for title, keyword, muts in MUTATIONS:
        with tempfile.TemporaryDirectory(prefix="ab-neg-v2-") as tmp:
            t = pathlib.Path(tmp)
            shutil.copytree(design / "mockups_v2", t / "mockups_v2")
            shutil.copy(design / "check_mockups_v2.py", t / "check_mockups_v2.py")
            for path, old, new in muts:
                p = t / path
                text = p.read_text(encoding="utf-8")
                if old not in text:
                    print(f"变异锚点没找到：{title} → {old[:60]}")
                    return 2
                p.write_text(text.replace(old, new, 1), encoding="utf-8")
            r = subprocess.run([sys.executable, "-I", str(t / "check_mockups_v2.py"), str(t)], capture_output=True, text=True)
            out = (r.stdout + r.stderr).strip().splitlines()
            hits = [l.strip() for l in out if keyword in l]
            expect_zero = not muts
            passed = (r.returncode == 0 if expect_zero else r.returncode == 1) and bool(hits)
            ok = ok and passed
            rows.append((title, r.returncode, "符合预期" if passed else "不符合预期", (hits[0] if hits else (out[0] if out else ""))[:170], len(hits)))
            print(f"{title}: exit={r.returncode} {'OK' if passed else 'UNEXPECTED'} ({len(hits)} 条命中)")

    md = ["# check_mockups_v2.py 反证记录", "",
          "由 `python -I design/evidence/run_negative_checks_v2.py design` 生成。每条变异只改临时副本（`$TMPDIR` 下拷一份 `mockups_v2/` 和检查脚本），"
          "然后对副本跑完整的 `check_mockups_v2.py`。基线必须退出 0；每条变异必须退出 1，且输出里有对应断言的报错。", "",
          "| 变异 | 退出码 | 结论 | 命中条数 | 脚本报出的对应断言（第一条） |", "|---|---|---|---|---|"]
    for title, code, verdict, first, n in rows:
        md.append(f"| {title} | {code} | {verdict} | {n} | {first.replace('|', '/')} |")
    md += ["", f"结论：{'全部符合预期' if ok else '有不符合预期的条目'}。"]
    (design / "evidence" / "negative_checks_v2.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
