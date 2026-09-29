/* 配置 / 嵌入参数 / 我的视图
   ==================================================================
   从 main.js 搬出来的"换一套客户不用改代码"那一层：

     1. 配置：把"怎么看数据"（字段、度量、画法、图表、区域层级…）打包成一份 JSON，
        能导出、能发给同事、能进版本库。
     2. 嵌入参数：被业务系统当组件嵌进去时，用 URL 参数控制初始状态（?embed=1&mode=region…）。
     3. 我的视图：把当前"看数据的姿势"整套存下来（参考 Power BI 的书签），一键切回。

   视图列表存在 localStorage（cm.views），列表 DOM 由 React 岛独占（ui/views.jsx），
   这里只负责数据与快照 —— 绝不清空 #viewlist 的 innerHTML（同 #list / #dash 的规矩）。
   ------------------------------------------------------------------ */

export function createConfig(ctx) {
  var state = ctx.state;
  var params = ctx.params;
  var $ = ctx.$;
  var setVal = ctx.setVal;
  var setChk = ctx.setChk;
  var setTxt = ctx.setTxt;
  var lsSet = ctx.lsSet;
  var lsJson = ctx.lsJson;
  var toast = ctx.toast;
  var downloadText = ctx.downloadText;
  var toDateStr = ctx.toDateStr;
  var measureKey = ctx.measureKey;
  var chartPrefs = ctx.chartPrefs;
  var syncParamsFromUi = ctx.syncParamsFromUi;
  var buildPlatformOptions = ctx.buildPlatformOptions;
  var invalidateView = ctx.invalidateView;
  var updateFilterSummary = ctx.updateFilterSummary;
  var renderTimeAxis = ctx.renderTimeAxis;
  var rebuildMarkers = ctx.rebuildMarkers;
  var renderList = ctx.renderList;
  var updateStats = ctx.updateStats;
  var renderAnalysis = ctx.renderAnalysis;
  var switchView = ctx.switchView;
  var regionIndex = ctx.regionIndex;
  var mountViews = ctx.mountViews;
  var AnalysisModel = ctx.AnalysisModel;
  var getCurrentView = ctx.getCurrentView;
  var isAnalysisView = ctx.isAnalysisView;

/* ================= 三期：可导出/导入的配置（可复用性的关键） =================
   一个企业客户换一套字段、一套口径、一套看板配置，不应该改代码。
   这里把"怎么看数据"整套打包成 JSON，能导出、能发给同事、能进版本库。 */
var CONFIG_VERSION = 1;
function buildConfig() {
  return {
    version: CONFIG_VERSION,
    exportedAt: new Date().toISOString(),
    fields: { time: state.timeCol || '', address: state.addrCol || '', platform: state.platCol || '', count: state.countCol || '' },
    measure: measureKey(),
    regionLevel: params.regionLevel,
      regionRamp: params.regionRamp,
    mapMode: params.mode,
    charts: JSON.parse(JSON.stringify(chartPrefs())),
    basemap: params.basemap,
    color: params.color,
    topN: state.topN,
    levels: JSON.parse(JSON.stringify(params.levels)),
    views: (loadViews() || []).map(function (v) { return { name: v.name, snap: v.snap }; })
  };
}
function applyConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') { return false; }
  try {
    if (cfg.fields) { state.cfgFields = cfg.fields; }
    if (cfg.measure && AnalysisModel.MEASURES[cfg.measure]) { state.measure = cfg.measure; setVal('ana-measure', cfg.measure); }
    if (cfg.regionLevel) { params.regionLevel = cfg.regionLevel; setVal('p-regionlevel', cfg.regionLevel); }
  if (cfg.regionRamp) { params.regionRamp = cfg.regionRamp; setVal('p-regionramp', cfg.regionRamp); }
    if (cfg.mapMode) { params.mode = cfg.mapMode; setVal('p-mode', cfg.mapMode); }
    if (cfg.basemap) { params.basemap = cfg.basemap; setVal('p-basemap', cfg.basemap); }
    if (cfg.color) { params.color = cfg.color; setVal('p-color', cfg.color); }
    if (cfg.topN != null) { state.topN = cfg.topN; setVal('ana-topn', String(cfg.topN)); }
    if (cfg.levels) { params.levels = cfg.levels; }
    if (cfg.charts) { state.chartPrefs = cfg.charts; lsSet('cm.charts', JSON.stringify(cfg.charts)); }
    if (Array.isArray(cfg.views)) {
      views = cfg.views.map(function (v, i) {
        return { id: 'v' + Date.now().toString(36) + i, name: v.name, at: Date.now(), snap: v.snap };
      });
      saveViews();
    }
    syncParamsFromUi();
    invalidateView();
    updateFilterSummary(); renderTimeAxis(); rebuildMarkers(); renderList(); updateStats();
    if (isAnalysisView()) { renderAnalysis({ force: true }); }
    return true;
  } catch (e) { return false; }
}
function exportConfig() {
  var cfg = buildConfig();
  downloadText(JSON.stringify(cfg, null, 2), '客户地图配置.json', 'application/json');
  toast('配置已导出');
}

