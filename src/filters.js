/* 筛选与时间轴
   ==================================================================
   从 main.js 搬出来的"哪些行该显示"这一整条链路：

     行匹配（时间 / 平台 / 半径 / 区域 / 框选 / 搜索词）
       → 行下标缓存（筛选没变就不重扫 42 万行）
         → 底部时间轴（拖拽刷选）
           → 平台多选、筛选芯片、筛选摘要

   这东西被地图、列表、分析页三方共用，所以它必须是"唯一真源"：
   state 里的筛选字段只有这一处读、这一处改。

   时间轴是手写的刷选控件：柱状直方图用 canvas 画，拖拽用指针事件。
   找过现成的（各种 range slider / brush 组件），都不满足"拖出一段区间、
   再单独调整两端"这个交互，所以这部分保留手写 —— 是权衡过的，不是没找。
   ------------------------------------------------------------------ */

export function createFilters(ctx) {
  var state = ctx.state;
  var params = ctx.params;
  var $ = ctx.$;
  var esc = ctx.esc;
  var mark = ctx.mark;
  var setTxt = ctx.setTxt;
  var setChk = ctx.setChk;
  var setVal = ctx.setVal;
  var updateStats = ctx.updateStats;
  var getBoxSel = ctx.getBoxSel;
  var setBoxSel = ctx.setBoxSel;
  var fmtDate = ctx.fmtDate;
  var toDateStr = ctx.toDateStr;
  var lsSet = ctx.lsSet;
  var toast = ctx.toast;
  var withinRadius = ctx.withinRadius;
  var ensureRowRegions = ctx.ensureRowRegions;
  var invalidateRegionAgg = ctx.invalidateRegionAgg;
  var pointInRings = ctx.pointInRings;
  var syncParamsFromUi = ctx.syncParamsFromUi;
  var setBoxMode = ctx.setBoxMode;
  var getBoxSel = ctx.getBoxSel;
  var renderList = ctx.renderList;
  var rebuildMarkers = ctx.rebuildMarkers;
  var renderAnalysis = ctx.renderAnalysis;
  var isAnalysisView = ctx.isAnalysisView;
  var monthStartMs = ctx.monthStartMs;
  var monthEndMs = ctx.monthEndMs;

function passTime(r) {
  if (state.timeFrom == null && state.timeTo == null) { return true; }
  if (r.t == null) { return false; }
  if (state.timeFrom != null && r.t < state.timeFrom) { return false; }
  if (state.timeTo != null && r.t > state.timeTo) { return false; }
  return true;
}
function passPlat(r) {
  if (state.platAll || !state.platSet) { return true; }
  if (!state.platSet.size) { return true; }
  return state.platSet.has(r.plat || '\uff08\u672a\u77e5\u5e73\u53f0\uff09');
}

function rowMatches(r, rowIndex) {
  if (!passTime(r) || !passPlat(r)) { return false; }
  if (!withinRadius(r)) { return false; }
  if (state.filter === 'ok' && r.status !== 'ok') { return false; }
  if (state.filter === 'todo' && r.status === 'ok') { return false; }
  if (state.boxBounds) {
    var bb = state.boxBounds;
    if (!(r.lng >= bb.x1 && r.lng <= bb.x2 && r.lat >= bb.y1 && r.lat <= bb.y2)) { return false; }
  }
  if (state.regionFilter) {
    var rf = state.regionFilter;
    // 优先用"这行属于哪个行政区"来判断，和图上的数字完全对得上；
    // 没有行政归属的行才退回用坐标做多边形判断。
    var reg = (rowIndex != null) ? ensureRowRegions()[rowIndex] : null;
    if (reg) {
      var rc = reg.d || reg.c || reg.p;
      var need = rf.level === 'district' ? 6 : (rf.level === 'city' ? 4 : 2);
      if (rc.slice(0, need) !== rf.code.slice(0, need)) { return false; }
    } else {
      var rb = rf.bb;
      // 没有边界框（比如从问答里直接设的区域筛选）就只能靠行政归属判断，
      // 判断不了的行一律排除，避免误算进别的区域
      if (!rb) { return false; }
      if (typeof r.lng !== 'number' || r.lng < rb[0] || r.lng > rb[2] || r.lat < rb[1] || r.lat > rb[3]) { return false; }
      if (rf.rings && !pointInRings(r.lng, r.lat, rf.rings)) { return false; }
    }
  }
  if (state.q) {
    var hay = (r.raw + ' ' + r.clean + ' ' + (r.id || '') + ' ' + (r.phones || []).join(' ')).toLowerCase();
    if (hay.indexOf(state.q.toLowerCase()) < 0) { return false; }
  }
  return true;
}

/* ---------------- 底部时间轴 ---------------- */
/* ================= 底部时间轴：可拖拽的时间刷选 =================
   参考 kepler.gl 的 time filter 和 ECharts 的 dataZoom：
   直方图打底 + 两个可拖拽的手柄 + 按住中间整体平移。
   拖动过程只改 DOM 位置（不重算数据），松手才真正筛选 ——
   否则拖一次就要扫一遍 42 万行，手感会很差。 */
var taDrag = null;
/* 当前筛选对应直方图上第几根柱子（闭区间） */
function taSelection() {
  var keys = state.taKeys || [];
  if (!keys.length) { return [0, -1]; }
  var lo = state.timeFrom, hi = state.timeTo;
  if (lo == null && hi == null) { return [0, keys.length - 1]; }
  var i0 = 0, i1 = keys.length - 1;
  if (lo != null) {
    i0 = keys.length - 1;
    for (var x = 0; x < keys.length; x++) { if (monthEndMs(keys[x]) >= lo) { i0 = x; break; } }
  }
  if (hi != null) {
    i1 = 0;
    for (var y = keys.length - 1; y >= 0; y--) { if (monthStartMs(keys[y]) <= hi) { i1 = y; break; } }
  }
  if (i0 > i1) { i0 = i1; }
  return [Math.max(0, i0), Math.min(keys.length - 1, i1)];
}

function taPaintHist() {
  var cv = $('ta-canvas'), keys = state.taKeys || [], hist = state.timeHist;
  if (!cv || !keys.length || !hist) { return; }
  var w = cv.clientWidth || 800, hh = cv.clientHeight || 44;
  if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
  var g2d = cv.getContext('2d');
  g2d.clearRect(0, 0, w, hh);

  /* 底：一条圆角"槽"，让直方图有落点，不是几根柱子浮在空白里 */
  g2d.fillStyle = 'rgba(128,128,128,.12)';
  g2d.fillRect(0, 0, w, hh);

  var maxV = 0;
  hist.forEach(function (v) { if (v > maxV) { maxV = v; } });
  var sel = taSelection();
  var bw = w / keys.length;
  var plotH = hh - 4;

  for (var i = 0; i < keys.length; i++) {
    var v = hist.get(keys[i]) || 0;
    var bh = maxV ? Math.max(2, Math.round(v / maxV * (plotH - 4))) : 2;
    var cw = Math.max(1, bw - 1.5);
    /* 选中的区间用主题色，区间外压成灰色 —— 光靠那层半透明遮罩不够明显 */
    var inSel = (i >= sel[0] && i <= sel[1]);
    g2d.fillStyle = inSel ? 'rgba(0,113,227,.82)' : 'rgba(128,128,128,.34)';
    g2d.beginPath();
    var rx = i * bw + (bw - cw) / 2, ry = plotH - bh, rr = Math.min(2.5, cw / 2, bh / 2);
    g2d.moveTo(rx + rr, ry);
    g2d.arcTo(rx + cw, ry, rx + cw, ry + bh, rr);
    g2d.arcTo(rx + cw, ry + bh, rx, ry + bh, rr);
    g2d.arcTo(rx, ry + bh, rx, ry, rr);
    g2d.arcTo(rx, ry, rx + cw, ry, rr);
    g2d.closePath();
    g2d.fill();
  }
}

/* 底下的时间刻度：起止 + 中间几个月份。
   以前只有一句"全部时间 · 37 个月"，看不出这段到底覆盖了什么时候。
   放在 DOM 里而不是画进 canvas：文字更清晰、能选中、能被读屏软件读到。 */
function taTicks() {
  var box = $('ta-ticks'), keys = state.taKeys || [];
  if (!box) { return; }
  if (!keys.length) { box.innerHTML = ''; return; }
  var n = Math.min(6, keys.length);
  var parts = [];
  for (var i = 0; i < n; i++) {
    var idx = Math.round(i * (keys.length - 1) / Math.max(1, n - 1));
    parts.push('<span>' + esc(keys[idx].replace('-', '/')) + '</span>');
  }
  box.innerHTML = parts.join('');
}

function taLayout(sel) {
  var track = $('ta-track'), keys = state.taKeys || [];
  if (!track || !keys.length) { return; }
  sel = sel || taSelection();
  var w = track.clientWidth || track.getBoundingClientRect().width;
  var bw = w / keys.length;
  var i0 = sel[0], i1 = sel[1];
  var all = (i0 <= 0 && i1 >= keys.length - 1);
  var win = $('ta-win'), ml = $('ta-mask-l'), mr = $('ta-mask-r'), reset = $('ta-reset');
  var x1 = i0 * bw, x2 = (i1 + 1) * bw;
  if (all) {
    if (win) { win.hidden = true; }
    if (ml) { ml.style.width = '0px'; }
    if (mr) { mr.style.left = w + 'px'; mr.style.width = '0px'; }
    if (reset) { reset.hidden = true; }
  } else {
    if (win) { win.hidden = false; win.style.left = x1 + 'px'; win.style.width = Math.max(8, x2 - x1) + 'px'; }
    if (ml) { ml.style.left = '0px'; ml.style.width = Math.max(0, x1) + 'px'; }
    if (mr) { mr.style.left = x2 + 'px'; mr.style.width = Math.max(0, w - x2) + 'px'; }
    if (reset) { reset.hidden = false; }
  }
  syncPresetButtons();
  var lab = $('ta-range');
  if (lab) {
    if (all && !taDrag) {
      lab.textContent = '全部时间 · ' + keys.length + ' 个月';
    } else {
      var k0 = keys[i0], k1 = keys[i1];
      var months = i1 - i0 + 1;
      lab.textContent = k0.replace('-', '/') + ' – ' + k1.replace('-', '/') +
        '（' + months + ' 个月' + (taDrag ? '，松手应用' : '') + '）';
    }
  }
}

function renderTimeAxis() {
  var ax = $('timeaxis');
  if (!ax) { return; }
  var hist = state.timeHist;
  if (!hist || !hist.size) { ax.hidden = true; return; }
  ax.hidden = false;
  state.taKeys = Array.from(hist.keys()).sort();
  taTicks();
  taPaintHist();
  if (!taDrag) { taLayout(); }
}

/* 快捷区间：点一下把时间范围切到"最近 N 个月"。
   手拖适合细调，日常更多是"我就想看最近三个月"。 */
function applyPreset(months) {
  var keys = state.taKeys || [];
  if (!keys.length) { return; }
  if (!months) { applyTimeSelection(0, keys.length - 1); return; }
  applyTimeSelection(Math.max(0, keys.length - months), keys.length - 1);
}
function syncPresetButtons() {
  var box = $('ta-presets'), keys = state.taKeys || [];
  if (!box) { return; }
  var sel = taSelection();
  var all = (sel[0] <= 0 && sel[1] >= keys.length - 1);
  Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) {
    var m = parseInt(b.getAttribute('data-months'), 10) || 0;
    var on = all ? (m === 0) : (m > 0 && m === (keys.length - sel[0]));
    b.className = on ? 'on' : '';
  });
}

