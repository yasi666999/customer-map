/* 常驻地址与地图
   ==================================================================
   从 main.js 搬出来的整块地图侧：

     · 常驻地址 / 辐射范围（谁离我多远、要跑哪一片）
     · deck.gl 引擎、六种画法、图例、框选、工具条
     · 行政区索引与聚合（地图分层着色、分析页钻取都用它）

   为什么合成一个文件：这几件事本来就咬在一起 —— 常驻地址决定地图上的圆圈和连线，
   行政区聚合决定分层着色和钻取，硬拆开只会多出几层互相回调。

   两条踩过的坑（别改回去）：
   1. 引擎实例由这个模块持有，外面用 getEngine() 现取 —— 换数据 / 换底图会重建引擎，
      缓存一份引用就会指着已销毁的那个。
   2. 常驻地址的 basePick / basesDirty 是模块内部的标量，外面要读就通过返回的对象，
      不要试图把它拷出去。
   ------------------------------------------------------------------ */

export function createMapView(ctx) {
  var state = ctx.state;
  var LS = ctx.LS;
  var params = ctx.params;
  var $ = ctx.$;
  var esc = ctx.esc;
  var mark = ctx.mark;
  var toast = ctx.toast;
  var setTxt = ctx.setTxt;
  var setVal = ctx.setVal;
  var lsSet = ctx.lsSet;
  var lsJson = ctx.lsJson;
  var shortNum = ctx.shortNum;
  var fmtMonth = ctx.fmtMonth;
  var fmtDate = ctx.fmtDate;
  var toDateStr = ctx.toDateStr;
  var pointInRings = ctx.pointInRings;
  var cityKeyOf = ctx.cityKeyOf;
  var monthStartMs = ctx.monthStartMs;
  var monthEndMs = ctx.monthEndMs;
  var HEAT_RAMPS = ctx.HEAT_RAMPS;
  var GRID_RAMP = ctx.GRID_RAMP;
  var REGION_RAMPS = ctx.REGION_RAMPS;
  var regionRamp = ctx.regionRamp;
  var rampColor = ctx.rampColor;
  var regionBreaks = ctx.regionBreaks;
  var regionColor = ctx.regionColor;
  var regionLevelOfCodes = ctx.regionLevelOfCodes;
  var QUALITY_META = ctx.QUALITY_META;
  var BASE_COLORS = ctx.BASE_COLORS;
  var getBases = ctx.getBases;
  var extractCityHint = ctx.extractCityHint;
  var setMapWarn = ctx.setMapWarn;
  var greatCircleDistance = ctx.greatCircleDistance;
  var initLocalGeo = ctx.initLocalGeo;
  var CITY_PALETTE = ctx.CITY_PALETTE;
  var EMPTY_ARR = ctx.EMPTY_ARR;
  var addPlace = ctx.addPlace;
  var suggestPlaceName = ctx.suggestPlaceName;
  var cacheSet = ctx.cacheSet;
  var cacheFlush = ctx.cacheFlush;
  var downloadText = ctx.downloadText;
  var todayStamp = ctx.todayStamp;
  var latLngToCell = ctx.latLngToCell;
  var cellToBoundary = ctx.cellToBoundary;
  var getHexagonEdgeLengthAvg = ctx.getHexagonEdgeLengthAvg;
  /* deck 引擎相关的工具函数（来自 map/deck-engine.js） */
  var createDeckEngine = ctx.DeckEngine.createDeckEngine;
  var boundariesToGeoJSON = ctx.DeckEngine.boundariesToGeoJSON;
  var isDeckReady = ctx.DeckEngine.isDeckReady;
  var zoomForBounds = ctx.DeckEngine.zoomForBounds;
  var clusterExpansionZoom = ctx.DeckEngine.clusterExpansionZoom;
  var syncParamsFromUi = function () { ctx.syncParamsFromUi(); };
  /* 下面这些是后面几块接线时才赋值的 var，只能包一层延迟取 */
  var renderList = function () { ctx.renderList(); };
  var updateStats = function () { ctx.updateStats(); };
  var rowLabel = function (r) { return ctx.rowLabel(r); };
  var selectRow = function (i, fly) { ctx.selectRow(i, fly); };
  var renderAnalysis = function (o) { ctx.renderAnalysis(o); };
  var invalidateView = function () { ctx.invalidateView(); };
  var updateFilterSummary = function () { ctx.updateFilterSummary(); };
  var renderTimeAxis = function () { ctx.renderTimeAxis(); };
  var viewIndices = function () { return ctx.viewIndices(); };
  var rowMatches = function (r, i) { return ctx.rowMatches(r, i); };
  var buildPlatformOptions = function () { ctx.buildPlatformOptions(); };

var bases = lsJson(LS.bases, []);
var basesDirty = false;
var basePick = -1;
function flushBases() { if (basesDirty) { lsSet(LS.bases, JSON.stringify(bases)); basesDirty = false; } }
setInterval(flushBases, 3000);

function activeBases() {
  return bases.filter(function (b) { return b && b.enabled !== false && typeof b.lng === 'number' && isFinite(b.lng); });
}
/* 两点球面距离（公里）。
   以前这里自己写了一遍 haversine 公式 —— 没必要，h3-js 已经带了同一个函数
   （greatCircleDistance），而 h3-js 本来就是依赖（六边形聚合在用），等于白捡。
   复用两个临时数组是为了不在几十万行的循环里反复分配小数组。 */
var _gcA = [0, 0], _gcB = [0, 0];
function haversine(lng1, lat1, lng2, lat2) {
  _gcA[0] = lng1; _gcA[1] = lat1;
  _gcB[0] = lng2; _gcB[1] = lat2;
  return greatCircleDistance(_gcA, _gcB, 'km');
}
function computeMaxCount() {
  var mx = 0;
  for (var i = 0; i < state.rows.length; i++) {
    var cc = state.rows[i].count;
    if (cc > mx) { mx = cc; }
  }
  state.maxCount = mx;
}
function sizeFor(r) {
  if (!params.sizeByCount || !state.maxCount || !(r.count > 1)) { return params.size; }
  var t = Math.sqrt(r.count) / Math.sqrt(state.maxCount);
  return Math.max(6, Math.round(params.size * (0.72 + t * 1.5)));
}

function computeDistances() {
  mark('computeDistances');
  computeMaxCount();
  var act0 = activeBases();
  // 没有常驻地址时不用算距离；上一次也没算过就直接返回，省掉一次 42 万行的遍历
  if (!act0.length && !state._distTouched) { return; }
  state._distTouched = act0.length > 0;
  var has = act0.length > 0;
  for (var i = 0; i < state.rows.length; i++) {
    var r = state.rows[i];
    r.distKm = null; r.baseIdx = -1;
    if (!has || r.status !== 'ok' || !hasCoord(r)) { continue; }
    var best = Infinity, bi = -1;
    for (var j = 0; j < bases.length; j++) {
      var b = bases[j];
      if (!b || b.enabled === false || typeof b.lng !== 'number') { continue; }
      var d = haversine(r.lng, r.lat, b.lng, b.lat);
      if (d < best) { best = d; bi = j; }
    }
    if (bi >= 0) { r.distKm = best; r.baseIdx = bi; }
  }
}
function withinRadius(r) {
  if (params.onlyCount && !(r.count > 1)) { return false; }
  if (!params.onlyWithin) { return true; }
  if (!activeBases().length) { return true; }
  return r.distKm != null && r.distKm <= params.radiusKm;
}

/* 常驻点的颜色：优先用它自己存的，没有就按序号从调色板里取。
   存下来是为了让用户改过的颜色能跟着 localStorage 一起留下来。 */
function baseColorOf(b, i) {
  return (b && b.color) ? b.color : BASE_COLORS[i % BASE_COLORS.length];
}
/* deck 要的是 [r,g,b] 数组，不是十六进制字符串 ——
   以前这里直接把 BASE_COLORS（'#e11d48' 这种）传过去，
   结果 deck 收到的是 ['#','e','1',235]，颜色一直是错的（实测确认过）。 */
function baseColorsRgb() {
  return bases.map(function (b, i) { return hexToRgb(baseColorOf(b, i)); });
}
/* 新常驻点挑一个还没被用过的颜色 */
function nextBaseColor() {
  var used = {};
  bases.forEach(function (b) { if (b && b.color) { used[b.color.toLowerCase()] = 1; } });
  for (var i = 0; i < BASE_COLORS.length; i++) {
    if (!used[BASE_COLORS[i].toLowerCase()]) { return BASE_COLORS[i]; }
  }
  return BASE_COLORS[bases.length % BASE_COLORS.length];
}

function renderBases() {
  var box = $('baselist');
  if (!box) { return; }
  if (!bases.length) {
    box.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:2px 0">\u8fd8\u6ca1\u6709\u5e38\u9a7b\u5730\u5740\u3002\u6dfb\u52a0\u540e\u53ef\u4ee5\u770b\u5b83\u7684\u8f90\u5c04\u8303\u56f4\u3001\u7b97\u5ba2\u6237\u8ddd\u79bb\u3002</div>';
    return;
  }
  var html = '';
  bases.forEach(function (b, i) {
    var color = baseColorOf(b, i);
    var ok = typeof b.lng === 'number';
    var st = ok ? (b.enabled === false ? '\u5df2\u505c\u7528' : '\u5df2\u5b9a\u4f4d') : '\u89e3\u6790';
    html += '<div class="base-item" data-i="' + i + '">' +
      '<div class="bl1">' +
        '<input type="color" class="base-color" value="' + color + '" title="点一下改颜色" aria-label="常驻点颜色">' +
        '<input type="text" class="base-name" value="' + esc(b.name || '') + '" placeholder="\u540d\u79f0\uff0c\u5982 \u5bb6 / \u4ed3\u5e93">' +
        '<button type="button" class="base-btn' + (ok ? ' ok' : '') + '" data-act="locate">' + st + '</button>' +
        '<button type="button" class="base-btn" data-act="pick" title="\u5728\u5730\u56fe\u4e0a\u70b9\u9009">\u70b9\u9009</button>' +
        '<button type="button" class="base-btn" data-act="del">\u00d7</button>' +
      '</div>' +
      '<input type="text" class="base-addr" value="' + esc(b.address || '') + '" placeholder="\u8f93\u5165\u5730\u5740\uff0c\u56de\u8f66\u89e3\u6790">' +
    '</div>';
  });
  box.innerHTML = html;
  Array.prototype.forEach.call(box.querySelectorAll('.base-item'), function (el) {
    var i = parseInt(el.getAttribute('data-i'), 10);
    el.querySelector('.base-name').addEventListener('input', function () { bases[i].name = this.value; basesDirty = true; });
    el.querySelector('.base-color').addEventListener('input', function () {
      bases[i].color = this.value;
      basesDirty = true; flushBases();
      // 颜色一变，地图上的圈/连线/点全都要跟着换
      rebuildMarkers(); renderLegend();
    });
    el.querySelector('.base-addr').addEventListener('input', function () { bases[i].address = this.value; basesDirty = true; });
    el.querySelector('.base-addr').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); locateBase(i); } });
    el.querySelector('[data-act=locate]').addEventListener('click', function () { locateBase(i); });
    el.querySelector('[data-act=pick]').addEventListener('click', function () { startBasePick(i); });
    el.querySelector('[data-act=del]').addEventListener('click', function () {
      bases.splice(i, 1); basesDirty = true; flushBases(); renderBases(); refreshRadius();
    });
  });
}

