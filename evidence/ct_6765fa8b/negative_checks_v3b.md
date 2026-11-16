# v3b 补充视觉稿：检查脚本的反向探针

脚本：`python -I evidence/ct_6765fa8b/run_negative_checks_v3b.py design`。在临时副本里逐条改坏一处，`design/check_mockups_v3b.py` 都必须退出非 0；基线必须退出 0。

| # | 改坏了什么 | 结果 | 脚本报的第一条 |
|---|---|---|---|
| 0 | 基线（不改） | exit 0 | OK：3 个画面 × 2 尺寸 × 2 配色 = 12 张截图，全部断言通过 |
| 1 | 手机上不左右滑（1/32 挤在 390 宽里） | exit 1 | dense mobile：字挤出格子：第 6 小节第 1 拍「在」字挤出字框（字 11px，框 8.6px） |
| 2 | 折行的那一行行头加「续」 | exit 1 | wrap desktop：表格里出现「续」（折行不加续行标记） |
| 3 | 细线在格线处断开 3px | exit 1 | drag desktop：第 6 小节第 4 拍 tick 12：折行前细线没画到这一行最后 |
| 4 | 折行后细线不从下一行开头画 | exit 1 | drag desktop：折行后细线没从下一行开头接着画 |
| 5 | 只有拖音的格子也涂上色 | exit 1 | drag desktop：只有拖音的格子被涂了色：第 7 小节第 2 拍 |
| 6 | 韵脚字的细线改成灰色 | exit 1 | drag desktop：第 5 小节第 2 拍 tick 36：韵脚字的细线不是这种颜色 |
| 7 | 加回「拖音格」（data-kind=hold） | exit 1 | drag desktop：表格里还有 10 个不是「字」的字格 |
| 8 | 点了只有拖音的格子没有提示 | exit 1 | drag desktop：看不到「这一拍只有拖音」的提示 |

第二段按用户的回答改过：1/32 不上下叠，改成整张表左右滑，第 1 条探针跟着换成「不左右滑」。这是视觉稿阶段的检查。产品代码的检查脚本 `e2e/check_app_v3.py` 和它的反向探针另记在 `negative_checks.md`。
