/* AnyBeats v2 视觉稿共享渲染：顶栏、轨道区（伴奏 + 人声音轨）、草稿 / 网格两种视图、押韵面板、手机抽屉。
 * 每个画面在 <body> 上写 data-* 选项。纯本地脚本，不发任何网络请求。
 */
(function () {
  'use strict';

  var I = {
    play: '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 16 16"><rect x="3.5" y="2.5" width="3" height="11" rx="1" fill="currentColor"/><rect x="9.5" y="2.5" width="3" height="11" rx="1" fill="currentColor"/></svg>',
    start: '<svg viewBox="0 0 16 16"><rect x="3" y="3" width="2" height="10" rx="1" fill="currentColor"/><path d="M13 3v10L6 8z" fill="currentColor"/></svg>',
    undo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4 2 7l3 3"/><path d="M2.5 7H10a4 4 0 0 1 0 8H7"/></svg>',
    redo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m11 4 3 3-3 3"/><path d="M13.5 7H6a4 4 0 0 0 0 8h3"/></svg>',
    metro: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M6 2h4l3 12H3z"/><path d="M8 11 11.5 4"/></svg>',
    guide: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 10v-4M5 12V4M8 13V3M11 11V5M14 9V7"/></svg>',
    loop: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9V7a3 3 0 0 1 3-3h7"/><path d="m11 2 2 2-2 2"/><path d="M13 7v2a3 3 0 0 1-3 3H3"/><path d="m5 14-2-2 2-2"/></svg>',
    out: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8"/><path d="m5 7 3 3 3-3"/><path d="M3 11v2h10v-2"/></svg>',
    folder: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2 4.5a1 1 0 0 1 1-1h3.5l1.5 1.8h5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/></svg>',
    note: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 4h10M3 8h10M3 12h6"/></svg>',
    gridi: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M5 3v10M8 3v10M11 3v10" stroke-width="1"/></svg>',
    minus: '<svg viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 8h8"/></svg>',
    plus: '<svg viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 8h8M8 4v8"/></svg>',
    more: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="4" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12" cy="8" r="1.3"/></svg>',
    down: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m3 4.5 3 3 3-3"/></svg>',
    up: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m4 10 4-4 4 4"/></svg>',
    arrow: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
    check: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2.5 6.2 2.3 2.3 4.7-5"/></svg>',
    info: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"/><path d="M8 7v4.5M8 4.8v.01"/></svg>',
    warn: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M8 2 1.5 13.5h13z"/><path d="M8 6.5v3.5M8 12v.01" stroke-linecap="round"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>',
    metroBig: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M9 3h6l4 18H5z"/><path d="M12 16 17 6"/></svg>'
  };

  /* 示例歌词（十三辙标注）。p：每小节 16 个 1/16 格，'.' 空格子，'-' 延音，'_' 空拍，其它是字。
   * rh：哪几格押本句的韵（句内同韵着同色，不只句尾）；blk：双押块 [起, 止]；acc：重音格。 */
  var G = { ang: '江阳', ian: '言前', ai: '怀来', ing: '中东' };
  var SECTIONS = [
    { name: '主歌 1', r: 'ang', bars: [
      { p: '凌晨三点街上_我还在路上--', rh: [5, 11], acc: [0, 7] },
      { p: '霓虹灯光_把影子拉长--', rh: [3, 9], acc: [0, 5] },
      { p: '耳机里_装着_我的理想--', rh: [4, 10], blk: [9, 10], acc: [0, 4] },
      { p: '每一步_都踩在_这个地方--', rh: [11], blk: [10, 11], acc: [0, 4] }
    ] },
    { name: '副歌', r: 'ian', bars: [
      { p: '开着夜车_穿过霓虹_向前--', rh: [5, 11], acc: [0, 5] },
      { p: '把心愿_写进每一个字眼--', rh: [2, 10], acc: [0, 4] },
      { p: '别问我_为什么_总是失眠--', rh: [11], blk: [10, 11], acc: [0, 8] },
      { p: '因为答案_需要时间--', rh: [3, 8], blk: [7, 8], acc: [0, 5] }
    ] },
    { name: '主歌 2', r: 'ai', bars: [
      { p: '从地下室_来到_大舞台--', rh: [5, 10], acc: [0, 5] },
      { p: '没人给过我_捷径--', rh: [7], r: 'ing', mis: 'ai', acc: [0, 6] }
    ] }
  ];
  var CANDS = ['未来', '存在', '等待', '精彩', '期待', '状态', '主宰', '不改', '对白', '现在', '徘徊', '敞开',
    '安排', '舞台', '时代', '无奈', '依赖', '离开', '告白', '色彩', '归来', '例外', '慷慨', '买卖',
    '崩坏', '关怀', '命脉', '豪迈', '光彩', '心态'];
  var CANDS_IAN = ['眼前', '从前', '永远', '信念', '明天', '底线', '翻篇', '兑现', '再见', '瞬间', '视线', '心愿',
    '昨天', '时间', '失眠', '路线', '改变', '画面', '世面', '冒险', '表演', '前线', '片段', '燃点',
    '终点', '旋转', '温暖', '彼岸', '呐喊', '灿烂'];

  function slots(p) { var a = Array.from(p); while (a.length < 16) a.push('.'); return a.slice(0, 16); }
  function rhymeOf(sec, bar) { return bar.r || sec.r; }
  function inArr(a, i) { return !!a && a.indexOf(i) >= 0; }
  function inBlk(b, i) { return !!b.blk && i >= b.blk[0] && i <= b.blk[1]; }

  /* 可复现的伪随机波形（和第一期同一算法） */
  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function wave(seed, n, opts) {
    opts = opts || {};
    var r = rng(seed), mid = 50, top = [], bot = [];
    for (var i = opts.from || 0; i < (opts.to || n); i++) {
      var beat = (i % 8 === 0) ? 1 : (i % 4 === 0 ? .7 : .35);
      var amp = (opts.amp || 1) * (0.25 + r() * 0.5 + beat * 0.35) * 46;
      if (opts.quiet && r() > .6) amp *= .25;
      var x = (i / n) * 1000;
      top.push(x.toFixed(1) + ',' + (mid - amp).toFixed(1));
      bot.unshift(x.toFixed(1) + ',' + (mid + amp).toFixed(1));
    }
    return '<polygon points="' + top.concat(bot).join(' ') + '"/>';
  }
  function waveSvg(seed, played) {
    var n = 240, p = Math.round(n * played);
    return '<svg viewBox="0 0 1000 100" preserveAspectRatio="none">' +
      '<g fill="var(--wave-played)">' + (p > 0 ? wave(seed, n, { to: p }) : '') + '</g>' +
      '<g fill="var(--wave)">' + wave(seed, n, { from: p }) + '</g></svg>';
  }

  /* ---------- 顶栏 ---------- */
  function vswitch(view) {
    return '<div class="vswitch" data-role="view-switch" title="草稿 / 网格 来回切换">' +
      '<button class="' + (view === 'draft' ? 'on' : '') + '">' + I.note + '草稿</button>' +
      '<button class="' + (view === 'grid' ? 'on' : '') + '">' + I.gridi + '网格</button></div>';
  }
  function bpmBox(o, mobile) {
    if (mobile) return '<div class="bpm"><b class="mono" data-contrast>' + o.bpm + '</b><span class="tag">' + o.bpmTag + '</span></div>';
    return '<div class="bpm" title="BPM：载入伴奏后自动检测，可 ±1 手动校"><span class="lbl">BPM</span><b class="mono" data-contrast>' + o.bpm + '</b>' +
      '<span class="tag">' + o.bpmTag + '</span><button class="ibtn" title="-1">' + I.minus + '</button><button class="ibtn" title="+1">' + I.plus + '</button></div>';
  }
  function top(o) {
    return '<header class="top">' +
      '<div class="brand"><span class="logo">AB</span><div class="proj"><b data-contrast>' + o.title + '</b><span><span class="dot"></span>已自动保存 · 本机浏览器</span></div></div>' +
      '<button class="ibtn" title="撤销">' + I.undo + '</button><button class="ibtn" title="重做">' + I.redo + '</button>' +
      '<div class="vsep"></div>' + vswitch(o.view) + '<div class="vsep"></div>' +
      '<div class="transport">' +
        '<button class="ibtn" title="回到开头">' + I.start + '</button>' +
        '<button class="play" data-role="play" title="播放 / 暂停（空格）">' + (o.playing ? I.pause : I.play) + '</button>' +
        '<div class="pos"><b class="mono" data-contrast>' + o.posBar + '</b><span class="mono">' + o.posTime + '</span></div>' +
        bpmBox(o) +
        '<button class="tog on" title="节拍器（和伴奏同一时钟）">' + I.metro + '节拍器</button>' +
        '<button class="tog" title="导唱：按字打点">' + I.guide + '导唱</button>' +
        '<button class="tog on" title="循环">' + I.loop + '</button>' +
      '</div>' +
      '<div class="spacer"></div>' +
      '<button class="btn ghost desk-only" title="作品列表">' + I.folder + '作品</button>' +
      '<button class="btn desk-only" title="导出 txt / LRC / 工程 / RPP + WAV 分轨">' + I.out + '导出</button>' +
      '<button class="ibtn mob-only" title="作品与导出">' + I.out + '</button>' +
      '</header>';
  }
  function mbar(o) {
    return '<div class="mbar">' + vswitch(o.view) + '<div class="spacer"></div>' +
      '<button class="play" data-role="play-m">' + (o.playing ? I.pause : I.play) + '</button>' +
      '<div class="pos"><b class="mono" data-contrast>' + o.posBar + '</b></div>' +
      bpmBox(o, true) + '<button class="tog on" title="节拍器">' + I.metro + '</button></div>';
  }

  /* ---------- 轨道区 ---------- */
  function ruler(bars) {
    var h = '';
    for (var b = 0; b < bars; b++) {
      var x = (b / bars * 100).toFixed(2);
      h += '<i style="left:' + x + '%"></i><span class="' + (b % 4 === 0 && b < 9 ? 'at-sec' : '') + '" style="left:' + x + '%">' + (b + 1) + '</span>';
    }
    h += '<span class="sec" style="left:0%">主歌 1</span><span class="sec" style="left:40%">副歌</span><span class="sec" style="left:80%">主歌 2</span>';
    return '<div class="ruler">' + h + '</div>';
  }
  function tracks(o) {
    var played = o.played;
    var L = '<div class="th ruler-h">小节</div>' +
      '<div class="th beat-h"><b>伴奏 · 夜车_beat.mp3</b><span>1:52 · 首拍 +120ms</span></div>';
    var C = ruler(10) + '<div class="lane">' + waveSvg(7, played) + '</div>';
    var R = '<div class="vol"><span class="muted">伴奏</span><div class="bar"><i style="width:70%"></i></div></div>' +
      '<div class="vol"><span class="muted">节拍</span><div class="bar"><i style="width:45%"></i></div></div>';
    var recBtn = '<button class="btn rec" data-role="record" title="录音（R）"><span class="rd"></span>' + (o.takes ? '录第 ' + (o.takes + 1) + ' 遍' : '录音') + '</button>';
    if (!o.takes) {
      L += '<div class="th voc-h"><b>人声</b>' + recBtn + '</div>';
      C += '<div class="lane voc"><span class="desk-only">还没有录音。按「录音」跟着伴奏录，每录一遍就多一条音轨。</span>' +
        '<span class="mob-only">人声 · 还没有录音</span><span class="mob-only" style="margin-left:auto">' + recBtn + '</span></div>';
    } else {
      L += '<div class="th voc-h"><b>人声 · ' + o.takes + ' 遍</b>' + recBtn + '</div>';
      C += '<div class="lane voc"><span class="desk-only">延迟补偿 42 ms · 重新校准</span><span class="mob-only">人声 · ' + o.takes + ' 遍</span>' +
        '<span class="mob-only" style="margin-left:auto">' + recBtn + '</span></div>';
      var takes = [
        { n: 1, s: 11, t: '0:42', from: .4, to: .8 },
        { n: 2, s: 23, t: '0:44', from: .4, to: .8, sel: true },
        { n: 3, s: 31, t: '0:38', from: .43, to: .78 }
      ];
      takes.forEach(function (t) {
        var mark = t.sel ? '<span class="pick">' + I.check + '选用</span>' : '<span class="unpick">点一下设为选用</span>';
        L += '<div class="th take-h' + (t.sel ? ' sel' : '') + '"><span class="t">第 ' + t.n + ' 遍</span>' + mark + '<span class="len mono">' + t.t + '</span></div>';
        var n = 240;
        var inner = '<svg viewBox="0 0 1000 100" preserveAspectRatio="none"><g fill="' + (t.sel ? 'var(--ab-accent)' : 'var(--wave-played)') + '" opacity="' + (t.sel ? .8 : 1) + '">' +
          wave(t.s, n, { from: Math.round(t.from * n), to: Math.round(t.to * n), amp: .85, quiet: true }) + '</g></svg>';
        var extra = t.sel ? '<div class="cut" style="left:40%;width:2%"></div><div class="trim l" style="left:42%"></div>' +
          '<div class="cut" style="left:77%;width:3%"></div><div class="trim r" style="left:calc(77% - 7px)"></div>' : '';
        C += '<div class="lane take' + (t.sel ? ' sel' : '') + '" data-role="take-track" data-take="' + t.n + '">' +
          '<div class="ov"><span class="t">第 ' + t.n + ' 遍</span>' + (t.sel ? '<span class="pick">' + I.check + '选用</span>' : '') + '</div>' + inner + extra + '</div>';
      });
      R += '<div class="lbl">输入电平</div><div class="meter">' +
        Array.from({ length: 14 }, function (_, i) { return '<i class="' + (i < 8 ? 'on' : '') + '"></i>'; }).join('') + '</div>';
    }
    var ph = '<div class="playhead" style="left:' + (played * 100).toFixed(2) + '%"></div>';
    var fb = '<div class="firstbeat" style="left:1.2%" title="第一拍偏移 +120ms，可拖动"></div>';
    return '<section class="tracks" data-role="track-area">' +
      '<div class="tk-l">' + L + '</div><div class="tk-c">' + C + fb + ph + '</div><div class="tk-r">' + R + '</div></section>';
  }

  function beatEmpty() {
    return '<section class="beat-empty" data-role="beat-empty">' +
      '<div class="be-opt drop"><span class="be-ico">' + I.file + '</span>' +
        '<div class="be-txt"><h3>拖入伴奏文件</h3><p>mp3 / wav / m4a，载入后自动检测 BPM</p></div>' +
        '<button class="btn primary" data-role="load-beat">选择伴奏文件</button></div>' +
      '<div class="be-or">或</div>' +
      '<div class="be-opt"><span class="be-ico">' + I.metroBig + '</span>' +
        '<div class="be-txt"><h3>先用节拍器写</h3><p>没伴奏也能写，之后再换上</p></div>' +
        '<div class="bpm"><span class="lbl">BPM</span><b class="mono" data-contrast>90</b><button class="ibtn" title="-1">' + I.minus + '</button><button class="ibtn" title="+1">' + I.plus + '</button></div>' +
        '<button class="btn" data-role="metronome-start">' + I.metro + '用节拍器开始</button></div>' +
      '<div class="be-foot">伴奏只读进本机浏览器，不上传；作品也只存在本机。</div>' +
      '</section>';
  }

  /* ---------- 草稿视图 ---------- */
  function draftText(sec, bar, opts) {
    var a = slots(bar.p), out = '', inB = false;
    a.forEach(function (c, i) {
      if (c === '.' || c === '-') return;
      if (c === '_') { out += '<span class="sp"></span>'; return; }
      var ch = (opts && opts.edit && opts.edit[i]) || c;
      var blk = inBlk(bar, i);
      if (blk && !inB) { out += '<span class="rb r-' + rhymeOf(sec, bar) + '">'; inB = true; }
      if (!blk && inArr(bar.rh, i)) out += '<span class="rc r-' + rhymeOf(sec, bar) + '">' + ch + '</span>';
      else out += ch;
      if (blk && i === bar.blk[1]) { out += '</span>'; inB = false; }
    });
    return out;
  }
  function charCount(bar) { return Array.from(bar.p).filter(function (c) { return '.-_'.indexOf(c) < 0; }).length; }
  function endChip(sec, bar, short) {
    var r = rhymeOf(sec, bar);
    if (bar.mis) {
      return '<span class="chip mis endtag-c" title="和上一句句尾不押"><span class="mono">' + r + '</span>' +
        (short ? '· 上句 ' + bar.mis + ' 不押' : '· 和上句 <span class="mono">' + bar.mis + '</span> 不押') + '</span>';
    }
    return '<span class="chip r-' + r + '">' + r + '</span>';
  }

  function draft(o) {
    var h = '<div class="draft-wrap">';
    if (o.draftMode === 'back') {
      h += '<div class="note info">' + I.info + '<span><b>回到草稿不会丢微调：</b>没改字的句子保留网格里的手动微调；改了字的句子再铺时只重铺那一句，其它句不动。</span></div>';
    }
    h += '<div class="draft" data-role="draft-editor" contenteditable="true" spellcheck="false" aria-label="草稿：一行一句">';
    if (o.draftMode === 'empty') {
      h += '<div class="dl sec"><span class="no"></span><span class="dl-text">【主歌 1】</span></div>' +
        '<div class="dl cur ph"><span class="no">01</span><span class="dl-text"><span class="caret"></span>一行一句，像写备忘录一样先把词写下来……</span></div>' +
        '<div class="dl ph"><span class="no"></span><span class="dl-text">写「【副歌】」这样的一行开新段落（前奏 / 主歌 / 副歌 / 桥段 / 尾奏）</span></div>' +
        '<div class="dl ph"><span class="no"></span><span class="dl-text">写完点下面的「铺到拍子上」，每个字自动排进 1/16 格</span></div>';
    } else {
      var n = 1;
      SECTIONS.forEach(function (s) {
        h += '<div class="dl sec"><span class="no"></span><span class="dl-text">【' + s.name + '】</span></div>';
        s.bars.forEach(function (b) {
          var cur = n === o.cur;
          var edit = (o.draftMode === 'back' && n === 6) ? { 4: '刻' } : null;
          var st = '';
          if (o.draftMode === 'back') {
            if (n === 2 || n === 7) st = '<span class="st keep">已微调 · 保留</span>';
            if (n === 6) st = '<span class="st redo">改了字 · 重铺这一句</span>';
          }
          h += '<div class="dl' + (cur ? ' cur' : '') + '"><span class="no">' + String(n).padStart(2, '0') + '</span>' +
            '<span class="dl-text">' + draftText(s, b, { edit: edit }) + (cur ? '<span class="caret"></span>' : '') +
            '<span class="desk-only">' + endChip(s, b, false) + '</span><span class="mob-only">' + endChip(s, b, true) + '</span>' +
            '<span class="cnt">' + charCount(b) + ' 字</span></span>' + st + '</div>';
          n++;
        });
      });
    }
    h += '</div>';
    var label = o.draftMode === 'back' ? '铺到拍子上（重铺 1 句）' : '铺到拍子上';
    h += '<div class="draft-bar">' +
      (o.draftMode === 'empty' ? '<span class="sum desk-only">还没有歌词</span>'
        : '<span class="sum desk-only">' + (o.draftMode === 'back' ? '10 句 · 1 句改了字 · 2 句有微调' : '10 句 · 3 段 · 将铺成 10 小节') + '</span>') +
      '<span class="sel desk-only" title="铺法">铺法：每字一格（1/16），空格成空拍，句尾延音两格 ' + I.down + '</span>' +
      '<button class="btn primary big" data-role="spread"' + (o.draftMode === 'empty' ? ' disabled style="opacity:.55"' : '') + '>' + label + I.arrow + '</button>' +
      '</div></div>';
    return h;
  }

  /* ---------- 网格视图 ---------- */
  function rowHtml(sec, bar, idx, o) {
    var a = slots(bar.p), r = rhymeOf(sec, bar);
    var lastFilled = -1;
    a.forEach(function (c, i) { if (c !== '.') lastFilled = i; });
    var isCur = o.now && o.now.bar === idx;
    var cls = 'row' + (isCur ? ' cur' : '') + (o.sel === idx ? ' selrow' : '');
    var h = '<div class="' + cls + '" data-bar="' + idx + '"><div class="bn">' + String(idx).padStart(2, '0') + '</div>';
    a.forEach(function (c, i) {
      var k = ['s', 'b' + Math.floor(i / 4)];
      if (i === 0) k.push('bar0'); else if (i % 4 === 0) k.push('bs');
      var txt = '';
      if (c === '-') { k.push('sus'); if (a[i + 1] !== '-') k.push('last'); }
      else if (c === '_') k.push('rest');
      else if (c !== '.') txt = c;
      var attrs = ' data-i="' + i + '" data-beat="' + Math.floor(i / 4) + '" data-sub="' + (i % 4) + '"';
      if (txt && inArr(bar.acc, i)) k.push('acc');
      if (txt && (inArr(bar.rh, i) || inBlk(bar, i))) { k.push('rh', 'r-' + r); attrs += ' data-rhyme="' + r + '"'; }
      if (txt && inBlk(bar, i)) {
        k.push('blk', i === bar.blk[0] ? 'blk-s' : (i === bar.blk[1] ? 'blk-e' : 'blk-m'));
        attrs += ' data-block="b' + idx + '"';
      }
      if (isCur && o.now.slot === i) k.push('now');
      if (isCur && i < o.now.slot) k.push('sung');
      if (o.picked && o.picked.bar === idx && o.picked.slot === i) k.push('picked');
      var ghost = o.picked && o.picked.bar === idx && o.picked.to === i;
      h += '<div class="' + k.join(' ') + '"' + attrs + '>' + (txt ? '<span class="ch">' + txt + '</span>' : '') +
        (ghost ? '<span class="ghost"></span>' : '') + '</div>';
    });
    if (bar.blk) {
      var n = bar.blk[1] - bar.blk[0] + 1;
      h += '<div class="blk-box r-' + r + '" data-role="rhyme-block" data-block="b' + idx + '" style="left:calc(var(--gut) + var(--slot) * ' + bar.blk[0] + ' + 1px);width:calc(var(--slot) * ' + n + ' - 2px)">' +
        '<span class="bl">' + (n === 2 ? '双押' : n + ' 押') + '</span></div>';
    }
    if (o.picked && o.picked.bar === idx) h += '<span class="tip">拖动微调：「捷」前移一格（第 2 拍第 2 格）</span>';
    // 韵母标签紧贴句尾：放在最后一个占用格（含延音）的后面，不另开右侧一栏
    h += '<span class="endtag" style="left:calc(var(--gut) + var(--slot) * ' + (lastFilled + 1) + ' + 4px)">' +
      '<span class="desk-only">' + endChip(sec, bar, false) + '</span><span class="mob-only">' + endChip(sec, bar, true) + '</span></span>';
    return h + '</div>';
  }
  function legend() {
    return '<div class="legend" data-role="rhyme-legend"><b>同色＝押同一个韵</b>' +
      '<span class="lg r-ang"><span class="sw">上</span>江阳 ang</span>' +
      '<span class="lg r-ian"><span class="sw">前</span>言前 ian</span>' +
      '<span class="lg r-ai"><span class="sw">台</span>怀来 ai</span>' +
      '<span class="lg r-ing"><span class="sw">径</span>中东 ing</span>' +
      '<span class="lg r-ang"><span class="sw blk">理想</span>框住＝双押 / 多押</span>' +
      '<span class="lg"><span class="sw mis">ing</span>虚线＝和上句不押</span>' +
      '<span class="lg"><span class="sw acc">字</span>加粗＝重音</span>' +
      '<span class="lg"><span class="sw rest"></span>灰格＝空拍</span></div>';
  }
  function grid(o) {
    var h = '<div class="grid-wrap">';
    if (o.banner) {
      h += '<div class="note ok">' + I.check + '<span class="desk-only"><b>已铺成 10 小节</b>（每字一格 · 空格成空拍 · 句尾延音两格）。拖动字可微调；切回「草稿」改字，没改的句子保留微调。</span>' +
        '<span class="mob-only"><b>已铺成 10 小节</b>　拖动字微调 · 切回草稿改字</span><button class="btn desk-only">撤销铺放</button></div>';
    }
    h += legend();
    h += '<div class="lyrics-grid" data-role="lyrics-grid">';
    h += '<div class="beats-h"><span></span>' + Array.from({ length: 16 }, function (_, i) { return '<span>' + (i % 4 === 0 ? (i / 4 + 1) : '') + '</span>'; }).join('') + '</div>';
    var idx = 1;
    SECTIONS.forEach(function (s, si) {
      var counts = {};
      s.bars.forEach(function (b) { var r = rhymeOf(s, b); counts[r] = (counts[r] || 0) + 1; });
      if (o.fold && o.fold.indexOf(si) >= 0) {
        h += '<div class="sec-h fold"><b>' + s.name + '</b><span>' + s.bars.length + ' 小节</span><span class="fold-t">已收起 · 点开</span></div>';
        idx += s.bars.length;
        return;
      }
      h += '<div class="sec-h"><b>' + s.name + '</b><span>' + s.bars.length + ' 小节</span>' +
        Object.keys(counts).map(function (r) { return '<span class="chip r-' + r + '">' + r + ' ×' + counts[r] + '</span>'; }).join('') +
        '<button class="ibtn" title="段落菜单：改名（前奏 / 主歌 / 副歌 / 桥段 / 尾奏）/ 复制 / 删除">' + I.more + '</button></div>';
      s.bars.forEach(function (b) { h += rowHtml(s, b, idx++, o); });
    });
    h += '</div></div>';
    return h;
  }

  /* ---------- 押韵面板（桌面右栏） ---------- */
  function rpanel(o) {
    if (o.empty) {
      return '<aside class="rpanel" data-role="rhyme-panel"><div class="rp-h"><h2>押韵</h2></div>' +
        '<div class="rp-sec"><span class="lbl">① 当前句尾</span><span class="muted">写下第一句后，这里显示句尾韵母，下面列出同韵词。</span></div>' +
        '<div class="theme" style="margin-top:auto"><span class="lbl">④ 主题联想</span><div class="field"><span class="ph-t">输入主题，如 街头、夜晚、兄弟</span><span class="r">换一批</span></div>' +
        '<span class="src">候选来自本机韵表，不联网。</span></div></aside>';
    }
    var l6 = o.cur === 6;   // 光标在第 6 句（眼 · ian）时面板跟着换
    var cands = l6 ? CANDS_IAN : CANDS;
    return '<aside class="rpanel" data-role="rhyme-panel">' +
      '<div class="rp-h"><h2>押韵</h2><span class="r">第 ' + (l6 ? 6 : 10) + ' 小节</span></div>' +
      '<div class="rp-sec"><span class="lbl">① 当前句尾</span>' +
        (l6 ? '<div class="endbox r-ian"><span class="big">眼</span><div class="meta"><span class="py" data-contrast>yǎn</span><span class="chip">ian · 言前辙</span></div></div>' +
          '<span class="lbl">和上一句「前」押上了（言前）。</span></div>'
        : '<div class="endbox r-ing"><span class="big">径</span><div class="meta"><span class="py" data-contrast>jìng</span><span class="chip">ing · 中东辙</span></div></div>' +
        '<div class="mis-note">' + I.warn + '<span>上一句句尾「台」是 ai（怀来），这两句没押上。</span></div>' +
        '<div class="pair"><button>押本句 ing</button><button class="on">押上句 ai</button></div></div>') +
      '<div class="rp-sec"><span class="lbl">② 筛选</span><div class="filters">' +
        '<span class="dd">2 字' + I.down + '</span><span class="dd"><small>声调</small>不限' + I.down + '</span><span class="dd"><small>词性</small>全部' + I.down + '</span></div></div>' +
      '<div class="cands"><div class="cands-h"><span class="lbl">③</span><b>押 ' + (l6 ? 'ian' : 'ai') + ' 的 2 字词</b><span class="r">共 ' + (l6 ? 87 : 64) + ' 个 · 拖进格子或点一下替换</span></div>' +
        '<div class="cands-scroll"><div class="words">' + cands.map(function (w, i) { return '<span class="word' + (i === 0 ? ' hot' : '') + '">' + w + '</span>'; }).join('') + '</div><i class="sb"></i></div></div>' +
      '<div class="theme"><span class="lbl">④ 主题联想</span><div class="field"><span class="ph-t">输入主题，如 街头、夜晚、兄弟</span><span class="r">换一批</span></div>' +
        '<span class="src">候选来自本机韵表，不联网。</span></div>' +
      '</aside>';
  }

  function drawer(o) {
    return '<div class="drawer" data-role="rhyme-drawer" aria-label="押韵抽屉（已收起，上滑展开）"><div class="grip"></div>' +
      '<div class="dr"><b>押韵</b>' + (o.empty ? '<span class="muted">写下第一句后给出同韵词</span>'
        : (o.cur === 6 ? '<span class="chip r-ian">眼 · ian</span><span class="muted">和上句押上</span>'
          : '<span class="chip r-ing">径 · ing</span><span class="mis-s">上句 ai 不押</span>')) +
      '<span class="up">上滑看候选' + I.up + '</span></div></div>';
  }

  function status(o) {
    var left;
    if (o.view === 'draft') left = '<span><kbd>Enter</kbd> 下一句</span><span><kbd>【段名】</kbd> 开新段落</span><span><kbd>⌘Enter</kbd> 铺到拍子上</span><span><kbd>⌘2</kbd> 切到网格</span>';
    else if (o.takes) left = '<span><kbd>R</kbd> 录下一遍</span><span><kbd>空格</kbd> 回放选用的那遍（歌词同步高亮）</span><span>点音轨设为选用</span><span>拖两端裁头尾</span>';
    else left = '<span>拖动字微调</span><span><kbd>← → ↑ ↓</kbd> 移动</span><span><kbd>A</kbd> 重音</span><span><kbd>-</kbd> 延音</span><span><kbd>_</kbd> 空拍</span><span><kbd>⌘1</kbd> 切回草稿</span>';
    return '<footer class="status">' + left + '<span class="r">' + (o.view === 'draft' ? '一行一句 · 一句铺成一小节' : '4/4 · 每格 1/16 拍 · 每 4 格一拍') + '</span></footer>';
  }

  function boot() {
    var d = document.body.dataset;
    var o = {
      view: d.view || 'grid',
      title: d.title || '夜车',
      empty: d.beat === 'empty',
      takes: d.takes ? +d.takes : 0,
      playing: d.playing === '1',
      played: d.played ? parseFloat(d.played) : 0.47,
      posBar: d.posBar || '10 · 1 · 1', posTime: d.posTime || '0:23.5 / 1:52',
      bpm: d.bpm || '92', bpmTag: d.bpmTag || '自动',
      draftMode: d.draft || 'first',
      cur: d.cur ? +d.cur : 10,
      sel: d.sel ? +d.sel : null,
      banner: d.banner === '1',
      fold: d.fold ? d.fold.split(',').map(Number) : null
    };
    if (d.now) { var n = d.now.split(','); o.now = { bar: +n[0], slot: +n[1] }; }
    if (d.picked) { var p = d.picked.split(','); o.picked = { bar: +p[0], slot: +p[1], to: +p[2] }; }
    if (window.matchMedia('(max-width: 600px)').matches && d.foldM) o.fold = d.foldM.split(',').map(Number);

    var app = document.createElement('div');
    app.className = 'app';
    app.innerHTML = top(o) + mbar(o) + (o.empty ? beatEmpty() : tracks(o)) +
      '<main class="main"><section class="work">' + (o.view === 'draft' ? draft(o) : grid(o)) + '</section>' + rpanel(o) + '</main>' +
      status(o) + drawer(o);
    document.body.appendChild(app);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