function locateBase(i) {
  var b = bases[i];
  if (!b) { return; }
  var addr = String(b.address || '').trim();
  if (!addr) { toast('\u5148\u586b\u4e00\u4e2a\u5730\u5740'); return; }
  try {
    var r = initLocalGeo().lookup(addr);
    if (!r.ok) { toast('\u6ca1\u89e3\u6790\u5230\uff1a' + (r.reason || '\u5730\u5740\u4e0d\u591f\u5177\u4f53'), 4200); return; }
    b.lng = r.lng; b.lat = r.lat; b.quality = r.quality; b.match = r.match || null; b.enabled = true;
    basesDirty = true; flushBases(); renderBases(); refreshRadius();
    toast('\u5df2\u5b9a\u4f4d\uff1a' + (b.name || addr) + '\uff08' + ((QUALITY_META[r.quality] || {}).label || '') + '\uff09');
    if (deckEngine) { var v0 = deckEngine.getView(); deckEngine.setView({ longitude: b.lng, latitude: b.lat, zoom: Math.max(v0.zoom, 11) }, 650); }
  } catch (e) { toast(e.message, 4200); }
}

function startBasePick(i) {
  basePick = i; state.manualPick = -1;
  document.body.style.cursor = 'crosshair';
  toast('\u5728\u5730\u56fe\u4e0a\u70b9\u51fb' + (bases[i].name || '\u5e38\u9a7b\u5730\u5740') + '\u7684\u771f\u5b9e\u4f4d\u7f6e', 5000);
}

function refreshRadius() {
  computeDistances();
  renderList(); updateBaseStat();
  rebuildMarkers();
}

function updateBaseStat() {
  var el = $('basestat');
  if (!el) { return; }
  if (!activeBases().length) { el.innerHTML = '\u6dfb\u52a0\u5e38\u9a7b\u5730\u5740\u540e\uff0c\u8fd9\u91cc\u4f1a\u663e\u793a\u534a\u5f84\u5185\u7684\u5ba2\u6237\u6570\u91cf\u3002'; return; }
  var located = 0, within = 0, near = Infinity, far = 0;
  state.rows.forEach(function (r) {
    if (r.status !== 'ok' || !hasCoord(r) || r.distKm == null) { return; }
    located++;
    if (r.distKm < near) { near = r.distKm; }
    if (r.distKm > far) { far = r.distKm; }
    if (r.distKm <= params.radiusKm) { within++; }
  });
  var s = '\u534a\u5f84 <b>' + params.radiusKm + ' km</b> \u5185\uff1a<b class="hl">' + within + '</b> \u6761\uff08\u5df2\u5b9a\u4f4d ' + located + ' \u6761\uff09';
  if (located) { s += '<br>\u6700\u8fd1 <b>' + near.toFixed(1) + '</b> km\uff0c\u6700\u8fdc <b>' + far.toFixed(1) + '</b> km'; }
  el.innerHTML = s;
}

/* ---------------- 地图 ---------------- */


/* 把某个客户钉到点选的位置（传入 GCJ02 坐标） */
function applyManualPick(idx, gcj) {
  var row = state.rows[idx];
  if (!row || !gcj) { return; }
  row.lng = gcj[0];
  row.lat = gcj[1];
  row.status = 'ok';
  row.quality = 'custom';
  row.source = 'manual';
  row.level = '\u624b\u52a8\u5730\u56fe\u70b9\u9009';
  row.flags = EMPTY_ARR;
  addPlace(suggestPlaceName(row), row.lng, row.lat);
  cacheSet(row.clean, { lng: row.lng, lat: row.lat, level: row.level, quality: 'custom', source: 'manual' });
  cacheFlush();
  toast('\u5df2\u5c06\u8be5\u5ba2\u6237\u5b9a\u5230\u70b9\u9009\u4f4d\u7f6e');
  state.manualPick = -1;
  document.body.style.cursor = '';
  rebuildMarkers(); renderList(); updateStats();
}


function hasCoord(r) {
  if (typeof r.lng !== 'number' || typeof r.lat !== 'number') { return false; }
  if (!isFinite(r.lng) || !isFinite(r.lat)) { return false; }
  /* (0,0) 在几内亚湾，不是真实客户位置，而是"没解析出坐标"的占位值。
     实测 42.7 万行里有 148 行是这样（色尼区、安多县、西沙群岛…），
     留着它们会把"看全图"的视野从中国拽到整个东半球 —— 两个地图引擎都中招。 */
  if (r.lng === 0 && r.lat === 0) { return false; }
  return true;
}

function activeQuality(r) {
  if (r.status !== 'ok') { return null; }
  if (r.quality === 'custom') { return params.levels.custom === false ? null : 'custom'; }
  return params.levels[r.quality] === false ? null : (r.quality || 'unknown');
}

/* 地图上要画的点。
   关键优化：坐标完全相同的行（同一区县的不同平台/月份）在图上本来就重叠，
   先按坐标合并成一个点、把客户数加总。42 万行通常能合并到几千个点，
   后续的聚合/建标记开销降到百分之一。 */
function visibleRows() {
  var idx = viewIndices();
  var merged = new Map();
  var order = [];
  for (var k = 0; k < idx.length; k++) {
    var i = idx[k], r = state.rows[i];
    if (r.status !== 'ok' || !hasCoord(r)) { continue; }
    if (!activeQuality(r)) { continue; }
    var key = Math.round(r.lng * 100000) * 1e7 + Math.round(r.lat * 100000);
    var g = merged.get(key);
    if (g) {
      g.count += (r.count > 1 ? r.count : 1);
    } else {
      merged.set(key, { i: i, r: r, count: (r.count > 1 ? r.count : 1) });
      order.push(key);
    }
  }
  var out = [];
  for (var m = 0; m < order.length; m++) {
    var it = merged.get(order[m]);
    // 合并出来的点用一条合成记录，只改客户数，其余字段沿用第一条
    var rr = it.count === (it.r.count > 1 ? it.r.count : 1)
      ? it.r
      : { k: 1, raw: it.r.raw, clean: it.r.clean, lng: it.r.lng, lat: it.r.lat,
          quality: it.r.quality, count: it.count, match: it.r.match, t: it.r.t,
          plat: it.r.plat, shop: it.r.shop, code: it.r.code, distKm: it.r.distKm,
          baseIdx: it.r.baseIdx, flags: it.r.flags, phones: it.r.phones };
    out.push({ i: it.i, r: rr });
  }
  state.mapPointCount = out.length;
  return out;
}

