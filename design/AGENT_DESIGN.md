# AnyBeats 作为 Alphie 的一个 Agent：私有代码包设计稿

- 任务：ct_e0a570a2。**本单只出稿**，不改 `src/`、`e2e/`、`backend/`，也不改 Alphie 仓库。
- 状态：待拍板。§5 的 10 道题定了以后，§4 的每一步都可以直接派实施单。
- 基点：AnyBeats `a559371`（v3）；Alphie `d16cdc77`（回查脚本最后一次全绿时的 HEAD，`/opt/Alphie`，只读）。
- 路径约定：`src/…`、`design/…`、`e2e/…`、`evidence/…`、`agent/…`（计划新建）、`vite.config.ts`、`package.json` 指 **AnyBeats 仓库**；其余路径（`web/…`、`agents/…`、`config/…`、`scripts/…`、`security/…`、`tasks/…`、`skills/…`、`docs/…`、`experiments/…`、`CLAUDE.md`）指 **Alphie 仓库**。
- 标记：【实测】= 本单在这台机器上跑命令 / 读代码得到的；【引用】= 引自别的设计稿，本单只核对了原文在；【推测】= 没有验证，写明了留给哪一步验证。
- 每一处 `文件:行号` 都有回查脚本逐条核对（§8）。

---

## 0. 一页结论

**做成什么样**：Alphie 里多一个叫 AnyBeats 的 Agent。打开它的主页就是现在的编辑器；编辑器里多出「AI 填韵」「AI 润色」；作品存在你的 Alphie 账号下，不再只存在某一个浏览器里。

**怎么做到**：

1. AnyBeats 成为平台的一个**私有代码包**。包的源码放在**本仓库新增的 `agent/` 目录**（不另建仓库）：一小段服务端 Python（三组路由）、一个手写的小脚本（下面叫「桥」）、加上构建出来的编辑器单文件。装到 dev 机上只有 root 能写的目录里，由平台已经合并的加载器加载。平台仓库里一行 AnyBeats 专属代码都不加。
2. **编辑器整个放进隔离框**（和今天的 Agent 画布同一种框），框里的代码拿不到登录态。和平台说话只经过桥：桥只认固定的几种请求，只碰 AnyBeats 自己的接口。
3. **模型调用**：桥 → 包的路由 → 平台的模型出口。**谁点按钮谁付费，规则和聊天一样**；默认用平台默认模型 `deepseek-flash`，一次点击大约 0.001–0.003 美元【推测，P4 实测】。
4. **四道检查全部是程序判定，不靠模型自觉**，在前端「AI 结果上屏」的唯一入口执行。今天的代码里 ①③ 基本已有，② 有一个漏洞，④ 完全没有（§3）。检查不过 → 带着违规清单让模型重写，最多重写 2 次（一次点击最多调 3 次模型）→ 还不过就整份作废，表格一个字都不变。
5. **第一期只在 dev 这台机器上有带 AI 的编辑器**。加载器今天只在 dev 这类机器上加载包（`web/services/agent_packages.py:485`），prod 上没有。要在 prod 上用、或者让别人装了副本也有编辑器，是单独的一步（P5）。**如果你平时只从 prod 打开 Alphie，请在 Q2 告诉我，P5 就从可选变成必做。**

**和已有设计最要紧的三处不一致**（§6.2 一共列了 7 处，每处都写了去向；这三处都放进了拍板题）：

- 代码包设计稿要求「每个包一个单独的私有仓库，仓库检出就是包目录」。本稿改成「源码在 AnyBeats 仓库里，包目录是导出 + 构建出来的干净副本」（Q3）。
- 容器方案把页面里的「父页面代理」当成平台通用件（还没实现）。本稿先在包里放一个 root 写的小桥（Q4）。
- 合同里写「AnyBeats 进名单后插口从 proposed 变 open」。但按容器方案，量化已经不再是代码包的使用者（T7 的理由原话；T7 本身还没拍板），名单里那一行 `quant` 背后没有真的包，照合同的写法会让插口靠一个空名字「开」。本稿推荐同一单删掉 `quant` 行、插口保持 `proposed`（Q9）。

**花费**（模型花费量级，不含人验收）：P1–P4 合计约 **171–255 美元**（§4 表里 P1、P2a、P2b、P3a、P3b、P4 六行相加），其中改 Alphie 仓库的部分约 36–55 美元。P5（上 prod / 分享）另加 30–50，P6（录音）另加 40–60。

**要你拍板的 10 题**（§5 有选项、推荐和依据）：

| 题 | 一句话 | 推荐 |
|---|---|---|
| Q1 | 走哪条路让编辑器调得到模型 | 私有代码包 |
| Q2 | 第一期在哪用 | 先只在 dev，跑通后再定 prod |
| Q3 | 包的代码放哪 | 本仓库 `agent/` 目录 |
| Q4 | 页面里同源的那一小段代码怎么办 | 包里放一个手写小桥，编辑器进隔离框 |
| Q5 | 用哪个模型、谁付钱 | 平台默认模型，点按钮的人付 |
| Q6 | 作品存哪 | 这个 Agent 的工作区（跟账号走） |
| Q7 | 检查不过怎么办 | 自动重写最多 2 次，仍不过整份作废；填韵按格保留合格的 |
| Q8 | 服务端要不要再做一遍四道检查 | 现在不做 |
| Q9 | 名单里 `quant` 那一行和插口状态 | 同单删 `quant`，插口保持 proposed |
| Q10 | 录音进不进 Agent 版 | 本期不做 |

---

## 1. 现状（都是读代码得到的）

### 1.1 AnyBeats 今天是什么

| 事实 | 依据 |
|---|---|
| 纯前端。构建产物是一个把 JS / CSS 全部内联的 `index.html` | `vite.config.ts:10`（`inlineIntoHtml`）。主检出里的构建产物 912,611 字节（gzip 后 398,285）【实测】 |
| AI 的两种改写（一次填韵、选区润色）逻辑已经写好，但入口默认不挂载 | `src/core/aiEdit.ts:26`、`src/core/aiEdit.ts:122`；开关 `src/main.tsx:29` |
| 编辑器已经会说一种「问宿主要能力」的消息协议，但**宿主那一头今天不存在** | `src/ai/AlphieBridgeProvider.ts:21`、`src/ai/AlphieBridgeProvider.ts:24`；在 Alphie 仓库里搜 `alphie.canvas.request` 是 0 命中【实测】 |
| 作品存在浏览器 localStorage；在隔离框里拿不到 localStorage 时自动退成「只在内存里」 | `src/storage/StorageAdapter.ts:68`、`src/storage/StorageAdapter.ts:76`；键名 `src/storage/library.ts:23` |
| 界面里没有 AI 面板组件，只有视觉稿 | `src/components/` 下没有 AI 面板【实测】；视觉稿 `design/mockups_v3/ai.html`、`design/mockups_v3/ai_reject.html`、`design/mockups_v3/paint.html`；文字说明 `design/DESIGN_v3.md:103`、`design/DESIGN_v3.md:114` |
| 四道检查相关的现有函数只有一个测试文件覆盖，`aiEdit` 没有专门的测试文件 | `src/core/__tests__/locks.test.ts:177`（一次填韵）、`src/core/__tests__/locks.test.ts:258`（选区润色）【实测：全仓库只有这一个测试文件引用这些函数】 |

### 1.2 普通 Agent 的页面为什么调不了模型

普通 Agent 只是一份配置。它的主页能放三种东西：

| 放法 | 隔离方式 | 能不能调平台模型 | 依据 |
|---|---|---|---|
| 声明式页面（平台自己画） | 平台代码 | 不涉及 | `web/static/js/modules/workspace-renderer.js:325` |
| 画布（主人上传的 HTML） | `sandbox="allow-scripts"` 的不透明源框，应答头再加一层 | 不能：框里拿不到登录态，也没有人替它转发 | `web/static/js/modules/workspace-sanitize.js:122`、`web/routes/agents.py:2907` |
| 外部主页（别的站上的 https 页面） | 另一个站点的框，平台不往里送任何登录信息 | 不能 | `web/static/js/modules/workspace-renderer.js:263`、`agents/shell_declaration.py:205` |

另外画布单个文件上限 512 KB（`agents/workspace_spec.py:288`），AnyBeats 构建产物 912,611 字节，**画布放不下**【实测】。

### 1.3 私有代码包加载器今天的样子（已合并，但一个真包都没装）

