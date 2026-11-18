/* AnyBeats v3.4 视觉稿：「铺 flow」和「填字 / 押韵」合成一个「写词」页（画笔模式）；空出来的页签改成「歌词」展示页；押韵判断改十三辙。
 * 五个画面共用这一份渲染脚本，画面由 <body data-screen="…"> 决定：
 *   write    写词页 · 打字模式：点方格打字（和 v3.2 一样），韵脚颜色一直在格子上
 *   paint    写词页 · 涂色模式：在侧栏点了粉色 = 拿起画笔，正从第 28 小节第 4 拍往下拖到第 31 小节（还没松手）
 *   side     写词页 · 选格子：点了第 13 小节行头再 Shift 点第 14 小节，侧栏的锁定 / AI 对着这块选区
 *   lyrics   歌词页：按段落一行一句，韵脚字带颜色；正在播 Hook A 1 第 3 句（第 28 小节）
 *   rhyme13  十三辙判韵前后对比：同一段 Verse 1，左 = 旧规则（严格韵母，蓝色 = an），右 = 十三辙（蓝色 = 言前辙）
 * 字、节奏、涂色全部来自 design/fixtures_v34（用户自己写的中文词 v4），拼音来自 pinyin-pro 逐字。
 * DOM 照 src/components/LyricsGrid.tsx / App.tsx / RulePanel.tsx 的结构和 class 写，样式是 src/App.css 的逐字节拷贝 + v34.css。
 * 不外链任何资源，不发请求。
 */