function markerColor(r) {
  if (params.color === 'none') { return '#2f6fed'; }
  if (params.color === 'city') {
    var city = (r.match && r.match.c) || extractCityHint(r.clean) || '\u5176\u4ed6';
    var h = 0;
    for (var i = 0; i < city.length; i++) { h = (h * 31 + city.charCodeAt(i)) % 997; }
    return CITY_PALETTE[h % CITY_PALETTE.length];
  }
  return (QUALITY_META[r.quality] || QUALITY_META.unknown).color;
}


function shortLabel(r) {
  var s = r.clean || r.raw || '';
  var m = s.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,12}?(\u5c0f\u533a|\u5927\u53a6|\u516c\u53f8|\u5e7f\u573a|\u4e2d\u5fc3|\u5e97|\u7ad9|\u6751|\u82d1|\u57ce|\u697c)/g);
  if (m && m.length) { return m[m.length - 1]; }
  return s.length > 12 ? s.slice(-12) : s;
}

/* ---------------- 热力图 ---------------- */
var heatSprite = null;









/* ================= deck.gl 地图引擎 =================
   把项目的筛选结果喂给 deck.gl（官方图层 + 本地打包，双击可用）。
   分工：
     - 底图：在线走高德瓦片（不需要密钥），离线/关闭时用本地边界包
     - 数据：点 / 网格 / 六边形 / 热力 / 分层着色，全部用 deck.gl 官方图层
     - 交互：拾取结果包装成和原来一模一样的形状，提示卡和图例不用改
   deck.gl 那 2MB 是懒加载的：首屏可交互之后才注入。 */
var deckEngine = null;
var deckBoundaryCache = { src: null, geojson: null };
var AMAP_ROAD = 'https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}';
var AMAP_SAT = 'https://webst01.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}';


function hexToRgb(hex) {
  var h = String(hex || '#2f6fed').replace('#', '');
  if (h.length === 3) { h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2); }
  var n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* 本地边界只在源数据变了才重新转 GeoJSON —— 区县那一份有 5MB，每次重转会卡 */
function deckBoundaryGeo() {
  if (params.basemap === 'none') { return null; }
  var src = window.CN_BOUNDARY_P;
  if (params.basemap === 'boundary') { src = window.CN_BOUNDARY_C || window.CN_BOUNDARY_P; }
  else if (params.mode === 'region') {
    /* 分层着色时的底图边界必须**跟着当前层级走**。
       以前这里取的是"最细的那份"（区县 > 市 > 省）—— 于是从省切到市之后，
       市界被加载过一次就永远优先，再切回省时底图上还是密密麻麻的市界，
       看着就像"改不回去了"（实测过：图层数据已经是 34 个省，但画面仍是市的样子）。 */
    var lv = regionLevelNow();
    src = lv === 'district' ? (window.CN_BOUNDARY_D || window.CN_BOUNDARY_C || window.CN_BOUNDARY_P)
      : (lv === 'city' ? (window.CN_BOUNDARY_C || window.CN_BOUNDARY_P) : window.CN_BOUNDARY_P);
  }
  if (!src) { return null; }
  if (deckBoundaryCache.src === src) { return deckBoundaryCache.geojson; }
  deckBoundaryCache = { src: src, geojson: boundariesToGeoJSON(src) };
  return deckBoundaryCache.geojson;
}

/* 区域分层着色的数据准备：边界 + 聚合值 + 配色分级。
   配色直接复用 core/palette.js 的 regionBreaks / regionColor，
   和图例（regionLegend）用的是同一套分级，不会出现"图例和地图对不上"。 */
var deckRegionCache = { key: null, geojson: null, cls: null, list: null, ms: 0 };

function deckRegionBuild() {
  var level = regionLevelNow();
  var src = window[REGION_FILES[level].g];
  if (!src) { return null; }
  var agg = regionAgg();
  var m = level === 'province' ? agg.prov : (level === 'city' ? agg.city : agg.dist);
  var key = (state._vKey || '') + '|' + level;
  if (deckRegionCache.key === key) { return deckRegionCache; }
  var t0 = performance.now();
  var cls = regionBreaks(m);
  var gj = boundariesToGeoJSON(src);
  var list = [];
  for (var i = 0; i < gj.features.length; i++) {
    var f = gj.features[i], bb = f.properties.bb, code = f.properties.code;
    var v = m.get(code) || 0;
    if (!v && level === 'city') {
      /* 直辖市的市界文件里放的是它们的区（110101 东城区…），而汇总数据是按"市"（110100）存的，
         直接查就全是 0 —— 北京/上海/天津/重庆 这几块主力市场整片灰色，
         看上去就像"改了配色没反应"。查不到就用区县码前 4 位补 00 再查一次。 */
      v = m.get(String(code).slice(0, 4) + '00') || 0;
    }
    f.properties.v = v;
    list.push({ kind: 'region', code: code, name: f.properties.name, bb: bb,
      rings: src[i][3], v: v, level: level,
      cen: (src[i][4] || [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]) });   // f[4] 是数据自带的标注点，优先用它
  }
  deckRegionCache = { key: key, geojson: gj, cls: cls, list: list,
    ms: Math.round(performance.now() - t0) };
  return deckRegionCache;
}

function deckRegionColorOf(props) {
  var cls = deckRegionCache.cls;
  if (!cls) { return [205, 210, 217, 110]; }
  var v = props && props.v ? props.v : 0;
  if (!v) { return [205, 210, 217, 110]; }
  var rgb = regionColor(v, cls, params.regionRamp).match(/\d+/g);
  return [+rgb[0], +rgb[1], +rgb[2], 215];
}
/* deck.gl 懒加载：2MB 的包不在首屏同步加载，等页面可交互之后再注入。
   这样双击打开的可交互时间不受影响（实测差 ~54ms）。
   想验证"如果不懒加载会怎样"，把 vendor/deckgl/deck.gl.min.js 用同步 script 标签引回去即可。 */
var deckScriptPromise = null;
function loadDeckGL() {
  if (window.deck && window.deck.Deck) { return Promise.resolve(); }
  if (deckScriptPromise) { return deckScriptPromise; }
  deckScriptPromise = new Promise(function (/** @type {(v?: any) => void} */ resolve, /** @type {any} */ reject) {
    var s = document.createElement('script');
    s.src = 'vendor/deckgl/deck.gl.min.js';
    s.onload = function () {
      if (window.deck && window.deck.Deck) { resolve(); }
      else { deckScriptPromise = null; reject(new Error('deck.gl 加载完成但未初始化')); }
    };
    s.onerror = function () { deckScriptPromise = null; reject(new Error('deck.gl 脚本加载失败（vendor/deckgl 目录是否完整？）')); };
    document.head.appendChild(s);
  });
  return deckScriptPromise;
}
function ensureDeckEngine() {
  if (deckEngine) { return deckEngine; }
  if (!isDeckReady()) { throw new Error('deck.gl 未加载'); }
  deckEngine = createDeckEngine({
    container: $('map'),
    /* 视图变化要自己接（没有底图库的 zoomend 事件可用）：
       拖动/缩放结束后重绘一次（点聚合要靠缩放级别重新分组，图层也要跟着视野更新）。 */
    onViewChange: function () {
      clearTimeout(state._deckViewT);
      state._deckViewT = setTimeout(function () { { rebuildMarkers(); } }, 180);
    },
    onHover: function (info) {
      if (!info) { hideTip(); return; }
      var o = info.object;
      if (!o) { hideTip(); return; }
      // 区域图层：object 是 GeoJSON feature
      if (params.mode === 'region' && o.properties) {
        var hit = deckRegionFindByCode(o.properties.code);
        if (hit) { showRegionTip(hit, info.x, info.y); return; }
      }
      // 六边形聚合：deck 的 HexagonLayer 拾取对象是 {col,row,position,count,elevationValue}
      //   count          = 格内地点数
      //   elevationValue = 加权后的客户数（getWeight 返回的就是客户数）
      if (params.mode === 'hex' && o && o.elevationValue != null) {
        var hexN = Math.round(o.elevationValue) || 0;
        showTip({ kind: 'hex', x: info.x, y: info.y, rad: 16,
          cell: { n: hexN, pts: o.count || 0, rep: null }, count: hexN }, info.x, info.y);
        return;
      }
      // 点聚合的气泡：包成和手写版一样的形状，直接复用原有的提示卡
      if (o.pts) {
        showTip({ kind: 'cell', x: info.x, y: info.y, rad: 14,
          cell: { n: o.n, pts: o.pts, rep: o.rep }, count: o.n }, info.x, info.y);
        return;
      }
      // 点图层：object 就是项目里的 item（{i, r}），提示卡沿用原来的
      if (o.r) {
        showTip({ kind: 'pt', x: info.x, y: info.y, rad: 12, item: o,
          count: o.r.count > 1 ? o.r.count : 1 }, info.x, info.y);
        return;
      }
      hideTip();
    },
    onClick: function (info, raw) {
      if (!info) { return; }
      var o = info.object;
      var coord = info.coordinate;   // [lng, lat]，项目数据和高德底图都是 GCJ02，不用换算
      // 1) 正在点选常驻地址：点哪就把常驻点钉到哪
      if (basePick >= 0) {
        if (coord) {
          var b0 = bases[basePick];
          if (b0) {
            b0.lng = coord[0]; b0.lat = coord[1]; b0.enabled = true;
            basesDirty = true; flushBases(); renderBases(); refreshRadius();
            toast('已把「' + (b0.name || '常驻地址') + '」定到点选位置');
          }
        }
        basePick = -1; document.body.style.cursor = '';
        return;
      }
      // 2) 正在手动校正某个客户
      if (state.manualPick >= 0) {
        if (coord) { applyManualPick(state.manualPick, coord); }
        return;
      }
      if (params.mode === 'region' && o && o.properties) {
        var hit = deckRegionFindByCode(o.properties.code);
        if (hit) { selectRegion(hit); }
        return;
      }
      // 点聚合的气泡：点一下放大展开。放大到几级用 supercluster 自己算的展开级别，
      // 比固定"+2 级"准（有的地方要放 1 级就散开，有的要 4 级）
      if (params.mode === 'cluster' && o && o.pts) {
        var v = deckEngine.getView();
        var zExpand = o.clusterId != null ? clusterExpansionZoom(o.clusterId) : null;
        deckEngine.setView({ longitude: o.lng, latitude: o.lat, zoom: Math.min(18, zExpand || v.zoom + 2) });
        return;
      }
      if (o && o.i != null) { selectRow(o.i, true); }
    }
  });
  return deckEngine;
}