| 事实 | 依据 |
|---|---|
| 名单里只有 `quant` 一个名字；清单里的 `name` 不在名单里就拒载 | `config/agent_packages.py:25`、`web/services/agent_packages.py:170` |
| 只在 dev 这类机器（`local_node`）加载；prod 一律不加载 | `web/services/agent_packages.py:485`、`config/identity.py:62` |
| 包根 `/opt/alphie-agent-packages` 在 dev 上**还没建**【实测：目录不存在】；没有包根时什么都不装 | `config/paths.py:807`、`web/services/agent_packages.py:490`；建根脚本 `scripts/install_agent_package_root.py:33` |
| 加载前逐项查「除了 root 谁都改不了」：属主、写权限、符号链接、硬链接、特殊文件，`.git/` 也一并查；任何一项不过就不加载 | `security/package_trust.py:113`、`security/package_trust.py:159` |
| 包只能用平台门面里导出的 7 样东西；**没有**「调模型」「取当前用户的 Agent」「读写工作区」 | `web/services/agent_package_api.py:18`、`web/services/agent_package_api.py:22` |
| 清单认得的字段是固定的，多写一个就拒载；路由前缀必须以 `/api/` 开头；包里不许自己起定时器 | `web/services/agent_packages.py:52`、`web/services/agent_packages.py:53`、`web/services/agent_packages.py:162`、`web/services/agent_packages.py:56`、`web/services/agent_packages.py:320` |
| 包的前端：平台按「Agent id 的基名」找包里的模块，加载包的 `static/` 下的 JS，然后调 `window[函数名](容器 id, agent id)` | `web/services/agent_packages.py:276`、`web/static/js/modules/workspace-renderer.js:173`、`web/static/js/modules/workspace-renderer.js:182`、`web/static/js/modules/workspace-renderer.js:204` |
| 包的 `static/` 由 `/pkg-static/<包名>/…` 送出，**不带隔离应答头** → 放在那里的 HTML 被直接打开时会以应用的源运行 | `web/services/agent_packages.py:62`、`web/services/agent_packages.py:256` |
| 没装包的机器上，这个 Agent 的页面照常画它自己的声明式页面，不报错 | `web/static/js/modules/workspace-renderer.js:79`（表是空的就什么都不换） |
| 插口 `agent_code_package` 今天是 `proposed`，金丝雀是 `quant`；闸按名单里的名字个数数实现者 | `scripts/capability_contract.py:429`、`scripts/capability_contract.py:434`、`scripts/capability_contract.py:435`、`scripts/capability_contract.py:1632` |

### 1.4 既有设计各自停在哪

| 稿子 | 和本稿有关的结论 | 状态 |
|---|---|---|
| 代码包设计稿 `docs/agent_code_package_design.md`（下称 **A 稿**） | 包的形状、信任校验、门面规则（加导出 = 小版本 +1，`docs/agent_code_package_design.md:340`）、每个包一个私有仓库（`docs/agent_code_package_design.md:440`） | 加载器 P1 已合并；量化迁包（P2 起）停着 |
| 放置稿 `experiments/agent_code_placement/design.md` | 两条轴：root 写的私有代码可以进 Flask 进程；浏览器里同源的脚本只能由平台同信任级的人写；不透明源框谁写都行（`experiments/agent_code_placement/design.md:46`–`48`）。实测同源脚本读得到登录凭证、不透明源框读不到（`experiments/agent_code_placement/design.md:195`、`experiments/agent_code_placement/design.md:197`） | 设计稿；推荐保留加载器给「root 写、要进程内加载」的包（`experiments/agent_code_placement/design.md:334`） |
| 容器方案 `experiments/agent_containers/design.md` | 私有 Agent 的页面 JS **必须**进不透明源框 + 父页面代理（`experiments/agent_containers/design.md:212`）；量化改走容器后加载器没有使用者，去留是拍板题 T7（`experiments/agent_containers/design.md:420`） | 设计稿；T7 还没看到拍板的记录——平台 11-16 的「创建 Agent」技能文档仍写着迁包停在这两份稿的待定题上（`skills/agent_creation.md:870`） |
| 「创建 Agent」技能文档 `skills/agent_creation.md`（11-16 重写） | 把 AnyBeats 当作「改用户自己内容的 Agent」的例子：写入被接受之前要有**代码里的确定性检查**（锁定不变、骨架不变、格式规则），而且「四道检查是这个 Agent 自己的代码，不在平台仓库里」（`skills/agent_creation.md:981`）。同一份文档要求：新的私有 Agent 需要服务端代码时，**停下来问用户代码放哪**，不要把代码包这条路当成例行做法（`skills/agent_creation.md:874`）；包的清单不能声明工具（`skills/agent_creation.md:865`） | 现行的平台指引 |
| 管理通道稿 `docs/admin_channel_separation.md` §5 | 另一条路：给画布开三种「能力」，其中 `agent.call` 让画布以主人身份给这个 Agent 发一条消息（`docs/admin_channel_separation.md:602`）。稿子里点名「AnyBeats 就是这样差点被塞进仓库」（`docs/admin_channel_separation.md:588`） | `proposed`，没实现 |
| 核心约束 15 `CLAUDE.md:62` | 一个 Agent 的专属代码落它自己的模块，不许往共用文件里加专属分支。扩成「私有 Agent 的代码不进平台仓库」是 A 稿 Q4 的提案（`docs/agent_code_package_design.md:577`），文字还没改 | 现行约束 + 待落地的扩展 |

---

## 2. 包的结构

### 2.1 路线：为什么是代码包

| 路线 | 能调模型吗 | 今天能做吗 | 代价 |
|---|---|---|---|
| **A. 私有代码包（本稿）** | 能：包的服务端在 Flask 进程里，经门面调平台模型出口 | 加载器已合并；缺门面的三个导出 + 名单一行 | 见 §4 |
| B. 画布 + 「画布能力原语」`agent.call` | 能，但走的是一整轮 Agent 对话（慢、贵、输出不受控） | 不能：原语没实现（管理通道稿 P7）；画布 512 KB 上限放不下编辑器 | 要先做平台的 broker，再解决体积 |
| C. 普通 Agent + 外部主页指向 `https://datode.com/anybeats/` | 不能 | 今天就能，零代码 | 没有 AI、没有录音，作品还在对方浏览器里 |

选 A。为了将来平台有了通用代理（B 路或放置稿的 N2）时能便宜地换过去，编辑器对宿主的全部依赖收在**一个文件**里（§2.3 的 `src/host/`），包里的桥也只有一个文件。

AnyBeats 的服务端代码**不进运行容器**：它是 root 执行的编程任务写的、几百行的路由，按放置稿的权限轴属于「root 写、可以进程内加载」那一格（`experiments/agent_code_placement/design.md:46`）；容器方案要隔离的是低权账号写的代码，而且 dev 今天没有容器运行时【引用：容器方案 T2】。

### 2.2 包仓库：就是本仓库，加一个 `agent/` 目录

**仓库里的源码**（实施单新增；本单不建）：

```
agent/
  alphie_package.json            清单
  alphie_pkg_anybeats/
    __init__.py
    routes.py                    一个蓝图：编辑器页面、作品存取、AI
    limits.py                    限流、一次操作的调用次数封顶（纯内存，不起线程）
  static/
    anybeats.js                  桥：手写、不依赖任何第三方库、目标 300 行以内
    anybeats.css                 只管把框撑满
  tests/                         pytest（路由）+ 桥的白名单测试
  install.py                     导出 + 构建 + 安装（root 跑）
  RUNBOOK.md                     安装 / 升级 / 回退手册（给主会话）
```

**装到机器上的包目录**（`/opt/alphie-agent-packages/anybeats/`；属主 root，组和其他人不可写；包根本身只有 root 进得去，`config/paths.py:807` 的说明）：

```
alphie_package.json
alphie_pkg_anybeats/__init__.py, routes.py, limits.py
alphie_pkg_anybeats/editor.html  构建出的编辑器单文件（约 0.9 MB），不放 static/
static/anybeats.js, anybeats.css
BUILD.json                       来自哪个提交、editor.html 的 sha256、构建时间
```

**清单草案**（字段名按加载器今天认得的写，`web/services/agent_packages.py:52`–`53`；P2 时 `min_minor` 是 0、`requires` 只有前三项，P3 起才加后面的）：

```json
{
  "schema": 1,
  "name": "anybeats",
  "platform_api": {"major": 1, "min_minor": 1},
  "deployments": ["local_node"],
  "agents": {"module_base": "anybeats"},
  "requires": ["auth.require_auth", "errors.safe_route", "ui_text.say",
               "agents.owned_agent", "workspace.files", "model.chat_once"],
  "blueprints": [{"object": "alphie_pkg_anybeats.routes:bp", "url_prefix": "/api/anybeats"}],
  "frontend": {"js": "static/anybeats.js", "css": "static/anybeats.css",
               "render": "renderAnybeatsWorkspace", "shared_deps": []}
}
```

**安装流程**（`agent/install.py`，root 跑，幂等；实施单产出脚本和手册，真装由主会话按手册做）：

1. 在 AnyBeats 主检出的一个已合并提交上构建：`VITE_ANYBEATS_HOST=alphie VITE_ANYBEATS_AI=1 npm run build`（`package.json:10`）。主检出里已有依赖和构建产物【实测】。
2. 把 `agent/` 里的文件和构建出的单文件拷进一个临时目录，写 `BUILD.json`，统一属主和权限，确认里面没有符号链接。
3. 把临时目录原子地换成 `/opt/alphie-agent-packages/anybeats/`（旧的改名留一份，回退用）。
4. 跑 `scripts/install_agent_package_root.py --check`（`scripts/install_agent_package_root.py:33`），退出码必须是 0。
5. 重启 Flask，看 `GET /api/admin/agent-packages/status`（`web/routes/admin.py:1370`）里 `anybeats` 是 `loaded`。

**为什么不照 A 稿把仓库检出直接当包目录**：