/* 松手后真正应用：把月份区间换算成起止时间，写回全局筛选 */
function applyTimeSelection(i0, i1) {
  var keys = state.taKeys || [];
  if (!keys.length) { return; }
  i0 = Math.max(0, Math.min(keys.length - 1, i0));
  i1 = Math.max(i0, Math.min(keys.length - 1, i1));
  var full = (i0 === 0 && i1 === keys.length - 1);
  if (full) {
    state.timeFrom = null; state.timeTo = null; state.range = 'all';
    setVal('f-from', ''); setVal('f-to', '');
  } else {
    state.timeFrom = monthStartMs(keys[i0]);
    state.timeTo = monthEndMs(keys[i1]);
    state.range = 'custom';
    setVal('f-from', toDateStr(state.timeFrom));
    setVal('f-to', toDateStr(state.timeTo));
  }
  invalidateView();
  updateFilterSummary();
  renderTimeAxis();
  if (isAnalysisView()) { renderAnalysis(); } else { renderList(); rebuildMarkers(); }
  updateStats();
}

function bindTimeAxis() {
  var track = $('ta-track');
  if (!track || track.__bound) { return; }
  track.__bound = true;

  /* 快捷区间按钮在 track 外面，单独绑一次（点一下就把范围切过去） */
  var pbox = $('ta-presets');
  if (pbox && !pbox.__bound) {
    pbox.__bound = true;
    pbox.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('button[data-months]') : null;
      if (!b) { return; }
      applyPreset(parseInt(b.getAttribute('data-months'), 10) || 0);
    });
  }

  function idxAt(clientX) {
    var keys = state.taKeys || [];
    var r = track.getBoundingClientRect();
    if (!keys.length || r.width < 2) { return 0; }
    var f = (clientX - r.left) / r.width * keys.length;
    return Math.max(0, Math.min(keys.length - 1, Math.floor(f)));
  }
  function begin(ev, mode) {
    var keys = state.taKeys || [];
    if (!keys.length) { return; }
    var sel = taSelection();
    var i = idxAt(ev.clientX);
    taDrag = { mode: mode, i0: sel[0], i1: sel[1], anchor: i, x0: ev.clientX, base0: sel[0], base1: sel[1], moved: false };
    if (mode === 'new') { taDrag.i0 = i; taDrag.i1 = i; }
    taLayout([taDrag.i0, taDrag.i1]);
    var bub = $('ta-bub');
    if (bub) { bub.hidden = true; }
    ev.preventDefault();
    ev.stopPropagation();
  }

  track.addEventListener('pointerdown', function (ev) {
    if (ev.button !== 0) { return; }
    var t = ev.target;
    var grip = t.closest ? t.closest('.ta-grip') : null;
    if (grip) { begin(ev, grip.getAttribute('data-edge') === 'l' ? 'l' : 'r'); return; }
    if (t.closest && t.closest('.ta-win')) { begin(ev, 'move'); return; }
    begin(ev, 'new');
  });

  window.addEventListener('pointermove', function (ev) {
    if (!taDrag) { return; }
    var keys = state.taKeys || [];
    var i = idxAt(ev.clientX);
    if (Math.abs(ev.clientX - taDrag.x0) > 3) { taDrag.moved = true; }
    if (taDrag.mode === 'new') {
      taDrag.i0 = Math.min(taDrag.anchor, i);
      taDrag.i1 = Math.max(taDrag.anchor, i);
    } else if (taDrag.mode === 'l') {
      taDrag.i0 = Math.min(i, taDrag.i1);
    } else if (taDrag.mode === 'r') {
      taDrag.i1 = Math.max(i, taDrag.i0);
    } else if (taDrag.mode === 'move') {
      var span = taDrag.base1 - taDrag.base0;
      var di = i - taDrag.anchor;
      var n0 = Math.max(0, Math.min(keys.length - 1 - span, taDrag.base0 + di));
      taDrag.i0 = n0;
      taDrag.i1 = n0 + span;
    }
    taLayout([taDrag.i0, taDrag.i1]);
    ev.preventDefault();
  }, true);

  window.addEventListener('pointerup', function () {
    if (!taDrag) { return; }
    var d = taDrag;
    taDrag = null;
    applyTimeSelection(d.i0, d.i1);
  }, true);

  track.addEventListener('mousemove', function (ev) {
    var bub = $('ta-bub'), keys = state.taKeys || [];
    if (!bub || !keys.length) { return; }
    if (taDrag) { bub.hidden = true; return; }
    var i = idxAt(ev.clientX);
    var k = keys[i];
    var v = (state.timeHist && state.timeHist.get(k)) || 0;
    bub.hidden = false;
    bub.textContent = k.replace('-', '/') + ' · ' + v.toLocaleString() + ' 客户';
    var r = track.getBoundingClientRect();
    var x = (i + 0.5) / keys.length * r.width;
    bub.style.left = Math.max(0, Math.min(r.width - bub.offsetWidth, x - bub.offsetWidth / 2)) + 'px';
  });
  track.addEventListener('mouseleave', function () {
    var bub = $('ta-bub');
    if (bub) { bub.hidden = true; }
  });
  track.addEventListener('dblclick', function () {
    applyTimeSelection(0, (state.taKeys || []).length - 1);
  });
}

