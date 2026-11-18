/* AnyBeats v3.3 视觉稿：断句（句首 / 句尾）。七个画面共用这一份渲染脚本，画面由 <body data-screen="…"> 决定。
 *   phrases  默认断句显示：第 1 步，Pre-Hook 1 + Hook A 1 开头，按歌词断好的句子（确认过的）
 *   dense    快嘴段：Hook A 3 一句挨一句 + 两小节「压力样例」（一小节 4 句、三连 / 1/32 中间断句）
 *   mark     手动标：快嘴段里光标在一个方格上，Shift+Enter 刚把它标成句尾（拆成两句）；指针停在两格之间可以点开
 *   auto     自动断句（只有 flow 没有歌词）：建议的句尾是虚线、待确认；快嘴段 12 小节一处都没猜出来，表格里插一条提示
 *   rhyme    韵脚默认落句尾：第 2 步「句尾」涂法，涂一句 = 押这一句最后 1～2 个字（跨格也行），不会押到下一句的第一个字
 *   spacing  韵脚间隔：行尾韵脚栏写「距上一个同色句尾韵几拍」
 *   touch    手机 / 触屏：点一下句尾红线 → 小菜单（确认 / 往前挪 / 往后挪 / 不是句尾）
 * 节奏和断句位置全部来自 design/fixtures_v33（《恋爱循环》rap 版 flow 的 tick，没有歌词）；字是中文占位。
 * 不外链任何资源，不发请求。
 */