- 信任校验连 `node_modules` 里的符号链接也会拒（`security/package_trust.py:113` 走遍整棵树，`security/package_trust.py:67` 见到符号链接就拒），而前端构建离不开 `npm install`；构建产物又不进 git。所以「检出即包」对一个要构建的前端包走不通，无论如何都要有一步「构建后再装」。
- 四道检查是 TypeScript 写的，服务端路由要和它保持同一个版本。放在同一个仓库里，一次提交、一次审查。
- 省掉「你去 GitHub 建第二个私有仓库」这个外部动作。

A 稿选「单独仓库」的理由是「普通目录没有版本、没有回退、没有审查」（`docs/agent_code_package_design.md:571`）。本稿没有丢这三样：版本和审查在 AnyBeats 仓库的 git 和合并闸里；包目录只是某个已合并提交的确定性导出，`BUILD.json` 记着是哪个提交、哪份字节；回退 = 用上一个提交重装。差别只是「包目录本身不是 git 检出」。

### 2.3 编辑器怎么挂进 Agent 页

```
Agent 页（应用的源，带登录态）
 └─ 桥 anybeats.js（包的 static/，root 写，手写无依赖）
     ├─ 建一个 <iframe sandbox="allow-scripts" src="/api/anybeats/editor">
     ├─ 只听这个框发来的消息，只认固定几种请求
     └─ 用登录态去调 /api/anybeats/<这个 Agent>/…   ← 只有这一个前缀
          └─ 包的路由（Flask 进程内）→ 平台门面 → 模型出口 / 工作区
隔离框（不透明源，拿不到登录态、碰不到父页面）
 └─ 编辑器 editor.html（React + pinyin-pro + fflate，约 0.9 MB）
```

**编辑器页面怎么送出**：包的路由 `GET /api/anybeats/editor`（要登录），应答带和画布完全相同的三个头——`Content-Security-Policy: sandbox allow-scripts`、`X-Content-Type-Options: nosniff`、`Cache-Control: no-store`（先例 `web/routes/agents.py:2907`–`2909`）。这样即使有人把这个地址直接在新标签页打开，它也是在不透明源里跑。**不放进 `static/`**，因为 `/pkg-static/` 不带这个头（§1.3）。框的首次加载靠浏览器自带的登录 cookie（`web/auth.py:613`；登录页写 cookie 在 `web/templates/login.html:1035`），和画布今天的加载方式相同（`web/routes/agents.py:2888`）【推测：没有浏览器环境，P2 做浏览器验收】。

**桥的规则**（每条都是代码里的固定判断，P2 逐条有测试）：

1. 只处理 `event.source === 那个框.contentWindow` 的消息，其余丢弃。
2. Agent id 取自平台调渲染函数时传进来的参数（`web/static/js/modules/workspace-renderer.js:204`），**不取自消息**。
3. 请求种类是一张写死的表（下表），表外的一律回「不认得」。
4. 只拼 `/api/anybeats/<agent id>/…` 这一个前缀下的地址；键名、文件名按正则校验，长度有上限。
5. 登录凭证只放在桥自己发的请求头里，从不放进回给框的消息。
6. 不 `eval`、不把框给的内容当 HTML 插进父页面。
7. 同一时间只允许一个 AI 请求在途。

**消息协议**：沿用编辑器已经会说的那一种——`{type: 'alphie.canvas.request', id, capability, payload}` / `{type: 'alphie.canvas.response', id, ok, result | error}`（`src/ai/AlphieBridgeProvider.ts:21`–`22`），只是多几种 `capability`：

| capability | 桥做什么 | 包的路由 | 哪一步加 |
|---|---|---|---|
| `host.info` | 回「这是 Agent 版、哪些能力可用」 | — | P2 |
| `file.save` | 在父页面触发一次下载（文件名校验、扩展名白名单、类型固定为二进制流、大小上限） | — | P2 |
| `store.list` / `store.get` / `store.put` / `store.delete` | 读写作品 | `GET/PUT/DELETE /api/anybeats/<agent>/store…` | P3 |
| `worker.status` | 现在能不能用 AI（没登录 / 要自带 Key / 今天额度用完，各有一句话） | `GET /api/anybeats/<agent>/ai/status` | P4 |
| `ai.lyrics` | 调一次模型，回模型原文 | `POST /api/anybeats/<agent>/ai` | P4 |

**编辑器在隔离框里哪些东西会受影响**【实测：在 `src/` 里搜相关浏览器接口】：

| 编辑器用到的 | 代码位置 | 在隔离框里 | 处理 |
|---|---|---|---|
| localStorage | `src/storage/StorageAdapter.ts:68` | 抛错，已自动退到内存 | P3 换成「经桥存到工作区」的适配器 |
| 导出时的下载 | `src/components/ExportPanel.tsx:20` | 被浏览器拦【推测：隔离框没有下载许可；P2 浏览器验收】 | 改走桥的 `file.save` |
| 选本机文件（导入工程、换伴奏） | `src/components/ExportPanel.tsx:57`、`src/components/TrackStrip.tsx:55` | 可用【推测，P2 验收】 | 不改 |
| IndexedDB（录音的音频） | `src/storage/takeStore.ts:155` | 不可用 | 录音不在本期（Q10） |
| 麦克风 | `src/audio/MicInputSource.ts:78` | Chromium 对不透明源一律拒【引用：`docs/admin_channel_separation.md:600`】 | 录音不在本期 |
| 弹窗（alert / confirm）、开新窗口、剪贴板 | 没有用到 | — | — |

伴奏音频今天就不持久化（重开要重新选文件，`src/components/TrackStrip.tsx:46`），Agent 版保持一样。

**编辑器这边的改动收在一处**：新增 `src/host/`（实施单做），由构建开关 `VITE_ANYBEATS_HOST=alphie` 选用；不带这个开关构建出来的就是今天的静态版，一个字节的行为都不变。`src/main.tsx:12` 的 `createStorage()` 在 Agent 版里换成宿主适配器，`src/main.tsx:31` 的 AI 提供者照旧用 `AlphieBridgeProvider`。

**Agent 本体**：一份普通的 Agent 配置，id 的基名必须是 `anybeats`（平台按基名找模块，`web/static/js/modules/workspace-renderer.js:173`；装出来的副本后缀不同、基名相同，自动匹配）。它的页面外壳**不能**声明外部主页，否则外部主页优先、包的模块不会挂（`web/static/js/modules/workspace-renderer.js:333`）。它自己的声明式页面写一句「这台机器没装 AnyBeats 编辑器」加静态版链接——没装包的机器上显示的就是这个（§1.3）。聊天那一侧的提示词定位为「写词搭档」，**不给写文件类的工具**（§3.3 说明原因）。这份配置在 P2 由主会话按手册建，不进任何仓库。

### 2.4 模型调用走哪条路

```
点「AI 润色」
 → 编辑器拼提示词（已有 src/ai/prompt.ts:14）→ 桥 ai.lyrics
 → POST /api/anybeats/<agent>/ai  {op_id, task, system, user}
 → 包路由：登录 + 这个 Agent 是不是你的 + 限长 + 限流 + 同一 op_id 最多 3 次
 → 平台门面 chat_once(agent_id, …)                       ← 门面新增（平台仓库）
 → vendor_egress.admit(…, subject=当前用户, agent_id=核对过的 Agent)  → 模型
 → 模型原文回到编辑器 → parseAiLyrics（src/ai/AiProvider.ts:78）→ 四道检查（§3）
```

**门面要新增三个导出**（平台仓库的一张单；按 A 稿的规则这是小版本 +1，`web/services/agent_package_api.py:18` 从 `(1, 0)` 变 `(1, 1)`）。它们都是通用的，名字和实现里不出现 anybeats：

| 导出（清单里的名字） | 契约 | 平台里已有的积木 |
|---|---|---|
| `agents.owned_agent` | 给一个 Agent id 和包自己的基名：当前登录用户拥有它、且它的基名等于包的基名 → 放行；否则按「不存在」回 404 | 归属判断 `web/routes/agents.py:1389`；基名规则 `agents/shell_declaration.py:516` |
| `workspace.files` | 读 / 写 / 删 / 列这个 Agent 工作区里的文件。写：dev 上先交给 prod、成功后本机留缓存；设成「只在这台电脑上」的 Agent 一个字节都不出本机 | `web/services/agent_workspace_store.py:411`、`web/services/agent_workspace_store.py:139`、`web/services/agent_workspace_store.py:390`、`config/paths.py:1699` |
| `model.chat_once` | 以当前登录用户为付费方、记在这个 Agent 名下，调一次平台默认模型；被拒时回拒绝码和一句话 | `web/services/vendor_egress.py:341`；同形先例是「自动起标题」`web/routes/agents.py:1739` |

平台那张单要保证两道已有的闸继续是绿的：用量归属闸（`scripts/usage_attribution_guard.py:17`：调模型必须说得出是哪个 Agent 用的；`scripts/usage_attribution_guard.py:20`：这个 id 不能取自请求），以及模型出口的两条不变量 `scripts/capability_contract.py:569`、`scripts/capability_contract.py:591`。

「dev 上按函数读工作区」今天没有现成入口：读是在路由层整个转交给 prod 的（`web/services/agent_workspace_store.py:11` 一带的说明）。门面的 `workspace.files` 读要补这一段【推测：实现方式由平台单定，验收写「读回的是权威那一份」】。

**谁付费**：和聊天同一套规则，由 `vendor_egress.admit` 判（`web/services/vendor_egress.py:341`；判定函数 `web/routes/settings.py:504`）：

