"""AnyBeats v3.4 视觉稿自动检查（浏览器实测，不 grep 源码）：写词页（画笔模式）/ 歌词页 / 十三辙判韵。

用法：python -I design/check_mockups_v34.py design [证据目录]
      （不给证据目录时读环境变量 ANYBEATS_EVIDENCE；都没有就只存仓库里的截图）

对 design/mockups_v34/ 的 5 个画面 × 桌面 1280×800 / 手机 390×844 × 浅 / 深色：
截图（2 倍像素）到 design/screenshots_v34/<画面>_<desktop|mobile>_<light|dark>.png（有证据目录就再拷一份到 <证据目录>/screenshots_v34/），
再在浏览器里量算断言。

通用（每个组合都查）：
  - 无控制台错误 / 页面异常；无外网请求；页面不左右溢出；当前页签对（写词 / 歌词）
  - 没有全大写（text-transform: uppercase）；看得见的字色 / 底色 / 边线没有紫色（色相 250–310°）
  - 文字不溢出：看得见的每一段字都在它的裁切容器（overflow: hidden / clip）里面；ellipsis 截断的元素必须带完整 title
  - 文字不重叠：看得见的任意两段字（不同元素）不重叠（浮层——气泡、拖动提示、抽屉——和下面的表格之间不算）
  - 表格里每个韵脚字的位置 = 用 design/fixtures_v34 独立算出来的韵脚位置；韵脚字颜色的色相 = 它那种颜色的色相（±8°）
画面专属：
  write    模式提示 = 打字、在视口里四角不被挡；正好一个光标方格，没被气泡 / 抽屉挡住；气泡四个按钮原样（一分二 / 三连 / 空音 / 合并）；
           没有拖动预览、表格没有涂色外框
  paint    模式提示 = 涂色、四角不被挡、色相 = 按下的色块、写着颜色名；桌面写 Esc，手机「完成」按钮高 ≥ 36px；
           表格外框是这种颜色；拖动预览 ≥ 2 格、同一拍、小节连续、底色是这种颜色；拖动提示在视口里、格数对；画了画笔指针；
           没有光标方格 / 改字气泡（涂色时不打字）；手机抽屉头是这种颜色
  side     模式提示 = 选格子；选区框正好框住选中的格子、看得见；锁定 / AI 两块在视口里四角不被挡；选中的行头看得见
  lyrics   每一行的字 = 样例里这一小节的字（逐字），行数、段落顺序都对；韵脚字正好是样例算出的韵脚位置；
           韵脚字颜色和同尺寸同配色的写词页同一种颜色的韵脚字逐个相等；正好一行高亮、是第 28 小节、在视口上半部、四角不被挡；
           复制 / 导出 .txt 按钮在视口里
  rhyme13  两张表的字和涂色完全一样；旧规则 ≥ 1 处「不押」（虚线框）、新规则 0 处；两边写的数字 = 表里实际的虚线数 = 用样例独立算的数；
           迁移横幅和两个按钮在视口里；判押韵两档、辙表 13 行

反向探针（每次都跑）：故意把稿子改坏，每一条都必须让检查报错，否则本脚本退出 1。见 MUTATIONS。

任何一项不满足，退出码 1。只用标准库 + playwright（sync API）。
"""

import json
import os
import pathlib
import shutil
import sys

from playwright.sync_api import sync_playwright

SIZES = {"desktop": (1280, 800), "mobile": (390, 844)}
SCHEMES = ("light", "dark")
SCREENS = ("write", "paint", "side", "lyrics", "rhyme13")
TAB = {"lyrics": "lyrics"}
SCALE = 2

# ---------- 十三辙（和 src/core/rhyme/syllable.ts 一致；这里独立再写一份，用来核对稿子） ----------
INITIALS = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s"]
Y_F = {"yi": "i", "ya": "ia", "ye": "ie", "yao": "iao", "you": "iu", "yan": "ian", "yang": "iang", "yin": "in", "ying": "ing",
       "yong": "iong", "yu": "ü", "yue": "üe", "yuan": "üan", "yun": "ün", "yo": "o"}
W_F = {"wu": "u", "wa": "ua", "wo": "uo", "wai": "uai", "wei": "ui", "wan": "uan", "wen": "un", "wang": "uang", "weng": "ueng"}
ZHE = {
    "发花": ["a", "ia", "ua"], "梭波": ["o", "e", "uo"], "乜斜": ["ie", "üe", "ê"], "一七": ["i", "ü", "-i", "er"],
    "姑苏": ["u"], "怀来": ["ai", "uai"], "灰堆": ["ei", "ui"], "遥条": ["ao", "iao"], "由求": ["ou", "iu"],
    "言前": ["an", "ian", "uan", "üan"], "人辰": ["en", "in", "un", "ün"], "江阳": ["ang", "iang", "uang"],
    "中东": ["eng", "ing", "ong", "iong", "ueng"],
}
GROUP = {f: z for z, fs in ZHE.items() for f in fs}


def split_final(py: str) -> str:
    s = py.lower().replace("v", "ü").replace("u:", "ü")
    if s in Y_F:
        return Y_F[s]
    if s in W_F:
        return W_F[s]
    ini = next((i for i in INITIALS if s.startswith(i)), "")
    f = s[len(ini):]
    if f == "i" and ini in ("zh", "ch", "sh", "r", "z", "c", "s"):
        f = "-i"
    if ini in ("j", "q", "x") and f.startswith("u"):
        f = "ü" + f[1:]
    return {"iou": "iu", "uei": "ui", "uen": "un"}.get(f, f)