(function () {
  'use strict';

  var TPB = 48, TPBAR = 192, MIN_FONT = 11;
  var S = document.body.getAttribute('data-screen');
  var K = window.KOI;

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
    metro: svg('<path d="M9 3h6l4 18H5z"/><path d="m12 15 5-9"/>'),
    folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    out: svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
    swap: svg('<path d="M4 7h13l-3-3"/><path d="M20 17H7l3 3"/>'),
    up: svg('<path d="m6 15 6-6 6 6"/>'),
    plus: svg('<path d="M12 5v14"/><path d="M5 12h14"/>'),
    more: svg('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
    reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
    wand: svg('<path d="m15 4 5 5"/><path d="M4 20 15.5 8.5"/><path d="M8 3v3M6.5 4.5h3M19 14v3M17.5 15.5h3"/>')
  };

  /* ---------- 数据：全曲的字（tick）+ 句尾 ----------
   * 一个字 = { abs 全曲起点, len 长度 }，和 App 的 Word 一样；句尾 = 挂在「这一句最后一个字」上的标记（数据里是 Word.brk）。
   * 句首不存：上一个句尾后面的第一个字就是句首。
   */
  var WORDS = K.notes.map(function (n) { return { abs: n[0], len: n[1], ch: '' }; });
  var ENDS = {};     // abs → 'end'（确认过）| 'guess'（自动断句建议，待确认）
  var FRESH = {};    // 刚标上的句尾（画一圈浅强调色）

  /* 压力样例（不是这首歌）：第 S1 小节一小节 4 句（1/16，句子之间一点空都没有）；第 S2 小节三连中间断句、1/32 中间断句、最后一个字拖进下一小节 */
  var STRESS_G = 200;
  function addStress() {
    var b0 = STRESS_G * TPBAR, b1 = b0 + TPBAR, i;
    for (i = 0; i < 16; i++) WORDS.push({ abs: b0 + i * 12, len: 12, ch: '' });
    [24, 72, 120, 168].forEach(function (t) { ENDS[b0 + t] = 'end'; });
    [[0, 16], [16, 16], [32, 16], [48, 24], [72, 24], [96, 6], [102, 6], [108, 6], [114, 6], [120, 24], [144, 48]].forEach(function (x) { WORDS.push({ abs: b1 + x[0], len: x[1], ch: '' }); });
    [16, 102, 144].forEach(function (t) { ENDS[b1 + t] = 'end'; });
  }

  /* 画面配置：rows 显示哪些小节（全曲小节号，从 0 数；行头显示 +1）；ends 用哪一份断句 */
  function range(a, b) { var o = []; for (var g = a; g <= b; g++) o.push(g); return o; }
  var CFG = {
    phrases: { step: 1, rows: range(17, 25), ends: 'lyrics' },
    dense: { step: 1, rows: range(99, 104), ends: 'lyrics', stress: true },
    mark: { step: 1, rows: range(98, 103), ends: 'mark', focus: 100 * TPBAR + 0, bubble: true,
      gapHint: 100 * TPBAR + 168,
      toast: '<span><b>第 101 小节第 1 拍：标成句尾</b>，这一句在这里结束，后面另起一句。历史里记一步，<span class="kbd">Ctrl</span>+<span class="kbd">Z</span> 撤销。</span>' },
    auto: { step: 1, rows: range(93, 101), ends: 'guess', banner: true, miss: true },
    rhyme: { step: 2, rows: range(19, 27), ends: 'lyrics', rhyme: true, selEnd: 27 * TPBAR + 156,
      toast: '<span><b>涂上金色 · 双押</b>：第 28 小节这一句最后 2 个字。按格子算的话会押到下一句的第 1 个字（虚线框那个）。</span>' },
    spacing: { step: 2, rows: range(32, 40), ends: 'lyrics', rhyme: true, spacing: true },
    touch: { step: 1, rows: range(90, 97), ends: 'guess', touchSel: true }
  };
  var C = CFG[S] || CFG.phrases;
  var MOBILE = innerWidth <= 600;
  if (MOBILE && S === 'auto') C.rows = range(96, 101);   // 手机屏矮：少放两行，横幅和漏断提示都不用滚就看得见

  if (C.ends === 'lyrics') K.ends.forEach(function (t) { ENDS[t] = 'end'; });
  else if (C.ends === 'guess') K.guess.forEach(function (t) { ENDS[t] = 'guess'; });
  else if (C.ends === 'mark') {
    // 自动断句先猜过：快嘴段之前的建议都接受了；快嘴段（第 99 小节起）一处都没猜出来，用户正一句一句手动标
    K.guess.forEach(function (t) { if (t < 98 * TPBAR) ENDS[t] = 'end'; });
    ENDS[98 * TPBAR + 132] = 'end';
    ENDS[100 * TPBAR + 0] = 'end';
    FRESH[100 * TPBAR + 0] = true;
  }
  if (C.stress) addStress();
  if (C.touchSel) C.selEnd = K.guess.filter(function (t) { return t >= 93 * TPBAR && t < 94 * TPBAR; })[0];
  WORDS.sort(function (a, b) { return a.abs - b.abs; });

  /* ---------- 句子：一个句尾到下一个句尾 ---------- */
  var SECS = K.sections.map(function (s) { return { label: s.label, first: s.firstBar, n: s.bars }; });
  var STRESS_SEC = { label: '压力样例（不是这首歌）', first: STRESS_G, n: 2 };
  function secOf(g) {
    if (g >= STRESS_G) return STRESS_SEC;
    for (var i = SECS.length - 1; i >= 0; i--) if (g >= SECS[i].first) return SECS[i];
    return SECS[0];
  }
  var PHRASES = [];
  (function () {
    var cur = [], perSec = {};
    function close(state) {
      var a = cur[0], z = cur[cur.length - 1], sec = secOf(Math.floor(a.abs / TPBAR));
      perSec[sec.label] = (perSec[sec.label] || 0) + 1;
      var p = { id: PHRASES.length, words: cur, start: a.abs, last: z.abs, end: z.abs + z.len, state: state, num: perSec[sec.label], sec: sec.label };
      cur.forEach(function (w) { w.ph = p; });
      PHRASES.push(p);
      cur = [];
    }
    WORDS.forEach(function (w) {
      if (cur.length && Math.floor(w.abs / TPBAR) >= STRESS_G && Math.floor(cur[0].abs / TPBAR) < STRESS_G) close('open');
      cur.push(w);
      if (ENDS[w.abs]) close(ENDS[w.abs]);
    });
    if (cur.length) close('open');
  })();

  WORDS.forEach(function (w) {
    w.g = Math.floor(w.abs / TPBAR);
    w.beat = Math.floor((w.abs % TPBAR) / TPB);
    w.off = w.abs % TPB;
    w.key = w.g + ':' + w.beat;
    w.box = Math.min(w.len, TPB - w.off);
  });

  /* ---------- 第 2 步：韵脚规则（颜色）和占位字 ---------- */
  var RULES = {
    r4: { name: '金色', h: 42, n: 2, f: ['i', 'ang'], ch: [['西', '方'], ['记', '忘'], ['里', '望']] },
    r5: { name: '蓝色', h: 215, n: 2, f: ['ou', 'an'], ch: [['走', '远'], ['手', '暖']] },
    r6: { name: '绿色', h: 150, n: 1, f: ['ing'], ch: [['星'], ['听'], ['醒']] },
    r2: { name: '粉色', h: 340, n: 1, f: ['ao'], ch: [['好'], ['跑'], ['到']] },
    r7: { name: '金色', h: 42, n: 2, f: ['i', 'ang'], ch: [['气', '光'], ['起', '扬'], ['地', '唱']] },
    r1: { name: '蓝色', h: 215, n: 1, f: ['an'], ch: [['天'], ['边'], ['见']] }
  };
  if (S === 'rhyme') { RULES.r7.name = '金色'; RULES.r4 = { name: '青色', h: 185, n: 2, f: ['i', 'ang'], ch: [['西', '方'], ['记', '忘'], ['里', '望']] }; }
  var POOL = '我们一起在这条街上走过每个夜晚灯光照亮心里的梦想不停向前看风吹过城市的屋顶没有人能挡住脚步';
  var PAINT = {};        // 格子 key → 规则（句尾所在那一格）
  var ANCHORS = [];      // 句尾韵：{ rule, last, phrase }
  if (C.rhyme) {
    var pi = 0, used = {};
    WORDS.forEach(function (w) { w.ch = POOL.charAt(pi++ % POOL.length); });
    K.rhyme.forEach(function (r) {
      var rule = RULES[r[1]];
      if (!rule) return;
      var p = PHRASES.filter(function (x) { return x.last === r[0]; })[0];
      if (!p || p.state !== 'end') return;
      var k = used[r[1]] = (used[r[1]] || 0);
      used[r[1]]++;
      var chars = rule.ch[k % rule.ch.length];
      var rw = p.words.slice(Math.max(0, p.words.length - rule.n));        // 这一句最后 n 个字（不跨过句首）
      rw.forEach(function (w, j) { w.ch = chars[j + (rule.n - rw.length)]; w.hue = rule.h; w.final = rule.f[j + (rule.n - rw.length)]; w.rp = true; });
      var lastW = p.words[p.words.length - 1];
      PAINT[lastW.key] = rule;
      ANCHORS.push({ rule: rule, key: r[1], last: r[0], phrase: p });
    });
    // 「按格子算」会押到哪个字：句尾那一格里最后一个字（不是这一句的字就是押错了）
    if (C.selEnd != null) {
      var se = WORDS.filter(function (w) { return w.abs === C.selEnd; })[0];
      var inCellW = WORDS.filter(function (w) { return w.key === se.key; });
      var lastInCell = inCellW[inCellW.length - 1];
      if (lastInCell !== se) lastInCell.old = true;
    }
  }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function barName(g) { return g >= STRESS_G ? 'S' + (g - STRESS_G + 1) : String(g + 1); }
  function beatName(t) {
    var b = (t % TPBAR) / TPB + 1, whole = Math.floor(b), fr = b - whole;
    var q = fr * 4;
    return '第 ' + barName(Math.floor(t / TPBAR)) + ' 小节第 ' + whole + (fr === 0 ? ' 拍' : fr === 0.5 ? ' 拍半' : q === Math.round(q) ? ' 拍第 ' + (q + 1) + ' 个 1/16' : ' 拍 +' + Math.round(fr * 48) + ' tick');
  }
  function beatsTxt(ticks) {
    var b = Math.abs(ticks) / TPB, w = Math.floor(b), fr = b - w;
    var FR = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
    return (fr === 0 ? String(w) : FR[fr] ? (w ? w : '') + FR[fr] : b.toFixed(2)) + ' 拍';
  }
  var SIZE = { cell: 160, base: 19 };
  var ROWSET = {};
  C.rows.forEach(function (g) { ROWSET[g] = true; });
  if (C.stress) { ROWSET[STRESS_G] = ROWSET[STRESS_G + 1] = true; }

  function fontFor(box) {
    var room = box / TPB * SIZE.cell - 4 - 4;
    if (room >= SIZE.base) return SIZE.base;
    return Math.max(MIN_FONT, Math.floor(room));
  }

  /* ---------- 一格里的东西 ---------- */
  function squareHTML(w) {
    var focus = C.focus === w.abs;
    var cls = ['sq', w.ch ? 'filled' : 'empty'];
    if (focus) cls.push('focus');
    if (w.box <= 6) cls.push('w32');
    var inner = w.ch ? '<span class="ch">' + esc(w.ch) + '</span>' : '';
    if (focus) inner += '<span class="caret" aria-hidden="true"></span>';
    return '<span class="' + cls.join(' ') + '" data-role="square" data-square="' + (w.ch ? 'filled' : 'empty') + '" data-abs="' + w.abs + '" data-tick="' + w.off + '" data-len="' + w.len + '" data-box="' + w.box + '"' + (w.ph ? ' data-phrase="' + w.ph.id + '"' : '') +
      (focus ? ' data-focus="1"' : '') + ' style="--t:' + w.off + ';--l:' + w.box + '">' + inner + '</span>';
  }
  function wordHTML(w) {
    var cls = ['wd'];
    if (w.rp) cls.push('rp');
    if (w.old) cls.push('old');
    return '<span class="' + cls.join(' ') + '" data-role="word" data-abs="' + w.abs + '" data-phrase="' + w.ph.id + '" data-tick="' + w.off + '"' + (w.rp ? ' data-rhyme="' + w.final + '"' : '') + (w.old ? ' data-old-rule="1"' : '') +
      ' style="--t:' + w.off + ';--l:' + w.box + ';--fs:' + fontFor(w.box) + 'px' + (w.hue != null ? ';--h:' + w.hue : '') + '"><span class="ch">' + esc(w.ch) + '</span></span>';
  }
  function tintSeg(w, c0) {
    var s = Math.max(w.abs + w.box, c0), e = Math.min(w.abs + w.len, c0 + TPB);
    if (e <= s) return '';
    var tail = e === w.abs + w.len;
    var right = tail ? 'calc(' + (100 - (e - c0) / TPB * 100).toFixed(4) + '% + 2px)' : '-1px';
    return '<span class="tint cont' + (w.rp ? ' rp' : w.ch ? '' : ' blank') + '" data-role="hold-tint" style="left:-1px;right:' + right + (w.hue != null ? ';--h:' + w.hue : '') + '"></span>';
  }
  function tripHTML(items) {
    var h = '';
    if (items.some(function (x) { return x.off === 16 || x.off === 32; })) h += '<span class="trip" data-role="triplet-mark"><b>3</b></span>';
    return h;
  }

  /* 句子括线在这一格 [c0, c0+48) 里的样子：句首竖线、句尾竖线、横线、序号 */
  function phraseHTML(c0, opts) {
    opts = opts || {};
    var h = '';
    PHRASES.forEach(function (p) {
      if (p.state === 'open' && !Object.keys(ENDS).length) return;     // 整首没断句：什么都不画（和 v3.2 一样）
      if (p.end <= c0 || p.start >= c0 + TPB) return;
      var s = Math.max(p.start, c0) - c0, e = Math.min(p.end, c0 + TPB) - c0;
      var par = p.id % 2 ? 'even' : 'odd';
      h += '<span class="pb ' + par + (p.state !== 'end' ? ' ' + p.state : '') + '" data-role="phrase-band" data-phrase="' + p.id + '" data-state="' + p.state + '" data-s="' + (c0 + s) + '" data-e="' + (c0 + e) + '" style="--s:' + s + ';--e:' + e + '"></span>';
      if (p.start >= c0 && p.start < c0 + TPB) {
        h += '<span class="pm ps" data-role="phrase-start" data-phrase="' + p.id + '" data-abs="' + p.start + '" title="句首：' + esc(p.sec) + ' 第 ' + p.num + ' 句" style="--o:' + s + '"></span>';
        var room = (e - s) / TPB * SIZE.cell - 5 - 3;
        if (!opts.mini && room >= 18) h += '<span class="pn" data-role="phrase-num" data-phrase="' + p.id + '" style="--o:' + s + '">' + p.num + '</span>';
      }
      if (p.state !== 'open' && p.end > c0 && p.end <= c0 + TPB) {
        var cls = ['pm', 'pe'];
        if (p.state === 'guess') cls.push('guess');
        if (C.selEnd === p.last && !opts.mini) cls.push('sel');
        if (FRESH[p.last]) cls.push('fresh');
        h += '<span class="' + cls.join(' ') + '" data-role="phrase-end" data-phrase="' + p.id + '" data-state="' + p.state + '" data-abs="' + p.last + '" data-end="' + p.end + '"' +
          (C.selEnd === p.last && !opts.mini ? ' data-sel="1"' : '') + (FRESH[p.last] ? ' data-fresh="1"' : '') +
          ' title="句尾：' + esc(p.sec) + ' 第 ' + p.num + ' 句' + (p.state === 'guess' ? '（待确认）' : '') + '" style="--o:' + e + '"></span>';
      }
    });
    return h;
  }

  function inCell(key) { return WORDS.filter(function (w) { return w.key === key; }); }

  /* ---------- 气泡：方格（改字 + 断句）/ 句尾小菜单 ---------- */
  function bubbleHTML() {
    var w = WORDS.filter(function (x) { return x.abs === C.focus; })[0], p = w.ph;
    function act(label, keys, attr, off, role, on) {
      return '<button class="act' + (off ? ' off' : '') + (on ? ' on' : '') + '" data-role="' + (role || 'square-action') + '" data-act="' + attr + '"' + (off ? ' disabled' : '') + (on ? ' aria-pressed="true"' : '') + '><b>' + label + '</b><span>' + keys + '</span></button>';
    }
    return '<div class="sq-tip" data-role="square-tip" role="status">' +
      '<b>' + beatName(w.abs) + ' · 1/16 方格 · 这一句的句尾</b>' +
      '<span class="k">' + esc(p.sec) + ' 第 ' + p.num + ' 句：' + beatName(p.start) + ' → 这里，' + p.words.length + ' 个字。</span>' +
      '<div class="acts">' + act('一分二', '<span class="kbd">空格</span>', 'split') + act('三连', '<span class="kbd">Shift</span><span class="kbd">空格</span>', 'triplet', true) +
      act('空音', '<span class="kbd">空格</span>×2', 'rest') + act('合并', '<span class="kbd">退格</span>', 'merge') + '</div>' +
      '<div class="ph-acts">' + act('到这里一句', '<span class="kbd">Shift</span><span class="kbd">Enter</span>', 'end', false, 'phrase-action', true) +
      act('从这里起一句', '点格子左边的缝', 'start', false, 'phrase-action') + '</div>' +
      '<span class="k">再按一次 <span class="kbd">Shift</span>+<span class="kbd">Enter</span> = 取消句尾（和下一句合成一句）。每一下都算一步，<span class="kbd">Ctrl</span>+<span class="kbd">Z</span> 撤销。</span></div>';
  }
  function popHTML(p) {
    var guess = p.state === 'guess';
    return '<div class="ph-pop" data-role="phrase-pop" role="dialog" aria-label="句尾">' +
      '<b>' + esc(p.sec) + ' 第 ' + p.num + ' 句的句尾' + (guess ? ' · 待确认' : '') + '</b>' +
      '<span class="k">' + beatName(p.last) + '那个字后面。' + (guess ? '这是自动断句按节奏猜的（后面空了半拍以上）。' : '') + '</span>' +
      '<div class="row2">' + (guess ? '<button class="act pri" data-role="phrase-pop-act" data-act="confirm">是句尾</button>' : '') +
      '<button class="act dz" data-role="phrase-pop-act" data-act="remove">不是句尾（和下一句合并）</button></div>' +
      '<div class="row2"><button class="act" data-role="phrase-pop-act" data-act="left">◀ 往前一个字</button><button class="act" data-role="phrase-pop-act" data-act="right">往后一个字 ▶</button></div>' +
      '<span class="k">桌面上也可以直接拖红线，吸到字和字之间。每个按钮都算一步，可以撤销。</span></div>';
  }

  /* ---------- 主表格 ---------- */
  function cellHTML(g, bi) {
    var key = g + ':' + bi, c0 = g * TPBAR + bi * TPB;
    var ws = inCell(key);
    var rule = C.rhyme ? PAINT[key] : null;
    var cls = ['cell'], st = '', inner = '', k;
    if (rule) { cls.push('painted'); st = '--h:' + rule.h; }
    var focusHere = C.focus != null && ws.some(function (w) { return w.abs === C.focus; });
    var sel = C.selEnd != null ? PHRASES.filter(function (p) { return p.last === C.selEnd; })[0] : null;
    var popHere = C.touchSel && sel && sel.end > c0 && sel.end <= c0 + TPB;
    if (focusHere || popHere) cls.push('editing');
    for (k = 0; k < 4; k++) inner += '<span class="tk" data-role="tick-line" style="left:' + (k * 25) + '%"></span>';
    inner += tripHTML(ws);
    WORDS.forEach(function (w) { if (w.abs < c0 + TPB && w.abs + w.len > c0) inner += tintSeg(w, c0); });
    ws.forEach(function (w) { inner += C.step === 2 ? wordHTML(w) : squareHTML(w); });
    inner += phraseHTML(c0);
    if (C.gapHint != null && C.gapHint >= c0 && C.gapHint < c0 + TPB) inner += '<span class="gap-hit" data-role="gap-hint" style="--o:' + (C.gapHint - c0) + '"><i></i><b>点这里断开</b></span>';
    if (focusHere && C.bubble) inner += bubbleHTML();
    if (popHere) inner += popHTML(sel);
    return '<div class="' + cls.join(' ') + '" data-role="cell" data-bar="' + barName(g) + '" data-g="' + g + '" data-beat="' + bi + '" data-c0="' + c0 + '" style="' + st + '">' + inner + '</div>';
  }

  function rowHTML(g) {
    var miss = C.miss && MISS && g * TPBAR >= MISS.start && g * TPBAR < MISS.end;
    var head = '<div class="rh' + (miss ? ' miss' : '') + '" data-role="row-head" data-bar="' + barName(g) + '"><b>' + (g >= STRESS_G ? barName(g) : pad(g + 1)) + '</b></div>';
    var cells = '', lab = '';
    for (var bi = 0; bi < 4; bi++) cells += cellHTML(g, bi);
    if (C.rhyme) {
      ANCHORS.forEach(function (a, i) {
        if (Math.floor(a.last / TPBAR) !== g) return;
        var gap = '';
        if (C.spacing) {
          // 只和同一段落里、同一种颜色的上一个句尾韵比（跨段落的间隔没有意义）
          var same = function (x) { return x.rule === a.rule && x.phrase.sec === a.phrase.sec; };
          var prev = ANCHORS.slice(0, i).filter(same).pop();
          if (prev) {
            var d = a.last - prev.last, pp = ANCHORS.slice(0, ANCHORS.indexOf(prev)).filter(same).pop();
            var diff = pp ? d - (prev.last - pp.last) : 0, odd = Math.abs(diff) >= TPB / 2;
            gap = '<span class="gap' + (odd ? ' odd' : '') + '" data-role="rhyme-gap" data-ticks="' + d + '"' + (odd ? ' data-odd="1"' : '') + '>↑' + beatsTxt(d) + (odd ? ' · ' + (diff < 0 ? '早' : '晚') + beatsTxt(diff).replace(' 拍', '') : '') + '</span>';
          } else gap = '<span class="gap" data-role="rhyme-gap" data-ticks="0">起</span>';
        }
        lab += '<span class="rtag" data-role="rhyme-tag" style="--h:' + a.rule.h + '"><i></i>' + a.rule.f.join('·') + gap + '</span>';
      });
    }
    return '<div class="row" data-role="row" data-bar="' + barName(g) + '">' + head + cells + '<div class="lab">' + lab + '</div></div>';
  }

  var MISS = null;
  if (C.miss) {
    // 自动断句之后：连续 ≥ 4 小节一处建议都没有 → 提示可能漏断（和 fixtures 里的 longRuns 同一条规则）
    var gs = PHRASES.filter(function (p) { return p.state !== 'open'; });
    for (var i = 1; i < gs.length; i++) {
      var s0 = gs[i].start, e0 = gs[i].end;
      if (e0 - s0 >= 4 * TPBAR && ROWSET[Math.floor(s0 / TPBAR)]) { MISS = { start: s0, end: e0 }; break; }
    }
  }

  function sheetHTML() {
    var h = '<div class="sheet" data-role="lyrics-sheet" data-step="' + C.step + '"><div class="sh-head"><div class="corner">小节 \\ 拍</div>';
    for (var bi = 0; bi < 4; bi++) {
      var rul = '';
      for (var k = 0; k < 4; k++) rul += '<i style="left:' + (k * 25) + '%"></i>';
      h += '<div class="colh" data-role="beat-head" data-beat="' + bi + '"><button class="bn" data-role="beat-head-btn" aria-label="选中第 ' + (bi + 1) + ' 拍整列"><span class="num">' + (bi + 1) + '</span><span class="rul" aria-hidden="true">' + rul + '</span></button></div>';
    }
    h += '<div class="lab-h">' + (C.spacing ? '韵脚 · 间隔' : '韵脚') + '</div></div>';
    var groups = [];
    Object.keys(ROWSET).map(Number).sort(function (a, b) { return a - b; }).forEach(function (g) {
      var sec = secOf(g), last = groups[groups.length - 1];
      if (!last || last.sec !== sec) groups.push({ sec: sec, rows: [g] });
      else last.rows.push(g);
    });
    groups.forEach(function (gr) {
      var nPh = PHRASES.filter(function (p) { return p.sec === gr.sec.label && p.state !== 'open'; }).length;
      h += '<div class="sec" data-role="section"><div class="sec-h" data-role="section-header"><b data-role="section-label">' + esc(gr.sec.label) + '</b><span>' +
        (gr.sec.first >= STRESS_G ? '2 小节 · 造出来的极端情况' : gr.sec.n + ' 小节 · ' + nPh + ' 句' + (C.ends === 'guess' ? '（建议）' : '')) + '</span>' +
        '<button class="ibtn" aria-label="' + esc(gr.sec.label) + ' 段落菜单">' + I.more + '</button></div>';
      gr.rows.forEach(function (g) {
        if (MISS && g === Math.floor(MISS.start / TPBAR)) {
          h += '<div class="miss-row" data-role="miss-warn" role="note"><span><b>第 ' + barName(Math.floor(MISS.start / TPBAR)) + '–' + barName(Math.floor((MISS.end - 1) / TPBAR)) + ' 小节 ' +
            Math.round((MISS.end - MISS.start) / TPBAR) + ' 小节没猜出一处断句。</b>快嘴段常常一句挨一句、中间不换气，只看节奏分不出来——这里很可能漏了好几句，请手动标（点方格按 <span class="kbd">Shift</span>+<span class="kbd">Enter</span>）。</span></div>';
        }
        h += rowHTML(g);
      });
      h += '</div>';
    });
    return h + '</div>';
  }

  /* ---------- 右栏小样例：一拍，同一套画法 ---------- */
  function miniHTML(words, ends, wide) {
    var saveW = WORDS, saveP = PHRASES, saveE = ENDS, saveS = SIZE, saveSel = C.selEnd, saveFocus = C.focus;
    WORDS = words.map(function (x) { return { abs: x[0], len: x[1], ch: '', off: x[0] % TPB, box: Math.min(x[1], TPB - x[0] % TPB), key: '0:' + Math.floor(x[0] / TPB) }; });
    ENDS = ends; PHRASES = []; C.selEnd = null; C.focus = null;
    var cur = [];
    WORDS.forEach(function (w) {
      cur.push(w);
      if (ends[w.abs]) { PHRASES.push({ id: PHRASES.length, words: cur, start: cur[0].abs, last: w.abs, end: w.abs + w.len, state: ends[w.abs], num: PHRASES.length + 1, sec: '' }); cur = []; }
    });
    if (cur.length) PHRASES.push({ id: PHRASES.length, words: cur, start: cur[0].abs, last: cur[cur.length - 1].abs, end: cur[cur.length - 1].abs + cur[cur.length - 1].len, state: 'open', num: PHRASES.length + 1, sec: '' });
    SIZE = { cell: wide ? 148 : 112, base: 12 };
    var inner = '', k;
    for (k = 0; k < 4; k++) inner += '<span class="tk" style="left:' + (k * 25) + '%"></span>';
    WORDS.forEach(function (w) { inner += squareHTML(w).replace('data-role="square"', 'data-role="mini-square"'); });
    inner += phraseHTML(0, { mini: true }).replace(/data-role="phrase-/g, 'data-role="mini-phrase-');
    WORDS = saveW; PHRASES = saveP; ENDS = saveE; SIZE = saveS; C.selEnd = saveSel; C.focus = saveFocus;
    return '<div class="mb' + (wide ? ' w2' : '') + '" data-role="mini-beat">' + inner + '</div>';
  }

  /* ---------- 顶栏 / 轨道区 / 工具条（和 v3.2 一样） ---------- */
  function stepsHTML() {
    var one = C.step === 1;
    return '<div class="steps" data-role="steps">' +
      '<button' + (one ? ' class="on"' : '') + ' aria-pressed="' + one + '" data-step="1"><i>1</i>铺 flow</button>' +
      '<button' + (one ? '' : ' class="on"') + ' aria-pressed="' + !one + '" data-step="2"><i>2</i><span class="desk-only">填字和韵脚</span><span class="mob-only">填字</span></button></div>';
  }
  function topHTML() {
    var hist = '<div class="hist"><button class="ibtn" data-role="undo" aria-label="撤销" title="撤销">' + I.undo + '</button>' +
      '<button class="ibtn" data-role="redo" aria-label="重做" title="重做" disabled>' + I.redo + '</button>' +
      '<button class="ibtn" data-role="history-btn" aria-label="操作历史">' + I.hist + '<span class="desk-only">历史</span></button></div>';
    var transport = '<div class="transport"><button class="ibtn desk-only" aria-label="回到开头">' + I.prev + '</button>' +
      '<button class="play" data-role="play" aria-label="播放">' + I.play + '</button>' +
      '<div class="pos"><b class="mono">' + barName(C.rows[0]) + ' · 1 · 1</b><span class="mono desk-only">' + (C.rows[0] * 2 / 60 | 0) + ':' + pad(C.rows[0] * 2 % 60) + '.0 / 4:06</span></div></div>';
    var bpm = '<div class="bpm"><span class="lbl desk-only">BPM</span><b class="mono">120</b></div>';
    return '<header class="top"><div class="brand"><div class="logo">AB</div><div class="proj"><b>恋爱循环 rap flow</b><span><i class="dot"></i>已自动保存<span class="desk-only"> · 含撤销历史</span></span></div></div>' +
      '<div class="vsep desk-only"></div>' + hist +
      '<div class="desk-only" style="display:flex;align-items:center;gap:8px">' + stepsHTML() + '<div class="vsep"></div>' + transport + bpm + '<button class="tog">' + I.metro + '节拍器</button></div>' +
      '<div class="spacer"></div><button class="btn ghost desk-only">' + I.folder + '作品</button><button class="btn desk-only">' + I.out + '导出</button>' +
      '<button class="ibtn mob-only" aria-label="导出">' + I.out + '</button></header>' +
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
    var ruler = '', g0 = C.rows[0], bars = 12;
    for (var i = 0; i < bars; i++) {
      var g = g0 + i, sec = SECS.filter(function (s) { return s.first === g; })[0];
      ruler += '<span class="bm' + (sec ? ' nx' : '') + '" style="left:' + (i / bars * 100).toFixed(3) + '%">' + (sec ? '' : g + 1) + '</span>';
      if (sec) ruler += '<span class="sl" data-role="section-label" style="left:calc(' + (i / bars * 100).toFixed(3) + '% + 2px)">' + esc(sec.label) + '</span>';
    }
    var name = '恋爱循环_inst.mp3 · 120 BPM';
    return '<section class="track" data-role="track-area"><div class="tl-lab ruler-l">小节</div><div class="ruler">' + ruler + '</div>' +
      '<div class="tl-lab"><div class="nm"><b>伴奏</b><span>' + name + '</span></div><div class="spacer"></div><button class="btn sm" data-role="replace-beat">' + I.swap + '替换伴奏</button></div>' +
      '<div class="lane">' + waveSVG(260, 11) + '<span class="playhead" style="left:0%"></span></div>' +
      '<div class="m-beat mob-only"><span>伴奏 <b>' + name + '</b></span><span class="spacer"></span><button class="btn sm" data-role="replace-beat">' + I.swap + '替换</button></div></section>';
  }

  function toolsHTML() {
    var nEnd = PHRASES.filter(function (p) { return p.state === 'end'; }).length, nGuess = PHRASES.filter(function (p) { return p.state === 'guess'; }).length;
    if (C.step === 2) {
      var sw = '';
      [['金色', 42, true], ['青色', 185], ['蓝色', 215], ['绿色', 150], ['粉色', 340]].forEach(function (r) {
        if (S === 'spacing' && r[1] === 185) return;
        sw += '<button class="sw' + (r[2] ? ' on' : '') + '" data-role="swatch" aria-label="' + r[0] + '" style="--h:' + r[1] + '"></button>';
      });
      return '<div class="tools"><span class="lbl">涂色</span><div class="swatches">' + sw + '</div><span class="vs"></span>' +
        '<div class="chips" data-role="paint-mode" title="点哪里就涂哪里"><button class="on" data-mode="phrase" aria-pressed="true">句尾</button><button data-mode="cell">单格</button><button data-mode="row">整行</button><button data-mode="box">框选</button><button data-mode="invert">反选</button></div>' +
        '<span class="status desk-only">' + (S === 'rhyme' ? '「句尾」涂法：点一句里任何一个字 = 涂这一句的句尾' : '行尾写着距上一个同色句尾韵几拍') + '</span></div>';
    }
    var status = {
      phrases: '<b>' + nEnd + '</b> 句 · 按歌词断好',
      dense: 'Hook A 3 <b>' + PHRASES.filter(function (p) { return p.sec === 'Hook A 3' && p.state === 'end'; }).length + '</b> 句 · 压力样例一小节 4 句',
      mark: '正在改 <b>第 101 小节第 1 拍</b>',
      auto: '<b>' + nGuess + '</b> 处建议 · 待确认',
      touch: '<b>' + nGuess + '</b> 处建议 · 待确认'
    }[S] || '';
    return '<div class="tools"><span class="lbl">铺 flow</span>' +
      '<div class="chips" data-role="precision" title="拖字的长度时吸附到这里"><button>1/8</button><button class="on">1/16</button><button>1/32</button><button>三连</button></div>' +
      '<span class="vs"></span><span class="lbl">断句</span><button class="btn sm' + (C.ends === 'guess' ? ' on-soft' : '') + '" data-role="auto-phrase">' + I.wand + '自动断句</button>' +
      '<span class="cnt" data-role="phrase-count">' + status + '</span><span class="spacer"></span>' +
      '<button class="btn sm ghost danger" data-role="clear-flow">' + I.reset + '清空全部 flow…</button></div>';
  }
  function bannerHTML() {
    var n = PHRASES.filter(function (p) { return p.state === 'guess'; }).length;
    return '<div class="ph-banner" data-role="phrase-banner" role="status"><span class="q"><b>自动断句猜了 ' + n + ' 处句尾（虚线 = 待确认）。</b>只看节奏：后面空了半拍以上、或者到了下一段，就猜这里断。' +
      '<span class="warn">快嘴段一句挨一句时猜不出来，会漏</span>；在这首歌上实测，按歌词断的句尾只猜中三成。</span>' +
      '<button class="btn sm" data-role="phrase-accept-all">全部接受</button><button class="btn sm ghost" data-role="phrase-dismiss-all">全部不要</button></div>';
  }

  /* ---------- 右栏 ---------- */
  function keyRow(keys, what) { return '<li><span class="keys">' + keys + '</span><span>' + what + '</span></li>'; }
  function sidePanel() {
    if (C.step === 2) {
      return '<div class="pn" data-role="rhyme-panel"><div class="pn-h"><h2>押韵</h2><span>第二步：定韵脚、填字</span></div>' +
        '<div class="blk"><div class="blk-h"><b>「句尾」涂法（有断句时默认）</b></div>' +
        '<p class="note">先选颜色，再<b>点一句里任何一个字</b>（或句尾红线）：涂的是这一句<b>句尾所在那一格</b>，押这一句<b>最后 1 个字</b>（单押）/ <b>最后 2 个字</b>（双押）。' +
        '两个字分在两格、甚至两小节也行，但<b>不会越过句首</b>。</p>' +
        '<div class="cmp" data-role="rule-compare"><span class="tag good">句尾涂法</span><span>押「…气<b>光</b>」——这一句最后 2 个字</span>' +
        '<span class="tag">按格子算</span><span>那一格最后一个字是下一句开头 → 押错（表格里虚线框）</span></div></div>' +
        '<div class="blk"><div class="blk-h"><b>单格 / 整行 / 框选（不变）</b></div><p class="note">要押句中韵（第 2、4 拍军鼓上的字）就切到「单格」，和 v3 一样：一格一种颜色，押格内最后 n 个字。' +
        '格子里正好有句尾时，押的是这一句的最后 n 个字。</p></div>' +
        (C.spacing ? '<div class="blk"><div class="blk-h"><b>韵脚间隔</b></div><p class="note">行尾写<b>距上一个同色句尾韵几拍</b>（按押韵字的起点量）。只和同一段落里的比；和上一次间隔差半拍以上，用警告色写「早½」「晚½」——只是提醒，不算错。</p></div>' : '') +
        '</div>';
    }
    var E = {};
    return '<div class="pn" data-role="flow-panel"><div class="pn-h"><h2>铺 flow</h2><span>第一步：先定每个字落在哪、一句在哪结束</span></div>' +
      '<div class="blk" data-role="phrase-legend"><div class="blk-h"><b>断句</b></div>' +
      '<div class="lg-row">' + miniHTML([[0, 12], [12, 12], [24, 12], [36, 12]], (E = {}, E[36] = 'end', E)) + '<p class="note"><b>一句</b> = 方格下面一条括线：左边深色竖线是<b>句首</b>，右边<b>红竖线是句尾</b>。</p></div>' +
      '<div class="lg-row">' + miniHTML([[0, 12], [12, 12], [24, 12], [36, 12]], (E = {}, E[12] = 'end', E[36] = 'end', E)) + '<p class="note"><b>两句紧挨着</b>：红线和深色线并排，横线一深一浅。</p></div>' +
      '<div class="lg-row">' + miniHTML([[0, 12], [12, 12], [24, 24]], (E = {}, E[24] = 'guess', E)) + '<p class="note"><b>虚线 = 待确认</b>：自动断句猜的，点一下确认或去掉。</p></div>' +
      '<p class="note">桌面上句首旁边的小数字是<b>这一段第几句</b>（放不下就不写）。整首没断过句的作品看起来和以前一样。</p></div>' +
      '<div class="blk" data-role="phrase-keys"><div class="blk-h"><b>怎么标</b></div><ul class="keylist">' +
      keyRow('<span class="kbd">Shift</span>+<span class="kbd">Enter</span>', '光标那一格标成句尾 / 再按取消（拆句、合句都是它）') +
      keyRow('点两格之间的缝', '在这里断开；点红线 → 确认、挪、去掉') +
      keyRow('拖红线', '左右挪句尾，吸到字和字之间') +
      keyRow('自动断句', '按节奏猜，全是虚线，等你确认') +
      keyRow('<span class="kbd">Ctrl</span>+<span class="kbd">Z</span>', '撤销，每一下都能撤') +
      '</ul><p class="note">空格、Shift+空格、两下空格、退格还是分格 / 三连 / 空音 / 合并，和 v3.2 一样。</p></div></div>';
  }
  function drawerHTML() {
    var note = C.step === 2 ? (C.spacing ? '金色间隔 15½ · 16 拍' : '句尾涂法 · 金色双押') : (C.ends === 'guess' ? '虚线 = 待确认 · 点红线改' : '点方格 →「到这里一句」');
    return '<div class="drawer" data-role="rhyme-drawer"><div class="grab"></div><div class="dh"><h2>' + (C.step === 2 ? '押韵' : '铺 flow') + '</h2>' +
      '<span class="note">' + note + '</span><span class="more">上滑' + I.up + '</span></div></div>';
  }

  /* ---------- 拼页面 ---------- */
  function render() {
    var html = '<div class="app" data-step="' + C.step + '">' + topHTML() + trackHTML() +
      '<div class="main"><main class="work">' + toolsHTML() + (C.banner ? bannerHTML() : '') + sheetHTML() + '</main><aside class="side">' + sidePanel() + '</aside></div></div>';
    document.body.innerHTML = html + drawerHTML() + (C.toast ? '<div class="toast warn" role="status" data-role="notice">' + C.toast + '</div>' : '');
  }
  render();
  var cell = document.querySelector('[data-role="cell"]');
  var sheet = document.querySelector('[data-role="lyrics-sheet"]');
  if (cell && sheet) {
    SIZE = { cell: cell.clientWidth, base: parseFloat(getComputedStyle(sheet).getPropertyValue('--ch')) || 19 };
    render();
  }
  // 气泡 / 小菜单不出屏（手机上 CSS 已经固定在底部）
  ['[data-role="square-tip"]', '[data-role="phrase-pop"]'].forEach(function (q) {
    var tip = document.querySelector(q);
    if (!tip || MOBILE) return;
    var r = tip.getBoundingClientRect();
    if (r.bottom > innerHeight - 70) { tip.classList.add('up'); tip.style.top = 'auto'; tip.style.bottom = 'calc(100% + 4px)'; r = tip.getBoundingClientRect(); }
    if (r.right > innerWidth - 8) tip.style.left = (parseFloat(getComputedStyle(tip).left) - (r.right - innerWidth + 12)) + 'px';
    r = tip.getBoundingClientRect();
    if (r.left < 8) tip.style.left = (parseFloat(getComputedStyle(tip).left) + (8 - r.left)) + 'px';
  });
  // 手机上把要看的那几行滚到表格可见区域
  var work = document.querySelector('.work');
  var target = { dense: '[data-role="row"][data-bar="S1"]', auto: MOBILE ? null : '[data-role="miss-warn"]', mark: '[data-focus]', touch: '[data-role="phrase-end"][data-sel]', rhyme: '[data-role="phrase-end"][data-abs="' + C.selEnd + '"]' }[S];
  var tEl = target && document.querySelector(target);
  if (work && tEl) {
    var wr = work.getBoundingClientRect(), er = tEl.getBoundingClientRect();
    var bottomPad = MOBILE ? (S === 'mark' || S === 'touch' ? 330 : 120) : 90;
    if (er.bottom > wr.bottom - bottomPad) work.scrollTop += er.bottom - (wr.bottom - bottomPad);
  }
})();
