# ct_46961d73 报告：AnyBeats v3.3 断句设计稿（只出稿）

## 交付
- `design/DESIGN_v33.md`：设计稿正文（数据模型、显示、手动标注、自动断句、韵脚默认落句尾、AI 第 ⑤ 道检查、韵脚间隔、10 道拍板题、12 处冲突及去向）
- `design/mockups_v33/`：7 个画面 `phrases` `dense` `mark` `auto` `rhyme` `spacing` `touch`（共用 `v33.js` / `v33.css`，样式叠在 v3 / v3b / v3.1 / v3.2 的 CSS 上，只读引用）
- `design/check_mockups_v33.py`：浏览器实测检查 + 9 条反向探针
- `design/screenshots_v33/`：28 张截图（7 画面 × 桌面 1280×800 / 手机 390×844 × 浅 / 深）
- `design/fixtures_v33/koi_phrases.json`（+ 生成脚本 `build_fixtures.py`）：《恋爱循环》rap 版 flow 和断句，只有 tick；`design/mockups_v33/koi_ticks.js` 是同一份数据给页面用

## 验收
- `/opt/Alphie/.venv/bin/python -I design/check_mockups_v33.py design` → 28/28 通过，9 条反向探针全部报错（咬住），退出 0
- `test -s design/DESIGN_v33.md` → 0
- `git diff --exit-code $(git merge-base main HEAD) -- src/ e2e/ backend/ package.json design/AGENT_DESIGN.md design/DESIGN_v32.md design/mockups_v32/` → 0
- 仓库里扫假名（U+3040–U+30FF）：`design/`、`evidence/` 里没有；样例只取 tick，歌词原文没读进来

## 关键数字（样例 stats）
- 116 句；句尾最后一个字起点在第 4 拍 64 句（按半拍四舍五入口径 78 句），其余在第 3 / 2 拍或拖到下一小节第 1 拍
- 「按格子算韵脚」会押到下一句的：35 句；最后两个字分在两格：40 句
- 只看 flow（空白 ≥ 半拍或段落交界）：猜 60 处、对 37 处，准确率 62%、召回 32%；连续 ≥ 4 小节猜不出断点 9 段，最长第 99–110 小节（App 行头编号）
