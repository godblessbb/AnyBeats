# ct_e0a570a2 报告：AnyBeats 作为 Agent 的设计稿

本单只出稿。交付物是 `design/AGENT_DESIGN.md`（约 70 KB），本目录是它的证据。

## 1. 改了什么

| 路径 | 是什么 |
|---|---|
| `design/AGENT_DESIGN.md` | 设计稿本体 |
| `evidence/ct_e0a570a2/check_citations.py` | 引用回查脚本（只读） |
| `evidence/ct_e0a570a2/citations.tsv` | 稿里 190 处 `文件:行号` 和那一行应当出现的字样 |
| `evidence/ct_e0a570a2/symbols.tsv` | 稿里提到的 97 个函数 / 常量和它们所在的文件 |
| `evidence/ct_e0a570a2/planned_paths.txt` | 稿里 13 个「实施单要新建」的路径（今天必须还不存在） |
| `evidence/ct_e0a570a2/probe_checker.py` | 回查脚本的自检：故意改坏，看它会不会红 |
| `evidence/ct_e0a570a2/report.md` | 本文件 |

没有改 `src/`、`e2e/`、`backend/`、`package.json`、`package-lock.json`，没有改 Alphie 仓库（`/opt/Alphie` 全程只读）。没有提交、没有推送。

## 2. 合同的两条验收命令

```
$ test -s design/AGENT_DESIGN.md; echo $?
0
$ git diff --exit-code $(git merge-base main HEAD) -- src/ e2e/ backend/ package.json package-lock.json; echo $?
0
$ git merge-base main HEAD
a559371f08a8b20a2e06fd6ae8f82b10a737d145
$ git status --short
?? design/AGENT_DESIGN.md
?? evidence/ct_e0a570a2/
```

以上是第一段交回时的输出。第一段结束后平台把这两项存档成了提交 `2f560fd`（`contract seg 1`，平台存的，不是我提交的）。第二段重跑：两条命令仍然都是退出码 0；`git diff --stat $(git merge-base main HEAD) HEAD` 只有 `design/AGENT_DESIGN.md` 和 `evidence/ct_e0a570a2/` 下的 6 个文件，共 7 个。

仓库里没有找到 pre-commit 钩子的配置（没有 `.pre-commit-config.yaml`、`.husky/`、`.githooks/`，`core.hooksPath` 没设），所以钩子这一项我自己没法预跑，以平台跑的结果为准。

## 3. 引用回查

```
$ python3 evidence/ct_e0a570a2/check_citations.py; echo exit=$?
AnyBeats /root/.alphie/coding_tasks/ct_e0a570a2/ws @ 2f560fd7
Alphie   /opt/Alphie @ d16cdc77
1. citations.tsv：190 行
2. 设计稿里带行号的引用：190 处（去重后）
3. 设计稿里不带行号的路径：47 个（存在 34，计划新建 13）
4. symbols.tsv：97 个定义

全部核对通过
exit=0
```

（`2f560fd7` 是平台的存档提交，`src/` 和 `a559371` 逐字节相同——第 2 节的第二条验收命令证明的就是这个。）

它做四件事，任何一件不过退出码 1：

1. `citations.tsv` 每一行：那个文件的那一行里确实有期望的字样。
2. 稿里每一处带行号的引用都在表里；表里多出来没被稿用到的也报。
3. 稿里每个不带行号的路径要么存在，要么登记在 `planned_paths.txt`（登记的路径今天必须不存在）。
4. `symbols.tsv` 每一行：那个文件里确实有这个定义。

### 这个脚本证明了什么、没证明什么

- 表里的「期望字样」是从实际那一行截出来的（去首尾空白后的前 60 个字符）。所以脚本单独跑绿，只说明「行号今天指向的还是当初核对的那一行」「稿里没有表外的引用」「提到的文件和函数都在」。
- 「那一行说的是不是稿里那个意思」是人工做的：`--dump` 把每处引用对应的实际那一行打出来，逐行对着稿里的说法看。这一步改掉了 17 处（§5）。
- 稿里对平台行为的**叙述**（例如「加载器只在 dev 加载」）靠的是读代码，脚本只钉住了被引用的那一行还在。

