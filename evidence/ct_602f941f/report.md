# ct_602f941f：AnyBeats v3.1（一拍一格、改字不越拍、拍头选整列跨段落、拖音浅底、段落类型、空作品在第 1 步）

## 第一段（已交）
视觉稿 `design/mockups_v31/`（7 个画面）+ 截图 `design/screenshots_v31/`（28 张）+ 设计说明 `design/DESIGN_v31.md`。
用户 11-17 回答：「整个拍头都选这一拍整列，细刻度只当标尺（按稿子做）」。

## 第二段：实现
落点见 `design/DESIGN_v31.md` 第 4 节。根因（第一段在 v3 上实测复现）：
- 打字溢出：`fillTexts` 按全曲顺序往后填 → 换成 `core/grid.ts` 的 `setBeatText`，只动这一拍。
- 加段落永远 Verse：`LyricsGrid.tsx` 写死 `addSection('verse')` → 段落菜单。
- 整列乱：每格自己画框（段落标题处断开）、拍头下半截是 16 分小按钮（橙色竖条）、`columnKeys` 连空行也选、点拍号后选法被切成「整列」
  → 一个总选中框（跨段落标题垫色）、拍头整格一个按钮、只选有东西的格子、不再切选法。

## 验证（日志都在任务证据目录）
| 命令 | 结果 |
|---|---|
| `npx vitest run` | 21 个文件 372 条全过（新增 `core/__tests__/beatText.test.ts` 12 条、`editorStore.test.ts` v3.1 两组 9 条） |
| `npm run build` | 通过 |
| `python -I e2e/check_app_v31.py dist/index.html` | 全过（`check_app_v31.log`，截图 `app_v31/`） |
| 同一个脚本跑改动前的构建 | 75 项不满足（`check_app_v31_on_old_build.log`）——检查不是摆设 |
| `python -I e2e/check_app_v3.py dist/index.html` | 全过（`check_app_v3.log`，截图 `app_v3/`） |
| `python -I design/check_mockups_v31.py design` | 28 个组合全过 |
| 受保护路径 diff | 无改动 |

`check_app_v31.py` 里有两个反向探针：真的去改下一拍，确认「这一拍以外不变」的比对会报出来；整列判定换成第 2 拍必须判不过。

## check_app_v3.py 的改动
只换选择器 / 操作方式（slot → word、drag-line → hold-tint、单字输入框 → 双击整格输入框、stretch-handle → hold-grip），
删掉 3 条绑在字框上的断言（字框右边位置、字挤出字框、细线从字框右边开始），文件开头逐条写了原因；
它本来就没有关于「整列」按钮、16 分小格的断言。
