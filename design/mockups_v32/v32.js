/* AnyBeats v3.2 视觉稿：第 1 步「铺 flow」改成方格。七个画面共用这一份渲染脚本，画面由 <body data-screen="…"> 决定。
 *   default  新作品 / 清空全部 flow 之后：每个 1/4 拍一个空方格（方格 = 这里有一个字，字还没写）
 *   edit     点一个方格进入改字：方格描强调色边、有光标；打字写进这一格；下面一个小气泡说明按键
 *   split8   按空格：这一格平分成两个 1/8，字留在左边那一半，光标还在左边
 *   split16  再按空格 → 1/16；点右边那半再按空格 → 两个 1/32；1/32 再按空格被拒绝（提示）
 *   triplet  Shift+空格：分成三连（一拍 3 个；1/8 那么长的方格分成半拍三连）
 *   rest     0.4 秒内按两下空格：第一下的分格撤回，这一格变成空音（没有方格，只剩空白）；历史里只算一步
 *   clear    「清空全部 flow…」：就地二次确认（和「清空当前文字…」同一种做法），确定后每一拍变回一个方格
 * 数据模型不变：每个字只记 起点 tick + 持续 tick（每拍 48 tick）。方格 = 一个字（文字可以是空的），空音 = 字和字之间的空白。
 * 不外链任何资源，不发请求。
 */