function deckRegionFindByCode(code) {
  var list = deckRegionCache.list || [];
  for (var i = 0; i < list.length; i++) { if (list[i].code === code) { return list[i]; } }
  return null;
}
function renderDeckMap() {
  var wrap = $('view-map');
  if (!wrap) { return; }
  /* deck.gl 是懒加载的：还没到位就先挂一个提示，加载完自动重画一次 */
  if (!isDeckReady()) {
    setMapWarn('地图引擎加载中…');
    loadDeckGL().then(function () {
      setMapWarn('');
      renderDeckMap();
    }).catch(function (e) { setMapWarn((e && e.message) || 'deck.gl 加载失败'); });
    return;
  }
  var items = visibleRows();
  var eng;
  try { eng = ensureDeckEngine(); }
  catch (e) { setMapWarn(e.message || 'deck.gl 初始化失败'); return; }
  setMapWarn('');

  var needCity = params.basemap === 'boundary' || params.mode === 'region';
  if ((!window.CN_BOUNDARY_P) || (needCity && !window.CN_BOUNDARY_C)) {
    loadRegionData(needCity ? 'city' : 'province').then(function () { renderDeckMap(); }).catch(function () {});
  }
  if (params.mode === 'region' && !window.CN_BOUNDARY_D && params.regionLevel === 'district') {
    loadRegionData('district').then(function () { renderDeckMap(); }).catch(function () {});
  }

  var tiles = null;
  if (params.basemap === 'normal') { tiles = AMAP_ROAD; }
  else if (params.basemap === 'satellite') { tiles = AMAP_SAT; }

  var region = null;
  if (params.mode === 'region') { region = deckRegionBuild(); }

  var engResult = eng.update({
    items: items,
    params: params,
    zoom: deckEngine && deckEngine.getView ? deckEngine.getView().zoom : 5,
    formatCount: shortNum,
    /* 这几个是 deck 图层要用的"数据侧"参数（原来手写渲染时在函数内部取，现在显式传） */
    heatRamp: (HEAT_RAMPS[params.heatRamp] || HEAT_RAMPS.classic),
    maxCount: state.maxCount || 1,
    lodMax: params.lodMax || 9000,
    /* 常驻地址 / 辐射圈 / 连线 / 标签 需要的素材（都是项目里已有的数据） */
    bases: bases,
      baseColors: baseColorsRgb(),
    shortLabelOf: shortLabel,
    elevationScale: params.extrudeScale || 30,
    gridCellMeters: 30000,
    hexRadius: function (res) {
      // H3 层级 → 米制半径。乘 2 让它和手写版的观感接近（手写版画的是整格）
      try { return getHexagonEdgeLengthAvg(Math.max(3, Math.min(8, res)), 'm') * 2; } catch (e) { return 30000; }
    },
    cellOf: function (lat, lng, res) { return latLngToCell(lat, lng, res); },
    tiles: tiles,
    boundary: region ? null : deckBoundaryGeo(),
    boundaryWidth: 0.7,
      region: region ? { geojson: region.geojson, version: region.key, level: regionLevelNow() } : null,
    regionColorOf: deckRegionColorOf,
    colorOf: function (r) { return hexToRgb(markerColor(r)); }
  });
  state.layerItems = items;
  if (region) {
    state.regionProj = deckEngine ? deckEngine.projector() : null;
    regionPickList = region.list;
    state.layerStats = { items: region.list.length, drawn: region.list.length, grid: false,
      region: params.regionLevel, of: region.list.length, ms: region.ms, deck: true };
  } else {
    state.layerStats = { items: items.length, drawn: items.length,
      grid: params.mode === 'grid', auto: false,
      hex: params.mode === 'hex', cluster: params.mode === 'cluster',
      heat: params.mode === 'heat', deck: true, ms: 0 };
    // 点聚合统计（气泡数/独立点数/最大值）用和手写版同名的字段，测试与提示卡可直接用
    if (engResult && engResult.clusterStats) { state.clusterStats = engResult.clusterStats; }
    // 六边形：drawn 用"H3 格子数"（和手写版同口径），不是点数
    if (engResult && engResult.hexStats) {
      state.hexStats = engResult.hexStats;
      state.layerStats.drawn = engResult.hexStats.bins;
      state.layerStats.hexRes = engResult.hexStats.res;
    }
    state.layerStats.clusterInfo = params.mode === 'cluster' ? state.clusterStats : null;
    // 点太密自动降级成网格时，图例要跟着说明（和手写版一致）
    if (engResult && engResult.autoGrid) { state.layerStats.grid = true; state.layerStats.auto = true; }
    // 连线：从"超过 400 条就一条不画"改成"按距离取最近 N 条"，图例要能说明实际画了多少
    if (engResult && engResult.linkStats) { state.layerStats.links = engResult.linkStats; }
    if (engResult && engResult.skippedPoints) { state.layerStats.drawn = 0; }
    if (params.mode === 'heat') { window.__cmHeat = { drawn: items.length, deck: true }; }
  }
  window.__cmLayer = state.layerStats;
  state.mapPointCount = items.length;
}

function destroyDeckEngine() {
  if (deckEngine) { try { deckEngine.destroy(); } catch (e) {} deckEngine = null; }
}
/* 唯一的渲染入口：deck.gl 引擎 */
function rebuildMarkers() {
  mark('rebuildMarkers');
  renderDeckMap();
  renderLegend();
}

/* 浮在地图下沿、会挡住数据的面板高度（现在是时间条）。
   "看全图"要把它扣掉，不然南边的点永远藏在它后面。 */
function bottomInset() {
  var ax = $('timeaxis');
  if (!ax || ax.hidden) { return 0; }
  var h = ax.getBoundingClientRect().height || 0;
  return h ? h + 14 : 0;   // 14 = 面板距地图下沿的间距
}

function fitView() {
  mark('fitView');
  if (deckEngine) { deckEngine.fit(visibleRows(), { bottomInset: bottomInset() }); }
}


/* ================= 地图图层：Canvas 渲染 + 悬停拾取 + 网格聚合 =================
   参考 kepler.gl / deck.gl 的做法：客户点不再用一个个 DOM 标记，而是画在一张 canvas 上。
   这样视野内几万个点也能流畅拖动缩放，还能做鼠标悬停命中（picking）——
   像 deck.gl 那样"指到哪个点，就报哪个点"。 */
var boxMode = false, boxDrag = null, boxSel = null;

/* 经纬度（GCJ02）→ 屏幕像素。
   百度 GL 的 pointToPixel 是准的，但逐点调用几万次会卡；
   而地图投影在视野范围内是线性的，所以取中心 + 两个偏移点反推出"每度多少像素"，
   之后一次乘加就能算出像素坐标。实测 4.5 度跨度内误差 < 3px。 */






