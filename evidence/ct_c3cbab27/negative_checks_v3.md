# check_mockups_v3.py 反向探针记录

由 `python -I evidence/ct_c3cbab27/run_negative_checks_v3.py design` 生成。每条变异只改临时副本（`$TMPDIR` 下拷一份 `mockups_v3/` 和检查脚本），然后对副本跑完整的 `check_mockups_v3.py`。基线必须退出 0；每条变异必须退出非 0，且输出里有对应断言的报错。

| 变异 | 退出码 | 结论 | 命中条数 | 脚本报出的对应断言（第一条） |
|---|---|---|---|---|
| 基线（不改） | 0 | 符合预期 | 1 | OK：9 个画面 × 2 尺寸 × 2 配色 = 36 张截图，全部断言通过 |
| 顶栏加回录音键 | 1 | 符合预期 | 36 | - [flow desktop 1280x800 light] 可见文本含「录音」：…PM 92 节拍器 ● 录音 作品 导出 小节 In… |
| 空音格里显示「∅」 | 1 | 符合预期 | 36 | - [flow desktop 1280x800 light] 可见文本含「∅」：…tro 1 小节 01 ∅ ∅ ∅ Verse 1… |
| 段落标签改回中文「主歌」 | 1 | 符合预期 | 26 | - [flow desktop 1280x800 light] 段落标签不是英文 Intro/Verse/Hook/Bridge/Outro：「主歌」 |
| 一格两种颜色（韵脚字换成别的色相） | 1 | 符合预期 | 198 | - [paint desktop 1280x800 light] 一格一种颜色：第 2 小节第 2 拍：格里有两种颜色（色相 151° 和 269°） |
| 空音画成和拖音一样的横条 | 1 | 符合预期 | 36 | - [flow desktop 1280x800 light] 空字格样式：hold 和 rest 分不清（none/bar/rgb(140, 149, 163) vs none/bar/rgb(140, 149, 163)） |
| 字不按 tick 摆（落点比例算错） | 1 | 符合预期 | 252 | - [flow desktop 1280x800 light] tick 落点：第 1 小节第 4 拍 tick 24：左边偏 -11.3px |
| 三连不标「3」 | 1 | 符合预期 | 58 | - [flow desktop 1280x800 light] 三连标记：第 4 小节第 1 拍：三连但没有「3」 |
| 去掉格底 16 分刻度线 | 1 | 符合预期 | 252 | - [flow desktop 1280x800 light] 16 分刻度线：第 1 小节第 1 拍：刻度线 0 条 |
| 字下面加下划线 | 1 | 符合预期 | 224 | - [paint desktop 1280x800 light] 下划线：第 1 小节第 4 拍 用了下划线 |
| 押韵落到格内第一个字 | 1 | 符合预期 | 202 | - [paint desktop 1280x800 light] 韵脚位置：第 2 小节第 2 拍：带色的字不是格内最后 1 个字（现在 ■□□） |
| 涂了色没写字的格子不显示韵母占位 | 1 | 符合预期 | 32 | - [paint desktop 1280x800 light] 韵脚位置：第 6 小节第 4 拍：空着的韵脚位置没显示韵母「u」 |
| 手机押韵抽屉不展开 | 1 | 符合预期 | 4 | - [drawer mobile 390x844 light] 抽屉展开：高度 56px，不到半屏 |
| BPM 弹窗只剩一个选项 | 1 | 符合预期 | 4 | - [beat desktop 1280x800 light] BPM 弹窗：应该正好两个选项，现在 1 个 |
| 静态画面的工具条露出「AI 润色」按钮 | 1 | 符合预期 | 14 | - [paint desktop 1280x800 light] AI 文案不在「接入后」框里：AI 润色 |
| 锁定的格子没有斜纹 | 1 | 符合预期 | 12 | - [lock desktop 1280x800 light] 锁定：没有整行锁（4 格都锁、行头有锁标记）（整行锁 []，行头锁 ['3']） |
| 「允许改 flow」默认打开 | 1 | 符合预期 | 8 | - [ai desktop 1280x800 light] AI 润色：「允许改 flow」应该默认关着（{'checked': 'true', 'accentish': True}） |
| 被拒的 AI 结果还是上了屏 | 1 | 符合预期 | 4 | - [ai_reject desktop 1280x800 light] AI 被拒：表格内容和完整稿不一致（被拒的结果不能上屏） |
| 可重做的步骤和已做的步骤样式一样 | 1 | 符合预期 | 4 | - [history desktop 1280x800 light] 撤销/重做：可重做的步骤和已做的步骤样式一样 |
| 导唱块数和字位数对不上（漏掉三连） | 1 | 符合预期 | 4 | - [flow desktop 1280x800 light] 导唱：导唱块 83 个（可见 83），字位 89 个，应该一样多 |
| 拿掉撤销键 | 1 | 符合预期 | 40 | - [flow desktop 1280x800 light] 撤销/重做：撤销键 0 个、重做键 1 个可见（≥28px），两个都要有 |
| 多出第二个播放键 | 1 | 符合预期 | 36 | - [flow desktop 1280x800 light] 播放键：可见的播放键有 2 个，应该正好 1 个 |
| 强调色改成紫色 #7C3AED | 1 | 符合预期 | 36 | - [flow desktop 1280x800 light] 强调色是紫色：--ab-accent rgb(124, 58, 237) 色相 262° |
| 段落名加 text-transform:uppercase | 1 | 符合预期 | 80 | - [flow desktop 1280x800 light] 用了 text-transform:uppercase：b. "Intro" |
| 引一个外网字体 | 1 | 符合预期 | 4 | - [full desktop 1280x800 light] 外网请求：https://fonts.googleapis.com/css2?family=Inter |
| 页面底色写死白色（深色失效） | 1 | 符合预期 | 18 | - [flow desktop] 深色模式没生效：深色页底不比浅色暗 |

共 25 条变异 + 1 条基线。结论：全部符合预期。