### 回查脚本自己会不会红

```
$ python3 evidence/ct_e0a570a2/probe_checker.py; echo exit=$?
过	对照组（不改）	退出码 0	全部核对通过
过	表里行号 +1	退出码 1	- anybeats:src/core/aiEdit.ts:27 这一行里没有 'export function planRhymeFill(grid: Grid, ctx: LockContext):'（这段字样实际在第 26 行）；实际是：const bars = allBars(grid);
过	稿里行号写错	退出码 1	- 设计稿引用了 src/core/rhymeRules.ts:85，citations.tsv 里没有这一行
过	稿里写了不存在的平台文件	退出码 1	- 设计稿里的路径 scripts/usage_attribution_guards.py 在 alphie 仓库里不存在，也不在 planned_paths.txt 里
过	函数名写错	退出码 1	- symbols.tsv: anybeats:src/core/aiEdit.ts 里没有 'export function planRhymeFil1('
过	计划新建的文件已经存在	退出码 1	- planned_paths.txt 说 src/core/aiGate.ts 是要新建的，但它已经存在了

自检通过：对照组是绿的，5 个探针都让回查器转红
exit=0
```

探针只改临时目录里的工作区副本，跑完即删。

## 4. 平台仓库在写稿期间往前走了三次

| Alphie HEAD | 提交说明 | 对本稿的影响 |
|---|---|---|
| `56003dcd` | 开始调研时 | — |
| `3ae44073` | 量化唤醒：被拒的工具调用退回模型重写 | 引用到的文件没动 |
| `a24479ca` | 重写 `skills/agent_creation.md`（v5） | **有关**：新文档把 AnyBeats 当例子，写明这类 Agent 要有确定性的代码检查、唯一写入口、检查代码跟着 Agent 走；并写明代码包路线不是常规路线、代码放哪必须先问用户。已写进稿子（§1.4、§3.3、Q1、§6.1） |
| `d16cdc77` | 容器车道：quant-engine 加进自动重建名单 | 引用到的文件没动；回查脚本在这一版上全绿 |

稿里的行号是 `d16cdc77` 这一版的。实施单开工前先跑一遍回查脚本。

回查脚本读的是 `/opt/Alphie` 工作树里的文件。那棵工作树上有别的会话留下的未提交改动（`.mcp.json`、`experiments/chat_canvas_glass/` 等，不是本单的），所以另外核对了一遍：稿里引用到的 39 个 Alphie 文件全部是已跟踪文件，而且没有未提交改动（`git status --short -- <这 39 个文件>` 输出 0 行）——读到的就是 `d16cdc77` 提交里的内容。

## 5. 人工核对时改掉的 17 处

| # | 原来写的 | 改成 | 原因 |
|---|---|---|---|
| 1 | `web/services/agent_packages.py:146`（名单校验） | `:170` | 行号指错了行 |
| 2 | 清单字段那一行只引了一处；`_PREFIX_RE` 写 `:55` | 加 `:162`；`:56` | 少引、差一行 |
| 3 | `docs/agent_code_package_design.md:339` | `:340` | 差一行 |
| 4 | `experiments/agent_code_placement/design.md:197`、`:199` | `:195`、`:197` | 差两行 |
| 5 | 包目录「目录 0755、文件 0644」 | 「属主 root，组和其他人不可写；包根本身只有 root 进得去」 | 代码里的说明是包根 `root:root 0700`，原来的模式位是我凭印象写的 |
| 6 | `security/package_trust.py:113` 一处 | 另加 `:67`（见符号链接就拒的那一行） | 说法落在另一个函数里 |
| 7 | `web/auth.py:612` | `:613` | 差一行 |
| 8 | `src/components/ExportPanel.tsx:19` | `:20` | 差一行 |
| 9 | 自动起标题先例 `web/routes/agents.py:1737`–`1738` | `:1739` | 指到了注释 |
| 10 | 用量归属闸 `scripts/usage_attribution_guard.py:47` | `:17`、`:20` | 判据的定义在文件头 |
| 11 | `CLAUDE.md:40` | `:46`，另加 `:45` | 行号错；而且 `:45` 那一行说「用户的歌」归用户本机，和我的推荐方向相反，必须写出来（Q6 的 C 选项由此而来） |
| 12 | `scripts/capability_contract.py:1699` | `:1698` | 差一行 |
| 13 | `design/DESIGN_v3.md:120` | `:121`、`:127` | 文案在另外两行 |
| 14 | 「已写了字的格子跳过是你在 v3 稿里选定的做法」 | 「v3 稿拍板题 3 推荐、v3 实现照做的做法，本单的合同里也是这样写的」 | v3 稿里那只是推荐项，没有「你选定」的记录 |
| 15 | `src/ai/FakeProvider.ts:24` | `:23` | 差一行 |
| 16 | `src/core/locks.ts:80`（`lockedWordTicks` 里取韵脚位置） | `:79` | 第 80 行是 `return out;`。这一处回查脚本是绿的（表是照实际行截的），是人工看 `--dump` 才发现 |
| 17 | 「`applyRhymeFill` 和 `applyPolish` 里都没有调用任何押韵函数」 | 「AI 路径只拿 `rhymeSlots` 取位置，它算出的『押没押上』没有任何 AI 路径读」 | 原说法不准：`planRhymeFill` 调了 `rhymeSlots`（`src/core/aiEdit.ts:33`），只是不看结果里的 `ok` |