var ITEM_H = 66;
var PLAT_SHOW_MAX = 14;
var platExpanded = false;
function platformCounts() {
  if (state.platList && state.platList.length) { return state.platList; }
  var m = new Map();
  state.rows.forEach(function (r) {
    var k = r.plat || '\uff08\u672a\u77e5\u5e73\u53f0\uff09';
    m.set(k, (m.get(k) || 0) + 1);
  });
  return Array.from(m.entries()).sort(function (a, b) { return b[1] - a[1]; });
}
function buildPlatformOptions() {
  mark('buildPlatformOptions');
  var box = $('f-plats');
  if (!box) { return; }
  var list = platformCounts();
  state.platList = list;
  if (!list.length || (list.length === 1 && list[0][0].indexOf('\u672a\u77e5') === 0)) {
    box.innerHTML = '<span style="color:var(--muted);font-size:11px">\u6570\u636e\u91cc\u6ca1\u6709\u5e73\u53f0\u5217</span>';
    return;
  }
  var show = platExpanded ? list : list.slice(0, PLAT_SHOW_MAX);
  var html = show.map(function (kv) {
    var k = kv[0];
    var on = state.platAll || !state.platSet || !state.platSet.size || state.platSet.has(k);
    return '<label><input type="checkbox" data-plat="' + esc(k) + '"' + (on ? ' checked' : '') + '>' +
      esc(k.length > 8 ? k.slice(0, 8) + '\u2026' : k) + '</label>';
  }).join('');
  if (list.length > PLAT_SHOW_MAX) {
    html += '<span class="more" id="plat-more">' + (platExpanded ? '\u6536\u8d77' : '\u66f4\u591a(' + list.length + ')') + '</span>';
  }
  box.innerHTML = html;
  Array.prototype.forEach.call(box.querySelectorAll('input[data-plat]'), function (cb) {
    cb.addEventListener('change', function () {
      var k = cb.getAttribute('data-plat');
      collectPlatFilter();
      invalidateView(); updateFilterSummary(); renderList(); rebuildMarkers();
    });
  });
  var more = box.querySelector('#plat-more');
  if (more) { more.addEventListener('click', function () { platExpanded = !platExpanded; buildPlatformOptions(); }); }
}
function applyRange(kind) {
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  var from = null, to = null;
  if (kind === '7') { from = today - 6 * 86400000; to = today + 86399999; }
  else if (kind === '30') { from = today - 29 * 86400000; to = today + 86399999; }
  else if (kind === '90') { from = today - 89 * 86400000; to = today + 86399999; }
  else if (kind === 'month') { from = new Date(now.getFullYear(), now.getMonth(), 1).getTime(); to = today + 86399999; }
  state.range = kind;
  state.timeFrom = from;
  state.timeTo = to;
  invalidateView();
  setVal('f-from', from ? toDateStr(from) : '');
  setVal('f-to', to ? toDateStr(to) : '');
  var q = $('sf-quick');
  if (q) {
    Array.prototype.forEach.call(q.querySelectorAll('button'), function (b) {
      b.className = b.getAttribute('data-range') === kind ? 'on' : '';
    });
  }
  updateFilterSummary(); renderList(); rebuildMarkers();
}

