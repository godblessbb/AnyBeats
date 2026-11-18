# ct_21f725ec 报告：AnyBeats v3.4 设计稿（写词页画笔模式 / 歌词页 / 十三辙）

只出稿，没改 `src/`、`e2e/`、`backend/`、`package.json`、既有设计稿和既有检查脚本。

## 交付
- `design/DESIGN_v34.md`：设计说明（v3.3 作废 / 保留清单、写词页、歌词页、十三辙、存档、AI 检查影响、冲突 16 条、拍板题 9 道、实现分 4 段）
- `design/mockups_v34/`：5 个画面（write / paint / side / lyrics / rhyme13）；`app.css`、`index.css` 是 `src/App.css`、`src/index.css` 的逐字节拷贝，新增样式只在 `v34.css`
- `design/fixtures_v34/`：v4 样例原样拷贝 + pinyin-pro 3.29.5 逐字拼音表 + 生成脚本
- `design/check_mockups_v34.py`：浏览器实测检查 + 19 条反向探针
- `design/screenshots_v34/`：20 张 2 倍像素截图

## 验收命令结果（本地跑）
- `/opt/Alphie/.venv/bin/python -I design/check_mockups_v34.py design` → 退出码 0
- `test -s design/DESIGN_v34.md` → 通过
- `git diff --exit-code $(git merge-base main HEAD) -- src/ e2e/ backend/ package.json design/AGENT_DESIGN.md design/DESIGN_v32.md design/DESIGN_v33.md design/mockups_v32/ design/mockups_v33/ design/check_mockups_v33.py` → 无差异

## 检查脚本完整输出
```
样例：122 行歌词、117 个韵脚位置、十三辙下 6 种颜色；对比段旧规则不押 桌面 6 / 手机 2，全曲 56
✓ write_desktop_light
✓ write_desktop_dark
✓ write_mobile_light
✓ write_mobile_dark
✓ paint_desktop_light
✓ paint_desktop_dark
✓ paint_mobile_light
✓ paint_mobile_dark
✓ side_desktop_light
✓ side_desktop_dark
✓ side_mobile_light
✓ side_mobile_dark
✓ lyrics_desktop_light
✓ lyrics_desktop_dark
✓ lyrics_mobile_light
✓ lyrics_mobile_dark
✓ rhyme13_desktop_light
✓ rhyme13_desktop_dark
✓ rhyme13_mobile_light
✓ rhyme13_mobile_dark
20/20 个组合通过
反向探针（故意改坏，检查必须报错）：
  ✓ [paint desktop] 模式提示藏起来 → 看不到「涂色」模式提示
  ✓ [paint desktop] 模式提示换成别的颜色（和按下的色块不一致） → 模式提示的颜色 150° ≠ 按下的色块 340°
  ✓ [paint desktop] 模式提示被一块浮层盖住一角 → 涂色模式提示 有一角被挡住了（378,131 处是 DIV）
  ✓ [paint mobile] 手机上「完成」按钮缩成 24px 高 → 手机上「完成」按钮太小（24px）
  ✓ [paint desktop] 涂色时还留着改字气泡（同一次点击两种意思） → 涂色时不该有光标方格 / 改字气泡
  ✓ [write desktop] 模式提示的字被截掉（溢出） → 文字「打字」溢出了 B
  ✓ [write desktop] 工具条上一段字挪到精度按钮上（重叠） → 文字重叠：「1/16」和「韵脚颜色一直显示」
  ✓ [write mobile] 光标方格被底部气泡挡住 → 光标方格被气泡 / 抽屉挡住了
  ✓ [write desktop] 一个不是韵脚位置的字被标成韵脚 → 第 4 小节 tick 576：不该是韵脚却标了韵脚
  ✓ [side desktop] 选区框往下偏了 30px → 选区框没有正好框住选中的格子
  ✓ [lyrics desktop] 歌词页一个韵脚字换了颜色（和写词页不一致） → 歌词页「跳」的颜色 rgb(200, 30, 30) ≠ 写词页同一种颜色的韵脚字 rgb(130, 23, 59)
  ✓ [lyrics desktop] 多高亮了一行 → 高亮的行应该正好 1 行，现在 2
  ✓ [lyrics desktop] 一行歌词少了一个字 → 第 11 行应该是第 12 小节「假装是偶遇其实排练了上千遍」，现在是第 12 小节「假装是偶遇其实排练了上千」
  ✓ [lyrics desktop] 复制按钮藏起来 → 「复制全部」按钮 看不见（尺寸为 0）
  ✓ [rhyme13 desktop] 十三辙那张表多了一处「不押」 → 十三辙还有 1 处「不押」
  ✓ [rhyme13 desktop] 旧规则那张表的「不押」全被抹掉 → 旧规则一处「不押」都没有
  ✓ [rhyme13 mobile] 手机上第二张表被往下挤到抽屉底下 → 新规则那张表的最后一格被挡住了
  ✓ [write mobile] 列头层级改回现网的 4（往上滚的字压在列头上） → 第 6 小节的「心」压在粘住的列头上面
  ✓ [write desktop] 页面加一个超宽元素（左右溢出） → 页面左右溢出：scrollWidth 2000 > 1280
反向探针 19/19 条咬住
```