function importConfigFile(file) {
  var fr = new FileReader();
  fr.onload = function () {
    var ok = false;
    try { ok = applyConfig(JSON.parse(String(fr.result))); } catch (e) { ok = false; }
    toast(ok ? '配置已导入' : '配置文件读不出来', 4000);
  };
  fr.readAsText(file, 'utf-8');
}

/* ================= 三期：嵌入模式 =================
   业务系统把它当组件嵌进去时，用 URL 参数控制初始状态，并可隐藏外壳。
   例：…/index.html?embed=1&kiosk=1&region=440000&mode=region&from=2024-01-01 */
function applyUrlParams() {
  var q = new URLSearchParams(location.search);
  if (!q.toString()) { return; }
  var embed = q.get('embed') === '1' || q.get('kiosk') === '1';
  if (embed) { document.body.classList.add('embed-mode'); }
  if (q.get('kiosk') === '1') { document.body.classList.add('kiosk-mode'); }
  var view = q.get('view');
  if (view) { setTimeout(function () { switchView(view); }, 300); }
  var mode = q.get('mode');
  if (mode && ['point', 'grid', 'region', 'heat'].indexOf(mode) >= 0) {
    params.mode = mode; setVal('p-mode', mode);
    if (mode === 'region') { var lv = q.get('level'); if (lv) { params.regionLevel = lv; setVal('p-regionlevel', lv); } }
  }
  var from = q.get('from'), to = q.get('to');
  if (from) { state.timeFrom = new Date(from + 'T00:00:00').getTime(); state.range = 'custom'; setVal('f-from', from); }
  if (to) { state.timeTo = new Date(to + 'T23:59:59').getTime(); setVal('f-to', to); }
  var plat = q.get('platform');
  if (plat) { state.platAll = false; state.platSet = new Set(plat.split(',')); }
  var region = q.get('region');
  if (region) {
    var idx = regionIndex();
    var need = region.slice(2) === '0000' ? 2 : (region.slice(4) === '00' ? 4 : 6);
    var nm = idx.names[region] || region;
    state.regionFilter = { code: region, name: nm, level: need === 2 ? 'province' : (need === 4 ? 'city' : 'district') };
  }
  window.__cmEmbedded = embed;
}

/* ================= 我的视图（参考 Power BI 的书签） =================
   把"当前看数据的姿势"整套存下来：筛选条件 + 地图画法 + 区域层级 + 图表样式。
   销售每天开工时点一下"我的待跟进"，不用重新点一遍筛选。 */
var LS_VIEWS = 'cm.views';
var views = null;
function loadViews() { if (!views) { views = lsJson(LS_VIEWS, []); } return views; }
function saveViews() { lsSet(LS_VIEWS, JSON.stringify(views || [])); }

function snapshotNow() {
  return {
    filter: state.filter, q: state.q,
    timeFrom: state.timeFrom, timeTo: state.timeTo, range: state.range,
    platAll: state.platAll, plats: state.platSet ? Array.from(state.platSet) : [],
    boxBounds: state.boxBounds || null,
    regionFilter: state.regionFilter || null,
    view: getCurrentView(),
    mode: params.mode, extrude: !!params.extrude, regionLevel: params.regionLevel, regionRamp: params.regionRamp, basemap: params.basemap,
    color: params.color, levels: JSON.parse(JSON.stringify(params.levels)),
    gridSize: params.gridSize, alpha: params.alpha,
    drillPath: (state.drillPath || []).slice(),
    charts: JSON.parse(JSON.stringify(chartPrefs()))
  };
}