/* 勾选=只看这些平台；全勾或全不勾都视为不筛选 */
function collectPlatFilter() {
  var box = $('f-plats');
  if (!box) { state.platAll = true; state.platSet = null; return; }
  var cbs = box.querySelectorAll('input[data-plat]');
  if (!cbs.length) { state.platAll = true; state.platSet = null; return; }
  var set = new Set();
  Array.prototype.forEach.call(cbs, function (cb) { if (cb.checked) { set.add(cb.getAttribute('data-plat')); } });
  var all = state.platList ? state.platList.length : cbs.length;
  if (set.size === 0 || set.size >= all) { state.platAll = true; state.platSet = null; }
  else { state.platAll = false; state.platSet = set; }
}

function updateFilterSummary() {
  var el = $('sf-sum');
  if (!el) { return; }
  var bits = [];
  if (state.timeFrom || state.timeTo) {
    var f = state.timeFrom ? new Date(state.timeFrom) : null;
    var to = state.timeTo ? new Date(state.timeTo) : null;
    bits.push('\u65f6\u95f4 ' + (f ? (f.getMonth() + 1) + '/' + f.getDate() : '\u8d77') + '~' + (to ? (to.getMonth() + 1) + '/' + to.getDate() : '\u4eca'));
  }
  if (!state.platAll && state.platSet && state.platSet.size) { bits.push('\u5e73\u53f0 ' + state.platSet.size + ' \u4e2a'); }
  if (state.boxBounds) { bits.push('\u5730\u56fe\u6846\u9009'); }
  if (state.regionFilter) { bits.push('\u533a\u57df ' + esc(state.regionFilter.name)); }
  var col = state.timeCol ? '\u00b7 \u65f6\u95f4\u53d6\u81ea ' + esc(state.timeCol) : '';
  el.innerHTML = (bits.length ? ('\u5df2\u7b5b\u9009\uff1a<b>' + bits.join('\uff0c') + '</b>') : '\u672a\u7b5b\u9009') + '<span style="color:var(--muted)">' + col + '</span>';
  renderChips();
}

