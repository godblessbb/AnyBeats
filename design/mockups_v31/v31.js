/* AnyBeats v3.1 视觉稿：七个画面共用这一份渲染脚本，画面由 <body data-screen="…"> 决定。
 *   select   单击选中一格（一拍 = 一格，格子里没有字框）；指针停在字上时浅底右边缘出现改长度的把手
 *   edit     双击一格改这一拍的字：整格变成输入框，下面实时说明按回车会怎么排
 *   column   点拍头选整列，跨 Verse / Hook 段落：一整块一个框，穿过段落标题不断开；空格子不选
 *   hold     第 1 步拖浅底右边缘改长度：吸附到精度，跨过小节接着画在下一行开头
 *   split    打 1–4 个字自动平分（1/4、1/8、三连、1/16）；超过 4 个字只提示、什么都不写；有锁的拍不重排
 *   section  「+ 段落」选 Intro / Verse / Hook / Bridge / Outro
 *   empty    没有字的新作品：打开就在第 1 步；步骤按钮醒目
 * 数据模型不变：每个字只记 起点 tick + 持续 tick（每拍 48 tick）。不外链任何资源，不发请求。
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
    more: svg('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>')
  };

  /* ---------- 作品数据 ----------
   * 每拍一个字符串：一个字 = 一个 16 分（12 tick）起点的字；「-」把前一个字再拖长一个单位（可以拖过格线、拖到下一行）；
   * 「_」留一个单位的空白；「?」还没填字的字；「3:」三连（每个 16）；「2:」两个 1/8（每个 24）；「1:」一个字占满一拍（48）。
   */
  var INTRO = { label: 'Intro', rows: [{ bar: 1, b: ['____', '____', '____', '走-吧-'] }] };
  var VERSE = { label: 'Verse 1', rows: [
    { bar: 2, b: ['凌晨三点', '街灯_在', '还在路上', '找个地方'] },
    { bar: 3, b: ['远---', '风吹过来', '把那梦想', '吹向西方'] },
    { bar: 4, b: ['3:我不怕', '_走得慢', '只要心里', '还有一场'] },
    { bar: 5, b: ['每一步都', '踩在节拍', '-带着光', '一起启航'] }] };
  var HOOK = { label: 'Hook', rows: [
    { bar: 6, b: ['开着夜-', '车_穿过', '霓虹_的', '路口--'] },
    { bar: 7, b: ['--油门', '----', '踩到满-', '我就不走'] },
    { bar: 8, b: ['3:风在吹', '灯-在闪', '这条街_', '没有出口'] },
    { bar: 9, b: ['开着夜-', '车_穿过', '一个一个', '路口--'] }] };
  var OUTRO = { label: 'Outro', rows: [{ bar: 10, b: ['', '', '', ''] }, { bar: 11, b: ['', '', '', ''] }] };
  var BRIDGE = { label: 'Bridge', rows: [
    { bar: 10, b: ['1:走', '2:夜色', '3:慢慢走', '不要回头'] },
    { bar: 11, b: ['停--在', '', '????', ''] }] };
  var EMPTY = { label: 'Verse 1', rows: [{ bar: 1, b: ['', '', '', ''] }, { bar: 2, b: ['', '', '', ''] }, { bar: 3, b: ['', '', '', ''] }, { bar: 4, b: ['', '', '', ''] }] };

  var SONGS = {
    select: [INTRO, VERSE, HOOK, OUTRO],
    edit: [INTRO, VERSE, HOOK, OUTRO],
    column: [INTRO, VERSE, HOOK, OUTRO],
    hold: [INTRO, VERSE, HOOK, OUTRO],
    split: [INTRO, VERSE, HOOK, BRIDGE],
    section: [INTRO, VERSE, HOOK, OUTRO],
    empty: [EMPTY]
  };

  var RULES = {
    A: { name: '蓝色', h: 215, n: 2, f: ['i', 'ang'] },
    B: { name: '绿色', h: 150, n: 1, f: ['ai'] },
    C: { name: '粉色', h: 340, n: 2, f: ['u', 'ou'] },
    D: { name: '金色', h: 42, n: 1, f: ['an'] }
  };
  var PAINT = { A: ['2:3', '3:3', '4:3', '5:3'], B: ['2:1', '3:1', '5:1'], C: ['6:3', '7:3', '8:3', '9:3'], D: ['7:2'] };

  /* 画面配置：step 第几步；sel 选中；edit 正在改的格；cur 第 1 步选中的字；drag 正在拖到哪；scroll 表格滚到哪一行 */
  var CFG = {
    select: { step: 2, sel: { type: 'cell', key: '3:1' }, hover: '5:1:36', pins: { '5:2': 1 } },
    edit: { step: 2, edit: { key: '4:1', text: '走得太慢' } },
    column: { step: 2, sel: { type: 'col', beat: 2 }, scroll: 2 },
    hold: { step: 1, cur: '9:3:12', drag: { to: 9 * 4 * TPB + 24 }, scroll: 4 },
    split: { step: 2, sel: { type: 'cell', key: '11:1' }, scroll: 4, locked: ['11:0'],
      toast: '<span><b>一拍最多 4 个字</b>（这次打了 6 个「我们一起往前冲」），什么都没写。要更密的节奏，先到「① 铺 flow」把这一拍分细。</span><button class="tbtn">去 ① 铺 flow</button>' },
    section: { step: 2, scroll: 99, menu: true },
    empty: { step: 1, empty: true }
  };
  var C = CFG[S] || CFG.select;
  var SONG = SONGS[S] || SONGS.select;
  var LOCKED = C.locked || [];

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function pct(t) { return (t / TPB * 100).toFixed(4) + '%'; }

  /* ---------- 解析：beat 字符串 → 字（起点 abs tick + 长度） ---------- */
  function parse(song) {
    var words = [], last = null;
    song.forEach(function (sec) {
      sec.rows.forEach(function (row) {
        row.mode = [];
        row.b.forEach(function (s, bi) {
          var unit = 12, mode = '';
          if (s.indexOf('3:') === 0) { unit = 16; mode = 't3'; s = s.slice(2); }
          else if (s.indexOf('2:') === 0) { unit = 24; mode = 'h'; s = s.slice(2); }
          else if (s.indexOf('1:') === 0) { unit = 48; mode = 'q'; s = s.slice(2); }
          row.mode[bi] = mode;
          var t = (row.bar - 1) * 4 * TPB + bi * TPB;
          Array.from(s).forEach(function (c) {
            if (c === '-') { if (last) last.len += unit; }
            else if (c === '_') last = null;
            else { last = { abs: t, len: unit, unit: mode === 't3' ? 16 : 12, ch: c === '?' ? '' : c, mode: mode }; words.push(last); }
            t += unit;
          });
          if (!s) last = null;
        });
      });
    });
    words.forEach(function (w) {
      w.bar = Math.floor(w.abs / (4 * TPB)) + 1;
      w.beat = Math.floor((w.abs % (4 * TPB)) / TPB);
      w.off = w.abs % TPB;
      w.key = w.bar + ':' + w.beat;
      w.id = w.key + ':' + w.off;
    });
    return words;
  }

  function annotate(words) {
    var byCell = {};
    words.forEach(function (w) { w.final = null; w.hue = null; (byCell[w.key] = byCell[w.key] || []).push(w); });
    Object.keys(PAINT).forEach(function (id) {
      PAINT[id].forEach(function (key) {
        var ws = (byCell[key] || []).slice().sort(function (a, b) { return a.abs - b.abs; });
        var r = RULES[id], rp = ws.slice(Math.max(0, ws.length - r.n));
        rp.forEach(function (w, j) { w.final = r.f[j + (r.n - rp.length)]; w.hue = r.h; });
      });
    });
    return byCell;
  }

  function paintOf(key) {
    for (var id in PAINT) if (PAINT[id].indexOf(key) >= 0) return id;
    return null;
  }

  var WORDS = parse(SONG);
  var BYCELL = annotate(WORDS);
  var SIZE = { cell: 160, base: 19 };   // 第二遍按量出来的格宽改

  function fontFor(w) {
    // 字靠左写在浅底开头；字宽受「到下一个可能的落点」的宽度限制，不受拖多长影响
    var room = Math.min(w.len, w.unit) / TPB * SIZE.cell - 2 - 3;
    if (room >= SIZE.base) return { fs: SIZE.base, narrow: false };
    return { fs: Math.max(MIN_FONT, Math.floor(room)), narrow: true };
  }

  // 字框那一段 = 一个 16 分（三连 16 tick）；比它长的部分就是「拖」，画成浅底
  function held(w) { return w.len > w.unit; }
  function showGrip(w) { return C.hover === w.id || (C.cur === w.id && !C.drag); }
  var GRIP = '<span class="grip" data-role="hold-grip" title="往左右拖：改这个字的长度"></span>';

  /* 字本身：靠左写在落点上，没有框。韵脚字用它那种颜色写；还没填的字画一条短下划线 */
  function wordHTML(w) {
    var f = fontFor(w), cls = ['wd'];
    if (w.hue != null) cls.push('rp');
    if (!w.ch) cls.push('blank');
    if (f.narrow) cls.push('narrow');
    if (C.cur === w.id) cls.push('cur');
    var inner = w.ch ? '<span class="ch">' + esc(w.ch) + '</span>' : w.final ? '<span class="ph" data-role="placeholder">' + w.final + '</span>' : '';
    if (!held(w) && showGrip(w)) inner += GRIP;
    return '<span class="' + cls.join(' ') + '" data-role="word" data-word="' + w.id + '" data-tick="' + w.off + '" data-len="' + w.len + '" data-box="' + Math.min(w.len, w.unit) + '"' +
      (w.final ? ' data-rhyme="' + w.final + '"' : '') + ' style="--t:' + w.off + ';--l:' + Math.min(w.len, w.unit) + ';--fs:' + f.fs + 'px' + (w.hue != null ? ';--h:' + w.hue : '') + '">' + inner + '</span>';
  }

  /* 拖长了的字：从字的落点到它结束，铺一块同色浅底；跨格、跨小节接着铺（这里取它在 [c0, c0+48) 里的那一段） */
  function tintSeg(w, c0) {
    if (!held(w)) return '';
    var s = Math.max(w.abs, c0), e = Math.min(w.abs + w.len, c0 + TPB);
    if (e <= s) return '';
    var head = s === w.abs, tail = e === w.abs + w.len;
    var cls = ['tint'];
    if (w.hue != null) cls.push('rp'); else if (!w.ch) cls.push('blank');
    if (!head) cls.push('cont');
    if (!tail) cls.push('more');
    if (C.cur === w.id) cls.push('cur');
    var left = head ? 'calc(' + pct(s - c0) + ' + 1px)' : '-1px';
    var right = tail ? 'calc(' + (100 - (e - c0) / TPB * 100).toFixed(4) + '% + 1px)' : '-1px';
    return '<span class="' + cls.join(' ') + '" data-role="hold-tint" data-word="' + w.id + '" data-s="' + s + '" data-e="' + e + '"' +
      ' style="left:' + left + ';right:' + right + (w.hue != null ? ';--h:' + w.hue : '') + '">' + (tail && showGrip(w) ? GRIP : '') + '</span>';
  }

  // 第 1 步拖长时的预览：从字现在的结束位置画到新的结束位置
  function previewSeg(c0) {
    if (!C.drag) return '';
    var w = WORDS.filter(function (x) { return x.id === C.cur; })[0];
    if (!w) return '';
    var s0 = w.abs + w.len, e0 = C.drag.to, s = Math.max(s0, c0), e = Math.min(e0, c0 + TPB);
    if (e <= s) return '';
    var tail = e === e0;
    var left = s === s0 ? 'calc(' + pct(s - c0) + ' - 1px)' : '-1px';
    var right = tail ? 'calc(' + (100 - (e - c0) / TPB * 100).toFixed(4) + '% + 1px)' : '-1px';
    return '<span class="tint preview' + (s === s0 ? '' : ' cont') + (tail ? '' : ' more') + '" data-role="hold-preview" data-s="' + s + '" data-e="' + e + '" style="left:' + left + ';right:' + right + '">' +
      (tail ? '<span class="grip" data-role="hold-grip"></span>' : '') + '</span>';
  }

  function tripHTML(mode) {
    return mode === 't3' ? '<span class="trip" data-role="triplet-mark"><b>3</b></span>' : '';
  }

  function cellWords(key) { return (BYCELL[key] || []).slice().sort(function (a, b) { return a.abs - b.abs; }); }

  function contentOf(key, c0) {
    if (cellWords(key).length) return 'words';
    var through = WORDS.some(function (w) { return w.abs < c0 && w.abs + w.len > c0; });
    return through ? 'hold-only' : 'empty';
  }

  /* ---------- 主表格 ---------- */
  function editHTML(row, bi) {
    var e = C.edit, n = Array.from(e.text).length, ws = cellWords(e.key), slots = ws.length;
    var how, pv;
    if (n <= slots) how = '<b>' + n + ' 个字 · 按这一拍原来的 ' + slots + ' 个位置依次填</b><span class="k">节奏不变。</span>';
    else if (n <= 4) {
      how = '<b>' + n + ' 个字 → 这一拍平分 ' + n + ' 份（' + ['1/4', '1/8', '三连', '1/16'][n - 1] + '）</b>' +
        '<span class="k">原来只有 ' + slots + ' 个位置，放不下；按回车后这一拍改成平分，原来的节奏不保留。</span>';
      pv = '<div class="pv">' + miniBeat({ b: '_走得慢' }) + '<span class="arrow">→</span>' + miniBeat({ b: e.text }) + '</div>';
    }
    return '<div class="cell-edit" data-role="cell-editor" aria-label="改这一拍的字"><span>' + esc(e.text) + '</span><span class="caret"></span><span class="count">' + n + ' / 4</span></div>' +
      '<div class="edit-tip" data-role="edit-tip">' + how + (pv || '') +
      '<span class="k">只改第 ' + row.bar + ' 小节第 ' + (bi + 1) + ' 拍，<b>下一拍不动</b>。<span class="kbd">Enter</span> 确定（算一步，可撤销）· <span class="kbd">Esc</span> 取消</span></div>';
  }

  function cellHTML(row, bi) {
    var key = row.bar + ':' + bi, c0 = (row.bar - 1) * 4 * TPB + bi * TPB;
    var ws = cellWords(key), content = contentOf(key, c0);
    var rule = content === 'words' ? paintOf(key) : null;
    var cls = ['cell'], st = '', inner = '', k;
    if (rule) { cls.push('painted'); st = '--h:' + RULES[rule].h; }
    if (LOCKED.indexOf(key) >= 0) cls.push('locked');
    if (C.edit && C.edit.key === key) cls.push('editing');
    for (k = 0; k < 4; k++) inner += '<span class="tk" data-role="tick-line" style="left:' + (k * 25) + '%"></span>';
    if (LOCKED.indexOf(key) >= 0) inner += '<span class="clock" data-role="lock-icon">' + I.lock + '</span>';
    if (C.pins && C.pins[key]) inner += '<span class="pin" data-role="pin">' + C.pins[key] + '</span>';
    if (ws.length) inner += tripHTML(row.mode[bi]);
    WORDS.forEach(function (w) { inner += tintSeg(w, c0); });
    inner += previewSeg(c0);
    ws.forEach(function (w) { inner += wordHTML(w); });
    if (C.edit && C.edit.key === key) inner += editHTML(row, bi);
    return '<div class="' + cls.join(' ') + '" data-role="cell" data-bar="' + row.bar + '" data-beat="' + bi + '" data-key="' + key + '" data-content="' + content + '" style="' + st + '">' + inner + '</div>';
  }

  function rowHTML(row) {
    var head = '<div class="rh" data-role="row-head" data-bar="' + row.bar + '"><b>' + pad(row.bar) + '</b></div>';
    var cells = '', lab = '';
    for (var bi = 0; bi < 4; bi++) {
      cells += cellHTML(row, bi);
      var key = row.bar + ':' + bi, r = paintOf(key);
      if (r && cellWords(key).length) lab += '<span class="rtag" style="--h:' + RULES[r].h + '"><i></i>' + RULES[r].f.join('·') + '</span>';
    }
    return '<div class="row" data-role="row" data-bar="' + row.bar + '">' + head + cells + '<div class="lab">' + lab + '</div></div>';
  }

  function sheetHTML() {
    var h = '<div class="sheet" data-role="lyrics-sheet" data-step="' + C.step + '"><div class="sh-head"><div class="corner">小节 \\ 拍</div>';
    for (var bi = 0; bi < 4; bi++) {
      var on = C.sel && C.sel.type === 'col' && C.sel.beat === bi;
      var rul = '';
      for (var k = 0; k < 4; k++) rul += '<i style="left:' + (k * 25) + '%"></i>';
      h += '<div class="colh' + (on ? ' on' : '') + '" data-role="beat-head" data-beat="' + bi + '">' +
        '<button class="bn" data-role="beat-head-btn" aria-label="选中第 ' + (bi + 1) + ' 拍整列" title="点：选中整首第 ' + (bi + 1) + ' 拍这一列">' +
        '<span class="num">' + (bi + 1) + '</span><span class="rul" aria-hidden="true">' + rul + '</span></button></div>';
    }
    h += '<div class="lab-h">韵脚</div></div>';
    SONG.forEach(function (sec) {
      h += '<div class="sec" data-role="section"><div class="sec-h" data-role="section-header"><b data-role="section-label" data-contrast>' + sec.label + '</b><span>' + sec.rows.length + ' 小节</span>' +
        '<button class="ibtn" aria-label="' + sec.label + ' 段落菜单">' + I.more + '</button></div>';
      sec.rows.forEach(function (row) { h += rowHTML(row); });
      h += '</div>';
    });
    h += '<div class="add-row"><button class="btn sm" data-role="add-bar">' + I.plus + '小节</button>' +
      '<button class="btn sm' + (C.menu ? ' on' : '') + '" data-role="add-section" aria-haspopup="menu" aria-expanded="' + (C.menu ? 'true' : 'false') + '">' + I.plus + '段落</button>' +
      (C.menu ? sectionMenu() : '') + '</div>';
    if (C.empty) h += '<div class="empty-tip" data-role="empty-tip">还没有字，所以打开在<b>「① 铺 flow」</b>：点格子里的位置放一个字（按右边的精度吸附），拖字后面浅底的右边改长度。铺好以后点上面的<b>「② 填字和韵脚」</b>写词。</div>';
    return h + '</div>';
  }

  function sectionMenu() {
    var items = [['Intro', '开头'], ['Verse', '主体叙事'], ['Hook', '反复唱的记忆点'], ['Bridge', '转折过渡'], ['Outro', '收尾']];
    var h = '<div class="menu sec-menu" role="menu" data-role="section-picker"><div class="menu-h">加一段（加在最后，4 小节）</div>';
    items.forEach(function (it) {
      h += '<div class="mi" role="menuitem" data-role="section-kind" data-kind="' + it[0].toLowerCase() + '"><b>' + it[0] + '</b><em>' + it[1] + '</em><span>' +
        (it[0] === 'Outro' ? 'Outro' : it[0] === 'Verse' ? 'Verse 2' : it[0] === 'Hook' ? 'Hook 2' : it[0]) + '</span></div>';
    });
    return h + '</div>';
  }

  /* ---------- 一拍的小样例（右栏 / 提示里）：同一套浅底画法 ---------- */
  function miniBeat(spec) {
    var song = [{ rows: [{ bar: 1, b: [spec.b] }] }];
    var ws = parse(song);
    if (spec.rhyme) ws.slice(-1).forEach(function (w) { w.hue = spec.rhyme; });
    var save = SIZE;
    SIZE = { cell: 114, base: 13 };
    var inner = '', k;
    for (k = 0; k < 4; k++) inner += '<span class="tk" style="left:' + (k * 25) + '%"></span>';
    inner += tripHTML(song[0].rows[0].mode[0]);
    var saveCur = C.cur, saveHover = C.hover;
    C.cur = null; C.hover = null;
    ws.forEach(function (w) { inner += tintSeg(w, 0).replace('data-role="hold-tint"', 'data-role="mini-tint"'); });
    ws.forEach(function (w) { inner += wordHTML(w).replace('data-role="word"', 'data-role="mini-word"'); });
    C.cur = saveCur; C.hover = saveHover;
    SIZE = save;
    if (spec.lock) inner += '<span class="lk">' + I.lock + '</span>';
    return '<div class="mb' + (spec.lock ? ' locked' : '') + '" data-role="mini-beat">' + inner + '</div>';
  }

  /* ---------- 顶栏 / 轨道区 / 工具条 ---------- */
  function stepsHTML() {
    return '<div class="steps" data-role="steps">' +
      '<button class="' + (C.step === 1 ? 'on' : '') + '" aria-pressed="' + (C.step === 1) + '" data-step="1"><i>1</i>铺 flow</button>' +
      '<button class="' + (C.step === 2 ? 'on' : '') + '" aria-pressed="' + (C.step === 2) + '" data-step="2"><i>2</i><span class="desk-only">填字和韵脚</span><span class="mob-only">填字</span></button></div>';
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

  function toolsHTML() {
    if (C.step === 1) {
      var st = C.empty ? '点格子里的位置放一个字' : '选中 <b>第 9 小节第 4 拍「口」</b> · 拖浅底右边改长度';
      return '<div class="tools"><span class="lbl">铺 flow</span><div class="chips" data-role="precision"><button>1/8</button><button class="on">1/16</button><button>1/32</button><button>三连</button><button>半拍三连</button></div>' +
        '<span class="status desk-only">' + st + '</span></div>';
    }
    var status = {
      select: '选中 <b>第 3 小节第 2 拍</b> · 双击改这一拍的字',
      edit: '正在改 <b>第 4 小节第 2 拍</b>',
      column: '选中 <b>第 3 拍整列</b> · 8 格（空格子不算）',
      split: '选中 <b>第 11 小节第 2 拍</b>',
      section: '点「+ 段落」选要加的段落'
    }[S] || '';
    return '<div class="tools"><span class="lbl">选格子</span><div class="chips" data-role="sel-chips"><button class="on">单格</button><button>整行</button><button>框选</button></div>' +
      '<div class="chips"><button>反选</button></div>' +
      '<div class="chips"><button>' + I.lock + '锁定</button></div>' +
      '<span class="status desk-only">' + status + '</span></div>';
  }

  /* ---------- 右栏 ---------- */
  function swatchesHTML(active) {
    var h = '<div class="swatches" data-role="swatches">';
    ['A', 'B', 'C', 'D'].forEach(function (id) {
      var r = RULES[id];
      h += '<button class="sw' + (active === id ? ' on' : '') + '" data-role="swatch" style="--h:' + r.h + '" aria-label="' + r.name + ' · ' + ['单押', '双押', '三押', '四押'][r.n - 1] + ' ' + r.f.join(' ') + '"></button>';
    });
    return h + '<button class="sw add" aria-label="新建颜色">+</button></div>';
  }

  function ruleHead(id) {
    var r = RULES[id], used = (PAINT[id] || []).length;
    return '<div class="rule-h" style="--h:' + r.h + '"><i></i><b>' + r.name + '</b><span>' + ['单押', '双押', '三押', '四押'][r.n - 1] + ' · ' + r.f.join(' · ') + ' · 已涂 ' + used + ' 格</span></div>';
  }

  function rhymeTop(id) {
    return '<div class="pn-h"><h2>押韵</h2><span>一种颜色 = 一条韵脚规则</span></div>' + swatchesHTML(id) + '<div style="--h:' + RULES[id].h + '">' + ruleHead(id) + '</div>';
  }

  function ex(title, sub, a, b, bad) {
    return '<div class="ex1' + (bad ? ' bad' : '') + '" data-role="split-case"><div class="t"><b>' + title + '</b> <span>' + sub + '</span></div>' +
      '<div class="mbs">' + a + (b ? '<span class="arrow">→</span>' + b : '') + '</div></div>';
  }

  function sidePanel() {
    if (S === 'select') {
      return '<div class="pn" data-role="rhyme-panel">' + rhymeTop('B') +
        '<div class="blk" data-role="how-panel"><div class="pn-h"><h2>选格子、改字</h2></div>' +
        '<ul class="why-list"><li><b>单击</b>一格：选中这一拍（一拍就是一格，里面不再有一个个小框）</li>' +
        '<li><b>双击</b>一格：直接改这一拍的字</li><li>点上面的<b>拍号</b>：选中整首这一拍的一列；点左边的<b>小节号</b>：选中整行</li>' +
        '<li>字后面的<b>浅底</b>就是它唱多长；指针停在字上，字或浅底的右边出现把手（图里 ① 那一格），，左右拖就改长度</li></ul>' +
        '<p class="note">选中只画<b>一个框</b>，不再每一行各画一圈粗橙框；格子原来的颜色照样看得见。</p></div></div>';
    }
    if (S === 'edit') {
      return '<div class="pn" data-role="rhyme-panel">' + rhymeTop('A') +
        '<div class="blk" data-role="edit-panel"><div class="pn-h"><h2>改这一拍的字</h2></div>' +
        '<p class="note">双击格子，整格变成一个输入框，里面是这一拍现在的字。打几个字，这一拍就排几个字，<b>永远不会写进下一拍</b>。</p>' +
        '<div class="ex-list">' +
        ex('位置够', '按原来的节奏依次填', miniBeat({ b: '街灯_在' }), miniBeat({ b: '灯火_亮' })) +
        ex('位置不够', '这一拍平分', miniBeat({ b: '_走得慢' }), miniBeat({ b: '走得太慢' })) +
        '</div><p class="note">完整规则见「自动平分」那张图。</p></div></div>';
    }
    if (S === 'column') {
      return '<div class="pn" data-role="rhyme-panel">' + rhymeTop('A') +
        '<div class="blk" data-role="column-panel"><div class="pn-h"><h2>整列选中</h2></div>' +
        '<p class="note">点拍头「3」（整个拍头都是一个按钮，下面的 16 分刻度只是标尺）：选中整首第 3 拍里<b>有东西的格子</b>，画成<b>一整块框</b>，穿过 Hook 的段落标题不断开。Intro 第 1 小节和 Outro 里的空格子不选。</p>' +
        '<div class="blk-h"><b>以前为什么乱</b></div>' +
        '<ol class="why-list">' +
        '<li><b>每一行各画一圈粗橙框</b>：九行就是九个框，段落标题那一行没有格子，框就断开。</li>' +
        '<li><b>拍号下面那排 16 分小格是另一个按钮</b>：点到拍头下半截，不是选整列，而是给整首标出「第 2 拍第 2 个 16 分」那一条，于是冒出一条橙色竖条，而且再点别处也不消失。</li>' +
        '<li><b>整列把每个小节都算进去</b>：后面段落里还没写的空小节也被框上，涂色时又被跳过。</li></ol>' +
        '<p class="note">现在：拍头整格一个按钮；16 分刻度不能点；一整块框；只选有字或有拖音的格子。</p></div></div>';
    }
    if (S === 'split') {
      return '<div class="pn" data-role="split-panel"><div class="pn-h"><h2>自动平分</h2><span>双击一格打字</span></div>' +
        '<p class="note">在一拍里打 N 个字（1–4）。这一拍原来的位置<b>够</b>就按原节奏依次填；<b>不够</b>就把这一拍重新平分成 N 份。只动这一拍，<b>下一拍永远不动</b>；一次回车算一步，可以撤销。</p>' +
        '<div class="ex-list">' +
        ex('位置够：节奏不变', '原来 3 个位置，打 3 个字', miniBeat({ b: '街灯_在' }), miniBeat({ b: '灯火_亮' })) +
        ex('1 个字', '占满一拍（1/4）', miniBeat({ b: '' }), miniBeat({ b: '1:走' })) +
        ex('2 个字', '各占半拍（1/8）', miniBeat({ b: '' }), miniBeat({ b: '2:夜色' })) +
        ex('3 个字', '三连', miniBeat({ b: '风' }), miniBeat({ b: '3:慢慢走' })) +
        ex('4 个字', '1/16', miniBeat({ b: '_走得慢' }), miniBeat({ b: '走得太慢' })) +
        ex('这一拍有锁住的字', '位置不够时不重排，提示先解锁', miniBeat({ b: '停--在', lock: true }), null, true) +
        ex('超过 4 个字', '提示去「① 铺 flow」分细，什么都不写', miniBeat({ b: '' }), null, true) +
        '</div><p class="note">第 10 小节就是四种平分的结果；第 11 小节第 2 拍打了 6 个字，没写进去（看下面的提示）。</p></div>';
    }
    if (S === 'section') {
      return '<div class="pn" data-role="rhyme-panel">' + rhymeTop('A') +
        '<div class="blk" data-role="section-panel"><div class="pn-h"><h2>加段落</h2></div>' +
        '<p class="note">以前「+ 段落」永远加 Verse。现在点了先选段落类型：<b>Intro / Verse / Hook / Bridge / Outro</b>，加在最后，默认 4 小节；同类型已经有了就自动编号（Verse 2、Hook 2）。加完可以撤销。</p></div></div>';
    }
    // 第 1 步
    return '<div class="pn" data-role="flow-panel"><div class="pn-h"><h2>铺 flow</h2><span>第一步：先铺字的位置</span></div>' +
      '<div class="blk"><div class="blk-h"><b>字有多长</b></div>' +
      '<div class="mbs">' + miniBeat({ b: '街---' }) + '<p class="note">字靠左写在落点上，后面<b>同色浅底</b>一直铺到它唱完。不再有细线。</p></div>' +
      '<div class="mbs">' + miniBeat({ b: '灯_在-', rhyme: 150 }) + '<p class="note">韵脚字的浅底是它那种颜色。浅底之间的空白就是空音。</p></div></div>' +
      '<div class="blk"><div class="blk-h"><b>精度</b></div>' +
      '<div class="chips" data-role="precision"><button>1/8</button><button class="on">1/16</button><button>1/32</button><button>三连</button><button>半拍三连</button></div>' +
      '<p class="note">放字和拖长都吸附到这里的精度。</p></div>' +
      '<div class="blk"><div class="blk-h"><b>怎么改长度</b></div>' +
      '<p class="note">拖浅底的<b>右边缘</b>：往右拉长、往左缩短，吸附到精度；拖过一小节的末尾就接着画在下一行开头。第 2 步里指针停在字上也能拖。也可以选中按 <span class="kbd">-</span> / <span class="kbd">=</span>。</p></div></div>';
  }

  function drawerHTML() {
    if (C.step === 1) return '<div class="drawer" data-role="rhyme-drawer"><div class="grab"></div><div class="dh"><h2>铺 flow</h2>' +
      '<span class="note">点格子放字 · 拖浅底右边改长度</span><span class="more">上滑' + I.up + '</span></div></div>';
    return '<div class="drawer" data-role="rhyme-drawer"><div class="grab"></div>' +
      '<div class="dh"><h2>押韵</h2>' + swatchesHTML('A') + '<span class="more">上滑展开' + I.up + '</span></div></div>';
  }

  function mobileAnno() {
    var t = {
      select: '<b>单击</b>选中这一拍（一个框），<b>双击</b>改字；字后面的浅底 = 唱多长，按住浅底右边缘左右拖改长度。',
      column: '点拍头「3」：整首第 3 拍<b>一整块框</b>，穿过 Hook 标题不断开；Intro、Outro 的空格子不选；16 分刻度不能点。',
      hold: '按住「口」浅底的右边缘往右拖：吸附 1/16，拖过小节末尾就<b>接着画在下一行开头</b>。'
    }[S];
    if (!t) return '';
    return '<div class="anno m-anno" data-role="mockup-note"><span class="anno-b">视觉稿标注 · 不是界面</span><p>' + t + '</p></div>';
  }

  /* ---------- 选中框：量出格子位置，一段连续的格子画一个框 ---------- */
  function selectedKeys() {
    var sel = C.sel;
    if (!sel) return [];
    if (sel.type === 'cell') return [sel.key];
    var out = [];
    document.querySelectorAll('[data-role="cell"][data-beat="' + sel.beat + '"]').forEach(function (c) {
      if (c.getAttribute('data-content') !== 'empty') out.push(c.getAttribute('data-key'));
    });
    return out;
  }

  function drawSelection() {
    var sheet = document.querySelector('[data-role="lyrics-sheet"]');
    var keys = selectedKeys();
    if (!sheet || !keys.length) return;
    var sr = sheet.getBoundingClientRect();
    var cells = keys.map(function (k) { return document.querySelector('[data-role="cell"][data-key="' + k + '"]'); });
    cells.forEach(function (c) { c.setAttribute('data-selected', '1'); });
    // 按小节号连续的分成几段（跨段落也算连续：段落标题只是夹在中间的一行字）
    var runs = [], cur = null;
    cells.forEach(function (c) {
      var bar = Number(c.getAttribute('data-bar'));
      if (cur && bar === cur.last + 1) { cur.cells.push(c); cur.last = bar; }
      else { cur = { cells: [c], last: bar }; runs.push(cur); }
    });
    runs.forEach(function (run) {
      var a = run.cells[0].getBoundingClientRect(), b = run.cells[run.cells.length - 1].getBoundingClientRect();
      var box = document.createElement('div');
      box.className = 'selbox';
      box.setAttribute('data-role', 'selection-box');
      box.style.left = (a.left - sr.left - 1) + 'px';
      box.style.top = (a.top - sr.top - 1) + 'px';
      box.style.width = (a.width + 1) + 'px';
      box.style.height = (b.bottom - a.top + 1) + 'px';
      sheet.appendChild(box);
      // 夹在这一段中间的段落标题：同一列垫一层浅色，不断开
      document.querySelectorAll('[data-role="section-header"]').forEach(function (h) {
        var r = h.getBoundingClientRect();
        if (r.top > a.top && r.bottom < b.bottom) {
          var band = document.createElement('span');
          band.className = 'band-in';
          band.setAttribute('data-role', 'selection-band');
          band.style.left = (a.left - r.left) + 'px';
          band.style.width = a.width + 'px';
          h.appendChild(band);
        }
      });
    });
  }

  function dragTip() {
    if (!C.drag) return;
    var g = document.querySelector('[data-role="hold-preview"] [data-role="hold-grip"]');
    var work = document.querySelector('.work');
    if (!g || !work) return;
    var r = g.getBoundingClientRect(), wr = work.getBoundingClientRect();
    var tip = document.createElement('div');
    tip.className = 'drag-tip';
    tip.setAttribute('data-role', 'drag-tip');
    var to = C.drag.to, bar = Math.floor(to / (4 * TPB)) + 1, beat = Math.floor((to % (4 * TPB)) / TPB) + 1, sub = Math.floor((to % TPB) / 12) + 1;
    tip.textContent = '拖到 第 ' + bar + ' 小节第 ' + beat + ' 拍 · 第 ' + sub + ' 个 16 分';
    tip.style.left = (r.left + r.width / 2 - wr.left + work.scrollLeft) + 'px';
    tip.style.top = (r.bottom - wr.top + work.scrollTop) + 'px';
    work.appendChild(tip);
    var tw = tip.getBoundingClientRect();
    if (tw.right > innerWidth - 4) tip.style.left = (parseFloat(tip.style.left) - (tw.right - innerWidth + 8)) + 'px';
    if (tw.left < 4) tip.style.left = (parseFloat(tip.style.left) + (8 - tw.left)) + 'px';
  }

  function scrollSheet() {
    var work = document.querySelector('.work');
    if (!work || !C.scroll) return;
    if (C.scroll === 99) { work.scrollTop = work.scrollHeight; return; }
    var rows = document.querySelectorAll('[data-role="section-header"]');
    var target = document.querySelector('[data-role="row"][data-bar="' + C.scroll + '"]');
    if (!target) return;
    var head = target.closest('[data-role="section"]').querySelector('[data-role="section-header"]');
    var el = head && head.nextElementSibling === target ? head : target;
    var tools = document.querySelector('.tools'), sh = document.querySelector('.sh-head');
    var off = (tools ? tools.offsetHeight : 0) + (sh ? sh.offsetHeight : 0);
    work.scrollTop = el.getBoundingClientRect().top - work.getBoundingClientRect().top + work.scrollTop - off;
    void rows;
  }

  /* ---------- 拼页面 ---------- */
  function render() {
    var html = '<div class="app" data-step="' + C.step + '">' + topHTML() + trackHTML() +
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
  scrollSheet();
  drawSelection();
  dragTip();
})();