(function () {
  'use strict';

  var TPB = 48;
  var MIN_FONT = 11;
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
    plus: svg('<path d="M12 5v14"/><path d="M5 12h14"/>'),
    more: svg('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
    reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>')
  };

  /* ---------- 作品数据 ----------
   * 每拍一串记号，空格隔开，按顺序铺满这一拍（加起来 48 tick）：
   *   「24s街」一个 24 tick 的方格，里面写「街」；「48s」一个占满一拍、还没写字的方格；
   *   「12r」12 tick 的空音（没有方格）；「24h」把前一个字再拖长 24 tick（拖音，从上一拍拖过来）。
   * 方格画多宽 = 这个字在它这一拍里的长度；拖过拍线的部分画成同色浅底（v3.1 的拖音画法不变）。
   */
  var D = ['48s', '48s', '48s', '48s'];
  function rows(from, n) { var out = []; for (var i = 0; i < n; i++) out.push({ bar: from + i, b: D.slice() }); return out; }
  function song(over) {
    over = over || {};
    var base = {
      2: ['12s凌 12s晨 12s三 12s点', '24s街 24s灯', '48s', '24s 24s'],
      3: ['48s远', '12s风 12s吹 12s过 12s来', '48s', '48s'],
      4: ['48s我', '48s', '24s不 24s怕', '48s'],
      5: ['24s每 24s一', '48s', '24s 12r 12s', '48s光'],
      6: ['24h 24s', '48s', '48s', '48s'],
      7: D.slice(),
      8: D.slice()
    };
    Object.keys(over).forEach(function (k) {
      var p = k.split(':');
      base[p[0]] = base[p[0]].slice();
      base[p[0]][Number(p[1])] = over[k];
    });
    var verse = [];
    for (var b = 2; b <= 8; b++) verse.push({ bar: b, b: base[b] });
    return [{ label: 'Intro', rows: rows(1, 1) }, { label: 'Verse 1', rows: verse }];
  }

  /* 画面配置：focus 光标在哪个方格（小节:拍:tick）；restFocus 光标停在空音上；bubble 改字气泡写什么；toast 提示条；confirm 清空确认 */
  var CFG = {
    default: { song: [{ label: 'Verse 1', rows: rows(1, 8) }], empty: true },
    edit: { song: song({ '3:2': '48s把' }), focus: '3:2:0', bubble: 'edit' },
    split8: { song: song({ '4:0': '24s我 24s' }), focus: '4:0:0', bubble: 'split8' },
    split16: { song: song({ '4:0': '12s我 6s 6s 24s' }), focus: '4:0:12', bubble: 'split16',
      toast: '<span><b>已经是 1/32，最细了</b>，不能再分。要空音按两下空格；要合回去按 <span class="kbd">退格</span>。</span>' },
    triplet: { song: song({ '5:1': '16s 16s 16s', '2:3': '24s 8s 8s 8s' }), focus: '5:1:0', bubble: 'triplet' },
    rest: { song: song({ '6:2': '24s 24r' }), restFocus: '6:2:24', bubble: 'rest',
      toast: '<span><b>两下空格 = 空音</b>：第一下分出来的格子已经撤回，这半拍变成空白。历史里只记一步「第 6 小节第 3 拍后半拍 → 空音」。</span>' },
    clear: { song: song(), confirm: true }
  };
  var C = CFG[S] || CFG.default;
  var SONG = C.song;

  var RULES = {
    A: { name: '蓝色', h: 215, n: 1, f: ['an'] },
    B: { name: '绿色', h: 150, n: 1, f: ['ai'] }
  };
  var PAINT = C.empty ? {} : { B: ['3:1'], A: ['4:2'] };

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function pct(t) { return (t / TPB * 100).toFixed(4) + '%'; }
  var NAMES = { 48: '1/4', 24: '1/8', 16: '三连', 12: '1/16', 8: '半拍三连', 6: '1/32' };

  /* ---------- 解析：beat 记号 → 字（方格）和空音 ---------- */
  function parse(sng) {
    var words = [], rests = [], last = null;
    sng.forEach(function (sec) {
      sec.rows.forEach(function (row) {
        row.b.forEach(function (spec, bi) {
          var t = (row.bar - 1) * 4 * TPB + bi * TPB;
          spec.split(' ').filter(Boolean).forEach(function (tok) {
            var m = tok.match(/^(\d+)([srh])(.*)$/);
            var n = Number(m[1]);
            if (m[2] === 's') { last = { abs: t, len: n, slot: n, ch: m[3] }; words.push(last); }
            else if (m[2] === 'h') { if (last) last.len += n; }
            else { rests.push({ abs: t, len: n }); last = null; }
            t += n;
          });
        });
      });
    });
    function place(x) {
      x.bar = Math.floor(x.abs / (4 * TPB)) + 1;
      x.beat = Math.floor((x.abs % (4 * TPB)) / TPB);
      x.off = x.abs % TPB;
      x.key = x.bar + ':' + x.beat;
      x.id = x.key + ':' + x.off;
      x.box = Math.min(x.len, TPB - x.off);
    }
    words.forEach(place);
    rests.forEach(place);
    return { words: words, rests: rests };
  }

  var P = parse(SONG);
  var WORDS = P.words, RESTS = P.rests;
  var SIZE = { cell: 160, base: 19 };   // 第二遍按量出来的格宽改

  function paintOf(key) {
    for (var id in PAINT) if (PAINT[id].indexOf(key) >= 0) return id;
    return null;
  }
  WORDS.forEach(function (w) {
    var r = paintOf(w.key);
    if (!r) return;
    var ws = WORDS.filter(function (x) { return x.key === w.key; });
    if (ws[ws.length - 1] === w) { w.hue = RULES[r].h; w.final = RULES[r].f[0]; }
  });

  function fontFor(box) {
    var room = box / TPB * SIZE.cell - 4 - 4;
    if (room >= SIZE.base) return SIZE.base;
    return Math.max(MIN_FONT, Math.floor(room));
  }

  /* 方格：字的落点到它在这一拍里结束的地方。空的 = 实线边 + 底色（占位，证明这里有一个字）；写了字的 = 细边 + 字 */
  function squareHTML(w) {
    var cls = ['sq'], fs = fontFor(w.box), focus = C.focus === w.id;
    cls.push(w.ch ? 'filled' : 'empty');
    if (w.hue != null) cls.push('rp');
    if (focus) cls.push('focus');
    if (w.box <= 6) cls.push('w32');
    var inner = w.ch ? '<span class="ch">' + esc(w.ch) + '</span>' : '';
    if (focus) inner += '<span class="caret" aria-hidden="true"></span>';
    return '<span class="' + cls.join(' ') + '" data-role="square" data-square="' + (w.ch ? 'filled' : 'empty') + '" data-word="' + w.id + '" data-tick="' + w.off + '" data-len="' + w.len + '" data-box="' + w.box + '"' +
      (focus ? ' data-focus="1"' : '') + (w.ch ? ' data-text="' + esc(w.ch) + '"' : '') +
      ' style="--t:' + w.off + ';--l:' + w.box + ';--fs:' + fs + 'px' + (w.hue != null ? ';--h:' + w.hue : '') + '">' + inner + '</span>';
  }

  /* 空音：不画方格。只有光标停在空音上时，画一圈强调色虚线（告诉你光标在哪），宽一点的写「空音」两个字 */
  function restHTML(r) {
    var focus = C.restFocus === r.id;
    return '<span class="rest' + (focus ? ' focus' : '') + '" data-role="rest" data-tick="' + r.off + '" data-len="' + r.len + '"' + (focus ? ' data-focus="1"' : '') +
      ' style="--t:' + r.off + ';--l:' + r.len + '">' + (focus && r.len / TPB * SIZE.cell >= 34 ? '<em>空音</em>' : '') + '</span>';
  }

  /* 拖过拍线的部分：同色浅底（v3.1 画法），这里取它在 [c0, c0+48) 里的那一段 */
  function tintSeg(w, c0) {
    var s = Math.max(w.abs + w.box, c0), e = Math.min(w.abs + w.len, c0 + TPB);
    if (e <= s) return '';
    var tail = e === w.abs + w.len;
    var cls = ['tint', 'cont'];
    if (w.hue != null) cls.push('rp'); else if (!w.ch) cls.push('blank');
    if (!tail) cls.push('more');
    var right = tail ? 'calc(' + (100 - (e - c0) / TPB * 100).toFixed(4) + '% + 2px)' : '-1px';
    return '<span class="' + cls.join(' ') + '" data-role="hold-tint" data-word="' + w.id + '" data-s="' + s + '" data-e="' + e + '" style="left:-1px;right:' + right + (w.hue != null ? ';--h:' + w.hue : '') + '"></span>';
  }

  /* 三连标记：这一拍里有 16 tick 的格 → 整拍一个「3」；有 8 tick 的格 → 它那半拍一个「3」 */
  function tripHTML(items) {
    var h = '';
    if (items.some(function (x) { return x.len === 16 && x.off % 16 === 0; })) h += '<span class="trip" data-role="triplet-mark"><b>3</b></span>';
    [0, 24].forEach(function (half) {
      if (items.some(function (x) { return x.len === 8 && x.off >= half && x.off < half + 24; }))
        h += '<span class="trip half' + (half ? ' h2' : '') + '" data-role="triplet-mark"><b>3</b></span>';
    });
    return h;
  }

  function inCell(list, key) { return list.filter(function (x) { return x.key === key; }); }

  /* ---------- 改字气泡：光标所在方格下面；手机上贴在底部 ---------- */
  function bubbleHTML(row, bi) {
    var what = C.bubble, w = WORDS.filter(function (x) { return x.id === C.focus; })[0];
    var size = w ? NAMES[w.box] : '空音';
    var head = {
      edit: '<b>第 ' + row.bar + ' 小节第 ' + (bi + 1) + ' 拍 · ' + size + ' 方格</b><span class="k">打字写进这一格（一格一个字，再打一个就替换）</span>',
      split8: '<b>一分二：1/4 → 两个 1/8</b><span class="k">字留在左边那一半，光标也在左边；再按空格接着分左边，点右边那格可以单独分它。</span>',
      split16: '<b>这一格是 1/32</b><span class="k">一拍最多分到 8 个 1/32。</span>',
      triplet: '<b>三连：1/4 → 3 个三连</b><span class="k">1/8 那么长的格子按 Shift+空格 → 半拍三连（第 2 小节第 4 拍）。</span>',
      rest: '<b>第 6 小节第 3 拍后半拍 · 空音</b><span class="k">这里不唱。在这里打字 = 放回一个方格并写上字。</span>'
    }[what];
    function act(label, keys, attr, off) {
      return '<button class="act' + (off ? ' off' : '') + '" data-role="square-action" data-act="' + attr + '"' + (off ? ' disabled' : '') + '><b>' + label + '</b><span>' + keys + '</span></button>';
    }
    var finest = w && w.box <= 6;
    var acts = '<div class="acts">' +
      act('一分二', '<span class="kbd">空格</span>', 'split', finest || what === 'rest') +
      act('三连', '<span class="kbd">Shift</span><span class="kbd">空格</span>', 'triplet', (w && w.box < 24) || what === 'rest') +
      act('空音', '<span class="kbd">空格</span>×2', 'rest', what === 'rest') +
      act('合并', '<span class="kbd">退格</span>', 'merge', !w || w.box === TPB || !!w.ch) + '</div>';
    return '<div class="sq-tip" data-role="square-tip" role="status">' + head + acts +
      '<span class="k"><span class="kbd">Tab</span> 下一格 · <span class="kbd">Enter</span> / <span class="kbd">Esc</span> 结束 · <span class="kbd">Ctrl</span>+<span class="kbd">Z</span> 撤销（每一下都算一步）</span></div>';
  }

  /* ---------- 主表格 ---------- */
  function cellHTML(row, bi) {
    var key = row.bar + ':' + bi, c0 = (row.bar - 1) * 4 * TPB + bi * TPB;
    var ws = inCell(WORDS, key), rs = inCell(RESTS, key);
    var rule = ws.length ? paintOf(key) : null;
    var cls = ['cell'], st = '', inner = '', k;
    if (rule) { cls.push('painted'); st = '--h:' + RULES[rule].h; }
    var focusHere = (C.focus && C.focus.indexOf(key + ':') === 0) || (C.restFocus && C.restFocus.indexOf(key + ':') === 0);
    if (focusHere) cls.push('editing');
    for (k = 0; k < 4; k++) inner += '<span class="tk" data-role="tick-line" style="left:' + (k * 25) + '%"></span>';
    inner += tripHTML(ws.concat(rs));
    WORDS.forEach(function (w) { inner += tintSeg(w, c0); });
    rs.forEach(function (r) { inner += restHTML(r); });
    ws.forEach(function (w) { inner += squareHTML(w); });
    if (focusHere && C.bubble) inner += bubbleHTML(row, bi);
    var content = ws.length ? 'words' : WORDS.some(function (w) { return w.abs < c0 && w.abs + w.len > c0; }) ? 'hold-only' : 'empty';
    return '<div class="' + cls.join(' ') + '" data-role="cell" data-bar="' + row.bar + '" data-beat="' + bi + '" data-key="' + key + '" data-content="' + content + '" style="' + st + '">' + inner + '</div>';
  }

  function rowHTML(row) {
    var head = '<div class="rh" data-role="row-head" data-bar="' + row.bar + '"><b>' + pad(row.bar) + '</b></div>';
    var cells = '', lab = '';
    for (var bi = 0; bi < 4; bi++) {
      cells += cellHTML(row, bi);
      var r = paintOf(row.bar + ':' + bi);
      if (r) lab += '<span class="rtag" style="--h:' + RULES[r].h + '"><i></i>' + RULES[r].f.join('·') + '</span>';
    }
    return '<div class="row" data-role="row" data-bar="' + row.bar + '">' + head + cells + '<div class="lab">' + lab + '</div></div>';
  }

  function sheetHTML() {
    var h = '<div class="sheet" data-role="lyrics-sheet" data-step="1"><div class="sh-head"><div class="corner">小节 \\ 拍</div>';
    for (var bi = 0; bi < 4; bi++) {
      var rul = '';
      for (var k = 0; k < 4; k++) rul += '<i style="left:' + (k * 25) + '%"></i>';
      h += '<div class="colh" data-role="beat-head" data-beat="' + bi + '">' +
        '<button class="bn" data-role="beat-head-btn" aria-label="选中第 ' + (bi + 1) + ' 拍整列"><span class="num">' + (bi + 1) + '</span><span class="rul" aria-hidden="true">' + rul + '</span></button></div>';
    }
    h += '<div class="lab-h">韵脚</div></div>';
    SONG.forEach(function (sec) {
      h += '<div class="sec" data-role="section"><div class="sec-h" data-role="section-header"><b data-role="section-label" data-contrast>' + sec.label + '</b><span>' + sec.rows.length + ' 小节</span>' +
        '<button class="ibtn" aria-label="' + sec.label + ' 段落菜单">' + I.more + '</button></div>';
      sec.rows.forEach(function (row) { h += rowHTML(row); });
      h += '</div>';
    });
    h += '<div class="add-row"><button class="btn sm" data-role="add-bar">' + I.plus + '小节</button><button class="btn sm" data-role="add-section">' + I.plus + '段落</button></div>';
    if (C.empty) h += '<div class="empty-tip" data-role="empty-tip">每一拍默认<b>一个方格</b>：方格 = 这里唱一个字。<b>点方格</b>就能直接打字；按<b>空格</b>把它一分为二，<b>Shift+空格</b>分成三连，<b>连按两下空格</b>变成空音。铺好以后点上面的<b>「② 填字和韵脚」</b>配韵脚。</div>';
    return h + '</div>';
  }

  /* ---------- 小样例（右栏）：一拍，同一套方格画法 ---------- */
  function miniBeat(spec, note) {
    var p = parse([{ rows: [{ bar: 1, b: [spec] }] }]);
    var save = SIZE, sf = C.focus, sr = C.restFocus;
    SIZE = { cell: 112, base: 13 };
    C.focus = note && note.focus; C.restFocus = note && note.restFocus;
    var inner = '', k;
    for (k = 0; k < 4; k++) inner += '<span class="tk" style="left:' + (k * 25) + '%"></span>';
    inner += tripHTML(p.words.concat(p.rests));
    p.rests.forEach(function (r) { inner += restHTML(r).replace('data-role="rest"', 'data-role="mini-rest"'); });
    p.words.forEach(function (w) { inner += squareHTML(w).replace('data-role="square"', 'data-role="mini-square"'); });
    SIZE = save; C.focus = sf; C.restFocus = sr;
    return '<div class="mb" data-role="mini-beat">' + inner + '</div>';
  }

  /* ---------- 顶栏 / 轨道区 / 工具条 ---------- */
  function stepsHTML() {
    return '<div class="steps" data-role="steps">' +
      '<button class="on" aria-pressed="true" data-step="1"><i>1</i>铺 flow</button>' +
      '<button aria-pressed="false" data-step="2"><i>2</i><span class="desk-only">填字和韵脚</span><span class="mob-only">填字</span></button></div>';
  }

  function topHTML() {
    var hist = '<div class="hist">' +
      '<button class="ibtn" data-role="undo" aria-label="撤销" title="撤销">' + I.undo + '</button>' +
      '<button class="ibtn" data-role="redo" aria-label="重做" title="重做" disabled>' + I.redo + '</button>' +
      '<button class="ibtn" data-role="history-btn" aria-label="操作历史">' + I.hist + '<span class="desk-only">历史</span></button></div>';
    var transport = '<div class="transport"><button class="ibtn desk-only" aria-label="回到开头">' + I.prev + '</button>' +
      '<button class="play" data-role="play" aria-label="播放">' + I.play + '</button>' +
      '<div class="pos"><b class="mono" data-contrast>1 · 1 · 1</b><span class="mono desk-only">0:00.0 / 1:52</span></div></div>';
    var bpm = '<div class="bpm"><span class="lbl desk-only">BPM</span><b class="mono">92</b></div>';
    var name = C.empty ? '未命名 1' : '夜车';
    return '<header class="top">' +
      '<div class="brand"><div class="logo">AB</div><div class="proj"><b>' + name + '</b><span><i class="dot"></i>已自动保存<span class="desk-only"> · 含撤销历史</span></span></div></div>' +
      '<div class="vsep desk-only"></div>' + hist +
      '<div class="desk-only" style="display:flex;align-items:center;gap:8px">' + stepsHTML() + '<div class="vsep"></div>' + transport + bpm +
      '<button class="tog">' + I.metro + '节拍器</button></div>' +
      '<div class="spacer"></div>' +
      '<button class="btn ghost desk-only">' + I.folder + '作品</button>' +
      '<button class="btn desk-only">' + I.out + '导出</button>' +
      '<button class="ibtn mob-only" aria-label="导出">' + I.out + '</button>' +
      '</header>' +
      '<div class="bar2 mob-only">' + stepsHTML() + transport + bpm + '</div>';
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
      ruler += '<span class="bm' + (secs[i + 1] ? ' nx' : '') + '" style="left:' + (i / bars * 100).toFixed(3) + '%">' + (secs[i + 1] ? '' : i + 1) + '</span>';
      if (secs[i + 1]) ruler += '<span class="sl" data-role="section-label" style="left:calc(' + (i / bars * 100).toFixed(3) + '% + 2px)">' + secs[i + 1] + '</span>';
    }
    var name = C.empty ? '还没载入' : '夜车_beat.mp3 · 92 BPM';
    return '<section class="track" data-role="track-area">' +
      '<div class="tl-lab ruler-l">小节</div><div class="ruler">' + ruler + '</div>' +
      '<div class="tl-lab"><div class="nm"><b>伴奏</b><span>' + name + '</span></div><div class="spacer"></div>' +
      '<button class="btn sm" data-role="replace-beat">' + I.swap + (C.empty ? '载入伴奏' : '替换伴奏') + '</button></div>' +
      (C.empty ? '<div class="lane"><span class="playhead" style="left:0%"></span></div>' : '<div class="lane">' + waveSVG(260, 7) + '<span class="playhead" style="left:0%"></span></div>') +
      '<div class="m-beat mob-only"><span>伴奏 <b>' + name + '</b></span><span class="spacer"></span>' +
      '<button class="btn sm" data-role="replace-beat">' + I.swap + (C.empty ? '载入' : '替换') + '</button></div>' +
      '</section>';
  }

  /* 第 1 步工具条：精度（只管拖长度吸附）+「清空全部 flow…」（手机上也在这里，抽屉收着也点得到） */
  function toolsHTML() {
    var status = {
      default: '点方格打字 · 空格分格',
      edit: '正在改 <b>第 3 小节第 3 拍</b>',
      split8: '正在改 <b>第 4 小节第 1 拍</b> 左边那个 1/8',
      split16: '正在改 <b>第 4 小节第 1 拍</b> 第 2 个 1/16 里的 1/32',
      triplet: '正在改 <b>第 5 小节第 2 拍</b> 三连第 1 个',
      rest: '光标在 <b>第 6 小节第 3 拍后半拍</b>（空音）',
      clear: '点方格打字 · 空格分格'
    }[S] || '';
    var clear = C.confirm
      ? '<div class="clear-confirm" data-role="clear-flow-confirm" role="alertdialog" aria-label="清空全部 flow">' +
        '<span class="q">每一拍变回<b>一个方格</b>？段落和小节留着，字和拖音清掉，可以撤销。</span>' +
        '<button class="btn sm danger solid" data-role="clear-flow-yes">清空</button><button class="btn sm ghost" data-role="clear-flow-no">取消</button></div>'
      : '<button class="btn sm ghost danger" data-role="clear-flow">' + I.reset + '清空全部 flow…</button>';
    return '<div class="tools"><span class="lbl">铺 flow</span>' +
      '<div class="chips" data-role="precision" title="拖字的长度时吸附到这里"><button>1/8</button><button class="on">1/16</button><button>1/32</button><button>三连</button><button>半拍三连</button></div>' +
      '<span class="status desk-only">' + status + '</span><span class="spacer"></span>' + clear + '</div>';
  }

  /* ---------- 右栏：铺 flow 说明 ---------- */
  function keyRow(keys, what) { return '<li><span class="keys">' + keys + '</span><span>' + what + '</span></li>'; }

  function sidePanel() {
    return '<div class="pn" data-role="flow-panel"><div class="pn-h"><h2>铺 flow</h2><span>第一步：先定每个字落在哪</span></div>' +
      '<div class="blk" data-role="square-legend"><div class="blk-h"><b>方格和空音</b></div>' +
      '<div class="lg-row">' + miniBeat('48s') + '<p class="note"><b>方格</b> = 这里唱一个字（还没写字）。每一拍默认一个。</p></div>' +
      '<div class="lg-row">' + miniBeat('24s夜 24s') + '<p class="note">写了字的方格：字在格子里。</p></div>' +
      '<div class="lg-row">' + miniBeat('24s 24r') + '<p class="note"><b>空音</b>：没有方格，只是空白，这里不唱。</p></div>' +
      '<div class="lg-row">' + miniBeat('16s 16s 16s') + '<p class="note"><b>三连</b>：格子上方标「3」。</p></div></div>' +
      '<div class="blk" data-role="key-help"><div class="blk-h"><b>点方格以后</b></div><ul class="keylist">' +
      keyRow('打字', '写进这一格（一格一个字）') +
      keyRow('<span class="kbd">空格</span>', '一分为二：1/4 → 1/8 → 1/16 → 1/32（最细）') +
      keyRow('<span class="kbd">Shift</span>+<span class="kbd">空格</span>', '分成三连') +
      keyRow('<span class="kbd">空格</span><span class="kbd">空格</span>', '0.4 秒内两下：变成空音（只算一步）') +
      keyRow('<span class="kbd">退格</span>', '空方格：和旁边那一半合回去') +
      keyRow('<span class="kbd">Ctrl</span>+<span class="kbd">Z</span>', '撤销，每一下都能撤') +
      '</ul><p class="note">输入法正在拼字时按空格是选字，不会分格。写了字的格子分开后，字留在左边那一半。</p></div>' +
      '<div class="blk"><div class="blk-h"><b>精度</b></div>' +
      '<p class="note">工具条上的精度只管<b>拖字的长度</b>时吸附到哪（拖浅底右边缘，跨拍、跨小节都行，和 v3.1 一样）。</p></div></div>';
  }

  function drawerHTML() {
    return '<div class="drawer" data-role="rhyme-drawer"><div class="grab"></div><div class="dh"><h2>铺 flow</h2>' +
      '<span class="note">点方格打字 · 空格分格</span><span class="more">上滑' + I.up + '</span></div></div>';
  }

  function mobileAnno() {
    var t = {
      default: '每一拍一个<b>空方格</b>（实线框 + 底色）= 这里唱一个字。点方格就能打字。',
      clear: '「清空全部 flow…」先在工具条里就地确认；确定后每一拍变回一个方格，段落、小节不动，可以撤销。'
    }[S];
    if (!t) return '';
    return '<div class="anno m-anno" data-role="mockup-note"><span class="anno-b">视觉稿标注 · 不是界面</span><p>' + t + '</p></div>';
  }

  /* ---------- 拼页面 ---------- */
  function render() {
    var html = '<div class="app" data-step="1">' + topHTML() + trackHTML() +
      '<div class="main"><main class="work">' + toolsHTML() + sheetHTML() + '</main>' +
      '<aside class="side">' + sidePanel() + '</aside></div></div>';
    document.body.innerHTML = html + drawerHTML() + (C.toast ? '<div class="toast warn" role="status" data-role="notice">' + C.toast + '</div>' : '') + mobileAnno();
  }
  render();
  var cell = document.querySelector('[data-role="cell"]');
  var sheet = document.querySelector('[data-role="lyrics-sheet"]');
  if (cell && sheet) {
    SIZE = { cell: cell.clientWidth, base: parseFloat(getComputedStyle(sheet).getPropertyValue('--ch')) || 19 };
    render();
  }
  // 气泡不出屏：桌面上贴着光标格子往左挪（手机上 CSS 已经固定在底部）
  var tip = document.querySelector('[data-role="square-tip"]');
  if (tip && innerWidth > 600) {
    var r = tip.getBoundingClientRect();
    if (r.bottom > innerHeight - 90) { tip.classList.add('up'); r = tip.getBoundingClientRect(); }
    if (r.right > innerWidth - 8) tip.style.left = (parseFloat(getComputedStyle(tip).left) - (r.right - innerWidth + 12)) + 'px';
  }
})();
