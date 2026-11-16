/* AnyBeats v3 视觉稿：所有画面共用这一份渲染脚本，画面由 <body data-screen="…"> 决定。
 * 数据模型和 DESIGN_v3.md 第 1 节一致：每拍 48 tick，每个字（字位 / 拖音 / 空音）记 tick 起点和长度；
 * 格子大小只是视图，字按 tick 摆在格子里。不外链任何资源，不发请求。
 */
(function () {
  'use strict';

  var TPB = 48; // 每拍 tick 数
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
    up: svg('<path d="m6 15 6-6 6 6"/>'),
    x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    warn: svg('<path d="M12 3 2 21h20z"/><path d="M12 10v5"/><path d="M12 18h.01"/>'),
    brush: svg('<path d="M14 4l6 6-9 9H5v-6z"/>'),
    paint: svg('<rect x="4" y="4" width="16" height="16" rx="3"/>'),
    type: svg('<path d="M5 6h14M12 6v13"/>'),
    flow: svg('<path d="M4 12h3l3-6 4 12 3-6h3"/>'),
    music: svg('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
    spark: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="m6 6 2 2M16 16l2 2M6 18l2-2M16 8l2-2"/>')
  };

  /* ---------- 作品数据（tick 模型） ----------
   * 每拍一个字符串：一个字 = 一个 16 分位置（12 tick）的字位；「-」拖音；「_」空音；「?」还没填字的字位；
   * 「[ab]」把一个 16 分拆成两个 32 分（各 6 tick）；以「3:」开头 = 这一拍三连（每个 16 tick）。
   * 连续的拖音 / 空音合并成一个更长的格。
   */
  var SONG = [
    { label: 'Intro', rows: [{ bar: 1, b: ['____', '____', '____', '走-吧-'] }] },
    { label: 'Verse 1', rows: [
      { bar: 2, b: ['凌晨三点', '街灯_在', '还在路上', '找个地方'] },
      { bar: 3, b: ['霓-虹-', '风吹过来', '把那梦想', '吹向西方'] },
      { bar: 4, b: ['3:我不怕', '_走得慢', '只要心里', '还有一场'] },
      { bar: 5, b: ['每一步都', '踩[在节]拍-', '带着光_', '去向远方'] }
    ] },
    { label: 'Hook', rows: [
      { bar: 6, b: ['开着夜-', '车_穿过', '霓虹_的', '每个路口'] },
      { bar: 7, b: ['油门-_', '踩-到满', '灯火阑珊', '我就不走'] },
      { bar: 8, b: ['3:风在吹', '灯-在闪', '这条街_', '没有出口'] },
      { bar: 9, b: ['开着夜-', '车_穿过', '一个一个', '十字路口'] }
    ] }
  ];

  // 一种颜色 = 一条韵脚规则：色相、押数（1–4）、韵母串（从前往后，对应格内最后 n 个字）
  var RULES = {
    A: { name: '蓝色', h: 215, n: 2, f: ['i', 'ang'] },
    B: { name: '绿色', h: 150, n: 1, f: ['ai'] },
    C: { name: '粉色', h: 340, n: 2, f: ['u', 'ou'] },
    D: { name: '金色', h: 42, n: 1, f: ['an'] }
  };
  var PAINT = {
    A: ['2:3', '3:3', '4:3', '5:3'],
    B: ['2:1', '3:1'],
    C: ['6:3', '7:3', '8:3', '9:3'],
    D: ['7:1', '7:2']
  };
  var CANDS = {
    A: ['地方', '西方', '一场', '激昂', '起航', '理想', '秘方', '低唱', '比方'],
    B: ['在', '来', '开', '海', '白', '待', '爱', '外', '帅'],
    C: ['路口', '出口', '不走', '入口', '出手', '不够', '无忧', '鼓手', '树后'],
    D: ['满', '珊', '看', '站', '散', '烂', '难', '蓝', '岸']
  };
  // 韵脚位置上会出现的字的韵母（演示用的小字表；产品里用 src/core 的韵表）
  var FIN = { 在: 'ai', 来: 'ai', 地: 'i', 西: 'i', 一: 'i', 方: 'ang', 场: 'ang', 远: 'uan', 路: 'u', 口: 'ou', 满: 'an', 珊: 'an', 不: 'u', 走: 'ou', 出: 'u' };
  function core(f) { return f && f.length > 1 ? f.replace(/^[iuü](?=[aeo])/, '') : f; } // 比对时忽略介音：iang≈ang、uan≈an

  function parseBeat(s) {
    var out = [], trip = false, t = 0, cs, i = 0;
    if (s.indexOf('3:') === 0) { trip = true; s = s.slice(2); }
    cs = Array.from(s);
    function push(c, tick, len, w32) {
      var kind = c === '-' ? 'hold' : c === '_' ? 'rest' : 'word';
      var last = out[out.length - 1];
      if (kind !== 'word' && last && last.kind === kind) { last.len += len; return; }
      out.push({ kind: kind, tick: tick, len: len, ch: kind === 'word' && c !== '?' ? c : '', w32: w32 });
    }
    while (i < cs.length) {
      if (cs[i] === '[') { push(cs[i + 1], t, 6, true); push(cs[i + 2], t + 6, 6, true); t += 12; i += 4; continue; }
      var len = trip ? 16 : 12;
      push(cs[i], t, len, false); t += len; i++;
    }
    return { slots: out, trip: trip };
  }
  SONG.forEach(function (sec) { sec.rows.forEach(function (r) { r.beats = r.b.map(parseBeat); }); });

  /* ---------- 每个画面的状态 ---------- */
  var ALL = function () { return true; };
  var FULL = { step: 2, chars: ALL, laid: ALL, paint: 'ABCD', rule: 'A', panel: 'rhyme', mismatch: true };
  function ext(base, more) { var o = {}, k; for (k in base) o[k] = base[k]; for (k in more) o[k] = more[k]; return o; }
  var CFG = {
    flow: { step: 1, chars: function () { return false; }, laid: function (bar, bi) { return bar < 8 || (bar === 8 && bi < 1); },
      paint: '', panel: 'flow', band: { beat: 1, sub: 2 }, cur: '8:1', pins: { '3:0': 1, '5:2': 2 }, guide: true, tool: 'flow' },
    paint: { step: 2, chars: function (bar) { return bar <= 5; }, laid: ALL, paint: 'ABC', rule: 'D', newRule: true, panel: 'rhyme',
      sel: { bar: 7, inn: [1, 2], out: [0, 3] }, tool: 'row', aiFill: true },
    full: ext(FULL, {}),
    lock: ext(FULL, { locks: { rows: [3], cols: [0], cells: ['6:1', '6:2'], rhyme: true }, lockTools: true, mismatch: false }),
    ai: ext(FULL, { locks: { rows: [], cols: [], cells: [], rhyme: true }, aiSel: [3, 4], panel: 'ai', banner: true, mismatch: false, tool: 'box' }),
    ai_reject: ext(FULL, { locks: { rows: [], cols: [], cells: [], rhyme: true }, aiSel: [3, 4], panel: 'ai', reject: true, banner: true,
      mismatch: false, tool: 'box', blocked: ['5:0:0', '3:3:24'] }),
    beat: ext(FULL, { dialog: true, mismatch: false }),
    history: ext(FULL, { locks: { rows: [3], cols: [], cells: [], rhyme: false }, history: true, mismatch: false }),
    drawer: ext(FULL, { rule: 'C', cur: '9:3', drawerOpen: true, mismatch: false })
  };
  var C = CFG[S] || FULL;
  var LK = C.locks || { rows: [], cols: [], cells: [], rhyme: false };

  function paintOf(bar, bi) {
    var key = bar + ':' + bi;
    for (var id in PAINT) if (C.paint.indexOf(id) >= 0 && PAINT[id].indexOf(key) >= 0) return id;
    return null;
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- 表格 ---------- */
  function slotHTML(s, opt) {
    var cls = ['slot', s.kind], attrs = '', inner = '';
    if (s.w32) cls.push('w32');
    if (s.kind === 'word') {
      var show = opt.chars && s.ch;
      if (show) { cls.push('filled'); inner = '<span class="ch">' + esc(s.ch) + '</span>'; }
      if (opt.final) {
        cls.push('rp');
        attrs += ' data-rhyme="' + opt.final + '"';
        if (!show) inner = '<span class="ph" data-role="placeholder">' + opt.final + '</span>';
        else if (FIN[s.ch] && core(FIN[s.ch]) !== core(opt.final) && C.mismatch) {
          cls.push('miss'); attrs += ' data-mismatch="' + core(FIN[s.ch]) + '≠' + core(opt.final) + '"';
        }
        if (LK.rhyme) inner += '<span class="slock" data-role="lock-icon">' + I.lock + '</span>';
      }
      if (opt.blocked) { cls.push('blocked'); inner += '<span class="bk" data-role="blocked">!</span>'; }
    }
    return '<span class="' + cls.join(' ') + '" data-role="slot" data-kind="' + s.kind + '" data-tick="' + s.tick + '" data-len="' + s.len + '"' + attrs +
      ' style="--t:' + s.tick + ';--l:' + s.len + '">' + inner + '</span>';
  }

  function cellHTML(row, bi) {
    var b = row.beats[bi], key = row.bar + ':' + bi, cls = ['cell'], st = '', inner = '', k;
    var rule = paintOf(row.bar, bi);
    if (rule) { cls.push('painted'); st = '--h:' + RULES[rule].h; }
    var rowLock = LK.rows.indexOf(row.bar) >= 0, colLock = LK.cols.indexOf(bi) >= 0, cellLock = LK.cells.indexOf(key) >= 0;
    if (rowLock || colLock || cellLock) cls.push('locked');
    if (C.sel && C.sel.bar === row.bar) {
      if (C.sel.inn.indexOf(bi) >= 0) cls.push('sel-in');
      if (C.sel.out.indexOf(bi) >= 0) cls.push('sel-out');
    }
    if (C.cur === key) cls.push('cursor');
    for (k = 0; k < 4; k++) inner += '<span class="tk" data-role="tick-line" style="left:' + (k * 25) + '%"></span>';
    if (C.band && C.band.beat === bi) inner += '<span class="band" style="left:' + (C.band.sub * 25) + '%;width:25%"></span>';
    if (cellLock) inner += '<span class="clock" data-role="lock-icon">' + I.lock + '</span>';
    if (C.sel && C.sel.bar === row.bar && C.sel.out.indexOf(bi) >= 0) inner += '<span class="out-tag">已去掉</span>';
    if (C.pins && C.pins[key]) inner += '<span class="pin">' + C.pins[key] + '</span>';
    if (C.laid(row.bar, bi)) {
      if (b.trip) inner += '<span class="trip" data-role="triplet-mark"><b>3</b></span>';
      var words = b.slots.filter(function (s) { return s.kind === 'word'; });
      var n = rule ? RULES[rule].n : 0, rp = words.slice(words.length - n);
      b.slots.forEach(function (s) {
        var j = rp.indexOf(s);
        var blocked = C.blocked && C.blocked.indexOf(key + ':' + s.tick) >= 0;
        inner += slotHTML(s, { chars: C.chars(row.bar), final: j >= 0 ? RULES[rule].f[j] : null, blocked: blocked });
      });
    }
    return '<div class="' + cls.join(' ') + '" data-role="cell" data-bar="' + row.bar + '" data-beat="' + bi + '" style="' + st + '">' + inner + '</div>';
  }

  function missesOf(row) {
    var out = [];
    if (!C.mismatch || !C.chars(row.bar)) return out;
    row.beats.forEach(function (b, bi) {
      var rule = paintOf(row.bar, bi);
      if (!rule) return;
      var words = b.slots.filter(function (s) { return s.kind === 'word'; }), n = RULES[rule].n;
      words.slice(words.length - n).forEach(function (s, j) {
        var want = RULES[rule].f[j];
        if (s.ch && FIN[s.ch] && core(FIN[s.ch]) !== core(want)) out.push({ ch: s.ch, got: FIN[s.ch], want: want, beat: bi });
      });
    });
    return out;
  }

  function rowHTML(row) {
    var head = '<div class="rh' + (C.sel && C.sel.bar === row.bar ? ' on' : '') + '" data-role="row-head" data-bar="' + row.bar + '"><b>' + pad(row.bar) + '</b>' +
      (LK.rows.indexOf(row.bar) >= 0 ? '<span data-role="lock-icon">' + I.lock + '</span>' : '') + '</div>';
    var cells = '';
    for (var bi = 0; bi < 4; bi++) cells += cellHTML(row, bi);
    var lab = '';
    for (bi = 0; bi < 4; bi++) {
      var r = paintOf(row.bar, bi);
      if (r && (bi === 3 || S !== 'flow')) lab += '<span class="rtag" style="--h:' + RULES[r].h + '"><i></i>' + RULES[r].f.join('·') + '</span>';
    }
    missesOf(row).forEach(function (m) {
      lab = '<span class="miss-tag" data-role="mismatch">「' + m.ch + '」' + m.got + ' ≠ ' + m.want + '</span>';
    });
    return '<div class="row" data-role="row" data-bar="' + row.bar + '">' + head + cells + '<div class="lab">' + lab + '</div></div>';
  }

  function sheetHTML() {
    var h = '<div class="sheet" data-role="lyrics-sheet"><div class="sh-head"><div class="corner">小节 \\ 拍</div>';
    for (var bi = 0; bi < 4; bi++) {
      var subs = '';
      for (var k = 0; k < 4; k++) {
        var on = C.band && C.band.beat === bi && C.band.sub === k;
        subs += '<button class="sub' + (on ? ' on' : '') + '" data-role="sub-tick" data-sub="' + k + '" aria-label="第 ' + (bi + 1) + ' 拍第 ' + (k + 1) + ' 个 16 分"></button>';
      }
      h += '<div class="colh" data-role="beat-head" data-beat="' + bi + '"><button class="bn" aria-label="选中第 ' + (bi + 1) + ' 拍整列">' + (bi + 1) +
        (LK.cols.indexOf(bi) >= 0 ? '<span data-role="lock-icon">' + I.lock + '</span>' : '') + '</button><div class="subs">' + subs + '</div></div>';
    }
    h += '<div class="lab-h">韵脚</div></div>';
    SONG.forEach(function (sec) {
      h += '<div class="sec"><div class="sec-h"><b data-role="section-label" data-contrast>' + sec.label + '</b><span>' + sec.rows.length + ' 小节</span></div>';
      var open = false;
      sec.rows.forEach(function (row) {
        var inSel = C.aiSel && row.bar >= C.aiSel[0] && row.bar <= C.aiSel[1];
        if (inSel && !open) { h += '<div class="ai-sel" data-role="ai-selection"><span class="ai-sel-tag">选区 · 第 ' + C.aiSel[0] + '–' + C.aiSel[1] + ' 小节</span>'; open = true; }
        if (!inSel && open) { h += '</div>'; open = false; }
        h += rowHTML(row);
      });
      if (open) h += '</div>';
      h += '</div>';
    });
    return h + '</div>';
  }

  /* ---------- 顶栏 / 轨道区 / 工具条 ---------- */
  function topHTML() {
    var undoLabel = S === 'history' ? '撤销：锁定第 3 小节整行' : '撤销';
    var redoLabel = S === 'history' ? '重做：换伴奏' : '重做';
    var redoOff = S !== 'history';
    var hist = '<div class="hist">' +
      '<button class="ibtn" data-role="undo" aria-label="' + undoLabel + '" title="' + undoLabel + '">' + I.undo + '</button>' +
      '<button class="ibtn" data-role="redo" aria-label="' + redoLabel + '" title="' + redoLabel + '"' + (redoOff ? ' disabled' : '') + '>' + I.redo + '</button>' +
      '<button class="ibtn' + (S === 'history' ? ' on' : '') + '" data-role="history-btn" aria-label="操作历史">' + I.hist + '<span class="desk-only">历史</span></button></div>';
    var steps = '<div class="steps" data-role="steps">' +
      '<button class="' + (C.step === 1 ? 'on' : '') + '"><i>1</i>铺 flow</button>' +
      '<button class="' + (C.step === 2 ? 'on' : '') + '"><i>2</i><span class="desk-only">填字和韵脚</span><span class="mob-only">填字</span></button></div>';
    var transport = '<div class="transport"><button class="ibtn desk-only" aria-label="回到开头">' + I.prev + '</button>' +
      '<button class="play" data-role="play" aria-label="播放">' + I.play + '</button>' +
      '<div class="pos"><b class="mono" data-contrast>6 · 1 · 1</b><span class="mono desk-only">0:13.0 / 1:52</span></div></div>';
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

  function waveSVG(n, seed, played) {
    var r = seed, out = '';
    for (var i = 0; i < n; i++) {
      r = (r * 1103515245 + 12345) % 2147483648;
      var v = 0.35 + 0.5 * Math.abs(Math.sin(i * 0.21)) + 0.3 * (r / 2147483648 - 0.5);
      if (i % 16 === 0) v = Math.min(1, v + 0.25);
      var hgt = Math.max(4, Math.min(38, v * 38));
      out += '<rect x="' + (i * 3) + '" y="' + (20 - hgt / 2) + '" width="2" height="' + hgt + '" style="fill:var(' + (i / n < played ? '--wave-played' : '--wave') + ')"/>';
    }
    return '<svg viewBox="0 0 ' + n * 3 + ' 40" preserveAspectRatio="none" aria-hidden="true">' + out + '</svg>';
  }

  function guideHTML() {
    // 导唱：每个字位一声，拖音把这一声拉长，空音不出声。按表格里铺好的字位生成，块数 = 字位数。
    var blips = '', count = 0, bars = 12; // 和上面波形同一条时间轴（12 小节）
    SONG.forEach(function (sec) {
      sec.rows.forEach(function (row) {
        row.beats.forEach(function (b, bi) {
          if (!C.laid(row.bar, bi)) return;
          b.slots.forEach(function (s, si) {
            if (s.kind !== 'word') return;
            var len = s.len, nx = b.slots[si + 1];
            if (nx && nx.kind === 'hold') len += nx.len;
            var x = ((row.bar - 1) * 4 * TPB + bi * TPB + s.tick) / (bars * 4 * TPB) * 100;
            var w = len / (bars * 4 * TPB) * 100;
            blips += '<span class="blip' + (len > s.len ? ' long' : '') + '" data-role="guide-blip" style="left:' + x.toFixed(3) + '%;width:calc(' + w.toFixed(3) + '% - 1px)"></span>';
            count++;
          });
        });
      });
    });
    return '<div class="guide-row after" data-role="later"><span class="after-b">后续实现<small>静态版先不做</small></span>' +
      '<div class="gl"><button class="btn sm" data-role="guide-entry" style="align-self:flex-start">' + I.music + '生成导唱</button>' +
      '<span>按 ' + count + ' 个字位，每个字位「嗒」一声，拖音拉长，空音不出声</span></div>' +
      '<div class="guide-lane" data-role="guide-lane">' + blips + '</div></div>';
  }

  function trackHTML() {
    var ruler = '', bars = 12, secs = { 1: 'Intro', 2: 'Verse 1', 6: 'Hook', 10: 'Verse 2' };
    for (var i = 0; i < bars; i++) {
      ruler += '<span class="bm' + (secs[i] ? ' nx' : '') + '" style="left:' + (i / bars * 100).toFixed(3) + '%">' + (secs[i + 1] ? '' : i + 1) + '</span>';
      if (secs[i + 1]) ruler += '<span class="sl" data-role="section-label" style="left:calc(' + (i / bars * 100).toFixed(3) + '% + 2px)">' + secs[i + 1] + '</span>';
    }
    var name = '夜车_beat.mp3';
    return '<section class="track" data-role="track-area">' +
      '<div class="tl-lab ruler-l">小节</div><div class="ruler">' + ruler + '</div>' +
      '<div class="tl-lab"><div class="nm"><b>伴奏</b><span>' + name + ' · 92 BPM</span></div><div class="spacer"></div>' +
      '<button class="btn sm" data-role="replace-beat">' + I.swap + '替换伴奏</button></div>' +
      '<div class="lane">' + waveSVG(260, 7, 5 / 12) + '<span class="playhead" style="left:' + (5 / 12 * 100).toFixed(3) + '%"></span></div>' +
      '<div class="m-beat mob-only"><span>伴奏 <b>' + name + '</b> · 92 BPM</span><span class="spacer"></span>' +
      '<button class="btn sm" data-role="replace-beat">' + I.swap + '替换</button></div>' +
      (C.guide ? guideHTML() : '') +
      '</section>';
  }

  function chipSample(kind) {
    return '<span style="position:relative;display:inline-block;width:24px;height:16px;--slot-top:0px;--slot-h:16px;--t:0;--l:' + (kind === 'word' ? 24 : 48) + '">' +
      '<span class="slot ' + kind + '" data-kind="' + kind + '" style="left:0;width:' + (kind === 'word' ? 14 : 24) + 'px"></span></span>';
  }

  function toolsHTML() {
    if (C.tool === 'flow') {
      return '<div class="tools"><span class="lbl">画笔</span><div class="chips" data-role="slot-legend">' +
        '<button class="on-soft">' + chipSample('word') + '字位</button><button>' + chipSample('hold') + '拖音</button><button>' + chipSample('rest') + '空音</button></div>' +
        '<span class="lbl">精度</span><div class="chips"><button>1/8</button><button class="on">1/16</button><button>1/32</button><button>三连</button></div>' +
        '<span class="status desk-only"><b>第 2 拍第 3 个 16 分</b>（整首这一列）· 正在铺第 8 小节第 2 拍</span></div>';
    }
    var t = C.tool || 'cell';
    function on(x) { return t === x ? ' class="on"' : ''; }
    var status = {
      row: '<b>第 7 小节整行</b>，反选去掉第 1、4 拍 → 已选 2 格',
      box: '<b>框选第 3–4 小节</b> · 8 格',
      cell: C.lockTools ? '<b>4 种锁</b>：第 3 小节整行 · 第 1 拍整列 · 第 6 小节 2 格 · 全部韵脚' :
        C.cur ? '选中 <b>第 ' + C.cur.split(':')[0] + ' 小节第 ' + (+C.cur.split(':')[1] + 1) + ' 拍</b>' : '点格子选中，拖动框选'
    }[t];
    return '<div class="tools"><span class="lbl">选格子</span><div class="chips" data-role="sel-chips"><button' + on('cell') + '>单格</button><button' + on('row') + '>整行</button>' +
      '<button' + on('col') + '>整列</button><button' + on('box') + '>框选</button></div>' +
      '<div class="chips"><button' + (t === 'row' ? ' class="on-soft"' : '') + '>反选</button></div>' +
      '<div class="chips"><button' + (C.lockTools ? ' class="on-soft"' : '') + '>' + I.lock + '锁定</button></div>' +
      '<span class="status desk-only">' + status + '</span></div>';
  }

  /* ---------- 右栏 / 抽屉面板 ---------- */
  function afterBox(inner, label) {
    return '<div class="after" data-role="after-connect"><span class="after-b">接入后' + (label ? '<small>' + label + '</small>' : '') + '</span>' + inner + '</div>';
  }

  function swatchesHTML() {
    var h = '<div class="swatches" data-role="swatches">';
    ['A', 'B', 'C', 'D'].forEach(function (id) {
      var r = RULES[id];
      h += '<button class="sw' + (C.rule === id ? ' on' : '') + '" data-role="swatch" data-rule="' + id + '" data-count="' + r.n + '" data-finals="' + r.f.join(' ') +
        '" style="--h:' + r.h + '" aria-label="' + r.name + ' · ' + ['单押', '双押', '三押', '四押'][r.n - 1] + ' ' + r.f.join(' ') + '"></button>';
    });
    return h + '<button class="sw add" aria-label="新建颜色">+</button></div>';
  }

  function ruleBlock() {
    var r = RULES[C.rule], used = C.paint.indexOf(C.rule) >= 0 ? PAINT[C.rule].length : 0;
    var seg = '';
    ['单押', '双押', '三押', '四押'].forEach(function (x, i) { seg += '<button data-role="count-opt" class="' + (r.n === i + 1 ? 'on' : '') + '">' + x + '</button>'; });
    var fins = '';
    r.f.forEach(function (f, i) { fins += (i ? '<span class="fin-sep">·</span>' : '') + '<input class="fin" data-role="final-input" value="' + f + '" aria-label="第 ' + (i + 1) + ' 个韵母">'; });
    return '<div class="blk" style="--h:' + r.h + '"><div class="rule-h"><i></i><b>' + r.name + '</b><span>' + (C.newRule ? '刚新建 · 还没涂' : '已涂 ' + used + ' 格') + '</span></div>' +
      '<div class="seg" data-role="rhyme-count">' + seg + '</div>' +
      '<div class="finals" data-role="finals"><label>韵母串</label>' + fins + '</div>' +
      '<p class="note">押在每个涂了' + r.name + '的格子里<b>最后 ' + r.n + ' 个字</b>上（拖音、空音不算字）。整首作品里' + r.name + '都按这一条规则检查。</p></div>';
  }

  function rhymePanel() {
    var r = RULES[C.rule], h = '<div class="pn" data-role="rhyme-panel">';
    if (C.lockTools) h += lockBlock();
    h += '<div class="pn-h"><h2>押韵</h2><span>一种颜色 = 一条韵脚规则</span></div>' + swatchesHTML() + ruleBlock();
    if (S === 'paint') {
      h += '<div class="blk" data-role="sel-tools"><div class="blk-h"><b>选格子</b>先选颜色，再选格子</div>' +
        '<div class="chips" style="align-self:flex-start"><button>单格</button><button class="on">整行</button><button>整列</button><button>框选</button><button class="on-soft">反选</button></div>' +
        '<p class="note">第 7 小节整行选中后，反选去掉了第 1 拍和第 4 拍（第 4 拍已经是粉色，<b>一格只能一种颜色</b>）。</p>' +
        '<div class="row-btns"><button class="btn primary">涂上金色（2 格）</button><button class="btn">擦掉颜色</button></div></div>';
    }
    if (C.mismatch) {
      h += '<div class="blk"><div class="miss-tag" data-role="mismatch" style="white-space:normal;padding:6px 8px;font-size:12px">' +
        '第 5 小节第 4 拍「远」韵母是 uan，蓝色这一位要 i，对不上。只提示，不会自动改。</div></div>';
    }
    if (C.aiFill) {
      h += afterBox('<div class="blk-h"><b>AI 一次性填韵脚</b></div>' +
        '<p class="note">把所有涂了色、还空着的韵脚位置一次填上（这首里 8 个），已经写了字的位置不动。填进来的字先标成「待确认」。</p>' +
        '<div class="row-btns" style="margin-top:8px"><button class="btn sm primary" data-role="ai-fill">' + I.spark + 'AI 填入 8 个韵脚</button><button class="btn sm">只填选中的格</button></div>' +
        '<p class="note" style="margin-top:6px">填完的样子：第 6 小节「路口」· 第 7 小节「不走」· 第 8 小节「出口」…… 每格旁边有「采用 / 换一个」。</p>', '静态版藏起来');
    }
    var where = { A: '蓝色 · i · ang', B: '绿色 · ai', C: '粉色 · u · ou', D: '金色 · an' }[C.rule];
    var cands = '';
    CANDS[C.rule].forEach(function (w, i) { cands += '<button class="cand' + (C.rule === 'C' && i === 0 ? ' on' : '') + '">' + w + '</button>'; });
    h += '<div class="blk"><div class="blk-h"><b>候选</b>押 ' + where + (C.rule === 'C' ? ' · 填进第 9 小节第 4 拍' : '') + '</div><div class="cands">' + cands + '</div>' +
      '<p class="note">候选来自本机韵表，不联网。点一下填进选中格的韵脚位置。</p></div>';
    return h + '</div>';
  }

  function lockBlock() {
    var opts = [
      ['锁整行', '第 3 小节 · 已锁'],
      ['锁整列', '第 1 拍 · 已锁'],
      ['锁选中的格子', '第 6 小节 2 格 · 已锁'],
      ['锁全部韵脚位置', '开 · 20 个字']
    ];
    var h = '<div class="blk" data-role="lock-tools" style="border-top:0;padding-top:0"><div class="pn-h"><h2>锁定</h2><span>锁住的字不能改字、不能挪落点</span></div>';
    opts.forEach(function (o) { h += '<div class="mi on" data-role="lock-opt">' + I.lock + o[0] + '<span>' + o[1] + '</span></div>'; });
    return h + '<p class="note">表格里：<b>斜纹</b>＝这一格锁了；行头 / 列头 / 格角 / 字角上的<b>小锁</b>＝锁的范围。</p></div>';
  }

  function slotLegend() {
    function lg(kind, name, desc) {
      return '<div class="lg"><div class="samp" style="--t:0;--l:' + (kind === 'word' ? 12 : 24) + '"><span class="slot ' + kind + '" data-kind="' + kind + '"></span></div>' +
        '<div><b>' + name + '</b><p>' + desc + '</p></div></div>';
    }
    return '<div class="legend" data-role="slot-legend">' +
      lg('word', '字位', '实线框：之后在这里填一个字') +
      lg('hold', '拖音', '实心横条：前一个字拖长，占这个位置') +
      lg('rest', '空音', '虚线框加灰底：停顿，不出声') + '</div>';
  }

  function exSample(a, b) {
    var s = '<div class="samp2">';
    s += '<span class="slot word" style="--t:0;--l:24;left:4px;width:calc(50% - 6px)"><span class="ch">字</span></span>';
    if (b === 'hold') s += '<span class="slot hold" style="left:calc(50% - 2px);width:calc(50% - 2px)"></span>';
    else s += '<span class="slot rest" style="left:calc(50% + 2px);width:calc(50% - 6px)"></span>';
    return s + '</div>';
  }

  function flowPanel() {
    return '<div class="pn" data-role="flow-panel"><div class="pn-h"><h2>铺 flow</h2><span>第一步：先铺空字格，第二步再填字</span></div>' +
      slotLegend() +
      '<div class="blk"><div class="blk-h"><b>一格里两个位置可以是</b></div><div class="two">' +
      '<div class="ex">' + exSample('word', 'hold') + '<p>① 一个字拖两个位置<br><span>表格第 3 小节第 1 拍</span></p></div>' +
      '<div class="ex">' + exSample('word', 'rest') + '<p>② 一个字 + 一个空音<br><span>表格第 5 小节第 3 拍</span></p></div></div></div>' +
      '<div class="blk"><div class="blk-h"><b>落点精度</b></div><div class="chips" style="align-self:flex-start"><button>1/8</button><button class="on">1/16</button><button>1/32</button><button>三连</button></div>' +
      '<p class="note">每拍 48 tick：1/8 = 24、1/16 = 12、1/32 = 6、三连 = 16。格子只是视图，字记的是 tick。一拍里放 3 个字时格子上方标「3」。</p></div>' +
      '<div class="blk"><div class="blk-h"><b>第 7 小节</b>13 个字位 · 2 处拖音 · 1 处空音</div>' +
      '<div class="row-btns"><button class="btn sm">复制到下一行</button><button class="btn sm">清空这一行</button></div></div>' +
      afterBox('<div class="blk-h"><b>AI 铺 flow</b></div><p class="note">按伴奏和上下文给还空着的小节铺空字格，铺完照样能手改。</p>' +
        '<div class="row-btns" style="margin-top:8px"><button class="btn sm">' + I.spark + 'AI 铺第 8–9 小节</button></div>', '静态版藏起来') +
      '</div>';
  }

  function aiPanel() {
    var body = '<div class="ai-head"><div class="pn-h"><h2>AI 润色选区</h2></div>' +
      '<p class="note">选区 <b>第 3–4 小节</b>（2 句 · 28 个字位）。全文 9 句都给 AI 当上下文，<b>只改选区</b>。</p>' +
      '<p class="note">选区里 5 个锁定的字（来 · 西方 · 一场）<b>不许改</b>。</p></div>' +
      '<div class="switch"><button class="sw-tr" role="switch" aria-checked="true" data-role="keep-skeleton"></button><div><b>保持骨架</b><span>字数、每个字的落点都不变，只换字（默认）</span></div></div>' +
      '<div class="switch"><button class="sw-tr" role="switch" aria-checked="false" data-role="allow-flow"></button><div><b>允许改 flow</b><span>可以增减字、挪落点</span></div></div>' +
      '<div class="ta">更有画面感，别用「梦想」</div>';
    body += '<div class="ai-res">';
    if (C.reject) {
      body += '<div class="reject" data-role="ai-rejected"><h3>' + I.warn + '这一版作废了，没有上屏</h3>' +
        '<p>程序逐字比对 AI 的结果，发现它动了不该动的位置，整份结果不用，表格保持原样：</p>' +
        '<ul><li>第 5 小节第 1 拍「每」→「这」：<b>在选区外</b></li><li>第 3 小节第 4 拍「西」→「远」：<b>锁定的字</b></li></ul>' +
        '<p>表格上打「!」的就是它想改的位置。</p></div>' +
        '<div class="row-btns"><button class="btn primary">再试一次</button><button class="btn">看 AI 原文</button></div>';
    } else {
      body += '<div class="diff" data-role="ai-proposal">' +
        '<div class="dl"><span class="k">第 3 小节</span><span class="old">霓虹 风吹过来 把那梦想 吹向西方</span></div>' +
        '<div class="dl"><span class="k"></span><span class="nw"><b>灯影</b> <b>雨落下</b>来 把那<b>名字</b> 吹向西方</span></div>' +
        '<div class="dl"><span class="k">第 4 小节</span><span class="old">我不怕 走得慢 只要心里 还有一场</span></div>' +
        '<div class="dl"><span class="k"></span><span class="nw"><b>谁在等</b> <b>开</b>得慢 只要<b>窗外</b> 还有一场</span></div></div>' +
        '<div class="checks"><span>✓ 选区外没有改动</span><span>✓ 锁定的 5 个字没动</span><span>✓ 字数和落点没变（骨架保持）</span></div>' +
        '<div class="row-btns"><button class="btn primary">用这一版</button><button class="btn">再来一版</button><button class="btn ghost">放弃</button></div>';
    }
    body += '</div>';
    return '<div class="pn" data-role="ai-panel">' + afterBox(body, '静态版没有这个面板') + '</div>';
  }

  function sidePanel() {
    if (C.panel === 'flow') return flowPanel();
    if (C.panel === 'ai') return aiPanel();
    return rhymePanel();
  }

  function drawerHTML() {
    var tail = C.mismatch ? '<span class="miss-tag" data-role="mismatch">1 处对不上</span>' :
      '<span class="more">' + (C.drawerOpen ? '下滑收起' : '上滑展开') + I.up + '</span>';
    return '<div class="drawer' + (C.drawerOpen ? ' open' : '') + '" data-role="rhyme-drawer"><div class="grab"></div>' +
      '<div class="dh"><h2>押韵</h2>' + swatchesHTML() + tail + '</div>' +
      (C.drawerOpen ? '<div class="dbody">' + rhymePanel() + '</div>' : '') + '</div>';
  }

  function mobileBar() {
    if (S === 'paint') {
      var r = RULES.D;
      return '<div class="m-bar" data-role="m-rule-bar" style="--h:' + r.h + '"><div class="rule-h"><i></i><b>金色</b><span>单押 · an</span></div>' +
        '<span class="status">已选 <b>2 格</b></span><span class="spacer"></span><button class="btn sm primary">涂上</button></div>';
    }
    if (C.lockTools) {
      return '<div class="m-bar" style="flex-direction:column;align-items:stretch;gap:2px;padding:6px 8px">' +
        '<div class="mi on" data-role="lock-opt">' + I.lock + '锁整行<span>第 3 小节</span></div>' +
        '<div class="mi on" data-role="lock-opt">' + I.lock + '锁整列<span>第 1 拍</span></div>' +
        '<div class="mi on" data-role="lock-opt">' + I.lock + '锁选中的格子<span>第 6 小节 2 格</span></div>' +
        '<div class="mi on" data-role="lock-opt">' + I.lock + '锁全部韵脚位置<span>开</span></div></div>';
    }
    return '';
  }

  function historyHTML() {
    function he(type, icon, text, small, redo) {
      return '<div class="he' + (redo ? ' redo' : '') + '" data-role="history-entry" data-type="' + type + '"><span class="ic">' + icon + '</span><span>' + text + '</span><small>' + small + '</small></div>';
    }
    return '<div class="menu hist-pop" data-role="history" style="top:52px;left:150px">' +
      '<div class="menu-h">操作历史 · 撤销了 2 步，还能重做</div>' +
      '<div class="he redo" data-role="history-entry" data-type="ai"><span class="ic">' + I.spark + '</span>' +
      '<span class="after" data-role="after-connect"><span class="after-b">接入后</span>AI 改写 第 3–4 小节</span><small>可重做</small></div>' +
      he('beat', I.swap, '换伴奏 夜车_beat → 雨夜_beat（保留 92 BPM）', '下一步重做', true) +
      '<div class="cur-line" data-role="history-current">现在在这里</div>' +
      he('lock', I.lock, '锁定 第 3 小节整行', '刚刚') +
      he('paint', I.paint, '涂色 粉色 · 第 6–9 小节第 4 拍', '2 分钟前') +
      he('fill', I.type, '填字 第 6 小节「开着夜车」', '3 分钟前') +
      he('flow', I.flow, '铺 flow 第 8–9 小节', '5 分钟前') +
      he('paint', I.paint, '涂色 蓝色 · 第 2–5 小节第 4 拍（整列）', '6 分钟前') +
      '<div class="hist-foot">撤销 / 重做只走这一条历史：填字、铺 flow、涂色、锁定、换伴奏都在里面，接入后的润色也在。' +
      '历史跟作品一起存在本机浏览器，<b>刷新页面后还在</b>，能接着撤销、重做；在中间做了新改动，上面灰色的步骤会丢掉。</div></div>';
  }

  function dialogHTML() {
    return '<div class="backdrop"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="bpm-t" data-role="bpm-dialog">' +
      '<button class="ibtn x" aria-label="取消，不换伴奏">' + I.x + '</button>' +
      '<h3 id="bpm-t">新伴奏的 BPM 不一样</h3>' +
      '<div class="bpm-cmp"><span class="muted">原来</span><b>92</b><span class="muted">→ 雨夜_beat.wav</span><b>100</b><span class="muted">BPM</span></div>' +
      '<div class="why">歌词记的是「第几小节、第几拍、第几个 tick」，<b>跟着拍子走，不跟秒数走</b>。不管选哪个，每个字都还在原来那一拍上，不会错位；变的只是播放快慢。</div>' +
      '<div class="opts">' +
      '<button class="opt rec" data-role="bpm-option"><b>保留原 BPM（92）</b><span>新伴奏变速到 92 播放（慢 8%），整首速度不变。</span><em>推荐：已经录过 / 练熟的作品</em></button>' +
      '<button class="opt" data-role="bpm-option"><b>改用新 BPM（100）</b><span>整首按 100 走，字跟着拍子一起变快，一首从 1:52 变成 1:43。</span></button>' +
      '</div><p class="muted" style="font-size:12px">新伴奏首拍在 0.42 秒，已自动对齐第 1 小节。换伴奏也记进撤销历史，可以撤回。</p></div></div>';
  }

  /* ---------- 拼页面 ---------- */
  var html = '<div class="app">' + topHTML();
  if (C.banner) {
    html += '<div class="after after-banner" data-role="after-connect"><span class="after-b">接入后</span>' +
      '这个画面只在接上 AI 之后出现，静态版没有入口。' + (C.reject ? '下面是 AI 结果被程序拦下的样子。' : '') + '</div>';
  }
  html += trackHTML() + '<div class="main"><main class="work">' + toolsHTML() + sheetHTML() + '</main>' +
    '<aside class="side">' + sidePanel() + '</aside></div></div>';
  html += drawerHTML() + mobileBar();
  if (C.panel === 'ai') html += '<div class="sheetm mob-only">' + aiPanel() + '</div>';
  if (C.history) html += historyHTML();
  if (C.dialog) html += dialogHTML();
  document.body.innerHTML = html;

  // 手机：把选区 / 选中格滚到表头下面，免得被底部面板挡住
  if (window.matchMedia('(max-width: 600px)').matches) {
    var work = document.querySelector('.work');
    var target = C.aiSel ? document.querySelector('.ai-sel') : (C.drawerOpen && C.cur ? document.querySelector('.cell.cursor') : null);
    if (target) {
      work.style.paddingBottom = '60vh'; // 底部面板盖住的那一截留出空白，表格才滚得上去
      var row = target.closest('.row') || target;
      work.scrollTop += row.getBoundingClientRect().top - work.getBoundingClientRect().top - (C.aiSel ? 112 : 136);
    }
  }
})();