/* ================= 点聚合（气泡） =================
   直接照 mapbox/supercluster 的做法实现，解决"点太密集看不清"：
     - 把经纬度投影到**世界像素**坐标，再按固定像素边长划格子
     - 落在同一格里的点合成一个气泡，气泡里写客户数，半径按数量开方增长
     - 格子只跟"缩放级别"有关，**跟画面平移无关** ——
       所以拖动地图时气泡不会跟着飘（这是它和屏幕网格的关键区别）
     - 放大一级就重新聚合一次，气泡自然散开；点气泡还能直接放大展开
   为什么不按地理格子（H3）聚合：实测 2787 个区县点里 2476 个各自独占一个六边形，
   等于没聚合。密集是"屏幕上挨得近"，就得按屏幕距离来聚。 */
var CLUSTER_CELL = 64;     // 世界像素格子边长，约等于 supercluster 的 radius
var CLUSTER_MIN_R = 10;    // 气泡最小半径（像素）
var CLUSTER_MAX_R = 26;    // 气泡最大半径


/* ================= H3 六边形聚合（参考 Uber H3 + deck.gl HexagonLayer） =================
   方格会随纬度变形，六边形在球面上邻居距离均匀，是地理聚合的行业标准做法。
   注意：数据的 GCJ02 坐标直接当经纬度用，切网格会有约 500 米的偏移，
   对"哪一片客户多"这种聚合结论没有影响。 */




function tipHtml(p) {
  if (p.kind === 'hex') {
    var hc = p.cell;
    return '<b>' + esc((hc.rep && hc.rep.r ? shortLabel(hc.rep.r) : '') || '六边形网格') + '</b>' +
      '<div><span class="tip-k">本格客户</span> <span class="tip-n">' + hc.n.toLocaleString() + '</span></div>' +
      '<div><span class="tip-k">本格地点</span> <span class="tip-n">' + hc.pts + '</span></div>' +
      '<div class="tip-k">H3 六边形 · 层级 ' + (params.h3Res | 0) + '</div>';
  }
  if (p.kind === 'cell') {
    var c = p.cell;
    return '<b>' + esc((c.rep && c.rep.r ? shortLabel(c.rep.r) : '') || '网格') + '</b>' +
      '<div><span class="tip-k">本格客户</span> <span class="tip-n">' + c.n.toLocaleString() + '</span></div>' +
      '<div><span class="tip-k">本格地点</span> <span class="tip-n">' + c.pts + '</span></div>' +
      '<div class="tip-k">点一下放大这一格</div>';
  }
  var r = p.item.r;
  var cnt = r.count > 1 ? r.count : 1;
  return '<b>' + esc(shortLabel(r) || rowLabel(r)) + '</b>' +
    '<div class="tip-k">' + esc(rowLabel(r)) + '</div>' +
    '<div><span class="tip-k">客户</span> <span class="tip-n">' + cnt.toLocaleString() + '</span>' +
    (r.plat ? '　<span class="tip-k">平台</span> ' + esc(r.plat) : '') + '</div>' +
    '<div><span class="tip-k">精度</span> ' + esc((QUALITY_META[r.quality] || QUALITY_META.unknown).label) +
    (r.distKm != null ? '　<span class="tip-k">距常驻</span> ' + r.distKm.toFixed(1) + 'km' : '') + '</div>';
}

function showTip(p, mx, my) {
  var el = $('maptip');
  if (!el) { return; }
  var key = p.kind + Math.round(p.x) + ',' + Math.round(p.y);
  if (el.getAttribute('data-k') !== key) { el.innerHTML = tipHtml(p); el.setAttribute('data-k', key); }
  el.hidden = false;
  placeTip(el, mx, my);
}
function placeTip(el, mx, my) {
  var wrap = $('view-map');
  var vw = wrap.clientWidth, vh = wrap.clientHeight;
  var W = el.offsetWidth, H = el.offsetHeight;
  var x = mx + 16, y = my + 16;
  if (x + W > vw - 8) { x = Math.max(8, mx - W - 16); }
  if (y + H > vh - 8) { y = Math.max(8, my - H - 16); }
  el.style.left = x + 'px';
  el.style.top = y + 'px';
}
function hideTip() {
  var el = $('maptip');
  if (el) { el.hidden = true; el.setAttribute('data-k', ''); }
}



/* ---------- 图例（参考 kepler.gl 的 legend） ---------- */
function renderLegend() {
  var box = $('maplegend');
  if (!box) { return; }
  if (!params.showLegend || !state.rows.length) { box.hidden = true; return; }
  var items = state.layerItems || [];
  var body = '';
  var title = '图例';
  if (params.mode === 'heat') {
    var ramp = HEAT_RAMPS[params.heatRamp] || HEAT_RAMPS.classic;
    title = '热力强度';
    body = rampBar(ramp, '少', '多') + '<div class="ml-note">颜色越暖客户越集中</div>' +
      baseLegendRows();
  } else if (params.mode === 'region') {
    title = '分层着色 · 按' + REGION_FILES[regionLevelNow()].label;
    body = regionLegend() + baseLegendRows();
  } else if (params.mode === 'hex') {
    title = '六边形聚合';
    body = rampBar(GRID_RAMP, '少', '多') +
      '<div class="ml-note">H3 六边形（层级 ' + (params.h3Res | 0) + '）' + (params.extrude ? ' · 3D 柱状，柱高=客户数' : '') + '，格子里是客户数</div>' + baseLegendRows();
  } else if (params.mode === 'cluster') {
    title = '点聚合';
    var ci = state.clusterStats;
    body = rampBar(GRID_RAMP, '少', '多') +
      '<div class="ml-note">气泡里是客户数，点一下放大展开' +
      (ci ? '（当前 ' + ci.bubbles + ' 个气泡 / ' + ci.singles + ' 个独立点）' : '') + '</div>' + baseLegendRows();
  } else if (params.mode === 'grid' || (state.layerStats && state.layerStats.grid)) {
    title = '网格聚合';
    var gt = state.layerStats && state.layerStats.auto ? '点太多，已自动切成网格' : (params.extrude ? '地理网格 · 3D 柱状' : '每格 = 一个屏幕方格');
    body = rampBar(GRID_RAMP, '少', '多') +
      '<div class="ml-note">' + gt + '，格子里是客户数</div>' + baseLegendRows();
  } else {
    title = params.color === 'city' ? '按城市着色' : (params.color === 'none' ? '单色' : '按解析精度');
    if (params.color === 'none') {
      body = '<div class="ml-row"><i style="background:#2f6fed"></i><span>客户点</span></div>';
    } else if (params.color === 'city') {
      body = cityLegendItems(items);
    } else {
      body = qualityLegendItems(items);
    }
    body += baseLegendRows();
  }
  setTxt('ml-title', title);
  var bodyEl = $('ml-body');
  if (bodyEl) { bodyEl.innerHTML = body; }
  box.hidden = false;
}
function rampBar(ramp, lo, hi) {
  var stops = [];
  for (var i = 0; i <= 4; i++) {
    var c = rampColor(ramp, i / 4);
    stops.push('rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ') ' + (i * 25) + '%');
  }
  return '<div class="ml-ramp" style="background:linear-gradient(90deg,' + stops.join(',') + ')"></div>' +
    '<div class="ml-scale"><span>' + lo + '</span><span>' + hi + '</span></div>';
}
function qualityLegendItems(items) {
  var cnt = {}, order = ['custom', 'town', 'district', 'city', 'province', 'unknown'];
  for (var i = 0; i < items.length; i++) {
    var q = items[i].r.quality || 'unknown';
    cnt[q] = (cnt[q] || 0) + 1;
  }
  var out = '';
  order.forEach(function (q) {
    if (!cnt[q]) { return; }
    var meta = QUALITY_META[q] || QUALITY_META.unknown;
    out += '<div class="ml-row"><i class="' + (meta.shape === 'ring' ? 'ring' : '') + '" style="background:' + meta.color +
      ';color:' + meta.color + '"></i><span>' + esc(meta.label) + '</span><b>' + cnt[q].toLocaleString() + '</b></div>';
  });
  return out;
}
function cityLegendItems(items) {
  var cnt = new Map();
  for (var i = 0; i < items.length; i++) {
    var r = items[i].r;
    var city = (r.match && r.match.c) || extractCityHint(r.clean) || '其他';
    if (!cnt.has(city)) { cnt.set(city, 0); }
    cnt.set(city, cnt.get(city) + 1);
  }
  var arr = Array.from(cnt.entries()).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 7);
  var out = '';
  arr.forEach(function (kv) {
    var h = 0;
    for (var i2 = 0; i2 < kv[0].length; i2++) { h = (h * 31 + kv[0].charCodeAt(i2)) % 997; }
    out += '<div class="ml-row"><i style="background:' + CITY_PALETTE[h % CITY_PALETTE.length] + '"></i><span>' +
      esc(kv[0]) + '</span><b>' + kv[1].toLocaleString() + '</b></div>';
  });
  if (cnt.size > 7) { out += '<div class="ml-note">另有 ' + (cnt.size - 7) + ' 个城市</div>'; }
  return out;
}
function baseLegendRows() {
  var act = activeBases();
  if (!act.length) { return ''; }
  /* 每个常驻点一行，颜色就是它自己的颜色 —— 改了颜色图例立刻跟着变 */
  return bases.map(function (b, i) {
    if (!b || b.enabled === false || typeof b.lng !== 'number') { return ''; }
    return '<div class="ml-row"><i class="ring" style="color:' + baseColorOf(b, i) + '"></i>' +
      '<span>' + esc(b.name || ('常驻点' + (i + 1))) + '</span><b>常驻</b></div>';
  }).join('');
}

