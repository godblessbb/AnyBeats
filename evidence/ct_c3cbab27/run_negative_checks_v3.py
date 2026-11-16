"""反向探针：把 v3 视觉稿故意改坏，确认 design/check_mockups_v3.py 会退出非 0 并报出对应断言。

用法：python -I evidence/ct_c3cbab27/run_negative_checks_v3.py design
每条变异都在 $TMPDIR 下的临时副本里做（拷 mockups_v3/ + check_mockups_v3.py），不碰仓库里的文件。
基线（不改）必须退出 0；每条变异必须退出非 0，且输出里出现对应断言的报错。
结果写到 evidence/ct_c3cbab27/negative_checks_v3.md（和本脚本同目录）。
"""

import concurrent.futures
import pathlib
import shutil
import subprocess
import sys
import tempfile

JS = "mockups_v3/v3.js"
CSS = "mockups_v3/v3.css"
CSS_TAIL = "/* ---------- 11. 手机 ---------- */"

# (标题, 期望在输出里看到的断言关键字, [(文件, 原文, 替换), ...])
MUTATIONS = [
    ("基线（不改）", "OK：", []),
    ("顶栏加回录音键", "录音",
     [(JS, "'<button class=\"tog\">' + I.metro + '节拍器</button></div>' +",
       "'<button class=\"tog\">' + I.metro + '节拍器</button><button class=\"btn\" data-role=\"record\">● 录音</button></div>' +")]),
    ("空音格里显示「∅」", "可见文本含「∅」",
     [(JS, "    if (s.w32) cls.push('w32');", "    if (s.w32) cls.push('w32');\n    if (s.kind === 'rest') inner = '<span class=\"ch\">∅</span>';")]),
    ("段落标签改回中文「主歌」", "段落标签不是英文",
     [(JS, "{ label: 'Verse 1', rows: [", "{ label: '主歌', rows: [")]),
    ("一格两种颜色（韵脚字换成别的色相）", "一格一种颜色",
     [(CSS, CSS_TAIL, ".slot.rp, .slot.rp.word.filled { background: hsl(calc(var(--h) + 120) var(--chip-s) var(--chip-l)) !important; }\n" + CSS_TAIL)]),
    ("空音画成和拖音一样的横条", "空字格样式",
     [(CSS, CSS_TAIL, ".slot.rest { border: 0 !important; background: var(--hold) !important; height: 8px !important; top: calc(var(--slot-top) + var(--slot-h) / 2 - 4px) !important; }\n" + CSS_TAIL)]),
    ("字不按 tick 摆（落点比例算错）", "tick 落点",
     [(CSS, "left: calc(var(--t) / 48 * 100% + 1px); width: calc(var(--l) / 48 * 100% - 2px);",
       "left: calc(var(--t) / 56 * 100% + 1px); width: calc(var(--l) / 48 * 100% - 2px);")]),
    ("三连不标「3」", "三连标记",
     [(CSS, CSS_TAIL, ".trip { display: none !important; }\n" + CSS_TAIL)]),
    ("去掉格底 16 分刻度线", "16 分刻度线",
     [(CSS, CSS_TAIL, ".cell .tk { display: none !important; }\n" + CSS_TAIL)]),
    ("字下面加下划线", "下划线",
     [(CSS, CSS_TAIL, ".slot .ch { text-decoration: underline; }\n" + CSS_TAIL)]),
    ("押韵落到格内第一个字", "韵脚位置",
     [(JS, "rp = words.slice(words.length - n);\n      b.slots.forEach", "rp = words.slice(0, n);\n      b.slots.forEach")]),
    ("涂了色没写字的格子不显示韵母占位", "韵脚位置",
     [(JS, "if (!show) inner = '<span class=\"ph\" data-role=\"placeholder\">' + opt.final + '</span>';",
       "if (!show) inner = '';")]),
    ("手机押韵抽屉不展开", "抽屉展开",
     [(JS, "drawer: ext(FULL, { rule: 'C', cur: '9:3', drawerOpen: true, mismatch: false })",
       "drawer: ext(FULL, { rule: 'C', cur: '9:3', drawerOpen: false, mismatch: false })")]),
    ("BPM 弹窗只剩一个选项", "BPM 弹窗：应该正好两个选项",
     [(JS, "'<button class=\"opt\" data-role=\"bpm-option\"><b>改用新 BPM（100）</b>",
       "'<button class=\"opt\" data-role=\"bpm-gone\" style=\"display:none\"><b>改用新 BPM（100）</b>")]),
    ("静态画面的工具条露出「AI 润色」按钮", "AI 文案不在「接入后」框里",
     [(JS, "'<span class=\"status desk-only\">' + status + '</span></div>';",
       "'<button class=\"btn sm\">AI 润色</button><span class=\"status desk-only\">' + status + '</span></div>';")]),
    ("锁定的格子没有斜纹", "锁定",
     [(CSS, CSS_TAIL, ".cell.locked { background-image: none !important; }\n" + CSS_TAIL)]),
    ("「允许改 flow」默认打开", "允许改 flow",
     [(JS, "aria-checked=\"false\" data-role=\"allow-flow\"", "aria-checked=\"true\" data-role=\"allow-flow\"")]),
    ("被拒的 AI 结果还是上了屏", "表格内容和完整稿不一致",
     [(JS, "  SONG.forEach(function (sec) { sec.rows.forEach(function (r) { r.beats = r.b.map(parseBeat); }); });",
       "  if (S === 'ai_reject') SONG[1].rows[3].b[0] = '这一步都';\n"
       "  SONG.forEach(function (sec) { sec.rows.forEach(function (r) { r.beats = r.b.map(parseBeat); }); });")]),
    ("可重做的步骤和已做的步骤样式一样", "可重做的步骤和已做的步骤样式一样",
     [(CSS, ".he.redo small { color: var(--ab-text-faint); }", ".he.redo small { color: var(--ab-text-muted); }")]),
    ("导唱块数和字位数对不上（漏掉三连）", "导唱",
     [(JS, "            if (s.kind !== 'word') return;\n            var len = s.len, nx",
       "            if (s.kind !== 'word' || b.trip) return;\n            var len = s.len, nx")]),
    ("拿掉撤销键", "撤销/重做",
     [(JS, "'<button class=\"ibtn\" data-role=\"undo\"", "'<button class=\"ibtn\" style=\"display:none\" data-role=\"undo\"")]),
    ("多出第二个播放键", "播放键",
     [(JS, "'<div class=\"spacer\"></div>' +\n      '<button class=\"btn ghost desk-only\">'",
       "'<div class=\"spacer\"></div><button class=\"btn\" data-role=\"play\">播放</button>' +\n      '<button class=\"btn ghost desk-only\">'")]),
    ("强调色改成紫色 #7C3AED", "强调色是紫色",
     [(CSS, "--ab-accent: #C2410C;", "--ab-accent: #7C3AED;")]),
    ("段落名加 text-transform:uppercase", "uppercase",
     [(CSS, ".sec-h b { font-size: 14px; color: var(--ab-text); }", ".sec-h b { font-size: 14px; color: var(--ab-text); text-transform: uppercase; }")]),
    ("引一个外网字体", "外网请求",
     [("mockups_v3/full.html", '<link rel="stylesheet" href="v3.css">',
       '<link rel="stylesheet" href="v3.css">\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">')]),
    ("页面底色写死白色（深色失效）", "深色模式没生效",
     [(CSS, "  overflow: hidden; -webkit-font-smoothing: antialiased;\n}", "  overflow: hidden; -webkit-font-smoothing: antialiased;\n  background: #FFFFFF !important;\n}")]),
]


