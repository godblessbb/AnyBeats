# AnyBeats - 说唱写词工具

一行 = 一小节 = 16 个 1/16 拍格。伴奏、节拍器、导唱、歌词高亮共用一个时钟、一个播放键。
既能 `npm run dev` 在本地独立打开，也能作为静态文件（`dist/index.html`，JS / CSS 已内联）装进 Alphie 用户画布。

## 开发

```bash
npm install
npm run dev        # 本地开发
npm run build      # 产物：dist/index.html（单文件）
npx vitest run     # 单元测试（src/core 与界面状态层）
python e2e/smoke.py            # 界面冒烟测试（Playwright，自己起 vite preview），截图到 e2e/shots/
python e2e/negative_checks.py  # 反证：把高亮接线 / 自动保存改坏，smoke 必须变红
python e2e/negative_checks_audio.py  # 反证：校准偏移不进 .RPP / 延迟估计恒为 0 / 录音不带校准值，vitest 必须变红
python e2e/ai_preview_shots.py # AI 预览状态截图（开发服务器 + 测试用 FakeProvider）
```

## 代码结构

- `src/core/` 计时、网格、撤销、押韵、工程格式等纯逻辑（不碰 DOM）
- `src/engine/` 界面状态层：编辑器状态（调 core 的 grid / history / cellGesture / autosave）、走带（core 的 clock / playhead / bpm）、押韵候选
- `src/components/` React 界面（按 `design/mockups/` 做）
- `src/ai/` AI 写词只经 `AiProvider` 接口：`AlphieBridgeProvider`（Alphie 画布 postMessage，未接通时显示「Worker 未连接」）、`FakeProvider`（只给测试用）。页面里不放任何 Key
- `src/storage/` 存储适配：拿不到本机存储（画布 sandbox iframe）时自动退到内存，顶栏提示「本次不保存」；录音 take 存 IndexedDB（`takeStore.ts`），同样拿不到就放内存并提示
- `src/audio/` 录音：输入只经 `AudioInputSource` 接口——`MicInputSource`（getUserMedia + AudioWorklet 录无损 PCM）、`ChunkInputSource`（外部推 PCM 分片进来，给画布用：外层页面录音，协议待定，本页不往 parent 发消息）；`latency.ts` 延迟校准（扫频脉冲 + 互相关）；`takes.ts` 对齐（回放、轨道条、.RPP 共用）；`RecordController` 跟着走带录多遍 take、★ 选用、裁头尾
- `src/export/` Reaper 导出：`rpp.ts`（.RPP 文本：TEMPO、段落 marker、歌词 region、每个 take 一轨）、`wav.ts`（24 bit / 32 bit 浮点）、`reaperZip.ts`（打包 zip，fflate）
- `backend/` 可选的本机韵脚服务（「主题联想」用）：`npm run backend`

## 录音

顶栏红点或按 `R`：第一次先做延迟校准（耳机贴近麦克风，放 8 声「嘀」自动量往返延迟，结果记在本机，之后每个 take 自动往前挪这么多；超过 120 ms 提示多半是蓝牙耳机）。
从选中小节的前一小节开始跟伴奏录（预备 1 小节），再按一次停。录音面板里 ★ 选用一遍、裁头尾、回放（歌词同步高亮）。
「导出」勾上「Reaper 工程 .RPP + 分轨」得到一个 zip：`<作品名>.RPP` + `audio/*.wav`，解压后用 Reaper 打开 .RPP 即可。

## 快捷键

`R` 录音 / 停止 · `← → ↑ ↓` 移动 · `Enter` 编辑 · `A` / 双击 重音 · `-` 延音 · `_` 空拍 · `⌘C / ⌘V` 复制粘贴 · `⌫` 删除 · `空格` 播放 / 停止 · `⌘Z / ⇧⌘Z` 撤销 / 重做 · `⌘S` 立即保存 · `⌘E` 导出

## 开源协议

MIT License