/* ---------- 底图切换 ---------- */
var BASEMAP_NAME = { normal: '标准', satellite: '卫星', boundary: '本地边界', none: '无底图' };

/* 框选模式下把底图画布的手势关掉（松开框选再恢复）。 */
function setMapHitTesting(on) {
  var cv = $('map') && $('map').querySelector('canvas');
  if (cv) { cv.style.pointerEvents = on ? '' : 'none'; }
}
/* ---------- 框选统计 ---------- */
function setBoxMode(on) {
  boxMode = !!on;
  var b = $('btn-box');
  if (b) { b.className = boxMode ? 'toolbtn on' : 'toolbtn'; b.title = boxMode ? '再点一次退出框选' : '框选统计'; }
  var el = $('map');
  if (el) { el.style.cursor = boxMode ? 'crosshair' : ''; }
  /* 框选期间必须把底图的手势关掉：deck 用的是 PointerEvent，
     只在 mousedown 上 stopPropagation 拦不住它，会出现"框在拖、地图也在跟着平移"，
     于是框到的经纬度范围跟画出来的方块对不上。直接把画布设成不接收指针事件最稳。 */
  setMapHitTesting(!boxMode);
  if (!boxMode) {
    boxDrag = null;
    var r = $('boxrect');
    if (r) { r.hidden = true; }
  } else {
    toast('按住鼠标拖出一个方框，统计框内的客户');
  }
}
/* 框选：在地图上按下左键拖动，画一个矩形，统计框里的客户。
   移动和松开都挂在 window 上，鼠标拖出地图边界也能正常收尾。 */
function bindBoxSelect() {
  /* 绑在 #view-map 上，两种引擎通用：deck 模式下 #map 是不接受事件的空占位。
     框选本身只在 boxMode 打开时生效，所以不会影响正常拖动地图。 */
  var host = $('view-map');
  if (!host || host.__box) { return; }
  host.__box = true;
  function boxHost() { return $('map'); }
  host.addEventListener('mousedown', function (ev) {
    if (!boxMode || ev.button !== 0) { return; }
    var t = ev.target;
    // 工具条 / 参数面板 / 时间轴 / 操作条上的操作不算框选
    if (t && t.closest && t.closest('.maptools,.panel,.timeaxis,.boxbar,.maplegend,.mapnav')) { return; }
    var el = boxHost();
    if (!el) { return; }
    var rect = el.getBoundingClientRect();
    boxDrag = { x0: ev.clientX - rect.left, y0: ev.clientY - rect.top,
      x1: ev.clientX - rect.left, y1: ev.clientY - rect.top,
      w: 0, h: 0, W: rect.width, H: rect.height };
    ev.preventDefault();
    ev.stopPropagation();
  }, true);
  window.addEventListener('mousemove', function (ev) {
    if (!boxDrag) { return; }
    var el = boxHost();
    if (!el) { return; }
    var rect = el.getBoundingClientRect();
    boxDrag.x1 = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
    boxDrag.y1 = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
    boxDrag.w = Math.abs(boxDrag.x1 - boxDrag.x0);
    boxDrag.h = Math.abs(boxDrag.y1 - boxDrag.y0);
    var r = ensureOverlayEl('boxrect');
    r.hidden = false;
    r.style.left = Math.min(boxDrag.x0, boxDrag.x1) + 'px';
    r.style.top = Math.min(boxDrag.y0, boxDrag.y1) + 'px';
    r.style.width = boxDrag.w + 'px';
    r.style.height = boxDrag.h + 'px';
    if (ev.preventDefault) { ev.preventDefault(); }
  }, true);
  window.addEventListener('mouseup', function () {
    if (!boxDrag) { return; }
    var d = boxDrag;
    boxDrag = null;
    ensureOverlayEl('boxrect').hidden = true;
    if (d.w < 8 || d.h < 8) { toast('框太小了，拖大一点'); return; }
    finishBoxSelect(d);
  }, true);
}

function finishBoxSelect(d) {
  var P = deckEngine ? deckEngine.projector() : null;
  if (!P) { return; }
  var x1 = Math.min(d.x0, d.x1), x2 = Math.max(d.x0, d.x1);
  var y1 = Math.min(d.y0, d.y1), y2 = Math.max(d.y0, d.y1);
  var b = { x1: P.lngAt(x1), x2: P.lngAt(x2), y1: P.latAt(y2), y2: P.latAt(y1) };
  var items = state.layerItems || [];
  var recs = 0, cust = 0;
  // deck 模式下没有 canvas 拾取列表，直接遍历图层数据判断经纬度是否在框内
  for (var i = 0; i < items.length; i++) {
    var r = items[i].r;
    if (r.lng >= b.x1 && r.lng <= b.x2 && r.lat >= b.y1 && r.lat <= b.y2) {
      recs++;
      cust += (r.count > 1 ? r.count : 1);
    }
  }
  boxSel = { b: b, recs: recs, cust: cust };
  var bar = $('boxbar');
  if (bar) { bar.hidden = false; }
  setTxt('box-text', '框内 ' + recs.toLocaleString() + ' 个地点 · ' + cust.toLocaleString() + ' 客户');
}
function clearBoxSelect() {
  boxSel = null;
  state.boxBounds = null;
  var bar = $('boxbar');
  if (bar) { bar.hidden = true; }
  setBoxMode(false);
  invalidateView(); updateFilterSummary(); rebuildMarkers(); renderList(); updateStats();
}

/* ---------- 工具条动作 ---------- */
function zoomBy(d) {
  var e = deckEngine;
  if (!e) { return; }
  var v = e.getView();
  e.setView({ zoom: Math.max(3, Math.min(19, v.zoom + d)) });
}
function toggleFullscreen() {
  var el = $('view-map');
  if (!el) { return; }
  try {
    if (!document.fullscreenElement) { el.requestFullscreen(); }
    else { document.exitFullscreen(); }
  } catch (e) { toast('这个浏览器不支持全屏'); }
}
/* 导出前的自检：合成图里画上了多少像素（自动化验证用） */
/* 渲染自检：把 deck 画布拷进 2D 画布数像素（自动化验证用） */
function shotStats() {
  var src = deckEngine && deckEngine.raw ? deckEngine.raw.getCanvas() : null;
  if (!src) { return null; }
  var cv = document.createElement('canvas');
  cv.width = src.width; cv.height = src.height;
  var g = cv.getContext('2d');
  g.drawImage(src, 0, 0);
  var d = g.getImageData(0, 0, cv.width, cv.height).data;
  var bg = g.getImageData(0, 0, 1, 1).data;
  var on = 0, tot = 0, colors = {};
  for (var i = 0; i < d.length; i += 4 * 53) {
    tot++;
    if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 14) {
      on++; colors[d[i] + ',' + d[i + 1] + ',' + d[i + 2]] = 1;
    }
  }
  return { w: cv.width, h: cv.height, sampled: tot, painted: on, ratio: +(on / tot).toFixed(3),
    colors: Object.keys(colors).length, urlLength: (deckEngine.toDataURL() || '').length };
}

function saveMapShot() {
  var url = deckEngine ? deckEngine.toDataURL() : null;
  if (!url) { toast('地图还没画好，稍后再试'); return; }
  var a = document.createElement('a');
  a.href = url;
  a.download = '客户分布地图.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast('已保存地图图片');
}

function ensureOverlayEl(id) {
  var el = $(id);
  if (el) { return el; }
  var wrap = $('view-map');
  el = document.createElement('div');
  el.id = id;
  el.className = (id === 'boxrect' ? 'boxrect' : 'pickring');
  el.hidden = true;
  if (wrap) { wrap.appendChild(el); }
  return el;
}

/* 统一入口：按当前显示方式重画主图层 */
function refreshMapLayer() {
  rebuildMarkers();
}

/* ================= 分层着色（choropleth）：按省 / 市 / 区县给区域上色 =================
   参考 Superset、Datawrapper 的分级统计地图做法：
   把客户按行政区汇总，再用一套顺序色阶按数量深浅填充区域。
   边界数据是离线打包的（geo-boundary-*.js），不联网。 */