/* ================= 筛选芯片：每个条件单独可去掉（Power BI 的筛选器卡片） ================= */
function currentChips() {
  var out = [];
  if (state.timeFrom || state.timeTo) {
    var f = state.timeFrom ? new Date(state.timeFrom) : null;
    var t = state.timeTo ? new Date(state.timeTo) : null;
    out.push({ k: 'time', t: '时间 ' + (f ? (f.getMonth() + 1) + '/' + f.getDate() : '起') +
      '~' + (t ? (t.getMonth() + 1) + '/' + t.getDate() : '今') });
  }
  if (!state.platAll && state.platSet && state.platSet.size) { out.push({ k: 'plat', t: '平台 ' + state.platSet.size + ' 个' }); }
  if (state.regionFilter) { out.push({ k: 'region', t: '区域 ' + state.regionFilter.name }); }
  if (state.boxBounds) { out.push({ k: 'box', t: '地图框选' }); }
  if (state.q) { out.push({ k: 'q', t: '搜索「' + state.q + '」' }); }
  if (state.filter !== 'all') { out.push({ k: 'tab', t: state.filter === 'ok' ? '只看已定位' : '只看待处理' }); }
  if (params.onlyWithin) { out.push({ k: 'within', t: '只看半径内' }); }
  if (params.onlyCount) { out.push({ k: 'count', t: '只看有客户的点' }); }
  return out;
}
function renderChips() {
  var box = $('chips');
  if (!box) { return; }
  var list = currentChips();
  if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = '<span class="chip-cap">当前筛选</span>' + list.map(function (c) {
    return '<span class="chip" data-chip="' + c.k + '"><span>' + esc(c.t) + '</span>' +
      '<button type="button" title="去掉这个条件" data-chip-x="' + c.k + '">×</button></span>';
  }).join('') + '<button type="button" class="chip-clear" id="chip-clear">全部清除</button>';
}
function refreshAfterFilter() {
  invalidateView();
  updateFilterSummary();
  renderTimeAxis();
  renderList();
  rebuildMarkers();
  updateStats();
  if (isAnalysisView()) { renderAnalysis(); }
}
function removeChip(k) {
  if (k === 'time') {
    state.timeFrom = null; state.timeTo = null; state.range = 'all';
    setVal('f-from', ''); setVal('f-to', '');
  } else if (k === 'plat') {
    state.platAll = true; state.platSet = null; buildPlatformOptions();
  } else if (k === 'region') {
    state.regionFilter = null; state.pendingRegion = null;
    var rb = $('regionbar'); if (rb) { rb.hidden = true; }
  } else if (k === 'box') {
    state.boxBounds = null; setBoxSel(null);
    var bb = $('boxbar'); if (bb) { bb.hidden = true; }
    setBoxMode(false);
  } else if (k === 'q') {
    state.q = ''; setVal('q', '');
  } else if (k === 'tab') {
    state.filter = 'all';
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.className = t.getAttribute('data-tab') === 'all' ? 'tab active' : 'tab';
    });
  } else if (k === 'within') {
    params.onlyWithin = false; setChk('p-within', false); syncParamsFromUi();
  } else if (k === 'count') {
    params.onlyCount = false; setChk('p-onlycount', false); syncParamsFromUi();
  }
  refreshAfterFilter();
}
function clearAllChips() {
  currentChips().forEach(function (c) { removeChip(c.k); });
  refreshAfterFilter();
}

