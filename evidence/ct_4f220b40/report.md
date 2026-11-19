# ct_4f220b40 · AnyBeats v3.4 段 1：十三辙判韵

按 `design/DESIGN_v34.md` §9「段 1」表、§4、§5 实现。设计稿、backend 一行没改。

## 改了什么

| 文件 | 改动 |
|---|---|
| `src/core/rhymeRules.ts` | `RhymeMatchMode = 'thirteen' \| 'strict'`；删掉 `RHYME_MATCH_MODE` 常量，`finalsMatch / sameRhyme / mergeSameRules / addRule / updateRule / rhymeSlots / mismatches` 必须显式传档；`readRhymeMatch`（'loose' 读作 thirteen，别的值当没有）、`rhymeMatchOf`（没字段 = strict）；`groupOfWant`（韵母 / 整音节 / 辙名都认）、`canonicalFinal`、`zheName`、`finalsOfGroup`；`switchRhymeMatch`（改档 + 合并）、`previewRhymeMatch`（不押少几处、哪些颜色合并 / 变色、按颜色分的数字） |
| `src/core/project.ts` | `Doc.rhymeMatch?`、`ProjectFileV3.rhymeMatch?`；`fromV3` 只认两个值；`serializeProject` 有才写；`docCodec` 元数据段多存这一段；版本号仍是 3 |
| `src/core/locks.ts`、`src/core/aiEdit.ts` | `LockContext.rhymeMatch?`，`rhymeSlots` 用作品存的档（AI 填韵档取改之前的作品） |
| `src/engine/editorStore.ts` | `rhymeMatch` getter、`needsRhymeMigration()`、`rhymeMatchPreview()`、`setRhymeMatch(mode)`（改档 + 合并 = 一步）、`dismissRhymeMigration()`（写 strict = 一步）；十三辙下合并提示写「都是言前辙…n 格从绿色变蓝色」；`recolorText` / `migrationSummary` |
| `src/engine/demo.ts` | 新建作品、两个示例、第一次打开的夜车都写 `rhymeMatch: 'thirteen'` |
| `src/engine/rhymeSearch.ts`、`src/engine/view.ts` | 候选、表格按作品的档判；十三辙下同辙里韵母完全相同的候选排前面；空韵脚位占位 / 行尾色条写辙名（严格写韵母） |
| `src/components/RulePanel.tsx` | 「判押韵：十三辙 \| 严格韵母」块（严格档带十三辙全表）、旧作品「改用十三辙会怎样」、规则块按档写「言前辙 · an ian uan üan 都算」/「严格：只认 ian」、对不上列表按档写 |
| `src/App.tsx`、`src/App.css` | 迁移横幅（`.mig`，样式照 `v34.css` 原样，和「清空全部 flow…」同一种警示边框 / 底色） |
| `src/components/LyricsGrid.tsx` | 占位、行尾标签、行尾对不上标签按档写 |
| 测试 | 新增 `src/core/__tests__/rhyme13.test.ts`（65 条）、`src/engine/__tests__/rhyme13Store.test.ts`（8 条）；旧测试里调用改成显式传 `'strict'`，三条依赖「示例默认严格」的改成先切严格并补十三辙那一面 |
| e2e | 新增 `e2e/check_app_v34_rhyme.py`；`e2e/check_app_v3.py` 场景 5 先在右栏点「严格韵母」再测（文件开头写了原因，断言没改） |

## 验收

- vitest 462 条全过；`npm run build` 过；`check_app_v34_rhyme.py` / `v32` / `v31` / `v3` 全过；`git diff` 对 `backend/ design/` 为空。日志：工作区外证据目录 `acceptance_after.log`。
- 改动前的构建（HEAD d02f51c 原样 `git archive` + build）跑新 e2e：11 项判红（没有横幅、新建作品「边 ian≠an」「完 uan≠an」误报等），日志 `check_app_v34_rhyme_before_change.log`。
- 反向探针：一色一规则改用十三辙后，把档切回 strict（等于 App 不认作品设置），同一个「十三辙 0 处对不上」判定必须判红——咬住（56 处）。
- 截图：`shots/banner_*`、`judge_strict_*`、`judge_thirteen_*`，桌面 1280 / 手机 390 × 浅 / 深，共 12 张。

## 发现的现网问题（没改，不在本段范围）

手机抽屉里「作品与导出」的标题行（带关闭键）被 `.drawer .dbody .pn > .pn-h:first-child { display: none }` 藏掉了，打开作品面板后回不到押韵面板（改动前就这样）。新 e2e 的手机截图因此先用桌面宽度导入、关闭面板，再把窗口改回 390 宽。
