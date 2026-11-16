# ct_c3cbab27 报告：AnyBeats v3 视觉稿（类 Excel 表格 · 先 flow 后字 · 色块押韵）

- 画面：`design/mockups_v3/`，9 个画面（flow / paint / full / lock / ai / ai_reject / beat / history / drawer），共用 `v3.css` + `v3.js`。第一期和 v2 的稿子没动。
- 截图：`design/screenshots_v3/`，9 画面 × 桌面 1280×800 / 手机 390×844 × 浅 / 深色 = 36 张。工作区外的证据目录 `screenshots_v3/` 里有同样一份。
- 说明：`design/DESIGN_v3.md`，包括 tick 数据模型、逐项说明、推翻 v2 的 11 条和原因、下一单要动的文件、9 道拍板题。
- 自检：`/opt/Alphie/.venv/bin/python -I design/check_mockups_v3.py design` → `OK：9 个画面 × 2 尺寸 × 2 配色 = 36 张截图，全部断言通过`。所有断言都读浏览器里量出来的值（计算样式、元素位置、命中测试、可见文字），不 grep 源码。
- 反向探针：`/opt/Alphie/.venv/bin/python -I evidence/ct_c3cbab27/run_negative_checks_v3.py design` → 25 条变异都让脚本退出 1，并报出对应断言；基线退出 0。逐条记录见同目录 `negative_checks_v3.md`。
- 受保护路径：`git diff --exit-code $(git merge-base main HEAD) -- src/ backend/ e2e/ package.json package-lock.json design/mockups/ design/mockups_v2/ design/check_mockups.py design/check_mockups_v2.py design/DESIGN.md design/DESIGN_v2.md` → 退出 0。

## 反向探针清单（25 条）

加回录音键 · 空音显示「∅」· 段落标签改中文 · 一格两种颜色 · 空音画成拖音的样子 · 字不按 tick 摆 · 三连不标「3」· 去掉 16 分刻度线 · 字加下划线 · 押韵落到格内第一个字 · 不显示韵母占位 · 手机抽屉不展开 · BPM 弹窗只剩一个选项 · 静态画面露出 AI 按钮 · 锁定格没有斜纹 · 「允许改 flow」默认开 · 被拒的 AI 结果上了屏 · 可重做步骤和已做步骤样式一样 · 导唱块数 ≠ 字位数 · 拿掉撤销键 · 两个播放键 · 紫色强调色 · 全大写 · 外网字体 · 深色失效。