| 调用者 | 结果 |
|---|---|
| 自己配了这家模型的 Key | 用自己的 Key |
| 管理员 | 平台付，没有日上限 |
| Pro、没配 Key | 平台付，受每日上限管（`web/routes/settings.py:300`），超了就拒（`web/routes/settings.py:471`） |
| Free、没配 Key | 拒，提示要自带 Key（`web/routes/settings.py:472`） |

dev 上的用量先记在本机，每天补报给 prod（`docs/dev_as_client_data_ledger.md:154`）。

**用哪个模型**：平台默认模型 `deepseek-flash`（`web/models_config.py:551`；档位表里它属于「日常」档，`config/model_tiers.json:37`）。按高峰价每百万 token 输入 0.30 美元、输出 1.20 美元算（`web/models_config.py:96`–`97`），一次润色大约 2000 进 300 出，约 0.001 美元；最坏三次约 0.003 美元【推测】。**P4 用 30 条固定样例实测**首次通过率、三次内通过率、花费和耗时，通过率不够再决定要不要换档——那是门面再加一个参数的事，不影响结构。

没选的两条：

- 用「这个 Agent 在设置里选的模型」（`web/services/agent_model_channel.py:3245` 的 `complete_for`）：Agent 的通路可能是命令行那一类，一次要几十秒，配不上「点一下、最多重写两次」；而且温度是写死的（`web/services/agent_model_channel.py:308`），还要往一份共用名单里加条目（`web/token_tracker.py:141`）。
- 走一整轮 Agent 对话：更慢更贵，输出里会夹带闲话和工具调用。

**提示词在前端拼，服务端不解析歌词**。理由：编辑器已有拼提示词和解析结果的代码和测试（`src/ai/prompt.ts:14`、`src/ai/AiProvider.ts:78`），歌词的全部语义留在 TypeScript 一侧，不出现第二份实现。代价：`/api/anybeats/<agent>/ai` 的形状是「登录用户用自己的额度调一次默认模型」，和聊天能做的事相同，不多给什么；服务端用限长（系统词 + 用户词合计 16 KB、输出 800 token）、限流（每人每分钟 20 次）、同一次操作最多 3 次来兜住。**上 prod / 给别人用之前**（P5），再把拼提示词挪到服务端。

### 2.5 作品存哪

**存这个 Agent 的工作区**：`{DATA_ROOT}/users/<你>/agent_workspaces/<agent>/anybeats/`（`config/paths.py:1699`）。按核心约束 12 的口径这是「Agent 的产物」，归平台数据目录（`CLAUDE.md:46`）；平台只认 prod 上那一份，dev 上写的先交给 prod、本机留缓存（`web/services/agent_workspace_store.py:411`）。

- **形状**：编辑器的存储接口是「同步的键值表」（`src/storage/StorageAdapter.ts:10`）。一个键一个文件，键名就是今天 localStorage 的键名（`src/storage/library.ts:23`–`29`），工程格式一个字节都不变。
- **前端适配器**（P3）：启动时经桥取回索引和当前作品，放进内存；读走内存；写先进内存、同时交给桥。切换作品前先把那一首取回来。
- **不丢改动**：桥收到写请求就先记进父页面自己的一份待传清单（应用源的 localStorage，只放还没传成的），再节流上传——正文最多 20 秒一次，页面失焦 / 切走时立刻传；撤销历史 2 分钟一次。下次打开先把上次没传完的补传。节流的原因：prod 每写一次都留一份改前快照，而且不查存储额度（`web/services/agent_workspace_store.py:910`）。
- **两处同时改**：每个键带版本号，写的时候带上「我是基于哪一版改的」，对不上就不覆盖，把本地这一份另存成「<名字>（冲突副本）」。
- **上限**：单键 2 MiB（平台自己的上限是 50 MiB，`web/services/agent_workspace_store.py:44`），键的总数 2000。
- **旧作品**：线上静态版的作品在 `datode.com` 那个源的浏览器存储里，Agent 版读不到。P3 在静态版加「导出全部作品」、在 Agent 版加「导入」。
- **顺带的好处**：作品是工作区里的文件，聊天里的 AnyBeats Agent 读得到（dev 上的 Agent 工具从本机缓存读，`web/services/agent_workspace_store.py:9`），可以聊「帮我看看第二段」。

平台的通用写接口在 dev 上不收浏览器直接写（`web/routes/agent_workspace_api.py:37`），所以写必须经「包路由 + 门面」这条路，不能让桥直接调平台接口。

核心约束 12 的另一半说「用户的歌」这类个人项目归用户本机（`CLAUDE.md:45`）。作品到底算哪一种是产品取舍，放进 Q6。

### 2.6 分享给别人时，什么跟着走

按 Agent 包格式稿的分类（`docs/agent_package_format.md:30`）和分享代码的实际行为（`agents/agent_share.py:384`、`agents/agent_package.py:250`）：

| 东西 | 跟不跟 | 说明 |
|---|---|---|
| Agent 的配置（名字、简介、提示词、页面外壳、声明式页面） | 跟 | 「项目」类字段 |
| **代码包**（编辑器、桥、路由） | **不跟** | 包是 root 装在某一台机器上的，不是 Agent 配置的一部分。对方的机器 / prod 上没装包，对方看到的是那句「这台机器没装 AnyBeats 编辑器」加静态版链接 |
| 你的作品、撤销历史、录音 | 不跟 | 工作区归「用户数据」，分享不拷（`docs/agent_package_format.md:165`）；对方的副本从空的开始 |
| 聊天记录、记忆、Key | 不跟 | 用户数据 |
| 模型花费 | 各算各的 | 谁点谁付（§2.4） |

在装了包的机器上，副本的 id 基名相同，自动得到编辑器。设成「只在这台电脑上」的 Agent 不能分享（`agents/agent_residency.py:63`）。

**要让别人装了副本也有带 AI 的编辑器**，需要三件事：清单 `deployments` 加 `cloud`；平台放开加载器「只在 dev 加载」那一条（`web/services/agent_packages.py:485`）；在 prod 上装包（A 稿说这是一次显式动作，不经过日常发版，`docs/agent_code_package_design.md:349`）。这是 P5，取决于 Q2。

### 2.7 名单和插口

平台仓库要改的只有两类：`config/agent_packages.py:25` 的名单加一行 `"anybeats"`，以及门面的三个通用导出。AnyBeats 的专属代码一行都不进平台仓库——这比核心约束 15 的现行文字更严，和它要扩成的那句话一致。

插口状态怎么处理见 §6 的 C5 和 Q9。闸的规则是确定的（`scripts/capability_contract.py:1698`：标着 `proposed` 却数到 2 个 → 判红），所以实施单只需要照你对 Q9 的回答做，不用临场判断。

---

## 3. 四道程序检查

### 3.0 原则

- **判定只用程序**：输入是「改之前的表格」「模型给的结果」「锁、涂色、选区、开关」，输出是「过 / 不过 + 违规清单」。同样的输入永远得到同样的结果，不问模型、不看提示词写了什么。
- **唯一入口**：AI 的结果只能从 `EditorStore.applyAiFill`（`src/engine/editorStore.ts:866`）和 `EditorStore.applyAiPolish`（`src/engine/editorStore.ts:877`）进文档。四道检查就卡在这两个函数里。
- **不过就不上屏**：检查在候选稿上做，不过的话文档保持原来那个对象，不是「先写进去再撤销」。
- **判不出来算不过**：解析失败、位置不是整数、函数抛错，一律当违规。
- **上屏那一刻的判定才算数**：预览时判一次（决定要不要重写），用户点「用这一版」时对着当时的表格再判一次。

### 3.1 总表

| 检查 | 判据（程序怎么判） | 今天已有的 | 今天缺的 |
|---|---|---|---|
| ① 锁定的格子一个字都不变 | 逐个位置比改前改后：凡是锁定位置上的字或长度有变化 → 违规 | `checkChanges`（`src/core/locks.ts:114`）+ `lockedWordTicks`（`src/core/locks.ts:74`）；上屏时 `exec` 再查一遍（`src/engine/editorStore.ts:344`） | 「锁韵脚 + 允许改 flow」时在格子末尾加字能让韵脚位置换人（①b） |
| ② 没开「允许改 flow」时每个字的落点不动 | 改前改后「（位置，长度）」的集合必须完全相同 | `checkChanges` 的骨架判定（`src/core/locks.ts:114`，由 `keepSkeleton` 控制） | 开关的换算有漏洞：能出现「没开允许改 flow，却不查落点」的组合 |
| ③ AI 填韵只填空格、跳过已写字的格子 | 先由程序算出「允许填的位置」名单，名单外的任何改动 → 违规 | `planRhymeFill`（`src/core/aiEdit.ts:26`）+ `applyRhymeFill` 的白名单（`src/core/aiEdit.ts:53`） | 多个字被悄悄截成一个字；还没定韵母的颜色也被当成目标 |
| ④ 押韵按字面韵母严格比对 | AI 写进韵脚位置的每个字，字面韵母必须和这一位要押的韵母完全相同 | 比对函数已有：`finalOfChar`（`src/core/rhymeRules.ts:78`）、`finalsMatch`（`src/core/rhymeRules.ts:84`）、`rhymeSlots`（`src/core/rhymeRules.ts:290`） | AI 的两条路径今天只拿 `rhymeSlots` 取「韵脚位置在哪、要押什么」（`src/core/aiEdit.ts:33`），**它算出的「押没押上」没有任何 AI 路径读**——填进来的字押不押韵完全没判 |