var REGION_FILES = {
  province: { g: 'CN_BOUNDARY_P', src: 'geo-boundary-p.js', label: '省' },
  city: { g: 'CN_BOUNDARY_C', src: 'geo-boundary-c.js', label: '市' },
  district: { g: 'CN_BOUNDARY_D', src: 'geo-boundary-d.js', label: '区县' }
};
// 顺序色阶（浅蓝→深蓝），无数据用浅灰
var regionPromises = {};
var regionIndexCache = null;
var regionAggCache = null;
var regionPickList = [];
var regionClasses = null;

/* 按需加载某一级的边界包（首次加载后常驻内存） */
function loadRegionData(level) {
  var conf = REGION_FILES[level];
  if (!conf) { return Promise.reject(new Error('未知层级')); }
  if (window[conf.g]) { return Promise.resolve(window[conf.g]); }
  if (regionPromises[level]) { return regionPromises[level]; }
  regionPromises[level] = new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = conf.src + '?v=21';
    s.onload = function () {
      if (window[conf.g]) { resolve(window[conf.g]); }
      else { reject(new Error('边界包内容为空')); }
    };
    s.onerror = function () { reject(new Error('读不到 ' + conf.src)); };
    document.head.appendChild(s);
  });
  return regionPromises[level];
}

/* 从本地地址库建"名字 → 行政区编码"的反查表。
   数据里的区域名都来自这个库，所以这样对齐最稳，不会串到同名区县。 */
function regionIndex() {
  if (regionIndexCache) { return regionIndexCache; }
  var db = window.GEO_DB;
  var out = { byCode: {}, triple: {}, pair: {}, prov: {}, names: {} };
  if (!db || !db.DC) { regionIndexCache = out; return out; }
  for (var code in db.DC) {
    var d = db.D[db.DC[code]];
    if (!d) { continue; }
    var c = db.C[d[0]];
    if (!c) { continue; }
    var pName = db.P[c[0]];
    out.byCode[code] = { p: pName, c: c[1], d: d[1], lng: d[2], lat: d[3] };
    out.names[code.slice(0, 2) + '0000'] = pName;
    out.names[code.slice(0, 4) + '00'] = c[1];
    out.names[code] = d[1];
    var tk = pName + '|' + c[1] + '|' + d[1];
    if (out.triple[tk] === undefined) { out.triple[tk] = code; }
    var pk = pName + '|' + c[1];
    if (out.pair[pk] === undefined) { out.pair[pk] = code.slice(0, 4) + '00'; }
    if (out.prov[pName] === undefined) { out.prov[pName] = code.slice(0, 2) + '0000'; }
  }
  regionIndexCache = out;
  return out;
}

/* 一行数据属于哪个行政区：优先用已解析出的 p/c/d，没有就现跑一次本地解析。
   结果按地址文本缓存，42 万行通常只有几千个不同的地名。 */
var cleanRegionCache = null;
function rowRegion(r) {
  if (!cleanRegionCache) { cleanRegionCache = new Map(); }
  var m = r.match || {};
  var p = m.p, c = m.c, d = m.d;
  if (!p && !c && !d) {
    var key = r.clean || r.raw || '';
    if (!key) { return null; }
    // 后台线程已经算好的直接查表，最快
    var pre = state.nameMap && state.nameMap[key];
    if (pre) { p = pre.p; c = pre.c; d = pre.d; }
    if (!p && !c && !d) {
    var hit = cleanRegionCache.get(key);
    if (hit === undefined) {
      hit = null;
      try {
        var g = window.__cmGeo;
        if (g) {
          var res = g.lookup(key);
          if (res && res.ok && res.match) { hit = res.match; }
        }
      } catch (e) { hit = null; }
      cleanRegionCache.set(key, hit);
    }
    if (!hit) { return null; }
    p = hit.p; c = hit.c; d = hit.d;
    }
  }
  var idx = regionIndex();
  if (d && c) {
    var code = idx.triple[p + '|' + c + '|' + d];
    if (code) { return { code: code, level: 'district', p: p, c: c, d: d }; }
  }
  if (c) {
    var cc = idx.pair[p + '|' + c];
    if (cc) { return { code: cc, level: 'city', p: p, c: c, d: '' }; }
  }
  if (p) {
    var pc = idx.prov[p];
    if (pc) { return { code: pc, level: 'province', p: p, c: '', d: '' }; }
  }
  return null;
}

/* 直辖市（北京/天津/上海/重庆）和港澳台没有"市"这一层，
   它们的区县直接挂在省级下面。不特殊处理的话，
   市级着色会把 110101 归到并不存在的 110100，整片变成灰色。 */
function invalidateRegionAgg() { regionAggCache = null; }

/* 每行属于哪个行政区，只在导入/重新解析后算一次。
   算好后按行号存成数组，切换筛选条件时直接查，不再逐行拼字符串。 */
function ensureRowRegions() {
  if (state.rowRegions && state.rowRegionsFor === state.rows) { return state.rowRegions; }
  var rows = state.rows;
  var arr = new Array(rows.length);
  for (var i = 0; i < rows.length; i++) {
    var reg = rowRegion(rows[i]);
    arr[i] = reg ? { d: reg.code, c: cityKeyOf(reg.code), p: reg.code.slice(0, 2) + '0000' } : null;
  }
  state.rowRegions = arr;
  state.rowRegionsFor = rows;
  return arr;
}
function invalidateRowRegions() { state.rowRegions = null; state.rowRegionsFor = null; invalidateRegionAgg(); }

/* 把当前筛选结果按行政区汇总。省/市/区县三级同时算好，
   这样切换层级不用重新扫一遍数据。 */
function regionAgg() {
  var idx = viewIndices();
  var key = state._vKey || '';
  if (regionAggCache && regionAggCache.key === key) { return regionAggCache; }
  var t0 = performance.now();
  var rowReg = ensureRowRegions();
  var prov = new Map(), city = new Map(), dist = new Map();
  var leaf = new Map(), leafRep = new Map();
  var total = 0, unmatched = 0, rowsUnmatched = 0;
  for (var i = 0; i < idx.length; i++) {
    var ri = idx[i];
    var n = state.rows[ri].count > 1 ? state.rows[ri].count : 1;
    var reg = rowReg[ri];
    if (!reg) { unmatched++; rowsUnmatched += n; continue; }
    total += n;
    var leafCode = reg.d || reg.c || reg.p;
    leaf.set(leafCode, (leaf.get(leafCode) || 0) + n);
    if (!leafRep.has(leafCode)) { leafRep.set(leafCode, ri); }
    if (reg.d) {
      dist.set(reg.d, (dist.get(reg.d) || 0) + n);
      city.set(reg.c, (city.get(reg.c) || 0) + n);
      prov.set(reg.p, (prov.get(reg.p) || 0) + n);
    } else if (reg.c) {
      city.set(reg.c, (city.get(reg.c) || 0) + n);
      prov.set(reg.p, (prov.get(reg.p) || 0) + n);
    } else {
      prov.set(reg.p, (prov.get(reg.p) || 0) + n);
    }
  }
  regionAggCache = {
    key: key, prov: prov, city: city, dist: dist,
    leaf: leaf, leafRep: leafRep,
    total: total, unmatched: unmatched, unmatchedCust: rowsUnmatched,
    ms: Math.round(performance.now() - t0)
  };
  window.__cmRegionAgg = { total: total, unmatched: unmatched, ms: regionAggCache.ms,
    prov: prov.size, city: city.size, dist: dist.size };
  return regionAggCache;
}

/* 分位数分级：把有数据的区域从少到多分 5 档，比等距分级更抗极端值 */
function regionLevelNow() { return params.regionLevel || 'province'; }

/* 这份数据实际能到哪一级：区县码（110101）→ district；市级码（110100）→ city；只有省级 → province。
   和语义层 regionBucket 同一套规则（看编码后两位是不是 00）。 */
var dataLevelCache = null, dataLevelFor = null;
function dataRegionLevel() {
  if (dataLevelFor === state.rowRegions && dataLevelCache) { return dataLevelCache; }
  var arr = ensureRowRegions();
  /* 口径和语义层完全一致（属性层级按行数取多数），不另搞一套 */
  dataLevelCache = regionLevelOfCodes ? regionLevelOfCodes(arr) : 'province';
  dataLevelFor = state.rowRegions;
  return dataLevelCache;
}

/* 命中判断：先用外框筛，再做点在多边形内判断 */
function pickRegionPx(mx, my) {
  var P = state.regionProj;
  if (!P) { return null; }
  return pickRegionLngLat(P.lngAt(mx), P.latAt(my));
}
function pickRegionLngLat(lng, lat) {
  for (var i = 0; i < regionPickList.length; i++) {
    var p = regionPickList[i];
    var bb = p.bb;
    if (lng < bb[0] || lng > bb[2] || lat < bb[1] || lat > bb[3]) { continue; }
    if (pointInRings(lng, lat, p.rings)) { return p; }
  }
  return null;
}

