/* 数据表与列表
   ==================================================================
   从 main.js 搬出来的"客户列表"这一块：列表渲染、表格数据整形、行选中、顶部统计。

   #list 这个容器由 React + ag-grid 独占（见 ui/grid.jsx）。这里有一条硬规矩：
   **绝对不能清空它的 innerHTML** —— ag-grid 的 fiber 树会和真实 DOM 脱节，
   之后再 render 什么都不输出。所以 renderListWindow 只调用 mountGrid，不碰 DOM 结构。
   （这条是用最小复现确认过的，见 island.jsx 里的 reproWipe。）

   和 filters 的关系：这里只负责"把已经筛好的行画出来"，筛选条件怎么算在 main.js /
   filters 那一侧。行下标从 ctx.viewIndices() 拿。
   ------------------------------------------------------------------ */

export function createDataTable(ctx) {
  var state = ctx.state;
  var params = ctx.params;
  var $ = ctx.$;
  var mark = ctx.mark;
  var fmtDate = ctx.fmtDate;
  var setTxt = ctx.setTxt;
  var QUALITY_META = ctx.QUALITY_META;
  var viewIndices = ctx.viewIndices;
  var computeDistances = ctx.computeDistances;
  var hasCoord = ctx.hasCoord;
  var getDeckEngine = ctx.getDeckEngine;
  var mountGrid = ctx.mountGrid;
  var gridSelectRow = ctx.gridSelectRow;

  /* 行在列表里显示成什么（清洗后的地址 → 省市区 → 区县编码 → 原始地址，逐级兜底） */
function rowLabel(r) {
  if (r.clean) { return r.clean; }
  var m = r.match || {};
  var s = [m.p, m.c, m.d, m.t].filter(Boolean).join('');
  if (s) { return s; }
  if (r.acode) { return '\u533a\u53bf\u7f16\u7801 ' + r.acode; }
  return r.raw || '';
}

function renderList() {
  mark('renderList');
  var box = $('list');
  if (!state.rows.length) {
    box.innerHTML = '<div class="empty">' +
      '<div class="empty-t">\u8fd8\u6ca1\u6709\u6570\u636e</div>' +
      '<div class="empty-d">\u5730\u5740\u5728\u4f60\u81ea\u5df1\u7684\u7535\u8111\u4e0a\u89e3\u6790\uff0c\u4e0d\u4e0a\u4f20\u3001\u4e0d\u8054\u7f51\u3001\u4e0d\u9700\u8981\u5bc6\u94a5\u3002<br>\u652f\u6301\u7c98\u8d34\u6587\u672c\u3001CSV\u3001Excel\u3002</div>' +
      '<div class="empty-a">' +
        '<button type="button" class="btn tiny" data-empty="import">\u5bfc\u5165\u6570\u636e</button>' +
        '<button type="button" class="btn tiny ghost" data-empty="demo">\u8f7d\u5165\u793a\u4f8b\u6570\u636e</button>' +
      '</div></div>';
    $('list-count').textContent = '\u6682\u65e0\u6570\u636e';
    state.viewIdxs = [];
    return;
  }
  computeDistances();
  var idxs = viewIndices().slice();   // 拷贝一份，排序不影响缓存
  if (state.sort === 'dist') {
    idxs.sort(function (a, b) {
      var da = state.rows[a].distKm, db = state.rows[b].distKm;
      if (da == null && db == null) { return a - b; }
      if (da == null) { return 1; }
      if (db == null) { return -1; }
      return da - db;
    });
  } else if (state.sort === 'count') {
    idxs.sort(function (a, b) { return (state.rows[b].count || 0) - (state.rows[a].count || 0); });
  }
  state.viewIdxs = idxs;
  $('list-count').textContent = (idxs.length === state.rows.length
    ? ('\u5171 ' + state.rows.length + ' \u6761')
    : ('\u7b5b\u9009\u51fa ' + idxs.length + ' / ' + state.rows.length + ' \u6761')) +
    (idxs.length > 20000 ? '\uff08\u8868\u683c\u53ea\u8f7d\u5165\u524d 2 \u4e07\u6761\uff09' : '');
  // 关键：#list 由 React（ag-grid）独占。这里**绝不能**清空它的 innerHTML——
  // React 的 fiber 树会与真实 DOM 不一致，下一次 render 什么都不输出（已用最小复现确认）。
  state.viewStart = -1;
  state.viewEnd = -1;
  renderListWindow();
}

/* 只渲染滚动窗口内的几十条，几千/几万条也不卡 */
/* 交给 ag-grid 渲染：自带虚拟化、列排序、列筛选 */
var GRID_MAX = 20000;
function gridRows(idxs) {
  var n = Math.min(idxs.length, GRID_MAX);
  var out = new Array(n);
  for (var k = 0; k < n; k++) {
    var i = idxs[k], r = state.rows[i];
    out[k] = {
      idx: i,
      name: rowLabel(r),
      addr: String(r.raw || (r.phone2 ? '手机 ' + r.phone2 : '')).slice(0, 120),
      badge: r.status === 'ok' ? ((QUALITY_META[r.quality] || QUALITY_META.unknown).label)
        : (r.status === 'failed' ? '失败' : '待解析'),
      q: r.status === 'ok' ? (r.quality || 'unknown') : (r.status === 'failed' ? 'failed' : 'invalid'),
      count: r.count > 1 ? r.count : null,
      plat: r.plat || '',
      time: r.t != null ? fmtDate(r.t) : '',
      dist: (r.distKm != null && r.baseIdx >= 0) ? r.distKm : null,
      id: r.id || ''
    };
  }
  return out;
}

function renderListWindow() {
  mark('renderListWindow');
  var box = $('list');
  if (!box) { return; }
  var idxs = state.viewIdxs || [];
  mountGrid(box, gridRows(idxs), function (i) { selectRow(i, true); }, idxs.length);
}

function selectRow(i, fly) {
  state.activeIdx = i;
  var box = $('list');
  var prev = box.querySelector('.item.active');
  if (prev) { prev.classList.remove('active'); }
  // #list 现在由 ag-grid 接管：让它滚动到该行并选中
  gridSelectRow(i);
  var r = state.rows[i];
  if (!r) { return; }
  // 点一行顺手把地图飞过去。引擎是外面持有的，这里现取而不是缓存一份 ——
  // 否则换数据 / 换底图重建引擎之后，这里还指着旧的。
  var eng = getDeckEngine();
  if (fly && hasCoord(r) && eng) {
    var v1 = eng.getView();
      // 平滑飞过去，别硬切 —— 用户点一行时能看清是从哪飞到哪
      eng.setView({ longitude: r.lng, latitude: r.lat, zoom: Math.max(v1.zoom, 14) }, 650);
  }
}

function updateStats() {
  mark('updateStats');
  var s = state.stat;
  if (!s || s.total !== state.rows.length) {
    s = { total: state.rows.length, ok: 0, cust: 0, hasCount: false };
    for (var q = 0; q < state.rows.length; q++) {
      var rr = state.rows[q];
      if (rr.status === 'ok') { s.ok++; }
      if (rr.count > 1) { s.cust += rr.count; s.hasCount = true; }
    }
    state.stat = s;
  }
  var total = s.total, ok = s.ok, cust = s.cust, hasCount = s.hasCount;
  $('st-total').textContent = total;
  $('st-ok').textContent = ok;
  $('st-todo').textContent = total - ok;
  if (hasCount) { setTxt('st-cust', cust.toLocaleString()); }
  else { setTxt('st-cust', '\u2014'); }
  $('btn-run').disabled = state.running || !total;
  $('btn-export').disabled = !total;
}

  return {
    renderList: renderList,
    renderListWindow: renderListWindow,
    selectRow: selectRow,
    updateStats: updateStats,
    rowLabel: rowLabel,
    /* 表格只载入前 2 万条，这个上限外部（界面文案）也要用 */
    GRID_MAX: GRID_MAX
  };
}
