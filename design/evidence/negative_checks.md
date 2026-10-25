# check_mockups.py 反证记录

由 `python -I design/evidence/run_negative_checks.py design` 生成。每条变异只改临时副本里的 editor.html / 共享 css / js。

| 变异 | 退出码 | 结论 | 脚本报出的对应断言 |
|---|---|---|---|
| 基线（不改） | 0 | 符合预期 | OK：1 个画面 × 3 尺寸 × 2 配色 = 6 张截图，全部断言通过 → /tmp/ab-neg-3ej_64za/screenshots |
| 强调色改成紫色 #7C3AED | 1 | 符合预期 | - [editor desktop 999x581 light] 强调色是紫色：--ab-accent rgb(124, 58, 237) 色相 262° |
| 网格挪到首屏以下（上方加 400px） | 1 | 符合预期 | - [editor desktop 999x581 light] 歌词网格不在首屏：顶边 492px，视口一半 290px |
| 段落标题加 text-transform:uppercase | 1 | 符合预期 | - [editor desktop 999x581 light] 用了 text-transform:uppercase：b. "主歌 1" |
| 引一个外网字体 | 1 | 符合预期 | - [editor desktop 999x581 light] 外网请求：https://fonts.googleapis.com/css2?family=Inter |
| 页面里打一条 console.error | 1 | 符合预期 | - [editor desktop 999x581 light] 控制台错误：boom |
| 歌词字改成 #CCCCCC 浅灰 | 1 | 符合预期 | - [editor desktop 999x581 light] 对比度 1.53 < 4.5：“凌” rgb(204, 204, 204) on rgb(248,250,252) |
| 删掉网格的 data-role（网格不存在） | 1 | 符合预期 | - [editor desktop 999x581 light] 找不到歌词网格 [data-role=lyrics-grid] |
| 页面底色写死白色（深色模式失效） | 1 | 符合预期 | - [editor desktop] 深色模式没生效：深色页底不比浅色暗 |