def run_one(design, title, keyword, muts):
    with tempfile.TemporaryDirectory(prefix="ab-neg-v3-") as tmp:
        t = pathlib.Path(tmp)
        shutil.copytree(design / "mockups_v3", t / "mockups_v3")
        shutil.copy(design / "check_mockups_v3.py", t / "check_mockups_v3.py")
        for path, old, new in muts:
            p = t / path
            text = p.read_text(encoding="utf-8")
            if old not in text:
                return title, -2, "变异锚点没找到：" + old[:60], 0, False
            p.write_text(text.replace(old, new, 1), encoding="utf-8")
        r = subprocess.run([sys.executable, "-I", str(t / "check_mockups_v3.py"), str(t)], capture_output=True, text=True)
        out = (r.stdout + r.stderr).strip().splitlines()
        hits = [line.strip() for line in out if keyword in line]
        passed = (r.returncode == 0 if not muts else r.returncode != 0) and bool(hits)
        first = hits[0] if hits else (out[0] if out else "")
        return title, r.returncode, first, len(hits), passed


def main():
    design = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "design").resolve()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futs = [pool.submit(run_one, design, *m) for m in MUTATIONS]
        rows = [f.result() for f in futs]
    ok = all(r[4] for r in rows)
    for title, code, _first, n, passed in rows:
        print(f"{title}: exit={code} {'OK' if passed else 'UNEXPECTED'} ({n} 条命中)")
    md = ["# check_mockups_v3.py 反向探针记录", "",
          "由 `python -I evidence/ct_c3cbab27/run_negative_checks_v3.py design` 生成。每条变异只改临时副本（`$TMPDIR` 下拷一份 `mockups_v3/` 和检查脚本），"
          "然后对副本跑完整的 `check_mockups_v3.py`。基线必须退出 0；每条变异必须退出非 0，且输出里有对应断言的报错。", "",
          "| 变异 | 退出码 | 结论 | 命中条数 | 脚本报出的对应断言（第一条） |", "|---|---|---|---|---|"]
    for title, code, first, n, passed in rows:
        first = first.replace("|", "/")
        if title.startswith("基线"):
            first = first.split("→")[0].strip()  # 基线那行带临时目录路径，去掉
        md.append(f"| {title} | {code} | {'符合预期' if passed else '不符合预期'} | {n} | {first[:170]} |")
    md += ["", f"共 {len(rows) - 1} 条变异 + 1 条基线。结论：{'全部符合预期' if ok else '有不符合预期的条目'}。"]
    (pathlib.Path(__file__).resolve().parent / "negative_checks_v3.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