### 3.2 逐道

#### ① 锁定的格子不变

**已有**。`checkChanges(before, after, opts)` 先比结构（小节数、段落数、小节顺序变了 → `structure`），再逐个位置比文字和长度：不在选区 → `outside`；位置在锁定集合里、或所在格子被锁 → `locked`。锁定集合由 `lockedWordTicks` 按**改之前**的表格算：整行锁、整列锁、单格锁里的每个字，加上「锁韵脚」打开时的全部韵脚位置（`src/core/locks.ts:74`–`81`）。四种锁的判断在 `isCellLocked`（`src/core/locks.ts:26`）。

上屏时还有第二道：`exec` 对任何非「锁定」类的操作再跑一次 `lockViolations`（`src/engine/editorStore.ts:356`），有违规就不执行。

**要补**：

- **①b 韵脚位置不许换人**。「锁韵脚」打开、又开了「允许改 flow」时，模型可以不碰原来的韵脚字，而是在同一格的末尾再加一个字——原来的字没变（①不报），但格子里「最后几个字」换了人，锁住的韵脚实际上不再是韵脚。判据：「锁韵脚」打开时，改前改后 `rhymeSlots` 给出的「（位置，字）」集合必须完全相同。
- `applyAiFill` / `applyAiPolish` 今天不看 `exec` 的返回值（`src/engine/editorStore.ts:872`、`src/engine/editorStore.ts:883`），第二道闸拦下时仍然回「成功」。改成把结果带出来。

测试现状：`src/core/__tests__/locks.test.ts:132`、`src/core/__tests__/locks.test.ts:141`、`src/core/__tests__/locks.test.ts:147`、`src/core/__tests__/locks.test.ts:289`。

#### ② 没开「允许改 flow」时落点不动

**已有一半**。`checkChanges` 在 `keepSkeleton` 为真时，任何位置上「多了字 / 少了字 / 长度变了」都报 `skeleton`。

**漏洞**：`keepSkeleton` 是这样算出来的——`!options.allowFlow && options.keepSkeleton`（`src/core/aiEdit.ts:151`，请求那边同样的式子在 `src/core/aiEdit.ts:115`）。界面的开关逻辑（`src/engine/aiController.ts:57`–`62`）允许把「保持骨架」单独关掉而不打开「允许改 flow」，于是得到「两个都是假」：没开允许改 flow，但落点也不查，而且结果按「整段替换」的路径写进去（`src/engine/aiController.ts:136`）。

**要补**：

- 判定只认一个开关：`allowFlow !== true` 就查落点，不再看 `keepSkeleton`。两个开关在界面上并成一个「允许改 flow」；走哪条写入路径也只看它。
- 没开允许改 flow 时再加三条：改动过的位置，新内容必须**恰好是一个字**（今天 `src/core/aiEdit.ts:134` 直接把模型给的整串写进去，不限长度）；原来有字的位置不许被清空（少一个音节等于改了 flow）；原来的空字位可以被填（落点是你铺的，没动）。

测试现状：`src/core/__tests__/locks.test.ts:155`、`src/core/__tests__/locks.test.ts:314`。

#### ③ 填韵只填空格

**已有**。`planRhymeFill` 只列出「涂了色、整格一个字都没写、没被锁」的格子里的韵脚位置（`src/core/aiEdit.ts:26`–`36`）。`applyRhymeFill` 在上屏时**对着当时的表格重新算一遍名单**，模型的回答里凡是不在名单上的位置一律记 `outside`，再用 `keepSkeleton: true` 跑 `checkChanges`（`src/core/aiEdit.ts:66`–`67`）；有任何违规就原样返回旧表格（`src/core/aiEdit.ts:70`）。「已写了字的格子跳过」是 v3 稿拍板题 3 推荐、v3 实现照做的做法（`design/DESIGN_v3.md:190`–`191`），本单的合同里也是这样写的。

**要补**：

- 模型给了多个字时，今天是悄悄截成第一个字（`src/core/aiEdit.ts:60`）。改成报违规（新原因「不是恰好一个字」）。
- 颜色还没定韵母的位置（要押的韵母是空的）今天也会进名单。这种位置第 ④ 道判不了，所以不作为目标，界面提示「这个颜色还没定韵母」。
- 生成期间你自己改了表格：请求发出时记一个文档版本，回来时版本变了就丢弃这次结果（原因「表格已经变了」），不重写、不上屏。

测试现状：`src/core/__tests__/locks.test.ts:196`、`src/core/__tests__/locks.test.ts:226`、`src/core/__tests__/locks.test.ts:236`、`src/core/__tests__/locks.test.ts:246`。

#### ④ 押韵按字面韵母严格比对

**今天没判**。AI 路径里 `rhymeSlots` 只被用来取位置：`planRhymeFill` 用它列「哪些位置要填、要押什么」（`src/core/aiEdit.ts:33`），`lockedWordTicks` 用它列「哪些位置是韵脚」（`src/core/locks.ts:79`）。它同时算出的「押没押上」（`src/core/rhymeRules.ts:309`）只有屏幕提示在读；`applyRhymeFill`（`src/core/aiEdit.ts:53`–`71`）和 `applyPolish`（`src/core/aiEdit.ts:122`–`154`）都不读。两者唯一的判定是 `checkChanges`（`src/core/locks.ts:114`），它只比位置、文字、长度，不比韵母。

**要补**（全部复用现成函数，不写新的比对逻辑）：

- 在候选稿上调 `rhymeSlots(候选稿, rules, paint, 'strict')`（`src/core/rhymeRules.ts:290`）。**显式传 `'strict'`**，不跟设置常量走（`src/core/rhymeRules.ts:44` 那个常量以后被人改成宽松，检查也不会跟着变松）。
- 对每个「AI 碰过的韵脚位置」——这个位置的字改前改后不一样，或者它改之前不是韵脚位置——如果这一位有要押的韵母，就必须 `ok === true`。
- 判不出韵母的字（不是汉字）算没押上。
- 你自己原来写的、AI 没碰的不押韵的字，不算 AI 的违规（屏幕上照旧只提示，`src/core/rhymeRules.ts:318`）。

「字面韵母」的口径就是屏幕上标「对不上」用的那一个：`finalOfChar` 取这个字的韵母（`src/core/rhymeRules.ts:78`，拼音来自 `src/core/rhyme/syllable.ts:98`），`finalsMatch` 在严格模式下要求两边完全相等（`src/core/rhymeRules.ts:88`）。所以**屏幕上判为押上的，和检查判为押上的，是同一个函数的结果**。

### 3.3 在哪一侧执行

**只在前端执行；包的服务端不重做这四道检查。**

| 为什么前端是唯一权威 | |
|---|---|
| 文档只活在编辑器里 | 表格、锁、涂色、选区都在编辑器内存里，服务端在一次 AI 调用里只见到提示词 |
| 写文档的只有编辑器 | 模型的输出是数据，不是指令；它只有经过 §3.0 的两个入口才能变成表格里的字 |
| 要防的是模型，不是用户 | 用户本来就能随手改任何字。检查要保证的是「模型的输出不会绕过用户设的锁」，这个保证在入口处给 |
| 不出第二份实现 | 韵母靠 `pinyin-pro`（`src/core/rhyme/syllable.ts:1`）。用 Python 再写一份，两边迟早对同一个多音字给出不同答案 |

**服务端只做这些**（都是确定性的）：登录；这个 Agent 是不是你的、基名对不对；请求大小；每人限流；同一次操作（`op_id`）最多 3 次模型调用，第 4 次直接拒。

**什么时候必须两侧都做**：出现了**不经过编辑器就能改作品**的入口。眼下有一个潜在的：聊天里的 AnyBeats Agent 如果有写文件的工具，或者它派出去的后台任务把产物交回工作区（平台有这条交付路径，`web/services/agent_workspace_store.py:411`），就能不经编辑器改到作品文件，四道检查管不到【推测：没有逐个核对今天哪些工具写得到这个目录；P2 建 Agent 配置时核对。下面两条处理不依赖核对结果】。本稿的处理：

- Agent 的工具名单里不给写文件类工具（配置，P2）；
- 包的存储路由记下「每个作品上次经编辑器保存时的 sha256」，读的时候对不上就在编辑器里提示「这首歌在编辑器之外被改过」，由你选用哪一版（确定性检测，P3）。

以后真要做「在聊天里让 Agent 改词」，那时再把四道检查搬一份到服务端（用 Node 跑同一份 TypeScript，或者移植 + 共用一批标准样例），见 Q8。那会是另一张平台单：包的清单不能声明工具（`skills/agent_creation.md:865`），聊天里的「改词」工具得由平台提供，而且要做成唯一的写入口（平台指引对这类 Agent 的要求，`skills/agent_creation.md:981`）。

### 3.4 不过怎么办

**润色**（一次给出整段候选）：

```
第 1 次调用 → 解析 → 四道检查
   过   → 进预览，等你点「用这一版 / 再来一版 / 放弃」
   不过 → 程序把违规清单写成固定句式追加到提示词里 → 第 2 次调用 → 再检查
        → 还不过 → 第 3 次调用 → 再检查
        → 还不过 → 这一版作废，表格原样，面板列出最后一次的违规
```

