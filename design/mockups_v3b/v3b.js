/* AnyBeats v3b 补充视觉稿：三个画面共用这一份渲染脚本，画面由 <body data-screen="…"> 决定。
 *   drag  格内拖音：拖音 = 字的长度（字框 + 同色细线），五种情况
 *   wrap  一句超过一小节：超出部分接着排在下一行开头，不加任何续行标记
 *   dense 手机 390 宽下三连 / 半拍三连 / 1/32 的最小字宽方案（1/32 整张表左右滑，用户 11-16 定，不上下叠）
 * 数据模型按 11-16 的决定：每个字只记 起点 tick + 持续 tick（每拍 48 tick），没有「拖音格」「空音格」；
 * 空音 = 字与字之间留出的空白。格子只是视图。不外链任何资源，不发请求。
 */
(function () {
  'use strict';

  var TPB = 48;            // 每拍 tick
  var MIN_FONT = 11;       // 最小字宽（px）：CJK 字是方块，字号 = 字宽
  var MOBILE_CELL = 85;    // 390 宽手机上一拍的格宽（px），右栏表格用；手机上的标注条用实测值
  var S = document.body.getAttribute('data-screen');

  /* ---------- 图标 ---------- */
  function svg(p) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  }
  var I = {
    undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
    redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
    hist: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>'),
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>',
    prev: svg('<path d="M6 5v14"/><path d="M19 5 9 12l10 7z"/>'),
    lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    metro: svg('<path d="M9 3h6l4 18H5z"/><path d="m12 15 5-9"/>'),
    folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    out: svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
    swap: svg('<path d="M4 7h13l-3-3"/><path d="M20 17H7l3 3"/>'),
    up: svg('<path d="m6 15 6-6 6 6"/>')
  };

  /* ---------- 作品数据 ----------
   * 每拍一个字符串：一个字 = 一个 16 分（12 tick）起点的字；「-」把前一个字再拖长一个单位（可以拖过格线、拖到下一行）；
   * 「_」留一个单位的空白（空音）；「?」还没填字的字；「[ab]」两个 1/32（各 6 tick）；
   * 「3:」开头 = 这一拍三连（每个 16 tick）；「6:」开头 = 半拍三连（每个 8 tick）；「/」从这里起是新的一句（不占时间）。
   */
  var VERSE_A = [
    { bar: 2, b: ['凌晨三点', '街灯_在', '还在路上', '找个地方'] },
    { bar: 3, b: ['远---', '风吹过来', '把那梦想', '吹向西方'] }
  ];
  var HOOK = [
    { bar: 6, b: ['开着夜-', '车_穿过', '霓虹_的', '每个路口'] },
    { bar: 7, b: ['油门-_', '踩-到满', '灯火阑珊', '我就不走'] },
    { bar: 8, b: ['3:风在吹', '灯-在闪', '这条街_', '没有出口'] },
    { bar: 9, b: ['开着夜-', '车_穿过', '一个一个', '十字路口'] }
  ];
  var INTRO = { label: 'Intro', rows: [{ bar: 1, b: ['____', '____', '____', '走-吧-'] }] };
  var SONGS = {
    drag: [INTRO,
      { label: 'Verse 1', rows: VERSE_A.concat([
        { bar: 4, b: ['3:我不怕', '_走得慢', '只要心里', '还有一场'] },
        { bar: 5, b: ['每一步都', '踩在节拍', '-带着光', '一起启航'] }]) },
      { label: 'Hook', rows: [
        { bar: 6, b: ['开着夜-', '车_穿过', '霓虹_的', '路口--'] },
        { bar: 7, b: ['--油门', '----', '踩到满-', '我就不走'] },
        { bar: 8, b: ['3:风在吹', '灯-在闪', '这条街_', '没有出口'] },
        { bar: 9, b: ['开着夜-', '车_穿过', '一个一个', '十字路口'] }] }],
    wrap: [INTRO,
      { label: 'Verse 1', rows: VERSE_A.concat([
        { bar: 4, b: ['我在这条', '路上走了', '很久很久', '才终于看'] },
        { bar: 5, cont: true, b: ['清那一场', '雨--_', '/每一步都', '踩在节拍'] }]) },
      { label: 'Hook', rows: HOOK }],
    dense: [INTRO,
      { label: 'Verse 1', rows: VERSE_A },
      { label: 'Bridge', rows: [
        { bar: 4, b: ['3:我不怕', '3:走得慢', '3:风在吹', '3:灯在闪'] },
        { bar: 5, b: ['6:不管路有多远', '6:我们一起往前', '冲过路口', '灯火-_'] },
        { bar: 6, b: ['踩[在节]拍-', '[一个][一个]往前', '每[一步]都算', '到[地方]--'] },
        { bar: 7, b: ['3:风在吹', '[快要]到--', '[天亮]-的_', '时-候-'] }] }]
  };

  // 一种颜色 = 一条韵脚规则：色相、押数（1–4）、韵母串（严格按字面比，iang ≠ ang）
  var RULES = {
    A: { name: '蓝色', h: 215, n: 2, f: ['i', 'ang'] },
    B: { name: '绿色', h: 150, n: 1, f: ['ai'] },
    C: { name: '粉色', h: 340, n: 2, f: ['u', 'ou'] },
    D: { name: '金色', h: 42, n: 1, f: ['an'] }
  };
  var PAINTS = {
    drag: { A: ['2:3', '3:3', '4:3', '5:3'], B: ['2:1', '3:1', '5:1'], C: ['6:3', '7:3', '8:3', '9:3'], D: ['7:2'] },
    wrap: { A: ['2:3', '3:3', '5:0'], B: ['2:1', '3:1', '5:3'], C: ['6:3', '7:3', '8:3', '9:3'], D: ['7:1', '7:2'] },
    dense: { A: ['2:3', '3:3', '6:3'], B: ['2:1', '3:1'], C: ['5:2'], D: ['4:3'] }
  };
  var CANDS = {
    A: ['地方', '西方', '一场', '激昂', '启航', '低唱', '秘方', '比方', '体纲'],
    D: ['满', '珊', '看', '站', '散', '烂', '难', '蓝', '岸']
  };

  var CFG = {
    drag: { rule: 'D', chars: function (bar) { return bar <= 8; }, hit: '7:1',
      pins: { '3:0': 1, '6:1': 2, '5:1': 3, '6:3': 4, '7:1': 5 } },
    wrap: { rule: 'A', chars: function () { return true; } },
    dense: { rule: 'A', chars: function () { return true; }, cur: '6:3' }
  };
  var C = CFG[S] || CFG.drag;
  var PAINT = PAINTS[S] || PAINTS.drag;
  var SONG = SONGS[S] || SONGS.drag;

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function pct(t) { return (t / TPB * 100).toFixed(4) + '%'; }

  /* ---------- 解析：beat 字符串 → 字（起点 abs tick + 长度） ---------- */
  function parse(song, bpr) {
    var words = [], last = null, sent = 0;
    song.forEach(function (sec) {
      sec.rows.forEach(function (row) {
        row.mode = [];
        if (!row.cont) sent++;
        row.b.forEach(function (s, bi) {
          var unit = 12, mode = '';
          if (s.indexOf('3:') === 0) { unit = 16; mode = 't3'; s = s.slice(2); }
          else if (s.indexOf('6:') === 0) { unit = 8; mode = 't6'; s = s.slice(2); }
          row.mode[bi] = mode;
          var cs = Array.from(s), t = (row.bar - 1) * bpr * TPB + bi * TPB, i = 0;
          var put = function (c, len) {
            if (c === '-') { if (last) last.len += len; }
            else if (c === '_') last = null;
            else { last = { abs: t, len: len, ch: c === '?' ? '' : c, sent: sent, mode: mode }; words.push(last); }
            t += len;
          };
          while (i < cs.length) {
            if (cs[i] === '/') { sent++; i++; continue; }
            if (cs[i] === '[') { put(cs[i + 1], 6); put(cs[i + 2], 6); i += 4; continue; }
            put(cs[i], unit); i++;
          }
        });
      });
    });
    words.forEach(function (w) {
      w.bar = Math.floor(w.abs / (bpr * TPB)) + 1;
      w.beat = Math.floor((w.abs % (bpr * TPB)) / TPB);
      w.off = w.abs % TPB;
      // 字框那一段：落在 1/32 半格上的 = 6；半拍三连 = 8；三连 = 16；其余 = 一个 16 分。超过的部分画成细线
      var U = w.off % 12 === 6 ? 6 : w.mode === 't6' ? 8 : w.mode === 't3' ? 16 : 12;
      w.box = Math.min(w.len, U);
      w.key = w.bar + ':' + w.beat;
    });
    return words;
  }

  // 给每个字算：显不显示字、是不是韵脚字（涂色格里最后 n 个字，拖音不算字）
  function annotate(words, paint, chars) {
    var byCell = {};
    words.forEach(function (w) {
      w.show = chars(w.bar) && !!w.ch;
      w.final = null; w.hue = null;
      (byCell[w.key] = byCell[w.key] || []).push(w);
    });
    Object.keys(paint).forEach(function (id) {
      paint[id].forEach(function (key) {
        var ws = (byCell[key] || []).slice().sort(function (a, b) { return a.abs - b.abs; });
        var r = RULES[id], rp = ws.slice(Math.max(0, ws.length - r.n));
        rp.forEach(function (w, j) { w.final = r.f[j + (r.n - rp.length)]; w.hue = r.h; w.rule = id; });
      });
    });
    return byCell;
  }

  function paintOf(paint, key) {
    for (var id in paint) if (paint[id].indexOf(key) >= 0) return id;
    return null;
  }

  // 细线从字框右边开始
  function lineStart(w) { return w.abs + w.box; }

  // 某一格 [c0, c0+48) 里经过的拖音细线段
  function segsIn(words, c0) {
    var out = [];
    words.forEach(function (w) {
      var ls = lineStart(w), le = w.abs + w.len;
      if (le <= ls) return;
      var s = Math.max(ls, c0), e = Math.min(le, c0 + TPB);
      if (e > s) out.push({ w: w, s: s, e: e, first: s === ls, last: e === le });
    });
    return out;
  }

  function segHTML(sg, c0) {
    var w = sg.w, cls = ['dl', w.hue != null ? 'rp' : w.show ? 'ink' : 'empty'];
    if (sg.last) cls.push('end');
    var left = sg.first ? 'calc(' + pct(sg.s - c0) + ' - 1px)' : '0px';
    var right = sg.last ? 'calc(' + (100 - (sg.e - c0) / TPB * 100).toFixed(4) + '% + 2px)' : '-1px';
    return '<span class="' + cls.join(' ') + '" data-role="drag-line" data-from="' + w.key + ':' + w.off + '" data-s="' + sg.s + '" data-e="' + sg.e +
      '" style="left:' + left + ';right:' + right + (w.hue != null ? ';--h:' + w.hue : '') + '"></span>';
  }

  function slotHTML(w) {
    var cls = ['slot', 'word'], inner = '', t = w.off, l = w.box, d = w.dens || {};
    if (w.show) { cls.push('filled'); inner = '<span class="ch">' + esc(w.ch) + '</span>'; }
    if (w.final) { cls.push('rp'); if (!w.show) inner = '<span class="ph" data-role="placeholder">' + w.final + '</span>'; }
    if (d.cls) cls.push(d.cls);
    if (w.handle) cls.push('handle');
    var st = '--t:' + t + ';--l:' + l + (d.fs ? ';--fs:' + d.fs + 'px' : '') + (w.hue != null ? ';--h:' + w.hue : '');
    return '<span class="' + cls.join(' ') + '" data-role="slot" data-kind="word" data-tick="' + w.off + '" data-len="' + w.len + '" data-box="' + w.box +
      '" data-sent="' + w.sent + '"' + (w.final ? ' data-rhyme="' + w.final + '"' : '') +
      ' style="' + st + '">' + inner + '</span>';
  }

  function tripHTML(mode) {
    if (mode === 't3') return '<span class="trip" data-role="triplet-mark"><b>3</b></span>';
    if (mode === 't6') return '<span class="trip half" data-role="triplet-mark"><b>3</b></span><span class="trip half h2" data-role="triplet-mark"><b>3</b></span>';
    return '';
  }

  /* ---------- 主表格 ---------- */
  var WORDS = parse(SONG, 4);
  var BYCELL = annotate(WORDS, PAINT, C.chars);

  function holdTip(seg) {
    var w = seg.w;
    return '<div class="hold-tip" role="status" data-role="hold-only-tip"><b>这一拍只有拖音</b>' +
      '<span>是第 ' + w.bar + ' 小节第 ' + (w.beat + 1) + ' 拍「' + esc(w.ch) + '」拖过来的。这一拍没有新字，不能涂色；字算在它起点那一格。</span></div>';
  }

  function cellHTML(row, bi) {
    var key = row.bar + ':' + bi, c0 = (row.bar - 1) * 4 * TPB + bi * TPB;
    var ws = (BYCELL[key] || []).slice().sort(function (a, b) { return a.abs - b.abs; });
    var segs = segsIn(WORDS, c0), holdOnly = !ws.length && segs.length > 0;
    var rule = holdOnly ? null : paintOf(PAINT, key);
    var cls = ['cell'], st = '', inner = '', k;
    if (rule) { cls.push('painted'); st = '--h:' + RULES[rule].h; }
    if (holdOnly) cls.push('hold-only');
    if (C.hit === key) cls.push('hold-hit');
    if (C.cur === key) cls.push('cursor');
    for (k = 0; k < 4; k++) inner += '<span class="tk" data-role="tick-line" style="left:' + (k * 25) + '%"></span>';
    if (C.pins && C.pins[key]) inner += '<span class="pin" data-role="pin">' + C.pins[key] + '</span>';
    if (ws.length) inner += tripHTML(row.mode[bi]);
    ws.forEach(function (w) { inner += slotHTML(w); });
    segs.forEach(function (sg) { inner += segHTML(sg, c0); });
    if (C.hit === key && holdOnly) inner += holdTip(segs[0]);
    return '<div class="' + cls.join(' ') + '" data-role="cell" data-bar="' + row.bar + '" data-beat="' + bi + '"' +
      (holdOnly ? ' data-hold-only="1"' : '') + ' style="' + st + '">' + inner + '</div>';
  }

  function rowHTML(row) {
    var head = '<div class="rh" data-role="row-head" data-bar="' + row.bar + '"><b>' + pad(row.bar) + '</b></div>';
    var cells = '', lab = '';
    for (var bi = 0; bi < 4; bi++) {
      cells += cellHTML(row, bi);
      var key = row.bar + ':' + bi, r = paintOf(PAINT, key);
      if (r && (BYCELL[key] || []).length) lab += '<span class="rtag" style="--h:' + RULES[r].h + '"><i></i>' + RULES[r].f.join('·') + '</span>';
    }
    return '<div class="row" data-role="row" data-bar="' + row.bar + '">' + head + cells + '<div class="lab">' + lab + '</div></div>';
  }

  function sheetHTML() {
    var h = '<div class="sheet" data-role="lyrics-sheet"><div class="sh-head"><div class="corner">小节 \\ 拍</div>';
    for (var bi = 0; bi < 4; bi++) {
      var subs = '';
      for (var k = 0; k < 4; k++) subs += '<button class="sub" data-role="sub-tick" data-sub="' + k + '" aria-label="第 ' + (bi + 1) + ' 拍第 ' + (k + 1) + ' 个 16 分"></button>';
      h += '<div class="colh" data-role="beat-head" data-beat="' + bi + '"><button class="bn" aria-label="选中第 ' + (bi + 1) + ' 拍整列">' + (bi + 1) +
        '</button><div class="subs">' + subs + '</div></div>';
    }
    h += '<div class="lab-h">韵脚</div></div>';
    SONG.forEach(function (sec) {
      h += '<div class="sec"><div class="sec-h"><b data-role="section-label" data-contrast>' + sec.label + '</b><span>' + sec.rows.length + ' 小节</span></div>';
      sec.rows.forEach(function (row) { h += rowHTML(row); });
      h += '</div>';
    });
    return h + '</div>';
  }

  /* ---------- 字太密时的排法：按量出来的格宽给每个字定字号 / 去边线；还不够就整张表左右滑 ----------
   * 用户 11-16 定：1/32 不上下叠，手机上格子不够宽时整张表可左右滑（每拍至少放宽到字放得下 11px）。
   */
  function minCellFor(minBox) { return Math.ceil(((MIN_FONT + 1 + 2) * TPB) / minBox); }
  var SCROLL = null;   // 需要左右滑时：每拍格子里面的最小宽度（px）

  function density(cellW, base) {
    var minBox = WORDS.reduce(function (m, w) { return Math.min(m, w.box); }, 12);
    var need = minCellFor(minBox);
    SCROLL = cellW < need ? need : null;
    var cw = SCROLL || cellW, ppt = cw / TPB;
    WORDS.forEach(function (w) {
      var boxPx = w.box * ppt - 2, inner = boxPx - 2;
      if (inner >= base) w.dens = { fs: base };
      else if (inner >= MIN_FONT) w.dens = { fs: Math.floor(inner), cls: 'narrow' };
      else w.dens = { fs: MIN_FONT, cls: 'dense' };
    });
    return { cellW: cellW, base: base, scrollCell: SCROLL };
  }

  function sizeOf(box, cellW, base) {
    var need = minCellFor(box), cw = Math.max(cellW, need > cellW ? need : 0), ppt = cw / TPB, boxPx = box * ppt - 2, inner = boxPx - 2;
    var how = need > cellW ? '左右滑' : inner >= base ? '照常' : inner >= MIN_FONT ? '字缩小' : '去边线';
    var fs = inner >= base ? base : inner >= MIN_FONT ? Math.floor(inner) : MIN_FONT;
    return { box: boxPx, fs: fs, how: how, cell: cw };
  }

  /* ---------- 顶栏 / 轨道区 / 工具条 ---------- */
  function topHTML() {
    var hist = '<div class="hist">' +
      '<button class="ibtn" data-role="undo" aria-label="撤销" title="撤销">' + I.undo + '</button>' +
      '<button class="ibtn" data-role="redo" aria-label="重做" title="重做" disabled>' + I.redo + '</button>' +
      '<button class="ibtn" data-role="history-btn" aria-label="操作历史">' + I.hist + '<span class="desk-only">历史</span></button></div>';
    var steps = '<div class="steps" data-role="steps">' +
      '<button><i>1</i>铺 flow</button>' +
      '<button class="on"><i>2</i><span class="desk-only">填字和韵脚</span><span class="mob-only">填字</span></button></div>';
    var transport = '<div class="transport"><button class="ibtn desk-only" aria-label="回到开头">' + I.prev + '</button>' +
      '<button class="play" data-role="play" aria-label="播放">' + I.play + '</button>' +
      '<div class="pos"><b class="mono" data-contrast>1 · 1 · 1</b><span class="mono desk-only">0:00.0 / 1:52</span></div></div>';
    var bpm = '<div class="bpm"><span class="lbl desk-only">BPM</span><b class="mono">92</b></div>';
    return '<header class="top">' +
      '<div class="brand"><div class="logo">AB</div><div class="proj"><b>夜车</b><span><i class="dot"></i>已自动保存<span class="desk-only"> · 含撤销历史</span></span></div></div>' +
      '<div class="vsep desk-only"></div>' + hist +
      '<div class="desk-only" style="display:flex;align-items:center;gap:8px">' + steps + '<div class="vsep"></div>' + transport + bpm +
      '<button class="tog">' + I.metro + '节拍器</button></div>' +
      '<div class="spacer"></div>' +
      '<button class="btn ghost desk-only">' + I.folder + '作品</button>' +
      '<button class="btn desk-only">' + I.out + '导出</button>' +
      '<button class="ibtn mob-only" aria-label="导出">' + I.out + '</button>' +
      '</header>' +
      '<div class="bar2 mob-only">' + steps + transport + bpm + '</div>';
  }

  function waveSVG(n, seed) {
    var r = seed, out = '';
    for (var i = 0; i < n; i++) {
      r = (r * 1103515245 + 12345) % 2147483648;
      var v = 0.35 + 0.5 * Math.abs(Math.sin(i * 0.21)) + 0.3 * (r / 2147483648 - 0.5);
      if (i % 16 === 0) v = Math.min(1, v + 0.25);
      var hgt = Math.max(4, Math.min(38, v * 38));
      out += '<rect x="' + (i * 3) + '" y="' + (20 - hgt / 2) + '" width="2" height="' + hgt + '" style="fill:var(--wave)"/>';
    }
    return '<svg viewBox="0 0 ' + n * 3 + ' 40" preserveAspectRatio="none" aria-hidden="true">' + out + '</svg>';
  }

  function trackHTML() {
    var ruler = '', bars = 12, secs = {};
    SONG.forEach(function (sec) { secs[sec.rows[0].bar] = sec.label; });
    for (var i = 0; i < bars; i++) {
      ruler += '<span class="bm' + (secs[i] ? ' nx' : '') + '" style="left:' + (i / bars * 100).toFixed(3) + '%">' + (secs[i + 1] ? '' : i + 1) + '</span>';
      if (secs[i + 1]) ruler += '<span class="sl" data-role="section-label" style="left:calc(' + (i / bars * 100).toFixed(3) + '% + 2px)">' + secs[i + 1] + '</span>';
    }
    var name = '夜车_beat.mp3';
    return '<section class="track" data-role="track-area">' +
      '<div class="tl-lab ruler-l">小节</div><div class="ruler">' + ruler + '</div>' +
      '<div class="tl-lab"><div class="nm"><b>伴奏</b><span>' + name + ' · 92 BPM</span></div><div class="spacer"></div>' +
      '<button class="btn sm" data-role="replace-beat">' + I.swap + '替换伴奏</button></div>' +
      '<div class="lane">' + waveSVG(260, 7) + '<span class="playhead" style="left:0%"></span></div>' +
      '<div class="m-beat mob-only"><span>伴奏 <b>' + name + '</b> · 92 BPM</span><span class="spacer"></span>' +
      '<button class="btn sm" data-role="replace-beat">' + I.swap + '替换</button></div>' +
      '</section>';
  }

  function toolsHTML() {
    var status = {
      drag: '<b>金色</b> · 点了第 7 小节第 2 拍：这一拍只有拖音，涂不上',
      wrap: '点格子选中，拖动框选',
      dense: '选中 <b>第 6 小节第 4 拍</b>（1/32「地方」）'
    }[S];
    return '<div class="tools"><span class="lbl">选格子</span><div class="chips" data-role="sel-chips"><button class="on">单格</button><button>整行</button>' +
      '<button>整列</button><button>框选</button></div>' +
      '<div class="chips"><button>反选</button></div>' +
      '<div class="chips"><button>' + I.lock + '锁定</button></div>' +
      '<span class="status desk-only">' + status + '</span></div>';
  }

  /* ---------- 右栏 ---------- */
  function swatchesHTML() {
    var h = '<div class="swatches" data-role="swatches">';
    ['A', 'B', 'C', 'D'].forEach(function (id) {
      var r = RULES[id];
      h += '<button class="sw' + (C.rule === id ? ' on' : '') + '" data-role="swatch" data-rule="' + id + '" data-count="' + r.n + '" data-finals="' + r.f.join(' ') +
        '" style="--h:' + r.h + '" aria-label="' + r.name + ' · ' + ['单押', '双押', '三押', '四押'][r.n - 1] + ' ' + r.f.join(' ') + '"></button>';
    });
    return h + '<button class="sw add" aria-label="新建颜色">+</button></div>';
  }

  function ruleHead() {
    var r = RULES[C.rule], used = (PAINT[C.rule] || []).length;
    return '<div class="rule-h" style="--h:' + r.h + '"><i></i><b>' + r.name + '</b><span>' + ['单押', '双押', '三押', '四押'][r.n - 1] + ' · ' + r.f.join(' · ') +
      ' · 已涂 ' + used + ' 格</span></div>';
  }

  function ruleBlock() {
    var r = RULES[C.rule], seg = '', fins = '';
    ['单押', '双押', '三押', '四押'].forEach(function (x, i) { seg += '<button data-role="count-opt" class="' + (r.n === i + 1 ? 'on' : '') + '">' + x + '</button>'; });
    r.f.forEach(function (f, i) { fins += (i ? '<span class="fin-sep">·</span>' : '') + '<input class="fin" data-role="final-input" value="' + f + '" aria-label="第 ' + (i + 1) + ' 个韵母">'; });
    return '<div class="blk" style="--h:' + r.h + '">' + ruleHead() +
      '<div class="seg" data-role="rhyme-count">' + seg + '</div>' +
      '<div class="finals" data-role="finals"><label>韵母串</label>' + fins + '</div>' +
      '<p class="note">押在每个涂了' + r.name + '的格子里<b>最后 ' + r.n + ' 个字</b>上，拖的长度不算。韵母严格按字面比：iang 不算押 ang。</p></div>';
  }

  // 小样例：用和主表格同一套解析 / 画法，n 格一行
  function miniHTML(spec) {
    var bpr = spec.rows[0].length;
    var song = [{ rows: spec.rows.map(function (b, i) { return { bar: i + 1, b: b }; }) }];
    var ws = parse(song, bpr), paint = {};
    Object.keys(spec.paint || {}).forEach(function (k) { (paint[spec.paint[k]] = paint[spec.paint[k]] || []).push(k); });
    var byCell = annotate(ws, paint, function () { return true; });
    if (spec.handle) ws.forEach(function (w) { if (w.ch === spec.handle) w.handle = true; });
    var h = '<div class="mini" style="width:' + (bpr * 116) + 'px">';
    song[0].rows.forEach(function (row) {
      h += '<div class="mrow" style="--n:' + bpr + '">';
      for (var bi = 0; bi < bpr; bi++) {
        var key = row.bar + ':' + bi, c0 = (row.bar - 1) * bpr * TPB + bi * TPB, inner = '';
        var cw = (byCell[key] || []), segs = segsIn(ws, c0), rule = cw.length ? paintOf(paint, key) : null;
        for (var k = 0; k < 4; k++) inner += '<span class="tk" style="left:' + (k * 25) + '%"></span>';
        cw.forEach(function (w) { inner += slotHTML(w).replace('data-role="slot"', 'data-role="mini-slot"'); });
        segs.forEach(function (sg) { inner += segHTML(sg, c0).replace('data-role="drag-line"', 'data-role="mini-line"'); });
        h += '<div class="mc' + (rule ? ' painted' : '') + (spec.hit === key ? ' hit' : '') + '" style="' + (rule ? '--h:' + RULES[rule].h : '') + '">' + inner + '</div>';
      }
      h += '</div>';
    });
    return h + '</div>';
  }

  function caseHTML(no, title, where, spec) {
    return '<div class="case" data-role="hold-case"><span class="no">' + no + '</span><div class="ct"><b>' + title + '</b><span>' + where + '</span></div>' +
      '<div class="cm">' + miniHTML(spec) + '</div></div>';
  }

  function dragPanel() {
    return '<div class="pn" data-role="rhyme-panel"><div class="pn-h"><h2>押韵</h2><span>一种颜色 = 一条韵脚规则</span></div>' + swatchesHTML() +
      '<div style="--h:' + RULES.D.h + '">' + ruleHead() + '</div>' +
      '<div class="blk" data-role="hold-panel"><div class="pn-h"><h2>拖音 = 字的长度</h2></div>' +
      '<p class="note">每个字只记<b>起点 + 持续多少 tick</b>（每拍 48）。拖的部分是字后面的<b>同色细线</b>；空音就是字和字之间的空白。</p>' +
      '<div class="cases">' +
      caseHTML(1, '一个字拖满本拍', '第 3 小节第 1 拍「远——」', { rows: [['远---', '风吹过来']] }) +
      caseHTML(2, '一个字 + 一个空音', '第 6 小节第 2 拍「车」', { rows: [['车_穿过']] }) +
      caseHTML(3, '从本格拖进下一格', '第 5 小节第 2 拍「拍」', { rows: [['踩在节拍', '-带着光']], paint: { '1:0': 'B' } }) +
      caseHTML(4, '跨行拖到下一行开头', '第 6 小节「口」→ 第 7 小节', { rows: [['路口--'], ['--油门']], paint: { '1:0': 'C' } }) +
      caseHTML(5, '只有拖音的格子', '第 7 小节第 2 拍', { rows: [['--油门', '----']], hit: '1:1' }) +
      '</div>' +
      '<p class="note">③④ 拖过格线的字算在<b>它起点那一格</b>，颜色、押数都跟那一格走：「路口——」还是双押。</p></div>' +
      '<div class="blk"><div class="blk-h"><b>怎么拉长</b>在「① 铺 flow」里</div><div class="stretch">' +
      miniHTML({ rows: [['街灯__']], handle: '灯' }) +
      '<p class="note">拖字框<b>右边缘</b>往右拉，或选中按 <span class="kbd">-</span>：每按一次多拖一个精度单位（1/16 = 12 tick）。</p></div></div>' +
      '</div>';
  }

  function wrapPanel() {
    return '<div class="pn" data-role="rhyme-panel"><div class="pn-h"><h2>押韵</h2><span>一种颜色 = 一条韵脚规则</span></div>' + swatchesHTML() + ruleBlock() +
      '<div class="blk" data-role="wrap-panel"><div class="pn-h"><h2>一句超过一小节</h2></div>' +
      '<p class="note">第 4 小节这一句「我在这条路上走了很久很久才终于看清那一场雨」一小节放不下，超出的「清那一场 · 雨——」<b>接着排在第 5 小节开头</b>。</p>' +
      '<p class="note">行头照常写小节号，列头 1–4 拍上下对齐不变，<b>不加任何额外标记</b>。下一句「每一步都踩在节拍」从第 5 小节第 3 拍开始，和上一句的尾巴在同一行。</p>' +
      '<p class="note">押韵照常按格子算：这一句押在第 5 小节第 1 拍的「一场」（蓝色）。</p></div></div>';
  }

  function densePanel() {
    var cellW = DSTATS ? DSTATS.cellW : 168, base = DSTATS ? DSTATS.base : 19;
    var rows = [['1/16', 12], ['三连', 16], ['半拍三连', 8], ['1/32', 6]];
    var tr = '';
    rows.forEach(function (r) {
      var d = sizeOf(r[1], cellW, base), m = sizeOf(r[1], MOBILE_CELL - 0.5, 15);
      tr += '<tr><td>' + r[0] + '</td><td class="m">' + r[1] + '</td><td class="m">' + d.box.toFixed(0) + ' / ' + d.fs + '</td>' +
        '<td class="m' + (m.how !== '照常' ? ' k' : '') + '">' + m.box.toFixed(1) + ' / ' + m.fs + '</td><td>' + m.how + (m.how === '左右滑' ? '（每拍 ' + m.cell + '）' : '') + '</td></tr>';
    });
    return '<div class="pn" data-role="rhyme-panel"><div class="pn-h"><h2>押韵</h2><span>一种颜色 = 一条韵脚规则</span></div>' + swatchesHTML() +
      '<div style="--h:' + RULES.A.h + '">' + ruleHead() + '</div>' +
      '<div class="blk" data-role="dense-panel"><div class="pn-h"><h2>字太密时怎么排</h2></div>' +
      '<table class="wtab" data-role="width-table"><thead><tr><th>落点</th><th>tick</th><th>桌面 框/字</th><th>手机 框/字</th><th>手机上</th></tr></thead><tbody>' + tr + '</tbody></table>' +
      '<p class="note">单位 px。手机 390 宽一拍格宽 ' + MOBILE_CELL + '（桌面 ' + cellW.toFixed(0) + '）；字框 = 字占的 tick ÷ 48 × 格宽 − 2 px 间隙。</p>' +
      '<ol class="rules">' +
      '<li>字号 = 字框里放得下的宽度，最大 15 px（桌面 19 px），<b>最小 11 px</b>。字永远在框里。</li>' +
      '<li>放不下 11 px 先去掉边线、改浅底（多出 2 px）：半拍三连这样排。</li>' +
      '<li>还放不下（只有 1/32）：<b>整张表左右滑</b>——每拍放宽到 112 px，1/32 的字框 12 px，字 11 px；行头贴着左边，列头上下对齐不变。不上下叠，不缩放整张表。</li>' +
      '<li>作品里没有 1/32 就不滑；桌面格子宽，1/32 照常并排、不滑。</li></ol></div></div>';
  }

  function sidePanel() {
    if (S === 'wrap') return wrapPanel();
    if (S === 'dense') return densePanel();
    return dragPanel();
  }

  function drawerHTML() {
    return '<div class="drawer" data-role="rhyme-drawer"><div class="grab"></div>' +
      '<div class="dh"><h2>押韵</h2>' + swatchesHTML() + '<span class="more">上滑展开' + I.up + '</span></div></div>';
  }

  function mobileAnno() {
    if (S !== 'dense' || !DSTATS || !window.matchMedia('(max-width: 600px)').matches) return '';
    var cw = DSTATS.cellW, b = DSTATS.base;
    var s16 = sizeOf(12, cw, b), s3 = sizeOf(16, cw, b), s6 = sizeOf(8, cw, b), s32 = sizeOf(6, cw, b);
    return '<div class="anno m-anno" data-role="mockup-note"><span class="anno-b">视觉稿标注 · 不是界面</span>' +
      '<p>390 宽一拍本来 ' + cw.toFixed(1) + ' px：1/16 字框 ' + s16.box.toFixed(0) + ' px、三连 ' + s3.box.toFixed(0) + ' px，字 ' + s16.fs + ' px 照常；' +
      '半拍三连字框 ' + s6.box.toFixed(0) + ' px，<b>字缩到 ' + s6.fs + ' px</b>、去边线。' +
      '这首有 1/32：<b>整张表左右滑</b>，每拍放宽到 ' + s32.cell + ' px，1/32 字框 ' + s32.box.toFixed(0) + ' px、字 ' + s32.fs + ' px。最小字宽 11 px。</p></div>';
  }

  /* ---------- 拼页面 ---------- */
  var DSTATS = null;
  function render() {
    var html = '<div class="app">' + topHTML() + trackHTML() +
      '<div class="main"><main class="work">' + toolsHTML() + sheetHTML() + '</main>' +
      '<aside class="side">' + sidePanel() + '</aside></div></div>';
    document.body.innerHTML = html + drawerHTML() + mobileAnno();
    var sh = document.querySelector('[data-role="lyrics-sheet"]');
    if (sh && SCROLL) {
      var css = getComputedStyle(sh);
      sh.classList.add('scroll');
      sh.style.setProperty('--cell-min', (SCROLL + 1) + 'px');
      sh.style.minWidth = (parseFloat(css.getPropertyValue('--rh')) + 4 * (SCROLL + 1) + parseFloat(css.getPropertyValue('--lab')) + 2) + 'px';
    }
  }
  render();
  // 第二遍：按浏览器量出来的格宽定每个字的字号 / 去边线；不够宽就整张表左右滑，再画一次
  var cell = document.querySelector('[data-role="cell"]');
  var sheet = document.querySelector('[data-role="lyrics-sheet"]');
  if (cell && sheet) {
    var cs = getComputedStyle(sheet);
    DSTATS = density(cell.clientWidth, parseFloat(cs.getPropertyValue('--ch')));
    render();
  }
})();
