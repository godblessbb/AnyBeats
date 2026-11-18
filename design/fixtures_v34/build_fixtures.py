"""把 v4 样例工程（用户自己写的中文词）转成稿子能直接 <script> 读的 design/mockups_v34/koi_v4.js。

用法：python -I design/fixtures_v34/build_fixtures.py design

- 输入：design/fixtures_v34/koi_zh_lyrics_v4_nopickup.anybeats（主会话给的文件原样拷贝，没改一个字节）
        design/fixtures_v34/pinyin_v4.json（gen_pinyin.mjs 用 pinyin-pro 逐字生成的拼音表）
- 输出：design/mockups_v34/koi_v4.js —— window.KOI = { name, bpm, sections, rules, paint, pinyin }
  sections 里每个字只留 [tick, len, text]；rules / paint 原样带上（15 条同色规则，见 DESIGN_v34.md 第 3 节）。
- 稿子在 file:// 下打开，浏览器不让 fetch 本地 JSON，所以转成 .js。
- 只用标准库。
"""

import json
import pathlib
import sys


def main() -> int:
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "design").resolve()
    fx = root / "fixtures_v34"
    doc = json.loads((fx / "koi_zh_lyrics_v4_nopickup.anybeats").read_text(encoding="utf-8"))
    py = json.loads((fx / "pinyin_v4.json").read_text(encoding="utf-8"))["table"]
    sections = []
    for s in doc["sections"]:
        bars = []
        for b in s["bars"]:
            words = sorted(b["words"], key=lambda w: w["tick"])
            bars.append({"id": b["id"], "w": [[w["tick"], w["len"], w["text"]] for w in words]})
        sections.append({"id": s["id"], "kind": s["kind"], "label": s["label"], "bars": bars})
    out = {
        "name": doc["name"],
        "bpm": doc["bpm"],
        "sections": sections,
        "rules": doc["rules"],
        "paint": doc["paint"],
        "pinyin": py,
    }
    target = root / "mockups_v34" / "koi_v4.js"
    target.write_text(
        "/* 由 design/fixtures_v34/build_fixtures.py 从 koi_zh_lyrics_v4_nopickup.anybeats + pinyin_v4.json 生成，不要手改 */\n"
        "window.KOI = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    n = sum(len(b["w"]) for s in sections for b in s["bars"])
    print(f"{target.relative_to(root.parent)}：{len(sections)} 段、{sum(len(s['bars']) for s in sections)} 小节、{n} 个字、{len(doc['paint'])} 格涂色")
    return 0


if __name__ == "__main__":
    sys.exit(main())