另有一处算错的数：§0 的总花费原来写 185–275 美元，按 §4 的表相加是 171–255，已改。

## 6. 实测项

### 6.1 构建产物比画布上限大

工作区没有 `node_modules`，没有在这里构建。量的是主检出里同一个提交（`a559371f`，工作树干净）已有的构建产物，只读：

```
$ git -C /root/.alphie/cloud_lane_repos/AnyBeats rev-parse --short=8 HEAD
a559371f
$ stat -c '%s' /root/.alphie/cloud_lane_repos/AnyBeats/dist/index.html
912611
$ gzip -c /root/.alphie/cloud_lane_repos/AnyBeats/dist/index.html | wc -c
398285
$ grep -n CANVAS_MAX_BYTES /opt/Alphie/agents/workspace_spec.py
288:CANVAS_MAX_BYTES = 512 * 1024
```

912,611 字节 > 524,288 字节。这份产物是默认开关构建的（录音、AI 都没打开），打开 AI 只会更大。

### 6.2 编辑器会说的消息协议，平台那一头没有

```
$ cd /opt/Alphie
$ git grep -l -F 'alphie.canvas.request'  → 0 个文件
$ git grep -l -F 'alphie.canvas.response' → 0 个文件
$ git grep -l -F 'alphie:cap:req'         → 1 个文件：docs/admin_channel_separation.md
```

编辑器那一头在 `src/ai/AlphieBridgeProvider.ts:21`–`22`。平台设计稿里设想的是另一套消息名（`alphie:cap:req`），也只在文档里，没有代码。

### 6.3 包根今天不存在

```
$ ls -ld /opt/alphie-agent-packages
ls: cannot access '/opt/alphie-agent-packages': No such file or directory
```

### 6.4 编辑器用到的、在隔离框里会受影响的浏览器接口

在 `src/`（不含测试）里搜 `localStorage|sessionStorage|indexedDB|getUserMedia|.download =|createObjectURL|type="file"|window.open|alert(|confirm(|prompt(|navigator.clipboard|document.cookie|serviceWorker`，真正的调用点只有这些：

```
src/storage/StorageAdapter.ts:68   createStorage(... = () => globalThis.localStorage)
src/storage/takeStore.ts:155       createTakeStore(... = () => globalThis.indexedDB)
src/audio/MicInputSource.ts:78     navigator.mediaDevices.getUserMedia({
src/components/ExportPanel.tsx:22  const url = URL.createObjectURL(blob);
src/components/ExportPanel.tsx:25  a.download = name;
src/components/ExportPanel.tsx:57  type="file"
src/components/TrackStrip.tsx:55   type="file"
src/audio/recorderWorklet.ts:47    URL.createObjectURL(new Blob([SOURCE], …))      （录音，默认不挂载）
```

没有 `window.open`、`alert / confirm / prompt`、剪贴板、`document.cookie`、service worker。

