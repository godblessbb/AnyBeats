/* AnyBeats 视觉稿共享渲染：顶栏、轨道条、歌词网格、状态栏、手机底栏。
 * 每个画面在 <body> 上写 data-* 选项，并把右侧面板内容放进 <template id="panel">。
 * 纯本地脚本，不发任何网络请求。
 */
(function () {
  'use strict';

  var I = {
    play: '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 16 16"><rect x="3.5" y="2.5" width="3" height="11" rx="1" fill="currentColor"/><rect x="9.5" y="2.5" width="3" height="11" rx="1" fill="currentColor"/></svg>',
    start: '<svg viewBox="0 0 16 16"><rect x="3" y="3" width="2" height="10" rx="1" fill="currentColor"/><path d="M13 3v10L6 8z" fill="currentColor"/></svg>',
    rec: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="currentColor"/></svg>',
    undo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4 2 7l3 3"/><path d="M2.5 7H10a4 4 0 0 1 0 8H7"/></svg>',
    redo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m11 4 3 3-3 3"/><path d="M13.5 7H6a4 4 0 0 0 0 8h3"/></svg>',
    metro: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M6 2h4l3 12H3z"/><path d="M8 11 11.5 4"/></svg>',
    guide: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 10v-4M5 12V4M8 13V3M11 11V5M14 9V7"/></svg>',
    loop: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9V7a3 3 0 0 1 3-3h7"/><path d="m11 2 2 2-2 2"/><path d="M13 7v2a3 3 0 0 1-3 3H3"/><path d="m5 14-2-2 2-2"/></svg>',
    out: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8"/><path d="m5 7 3 3 3-3"/><path d="M3 11v2h10v-2"/></svg>',
    pen: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="m3 15 1-4 8-8 3 3-8 8z"/></svg>',
    rhyme: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 5h8M3 9h6M3 13h8"/><circle cx="14" cy="5" r="1.6" fill="currentColor"/><circle cx="14" cy="13" r="1.6" fill="currentColor"/></svg>',
    ai: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="4" width="12" height="10" rx="3"/><path d="M7 8v2M11 8v2"/></svg>',
    mic: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="6.5" y="2" width="5" height="9" rx="2.5"/><path d="M4 9a5 5 0 0 0 10 0M9 14v2"/></svg>',
    proj: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2.5 5.5a1 1 0 0 1 1-1h4l1.5 2h5.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/></svg>',
    minus: '<svg viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 8h8"/></svg>',
    plus: '<svg viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 8h8M8 4v8"/></svg>',
    more: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="4" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12" cy="8" r="1.3"/></svg>',
    close: '<svg viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="m4 4 8 8M12 4l-8 8"/></svg>',
    warn: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M8 2 1.5 13.5h13z"/><path d="M8 6.5v3.5M8 12v.01" stroke-linecap="round"/></svg>',
    info: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"/><path d="M8 7v4.5M8 4.8v.01"/></svg>',
    bt: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m4 5 8 6-4 3V2l4 3-8 6"/></svg>'
  };
  window.ABIcons = I;

  /* 示例歌词。'.' 空格子，'-' 延音，'_' 空拍，其它是字。每小节 16 个 1/16 拍。 */
  var SECTIONS = [
    { name: '主歌 1', bars: [
      { p: '凌晨三点.我还在路-上----.', r: 'ang', acc: [0, 5] },
      { p: '霓虹灯把影子拉得很长---...', r: 'ang', acc: [0] },
      { p: '耳机.里鼓点敲着.心-脏---.', r: 'ang', acc: [0, 8] },
      { p: '每一步.都踩在.节拍-上---.', r: 'ang', acc: [0, 8] }
    ] },
    { name: 'Hook', bars: [
      { p: '开着夜车__一路向-前----.', r: 'ian', acc: [0, 6] },
      { p: '把梦想写进每一个字-眼---..', r: 'ian', acc: [0] },
      { p: '别问我_为什么_不-眠----.', r: 'ian', acc: [0, 8] },
      { p: '答案都在下个八拍-里-面--..', r: 'ian', acc: [0, 4] }
    ] },
    { name: '主歌 2', bars: [
      { p: '从地下室_到大-舞-台---..', r: 'ai', acc: [0] },
      { p: '没人给我_捷径..........', r: 'ing', acc: [0] }
    ] }
  ];
  var GHOST = [
    { p: '一句一句_把门-敲-开--...', r: 'ai', acc: [0] },
    { p: '汗水_换来_今天的-喝-彩-..', r: 'ai', acc: [0] }
  ];
  var FINAL_NAME = { ang: 'ang', ian: 'ian', ai: 'ai', ing: 'ing', ie: 'ie' };

  function slots(p) {
    var a = Array.from(p);
    while (a.length < 16) a.push('.');
    return a.slice(0, 16);
  }
  function lastCharIndex(a) {
    for (var i = a.length - 1; i >= 0; i--) if ('.-_'.indexOf(a[i]) < 0) return i;
    return -1;
  }

  /* 可复现的伪随机，用来画波形 */
  function rng(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function wave(seed, n, opts) {
    opts = opts || {};
    var r = rng(seed), h = 100, mid = h / 2, top = [], bot = [];
    var start = opts.from || 0, end = opts.to || n;
    for (var i = start; i < end; i++) {
      var beat = (i % 8 === 0) ? 1 : (i % 4 === 0 ? .7 : .35);
      var amp = (opts.amp || 1) * (0.25 + r() * 0.5 + beat * 0.35) * 46;
      if (opts.quiet && r() > .6) amp *= .25;
      var x = (i / n) * 1000;
      top.push(x.toFixed(1) + ',' + (mid - amp).toFixed(1));
      bot.unshift(x.toFixed(1) + ',' + (mid + amp).toFixed(1));
    }
    return '<polygon points="' + top.concat(bot).join(' ') + '"/>';
  }
  function waveSvg(seed, played, opts) {
    var n = 240;
    var p = Math.round(n * played);
    var o1 = Object.assign({}, opts, { to: Math.max(p, (opts && opts.from) || 0) });
    var o2 = Object.assign({}, opts, { from: Math.max(p, (opts && opts.from) || 0) });
    return '<svg viewBox="0 0 1000 100" preserveAspectRatio="none">' +
      '<g fill="var(--wave-played)">' + (p > ((opts && opts.from) || 0) ? wave(seed, n, o1) : '') + '</g>' +
      '<g fill="var(--wave)">' + wave(seed, n, o2) + '</g></svg>';
  }

  function el(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }

  function topbar(o) {
    var playIcon = o.playing ? I.pause : I.play;
    var worker = o.workerOff
      ? '<span class="worker off" title="当前 Worker"><span class="dot"></span>Worker 未连接</span>'
      : '<span class="worker" title="当前 Worker"><span class="dot"></span>本机 Claude CLI</span>';
    return '<header class="topbar">' +
      '<div class="brand"><span class="logo">AB</span><div class="proj"><b data-contrast>夜车</b><span><span class="dot"></span>' + (o.saveText || '已自动保存 · 12:41') + '</span></div></div>' +
      '<div class="sep desk-only"></div>' +
      '<button class="ibtn" title="撤销 ⌘Z">' + I.undo + '</button><button class="ibtn" title="重做 ⇧⌘Z">' + I.redo + '</button>' +
      '<div class="sep desk-only"></div>' +
      '<div class="transport">' +
        '<button class="ibtn" title="回到开头">' + I.start + '</button>' +
        '<button class="play" data-role="play" title="播放 / 暂停（空格）">' + playIcon + '</button>' +
        '<button class="ibtn recbtn' + (o.recording ? ' on' : '') + '" title="录音 R">' + I.rec + '</button>' +
        '<div class="pos"><b class="mono" data-contrast>' + (o.posBar || '06 · 2 · 1') + '</b><span class="mono hide-narrow">' + (o.posTime || '0:14.6 / 1:52') + '</span></div>' +
        '<div class="bpm" title="BPM：上传伴奏后自动检测，可 ±1 手动校"><span class="lbl">BPM</span><b class="mono" data-contrast>92</b><span class="tag">自动</span>' +
          '<button class="ibtn" title="-1">' + I.minus + '</button><button class="ibtn" title="+1">' + I.plus + '</button></div>' +
        '<button class="tog on" title="节拍器（和伴奏同一时钟）">' + I.metro + '<span class="hide-narrow">节拍器</span></button>' +
        '<button class="tog' + (o.guide ? ' on' : '') + '" title="智能导唱：按字数打点">' + I.guide + '<span class="hide-narrow">导唱</span></button>' +
        '<button class="tog on" title="循环播放">' + I.loop + '</button>' +
      '</div>' +
      '<div class="spacer"></div>' +
      '<span class="desk-only">' + worker + '</span>' +
      '<button class="btn desk-only" title="工程与导出 ⌘E">' + I.out + '导出</button>' +
      '<button class="ibtn mob-only" title="导出">' + I.out + '</button>' +
      '</header>';
  }

  function mtransport(o) {
    return '<div class="mtransport">' +
      '<button class="play" data-role="play-m">' + (o.playing ? I.pause : I.play) + '</button>' +
      '<button class="ibtn recbtn' + (o.recording ? ' on' : '') + '">' + I.rec + '</button>' +
      '<div class="pos"><b class="mono" data-contrast>' + (o.posBar || '06 · 2 · 1') + '</b><span class="mono">' + (o.posTime || '0:14.6').split(' ')[0] + '</span></div>' +
      '<div class="spacer"></div>' +
      '<div class="bpm"><b class="mono" data-contrast>92</b><span class="tag">自动</span></div>' +
      '<button class="tog on">' + I.metro + '</button>' +
      '<button class="tog' + (o.guide ? ' on' : '') + '">' + I.guide + '</button>' +
      '</div>';
  }

  function strip(o) {
    var played = o.played == null ? 0.47 : o.played;
    var ruler = '';
    for (var b = 0; b < 12; b++) {
      var x = (b / 12 * 100).toFixed(2);
      ruler += '<i style="left:' + x + '%"></i><span style="left:' + x + '%">' + (b + 1) + '</span>';
    }
    ruler += '<span class="sec" style="left:0%">主歌 1</span><span class="sec" style="left:33.33%">Hook</span><span class="sec" style="left:66.66%">主歌 2</span>';
    var lanesL = '<div class="lane-h big"><span class="nm">伴奏 · 夜车_beat.mp3</span><span class="sub">1:52 · 首拍 +120ms</span></div>';
    var lanesC = '<div class="ruler">' + ruler + '</div><div class="lane" style="height:23px">' + waveSvg(7, played, {}) + '</div>';
    var lanesR = '<div class="vol"><span class="muted">伴奏</span><div class="bar"><i style="width:70%"></i></div></div>' +
      '<div class="vol"><span class="muted">节拍</span><div class="bar"><i style="width:45%"></i></div></div>';
    if (o.takes) {
      var takes = [
        { n: 'Take 1', s: 11, t: '0:42', from: 0, to: 0.66 },
        { n: 'Take 2', s: 23, t: '0:44', from: 0, to: 0.66, sel: true, star: true },
        { n: 'Take 3', s: 31, t: '0:38', from: 0.08, to: 0.6 },
        { n: 'Take 4', s: 45, t: '录音中', from: 0, to: played, rec: true }
      ];
      takes.forEach(function (t) {
        lanesL += '<div class="lane-h' + (t.sel ? ' li on' : '') + '" style="' + (t.sel ? 'min-height:22px;padding:0 8px 0 12px;border-radius:0' : '') + '">' +
          (t.star ? '<span class="star">★</span>' : (t.rec ? '<span style="color:var(--ab-rec)">●</span>' : '<span class="faint">☆</span>')) +
          '<span class="nm">' + t.n + '</span><span class="muted mono" style="margin-left:auto">' + t.t + '</span></div>';
        var n = 240;
        var inner = '<svg viewBox="0 0 1000 100" preserveAspectRatio="none"><g fill="' + (t.rec ? 'var(--ab-rec)' : (t.sel ? 'var(--ab-accent)' : 'var(--wave-played)')) + '" opacity="' + (t.sel || t.rec ? .75 : 1) + '">' +
          wave(t.s, n, { from: Math.round(t.from * n), to: Math.round(t.to * n), amp: .8, quiet: true }) + '</g></svg>';
        var extra = '';
        if (t.sel) {
          extra = '<div class="cut" style="left:0;width:3%"></div><div class="trim l" style="left:3%"></div>' +
            '<div class="cut" style="left:63%;right:0"></div><div class="trim r" style="left:calc(63% - 6px)"></div>';
        }
        lanesC += '<div class="lane take' + (t.sel ? ' sel' : '') + '">' + inner + extra + '</div>';
      });
      lanesR += '<div class="lbl" style="margin-top:4px">输入电平</div><div class="meter">' +
        Array.from({ length: 14 }, function (_, i) { return '<i class="' + (i < 9 ? 'on' : (i < 11 ? 'hot' : '')) + '"></i>'; }).join('') + '</div>';
    }
    var ph = '<div class="playhead' + (o.recording ? ' recline' : '') + '" style="left:' + (played * 100).toFixed(2) + '%"></div>';
    var fb = '<div class="firstbeat" style="left:1.2%" title="第一拍偏移 +120ms，可拖动"></div>';
    return '<section class="strip">' +
      '<div class="lanes-l">' + lanesL + '</div>' +
      '<div class="lanes-c">' + lanesC + fb + ph + '</div>' +
      '<div class="lanes-r">' + lanesR + '</div>' +
      '</section>';
  }

  function rowHtml(bar, idx, o, ghost) {
    var a = slots(bar.p), last = lastCharIndex(a);
    var isCur = o.now && o.now.bar === idx;
    var cls = 'row' + (isCur ? ' cur' : '') + (ghost ? ' ghost-row' : '') + (o.selRow === idx ? ' sel-row' : '');
    var h = '<div class="' + cls + '" data-bar="' + idx + '"><div class="bar"><span class="grip" title="拖动重排小节"></span>' + String(idx).padStart(2, '0') + '</div>';
    a.forEach(function (c, i) {
      var k = ['slot'];
      if (i % 4 === 0) k.push('b0');
      if (i === 0) k.push('m');
      var txt = '';
      if (c === '-') k.push('sus');
      else if (c === '_') { k.push('rest'); txt = '∅'; }
      else if (c !== '.') txt = c;
      if (txt && c !== '_' && bar.acc && bar.acc.indexOf(i) >= 0) k.push('acc');
      if (i === last && bar.r) k.push('rh', 'r-' + bar.r);
      if (isCur && o.now.slot === i) k.push('now');
      if (isCur && i < o.now.slot) k.push('sung');
      if (ghost) k.push('ghost');
      if (o.cursor && o.cursor.bar === idx && o.cursor.slot === i) k.push('cursor');
      if (o.picked && o.picked.bar === idx && o.picked.slot === i) k.push('picked');
      h += '<div class="' + k.join(' ') + '">' + (txt ? '<span class="ch">' + txt + '</span>' : '') + '</div>';
    });
    h += '<div class="end">' + (bar.r ? '<span class="chip r-' + bar.r + '">' + FINAL_NAME[bar.r] + '</span>' : '') + '</div></div>';
    return h;
  }

  function grid(o) {
    var h = '<div class="lyrics-grid" data-role="lyrics-grid">', idx = 1;
    SECTIONS.forEach(function (s, si) {
      var finals = {};
      s.bars.forEach(function (b) { finals[b.r] = (finals[b.r] || 0) + 1; });
      var chips = Object.keys(finals).map(function (f) { return '<span class="chip r-' + f + '">' + f + ' ×' + finals[f] + '</span>'; }).join(' ');
      var fold = o.mfold && o.mfold.indexOf(si) >= 0 ? ' fold-m' : '';
      h += '<div class="sec-h' + fold + '"><b>' + s.name + '</b><span>' + s.bars.length + ' 小节</span>' + chips + '<span class="fold-tag">已折叠 · 点开</span>' +
        '<button class="ibtn add" title="段落菜单：重命名 / 复制段落 / 删除">' + I.more + '</button></div>';
      s.bars.forEach(function (b) { h += rowHtml(b, idx++, o, false).replace('class="row', 'class="row' + fold); });
      if (si === SECTIONS.length - 1 && o.ghost) {
        GHOST.forEach(function (b) { h += rowHtml(b, idx++, o, true); });
      }
    });
    h += '<div class="add-bar"><button class="btn sm">' + I.plus + '小节</button><button class="btn sm">' + I.plus + '段落</button></div>';
    return h + '</div>';
  }

  function status(o) {
    return '<footer class="status">' +
      (o.statusLeft || '<span><kbd>← → ↑ ↓</kbd> 移动</span><span><kbd>Enter</kbd> 编辑</span><span><kbd>A</kbd> 重音</span><span><kbd>-</kbd> 延音</span><span><kbd>_</kbd> 空拍</span><span><kbd>⌘C</kbd>/<kbd>⌘V</kbd> 复制粘贴</span><span class="hide-narrow"><kbd>⌫</kbd> 删除</span>') +
      '<span class="r">' + (o.statusRight || '4/4 · 1/16 网格 · 10 小节') + '</span></footer>';
  }

  function tabbar(active) {
    var tabs = [['write', '写词', I.pen], ['rhyme', '押韵', I.rhyme], ['ai', 'AI', I.ai], ['rec', '录音', I.mic], ['proj', '工程', I.proj]];
    return '<nav class="tabbar">' + tabs.map(function (t) {
      return '<button class="' + (t[0] === active ? 'on' : '') + '">' + t[2] + '<span>' + t[1] + '</span></button>';
    }).join('') + '</nav>';
  }

  function panelTabs(active, extra) {
    if (active === 'export') {
      return '<div class="tabs"><span class="tab on">工程与导出</span><button class="ibtn x" style="margin-left:auto" title="关闭">' + I.close + '</button></div>';
    }
    var tabs = [['rhyme', '押韵'], ['ai', 'AI 写词'], ['rec', '录音']];
    return '<div class="tabs">' + tabs.map(function (t) {
      return '<button class="tab' + (t[0] === active ? ' on' : '') + '">' + t[1] + '</button>';
    }).join('') + (extra || '') + '</div>';
  }

  function boot() {
    var d = document.body.dataset;
    var o = {
      playing: d.playing === '1',
      recording: d.recording === '1',
      takes: d.takes === '1',
      ghost: d.ghost === '1',
      guide: d.guide === '1',
      workerOff: d.workerOff === '1',
      played: d.played ? parseFloat(d.played) : null,
      posBar: d.posBar, posTime: d.posTime, saveText: d.saveText,
      statusLeft: null, statusRight: d.statusRight
    };
    if (d.now) { var n = d.now.split(','); o.now = { bar: +n[0], slot: +n[1] }; }
    if (d.cursor) { var c = d.cursor.split(','); o.cursor = { bar: +c[0], slot: +c[1] }; }
    if (d.picked) { var p = d.picked.split(','); o.picked = { bar: +p[0], slot: +p[1] }; }
    if (d.selRow) o.selRow = +d.selRow;
    o.mfold = d.mfold ? d.mfold.split(',').map(Number) : [];
    var st = document.getElementById('status-left');
    if (st) o.statusLeft = st.innerHTML;

    var tpl = document.getElementById('panel');
    var panelBody = tpl ? tpl.innerHTML : '';
    var app = document.createElement('div');
    app.className = 'app';
    app.innerHTML = topbar(o) + mtransport(o) + strip(o) +
      '<main class="main"><section class="editor"><div class="grid-wrap">' + grid(o) + '</div></section>' +
      '<aside class="panel' + (d.peek === '1' ? ' peek' : '') + (d.sheet === 'tall' ? ' tall' : '') + '"><div class="sheet-grip"></div>' + panelTabs(d.panel || 'rhyme') +
      '<div class="pbody">' + panelBody + '</div></aside></main>' +
      status(o) + tabbar(d.mtab || 'write');
    document.body.appendChild(app);
    document.querySelectorAll('[data-icon]').forEach(function (n) { n.innerHTML = I[n.getAttribute('data-icon')] || ''; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