- **重写上限 2 次**，即一次点击最多 3 次模型调用。对齐平台已有的同类上限：工具参数不合法时「同一把连续被拒超过 2 次就停」（`web/services/tool_args.py:69`）。
- ①②③④ 任何一道不过都是**整份作废**，不部分采用。
- 作废时的文案沿用 v3 稿：「这一版作废了，没有上屏」，按钮「再试一次 / 看 AI 原文」（`design/DESIGN_v3.md:121`、`design/DESIGN_v3.md:127`）。
- 违规清单是程序生成的固定句式，例如「第 3 小节第 4 拍『西』：锁定的字，不能改」「第 5 小节第 4 拍末字要押 ang，『天』是 ian」。原因文字在 `CHANGE_REASON_TEXT`（`src/core/locks.ts:150`），补上新原因。

**填韵**（一次给出很多格）：

- 模型碰了名单外的位置（①③）或回答格式不对 → 和润色一样，整份退回重写，上限相同。
- 只是某几格没押上（④）或不是恰好一个字 → **按格处理**：合格的格先留作「待确认」（v3 稿：填进来的字先标「待确认」，每格「采用 / 换一个」，`design/DESIGN_v3.md:103`），不合格的格只把这几格再问一遍；到上限仍不合格的留空，标「没填上」。
- 「待确认」的字不算上屏；你点「采用」的那一刻再走一次入口检查。

### 3.5 实施单要改的代码（P1，全部在 AnyBeats 仓库内）

| 文件 | 改什么 |
|---|---|
| 新增 `src/core/aiGate.ts` | `judgeAiFill`、`judgeAiPolish`：把现有的 `applyRhymeFill` / `applyPolish` 和新增判定（①b、②的三条、③的两条、④）组合成一个永不抛错的判定；`violationFeedback`：把违规清单写成固定句式 |
| `src/core/locks.ts` | `ChangeReason`（`src/core/locks.ts:83`）加「没押上」「不是恰好一个字」「格式不对」「表格已经变了」四种，补 `CHANGE_REASON_TEXT` |
| `src/core/aiEdit.ts` | `planRhymeFill` 去掉没定韵母的目标；`applyRhymeFill` 不再悄悄截断；`applyPolish` 的落点判定只认 `allowFlow`；整段替换路径里可能抛错的地方（`insertWord`，`src/core/grid.ts:343`）包起来算违规 |
| `src/engine/aiController.ts` | 两个开关并成一个；走哪条写入路径只看 `allowFlow` |
| `src/engine/editorStore.ts` | 两个入口改成调 `aiGate`，把 `exec` 的结果带出来 |

**测试**：

- `src/core/__tests__/aiGate.test.ts`：四道检查各有「过」和「不过」的用例；④ 另加「设置常量改成宽松，检查照样按严格判」。
- **变异探针**：一个脚本依次把四道判定各自短路掉（每次只改一行），断言至少有一条测试转红。四个变异都被杀死才算过。
- **入口闸**：一条读源码的测试，断言 `applyRhymeFill` / `applyPolish` 只被 `aiGate` 引用，类型为「AI 改写」的 `exec` 只出现在那两个入口里。
- P4 再加重写环的测试：用假的模型（`src/ai/FakeProvider.ts:23`）第 1 次违规、第 2 次合规 → 只上屏一次、撤销历史只多一条；三次都违规 → 表格逐字节不变。

---

## 4. 分步实施计划

估价是模型花费的量级（美元），不含人验收和外部动作。「平台」= 改 Alphie 仓库；「包内」= 只改 AnyBeats 仓库。

| 步 | 内容 | 改哪 | 依赖 | 估价 |
|---|---|---|---|---|
| P0 | 拍板 + 建包根 | 不是编程单 | — | 0–2 |
| P1 | 四道检查补齐 | 包内 | 无，现在就能派 | 15–25 |
| P2a | 名单加 `anybeats`、处理插口 | **平台** | Q9 | 6–10 |
| P2b | 包骨架 + 桥 + 编辑器挂进 Agent 页 | 包内 | P0、P2a | 35–50 |
| P3a | 门面 1.1：三个通用导出 | **平台** | 无，可与 P1–P2 并行 | 30–45 |
| P3b | 作品存进工作区 + 导入导出 | 包内 | P2b、P3a | 35–50 |
| P4 | AI 通路 + 面板 + 重写环 + 实测 | 包内 | P1、P2b、P3a | 50–75 |
| P5（可选） | 上 prod、分享后别人也能用 | **平台** + 包内 + prod 运维 | Q2 | 30–50 |
| P6（可选） | 录音 | 包内（+ 可能的平台件） | Q10 | 40–60 |

### P0 前置（主会话 / root，不是编程单）

- 你回答 §5 的题。
- 主会话在 dev 上以 root 跑 `scripts/install_agent_package_root.py` 建包根。
- **验收**：同一脚本带 `--check` 退出码 0；`GET /api/admin/agent-packages/status` 里包根状态不再是「没有包根」。

### P1 四道检查补齐（包内）

- 内容：§3.5 全部。不依赖平台的任何改动，静态版也因此变得更严。
- **验收**：`npx vitest run` 全绿（含新增的 `aiGate.test.ts` 和入口闸测试）；变异探针脚本退出码 0（四个变异全部被杀死）；`npm run build`、`npm run lint` 通过；现有 `e2e/` 不变。

### P2a 名单 + 插口（平台）

- 内容：`config/agent_packages.py:25` 加一行；按 Q9 的答案处理 `quant` 行和 `scripts/capability_contract.py:435` 的状态。
- **验收**：`python scripts/capability_contract.py` 绿；`python -m web.services.agent_packages --selftest` 通过（合并闸本来就跑它，`tasks/coding_task_merge.py:121`）；平台现有测试不变红。

### P2b 包骨架 + 挂载（包内）

- 内容：§2.2 的目录、清单、`install.py`、手册；§2.3 的桥（`host.info`、`file.save`）和编辑器路由；`src/host/` 与构建开关；导出改走桥。此时作品还只在内存里，顶栏照旧提示「本次不保存」——这一步是工程里程碑，不是给你用的版本。
- **验收**：
  - 包的 pytest：用环境变量把包根指到任务自己的临时目录（`config/paths.py:807` 认 `ALPHIE_AGENT_PACKAGES_ROOT`），加载器状态为 `loaded`；`GET /api/anybeats/editor` 带那三个应答头；没登录 → 401。
  - 桥的测试：别的窗口发来的消息被丢弃；表外的请求被拒；消息里带的 Agent id 不起作用；地址只落在 `/api/anybeats/<agent>/` 下。
  - 浏览器验收（Playwright，截图存证）：框内读不到登录凭证、读不到父页面；能打字、能播放、导出能落盘；桌面和手机两种视口。
  - 主会话按手册装到真包根、重启后，状态接口里 `anybeats` 是 `loaded`，打开 AnyBeats Agent 看到编辑器。
- 实施单不能自己装到真包根、不能重启 Flask：产出手册，走交接。

### P3a 门面 1.1（平台）

- 内容：§2.4 表里的三个导出一次加齐，版本号变 `(1, 1)`。合成一张单是为了只涨一次小版本、只跑一遍回归。
- **验收**：平台 pytest——别人的 Agent → 404；基名不符 → 404；dev 上写经 prod、prod 不收就不写；「只在这台电脑上」的 Agent 不出本机；路径穿越被拒；Free 无 Key → 拒并给出「要自带 Key」；Pro 超额 → 拒；用量行记在调用者和这个 Agent 名下。`scripts/usage_attribution_guard.py`、`scripts/capability_contract.py`、`--selftest` 全绿。

### P3b 作品存储（包内）

- 内容：§2.5 全部（存储路由、前端适配器、待传清单、冲突副本、上限、sha256 记录与「编辑器之外被改过」的提示、静态版「导出全部」、Agent 版「导入」）。
- **验收**：包的 pytest（版本对不上 → 拒绝覆盖；超上限 → 拒；键名白名单）；`vitest`（适配器：预取、节流、失败后补传、冲突另存副本）；浏览器：写一首 → 刷新还在 → 换一个浏览器登录同一账号看得到；断网时改 → 恢复后自动补传；用静态版导出的包能导入。

### P4 AI 通路（包内）

- 内容：`ai` 与 `ai/status` 两个路由（限长、限流、`op_id` 计数）；桥的 `ai.lyrics`、`worker.status`；AI 面板（照 `design/mockups_v3/ai.html`、`ai_reject.html`、`paint.html`）；重写环（§3.4）；构建带 `VITE_ANYBEATS_AI=1`。
- **验收**：包的 pytest（没登录 401；别人的 Agent 404；超长被拒；同一 `op_id` 第 4 次被拒）；`vitest`（§3.5 末尾的重写环用例；四道检查各一条从「假模型输出」到「表格没变」的端到端用例）；30 条固定样例的实测报告（首次通过率、三次内通过率、每次花费、耗时）；浏览器截图对照视觉稿；用量页上能看到这些调用记在 AnyBeats 这个 Agent 名下。

### P5 上 prod / 分享（可选）