def group_of_want(want: str):
    return GROUP.get(want) or GROUP.get(split_final(want))


def matches(got: str, want: str, mode: str) -> bool:
    if mode == "strict":
        return ("i" if got == "-i" else got) == want
    return GROUP.get(got) is not None and GROUP.get(got) == group_of_want(want)


def load_fixture(root: pathlib.Path) -> dict:
    fx = root / "fixtures_v34"
    doc = json.loads((fx / "koi_zh_lyrics_v4_nopickup.anybeats").read_text(encoding="utf-8"))
    py = json.loads((fx / "pinyin_v4.json").read_text(encoding="utf-8"))["table"]
    bars = []
    for s in doc["sections"]:
        for b in s["bars"]:
            bars.append({"id": b["id"], "g": len(bars), "sec": s["label"], "words": sorted(b["words"], key=lambda w: w["tick"])})
    by_id = {b["id"]: b for b in bars}

    def merge(rules, paint, mode):
        kept, mp = [], {}
        for r in rules:
            k = next((x for x in kept if x["count"] == r["count"] and all(
                (f == x["finals"][i]) if mode == "strict" else (group_of_want(f) is not None and group_of_want(f) == group_of_want(x["finals"][i]))
                for i, f in enumerate(r["finals"]))), None)
            mp[r["id"]] = k["id"] if k else r["id"]
            if not k:
                kept.append(r)
        return kept, {key: mp[v] for key, v in paint.items()}

    def slots(rules, paint, mode):
        out = {}
        by = {r["id"]: r for r in rules}
        for b in bars:
            for beat in range(4):
                r = by.get(paint.get(f"{b['id']}:{beat}"))
                if not r:
                    continue
                ws = [w for w in b["words"] if w["tick"] // 48 == beat]
                rp = ws[max(0, len(ws) - r["count"]):]
                for j, w in enumerate(rp):
                    want = r["finals"][j + (r["count"] - len(rp))]
                    got = split_final(py[w["text"][-1]]) if w["text"] else None
                    out[b["g"] * 192 + w["tick"]] = {"hue": r["hue"], "key": f"{b['id']}:{beat}", "ok": None if got is None else matches(got, want, mode)}
        return out

    rules13, paint13 = merge(doc["rules"], doc["paint"], "thirteen")
    s13 = slots(rules13, paint13, "thirteen")
    lines = [{"bar": b["g"] + 1, "id": b["id"], "text": "".join(w["text"] for w in b["words"])} for b in bars if any(w["text"] for w in b["words"])]
    sections = []
    for s in doc["sections"]:
        sections.append(s["label"])
    # 十三辙对比：v4 的涂色，规则按 v1 的做法一种颜色一条（蓝 an、绿 ong、粉 ao、金 ang、青 ei、草绿 i）
    v1 = {215: "an", 150: "ong", 340: "ao", 42: "ang", 185: "ei", 100: "i"}
    hue_of = {r["id"]: r["hue"] for r in doc["rules"]}
    old_rules = [{"id": f"r_v1_{h}", "hue": h, "count": 1, "finals": [f]} for h, f in v1.items()]
    old_paint = {k: f"r_v1_{hue_of[v]}" for k, v in doc["paint"].items()}
    s_old, s_new = slots(old_rules, old_paint, "strict"), slots(old_rules, old_paint, "thirteen")

    def miss_in(sl, ids):
        return sum(1 for i in ids for w in by_id[i]["words"] if (by_id[i]["g"] * 192 + w["tick"]) in sl and sl[by_id[i]["g"] * 192 + w["tick"]]["ok"] is False)

    cmp_rows = {"desktop": [f"b{i}" for i in range(9, 17)], "mobile": [f"b{i}" for i in range(11, 14)]}
    return {
        "slots13": {str(a): v["hue"] for a, v in s13.items()},
        "slotKey13": {str(a): v["key"] for a, v in s13.items()},
        "lines": lines,
        "sections": sections,
        "rules13": len(rules13),
        "cmp": {size: {"old": miss_in(s_old, ids), "new": miss_in(s_new, ids), "rows": [by_id[i]["g"] + 1 for i in ids]} for size, ids in cmp_rows.items()},
        "allOld": sum(1 for v in s_old.values() if v["ok"] is False),
        "nowBar": by_id["b27"]["g"] + 1,
        "sel": [f"b12:{i}" for i in range(4)] + [f"b13:{i}" for i in range(4)],
    }


PROBE_JS = r"""
([screen, fx]) => {
  const fails = [];
  const fail = (m) => { if (fails.length < 40) fails.push(m); };
  // 浮在表格上面的提示（气泡、拖动提示、画笔指针、抽屉、提示条）在 App 里是 pointer-events: none，不挡拖动；
  // 量「看不看得见 / 挡没挡住」时让它们可以被命中，这样量到的就是眼睛看到的上下关系。量完删掉。
  const peStyle = document.createElement('style');
  peStyle.textContent = '.sq-tip, .sq-tip *, .drag-tip, .drag-tip *, .brush-pt, .brush-pt *, .toast, .toast *, .hold-tip, .hold-tip * { pointer-events: auto !important; }';
  document.head.appendChild(peStyle);
  const parse = (s) => {
    const c = s && s.match(/color\(srgb ([^)]+)\)/);
    if (c) { const p = c[1].split(/[ \/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]; }
    const m = s && s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const hsl = (c) => {
    const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
    return [h, s, l];
  };
  const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
  const shown = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth)) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  };
  const inView = (el, name) => {
    if (!el) { fail(`${name} 不存在`); return false; }
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) { fail(`${name} 看不见（尺寸为 0）`); return false; }
    if (r.left < -0.5 || r.right > innerWidth + 0.5 || r.top < -0.5 || r.bottom > innerHeight + 0.5) { fail(`${name} 不在视口里 (${r.left.toFixed(0)},${r.top.toFixed(0)},${r.right.toFixed(0)},${r.bottom.toFixed(0)})`); return false; }
    for (const [x, y] of [[r.left + 3, r.top + 3], [r.right - 3, r.top + 3], [r.left + 3, r.bottom - 3], [r.right - 3, r.bottom - 3]]) {
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === el || el.contains(hit))) { fail(`${name} 有一角被挡住了（${x.toFixed(0)},${y.toFixed(0)} 处是 ${hit ? (hit.dataset.role || hit.className || hit.tagName) : '空'}）`); return false; }
    }
    return true;
  };
  const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const vis = (sel, root) => [...(root || document).querySelectorAll(sel)].filter(shown);

  // ---------- 通用 ----------
  if (document.documentElement.scrollWidth > innerWidth + 1) fail(`页面左右溢出：scrollWidth ${document.documentElement.scrollWidth} > ${innerWidth}`);
  const tabs = vis('[data-role="steps"] button.on');
  if (tabs.length !== 1 || tabs[0].dataset.step !== fx.tab) fail(`当前页签不是「${fx.tab === 'lyrics' ? '歌词' : '写词'}」`);
  const tabNames = vis('[data-role="steps"] button').map((b) => b.textContent.replace(/\d/g, '').trim());
  if (tabNames.join('|') !== '写词|歌词') fail(`页签应该是「写词 | 歌词」，现在是「${tabNames.join(' | ')}」`);
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.textTransform === 'uppercase' && el.textContent.trim()) { fail(`${el.className || el.tagName} 用了全大写`); break; }
  }
  let purple = 0;
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight)) continue;
    const cs = getComputedStyle(el);
    for (const k of ['color', 'backgroundColor', 'borderTopColor', 'outlineColor']) {
      const c = parse(cs[k]);
      if (!c || c[3] < 0.2) continue;
      const [h, s] = hsl(c);
      if (h >= 250 && h <= 310 && s > 0.25) { purple++; if (purple === 1) fail(`${el.dataset.role || el.className || el.tagName} 的 ${k} 是紫色（${cs[k]}）`); }
    }
  }

  // 文字：看得见的每一段
  const FLOAT = '.sq-tip, .drag-tip, .toast, .drawer, .hold-tip, .edit-tip, .menu, .brush-pt';
  const COVER = FLOAT + ', .tools, .sh-head, .top, .bar2, .rh, .corner, .track';
  const texts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || el.closest('svg, script, style')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
      const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
      const hit = document.elementFromPoint(x, y);
      // 被浮层、粘住的顶栏 / 工具条 / 列头 / 行头盖住的字不算看得见（滚到它们底下是正常的）；
      // 被别的普通元素盖住的照样算，留给下面的「重叠」去抓
      if (!hit) continue;
      if (!(hit === el || el.contains(hit) || hit.contains(el))) {
        const cover = hit.closest(COVER);
        if (cover && !cover.contains(el)) continue;
      }
      // 量重叠时只取字形中间 60% 的高度：上下两行的行框可能相切（字体的 ascent / descent 比行高大），那不是重叠
      const core = { left: r.left + 1, right: r.right - 1, top: r.top + r.height * 0.2, bottom: r.bottom - r.height * 0.2 };
      // 省略号截断的字：被截掉的那一截看不见，量重叠时裁到元素自己的框里
      for (let a = el; a && a !== document.body; a = a.parentElement) {
        if (getComputedStyle(a).textOverflow === 'ellipsis') { const ar = a.getBoundingClientRect(); core.left = Math.max(core.left, ar.left); core.right = Math.min(core.right, ar.right); break; }
      }
      texts.push({ el, r, core, txt: n.nodeValue.trim().slice(0, 12), layer: el.closest(FLOAT) });
    }
  }
  // 溢出：裁切容器（overflow hidden / clip）里的字不许出界；ellipsis 截断的要带完整 title
  const clipped = new Set();
  for (const t of texts) {
    // 故意的省略号（带完整 title，鼠标停上去能看全）不算溢出；不带 title 的下面单独报
    const ell = (() => { for (let a = t.el; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).textOverflow === 'ellipsis') return a; return null; })();
    if (ell && ell.title && ell.title.includes(ell.textContent.trim().slice(0, 8))) continue;
    for (let a = t.el; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const ox = cs.overflowX, oy = cs.overflowY;
      if (ox === 'hidden' || ox === 'clip' || oy === 'hidden' || oy === 'clip') {
        const ar = a.getBoundingClientRect();
        const outX = (ox === 'hidden' || ox === 'clip') && (t.r.left < ar.left - 1 || t.r.right > ar.right + 1);
        const outY = (oy === 'hidden' || oy === 'clip') && (t.r.top < ar.top - 2 || t.r.bottom > ar.bottom + 2);
        if ((outX || outY) && !clipped.has(t.el)) { clipped.add(t.el); fail(`文字「${t.txt}」溢出了 ${a.dataset.role || a.className || a.tagName}`); }
        break;
      }
    }
    for (let a = t.el; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.textOverflow === 'ellipsis' && a.scrollWidth > a.clientWidth + 1) {
        if (!(a.title && a.title.includes(a.textContent.trim().slice(0, 8))) && !clipped.has(a)) { clipped.add(a); fail(`「${a.textContent.trim().slice(0, 12)}」被省略号截断了，又没有完整的 title`); }
        break;
      }
    }
  }
  // 重叠：两段不同元素的字不许叠在一起（浮层和它下面的东西之间不算）
  let ov = 0;
  for (let i = 0; i < texts.length && ov < 3; i++) for (let j = i + 1; j < texts.length && ov < 3; j++) {
    const a = texts[i], b = texts[j];
    if (a.el === b.el || a.layer !== b.layer) continue;
    if (overlap(a.core, b.core) > 2) { ov++; fail(`文字重叠：「${a.txt}」和「${b.txt}」`); }
  }

  // 粘住的列头上不许压着表格里的字（现网 v3.2 第 1 步的字和列头同一层，往上滚会压上去）：
  // 临时让字可以被命中，在字和列头相交的地方做命中测试，命中的是字 = 字画在列头上面
  {
    const st = document.createElement('style');
    st.textContent = '.wd, .wd * { pointer-events: auto !important; }';
    document.head.appendChild(st);
    let bad = 0;
    for (const head of document.querySelectorAll('.work .sh-head')) {
      if (getComputedStyle(head).position !== 'sticky') continue;
      const hr = head.getBoundingClientRect();
      for (const ch of head.closest('.sheet').querySelectorAll('.wd .ch')) {
        const r = ch.getBoundingClientRect();
        const t = Math.max(r.top, hr.top), b = Math.min(r.bottom, hr.bottom), l = Math.max(r.left, hr.left), rt = Math.min(r.right, hr.right);
        if (b - t < 3 || rt - l < 3) continue;
        const hit = document.elementFromPoint((l + rt) / 2, (t + b) / 2);
        if (hit && (hit === ch || ch.contains(hit)) && bad++ === 0) fail(`第 ${ch.closest('[data-role="row"]').dataset.bar} 小节的「${ch.textContent}」压在粘住的列头上面`);
      }
    }
    st.remove();
  }

  // 表格里的韵脚字：位置 = 样例算出的韵脚位置，颜色色相 = 规则色相
  const checkRhymeWords = (root, expect) => {
    for (const w of root.querySelectorAll('[data-role="word"]')) {
      const want = expect[w.dataset.abs];
      const has = w.dataset.rhyme !== undefined;
      if (!!want !== has) fail(`第 ${w.closest('[data-role="row"]').dataset.bar} 小节 tick ${w.dataset.abs}：${has ? '不该是韵脚却标了韵脚' : '应该是韵脚却没标'}`);
      if (has && want && Number(w.dataset.hue) !== want) fail(`tick ${w.dataset.abs} 的韵脚颜色 ${w.dataset.hue}° ≠ 样例 ${want}°`);
      const ch = w.querySelector('.ch');
      if (has && ch && shown(ch)) {
        const c = parse(getComputedStyle(ch).color), [h, s] = hsl(c);
        if (s < 0.3 || hueDist(h, Number(w.dataset.hue)) > 8) fail(`「${ch.textContent}」的颜色 ${getComputedStyle(ch).color} 和它那种颜色（${w.dataset.hue}°）对不上`);
      }
    }
  };
  if (screen !== 'lyrics' && screen !== 'rhyme13') checkRhymeWords(document.querySelector('.work .sheet'), fx.slots13);

  const pill = vis('[data-role="mode-pill"]')[0];
  const pressed = document.querySelector('.side [data-role="swatch"][aria-pressed="true"]') || document.querySelector('[data-role="swatch"][aria-pressed="true"]');

  if (screen === 'write') {
    if (!pill || pill.dataset.mode !== 'type') fail('模式提示不是「打字」'); else { inView(pill, '模式提示'); if (!pill.textContent.includes('打字')) fail('模式提示没写「打字」'); }
    const f = [...document.querySelectorAll('[data-role="square"][data-focus]')];
    if (f.length !== 1) fail(`光标方格应该正好 1 个，现在 ${f.length}`);
    else {
      const r = f[0].getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !hit.closest('[data-role="cell"]') || hit.closest('[data-role="square-tip"]')) fail('光标方格被气泡 / 抽屉挡住了');
    }
    const tip = vis('[data-role="square-tip"]')[0];
    if (!tip) fail('看不到改方格的气泡'); else {
      inView(tip, '改方格气泡');
      const acts = [...tip.querySelectorAll('[data-role="square-action"]')].map((b) => b.dataset.act).join(',');
      if (acts !== 'split,triplet,rest,merge') fail(`气泡里四个按钮变了：${acts}`);
    }
    if (document.querySelector('.cell.pv, [data-role="drag-tip"]')) fail('打字模式下不该有拖动预览');
    if (document.querySelector('.sheet.painting')) fail('打字模式下表格不该有涂色外框');
  } else if (screen === 'paint') {
    if (!pill || pill.dataset.mode !== 'paint') fail('看不到「涂色」模式提示');
    else {
      inView(pill, '涂色模式提示');
      if (!pressed) fail('没有按下的色块');
      else {
        if (pill.dataset.hue !== pressed.dataset.hue) fail(`模式提示的颜色 ${pill.dataset.hue}° ≠ 按下的色块 ${pressed.dataset.hue}°`);
        const bc = hsl(parse(getComputedStyle(pill).borderTopColor)), sc = hsl(parse(getComputedStyle(pressed).backgroundColor));
        if (hueDist(bc[0], sc[0]) > 8) fail(`模式提示描边的颜色和按下的色块不是同一种（${bc[0].toFixed(0)}° / ${sc[0].toFixed(0)}°）`);
        if (!pill.textContent.includes(pressed.getAttribute('aria-label').split(' ')[0])) fail('模式提示没写颜色名');
      }
      const done = pill.querySelector('[data-role="mode-done"]');
      if (!done) fail('模式提示里没有「完成」'); else { inView(done, '「完成」按钮'); if (innerWidth <= 600 && done.getBoundingClientRect().height < 36) fail(`手机上「完成」按钮太小（${done.getBoundingClientRect().height.toFixed(0)}px）`); }
      if (innerWidth > 600 && !(pill.innerText || '').includes('Esc')) fail('桌面模式提示没写 Esc');
    }
    const sheet = document.querySelector('.work .sheet');
    const oc = parse(getComputedStyle(sheet).outlineColor);
    if (getComputedStyle(sheet).outlineStyle !== 'solid' || !oc || !pressed || hueDist(hsl(oc)[0], hsl(parse(getComputedStyle(pressed).backgroundColor))[0]) > 8) fail('涂色时表格外面没有这种颜色的外框');
    const pv = [...document.querySelectorAll('.cell.pv')];
    if (pv.filter(shown).length < 2) fail('拖动预览看得见的不到 2 格');
    if (pv.length < 2) fail(`拖动预览只有 ${pv.length} 格`);
    else {
      const beats = new Set(pv.map((c) => c.dataset.beat)), bars = pv.map((c) => Number(c.dataset.bar)).sort((a, b) => a - b);
      if (beats.size !== 1) fail('拖动预览不在同一拍');
      if (bars.some((b, i) => i && b !== bars[i - 1] + 1)) fail('拖动预览的小节不连续');
      for (const c of pv) if (pressed && hueDist(hsl(parse(getComputedStyle(c).backgroundColor))[0], hsl(parse(getComputedStyle(pressed).backgroundColor))[0]) > 10) fail(`第 ${c.dataset.bar} 小节的预览底色不是这种颜色`);
      const dt = document.querySelector('[data-role="drag-tip"]');
      if (!dt) fail('没有拖动提示'); else { inView(dt, '拖动提示'); if (!dt.textContent.includes(pv.length + ' 格')) fail(`拖动提示的格数和预览（${pv.length} 格）对不上`); }
    }
    if (!vis('[data-role="brush-pointer"]').length) fail('没有画笔指针');
    if (document.querySelector('[data-role="square"][data-focus], [data-role="square-tip"]')) fail('涂色时不该有光标方格 / 改字气泡');
    if (innerWidth <= 600) {
      const dh = document.querySelector('.drawer .dh');
      const c = parse(getComputedStyle(dh).backgroundColor);
      if (!c || !pressed || hsl(c)[1] < 0.2 || hueDist(hsl(c)[0], hsl(parse(getComputedStyle(pressed).backgroundColor))[0]) > 10) fail('手机抽屉头没有换成这种颜色');
    }
  } else if (screen === 'side') {
    if (!pill || pill.dataset.mode !== 'select') fail('模式提示不是「选格子」'); else inView(pill, '选格子模式提示');
    // 选区框是 pointer-events: none 的一圈线（点得到下面的格子），所以按几何量：在视口里、有尺寸、看得见
    const box = [...document.querySelectorAll('[data-role="selection-box"]')].find((b) => { const r = b.getBoundingClientRect(), cs = getComputedStyle(b); return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.borderTopStyle === 'solid'; });
    if (!box) fail('看不到选区框');
    else {
      const cells = fx.sel.map((k) => document.querySelector(`.work [data-role="cell"][data-key="${k}"]`)).filter(Boolean);
      if (cells.length !== fx.sel.length) fail('选中的格子不全');
      const rs = cells.map((c) => c.getBoundingClientRect()), br = box.getBoundingClientRect();
      const L = Math.min(...rs.map((r) => r.left)), T = Math.min(...rs.map((r) => r.top)), R = Math.max(...rs.map((r) => r.right)), Bt = Math.max(...rs.map((r) => r.bottom));
      if (Math.abs(br.left - L) > 2 || Math.abs(br.top - T) > 2 || Math.abs(br.right - R) > 2 || Math.abs(br.bottom - Bt) > 2) fail('选区框没有正好框住选中的格子');
      for (const c of cells) if (!shown(c)) { fail(`选中的${c.dataset.bar} 小节第 ${Number(c.dataset.beat) + 1} 拍被挡住了`); break; }
    }
    for (const [role, name] of [['lock-tools', '锁定'], ['ai-tools', 'AI']]) {
      const el = vis(`[data-role="${role}"]`)[0];
      if (!el) fail(`看不到${name}那一块`); else inView(el, `${name}那一块`);
    }
  } else if (screen === 'lyrics') {
    const lines = [...document.querySelectorAll('[data-role="lyric-line"]')];
    if (lines.length !== fx.lines.length) fail(`歌词 ${lines.length} 行 ≠ 样例 ${fx.lines.length} 行`);
    lines.forEach((l, i) => {
      const want = fx.lines[i];
      if (!want) return;
      const got = l.querySelector('.lt').textContent;
      if (Number(l.dataset.bar) !== want.bar || got !== want.text) fail(`第 ${i + 1} 行应该是第 ${want.bar} 小节「${want.text}」，现在是第 ${l.dataset.bar} 小节「${got}」`);
    });
    const secs = [...document.querySelectorAll('[data-role="lyric-section"] [data-role="section-label"]')].map((x) => x.textContent);
    if (secs.join('|') !== fx.sections.join('|')) fail(`段落顺序不对：${secs.join(' / ')}`);
    const rh = [...document.querySelectorAll('[data-role="lyric-rhyme"]')];
    const want = Object.keys(fx.slots13);
    const gotSet = new Set(rh.map((x) => x.dataset.abs));
    for (const a of want) if (!gotSet.has(a)) { fail(`韵脚字（tick ${a}）在歌词页没上色`); break; }
    for (const x of rh) if (!fx.slots13[x.dataset.abs]) { fail(`「${x.textContent}」不是韵脚却上了色`); break; }
    for (const x of rh) {
      if (!shown(x)) continue;
      const c = getComputedStyle(x).color, w = fx.inkByHue && fx.inkByHue[x.dataset.hue];
      if (!w) fail(`写词页没有 ${x.dataset.hue}° 的韵脚字可以对比`);
      else if (c !== w) { fail(`歌词页「${x.textContent}」的颜色 ${c} ≠ 写词页同一种颜色的韵脚字 ${w}`); break; }
    }
    const now = [...document.querySelectorAll('.lyr-line.now')];
    if (now.length !== 1) fail(`高亮的行应该正好 1 行，现在 ${now.length}`);
    else {
      if (Number(now[0].dataset.bar) !== fx.nowBar) fail(`高亮的是第 ${now[0].dataset.bar} 小节，应该是第 ${fx.nowBar} 小节`);
      if (inView(now[0], '高亮的这一行') && now[0].getBoundingClientRect().top > innerHeight * 0.6) fail('高亮的这一行不在屏幕上半部');
      const bg = parse(getComputedStyle(now[0]).backgroundColor);
      if (!bg || bg[3] < 0.05) fail('高亮的这一行没有底色');
    }
    for (const [role, name] of [['copy-lyrics', '复制全部'], ['export-txt', '导出 .txt']]) inView(document.querySelector(`[data-role="${role}"]`), `「${name}」按钮`);
  } else if (screen === 'rhyme13') {
    const old = document.querySelector('[data-sheet="old"]'), neu = document.querySelector('[data-sheet="new"]');
    if (!old || !neu) fail('没有前后两张表');
    else {
      const seq = (s) => [...s.querySelectorAll('[data-role="word"]')].map((w) => w.dataset.abs + ':' + w.textContent).join('|');
      const pt = (s) => [...s.querySelectorAll('[data-role="cell"]')].map((c) => c.dataset.key + '=' + (c.dataset.rule || '')).join('|');
      if (seq(old) !== seq(neu)) fail('两张表的字不一样');
      if (pt(old) !== pt(neu)) fail('两张表的涂色不一样');
      const rows = [...old.querySelectorAll('[data-role="row"]')].map((r) => Number(r.dataset.bar));
      if (rows.join(',') !== fx.cmp.rows.join(',')) fail(`对比的小节 ${rows.join(',')} 不是 ${fx.cmp.rows.join(',')}`);
      const dashed = (s) => [...s.querySelectorAll('[data-role="word"]')].filter((w) => getComputedStyle(w).outlineStyle === 'dashed');
      const flagged = (s) => s.querySelectorAll('[data-role="word"][data-mismatch]').length;
      const nOld = dashed(old).length, nNew = dashed(neu).length;
      if (nOld < 1) fail('旧规则一处「不押」都没有');
      if (nNew !== 0 || flagged(neu) !== 0) fail(`十三辙还有 ${Math.max(nNew, flagged(neu))} 处「不押」`);
      if (nOld !== flagged(old)) fail(`旧规则虚线 ${nOld} 处 ≠ 标了不押的 ${flagged(old)} 处`);
      if (nOld !== fx.cmp.old || nNew !== fx.cmp.new) fail(`不押的数（旧 ${nOld} / 新 ${nNew}）≠ 用样例独立算的（旧 ${fx.cmp.old} / 新 ${fx.cmp.new}）`);
      for (const [s, n, side] of [[old, nOld, '旧'], [neu, nNew, '新']]) {
        const lab = s.closest('.cmp-col').querySelector('[data-role="miss-count"]');
        if (!lab || !lab.textContent.includes(n + ' 处')) fail(`${side}规则那边写的数和表里的虚线数（${n}）对不上`);
      }
      for (const w of dashed(old)) if (!shown(w)) { fail(`旧规则的「不押」tick ${w.dataset.abs} 被挡住了`); break; }
      for (const s of [old, neu]) {
        const cells = [...s.querySelectorAll('[data-role="cell"]')];
        for (const c of [cells[0], cells[cells.length - 1]]) if (!c || !shown(c)) { fail(`${s.dataset.sheet === 'old' ? '旧' : '新'}规则那张表的${c === cells[0] ? '第一' : '最后一'}格被挡住了`); break; }
      }
    }
    const b = document.querySelector('[data-role="migrate-banner"]');
    if (inView(b, '迁移横幅')) {
      inView(b.querySelector('[data-role="migrate-yes"]'), '「改用十三辙」');
      inView(b.querySelector('[data-role="migrate-no"]'), '「先不改」');
      if (!b.textContent.includes(fx.allOld + ' 处')) fail(`横幅里的全曲不押数不是 ${fx.allOld}`);
    }
    if (innerWidth > 600) {
      const modes = [...document.querySelectorAll('.side [data-role="judge-mode"] button')].map((x) => x.textContent);
      if (modes.join('|') !== '十三辙|严格韵母') fail(`判押韵应该是两档「十三辙 | 严格韵母」，现在是 ${modes.join(' | ')}`);
      const zt = document.querySelector('.side [data-role="zhe-table"]');
      if (!zt || zt.querySelectorAll('b').length !== 13) fail('辙表不是 13 行');
    }
  }
  peStyle.remove();
  return fails;
}
"""

# 写词页上每种颜色的韵脚字颜色（给歌词页逐个比）
INK_JS = r"""
() => {
  // 表格里已经有的韵脚字直接读；没露出来的颜色，在写词页的同一张表里按 LyricsGrid 的写法（.wd.rp > .ch，--h = 色相）现放一个字读出来再删掉
  const out = {}, bad = [];
  for (const w of document.querySelectorAll('.work [data-role="word"][data-hue] .ch')) {
    const h = w.parentElement.dataset.hue;
    if (!out[h]) out[h] = getComputedStyle(w).color;
  }
  const cell = document.querySelector('.work [data-role="cell"]');
  for (const sw of document.querySelectorAll('[data-role="swatch"]')) {
    const h = sw.dataset.hue;
    const el = document.createElement('span');
    el.className = 'wd rp'; el.style.setProperty('--h', h); el.style.setProperty('--t', '0'); el.style.setProperty('--l', '12');
    el.innerHTML = '<span class="ch">字</span>';
    cell.appendChild(el);
    const c = getComputedStyle(el.firstChild).color;
    el.remove();
    if (out[h] && out[h] !== c) bad.push(h);
    out[h] = out[h] || c;
  }
  return out;
}
"""

# 反向探针：(画面, 尺寸, 说明, 改坏页面的 JS)。改完之后 PROBE_JS 必须报至少一条错
MUTATIONS = [
    ("paint", "desktop", "模式提示藏起来", "document.querySelector('[data-role=\"mode-pill\"]').style.display='none';"),
    ("paint", "desktop", "模式提示换成别的颜色（和按下的色块不一致）",
     "const p=document.querySelector('[data-role=\"mode-pill\"]'); p.style.setProperty('--h','150'); p.dataset.hue='150';"),
    ("paint", "desktop", "模式提示被一块浮层盖住一角",
     "const p=document.querySelector('[data-role=\"mode-pill\"]').getBoundingClientRect(); const d=document.createElement('div'); d.style.cssText='position:fixed;z-index:60;background:#888;width:30px;height:30px;left:'+(p.right-20)+'px;top:'+(p.top-10)+'px'; document.body.appendChild(d);"),
    ("paint", "mobile", "手机上「完成」按钮缩成 24px 高",
     "const b=document.querySelector('[data-role=\"mode-done\"]'); b.style.height='24px'; b.style.minHeight='0';"),
    ("paint", "desktop", "涂色时还留着改字气泡（同一次点击两种意思）",
     "const c=document.querySelector('.cell.pv'); c.insertAdjacentHTML('beforeend','<div class=\"sq-tip\" data-role=\"square-tip\" style=\"top:auto;bottom:0;left:0;width:10px;height:10px;padding:0\"></div>');"),
    ("write", "desktop", "模式提示的字被截掉（溢出）",
     "const b=document.querySelector('[data-role=\"mode-pill\"] b'); b.style.cssText='display:inline-block;width:9px;overflow:hidden;white-space:nowrap';"),
    ("write", "desktop", "工具条上一段字挪到精度按钮上（重叠）",
     "const s=document.querySelector('.tools .status'), c=document.querySelector('[data-role=\"precision\"]'); const sr=s.getBoundingClientRect(), cr=c.getBoundingClientRect(); s.style.transform='translateX('+(cr.left-sr.left+30)+'px)'; s.style.position='relative'; s.style.zIndex='9';"),
    ("write", "mobile", "光标方格被底部气泡挡住",
     "const f=document.querySelector('[data-role=\"square\"][data-focus]').getBoundingClientRect(); document.querySelector('[data-role=\"square-tip\"]').style.bottom=(innerHeight-f.bottom-12)+'px';"),
    ("write", "desktop", "一个不是韵脚位置的字被标成韵脚",
     "const w=[...document.querySelectorAll('.work [data-role=\"word\"]')].find(x=>!x.dataset.rhyme && x.querySelector('.ch')); w.dataset.rhyme='an'; w.dataset.hue='215';"),
    ("side", "desktop", "选区框往下偏了 30px",
     "const b=document.querySelector('[data-role=\"selection-box\"]'); b.style.top=(parseFloat(b.style.top)+30)+'px';"),
    ("lyrics", "desktop", "歌词页一个韵脚字换了颜色（和写词页不一致）",
     "const x=[...document.querySelectorAll('[data-role=\"lyric-rhyme\"]')].find(e=>{const r=e.getBoundingClientRect(); return r.top>200&&r.bottom<innerHeight;}); x.style.color='rgb(200,30,30)';"),
    ("lyrics", "desktop", "多高亮了一行",
     "document.querySelectorAll('[data-role=\"lyric-line\"]')[5].classList.add('now');"),
    ("lyrics", "desktop", "一行歌词少了一个字",
     "const t=document.querySelectorAll('[data-role=\"lyric-line\"] .lt')[10]; t.lastChild.textContent = t.lastChild.textContent.slice(0,-1);"),
    ("lyrics", "desktop", "复制按钮藏起来", "document.querySelector('[data-role=\"copy-lyrics\"]').style.display='none';"),
    ("rhyme13", "desktop", "十三辙那张表多了一处「不押」",
     "const w=document.querySelector('[data-sheet=\"new\"] [data-role=\"word\"][data-rhyme]'); w.classList.add('miss'); w.dataset.mismatch='x≠an';"),
    ("rhyme13", "desktop", "旧规则那张表的「不押」全被抹掉",
     "for (const w of document.querySelectorAll('[data-sheet=\"old\"] [data-role=\"word\"]')) { w.classList.remove('miss'); delete w.dataset.mismatch; } for (const l of document.querySelectorAll('[data-sheet=\"old\"]')) l.closest('.cmp-col').querySelector('[data-role=\"miss-count\"]').textContent='0 处「不押」';"),
    ("rhyme13", "mobile", "手机上第二张表被往下挤到抽屉底下",
     "document.querySelector('[data-role=\"compare-new\"]').style.marginTop='90px';"),
    ("write", "mobile", "列头层级改回现网的 4（往上滚的字压在列头上）",
     "document.querySelector('.work .sh-head').style.zIndex='4';"),
    ("write", "desktop", "页面加一个超宽元素（左右溢出）",
     "const d=document.createElement('div'); d.style.cssText='position:absolute;left:0;top:0;width:2000px;height:4px'; document.body.appendChild(d); document.body.style.overflowX='auto'; document.documentElement.style.overflowX='auto';"),
]


# paint 画面是「正在涂」：Hook A 1 第 28–33 小节第 4 拍还没涂（第 28–31 小节是拖动预览，松手才算）
UNPAINTED = {"paint": {f"b{i}:3" for i in range(27, 33)}}


def fixture_for(screen: str, size: str, fx: dict, ink=None) -> dict:
    skip = UNPAINTED.get(screen, set())
    return {
        "tab": TAB.get(screen, "write"),
        "slots13": {a: h for a, h in fx["slots13"].items() if fx["slotKey13"][a] not in skip},
        "lines": fx["lines"],
        "sections": fx["sections"],
        "nowBar": fx["nowBar"],
        "sel": fx["sel"],
        "cmp": fx["cmp"][size],
        "allOld": fx["allOld"],
        "inkByHue": ink,
    }


def open_page(browser, mock, screen, w, h, scheme, scale=1):
    page = browser.new_page(viewport={"width": w, "height": h}, color_scheme=scheme, device_scale_factor=scale)
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(f"页面异常 {e}"))
    page.on("console", lambda m: errors.append(f"控制台 {m.text}") if m.type == "error" else None)
    page.on("request", lambda r: errors.append(f"外网请求 {r.url}") if not r.url.startswith("file:") else None)
    page.goto((mock / f"{screen}.html").as_uri())
    page.wait_for_timeout(200)
    return page, errors


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    root = pathlib.Path(sys.argv[1]).resolve()
    ev = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("ANYBEATS_EVIDENCE")
    evidence = pathlib.Path(ev).resolve() if ev else None
    mock = root / "mockups_v34"
    shots = root / "screenshots_v34"
    shots.mkdir(parents=True, exist_ok=True)
    if evidence:
        (evidence / "screenshots_v34").mkdir(parents=True, exist_ok=True)
    fx = load_fixture(root)
    bad = 0
    log: list[str] = []

    def say(line: str) -> None:
        print(line)
        log.append(line)

    say(f"样例：{len(fx['lines'])} 行歌词、{len(fx['slots13'])} 个韵脚位置、十三辙下 {fx['rules13']} 种颜色；"
        f"对比段旧规则不押 桌面 {fx['cmp']['desktop']['old']} / 手机 {fx['cmp']['mobile']['old']}，全曲 {fx['allOld']}")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        inks: dict = {}
        for size, (w, h) in SIZES.items():
            for scheme in SCHEMES:
                page, _ = open_page(browser, mock, "write", w, h, scheme)
                inks[(size, scheme)] = page.evaluate(INK_JS)
                page.close()
        for screen in SCREENS:
            for size, (w, h) in SIZES.items():
                for scheme in SCHEMES:
                    tag = f"{screen}_{size}_{scheme}"
                    page, errors = open_page(browser, mock, screen, w, h, scheme, SCALE)
                    page.screenshot(path=str(shots / f"{tag}.png"))
                    if evidence:
                        shutil.copy(shots / f"{tag}.png", evidence / "screenshots_v34" / f"{tag}.png")
                    fails = errors + page.evaluate(PROBE_JS, [screen, fixture_for(screen, size, fx, inks[(size, scheme)])])
                    page.close()
                    if fails:
                        bad += 1
                        say(f"✗ {tag}")
                        for f in fails:
                            say(f"    {f}")
                    else:
                        say(f"✓ {tag}")
        total = len(SCREENS) * len(SIZES) * len(SCHEMES)
        say(f"{total - bad}/{total} 个组合通过")

        missed = 0
        say("反向探针（故意改坏，检查必须报错）：")
        for screen, size, what, js in MUTATIONS:
            w, h = SIZES[size]
            page, errors = open_page(browser, mock, screen, w, h, "light")
            f0 = fixture_for(screen, size, fx, inks[(size, "light")])
            base = errors + page.evaluate(PROBE_JS, [screen, f0])
            page.evaluate("() => {" + js + "}")
            fails = page.evaluate(PROBE_JS, [screen, f0])
            page.close()
            if base:
                missed += 1
                say(f"  ✗ [{screen} {size}] {what}：改坏之前就不过（{base[0]}），探针无效")
            elif not fails:
                missed += 1
                say(f"  ✗ [{screen} {size}] {what}：改坏了检查却没报错")
            else:
                say(f"  ✓ [{screen} {size}] {what} → {fails[0]}")
        say(f"反向探针 {len(MUTATIONS) - missed}/{len(MUTATIONS)} 条咬住")
        browser.close()

    if evidence:
        (evidence / "check_mockups_v34.log").write_text("\n".join(log) + "\n", encoding="utf-8")
    return 1 if bad or missed else 0


if __name__ == "__main__":
    sys.exit(main())
