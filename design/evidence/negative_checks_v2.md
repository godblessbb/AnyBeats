# check_mockups_v2.py 反证记录

由 `python -I design/evidence/run_negative_checks_v2.py design` 生成。每条变异只改临时副本（`$TMPDIR` 下拷一份 `mockups_v2/` 和检查脚本），然后对副本跑完整的 `check_mockups_v2.py`。基线必须退出 0；每条变异必须退出 1，且输出里有对应断言的报错。

| 变异 | 退出码 | 结论 | 命中条数 | 脚本报出的对应断言（第一条） |
|---|---|---|---|---|
| 基线（不改） | 0 | 符合预期 | 1 | OK：5 个画面 × 2 尺寸 × 2 配色 = 20 张截图，全部断言通过 → /root/.alphie/coding_tasks/ct_5bdc927f/tmp/ab-neg-v2-vjd_p2ns/screenshots_v2 |
| 空拍恢复显示「∅」 | 1 | 符合预期 | 8 | - [grid desktop 1280x800 light] 可见文本含「∅」：…凌 晨 三 点 街 上 ∅ 我 还 在 路 上 a… |
| 顶栏加回「Worker 未连接」 | 1 | 符合预期 | 20 | - [draft desktop 1280x800 light] 可见文本含「Worker」：…2 自动 节拍器 导唱 Worker 未连接 作品 导出 小… |
| 押韵面板加回「AI 写词」页签 | 1 | 符合预期 | 8 | - [draft desktop 1280x800 light] 可见文本含「AI 写词」：…两格 铺到拍子上 押韵 AI 写词 第 10 小节 ① 当… |
| 去掉双押块（不画块框） | 1 | 符合预期 | 4 | - [grid desktop 1280x800 light] 双押块：找不到合格的连续 ≥2 字双押块（第 3 行 b3：没有可见的块框；第 4 行 b4：没有可见的块框；第 7 行 b7：没有可见的块框；第 8 行 b8：没有可见的块框） |
| 双押块格子底色变透明 | 1 | 符合预期 | 4 | - [grid desktop 1280x800 light] 双押块：找不到合格的连续 ≥2 字双押块（第 3 行 b3：底色透明；第 4 行 b4：底色透明；第 7 行 b7：底色透明；第 8 行 b8：底色透明） |
| 句内同韵退回只标句尾 | 1 | 符合预期 | 4 | - [grid desktop 1280x800 light] 句内同韵：没有任何一行有 ≥2 个字带同一押韵类且底色相同、看得出来（最多 1 个） |
| 拍边界线改成和拍内线一样 | 1 | 符合预期 | 8 | - [grid desktop 1280x800 light] 拍线：每拍边界和拍内边界样式一样，分不出拍子（solid 1px rgb(238, 240, 243)） |
| 手机押韵抽屉默认展开（300px） | 1 | 符合预期 | 10 | - [draft mobile 390x844 light] 押韵抽屉：收起高度 300px > 64px |
| 伴奏空态去掉「先用节拍器写」入口 | 1 | 符合预期 | 4 | - [empty desktop 1280x800 light] 伴奏空态：「先用节拍器写」入口不可见 |
| 伴奏空态退回一条细虚线（整块不见） | 1 | 符合预期 | 12 | - [empty desktop 1280x800 light] 伴奏空态：找不到可见的 [data-role=beat-empty] |
| 录音只剩 2 条音轨 | 1 | 符合预期 | 4 | - [record desktop 1280x800 light] 录音音轨：轨道区里只有 2 条可见音轨（带波形），至少要 3 条 |
| 录音键挪回顶栏（不在音轨区） | 1 | 符合预期 | 4 | - [record desktop 1280x800 light] 录音音轨：录音键不在音轨所在的轨道区里 |
| 草稿按钮改名「应用」（没有「铺到拍子上」） | 1 | 符合预期 | 8 | - [draft desktop 1280x800 light] 草稿：没有可见的「铺到拍子上」按钮 |
| 删掉押韵图例 | 1 | 符合预期 | 4 | - [grid desktop 1280x800 light] 图例：押韵图例不可见或没说明双押 |
| 强调色改成紫色 #7C3AED | 1 | 符合预期 | 20 | - [draft desktop 1280x800 light] 强调色是紫色：--ab-accent rgb(124, 58, 237) 色相 262° |
| 段落名加 text-transform:uppercase | 1 | 符合预期 | 24 | - [grid desktop 1280x800 light] 用了 text-transform:uppercase：b. "主歌 1" |
| 引一个外网字体 | 1 | 符合预期 | 4 | - [grid desktop 1280x800 light] 外网请求：https://fonts.googleapis.com/css2?family=Inter |
| 页面底色写死白色（深色失效） | 1 | 符合预期 | 10 | - [draft desktop] 深色模式没生效：深色页底不比浅色暗 |

结论：全部符合预期。
