# ct_6765fa8b 报告：AnyBeats v3 落地

## 第一段：补充视觉稿（只出图）

- `design/mockups_v3b/`：`drag.html`（格内拖音：拖音 = 字的长度，五种情况）、`wrap.html`（一句超过一小节，不标「续」）、`dense.html`（手机 390 最小字宽）。
- 用户回答：「手机 1/32 别上下叠，改成整张表可左右滑；其余按这 3 张图写代码」。第二段已把 `dense.html` 改成左右滑，`design/check_mockups_v3b.py` 和反向探针跟着改（`negative_checks_v3b.md`）。
- 截图：`design/screenshots_v3b/` 12 张（工作区外证据目录 `screenshots_v3b/` 同一份）。

## 第二段：产品代码

- `src/core`：tick 模型（`grid.ts`：字 = 起点 + 长度，没有拖音格）、`flow.ts`（精度 / 铺字 / 按 - 拉长 / 字框规则 / 最小字宽与左右滑 / 导唱事件）、`rhymeRules.ts`（颜色规则、一格一色、只有拖音不能涂、严格韵母常量、对不上列表、同韵自动合并）、`locks.ts`（四种锁、逐字比对）、`aiEdit.ts`（一次填韵只填空格子、选区润色默认保持骨架，结果过锁定比对、违规整份作废）、`history.ts`（单线历史、可序列化）、`project.ts`（v3 格式、v1/v2 → v3 迁移、历史编码）、`autosave.ts`（作品 + 历史一起存）、`bpm.ts`（首拍、换伴奏二选一，默认推荐改用新 BPM）。
- `src/engine`：`editorStore.ts`（所有改动走一条历史并先过锁定检查）、`view.ts`、`demo.ts`（夜车：英文段落、四种颜色、各种拖音）、`transport.ts`（导唱按字的长度拉长、伴奏变速、换伴奏）、`aiController.ts`（不挂载）、`rhymeSearch.ts`（按规则找候选）。
- `src/storage/library.ts`：旧版本作品第一次读时原文拷进 `anybeats.backup.v2.<id>`；迁移失败正文和备份都不动；历史存 `anybeats.history.v3.<id>`。
- 界面：`LyricsGrid`、`RulePanel`（含 `LockPanel`）、`FlowPanel`、`HistoryPopover`、`BpmDialog`、`TopBar`、`TrackStrip`、`Chrome`、`ExportPanel`、`App`、`App.css`（照 v3 / v3b 视觉稿的样式）。录音、AI 用构建开关，默认构建里整段裁掉。
- 详细的实现取舍：`design/DESIGN_v3_impl.md`。

## 验收

- `npx vitest run`：20 个文件、351 条全过（其中 v2 迁移夹具测试用第一期代码原样生成的工程）。
- `npm run build`：`tsc -b` + `vite build` 通过。
- `python -I e2e/check_app_v3.py dist/index.html`：在构建产物上实测，全部通过。
- 反向探针：`negative_checks.md`（15 条改坏构建产物，检查脚本都退出非 0；基线退出 0）。
- 受保护路径对 main 无改动。
- 截图：工作区外证据目录 `app_v3/`（首屏桌面 / 手机 × 浅 / 深色、只有拖音的提示、合并、对不上、历史面板、BPM 弹窗、1/32 左右滑、铺 flow）。