- 内容：平台放开加载器在 `cloud` 上加载（`web/services/agent_packages.py:485`）并补对应的降级测试；prod 装包手册（建根、装包、`--check`、重启）；清单 `deployments` 加 `cloud`；拼提示词挪到服务端；限流按多用户重估。
- **验收**：prod 上状态接口 `loaded`；用一个非管理员账号装副本，能打开编辑器、作品互相看不到、AI 花费记在各自名下。

### P6 录音（可选）

- 内容：父页面录音经桥交给编辑器（方向同管理通道稿 `docs/admin_channel_separation.md:619`）；录音文件存工作区。
- **验收**：另立设计单，本稿不展开。

---

## 5. 拍板题

**Q1. 走哪条路让编辑器调得到模型？**
- A. 私有代码包（本稿）。
- B. 等平台做出「画布能力原语」，AnyBeats 仍然是画布。
- C. 先做成普通 Agent + 外部主页指向线上静态版，AI 以后再说。
- **推荐 A**。B 的原语还没实现，而且画布 512 KB 的上限放不下 912 KB 的编辑器（§1.2）；B 的 `agent.call` 是一整轮对话，慢且输出不受控。C 今天就能做、零代码，但没有 AI——如果你只是想「先在 Agent 列表里有它」，可以把 C 当成 P2 之前的过渡，两者不冲突。
- 这一题必须由你定：平台的指引写明，私有 Agent 要服务端代码时得先问用户代码放哪，不能默认走代码包（`skills/agent_creation.md:874`）。
- 注意：容器方案 T7 如果你选了 B（加载器整体下线），A 就做不了，得回到这一题重选。

**Q2. 第一期在哪用？**
- A. 只在 dev 这台机器上（你自己用）。P1–P4 做完就能用。
- B. 也要在 prod 上用 / 让别人装了副本也能用 AI。多做 P5。
- **推荐先 A**，跑通、看过 P4 的实测数字后再定 P5。依据：加载器今天只在 dev 加载（`web/services/agent_packages.py:485`），prod 上装包是单独的显式动作（`docs/agent_code_package_design.md:349`）；给别人用还牵涉谁付费和限流。
- **如果你平时只从 prod 打开 Alphie，请直接选 B**——否则做出来的东西你日常入口里看不到。

**Q3. 包的代码放哪？**
- A. 本仓库加 `agent/` 目录，包目录是「导出 + 构建」出来的副本。
- B. 另建一个私有仓库，把构建产物也提交进去，仓库检出就是包目录（A 稿的原样）。
- **推荐 A**。依据：信任校验会拒掉 `node_modules` 里的符号链接（`security/package_trust.py:113`），前端包无论如何要「构建后再装」；四道检查和服务端同仓库同版本；不需要你去建第二个仓库。B 的好处是和 A 稿字面一致、包目录自带 git 历史；代价是 0.9 MB 的构建产物每次都要提交，两个仓库要同步版本。

**Q4. 页面里同源运行的那一小段代码怎么办？**
- A. 包里放一个手写的小桥（300 行以内、无第三方依赖、逐行审查），编辑器整个进隔离框。
- B. 等平台做出通用的「父页面代理」再做 AnyBeats。
- C. 不用隔离框，整个编辑器直接以应用的源挂在页面里。
- **推荐 A**。依据：容器方案要求私有 Agent 的页面 JS 进隔离框（`experiments/agent_containers/design.md:212`）；放置稿实测同源脚本读得到登录凭证（`experiments/agent_code_placement/design.md:195`）。编辑器带着 React、pinyin-pro、fflate 一共 0.9 MB 的第三方代码，逐行审不了；桥是自己手写的一个小文件，审得了。B 最干净但要等一个没排期的平台件。C 最省事（大约省 30–40 美元，录音也顺带能做），但等于让 0.9 MB 第三方代码拿到你的登录凭证，和容器方案直接冲突。

**Q5. 用哪个模型、谁付钱？**
- A. 平台默认模型 `deepseek-flash`；谁点按钮谁付，规则和聊天一样。
- B. 用这个 Agent 在设置里选的模型。
- C. 走一整轮 Agent 对话。
- **推荐 A**。依据：和「自动起标题」同一条已有通路（`web/routes/agents.py:1739`）；一次约 0.001 美元；P4 有实测，通过率不够再换档。B 的通路可能是命令行类，一次几十秒，配不上最多三次的重写环。

**Q6. 作品存哪？**
- A. 这个 Agent 的工作区：跟账号走，换浏览器 / 换设备都在；prod 上有一份。
- B. 继续只存浏览器：Agent 版在隔离框里拿不到浏览器存储，等于每次打开都是空的——除非放弃隔离框（Q4-C）。
- C. 把 Agent 设成「只在这台电脑上」：作品只在 dev 的盘上，一个字节都不出这台机器；代价是这个 Agent 不能分享。
- **推荐 A**。依据：核心约束 12 把「Agent 的产物」归平台数据目录（`CLAUDE.md:46`）；作品是文件，聊天里的 Agent 也读得到。同一条约束也说「用户的歌」这类个人项目归用户本机（`CLAUDE.md:45`）——如果你更看重「歌词不出这台机器」，选 C。
- 旧作品：推荐在静态版加「导出全部」、Agent 版加「导入」（P3b 里）。

**Q7. 检查不过怎么办？**
- A. 自动带着违规清单重写，最多 2 次；仍不过整份作废。填韵里只是个别格没押上时，合格的格保留为「待确认」，不合格的只重问那几格。
- B. 不自动重写，一次不过就作废（今天代码的做法），你自己点「再试一次」。
- C. 同 A，但填韵也是整份作废，不按格保留。
- **推荐 A**。依据：上限 2 次和平台已有的同类上限一致（`web/services/tool_args.py:69`）；最坏三次约 0.003 美元；填韵一次十几格，一格没押上就全部重来太浪费，而且每格本来就要你逐个点「采用」。

**Q8. 服务端要不要再做一遍四道检查？**
- A. 现在不做。只在前端入口做；等真有「不经过编辑器改词」的功能时再加。
- B. 现在就做：服务端用 Node 跑同一份 TypeScript。
- C. 现在就做：用 Python 重写一份。
- **推荐 A**。依据见 §3.3：文档只在编辑器里，服务端在一次调用里看不到完整的表格和锁；要防的是模型不是用户。B 要在包里引入 Node 运行时。C 会出现两份韵母实现，迟早对不上。

**Q9. 名单里 `quant` 那一行和插口状态怎么处理？**
- A. 加 `anybeats` 的同一单删掉 `quant` 行，金丝雀改成 `anybeats`，插口保持 `proposed`。
- B. 保留 `quant` 行。闸数到 2 个，插口必须改成 `open`（合同里写的走法）。
- C. `quant` 行照 T7 的结果办；AnyBeats 进名单后是 1 个还是 2 个，由那时名单的样子决定。
- **推荐 A**。依据：闸数的是名单里的名字，不是真装上的包（`scripts/capability_contract.py:1632`）。量化的代码没有进包、按容器方案也不会进包，容器方案 T7 的推荐理由原话是「留着那一行会让闸数出一个不存在的实现者」（`experiments/agent_containers/design.md:420`）。照 B 做，「插口开了」这个结论是靠一个空名字得出的。真有第二个包（比如 CMO 的私有件）进名单时再改 `open`。
- 这一题和合同原文不一致，所以单独列出来请你定。

**Q10. 录音进不进 Agent 版？**
- A. 本期不做。Agent 版和今天的线上版一样没有录音。
- B. 做（P6）：父页面录音，经桥交给编辑器，录音存工作区。
- **推荐 A**。依据：录音在今天的构建里本来就默认关着（`src/main.tsx:20`）；隔离框里拿不到麦克风，要在父页面录，桥会变重；录音文件大，存储和节流要另外设计。

---

## 6. 与既有设计的一致与冲突

### 6.1 一致的地方

| 既有设计 | 本稿照做的 |
|---|---|
| A 稿 | 包在 root 自有的包根下、过信任校验后加载；清单 `alphie_package.json`；包只用门面；路由前缀在 `/api/` 下；不自起定时器；名字进平台名单；门面加导出按小版本 +1；平台合并闸跑 `--selftest`；Agent 不能自动给包派单（`tasks/coding_task_auto_lane.py:170`） |
| 核心约束 15 | AnyBeats 专属代码零进平台仓库。平台只多名单一行和三个通用导出（名字和实现里不出现 anybeats） |
| 容器方案 §6 | 编辑器进不透明源框，应答头再加一层；和平台说话只经父页面里的代理；框的内容不从工作区、不从仓库检出目录送，而是从 root 自有的包目录送，`BUILD.json` 记着字节的 sha256 |
| 容器方案 §1 | 服务器只有 prod、dev 是特殊客户端 → 作品的权威那一份在 prod |
| 放置稿 | 按两条轴放：root 写的服务端进 Flask 进程；同源只放 root 写的小桥；大块的编辑器进不透明源框。比放置稿对 root 写的代码的最低要求更严 |
| Agent 包格式稿 | 分享只带「项目」类字段；工作区、记忆、凭证不带 |
| 核心约束 19 | 不为 AnyBeats 新开插口；用已有的 `agent_code_package`，状态变化交给闸和 Q9 |
| 「创建 Agent」技能文档 | 四道检查是确定性的代码判定，跟着 AnyBeats 自己走，不进平台仓库；写入只有一个入口（§3.0）；聊天那一侧不给别的写工具（§3.3）；代码放哪作为拍板题问你（Q1、Q3） |

