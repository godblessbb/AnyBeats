# ct_afdb4134：AnyBeats v3.2（第 1 步方格：点方格打字、空格分格、Shift+空格三连、两下空格空音、清空全部 flow）

## 第一段（只出稿，不改 src/）
- 设计说明 `design/DESIGN_v32.md`：根因、方格 ↔ tick 数据模型对照（不加字段、不改存档）、分格 / 空音 / 合并 / 点空白 / 清空全部 flow 的纯函数规则、
  键盘状态机（0.4 秒窗口用 keydown 的 timeStamp、两下空格 = 撤回分格 + 空音合成一步、输入法拼字中空格不做事）、和 v3.1 冲突的地方、第二段实现计划。
- 视觉稿 `design/mockups_v32/`（7 个画面：default / edit / split8 / split16 / triplet / rest / clear），
  截图 `design/screenshots_v32/`（28 张：桌面 1280×800 / 手机 390×844 × 浅 / 深）。
- 自动检查 `python -I design/check_mockups_v32.py design`：28 个组合全过（方格在格子里、按 tick 摆、空方格有看得见的边和底、
  空音不画边不画底、各画面的分格大小 / 光标位置 / 提示 / 确认条在视口里、页面不左右溢出）。

用户 11-17 看过稿子，回答「按稿子做」。

## 第二段：实现（用户 11-17 回答「按稿子做」）
落点见 `design/DESIGN_v32.md` 第 7 节。数据格式不变：方格 = 一个字（文字可以空），空音 = 空白。
- `src/core/squares.ts`：分格 / 三连 / 空音 / 合并 / 空音里打字 / 清空全部 flow，全是只动一拍的纯函数。
- `src/engine/editorStore.ts`：`flowEdit` 光标、0.4 秒两下空格（撤回分格 + 空音 = 历史里一步）、清空全部 flow（一步）。
- `src/components/LyricsGrid.tsx`：第 1 步方格、光标空音（虚线）、看不见的输入框（输入法拼字中不接空格 / 退格 / 回车）、按键气泡；第 2 步没改。
- `src/App.tsx`：第 1 步工具条「清空全部 flow…」+ 就地确认；`FlowPanel.tsx` 图例和按键说明；`App.css` 第 13 节。

## 验证（日志、截图都在任务证据目录）
| 命令 | 结果 |
|---|---|
| `npx vitest run` | 22 个文件 390 条全过（新增 `core/__tests__/squares.test.ts` 11 条、`editorStore.test.ts`「第 1 步方格」7 条） |
| `npm run build` | 通过 |
| `python -I e2e/check_app_v32.py dist/index.html` | 全过（`check_app_v32.log`，截图 `app_v32/`：桌面 / 手机 × 浅 / 深） |
| 同一个脚本跑改动前的构建 | 33 项不满足（`check_app_v32_on_old_build.log`）——检查不是摆设 |
| `python -I e2e/check_app_v31.py dist/index.html` | 全过（改了 2 处，文件开头写了原因） |
| `python -I e2e/check_app_v3.py dist/index.html` | 全过（没改） |
| 受保护路径 diff | 无改动 |

`check_app_v32.py` 的两个反向探针：间隔 0.6 秒的两下空格拿「空音、只多一步」的判定去判必须判不过；清空前后的快照比对拿改过一个字的快照去比必须报出不同。
