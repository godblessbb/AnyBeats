"""v3b 补充视觉稿检查脚本的反向探针：在临时副本里逐条改坏一处，design/check_mockups_v3b.py 必须退出非 0。

用法（仓库根目录）：python -I evidence/ct_6765fa8b/run_negative_checks_v3b.py design
临时副本放在 tempfile 默认目录（$TMPDIR）里，跑完删掉。基线（不改）必须退出 0。
"""
import pathlib, shutil, subprocess, sys, tempfile
root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "design").resolve()
PROBES = [
  ("手机上不左右滑（1/32 挤在 390 宽里）", "mockups_v3b/v3b.js", "SCROLL = cellW < need ? need : null;", "SCROLL = null;"),
  ("行头加「续」", "mockups_v3b/v3b.js", "'\"><b>' + pad(row.bar) + '</b></div>';", "'\"><b>' + pad(row.bar) + '</b>' + (row.cont ? '<span>续</span>' : '') + '</div>';"),
  ("细线在格线处断开", "mockups_v3b/v3b.js", ": '-1px';", ": '3px';"),
  ("折行后细线不从下一行开头画", "mockups_v3b/v3b.js", "var left = sg.first ? 'calc(' + pct(sg.s - c0) + ' - 1px)' : '0px';", "var left = sg.first ? 'calc(' + pct(sg.s - c0) + ' - 1px)' : '12px';"),
  ("只有拖音的格子也涂色", "mockups_v3b/v3b.js", "var rule = holdOnly ? null : paintOf(PAINT, key);", "var rule = holdOnly ? 'D' : paintOf(PAINT, key);"),
  ("细线不跟字同色", "mockups_v3b/v3b.css", ".dl.rp { background: hsl(var(--h) var(--sw-s) var(--sw-l));", ".dl.rp { background: #888;"),
  ("加回拖音格", "mockups_v3b/v3b.js", "data-role=\"slot\" data-kind=\"word\" data-tick=\"' + w.off", "data-role=\"slot\" data-kind=\"' + (w.len > w.box ? 'hold' : 'word') + '\" data-tick=\"' + w.off"),
  ("没有点了以后的提示", "mockups_v3b/v3b.js", "if (C.hit === key && holdOnly) inner += holdTip(segs[0]);", ""),
]
base = subprocess.run([sys.executable, "-I", str(root / "check_mockups_v3b.py"), str(root)], capture_output=True, text=True)
print("基线 → exit", base.returncode, "|", base.stdout.strip().splitlines()[0][:80])
fails = int(base.returncode != 0)
work = pathlib.Path(tempfile.mkdtemp(prefix="v3b_neg_"))
for name, f, a, b in PROBES:
    tmp = work / "design"
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.copytree(root, tmp, ignore=shutil.ignore_patterns("screenshots*"))
    t = (tmp / f).read_text()
    assert a in t, name
    (tmp / f).write_text(t.replace(a, b, 1))
    r = subprocess.run([sys.executable, "-I", str(root / "check_mockups_v3b.py"), str(tmp)], capture_output=True, text=True)
    line = next((l for l in r.stdout.splitlines() if l.startswith("  - ")), r.stdout.strip()[:120])
    print(("OK  " if r.returncode else "MISS"), name, "→ exit", r.returncode, "|", line.strip()[:110])
    fails += r.returncode == 0
shutil.rmtree(work, ignore_errors=True)
sys.exit(1 if fails else 0)