/* 当前筛选下匹配的行下标。筛选条件没变就直接用缓存，避免每次都扫 42 万行 */
function viewKey() {
  return [state.filter, state.q, state.timeFrom, state.timeTo,
    state.platAll ? '*' : (state.platSet ? state.platSet.size : 0),
    params.onlyWithin ? 1 : 0, params.radiusKm, params.onlyCount ? 1 : 0,
    state.boxBounds ? 'b' + state.boxBounds.x1.toFixed(3) : '',
    state.regionFilter ? 'r' + state.regionFilter.code : ''].join('|');
}
function viewIndices() {
  mark('viewIndices');
  var k = viewKey();
  if (state._vKey === k && state._vIdx) { return state._vIdx; }
  var idx = [], rows = state.rows;
  for (var i = 0; i < rows.length; i++) { if (rowMatches(rows[i], i)) { idx.push(i); } }
  state._vKey = k; state._vIdx = idx;
  return idx;
}
function invalidateView() {
  state._vKey = null; state._vIdx = null;
  if (typeof invalidateRegionAgg === 'function') { invalidateRegionAgg(); }
}

  return {
    rowMatches: rowMatches,
    viewKey: viewKey,
    viewIndices: viewIndices,
    invalidateView: invalidateView,
    renderTimeAxis: renderTimeAxis,
    bindTimeAxis: bindTimeAxis,
    applyTimeSelection: applyTimeSelection,
    applyRange: applyRange,
    updateFilterSummary: updateFilterSummary,
    buildPlatformOptions: buildPlatformOptions,
    renderChips: renderChips,
    refreshAfterFilter: refreshAfterFilter,
    removeChip: removeChip,
    clearAllChips: clearAllChips,
    currentChips: currentChips
  };
}