/* 区域悬停卡片 */
function regionTipHtml(p) {
  var agg = regionAgg();
  var m = p.level === 'province' ? agg.prov : (p.level === 'city' ? agg.city : agg.dist);
  var vals = regionClasses && regionClasses.vals ? regionClasses.vals : [];
  var rank = 0;
  if (p.v > 0) { for (var i = vals.length - 1; i >= 0; i--) { if (vals[i] > p.v) { rank++; } } rank++; }
  var share = agg.total ? (p.v / agg.total * 100) : 0;
  return '<b>' + esc(p.name) + '</b>' +
    '<div><span class="tip-k">客户</span> <span class="tip-n">' + p.v.toLocaleString() + '</span>' +
    '　<span class="tip-k">占比</span> <span class="tip-n">' + share.toFixed(1) + '%</span></div>' +
    (rank ? '<div class="tip-k">第 ' + rank + ' / ' + vals.length + ' 名</div>'
          : '<div class="tip-k">当前筛选下这个区域没有客户</div>') +
    '<div class="tip-k">点一下放大，可「只看这个区域」</div>';
}

function showRegionTip(p, mx, my) {
  var el = $('maptip');
  if (!el) { return; }
  var key = 'region:' + p.code;
  if (el.getAttribute('data-k') !== key) {
    el.innerHTML = regionTipHtml(p);
    el.setAttribute('data-k', key);
  }
  el.hidden = false;
  placeTip(el, mx, my);
}

/* 点区域 → 缩放到它 */
function focusRegion(p) {
  var bb = p.bb;
  var cen = p.cen || [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
  var clng = cen[0], clat = cen[1];
  if (!deckEngine) { return; }
  var el = $('map');
  var z = zoomForBounds({ minLng: bb[0], minLat: bb[1], maxLng: bb[2], maxLat: bb[3] },
    el ? el.clientWidth : 1200, el ? el.clientHeight : 800);
  deckEngine.setView({ longitude: clng, latitude: clat, zoom: z });
}

/* 只看某个区域（联动列表和分析页） */
/* 点中一个区域：放大过去，并在底部给出「只看这个区域」的操作条 */
function selectRegion(p) {
  state.pendingRegion = p;
  focusRegion(p);
  var bar = $('regionbar');
  if (bar) { bar.hidden = false; }
  setTxt('region-text', '已选中 ' + p.name + '（' + p.v.toLocaleString() + ' 客户）');
}
function applyRegionFilter() {
  var p = state.pendingRegion;
  if (!p) { return; }
  state.regionFilter = { code: p.code, name: p.name, level: p.level, bb: p.bb, rings: p.rings };
  invalidateView();
  updateFilterSummary(); rebuildMarkers(); renderList(); updateStats(); renderTimeAxis();
  toast('已只看「' + p.name + '」');
}
function clearRegionFilter() {
  state.regionFilter = null;
  state.pendingRegion = null;
  var bar = $('regionbar');
  if (bar) { bar.hidden = true; }
  invalidateView();
  updateFilterSummary(); rebuildMarkers(); renderList(); updateStats(); renderTimeAxis();
}

/* 分层着色的图例：5 档色阶 + 无数据 */
function regionLegend() {
  var level = regionLevelNow();
  var agg = regionAgg();
  var m = level === 'province' ? agg.prov : (level === 'city' ? agg.city : agg.dist);
  var cls = regionClasses || regionBreaks(m);
  var labels = nameForRegion;
  var out = '';
  var ramp = regionRamp(params.regionRamp);   // 图例和地图必须用同一套配色
  for (var k = 4; k >= 0; k--) {
    var c = ramp[k];
    var lo = k === 0 ? 1 : cls.breaks[k - 1] + 1;
    var hi = k === 4 ? cls.max : cls.breaks[k];
    if (!cls.max) { break; }
    out += '<div class="ml-row"><i style="background:rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')"></i>' +
      '<span>' + shortNum(lo) + (hi > lo ? ' – ' + shortNum(hi) : '') + '</span></div>';
  }
  out += '<div class="ml-row"><i style="background:rgba(128,128,128,.22)"></i><span>没有客户</span></div>';
  var label = REGION_FILES[level].label;
  out += '<div class="ml-note">按客户数分 5 档（分位数），共 ' + m.size.toLocaleString() + ' 个' + label + '有数据</div>';
  /* 换层级时最容易懵的就是"整张图都是灰的"：那份数据根本到不了这一级，直接说明白 */
  var dLevel = dataRegionLevel();
  if (dLevel !== level) {
    var dLabel = REGION_FILES[dLevel].label;
    out += '<div class="ml-note">这份数据只到' + dLabel + '级：当前按' + label +
      '看的时候，没有' + dLabel + '数据的区域是灰的，切到「' + dLabel + '」就有颜色</div>';
  }
  if (agg.unmatched) {
    out += '<div class="ml-note">' + agg.unmatched.toLocaleString() + ' 行地址没能对上行政区，未计入</div>';
  }
  return out;
}
function nameForRegion(code) { return code; }
  return {
    /* 引擎与地图 */
    getEngine: function () { return deckEngine; },
    /* 框选状态：外面（工具条 / 调试接口）要读，但它是模块内部的几个变量 */
    getBoxState: function () { return { mode: boxMode, dragging: !!boxDrag, sel: boxSel }; },
    setBoxSel: function (v) { boxSel = v; },
    /* 换底图 / 换数据后要让边界和区域缓存失效 */
    invalidateDeckBoundary: function () { deckBoundaryCache = { src: null, geojson: null }; },
    invalidateDeckRegion: function () { deckRegionCache = { key: null, geojson: null, cls: null, list: null, ms: 0 }; },
    clearRegionPickList: function () { regionPickList = []; },
    getRegionPickList: function () { return regionPickList; },
    BASEMAP_NAME: BASEMAP_NAME,
    /* 常驻地址的数组 / 脏标记 / 点选状态都在模块里，外面要改就走这三个口子 */
    getBases: function () { return bases; },
    addBase: function () {
      bases.push({ name: '常驻点' + (bases.length + 1), address: '', lng: null, lat: null, enabled: true,
        color: nextBaseColor() });
      basesDirty = true; flushBases(); renderBases();
      var inputs = $('baselist').querySelectorAll('.base-addr');
      if (inputs.length) { inputs[inputs.length - 1].focus(); }
    },
    beginBasePick: function () {
      if (basePick >= 0) { basePick = -1; document.body.style.cursor = ''; toast('已取消点选'); return true; }
      return false;
    },
    bindBoxSelect: bindBoxSelect,
    ensureOverlayEl: ensureOverlayEl,
    loadDeckGL: loadDeckGL,
    renderDeckMap: renderDeckMap,
    rebuildMarkers: rebuildMarkers,
    refreshMapLayer: refreshMapLayer,
    destroyDeckEngine: destroyDeckEngine,
    fitView: fitView,
    renderLegend: renderLegend,
    tipHtml: tipHtml,
    showTip: showTip,
    hideTip: hideTip,
    setBoxMode: setBoxMode,
    clearBoxSelect: clearBoxSelect,
    zoomBy: zoomBy,
    toggleFullscreen: toggleFullscreen,
    shotStats: shotStats,
    saveMapShot: saveMapShot,
    applyManualPick: applyManualPick,
    hasCoord: hasCoord,
    visibleRows: visibleRows,
    activeQuality: activeQuality,
    markerColor: markerColor,
    shortLabel: shortLabel,
    /* 常驻地址 / 辐射范围 */
    activeBases: activeBases,
    renderBases: renderBases,
    locateBase: locateBase,
    startBasePick: startBasePick,
    refreshRadius: refreshRadius,
    updateBaseStat: updateBaseStat,
    computeDistances: computeDistances,
    withinRadius: withinRadius,
    computeMaxCount: computeMaxCount,
    sizeFor: sizeFor,
    baseLegendRows: baseLegendRows,
    baseColorOf: baseColorOf,
    bottomInset: bottomInset,
    /* 行政区索引与聚合 */
    loadRegionData: loadRegionData,
    regionIndex: regionIndex,
    regionAgg: regionAgg,
    regionLevelNow: regionLevelNow,
    ensureRowRegions: ensureRowRegions,
    invalidateRowRegions: invalidateRowRegions,
    invalidateRegionAgg: invalidateRegionAgg,
    rowRegion: rowRegion,
    pickRegionPx: pickRegionPx,
    pickRegionLngLat: pickRegionLngLat,
    regionTipHtml: regionTipHtml,
    showRegionTip: showRegionTip,
    focusRegion: focusRegion,
    selectRegion: selectRegion,
    applyRegionFilter: applyRegionFilter,
    clearRegionFilter: clearRegionFilter,
    regionLegend: regionLegend,
    nameForRegion: nameForRegion,
    deckBoundaryGeo: deckBoundaryGeo,
    deckRegionBuild: deckRegionBuild,
    deckRegionColorOf: deckRegionColorOf,
    deckRegionFindByCode: deckRegionFindByCode
  };
}