### 6.2 冲突的地方

| # | 既有设计怎么说 | 本稿怎么做 | 为什么 | 去向 |
|---|---|---|---|---|
| C1 | A 稿：每个包一个私有仓库，主检出就是包目录（`docs/agent_code_package_design.md:440`、`docs/agent_code_package_design.md:571`、`docs/agent_code_package_design.md:586`） | 源码在 AnyBeats 仓库的 `agent/`；包目录是导出 + 构建的副本，不是 git 检出 | 前端要构建；`node_modules` 过不了信任校验；检查和服务端要同版本 | Q3 |
| C2 | A 稿 / 放置稿：第二个包设想的是 CMO 私有件或 sts2_coach（`docs/agent_code_package_design.md:589`、`experiments/agent_code_placement/design.md:336`） | AnyBeats 先进名单 | 你的要求；AnyBeats 同样是「root 写、要进程内加载」的包 | Q9 |
| C3 | A 稿：包的前端 JS 作为模块以应用的源在页面里跑 | 只有小桥同源，编辑器进隔离框 | 向容器方案 §6 靠拢，比 A 稿严 | Q4 |
| C4 | 容器方案 / 放置稿：父页面代理是**平台**的通用件（`experiments/agent_code_placement/design.md:148`、`experiments/agent_code_placement/design.md:235`），还没实现 | 代理的逻辑先放在包自己的桥里 | 平台件没有排期；桥是 root 写的，符合「同源只能由平台同信任级的人写」（`experiments/agent_code_placement/design.md:47`）。桥的规则和那两稿对代理的要求逐条相同（只认那个框、Agent id 不取自消息、白名单、路径前缀），将来换成平台件是换一个文件 | Q4 |
| C5 | 容器方案 T7 推荐：加载器冻结保留、删 `quant` 行、插口保持 `proposed`（`experiments/agent_containers/design.md:420`）；§9 把加载器列为「需拍板」（`experiments/agent_containers/design.md:313`）。合同：AnyBeats 进名单后插口变 `open` | AnyBeats 成为加载器的第一个真使用者；推荐删 `quant` 行、保持 `proposed` | T7 推荐理由本身就说「加载器对 root 自己写的私有包仍可能有用」，AnyBeats 正是这一类，和 T7-A 不矛盾；和合同那句话不一致 | Q9；若 T7 选了「整体下线」则 Q1 |
| C6 | A 稿：包仓库的验收命令形如在包仓库根跑 `tests/` | 包的 Python 测试在 `agent/tests/`，命令形如 `PYTHONPATH=/opt/Alphie:agent /opt/Alphie/.venv/bin/python -m pytest -q agent/tests/` | 包不在仓库根 | 实施单照此写 |
| C7 | 管理通道稿 §5：画布能力的消息名是另一套，授权按能力逐项打开 | 沿用编辑器已有的消息名；桥的白名单写死，不做逐项授权界面 | 那一套没实现；本稿的桥只服务 AnyBeats 一个包 | 平台 broker 落地后再对齐 |

管理通道稿把 AnyBeats 列为将来「官方目录」Agent 的例子（`docs/admin_channel_separation.md:515`）。官方目录还没实现，本稿不依赖它；它落地以后，搬的是 Agent 的配置，代码包不用动。

---

## 7. 本稿自己做的决定（你可以逐条推翻）

1. 走私有代码包，服务端进程内加载，不进运行容器。
2. 包的源码放本仓库 `agent/`；包目录是从已合并提交导出 + 构建的副本，带 `BUILD.json`。
3. 编辑器整个进 `sandbox="allow-scripts"` 的框；同源只有一个手写的小桥。
4. 编辑器页面由包的路由带三个隔离应答头送出，不放 `static/`。
5. 消息协议沿用编辑器已有的 `alphie.canvas.request / response`，只增加能力名。
6. 导出文件走桥在父页面触发下载，框的沙箱属性保持只有 `allow-scripts`（没选「给框加下载许可」，为了和画布、容器方案的写法逐字一致）。
7. 编辑器对宿主的依赖收在 `src/host/` 一处，用构建开关 `VITE_ANYBEATS_HOST` 选；静态版不受影响。
8. 模型：平台默认模型，付费方是点按钮的登录用户，记在这个 Agent 名下。
9. 提示词在前端拼，服务端不解析歌词，只限长、限流、限次数；上 prod 前挪到服务端。
10. 门面的三个导出合成一张平台单，一次涨到 1.1。
11. 作品存 Agent 工作区，一个键一个文件，格式不变；节流上传 + 父页面待传清单 + 版本冲突另存副本。
12. 四道检查只在前端入口执行，服务端不重做。
13. ② 只认「允许改 flow」一个开关；没开时不许清空已有的字、允许填你铺好的空字位。
14. AI 改动的每个位置必须恰好一个字。
15. ④ 显式按严格模式判，不跟设置常量；只判 AI 碰过的韵脚位置；判不出韵母算没押上。
16. 没定韵母的颜色不作为填韵目标。
17. 生成期间表格变了，结果直接丢弃，不重写。
18. 重写上限 2 次；润色整份作废；填韵按格保留合格的。
19. 聊天里的 AnyBeats Agent 不给写文件类工具；存储路由记 sha256，发现编辑器之外的改动就提示。
20. 第一期只在 dev；上 prod 和分享是 P5。
21. 录音、伴奏音频上云不在本期。
22. 插口推荐删 `quant` 行、保持 `proposed`（和合同原文不一致，Q9）。

---

## 8. 证据与复查

- **引用回查**：`evidence/ct_e0a570a2/check_citations.py` 做四件事，任何一件不过就退出码 1——
  1. `evidence/ct_e0a570a2/citations.tsv` 列出本稿每一处 `文件:行号` 和那一行应当出现的字样，逐行核对字样在不在；
  2. 扫描本稿，确认每一处带行号的引用都在表里（表里多出来没用到的也报）；
  3. 本稿里每一个不带行号的文件 / 目录路径，要么真实存在，要么登记在 `evidence/ct_e0a570a2/planned_paths.txt`（实施单要新建的，今天必须还不存在）；
  4. `evidence/ct_e0a570a2/symbols.tsv` 列出本稿提到的函数 / 常量和它们所在的文件，核对定义确实在（不看行号）。

  复查命令：`python3 evidence/ct_e0a570a2/check_citations.py`（Alphie 仓库不在 `/opt/Alphie` 时加 `--alphie <路径>`）。

  表里的「应当出现的字样」是从实际那一行截出来的，所以这个脚本防的是「平台往前走了、行号漂了」和「稿里写了表里没有的引用」；「这一行说的是不是稿里那个意思」是写稿时逐行人工核对的（核对中改掉了 17 处对不上的行号或说法，清单在报告里）。回查脚本自己会不会红，由 `evidence/ct_e0a570a2/probe_checker.py` 证明：在临时副本里故意改坏五处，每一处它都退出码 1。
- **实测项**（命令和输出在 `evidence/ct_e0a570a2/report.md`）：构建产物大小；Alphie 仓库里搜不到编辑器那套消息名；包根目录不存在；`src/` 里用到的受限浏览器接口清单；`aiEdit` 相关函数的引用点。
- **没有验证的**（都标了【推测】，并写了由哪一步验证）：隔离框首次加载靠 cookie 登录；隔离框里下载被拦、选文件可用；一次调用的花费；dev 上按函数读工作区的实现方式；哪些 Agent 工具写得到工作区里的作品文件。本机没有浏览器环境，所有浏览器行为都留给 P2 的浏览器验收。

---

## 9. 残留风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 多音字 | ④ 按单字的默认读音取韵母，和屏幕上的提示一致，但可能和你唱的读音不同 | 「待确认 / 用这一版」由你最后把关；以后可以加「这个字读哪个音」的标注 |
| 桥是同源代码 | 桥写错了，等于给框里的代码开了口子 | 手写、无依赖、300 行以内；规则逐条有测试；每次改动过审查 |
| 框里可以画假界面 | 隔离框里的代码拿不到登录凭证，但可以画一个假的「请重新登录」| 放置稿已记为这种做法的固有残留；编辑器是自己构建的，来源是已合并的提交 |
| 第三方依赖 | 编辑器的依赖被污染时，受害范围是框内（你的歌词 + 用你的额度调 AnyBeats 的 AI） | 隔离框 + 服务端限流、限次数；`BUILD.json` 记 sha256 |
| 最后几秒的改动 | 页面被强行关掉时，最多 20 秒内的改动还没传到服务器 | 父页面待传清单，下次打开补传 |
| prod 上的写入量 | 每次保存都在 prod 留一份改前快照 | 节流；单键上限；P3 验收时量一下一小时编辑产生多少行 |
| 聊天里的 Agent 改作品 | 四道检查管不到编辑器之外的写入 | 不给写文件工具 + sha256 检测（§3.3）；真要做聊天改词时再做服务端检查 |
| T7 还没定 | 你如果决定加载器整体下线，本稿的路线不成立 | Q1 / Q9 里写明了 |
| 平台在变 | 行号是 `d16cdc77` 这一版的（写稿期间平台 HEAD 换过三次，每次都重跑了回查脚本，引用到的行都还对得上） | 回查脚本；实施单开工先跑一遍 |