### 6.5 AI 改写函数今天被谁调用

```
src/engine/aiController.ts:94    planRhymeFill(doc.grid, doc)
src/engine/aiController.ts:120   buildPolishRequest(doc.grid, doc, new Set(scope), this.state.options)
src/engine/editorStore.ts:867    applyRhymeFill(this.grid, this.doc, answers)
src/engine/editorStore.ts:878    applyPolish(this.grid, this.doc, new Set(scope), options, result)
src/core/__tests__/locks.test.ts （唯一引用这几个函数的测试文件）
```

押韵比对函数 `finalsMatch` / `finalOfChar` 的非测试调用点只有 `src/core/rhymeRules.ts`（`rhymeSlots` 内部）和 `src/engine/rhymeSearch.ts`（找韵脚词）；`rhymeSlots` 结果里的 `ok` 只被 `mismatches` 读，后者只用于屏幕提示（`src/components/RulePanel.tsx:182`、`src/engine/view.ts:120`、`src/engine/editorStore.ts:978`）。AI 的两条写入路径不读它 —— 这就是稿里说「第 ④ 道今天没判」的依据。

`src/components/` 里没有 AI 面板的组件（`BpmDialog Chrome ExportPanel FlowPanel HistoryPopover icons LyricsGrid Menu RecordPanel RulePanel services TopBar TrackStrip`），AI 面板是 P4 要新做的。

### 6.6 稿里用到、脚本不查的三个平台入口

```
web/routes/admin.py:1370                 @bp.route('/api/admin/agent-packages/status', methods=['GET'])
scripts/install_agent_package_root.py:33 parser.add_argument("--check", …)
tasks/coding_task_merge.py:121           PACKAGE_SELFTEST_ARGS = ("-m", "web.services.agent_packages", "--selftest")
```

## 7. 没有验证的（稿里都标了【推测】）

| 说法 | 为什么没验证 | 哪一步验证 |
|---|---|---|
| 隔离框首次加载靠浏览器自带的登录 cookie | 本机没有 Playwright + Chromium | P2b 浏览器验收 |
| 隔离框里触发下载会被浏览器拦 | 同上 | P2b |
| 隔离框里选本机文件可用 | 同上 | P2b |
| 一次调用约 0.001 美元、最坏三次约 0.003 美元 | 按价目表和估计的 token 数算的，没有真调模型 | P4 的 30 条样例实测 |
| dev 上「按函数读工作区」怎么实现 | 今天只有路由层整个转交 prod 的读法，门面那一段要平台单来定 | P3a |
| 哪些 Agent 工具写得到工作区里的作品文件 | 没有逐个核对工具；只确认了平台有「后台任务产物交回工作区」这条路径 | P2b 建 Agent 配置时 |

估价（§4）是量级判断，没有依据可以回查。

## 8. 调研怎么做的

拆了 4 个只读调研子 agent，各读 Alphie 仓库的一块：包加载器现状；Agent 页面托管与沙箱；模型调用与计费；分享、存储、驻留。子 agent 只读不改，结论都由主会话回到代码里逐条核对后才写进稿子（§3、§5 的回查就是这一步）。两条验收命令和回查脚本都是主会话自己跑的。

没有读 `/opt/Alphie/data/`、任何用户数据目录、`.env` 或进程环境变量。

## 9. 工作区之外的证据目录

平台的证据目录是 `/root/.alphie/coding_tasks/ct_e0a570a2/evidence/`（不在仓库里）。第一段只往里放了两份脚本输出，没有放 `.md`，平台核对交付时指出了这一点。第二段补齐，没有改设计稿和脚本：

| 文件 | 是什么 |
|---|---|
| `report.md` | 本文件的副本 |
| `AGENT_DESIGN.md` | 设计稿的副本，和仓库里的 `design/AGENT_DESIGN.md` 逐字节相同（`cmp` 退出码 0）。以仓库里那一份为准 |
| `check_citations_output.txt` | 回查脚本的最终输出 |
| `probe_checker_output.txt` | 回查脚本自检的最终输出 |
| `expected_paths.txt` | 开工时声明的预计改动路径 |