(function () {
  'use strict';

  var TPB = 48, TPBAR = 192;
  var S = document.body.getAttribute('data-screen');
  var K = window.KOI;
  var MOBILE = innerWidth <= 600;

  /* ---------- 图标（和 src/components/icons.tsx 同一套线条） ---------- */
  function svg(p, vb) { return '<svg viewBox="' + (vb || '0 0 16 16') + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; }
  var I = {
    undo: svg('<path d="M5 4 2 7l3 3"/><path d="M2.5 7H10a4 4 0 0 1 0 8H7"/>'),
    redo: svg('<path d="m11 4 3 3-3 3"/><path d="M13.5 7H6a4 4 0 0 0 0 8h3"/>'),
    hist: svg('<path d="M2.5 8a5.5 5.5 0 1 0 1.7-4"/><path d="M2.5 2.5V5H5"/><path d="M8 5v3l2 1.5"/>'),
    play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="2.5" width="3" height="11" rx="1" fill="currentColor"/><rect x="9.5" y="2.5" width="3" height="11" rx="1" fill="currentColor"/></svg>',
    start: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="2" height="10" rx="1" fill="currentColor"/><path d="M13 3v10L6 8z" fill="currentColor"/></svg>',
    metro: svg('<path d="M6 2h4l3 12H3z"/><path d="M8 11 11.5 4"/>'),
    guide: svg('<path d="M2 10v-4M5 12V4M8 13V3M11 11V5M14 9V7"/>'),
    folder: svg('<path d="M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z"/>'),
    out: svg('<path d="M8 2v8"/><path d="m5 7 3 3 3-3"/><path d="M3 13h10"/>'),
    swap: svg('<path d="M3 5h9l-2-2"/><path d="M13 11H4l2 2"/>'),
    up: svg('<path d="m4 10 4-4 4 4"/>'),
    lock: svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'),
    close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
    pen: svg('<path d="M10.5 2.5l3 3L6 13H3v-3z"/>'),
    brush: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4l6 6-8.5 8.5-6-6z" fill="currentColor" opacity=".9"/><path d="M5.5 12.5l6 6c-1.5 2.5-4.5 3.5-8 3 .3-3.4 1-6.5 2-9z" fill="currentColor"/></svg>',
    brushPt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4l6 6-8.5 8.5-6-6z" fill="#fff" stroke="#111" stroke-width="1.5"/><path d="M5.5 12.5l6 6c-1.5 2.5-4.5 3.5-8 3 .3-3.4 1-6.5 2-9z" fill="#111"/></svg>',
    select: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke-dasharray="2.5 2"/>'),
    copy: svg('<rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3 10.5V3.5A1 1 0 0 1 4 2.5h6.5"/>'),
    text: svg('<path d="M3 4h10M8 4v9"/>')
  };

  /* ---------- 十三辙（和 src/core/rhyme/syllable.ts 的 FINAL_TO_GROUP / splitSyllable 一字不差） ---------- */
  var INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's'];
  var Y_F = { yi: 'i', ya: 'ia', ye: 'ie', yao: 'iao', you: 'iu', yan: 'ian', yang: 'iang', yin: 'in', ying: 'ing', yong: 'iong', yu: 'ü', yue: 'üe', yuan: 'üan', yun: 'ün', yo: 'o' };
  var W_F = { wu: 'u', wa: 'ua', wo: 'uo', wai: 'uai', wei: 'ui', wan: 'uan', wen: 'un', wang: 'uang', weng: 'ueng' };
  function splitFinal(py) {
    var s = py.toLowerCase().replace(/v/g, 'ü').replace(/u:/g, 'ü');
    if (Y_F[s]) return Y_F[s];
    if (W_F[s]) return W_F[s];
    var ini = INITIALS.filter(function (i) { return s.indexOf(i) === 0; })[0] || '';
    var f = s.slice(ini.length);
    if (f === 'i' && ['zh', 'ch', 'sh', 'r', 'z', 'c', 's'].indexOf(ini) >= 0) f = '-i';
    if (['j', 'q', 'x'].indexOf(ini) >= 0 && f.charAt(0) === 'u') f = 'ü' + f.slice(1);
    if (f === 'iou') f = 'iu';
    if (f === 'uei') f = 'ui';
    if (f === 'uen') f = 'un';
    return f;
  }
  // [辙 id, 辙名, 韵母, 例字]
  var ZHE = [
    ['fahua', '发花', ['a', 'ia', 'ua'], '花 家 夸'],
    ['suobo', '梭波', ['o', 'e', 'uo'], '波 歌 多'],
    ['miexie', '乜斜', ['ie', 'üe', 'ê'], '街 月 写'],
    ['yiqi', '一七', ['i', 'ü', '-i', 'er'], '记 雨 是 儿'],
    ['gusu', '姑苏', ['u'], '路 苦 书'],
    ['huailai', '怀来', ['ai', 'uai'], '来 怀 爱'],
    ['huidui', '灰堆', ['ei', 'ui'], '累 泪 碎'],
    ['yaotiao', '遥条', ['ao', 'iao'], '跑 跳 摇'],
    ['youqiu', '由求', ['ou', 'iu'], '走 求 有'],
    ['yanqian', '言前', ['an', 'ian', 'uan', 'üan'], '半 边 弯 远'],
    ['renchen', '人辰', ['en', 'in', 'un', 'ün'], '人 心 春 云'],
    ['jiangyang', '江阳', ['ang', 'iang', 'uang'], '光 香 忘'],
    ['zhongdong', '中东', ['eng', 'ing', 'ong', 'iong', 'ueng'], '风 星 东 用']
  ];
  var GROUP = {}, GNAME = {};
  ZHE.forEach(function (z) { z[2].forEach(function (f) { GROUP[f] = z[0]; }); GNAME[z[0]] = z[1]; });
  function lit(f) { return f === '-i' ? 'i' : f; }
  function groupOfWant(want) { return GROUP[want] || GROUP[splitFinal(want)] || null; }
  function finalOfChar(ch) { var py = K.pinyin[ch]; return py ? splitFinal(py) : null; }
  /** 一个字押没押上：strict = 字面韵母完全相同（现网）；thirteen = 同一辙（本稿推荐的默认） */
  function matches(got, want, mode) {
    if (mode === 'strict') return lit(got) === want;
    var g = GROUP[got];
    return !!g && g === groupOfWant(want);
  }

  /* ---------- 数据：小节和字 ---------- */
  var BARS = [], SECS = [], BY_ID = {};
  K.sections.forEach(function (s, si) {
    var sec = { label: s.label, kind: s.kind, first: BARS.length, bars: [] };
    s.bars.forEach(function (b) {
      var g = BARS.length;
      var bar = { g: g, id: b.id, sec: si, words: b.w.map(function (w) { return { abs: g * TPBAR + w[0], tick: w[0], len: w[1], text: w[2] }; }) };
      bar.words.forEach(function (w) { w.beat = Math.floor(w.tick / TPB); w.off = w.tick % TPB; w.key = b.id + ':' + w.beat; w.sqBox = Math.min(w.len, TPB - w.off); w.g = g; });
      BARS.push(bar); sec.bars.push(bar); BY_ID[b.id] = bar;
    });
    SECS.push(sec);
  });
  var ALL_WORDS = [];
  BARS.forEach(function (b) { b.words.forEach(function (w) { ALL_WORDS.push(w); }); });
  function wordsInCell(bar, beat) { return bar.words.filter(function (w) { return w.beat === beat; }); }
  function beatMode(ws) {
    var offs = ws.map(function (w) { return w.off; });
    if (offs.some(function (o) { return o === 8 || o === 40; })) return 't6';
    if (offs.some(function (o) { return o === 16 || o === 32; })) return 't3';
    return '';
  }
  BARS.forEach(function (b) {
    [0, 1, 2, 3].forEach(function (beat) {
      var ws = wordsInCell(b, beat), m = beatMode(ws);
      ws.forEach(function (w) { var u = w.off % 12 === 6 ? 6 : m === 't6' ? 8 : m === 't3' ? 16 : 12; w.box = Math.min(w.len, u); });
    });
  });

  /* ---------- 颜色规则 ---------- */
  var RULE_NAMES = { 215: '蓝色', 150: '绿色', 340: '粉色', 42: '金色', 185: '青色', 100: '草绿', 10: '红色', 240: '靛蓝' };
  /** 两条规则同韵：押数相同、每一位同韵（thirteen = 同辙；strict = 韵母字面相同）——src/core/rhymeRules.ts mergeSameRules 换成按判韵档比 */
  function sameRhyme(a, b, mode) {
    if (a.count !== b.count) return false;
    return a.finals.every(function (f, i) { return mode === 'strict' ? f === b.finals[i] : !!groupOfWant(f) && groupOfWant(f) === groupOfWant(b.finals[i]); });
  }
  function mergeRules(rules, paint, mode) {
    var kept = [], map = {};
    rules.forEach(function (r) {
      var k = kept.filter(function (x) { return sameRhyme(x, r, mode); })[0];
      if (k) map[r.id] = k.id; else { kept.push(r); map[r.id] = r.id; }
    });
    var p = {};
    Object.keys(paint).forEach(function (key) { p[key] = map[paint[key]]; });
    return { rules: kept, paint: p };
  }
  // 改用十三辙后的样子：v4 里 15 条规则（为了绕开严格判韵，同一种颜色拆成好几条）按辙合成 6 条，颜色都不变
  var M13 = mergeRules(K.rules, K.paint, 'thirteen');
  var RULE_BY_ID = {};
  K.rules.forEach(function (r) { RULE_BY_ID[r.id] = r; });
  function ruleName(r) { return RULE_NAMES[r.hue] || ('颜色 ' + r.hue + '°'); }
  function zheName(r) { var g = groupOfWant(r.finals[0]); return g ? GNAME[g] + '辙' : r.finals.join(' '); }

  /** 全曲的韵脚位置：涂了色的格子里最后 count 个字（src/core/rhymeRules.ts rhymeSlots） */
  function rhymeSlots(rules, paint, mode) {
    var byId = {}, out = {};
    rules.forEach(function (r) { byId[r.id] = r; });
    BARS.forEach(function (b) {
      [0, 1, 2, 3].forEach(function (beat) {
        var key = b.id + ':' + beat, r = byId[paint[key]];
        if (!r) return;
        var ws = wordsInCell(b, beat), rp = ws.slice(Math.max(0, ws.length - r.count));
        rp.forEach(function (w, j) {
          var want = r.finals[j + (r.count - rp.length)] || '';
          var got = w.text ? finalOfChar(Array.from(w.text).pop()) : null;
          out[w.abs] = { rule: r, want: want, got: got, ok: got === null || !want ? null : matches(got, want, mode) };
        });
      });
    });
    return out;
  }

  /* ---------- 小工具 ---------- */
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function range(a, b) { var o = []; for (var g = a; g <= b; g++) o.push(g); return o; }
  function cellName(g, beat) { return '第 ' + (g + 1) + ' 小节第 ' + (beat + 1) + ' 拍'; }
  function secOf(g) { return SECS[BARS[g].sec]; }
  function mmss(sec) { var m = Math.floor(sec / 60), s = Math.floor(sec % 60); return m + ':' + pad(s); }
  var SIZE = { cell: MOBILE ? 86 : 170, base: MOBILE ? 15 : 19 };
  function fontFor(box) {
    var boxPx = box / TPB * SIZE.cell - 2, inner = boxPx - 2;
    if (inner >= SIZE.base) return SIZE.base;
    if (inner >= 11) return Math.floor(inner);
    return Math.max(1, Math.min(11, Math.floor(boxPx - 1)));
  }

  /* ---------- 画面配置 ---------- */
  var B = function (id) { return BY_ID[id].g; };
  var CFG = {
    write: { tab: 'write', mode: 'type', rows: range(B('b3'), MOBILE ? B('b16') : B('b12')), blank: { b10: 3 }, focus: { bar: 'b10', index: 3 }, active: 'r_ian', nowBar: B('b10') },
    paint: { tab: 'write', mode: 'paint', rows: range(B('b23'), B('b32')), active: 'r_iao', unpaint: ['b27:3', 'b28:3', 'b29:3', 'b30:3', 'b31:3', 'b32:3'], preview: ['b27:3', 'b28:3', 'b29:3', 'b30:3'], pointer: 'b30:3', nowBar: B('b26') },
    side: { tab: 'write', mode: 'select', rows: range(B('b9'), MOBILE ? B('b22') : B('b16')), active: 'r_ian', sel: ['b12', 'b13'], lockBars: ['b10'], rhymeLock: true, nowBar: B('b12') },
    lyrics: { tab: 'lyrics', nowBar: B('b27'), nowChar: '笑' },
    rhyme13: { tab: 'write', mode: 'type', rows: MOBILE ? range(B('b11'), B('b13')) : range(B('b9'), B('b16')), active: 'r_an_only', nowBar: B('b9') }
  };
  var C = CFG[S] || CFG.write;

  /* 文档状态：默认是「改用十三辙以后」（6 种颜色）；write 画面第 11 小节正在重写（后面的字清空了） */
  var MODE = 'thirteen';
  var RULES = M13.rules, PAINT = Object.assign({}, M13.paint);
  (C.unpaint || []).forEach(function (k) { delete PAINT[k]; });
  if (C.blank) Object.keys(C.blank).forEach(function (id) { BY_ID[id].words.forEach(function (w, i) { if (i >= C.blank[id]) w.text = ''; }); });
  var SLOTS = rhymeSlots(RULES, PAINT, MODE);
  var ACTIVE = RULES.filter(function (r) { return r.id === C.active; })[0] || RULES[0];

  /* ---------- 表格 ---------- */
  function tintsFor(c0, slots) {
    var h = '';
    ALL_WORDS.forEach(function (w) {
      if (w.len <= w.box) return;
      var ls = w.abs, le = w.abs + w.len;
      if (le <= c0 || ls >= c0 + TPB) return;
      var s = Math.max(ls, c0), e = Math.min(le, c0 + TPB), head = s === ls, tail = e === le;
      var sl = slots[w.abs], tone = sl ? 'rp' : w.text ? 'ink' : 'empty';
      var pct = function (t) { return ((t - c0) / TPB * 100).toFixed(4); };
      var left = head ? 'calc(' + pct(s) + '% + 1px)' : '-1px', right = tail ? 'calc(' + (100 - pct(e)) + '% + 1px)' : '-1px';
      h += '<span class="tint ' + tone + (head ? '' : ' cont') + (tail ? '' : ' more') + '" data-role="hold-tint" data-s="' + s + '" data-e="' + e + '" style="left:' + left + ';right:' + right + (sl ? ';--h:' + sl.rule.hue : '') + '"></span>';
    });
    return h;
  }
  function tripHTML(ws) {
    var offs = ws.map(function (w) { return w.off; });
    var full = offs.some(function (o) { return o === 16 || o === 32; }) && offs.every(function (o) { return o === 0 || o === 16 || o === 32; });
    if (full) return '<span class="trip" data-role="triplet-mark"><b>3</b></span>';
    var h = '';
    if (offs.some(function (o) { return o === 8 || o === 16; })) h += '<span class="trip half" data-role="triplet-mark"><b>3</b></span>';
    if (offs.some(function (o) { return o === 32 || o === 40; })) h += '<span class="trip half h2" data-role="triplet-mark"><b>3</b></span>';
    return h;
  }

  /** 一张表：rows = 全曲小节号（从 0 数）。o = { slots, rules, paint, focusAbs, preview{}, sel{}, lockBars{}, rhymeLock, nowAbs, tag } */
  function sheetHTML(rows, o) {
    var h = '<div class="sheet' + (o.cls ? ' ' + o.cls : '') + '" data-role="lyrics-sheet" data-step="1"' + (o.tag ? ' data-sheet="' + o.tag + '" data-rule-mode="' + o.mode + '"' : '') + (o.hue != null ? ' style="--h:' + o.hue + '"' : '') + '>';
    h += '<div class="sh-head"><div class="corner">小节 \\ 拍</div>';
    for (var bi = 0; bi < 4; bi++) h += '<div class="colh" data-role="beat-head" data-beat="' + bi + '"><button class="bn" data-role="beat-head-btn" aria-label="选中第 ' + (bi + 1) + ' 拍整列"><span class="num">' + (bi + 1) + '</span><span class="rul"><i style="left:0"></i><i style="left:25%"></i><i style="left:50%"></i><i style="left:75%"></i></span></button></div>';
    h += '<div class="lab-h">韵脚</div></div>';
    var lastSec = -1;
    rows.forEach(function (g) {
      var bar = BARS[g];
      if (bar.sec !== lastSec) {
        if (lastSec >= 0) h += '</div>';
        var sec = SECS[bar.sec];
        h += '<div class="sec" data-role="section">' + (o.noSecHead ? '' : '<div class="sec-h" data-role="section-header"><b data-role="section-label">' + esc(sec.label) + '</b><span>' + sec.bars.length + ' 小节</span></div>');
        lastSec = bar.sec;
      }
      h += rowHTML(bar, o);
    });
    if (lastSec >= 0) h += '</div>';
    return h + '</div>';
  }

  function rowHTML(bar, o) {
    var locked = o.lockBars && o.lockBars[bar.id];
    var rowSel = o.sel && [0, 1, 2, 3].every(function (b) { return o.sel[bar.id + ':' + b]; });
    var h = '<div class="row" data-role="row" data-bar="' + (bar.g + 1) + '" data-bar-id="' + bar.id + '">';
    h += '<div class="rh' + (rowSel ? ' on' : '') + '" data-role="row-head" data-bar="' + (bar.g + 1) + '"><b>' + pad(bar.g + 1) + '</b>' + (locked ? '<span data-role="lock-icon">' + I.lock + '</span>' : '') + '</div>';
    var tags = [], miss = [];
    for (var beat = 0; beat < 4; beat++) {
      var key = bar.id + ':' + beat, c0 = bar.g * TPBAR + beat * TPB, ws = wordsInCell(bar, beat);
      var rule = ws.length ? (o.rules.filter(function (r) { return r.id === o.paint[key]; })[0] || null) : null;
      var pv = o.preview && o.preview[key];
      var cls = ['cell'];
      if (rule) cls.push('painted');
      if (locked) cls.push('locked');
      if (pv) cls.push('pv');
      if (o.nowCell === key) cls.push('now');
      var focusW = ws.filter(function (w) { return w.abs === o.focusAbs; })[0];
      if (focusW) cls.push('editing');
      var hue = rule ? rule.hue : pv ? o.hue : null;
      h += '<div class="' + cls.join(' ') + '" data-role="cell" data-bar="' + (bar.g + 1) + '" data-beat="' + beat + '" data-key="' + key + '" data-c0="' + c0 + '" data-content="' + (ws.length ? 'words' : 'empty') + '"' + (pv ? ' data-preview="1"' : '') + (rule ? ' data-rule="' + rule.id + '"' : '') + (hue != null ? ' style="--h:' + hue + '"' : '') + '>';
      h += '<span class="tk" data-role="tick-line" style="left:0%"></span><span class="tk" data-role="tick-line" style="left:25%"></span><span class="tk" data-role="tick-line" style="left:50%"></span><span class="tk" data-role="tick-line" style="left:75%"></span>';
      h += tripHTML(ws);
      h += tintsFor(c0, o.slots);
      ws.forEach(function (w) {
        var sl = o.slots[w.abs], k = ['sq', w.text ? 'filled' : 'empty'];
        if (sl) k.push('rp');
        if (w === focusW) k.push('focus');
        if (w.sqBox <= 6) k.push('w32');
        h += '<span class="' + k.join(' ') + '" data-role="square" data-square="' + (w.text ? 'filled' : 'empty') + '" data-abs="' + w.abs + '" data-tick="' + w.off + '" data-box="' + w.sqBox + '"' + (w === focusW ? ' data-focus="1"' : '') +
          ' style="--t:' + w.off + ';--l:' + w.sqBox + (sl ? ';--h:' + sl.rule.hue : '') + ';--cw:' + (w.text ? fontFor(w.box) + 'px' : '0px') + '">' + (w === focusW ? '<span class="caret" aria-hidden="true"></span>' : '') + '</span>';
      });
      ws.forEach(function (w) {
        var sl = o.slots[w.abs], f = fontFor(w.box), k = ['wd'];
        if (sl) k.push('rp');
        if (!w.text) k.push('blank');
        if (f < SIZE.base) k.push('narrow');
        if (sl && sl.ok === false) k.push('miss');
        if (o.nowAbs === w.abs) k.push('now');
        var ph = !w.text && sl ? (o.mode === 'strict' ? sl.want : (GNAME[groupOfWant(sl.want)] || sl.want)) : '';
        h += '<span class="' + k.join(' ') + '" data-role="word" data-kind="word" data-abs="' + w.abs + '" data-tick="' + w.off + '" data-len="' + w.len + '" data-box="' + w.box + '"' +
          (sl ? ' data-rhyme="' + esc(sl.want) + '" data-hue="' + sl.rule.hue + '"' : '') + (sl && sl.ok === false ? ' data-mismatch="' + esc(sl.got + '≠' + sl.want) + '"' : '') + (sl && sl.got ? ' data-got="' + esc(sl.got) + '"' : '') +
          ' style="--t:' + w.off + ';--l:' + w.box + ';--fs:' + f + 'px' + (sl ? ';--h:' + sl.rule.hue : '') + '">' +
          (w.text ? '<span class="ch">' + esc(w.text) + '</span>' : ph ? '<span class="ph" data-role="placeholder">' + esc(ph) + '</span>' : '') +
          (sl && o.rhymeLock ? '<span class="slock" data-role="lock-icon">' + I.lock + '</span>' : '') + '</span>';
        if (sl && sl.ok === false) miss.push({ w: w, sl: sl });
      });
      if (rule && tags.indexOf(rule) < 0) tags.push(rule);
      if (focusW) h += bubbleHTML(focusW, bar, beat);
      h += '</div>';
    }
    var lab = '';
    if (miss.length) lab += '<span class="miss-tag" data-role="mismatch">「' + esc(miss[0].w.text) + '」' + esc(miss[0].sl.got) + ' ≠ ' + esc(miss[0].sl.want) + '</span>';
    tags.forEach(function (r) { lab += '<span class="rtag" style="--h:' + r.hue + '"><i></i>' + esc(o.mode === 'strict' ? r.finals.join('·') : (GNAME[groupOfWant(r.finals[0])] || r.finals.join('·'))) + '</span>'; });
    h += '<div class="lab">' + lab + '</div></div>';
    return h;
  }

  /* 改方格的按键气泡（v3.2 SquareEditor 原样，多一行韵脚说明） */
  function bubbleHTML(w, bar, beat) {
    function act(label, keys, name, off) { return '<button class="act" data-role="square-action" data-act="' + name + '"' + (off ? ' disabled' : '') + '><b>' + label + '</b><span>' + keys + '</span></button>'; }
    var cellRule = RULES.filter(function (r) { return r.id === PAINT[bar.id + ':' + beat]; })[0];
    var box = w.sqBox, nm = { 48: '1/4', 24: '1/8', 12: '1/16', 6: '1/32', 16: '三连', 8: '半拍三连' }[box] || box + ' tick';
    return '<input class="sq-input" data-role="square-input" aria-label="' + cellName(bar.g, beat) + '的 ' + nm + ' 方格" style="--t:' + w.off + ';--l:' + box + '">' +
      '<div class="sq-tip" data-role="square-tip" role="status"><b>' + cellName(bar.g, beat) + ' · ' + nm + ' 方格</b>' +
      '<span class="k">打字写进这一格（一格一个字，再打一个就替换）' + (cellRule ? '；这一拍涂了' + ruleName(cellRule) + '，最后一个字押' + zheName(cellRule) : '') + '。</span>' +
      '<div class="acts">' + act('一分二', '<span class="kbd">空格</span>', 'split') + act('三连', '<span class="kbd">Shift</span><span class="kbd">空格</span>', 'triplet', box % 3 !== 0 || box / 3 < 6) +
      act('空音', '<span class="kbd">空格</span>×2', 'rest') + act('合并', '<span class="kbd">退格</span>', 'merge', box >= 48) + '</div>' +
      '<span class="k"><span class="kbd">Tab</span> 下一格 · <span class="kbd">Enter</span> / <span class="kbd">Esc</span> 结束 · <span class="kbd">Ctrl</span>+<span class="kbd">Z</span> 撤销</span></div>';
  }

  /* ---------- 外框：顶栏 / 伴奏轨 / 抽屉 ---------- */
  var TOTAL_BARS = BARS.length;
  function stepsHTML(tab) {
    return '<div class="steps" data-role="steps"><button class="' + (tab === 'write' ? 'on' : '') + '" data-step="write" aria-pressed="' + (tab === 'write') + '"><i>1</i>写词</button>' +
      '<button class="' + (tab === 'lyrics' ? 'on' : '') + '" data-step="lyrics" aria-pressed="' + (tab === 'lyrics') + '"><i>2</i>歌词</button></div>';
  }
  function topHTML(tab, nowBar, playing) {
    var t = nowBar * 2;
    var play = '<button class="play" data-role="play" aria-label="' + (playing ? '暂停' : '播放') + '">' + (playing ? I.pause : I.play) + '</button>';
    return '<header class="top"><div class="brand"><span class="logo">AB</span><div class="proj"><b>恋爱循环 · 中文词</b><span><span class="dot"></span>已存到本机</span></div></div>' +
      '<div class="vsep desk-only"></div><div class="hist"><button class="ibtn" data-role="undo" aria-label="撤销">' + I.undo + '</button><button class="ibtn" data-role="redo" aria-label="重做" disabled>' + I.redo + '</button><button class="ibtn" data-role="history-btn" aria-label="操作历史">' + I.hist + '<span class="desk-only">历史</span></button></div>' +
      '<div class="desk-only" style="display:flex;align-items:center;gap:8px">' + stepsHTML(tab) + '<div class="vsep"></div><div class="transport"><button class="ibtn" aria-label="回到开头">' + I.start + '</button>' + play +
      '<div class="pos" data-role="position"><b class="mono">' + (nowBar + 1) + '.1</b><span class="mono">' + mmss(t) + ' / 4:06</span></div></div>' +
      '<div class="bpm"><span class="lbl">BPM</span><b class="mono">120</b></div><button class="tog">' + I.metro + '节拍器</button><button class="tog" data-role="guide">' + I.guide + '导唱</button></div>' +
      '<div class="spacer"></div><button class="btn ghost desk-only">' + I.folder + '作品</button><button class="btn desk-only">' + I.out + '导出</button><button class="ibtn mob-only" aria-label="作品与导出">' + I.out + '</button></header>' +
      '<div class="bar2 mob-only">' + stepsHTML(tab) + '<div class="transport">' + play + '<div class="pos" data-role="position"><b class="mono">' + (nowBar + 1) + '.1</b></div></div><div class="bpm"><b class="mono">120</b></div></div>';
  }
  function trackHTML(nowBar) {
    var x = function (b) { return (b / TOTAL_BARS * 100).toFixed(3); };
    var marks = '', labels = '';
    for (var b = 0; b < TOTAL_BARS; b += 8) if (!SECS.some(function (s) { return s.first === b; })) marks += '<span class="bm" style="left:' + x(b) + '%">' + (b + 1) + '</span>';
    SECS.forEach(function (s, i) {
      if (MOBILE && i % 2) return;
      labels += '<span class="bm nx" style="left:' + x(s.first) + '%"></span><span class="sl" data-role="section-label" style="left:calc(' + x(s.first) + '% + 2px)">' + esc(s.label) + '</span>';
    });
    var pts = [], n = 400, seed = 7;
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    var top = [], bot = [];
    for (var i = 0; i <= n; i++) { var a = 18 + 26 * Math.abs(Math.sin(i / 9)) * (0.55 + 0.45 * rnd()); top.push((i / n * 1000).toFixed(1) + ',' + (50 - a).toFixed(1)); bot.unshift((i / n * 1000).toFixed(1) + ',' + (50 + a).toFixed(1)); }
    pts = top.concat(bot);
    return '<section class="track" data-role="track"><div class="tl-lab ruler-l">小节</div><div class="ruler">' + marks + labels + '</div>' +
      '<div class="tl-lab"><div class="nm"><b>伴奏</b><span title="koi_circulation_rap_mix.mp3 · 120 BPM">koi_circulation_rap_mix.mp3 · 120 BPM</span></div><div class="spacer"></div><button class="btn sm">' + I.swap + '替换伴奏</button></div>' +
      '<div class="lane" data-role="backing-lane"><svg viewBox="0 0 1000 100" preserveAspectRatio="none" style="width:100%"><polygon points="' + pts.join(' ') + '" style="fill:var(--wave)"/></svg><span class="playhead" style="left:' + x(nowBar) + '%"></span></div>' +
      '<div class="m-beat mob-only"><span>伴奏 <b>koi_circulation_rap_mix.mp3</b> · 120 BPM</span><span class="spacer"></span><button class="btn sm">' + I.swap + '替换</button></div></section>';
  }

  /* ---------- 侧栏（写词页） ---------- */
  function swatchesHTML(painting, erase, compact) {
    var h = '<div class="swatches" data-role="swatches">';
    RULES.forEach(function (r) {
      var on = ACTIVE && ACTIVE.id === r.id;
      var hold = painting && on;
      h += '<button class="sw' + (on ? ' on' : '') + '" data-role="swatch" data-rule="' + r.id + '" data-hue="' + r.hue + '" style="--h:' + r.hue + '" aria-pressed="' + on + '" aria-label="' + ruleName(r) + ' · ' + zheName(r) + (hold ? '（画笔拿在手上）' : '') + '" title="点：拿起' + ruleName(r) + '画笔；再点一次放下">' + (hold ? I.brush : '') + '</button>';
    });
    h += '<button class="sw erase' + (erase ? ' on' : '') + '" data-role="swatch-erase" aria-label="橡皮：擦掉格子的颜色" title="橡皮：点 / 拖格子擦掉颜色">擦</button>';
    if (!compact) h += '<button class="sw add" data-role="add-rule" aria-label="新建颜色">+</button>';
    return h + '</div>';
    return h;
  }
  function ruleBlockHTML(r, mode, paint) {
    paint = paint || PAINT;
    var used = Object.keys(paint).filter(function (k) { return paint[k] === r.id; }).length;
    var g = groupOfWant(r.finals[0]);
    var counts = ['单押', '双押', '三押', '四押'].map(function (x, i) { return '<button data-role="count-opt" class="' + (r.count === i + 1 ? 'on' : '') + '">' + x + '</button>'; }).join('');
    return '<div class="blk" style="--h:' + r.hue + '" data-role="rule-editor"><div class="rule-h"><i></i><b>' + ruleName(r) + '</b><span>' + (mode === 'strict' ? '韵母 ' + esc(r.finals.join(' · ')) : esc(zheName(r))) + ' · 已涂 ' + used + ' 格</span><button class="ibtn" aria-label="删掉' + ruleName(r) + '">' + I.close + '</button></div>' +
      '<div class="seg" data-role="rhyme-count">' + counts + '</div>' +
      '<div class="finals" data-role="finals"><label>' + (mode === 'strict' ? '韵母串' : '韵') + '</label><input class="fin" data-role="final-input" value="' + esc(r.finals[0]) + '" readonly aria-label="韵母">' +
      (mode === 'strict' ? '<span class="zhe">严格：只认 <b>' + esc(r.finals[0]) + '</b></span>' : '<span class="zhe"><b>' + GNAME[g] + '辙</b> · ' + ZHE.filter(function (z) { return z[0] === g; })[0][2].join(' ') + ' 都算</span>') + '</div></div>';
  }
  function judgeBlockHTML(mode, full) {
    var h = '<div class="blk" data-role="judge"><div class="blk-h"><b>判押韵</b>整个作品一个设置</div>' +
      '<div class="seg two" data-role="judge-mode"><button data-mode="thirteen" class="' + (mode === 'thirteen' ? 'on' : '') + '" aria-pressed="' + (mode === 'thirteen') + '">十三辙</button><button data-mode="strict" class="' + (mode === 'strict' ? 'on' : '') + '" aria-pressed="' + (mode === 'strict') + '">严格韵母</button></div>';
    if (full) {
      h += '<p class="note"><b>十三辙</b>：介音不算（an / ian / uan / üan 都押言前）；前后鼻音分开（in 属人辰、ing 属中东）。<b>严格</b>：韵母一个字母都不差（老作品打开时是这一档）。</p>';
      h += '<div class="zhe-tab" data-role="zhe-table">' + ZHE.map(function (z) {
        var on = ACTIVE && groupOfWant(ACTIVE.finals[0]) === z[0];
        return '<b' + (on ? ' class="on"' : '') + '>' + z[1] + '</b><span' + (on ? ' class="on"' : '') + '>' + z[2].join(' ') + '</span><i' + (on ? ' class="on"' : '') + '>' + z[3].split(' ').slice(0, 2).join(' ') + '</i>';
      }).join('') + '</div>';
    } else h += '<p class="note">现在按<b>十三辙</b>判：同一辙就算押上（an / ian / uan / üan 都是言前）。</p>';
    return h + '</div>';
  }
  function lockBlockHTML(o) {
    var rhymeN = Object.keys(SLOTS).length;
    function mi(lock, on, label, note) { return '<button class="mi' + (on ? ' on' : '') + '" data-role="lock-opt" data-lock="' + lock + '">' + I.lock + label + '<span>' + note + '</span></button>'; }
    return '<div class="blk" data-role="lock-tools"><div class="blk-h"><b>锁定</b>锁住的字不能改字、不能挪落点</div>' +
      mi('row', !!o.lockRow, o.selRows ? '锁整行' : '锁整行', o.lockRow ? '第 ' + o.lockRow + ' 小节 · 已锁' : '点行头选行') +
      mi('col', false, '锁整列', '点拍头选列') +
      mi('cell', false, '锁选中的格子', o.selN ? '已选 ' + o.selN + ' 格' : '先选格子') +
      mi('rhyme', !!o.rhymeLock, o.rhymeLock ? '解锁全部韵脚位置' : '锁全部韵脚位置', o.rhymeLock ? '开 · ' + rhymeN + ' 个字' : '关') + '</div>';
  }
  function aiBlockHTML(o) {
    return '<div class="blk" data-role="ai-tools"><div class="later"><span class="later-tag">接入后</span>' +
      '<div class="blk-h"><b>AI 改写选区</b>' + (o.selName || '先选格子') + '</div>' +
      '<label class="chk"><i></i>允许改 flow（关着 = 字数、落点都不变，只换字）</label>' +
      '<div class="row-btns"><button class="btn sm primary" data-role="ai-polish"' + (o.selName ? '' : ' disabled') + '>润色选区</button><button class="btn sm" data-role="ai-fill">一次填空着的韵脚</button></div>' +
      '<p class="note">全文给 AI 当上下文，只改选区；锁住的字不许动。结果先过四道程序检查才上屏，押没押上按这个作品的判押韵设置（<b>十三辙</b>）判。</p></div></div>';
  }
  function candHTML(r, target) {
    var pool = { yanqian: '远 天 边 见 面 点 变 线 甜', yaotiao: '跑 笑 好 到 掉 抱 照 闹 绕', zhongdong: '动 梦 风 空 星 声 懂 重 冲' }[groupOfWant(r.finals[0])] || '一 二 三';
    return '<div class="blk" data-role="candidates"><div class="blk-h"><b>候选</b>押' + esc(zheName(r)) + (target ? ' · 填进' + target : '') + '</div><div class="cands">' +
      pool.split(' ').map(function (w) { return '<button class="cand">' + w + '</button>'; }).join('') + '</div><p class="note">按十三辙从本机韵表里找（同韵母的排前面），不联网。光标停在涂了这种颜色的格子上时，点一下填进它的韵脚位置。</p></div>';
  }
  function keysBlockHTML() {
    function key(k, t) { return '<li><span class="keys">' + k + '</span><span>' + t + '</span></li>'; }
    return '<div class="blk" data-role="key-help"><div class="blk-h"><b>点方格以后</b>（和 v3.2 一样）</div><ul class="keylist">' +
      key('打字', '写进这一格（一格一个字）') + key('<span class="kbd">空格</span>', '一分为二：1/4 → 1/8 → 1/16 → 1/32') +
      key('<span class="kbd">Shift</span>+<span class="kbd">空格</span>', '分成三连') + key('<span class="kbd">空格</span><span class="kbd">空格</span>', '0.4 秒内两下：变成空音') +
      key('<span class="kbd">退格</span>', '有字先清字；空方格合回去') + key('<span class="kbd">Esc</span>', '结束打字；拿着画笔时 = 放下画笔') + '</ul></div>';
  }

  /* 模式提示（工具条最左） */
  function modeHTML(mode, extra) {
    if (mode === 'paint') {
      return '<span class="mode paint" data-role="mode-pill" data-mode="paint" data-hue="' + ACTIVE.hue + '" style="--h:' + ACTIVE.hue + '">' + I.brush + '<b>涂色：' + ruleName(ACTIVE) + '</b><span class="d">' + esc(zheName(ACTIVE)) + ' · 点 / 拖格子上色 · <span class="kbd">Esc</span> 放下</span><button class="btn sm" data-role="mode-done">完成</button></span>';
    }
    if (mode === 'select') {
      return '<span class="mode select" data-role="mode-pill" data-mode="select">' + I.select + '<b>选格子</b><span class="d">' + esc(extra) + ' · 给锁定 / AI 用 · <span class="kbd">Esc</span> 退出</span><button class="btn sm" data-role="mode-done">完成</button></span>';
    }
    return '<span class="mode" data-role="mode-pill" data-mode="type">' + I.pen + '<b>打字</b><span class="d">点方格写字 · 空格分格</span></span>';
  }
  function precisionHTML() {
    return '<span class="lbl desk-only">精度</span><div class="chips" data-role="precision">' + ['1/8', '1/16', '1/32', '三连', '半拍三连'].map(function (p) { return '<button class="' + (p === '1/16' ? 'on' : '') + '">' + p + '</button>'; }).join('') + '</div>';
  }
  function clearFlowHTML() { return '<span class="spacer desk-only"></span><button class="btn sm ghost danger clear-flow desk-only" data-role="clear-flow">' + I.hist + '清空全部 flow…</button>'; }

  function drawerHTML(title, head, body, open, painting) {
    return '<div class="drawer' + (open ? ' open' : '') + '" data-role="rhyme-drawer"><button class="grab" aria-label="' + (open ? '收起' : '展开') + '"></button>' +
      '<div class="dh' + (painting ? ' painting' : '') + '"' + (painting ? ' style="--h:' + ACTIVE.hue + '"' : '') + '><h2>' + title + '</h2>' + head + '<button class="more" aria-label="' + (open ? '下滑收起' : '上滑展开') + '"><span class="mt">' + (open ? '下滑收起' : '上滑展开') + '</span>' + I.up + '</button></div>' +
      (open ? '<div class="dbody">' + body + '</div>' : '') + '</div>';
  }

  /* ---------- 画面 ---------- */
  var html = '', toast = '';
  var sheetOpts = { slots: SLOTS, rules: RULES, paint: PAINT, mode: MODE, rhymeLock: !!C.rhymeLock };

  if (S === 'write' || S === 'paint' || S === 'side') {
    var focusAbs = null, toolsInner, panel, drawerHead, drawerOpen = false;
    if (C.focus) focusAbs = BY_ID[C.focus.bar].words[C.focus.index].abs;
    sheetOpts.focusAbs = focusAbs;
    if (C.preview) { sheetOpts.preview = {}; C.preview.forEach(function (k) { sheetOpts.preview[k] = true; }); sheetOpts.hue = ACTIVE.hue; sheetOpts.cls = 'painting'; }
    if (C.lockBars) { sheetOpts.lockBars = {}; C.lockBars.forEach(function (id) { sheetOpts.lockBars[id] = true; }); }
    var selName = '', selN = 0;
    if (C.sel) {
      sheetOpts.sel = {};
      C.sel.forEach(function (id) { [0, 1, 2, 3].forEach(function (b) { sheetOpts.sel[id + ':' + b] = true; selN++; }); });
      selName = '第 ' + (BY_ID[C.sel[0]].g + 1) + '–' + (BY_ID[C.sel[C.sel.length - 1]].g + 1) + ' 小节 · ' + selN + ' 格';
      sheetOpts.cls = 'selecting';
    }
    if (S === 'write') {
      toolsInner = modeHTML('type') + precisionHTML() + '<span class="status desk-only"><b>韵脚颜色一直显示</b> · 要涂色：在右栏点一种颜色</span>' + clearFlowHTML();
      var fb = BY_ID[C.focus.bar], fw = fb.words[C.focus.index];
      panel = '<div class="pn" data-role="write-panel"><div class="pn-h"><h2>押韵</h2><span>点一种颜色 = 拿起画笔涂格子</span></div>' + swatchesHTML(false, false) + ruleBlockHTML(ACTIVE, MODE) +
        candHTML(ACTIVE, cellName(fb.g, 3)) + judgeBlockHTML(MODE, false) + lockBlockHTML({}) + aiBlockHTML({}) + keysBlockHTML() + '</div>';
      drawerHead = swatchesHTML(false, false);
    } else if (S === 'paint') {
      toolsInner = modeHTML('paint') + '<span class="status desk-only">画笔经过的格子都涂上，松手算<b>一步</b>；只有拖音 / 没有字的格子跳过</span>';
      panel = '<div class="pn" data-role="write-panel"><div class="pn-h"><h2>押韵</h2><span>再点一次粉色 = 放下画笔</span></div>' + swatchesHTML(true, false) + ruleBlockHTML(ACTIVE, MODE) +
        judgeBlockHTML(MODE, false) + lockBlockHTML({}) + aiBlockHTML({}) + '</div>';
      drawerHead = swatchesHTML(true, false, true);
    } else {
      toolsInner = modeHTML('select', selName) + '<span class="status desk-only">右栏的<b>锁定</b>和 <b>AI</b> 对着这块选区</span>';
      var selPanel = lockBlockHTML({ lockRow: BY_ID.b10.g + 1, rhymeLock: true, selN: selN }) + aiBlockHTML({ selName: selName });
      panel = '<div class="pn" data-role="write-panel"><div class="pn-h"><h2>押韵</h2><span>点一种颜色 = 拿起画笔涂格子</span></div>' + swatchesHTML(false, false) + selPanel + ruleBlockHTML(ACTIVE, MODE) + judgeBlockHTML(MODE, false) + '</div>';
      drawerHead = swatchesHTML(false, false);
      drawerOpen = true;
    }
    html = '<div class="app" data-step="1" data-tab="write" data-mode="' + C.mode + '">' + topHTML('write', C.nowBar, false) + trackHTML(C.nowBar) +
      '<div class="main"><main class="work" data-role="work"><div class="tools" data-role="tools">' + toolsInner + '</div>' + sheetHTML(C.rows, sheetOpts) + '</main>' +
      '<aside class="side" data-role="side">' + panel + '</aside></div></div>' +
      drawerHTML(S === 'paint' ? '涂色' : '写词', drawerHead, S === 'side' ? '<div class="pn" data-role="drawer-panel">' + selPanel + '</div>' : '', drawerOpen, S === 'paint');
  } else if (S === 'rhyme13') {
    // 场景：v4 的歌词和涂色，规则按 v1 的做法「一种颜色一条」（蓝 an、绿 ong、粉 ao、金 ang、青 ei、草绿 i）。
    // 旧 = 严格韵母；新 = 十三辙；同一份涂色、同一套规则，只换判法
    var V1 = { 215: 'an', 150: 'ong', 340: 'ao', 42: 'ang', 185: 'ei', 100: 'i' };
    var oldRules = M13.rules.map(function (r) { return { id: 'r_v1_' + r.hue, hue: r.hue, count: 1, finals: [V1[r.hue]] }; });
    var paintBlue = {};
    Object.keys(K.paint).forEach(function (k) { paintBlue[k] = 'r_v1_' + RULE_BY_ID[K.paint[k]].hue; });
    var oldRule = oldRules.filter(function (r) { return r.hue === 215; })[0];
    ACTIVE = oldRule;
    RULES = oldRules;
    var oldSlots = rhymeSlots(oldRules, paintBlue, 'strict');
    var newSlots = rhymeSlots(oldRules, paintBlue, 'thirteen');
    var count = function (slots, rows) { var n = 0; rows.forEach(function (g) { BARS[g].words.forEach(function (w) { if (slots[w.abs] && slots[w.abs].ok === false) n++; }); }); return n; };
    var allMiss = 0;
    Object.keys(oldSlots).forEach(function (a) { if (oldSlots[a].ok === false) allMiss++; });
    var nOld = count(oldSlots, C.rows), nNew = count(newSlots, C.rows);
    var first = C.rows[0], last = C.rows[C.rows.length - 1];
    var cmp = '<div class="cmp" data-role="compare">' +
      '<div class="cmp-col" data-role="compare-old"><div class="cmp-h"><b>Verse 1 · 改之前（严格韵母）</b><span class="cnt bad" data-role="miss-count">' + nOld + ' 处「不押」</span></div>' + sheetHTML(C.rows, { slots: oldSlots, rules: oldRules, paint: paintBlue, mode: 'strict', tag: 'old', noSecHead: true }) + '</div>' +
      '<div class="cmp-col" data-role="compare-new"><div class="cmp-h"><b>Verse 1 · 改用十三辙以后</b><span class="cnt good" data-role="miss-count">' + nNew + ' 处「不押」</span></div>' + sheetHTML(C.rows, { slots: newSlots, rules: oldRules, paint: paintBlue, mode: 'thirteen', tag: 'new', noSecHead: true }) + '</div></div>' +
      '<p class="cmp-note">对比图：Verse 1 第 ' + (first + 1) + '–' + (last + 1) + ' 小节，同一份涂色，一种颜色一条规则（蓝色 = an）。界面里只显示其中一种，由右栏「判押韵」决定。</p>';
    var mig = '<div class="mig" data-role="migrate-banner"><span class="q"><b>这个作品按旧规则判押韵（韵母一字不差）。</b>改成十三辙：全曲 ' + allMiss + ' 处「不押」会消失，格子颜色不变。可以撤销。</span>' +
      '<button class="btn sm primary" data-role="migrate-yes">改用十三辙</button><button class="btn sm ghost" data-role="migrate-no">先不改</button></div>';
    var p13 = '<div class="pn" data-role="write-panel"><div class="pn-h"><h2>押韵</h2><span>判押韵的设置在这里</span></div>' + judgeBlockHTML('strict', true) +
      '<div class="blk" data-role="migrate-preview"><div class="blk-h"><b>改用十三辙会怎样</b>按这个作品现在的涂色算</div><p class="note">「不押」<b>' + allMiss + ' → 0</b>：蓝色 20 处（「边 天 面」ian、「弯 转 完」uan、「眩 圈 远」üan 和 an 同属言前）、粉色 13 处（「跳 掉 笑」iao）、金色 10 处（「香 讲」iang、「光 忘」uang）、绿色 8 处（「停 星」ing、「梦 声」eng）、青色 5 处（「罪 碎」ui）。<br>颜色合并：没有（一种颜色本来就只有一条规则）。</p></div>' +
      ruleBlockHTML(oldRule, 'strict', paintBlue) + '</div>';
    html = '<div class="app" data-step="1" data-tab="write" data-mode="type">' + topHTML('write', C.nowBar, false) + trackHTML(C.nowBar) +
      '<div class="main"><main class="work" data-role="work"><div class="tools" data-role="tools">' + modeHTML('type') + precisionHTML() + clearFlowHTML() + '</div>' + mig + cmp + '</main>' +
      '<aside class="side" data-role="side">' + p13 + '</aside></div></div>' +
      drawerHTML('写词', swatchesHTML(false, false), '', false, false);
  } else if (S === 'lyrics') {
    var nowLine = null;
    var body = '<div class="lyr" data-role="lyrics" data-size="m">';
    SECS.forEach(function (sec) {
      var lines = sec.bars.filter(function (b) { return b.words.some(function (w) { return w.text; }); });
      body += '<section class="lyr-sec" data-role="lyric-section"><div class="lyr-sh"><b data-role="section-label">' + esc(sec.label) + '</b><span>' + (lines.length ? lines.length + ' 行' : '') + '</span></div>';
      if (!lines.length) body += '<div class="lyr-empty">（' + sec.bars.length + ' 小节伴奏）</div>';
      lines.forEach(function (b) {
        var isNow = b.g === C.nowBar;
        var t = '', prevEnd = null;
        b.words.forEach(function (w) {
          if (prevEnd !== null && w.abs - prevEnd >= 24) t += '<span class="gap" data-role="lyric-gap" aria-hidden="true"></span>';
          prevEnd = w.abs + w.len;
          if (!w.text) { t += '<span class="blank" data-role="lyric-blank">_</span>'; return; }
          var sl = SLOTS[w.abs], now = isNow && w.text === C.nowChar;
          if (sl) t += '<b class="lr' + (now ? ' now-ch' : '') + '" data-role="lyric-rhyme" data-hue="' + sl.rule.hue + '" data-abs="' + w.abs + '" style="--h:' + sl.rule.hue + '">' + esc(w.text) + '</b>';
          else if (now) t += '<span class="now-ch" data-role="lyric-now-char">' + esc(w.text) + '</span>';
          else t += esc(w.text);
        });
        body += '<div class="lyr-line' + (isNow ? ' now' : '') + '" data-role="lyric-line" data-bar="' + (b.g + 1) + '" data-bar-id="' + b.id + '"' + (isNow ? ' data-now="1"' : '') + '><span class="ln">' + pad(b.g + 1) + '</span><span class="lt">' + t + '</span></div>';
      });
      body += '</section>';
    });
    body += '</div>';
    var nb = BARS[C.nowBar], ns = secOf(C.nowBar), nIdx = ns.bars.indexOf(nb) + 1;
    var tl = '<button class="btn sm" data-role="copy-lyrics">' + I.copy + '复制全部</button><button class="btn sm" data-role="export-txt">' + I.out + '导出 .txt</button>' +
      '<div class="chips" data-role="font-size"><button>小</button><button class="on">中</button><button>大</button></div>' +
      '<div class="chips"><button class="on-soft" aria-pressed="true" data-role="follow">跟随播放</button></div>' +
      '<span class="status desk-only" data-role="now-status">正在唱：<b>' + esc(ns.label) + ' 第 ' + nIdx + ' 行</b> · 第 ' + (nb.g + 1) + ' 小节</span>';
    var legend = RULES.map(function (r) {
      var n = Object.keys(PAINT).filter(function (k) { return PAINT[k] === r.id; }).length;
      return '<div class="legend-row" style="--h:' + r.hue + '"><i></i><b>' + ruleName(r) + '</b>' + esc(zheName(r)) + '<span>' + n + ' 处</span></div>';
    }).join('');
    var lp = '<div class="pn lyr-side" data-role="lyrics-panel"><div class="pn-h"><h2>歌词</h2><span>一小节一行，跟着播放走</span></div>' +
      '<div class="blk" data-role="legend"><div class="blk-h"><b>韵脚颜色</b>和写词页同一套</div>' + legend + '</div>' +
      '<div class="blk"><div class="blk-h"><b>分行</b>只影响这一页和导出</div><p class="note">默认<b>一小节一行</b>（第几小节写在左边）。一句跨两小节、或者一小节两句时，点「调整分行」：点两行之间 = 并成一行，点一个字 = 从这个字起另起一行。不改押韵、不改表格。</p><div class="row-btns"><button class="btn sm" data-role="relayout">调整分行</button></div></div>' +
      '<div class="blk"><div class="blk-h"><b>提词</b></div><p class="note">播放时当前这一行垫强调色、正在唱的字下面画线，自动滚到屏幕上方三分之一处。点一行 = 从这一行开始播。</p></div></div>';
    html = '<div class="app" data-step="2" data-tab="lyrics">' + topHTML('lyrics', C.nowBar, true) + trackHTML(C.nowBar) +
      '<div class="main"><main class="work" data-role="work"><div class="tools" data-role="tools">' + tl + '</div>' + body + '</main>' +
      '<aside class="side" data-role="side">' + lp + '</aside></div></div>' +
      drawerHTML('歌词', '<span class="lg">' + RULES.map(function (r) { return '<i style="--h:' + r.hue + '"></i>'; }).join('') + '</span>', '', false, false);
  }

  document.body.innerHTML = html + (toast ? '<div class="toast" data-role="notice" role="status">' + toast + '</div>' : '');

  /* ---------- 量过以后：字号按真实格宽、气泡上下翻、滚到要看的地方、选区框、画笔指针 ---------- */
  var work = document.querySelector('.work');
  var cell = document.querySelector('.cell');
  if (cell && Math.abs(cell.clientWidth - SIZE.cell) > 1) {
    SIZE.cell = cell.clientWidth;
    document.querySelectorAll('.wd').forEach(function (el) {
      var box = Number(el.dataset.box), f = fontFor(box);
      el.style.setProperty('--fs', f + 'px');
      el.classList.toggle('narrow', f < SIZE.base);
    });
    document.querySelectorAll('.sq.filled').forEach(function (el) {
      var w = ALL_WORDS.filter(function (x) { return x.abs === Number(el.dataset.abs); })[0];
      el.style.setProperty('--cw', fontFor(w.box) + 'px');
    });
  }
  function rowEl(id) { return document.querySelector('.work [data-role="row"][data-bar-id="' + id + '"]'); }
  /** 把某一行滚到粘住的列头下面 extra px 处 */
  function scrollRowTo(id, extra) {
    var r = rowEl(id), head = document.querySelector('.work .sh-head');
    if (!r || !head) return;
    work.scrollTop += r.getBoundingClientRect().top - head.getBoundingClientRect().bottom - (extra || 0);
  }
  if (S === 'write' && MOBILE) scrollRowTo('b6', 0);
  if (S === 'side' && MOBILE) scrollRowTo('b12', 0);
  /* 伴奏轨标尺：段落名 / 小节号放不下就不写（14 段挤在一起会互相压住） */
  (function () {
    var shown = [];
    document.querySelectorAll('.ruler .sl').forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (shown.some(function (x) { return r.left < x.right + 4 && r.right > x.left - 4; }) || r.right > innerWidth) { el.style.display = 'none'; if (el.previousElementSibling) el.previousElementSibling.style.display = 'none'; }
      else shown.push(r);
    });
    document.querySelectorAll('.ruler .bm:not(.nx)').forEach(function (el) {
      var r = el.getBoundingClientRect();
      var t = el.firstChild ? (function () { var rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); })() : r;
      if (shown.some(function (x) { return r.left < x.right + 2 && t.right + 2 > x.left; }) || t.right > innerWidth) el.style.display = 'none';
      else shown.push(r);
    });
  })();
  if (S === 'lyrics') {
    var nl = document.querySelector('[data-role="lyric-line"][data-now]');
    var wr = work.getBoundingClientRect();
    work.scrollTop += nl.getBoundingClientRect().top - wr.top - (work.clientHeight / 3);
  }
  // 气泡：桌面上下面放不下就翻到上面（和 SquareEditor 一样）
  var tip = document.querySelector('.sq-tip');
  if (tip && !MOBILE && tip.getBoundingClientRect().bottom > innerHeight - 8) tip.classList.add('up');
  // 选区框：一整块一个框（App 里按量出来的格子位置拼）
  if (C.sel) {
    var sheet = document.querySelector('.work .sheet'), sr = sheet.getBoundingClientRect();
    var cells = [].slice.call(sheet.querySelectorAll('[data-role="cell"]')).filter(function (c) { return sheetOpts.sel[c.dataset.key]; });
    var L = Infinity, T = Infinity, R = -Infinity, Bt = -Infinity;
    cells.forEach(function (c) { var r = c.getBoundingClientRect(); L = Math.min(L, r.left); T = Math.min(T, r.top); R = Math.max(R, r.right); Bt = Math.max(Bt, r.bottom); });
    var box = document.createElement('span');
    box.className = 'selbox'; box.setAttribute('data-role', 'selection-box');
    box.style.cssText = 'left:' + (L - sr.left) + 'px;top:' + (T - sr.top) + 'px;width:' + (R - L) + 'px;height:' + (Bt - T) + 'px';
    sheet.appendChild(box);
  }
  // 画笔指针：停在拖到的那一格中间偏左
  if (C.pointer) {
    var pc = document.querySelector('.work [data-role="cell"][data-key="' + C.pointer + '"]'), sh = document.querySelector('.work .sheet');
    var pr = pc.getBoundingClientRect(), shr = sh.getBoundingClientRect();
    var pt = document.createElement('span');
    pt.className = 'brush-pt'; pt.setAttribute('data-role', 'brush-pointer'); pt.innerHTML = I.brushPt;
    pt.style.left = (pr.left - shr.left + pr.width * 0.42) + 'px';
    pt.style.top = (pr.top - shr.top + pr.height * 0.62) + 'px';
    sh.appendChild(pt);
    var dt = document.createElement('div');
    dt.className = 'drag-tip'; dt.setAttribute('data-role', 'drag-tip');
    var n = C.preview.length;
    dt.textContent = '涂' + ruleName(ACTIVE) + ' · ' + n + ' 格（第 ' + (BY_ID[C.preview[0].split(':')[0]].g + 1) + '–' + (BY_ID[C.pointer.split(':')[0]].g + 1) + ' 小节第 4 拍）· 松手算一步';
    var dx = Math.max(8, Math.min(pr.left + pr.width * 0.42, innerWidth - 8));
    dt.style.left = dx + 'px';
    dt.style.top = (pr.bottom + 8) + 'px';
    document.body.appendChild(dt);
    // 窄屏上提示别出屏：贴着右边
    var dr = dt.getBoundingClientRect();
    if (dr.right > innerWidth - 4) dt.style.left = (dx - (dr.right - innerWidth + 8)) + 'px';
    if (dt.getBoundingClientRect().left < 4) dt.style.left = (dx + (4 - dt.getBoundingClientRect().left)) + 'px';
  }
})();