function applySnapshot(s) {
  if (!s) { return; }
  state.filter = s.filter || 'all';
  state.q = s.q || '';
  setVal('q', state.q);
  state.timeFrom = s.timeFrom != null ? s.timeFrom : null;
  state.timeTo = s.timeTo != null ? s.timeTo : null;
  state.range = s.range || (state.timeFrom ? 'custom' : 'all');
  setVal('f-from', state.timeFrom ? toDateStr(state.timeFrom) : '');
  setVal('f-to', state.timeTo ? toDateStr(state.timeTo) : '');
  state.platAll = s.platAll !== false;
  state.platSet = (s.plats && s.plats.length) ? new Set(s.plats) : null;
  state.boxBounds = s.boxBounds || null;
  state.regionFilter = s.regionFilter || null;
  state.drillPath = s.drillPath || [];
  if (s.mode) { params.mode = s.mode; }
  if (s.regionLevel) { params.regionLevel = s.regionLevel; }
  if (s.regionRamp) { params.regionRamp = s.regionRamp; }
  if (s.basemap) { params.basemap = s.basemap; }
  if (s.color) { params.color = s.color; }
  if (s.levels) { params.levels = s.levels; }
  if (s.gridSize) { params.gridSize = s.gridSize; }
  if (s.alpha) { params.alpha = s.alpha; }
  if (s.charts) { state.chartPrefs = s.charts; lsSet('cm.charts', JSON.stringify(s.charts)); }
  if (s.gridSize) { setVal('p-gridsize', s.gridSize); }
  if (s.basemap) { setVal('p-basemap', s.basemap); }
  if (s.regionLevel) { setVal('p-regionlevel', s.regionLevel); }
  if (s.regionRamp) { params.regionRamp = s.regionRamp; setVal('p-regionramp', s.regionRamp); }
  if (s.color) { setVal('p-color', s.color); }
  if (s.mode) { setVal('p-mode', s.mode); }
  if (s.extrude != null) { setChk('p-extrude', s.extrude); params.extrude = s.extrude; }
  setChk('p-within', params.onlyWithin);
  // 表格 tab
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.className = t.getAttribute('data-tab') === state.filter ? 'tab active' : 'tab';
  });
  // 区域条
  var rb = $('regionbar');
  if (rb) { rb.hidden = !state.regionFilter; }
  if (state.regionFilter) { setTxt('region-text', '只看：' + state.regionFilter.name); }
  buildPlatformOptions();
  invalidateView();
  updateFilterSummary();
  renderTimeAxis();
  rebuildMarkers();
  renderList();
  updateStats();
  if (isAnalysisView()) { renderAnalysis({ force: true }); }
}

/* 视图摘要里显示的画法名 */
var MODE_LABEL = { grid: '网格', cluster: '点聚合', hex: '六边形', region: '分层着色', heat: '热力图', point: '标记点' };

function renderViews() {
  var box = $('viewlist');
  if (!box) { return; }
  var list = loadViews();
  setTxt('view-count', list.length);
  // 列表交给 React 岛渲染；#viewlist 由 React 独占，这里绝不再写 innerHTML
  mountViews(box, list.map(function (v) {
    var bits = [];
    if (v.snap.timeFrom || v.snap.timeTo) { bits.push('时间'); }
    if (v.snap.plats && v.snap.plats.length) { bits.push('平台 ' + v.snap.plats.length); }
    if (v.snap.regionFilter) { bits.push(v.snap.regionFilter.name); }
    if (v.snap.q) { bits.push('搜索'); }
    if (v.snap.boxBounds) { bits.push('框选'); }
    if (v.snap.mode && v.snap.mode !== 'point') { bits.push(MODE_LABEL[v.snap.mode] || v.snap.mode); }
    if (!bits.length) { bits.push('全部数据'); }
    return { id: v.id, name: v.name, tags: bits };
  }));
}


function openViews() {
  renderViews();
  var dlg = $('dlg-views');
  if (dlg && !dlg.open) { dlg.showModal(); }
}
function addView(name) {
  var list = loadViews();
  var nm = (name || '').trim() || ('视图 ' + (list.length + 1));
  list.unshift({ id: 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: nm, at: Date.now(), snap: snapshotNow() });
  if (list.length > 30) { list.length = 30; }
  views = list;
  saveViews();
  renderViews();
  toast('已保存视图「' + nm + '」');
}
function removeView(id) {
  views = loadViews().filter(function (v) { return v.id !== id; });
  saveViews();
  renderViews();
}
function useView(id) {
  var v = loadViews().filter(function (x) { return x.id === id; })[0];
  if (!v) { return; }
  applySnapshot(v.snap);
  var dlg = $('dlg-views');
  if (dlg && dlg.open) { dlg.close(); }
  toast('已切换到「' + v.name + '」');
}

  return {
    buildConfig: buildConfig,
    applyConfig: applyConfig,
    exportConfig: exportConfig,
    importConfigFile: importConfigFile,
    applyUrlParams: applyUrlParams,
    loadViews: loadViews,
    snapshotNow: snapshotNow,
    applySnapshot: applySnapshot,
    renderViews: renderViews,
    openViews: openViews,
    addView: addView,
    removeView: removeView,
    useView: useView
  };
}
