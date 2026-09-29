/* 客户地址地图 —— 应用主入口
 * 数据流向：导入 → 清洗 → 本地解析(不联网) → 地图展示 → 分析 → 导出
 *
 * 一期工程化：纯函数（格式化 / 配色分级 / 图表渲染 / 地理小工具）已经抽到 core/ 下，
 * 可以单独跑单元测试；这里保留应用编排（状态、DOM、地图、交互）。
 */
import { esc, shortNum, fmtDate, fmtMonth, fmtYearMonth, toDateStr } from './core/format.js';
import { HEAT_RAMPS, GRID_RAMP, REGION_RAMPS, REGION_RAMP, rampColor, regionBreaks, regionColor, regionRamp } from './core/palette.js';
import { chartTable, chartSwitch } from './core/chart-core.js';
import { createAnalysisView } from './analysis/view.js';
import { createMapView } from './map/map-view.js';
import { pointInRings, monthStartMs, monthEndMs, cityKeyOf } from './core/geo-core.js';
import * as Engine from './data/engine.js';
import { latLngToCell, cellToBoundary, cellToLatLng, getHexagonEdgeLengthAvg, greatCircleDistance } from 'h3-js';
import { mountKpi, mountTrend, mountChart, reproWipe } from './ui/island.jsx';
import { mountGrid, gridSelectRow } from './ui/grid.jsx';
import { createDataTable } from './data-table.js';
import { createImportFlow } from './import-flow.js';
import { createFilters } from './filters.js';
import { createConfig } from './config.js';
import { mountMatrix } from './ui/matrix.jsx';
import { mountViews } from './ui/views.jsx';
import { createDeckEngine, boundariesToGeoJSON, isDeckReady, zoomForBounds, clusterExpansionZoom } from './map/deck-engine.js';
import * as ImportParse from './data/import-parse.js';
import { buildRowsCsv, buildPlacesCsv } from './data/csv-export.js';
import * as AnalysisModel from './analysis/model.js';
import { downloadText, todayStamp } from './ui/download.js';

  var Clean = window.AddressClean;
  var LS = {
    cache: 'cm.cache',
    params: 'cm.params',
    places: 'cm.places',
    bases: 'cm.bases'
  };

  var state = {
    rows: [],
    filter: 'all',
    q: '',
    activeIdx: -1,
    running: false,
    stopFlag: false,
    view: null,        // 地图可视区域内的行下标
    manualPick: -1,
    sort: 'default',
    timeFrom: null, timeTo: null, platSet: null, range: 'all', platAll: true, timeCol: '', platList: null,
    lastEncoding: '', importWarn: '', codeMode: false, importAbort: false, loadingHidden: false, topN: 20, measure: 'cust'
  };

  var params = {
    size: 14,
    alpha: 85,
    label: false,
    lod: true, lodMax: 9000,
    color: 'quality',
    levels: { custom: true, town: true, district: true, city: true, province: true },
    radiusKm: 5, rings: 3, ringLabel: true, customerRings: false, showLines: true, linkStyle: 'arc', onlyWithin: false,
    sizeByCount: true, onlyCount: false,
    extrudeScale: 30, lightAmb: 0.75, linkMax: 1500,
    mode: 'point', heatRadius: 28, heatIntensity: 1, heatRamp: 'classic', heatTopN: 30,
    gridSize: 46, basemap: 'normal', showLegend: true, showRings: true, regionLevel: 'province',
    regionRamp: 'blue',
    h3Res: 5,        // H3 六边形层级：数字越大格子越小（4≈1,770km²，6≈36km²，8≈0.7km²）
    showBases: true, layerPoints: true, glow: true
  };

  var QUALITY_META = {
    custom: { label: '\u5df2\u77e5\u4f4d\u7f6e', color: '#1a9c63', shape: 'circle', order: 0 },
    town: { label: '\u4e61\u9547\u8857\u9053\u7ea7', color: '#2f6fed', shape: 'circle', order: 1 },
    district: { label: '\u533a\u53bf\u7ea7', color: '#f59e0b', shape: 'ring', order: 2 },
    city: { label: '\u5e02\u7ea7', color: '#94a3b8', shape: 'ring', order: 3 },
    province: { label: '\u7701\u7ea7', color: '#cbd5e1', shape: 'ring', order: 4 },
    unknown: { label: '\u672a\u77e5', color: '#9aa3af', shape: 'circle', order: 9 }
  };

  var CITY_PALETTE = ['#2f6fed', '#8b5cf6', '#0ea5e9', '#f59e0b', '#10b981',
    '#ef4444', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];
  var BASE_COLORS = ['#e11d48', '#7c3aed', '#0891b2', '#ea580c', '#16a34a', '#db2777'];

  /* ---------------- 小工具 ---------------- */
  /** @returns {any} */
  function $(id) { return document.getElementById(id); }
  function mark(n) { if (window.__phases) { window.__phases.push([n, Math.round(performance.now())]); } }
  function on(id, ev, fn) { var el = $(id); if (el) { el.addEventListener(ev, fn); } }
  function getVal(id, d) { var el = $(id); return el ? el.value : d; }
  function getChk(id, d) { var el = $(id); return el ? !!el.checked : d; }
  function setVal(id, v) { var el = $(id); if (el) { el.value = v; } }
  function setChk(id, v) { var el = $(id); if (el) { el.checked = !!v; } }
  function setTxt(id, v) { var el = $(id); if (el) { el.textContent = v; } }
  function sleep(ms) { return new Promise(function (/** @type {any} */ r) { setTimeout(r, ms); }); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsJson(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }

  var toastTimer = null;
  function toast(msg, ms) {
    var el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, ms || 2600);
  }

  /* ---------------- 解析缓存 ---------------- */
  var cache = lsJson(LS.cache, {});
  var cacheDirty = false;
  // 用计数器代替 Object.keys(cache).length —— 后者每写一条都要生成一个大数组，
  // 几十万条时会把解析速度拖慢十倍以上
  var cacheCount = 0;
  try { for (var _ck in cache) { if (Object.prototype.hasOwnProperty.call(cache, _ck)) { cacheCount++; } } } catch (e) { cacheCount = 0; }
  var CACHE_MAX = 200000;
  function cacheKey(clean) { return clean; }
  function cacheGet(clean) { return cache[cacheKey(clean)] || null; }
  function cacheSet(clean, val) {
    var k = cacheKey(clean);
    if (cache[k] === undefined) { cacheCount++; }
    cache[k] = val;
    cacheDirty = true;
    if (cacheCount > CACHE_MAX) { cache = {}; cache[k] = val; cacheCount = 1; }
  }
  function cacheFlush() {
    if (cacheDirty) { lsSet(LS.cache, JSON.stringify(cache)); cacheDirty = false; }
  }
  setInterval(cacheFlush, 3000);

  /* ---------------- 本地解析引擎 ---------------- */
  var EMPTY_ARR = ImportParse.EMPTY_ARR;
  var localGeo = null;

  /* ================= 后台解析线程（一期工程化） =================
     导入完成后，把数据里所有不重复的地名丢给 Worker 先算一遍，
     结果存成"地名 → 行政区"的表。之后不管是筛选还是分层着色，
     都直接查表，主线程不再逐条跑地名匹配。
     file:// 下浏览器不允许创建 Worker，会自动退回原来的主线程路径。 */
  var geoWorker = null, geoWorkerOff = false;
  function startGeoWorker() {
    if (geoWorker || geoWorkerOff) { return geoWorker; }
    if (location.protocol === 'file:') { geoWorkerOff = true; return null; }
    try {
      geoWorker = new Worker('geocode-worker.js');
      geoWorker.onerror = function () { geoWorkerOff = true; geoWorker = null; };
    } catch (e) {
      geoWorkerOff = true;
      geoWorker = null;
    }
    return geoWorker;
  }
  /* 从本地缓存恢复上次的数据集（省掉重新选文件 + 重新解析） */
  async function restoreFromCache() {
    if (location.protocol === 'file:') { return false; }
    var rec = await Engine.loadCache();
    if (!rec || !rec.bytes || !rec.meta) { return false; }
    var db = await Engine.initEngine();
    if (!db) { return false; }
    showLoading('正在恢复上次的数据…');
    try {
      await Engine.fromParquet(rec.bytes, 'rows');
      /* 恢复要带上分析需要的列。
         以前这里只取 8 列，shop / amount 没取 —— 于是恢复之后
         「店铺分布」是空的、「成交金额」是 0，而且没有任何提示。
         加列的时候记得同步这里（这是第二次因为漏列而丢数据了）。 */
      var rs = await Engine.query('SELECT idx, cnt, t, plat, lng, lat, adcode, clean, amount, shop FROM rows ORDER BY idx');
      if (!rs || !rs.length) { hideLoading(); return false; }
      var rows = rs.map(function (x) {
        var has = x.lng != null && x.lat != null && isFinite(x.lng) && isFinite(x.lat);
        return {
          raw: x.clean, clean: x.clean, id: '', phones: [], flags: [],
          preQuality: 'district', quality: x.adcode ? 'district' : 'unknown', match: null,
          count: Number(x.cnt) > 1 ? Number(x.cnt) : 0,
          t: x.t == null ? null : Number(x.t), plat: x.plat || '',
          shop: x.shop || '', code: '', amount: Number(x.amount) || 0,
          lng: has ? Number(x.lng) : null, lat: has ? Number(x.lat) : null,
          status: has ? 'ok' : 'todo', acode: x.adcode || '', distKm: null, baseIdx: -1
        };
      });
      applyDataset(rows, { restored: true });
      state.engineOn = true;
      setEngineBadge('on');
      toast('已恢复上次导入的数据：' + rows.length.toLocaleString() + ' 条（来自本地 Parquet 缓存）', 5000);
      return true;
    } catch (e) {
      hideLoading();
      state.restoreError = (e && e.message) || String(e);
      setEngineBadge('off', '恢复上次数据失败：' + state.restoreError);
      return false;
    }
  }

  /* 导入和恢复共用这一段：把 rows 变成可用的界面状态 */
  function applyDataset(rows, opts) {
    var stat = { ok: 0, cust: 0, hasCount: false };
    var platMap = new Map(), timeHist = new Map();
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.status === 'ok') { stat.ok++; }
      if (row.count > 1) { stat.cust += row.count; stat.hasCount = true; }
      var pk = row.plat || '（未知平台）';
      platMap.set(pk, (platMap.get(pk) || 0) + 1);
      if (row.t != null) {
        var d = new Date(row.t);
        var mk = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        timeHist.set(mk, (timeHist.get(mk) || 0) + (row.count > 1 ? row.count : 1));
      }
    }
    state.rows = rows;
    state._distTouched = false;
    invalidateView();
    state.stat = { total: rows.length, ok: stat.ok, cust: stat.cust, hasCount: stat.hasCount };
    state.platList = Array.from(platMap.entries()).sort(function (a, b) { return b[1] - a[1]; });
    state.timeHist = timeHist;
    setTimeout(renderTimeAxis, 50);
    state.activeIdx = -1;
    buildPlatformOptions();
    updateFilterSummary();
    updateStats();
    renderList();
    warmNameMap(rows);
    hideLoading();
    if (!opts || !opts.restored) { startEngine(rows); }
    if (state.rows.length) {
      fitView();
      rebuildMarkers();
    }
  }

  /* 二期：数据装进 DuckDB（http 下可用），并把 Parquet 缓存到 IndexedDB。
     失败不影响使用，只是退回内置的 JS 计算路径。 */
  function startEngine(rows) {
    setEngineBadge('loading');
    Engine.initEngine().then(function (db) {
      if (!db) { setEngineBadge('off', Engine.engineStatus().error); return; }
      return Engine.ingest(rows, ensureRowRegions()).then(function (n) {
        setEngineBadge('on');
        state.engineOn = true;
        state.engineRows = n;
        if (currentView === 'analysis') { renderAnalysis({ force: true }); }
        /* 导出加超时重试：不给超时的话它可能永远不 settle（既不成功也不失败），
           后续代码永远不执行，缓存就静默地一直是空的。 */
        return Engine.toParquetStable('rows').then(function (bytes) {
          if (!bytes) {
            state.cacheError = '缓存没写成：导出 Parquet 连续失败（下次打开会需要重新导入）';
            setEngineBadge('on', state.cacheError);
            return;
          }
          return Engine.saveCache(bytes, { rows: rows.length, at: Date.now() }).then(function (ok) {
            if (ok) { state.cacheBytes = bytes.byteLength; state.cacheError = ''; }
            else { state.cacheError = '缓存没写成：IndexedDB 拒绝了这次写入'; setEngineBadge('on', state.cacheError); }
          });
        });
      });
    }).catch(function (e) {
      setEngineBadge('off', (e && e.message) || String(e));
    });
  }
  function setEngineBadge(kind, msg) {
    var el = $('engine-badge');
    if (!el) { return; }
    if (kind === 'loading') { el.hidden = false; el.className = 'engine-badge loading'; el.textContent = 'SQL 引擎启动中…'; return; }
    if (kind === 'on') {
      el.hidden = false;
      el.className = msg ? 'engine-badge warn' : 'engine-badge on';
      el.textContent = msg ? 'SQL 引擎已就绪（有提示）' : 'SQL 引擎已就绪';
      el.title = msg || '';   // 鼠标停上去能看到具体是什么提示
      return;
    }
    el.className = 'engine-badge off';
    el.textContent = '内置计算模式';
    el.title = msg || '';
  }

  function warmNameMap(rows) {
    var w = startGeoWorker();
    if (!w || !rows.length) { return; }
    var seen = {};
    var list = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.match && (r.match.p || r.match.c || r.match.d)) { continue; }
      var k = r.clean || r.raw || '';
      if (!k || seen[k]) { continue; }
      seen[k] = 1;
      list.push(k);
      if (list.length >= 20000) { break; }   // 兜底，正常几千条
    }
    if (!list.length) { return; }
    var t0 = performance.now();
    w.onmessage = function (e) {
      var msg = e.data || {};
      if (msg.type === 'done') {
        state.nameMap = msg.map || {};
        invalidateRowRegions();
        state.nameMapMs = Math.round(performance.now() - t0);
        window.__cmNameMap = { names: list.length, mapped: Object.keys(state.nameMap).length, ms: state.nameMapMs };
      }
    };
    w.postMessage({ type: 'parse', list: list });
  }
  var places = lsJson(LS.places, []);
  var placesDirty = false;

  function initLocalGeo() {
    if (localGeo) { return localGeo; }
    if (!window.GEO_DB) { throw new Error('\u672c\u5730\u5730\u5740\u5e93 geo-data.js \u672a\u52a0\u8f7d'); }
    if (!window.LocalGeocode) { throw new Error('\u89e3\u6790\u5f15\u64ce local-geocode.js \u672a\u52a0\u8f7d'); }
    localGeo = window.LocalGeocode.createGeocoder(window.GEO_DB);
    window.__cmGeo = localGeo;
    localGeo.setCustom(places);
    return localGeo;
  }
  function refreshPlaces() {
    if (localGeo) { localGeo.setCustom(places); }
    placesDirty = true;
    var el = $('dict-count');
    if (el) { el.textContent = places.length + ' \u6761'; }
  }
  function addPlace(name, lng, lat) {
    name = String(name || '').trim();
    if (!name || !isFinite(lng) || !isFinite(lat)) { return false; }
    for (var i = 0; i < places.length; i++) { if (places[i].name === name) { return false; } }
    places.push({ name: name, lng: lng, lat: lat });
    refreshPlaces();
    return true;
  }
  function flushPlaces() { if (placesDirty) { lsSet(LS.places, JSON.stringify(places)); placesDirty = false; } }
  setInterval(flushPlaces, 3000);

  /* \u628a\u5730\u5740\u91cc\u7684\u884c\u653f\u533a\u5212\u90e8\u5206\u53bb\u6389\uff0c\u5269\u4e0b\u7684\u5f53\u4f5c\u5730\u70b9\u540d\u5efa\u8bae */
  function suggestPlaceName(row) {
    var s = String(row.clean || '');
    var m = row.match || {};
    [m.p, m.c, m.d, m.t].forEach(function (part) {
      if (!part) { return; }
      s = s.split(part).join('');
      var short = part.replace(/(\u7701|\u5e02|\u533a|\u53bf|\u65d7|\u8857\u9053|\u9547|\u4e61|\u81ea\u6cbb\u5dde|\u5730\u533a|\u76df|\u81ea\u6cbb\u53bf|\u7279\u522b\u884c\u653f\u533a|\u65b0\u533a)$/, '');
      if (short.length >= 2) { s = s.split(short).join(''); }
    });
    s = s.replace(/[0-9#\-\u53f7\u680b\u5e62\u5355\u5143\u5ba4\u697c\u5ea7\u6392\u5df7\u7ec4\u56e2\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u4e00]/g, '');
    s = s.replace(/[()\uff08\uff09]/g, '').trim();
    if (s.length > 14) { s = s.slice(0, 14); }
    return s || String(row.clean || '').slice(0, 12);
  }

  /* ---------------- \u767e\u5ea6\u5730\u56fe\u811a\u672c ---------------- */

  function geocodeOne(row) {
    return new Promise(function (/** @type {any} */ resolve, /** @type {any} */ reject) {
      var geo = initLocalGeo();
      var r = null;
      /* 只有行政区划编码的行（订单表里常见）先按编码查，和批量解析走同一条路 */
      if (row.acode || row.ccode || row.pcode) {
        var byCode = geo.lookupByCode(row.pcode, row.ccode, row.acode);
        if (byCode && byCode.ok) { byCode.source = 'code'; r = byCode; }
      }
      if (!r) { r = geo.lookup(row.clean); }
      if (!r.ok) { return reject(new Error(r.reason || '\u672a\u80fd\u5339\u914d\u5230\u5730\u540d')); }
      resolve({
        lng: r.lng, lat: r.lat,
        quality: r.quality,
        level: r.reason,
        match: r.match || null,
        source: r.source || 'local'
      });
    });
  }

  function extractCityHint(clean) {
    var m = clean.match(/^(.{2,10}?(?:\u5e02|\u81ea\u6cbb\u5dde|\u5730\u533a|\u76df))/);
    if (m) { return m[1]; }
    var d = clean.match(/^(北京|\u4e0a\u6d77|\u5929\u6d25|\u91cd\u5e86)/);
    if (d) { return d[1]; }
    return '';
  }

  /* 常驻地址与地图已经搬到 src/map/map-view.js。
     引擎由模块持有，外面一律用 getEngine() 现取 —— 换数据 / 换底图会重建引擎，
     缓存一份引用就会指着已经销毁的那个（这条踩过）。 */
  var MapView = createMapView({
    state: state, params: params, LS: LS, $: $, esc: esc, mark: mark, toast: toast,
    setTxt: setTxt, setVal: setVal, lsSet: lsSet, lsJson: lsJson,
    shortNum: shortNum, fmtMonth: fmtMonth, fmtDate: fmtDate, toDateStr: toDateStr,
    pointInRings: pointInRings, cityKeyOf: cityKeyOf,
    monthStartMs: monthStartMs, monthEndMs: monthEndMs,
    HEAT_RAMPS: HEAT_RAMPS, GRID_RAMP: GRID_RAMP,
    REGION_RAMPS: REGION_RAMPS, regionRamp: regionRamp,
    rampColor: rampColor, regionBreaks: regionBreaks, regionColor: regionColor,
    QUALITY_META: QUALITY_META, BASE_COLORS: BASE_COLORS, CITY_PALETTE: CITY_PALETTE,
    regionLevelOfCodes: AnalysisModel.regionLevelOfCodes,
    greatCircleDistance: greatCircleDistance, initLocalGeo: initLocalGeo,
    getBases: function () { return MapView.getBases(); },
    extractCityHint: extractCityHint, setMapWarn: setMapWarn,
    EMPTY_ARR: EMPTY_ARR, addPlace: addPlace, suggestPlaceName: suggestPlaceName,
    cacheSet: cacheSet, cacheFlush: cacheFlush,
    downloadText: downloadText, todayStamp: todayStamp,
    latLngToCell: latLngToCell, cellToBoundary: cellToBoundary,
    getHexagonEdgeLengthAvg: getHexagonEdgeLengthAvg,
    DeckEngine: { createDeckEngine: createDeckEngine, boundariesToGeoJSON: boundariesToGeoJSON,
      isDeckReady: isDeckReady, zoomForBounds: zoomForBounds, clusterExpansionZoom: clusterExpansionZoom },
    /* 以下都是后面几块接线时才赋值的 var，包一层延迟取 */
    renderList: function () { renderList(); },
    updateStats: function () { updateStats(); },
    rowLabel: function (r) { return rowLabel(r); },
    selectRow: function (i, fly) { selectRow(i, fly); },
    renderAnalysis: function (o) { renderAnalysis(o); },
    invalidateView: function () { invalidateView(); },
    updateFilterSummary: function () { updateFilterSummary(); },
    renderTimeAxis: function () { renderTimeAxis(); },
    viewIndices: function () { return viewIndices(); },
    rowMatches: function (r, i) { return rowMatches(r, i); },
    buildPlatformOptions: function () { buildPlatformOptions(); },
    syncParamsFromUi: function () { syncParamsFromUi(); }
  });
  /* 接回 main.js：名字和搬家前完全一样，调用点一个都不用改 */
  var hasCoord = MapView.hasCoord;
  var visibleRows = MapView.visibleRows;
  var activeQuality = MapView.activeQuality;
  var markerColor = MapView.markerColor;
  var shortLabel = MapView.shortLabel;
  var rebuildMarkers = MapView.rebuildMarkers;
  var refreshMapLayer = MapView.refreshMapLayer;
  var renderDeckMap = MapView.renderDeckMap;
  var destroyDeckEngine = MapView.destroyDeckEngine;
  var fitView = MapView.fitView;
  var renderLegend = MapView.renderLegend;
  var tipHtml = MapView.tipHtml;
  var hideTip = MapView.hideTip;
  var setBoxMode = MapView.setBoxMode;
  var clearBoxSelect = MapView.clearBoxSelect;
  var zoomBy = MapView.zoomBy;
  var toggleFullscreen = MapView.toggleFullscreen;
  var shotStats = MapView.shotStats;
  var saveMapShot = MapView.saveMapShot;
  var applyManualPick = MapView.applyManualPick;
  var loadRegionData = MapView.loadRegionData;
  var regionIndex = MapView.regionIndex;
  var regionAgg = MapView.regionAgg;
  var regionLevelNow = MapView.regionLevelNow;
  var ensureRowRegions = MapView.ensureRowRegions;
  var invalidateRowRegions = MapView.invalidateRowRegions;
  var invalidateRegionAgg = MapView.invalidateRegionAgg;
  var rowRegion = MapView.rowRegion;
  var pickRegionPx = MapView.pickRegionPx;
  var pickRegionLngLat = MapView.pickRegionLngLat;
  var regionTipHtml = MapView.regionTipHtml;
  var showRegionTip = MapView.showRegionTip;
  var focusRegion = MapView.focusRegion;
  var selectRegion = MapView.selectRegion;
  var applyRegionFilter = MapView.applyRegionFilter;
  var clearRegionFilter = MapView.clearRegionFilter;
  var regionLegend = MapView.regionLegend;
  var nameForRegion = MapView.nameForRegion;
  var deckBoundaryGeo = MapView.deckBoundaryGeo;
  var deckRegionBuild = MapView.deckRegionBuild;
  var activeBases = MapView.activeBases;
  var renderBases = MapView.renderBases;
  var locateBase = MapView.locateBase;
  var startBasePick = MapView.startBasePick;
  var refreshRadius = MapView.refreshRadius;
  var updateBaseStat = MapView.updateBaseStat;
  var computeDistances = MapView.computeDistances;
  var withinRadius = MapView.withinRadius;
  var computeMaxCount = MapView.computeMaxCount;
  var sizeFor = MapView.sizeFor;
  var baseLegendRows = MapView.baseLegendRows;
  var showTip = MapView.showTip;


  /* 筛选与时间轴已经搬到 src/filters.js。
     "哪些行该显示"只有这一处说了算 —— 地图、列表、分析页都从这里拿结果。 */
  var Filters = createFilters({
    state: state, params: params, $: $, esc: esc, mark: mark,
    setTxt: setTxt, setVal: setVal, setChk: setChk,
    fmtDate: fmtDate, toDateStr: toDateStr, lsSet: lsSet, toast: toast,
    withinRadius: withinRadius, ensureRowRegions: ensureRowRegions,
    invalidateRegionAgg: invalidateRegionAgg, pointInRings: pointInRings,
    syncParamsFromUi: function () { syncParamsFromUi(); },
    setBoxMode: function (on) { setBoxMode(on); },
    getBoxSel: function () { return MapView.getBoxState().sel; },
    setBoxSel: function (v) { MapView.setBoxSel(v); },
    /* renderList / updateStats 是后面才赋值的 var，所以这里包一层延迟取 */
    renderList: function () { renderList(); },
    updateStats: function () { updateStats(); },
    rebuildMarkers: rebuildMarkers,
    renderAnalysis: function (o) { renderAnalysis(o); },
    isAnalysisView: function () { return currentView === 'analysis'; },
    monthStartMs: monthStartMs, monthEndMs: monthEndMs
  });
  var rowMatches = Filters.rowMatches;
  var viewKey = Filters.viewKey;
  var viewIndices = Filters.viewIndices;
  var invalidateView = Filters.invalidateView;
  var renderTimeAxis = Filters.renderTimeAxis;
  var bindTimeAxis = Filters.bindTimeAxis;
  var updateFilterSummary = Filters.updateFilterSummary;
  var buildPlatformOptions = Filters.buildPlatformOptions;
  var renderChips = Filters.renderChips;
  var refreshAfterFilter = Filters.refreshAfterFilter;
  var removeChip = Filters.removeChip;
  var clearAllChips = Filters.clearAllChips;
  var applyTimeSelection = Filters.applyTimeSelection;
  var applyRange = Filters.applyRange;

  /* 分析视图（图表样式 / 钻取 / 问答 / 矩阵）已经搬到 src/analysis/view.js。
     这里只做接线：把 main.js 的能力作为 ctx 传进去，再把模块对外的函数接回来。 */
  var AnalysisView = createAnalysisView({
    state: state, params: params,
    $: $, esc: esc, fmtMonth: fmtMonth, fmtDate: fmtDate, fmtYearMonth: fmtYearMonth, shortNum: shortNum, toDateStr: toDateStr,
    lsSet: lsSet, lsJson: lsJson, setVal: setVal, setTxt: setTxt,
    Engine: Engine, AnalysisModel: AnalysisModel,
    chartTable: chartTable, chartSwitch: chartSwitch,
    mountKpi: mountKpi, mountTrend: mountTrend, mountChart: mountChart, mountMatrix: mountMatrix,
    regionAgg: regionAgg, regionIndex: regionIndex, ensureRowRegions: ensureRowRegions,
    withinRadius: withinRadius,
    cityKeyOf: cityKeyOf, toast: toast,
    viewKey: viewKey, viewIndices: viewIndices, invalidateView: invalidateView,
    updateFilterSummary: updateFilterSummary, renderTimeAxis: renderTimeAxis,
    /* renderList / selectRow 是数据表模块接线时赋值的 var（在本文件靠后），
       所以这里包一层延迟取 —— 直接传会在这一行就取到 undefined。 */
    renderList: function () { renderList(); },
    selectRow: function (i, fly) { selectRow(i, fly); },
    rebuildMarkers: rebuildMarkers, buildPlatformOptions: buildPlatformOptions,
    switchView: switchView,
    isAnalysisView: function () { return currentView === 'analysis'; }
  });
  /* main.js 里原来直接调用这些函数，这里接回来，调用点一个都不用改 */
  var renderAnalysis = AnalysisView.renderAnalysis;
  var chartPrefs = AnalysisView.chartPrefs;
  var measureKey = AnalysisView.measureKey;
  var answerQuestion = AnalysisView.answerQuestion;
  var anaAuto = AnalysisView.anaAuto;
  var setAnaStatus = AnalysisView.setAnaStatus;


  /* 数据表与列表已经搬到 src/data-table.js。里面那条"不能清空 #list 的 innerHTML"
     的硬规矩也一起搬过去了（ag-grid 由 React 管，清空会让它的 fiber 树和真实 DOM 脱节）。 */
  var DataTable = createDataTable({
    state: state, params: params, $: $, mark: mark, fmtDate: fmtDate, setTxt: setTxt,
    QUALITY_META: QUALITY_META, viewIndices: viewIndices, computeDistances: computeDistances,
    hasCoord: hasCoord, getDeckEngine: function () { return MapView.getEngine(); },
    mountGrid: mountGrid, gridSelectRow: gridSelectRow
  });
  var renderList = DataTable.renderList;
  var renderListWindow = DataTable.renderListWindow;
  var selectRow = DataTable.selectRow;
  var updateStats = DataTable.updateStats;
  var rowLabel = DataTable.rowLabel;

  /* 导入流水线 / 详情 / 地点字典搬到 src/import-flow.js。
     同样放在数据表接线之后 —— 它要用 renderList / updateStats / rowLabel。 */
  var ImportFlow = createImportFlow({
    state: state, params: params, $: $, esc: esc, mark: mark, toast: toast,
    Clean: Clean, ImportParse: ImportParse, downloadText: downloadText,
    buildPlacesCsv: buildPlacesCsv, todayStamp: todayStamp,
    hasCoord: hasCoord, rowLabel: rowLabel, QUALITY_META: QUALITY_META,
    getDeckEngine: function () { return MapView.getEngine(); },
    getPlaces: function () { return places; },
    addPlace: addPlace, flushPlaces: flushPlaces, refreshPlaces: refreshPlaces,
    suggestPlaceName: suggestPlaceName,
    invalidateView: invalidateView, renderTimeAxis: renderTimeAxis,
    buildPlatformOptions: buildPlatformOptions, updateFilterSummary: updateFilterSummary,
    updateStats: updateStats, renderList: renderList, rebuildMarkers: rebuildMarkers,
    warmNameMap: warmNameMap, startEngine: startEngine, fitView: fitView,
    setTxt: setTxt,
    EMPTY_ARR: EMPTY_ARR,
    /* 解析缓存是小对象 + 脏标记；这里给三个动作，别让模块自己去碰那对变量 */
    cacheSet: cacheSet, cacheGet: cacheGet, cacheFlush: cacheFlush,
    cacheClear: function (k) { delete cache[k]; cacheDirty = true; },
    initLocalGeo: initLocalGeo,
    invalidateRowRegions: invalidateRowRegions,
    geocodeOne: geocodeOne
  });
  var loadRecords = ImportFlow.loadRecords;
  var readFile = ImportFlow.readFile;
  var previewImport = ImportFlow.previewImport;
  var loadSheetJs = ImportFlow.loadSheetJs;
  var showLoading = ImportFlow.showLoading;
  var setLoading = ImportFlow.setLoading;
  var hideLoading = ImportFlow.hideLoading;
  var abortImport = ImportFlow.abortImport;
  var runGeocode = ImportFlow.runGeocode;
  var updateStatsFast = ImportFlow.updateStatsFast;
  var openDetail = ImportFlow.openDetail;
  var retryOne = ImportFlow.retryOne;
  var startManualPick = ImportFlow.startManualPick;
  var importPlacesFile = ImportFlow.importPlacesFile;
  var exportPlaces = ImportFlow.exportPlaces;
  var saveCurrentPlace = ImportFlow.saveCurrentPlace;
  var DEMO = ImportFlow.DEMO;

  /* 配置 / 嵌入参数 / 我的视图搬到 src/config.js。
     放在数据表接线之后 —— 它要用到 renderList / updateStats 这两个后面才赋值的别名。 */
  var Config = createConfig({
    state: state, params: params, $: $,
    setVal: setVal, setChk: setChk, setTxt: setTxt, lsSet: lsSet, lsJson: lsJson,
    toast: toast, downloadText: downloadText, toDateStr: toDateStr,
    measureKey: measureKey, chartPrefs: chartPrefs, syncParamsFromUi: syncParamsFromUi,
    buildPlatformOptions: buildPlatformOptions, invalidateView: invalidateView,
    updateFilterSummary: updateFilterSummary, renderTimeAxis: renderTimeAxis,
    rebuildMarkers: rebuildMarkers, renderList: renderList, updateStats: updateStats,
    renderAnalysis: renderAnalysis, switchView: switchView, regionIndex: regionIndex,
    mountViews: mountViews, AnalysisModel: AnalysisModel,
    getCurrentView: function () { return currentView; },
    isAnalysisView: function () { return currentView === 'analysis'; }
  });
  var buildConfig = Config.buildConfig;
  var applyConfig = Config.applyConfig;
  var exportConfig = Config.exportConfig;
  var importConfigFile = Config.importConfigFile;
  var applyUrlParams = Config.applyUrlParams;
  var loadViews = Config.loadViews;
  var snapshotNow = Config.snapshotNow;
  var applySnapshot = Config.applySnapshot;
  var renderViews = Config.renderViews;
  var openViews = Config.openViews;
  var addView = Config.addView;
  var removeView = Config.removeView;
  var useView = Config.useView;

  /* ---------------- 配置 ---------------- */
  /* 地图不再需要密钥：底图走高德瓦片，解析走本地地址库 */
  var cfg = {};

  function setMapWarn(msg) {
    var el = $('mapwarn');
    if (!el) { return; }
    if (msg) { el.textContent = msg; el.hidden = false; }
    else { el.hidden = true; el.textContent = ''; }
  }

  function checkWebGL() {
    try {
      var cv = document.createElement('canvas');
      return !!(cv.getContext('webgl') || cv.getContext('experimental-webgl'));
    } catch (e) { return false; }
  }

  function updateDbStats() {
    var el = $('db-stats');
    if (!el) { return; }
    try {
      var s = initLocalGeo().stats();
      el.textContent = '\u5185\u7f6e ' + s.provinces + ' \u4e2a\u7701\u3001' + s.cities + ' \u4e2a\u5e02\u3001' +
        s.districts + ' \u4e2a\u533a\u53bf\u3001' + s.towns + ' \u4e2a\u4e61\u9547\u8857\u9053\uff0c\u7cbe\u5ea6\u5230\u4e61\u9547\u6216\u533a\u53bf\u4e00\u7ea7';
    } catch (e) { el.textContent = e.message; }
  }

  function openSettings() {
    refreshPlaces();
    updateDbStats();
    var d = $('dlg-settings');
    if (!d.open) { d.showModal(); }
  }

  function saveSettings() {
    flushPlaces();
    toast('\u5df2\u4fdd\u5b58\u3002deck.gl \u5f15\u64ce\u4e0d\u9700\u8981\u5bc6\u94a5\u3002');
    rebuildMarkers();
  }

  /* 切到 deck 引擎时，把百度地图整个卸掉：它自己会开一个 WebGL 上下文，
     两个引擎同时跑会白占显存，而且拖动时会互相抢事件 */

  /* ---------------- 导出 ---------------- */
  /* 拼 CSV 文本在 data/csv-export.js（纯函数、有单测），下载样板在 ui/download.js。
     这里只负责把全局状态喂给它们。 */
  function exportCsv() {
    if (!state.rows.length) { return; }
    var text = buildRowsCsv(state.rows, {
      bases: MapView.getBases(),
      hasCoord: hasCoord,
      qualityLabel: function (r) { return r.status === 'ok' ? (QUALITY_META[r.quality] || QUALITY_META.unknown).label : ''; },
      toBd09: function (lng, lat) { return window.LocalGeocode.gcj02ToBd09(lng, lat); },
      statusLabel: function (r) { return r.status === 'ok' ? '已定位' : (r.status === 'failed' ? '失败' : '待解析'); }
    });
    downloadText(text, '客户地址定位_' + todayStamp() + '.csv');
  }

  /* ---------------- 显示样式：按"联动关系"分组 ----------------
     面板分三组：① 画法（它决定下面长出哪些参数）② 该画法的参数 ③ 通用。
     ②里每一行在 dev.html 上用 data-when 标了"哪几档画法下该出现"，
     带 data-need="extrude" 的还要等"3D 柱状"勾上才出现。
     只加/去 class，不删 DOM —— 换画法时用户调过的值不会丢，控件也照旧能取到。 */
  var MODE_META = {
    point:   { name: '标记点',     hint: '每个地点一个圆点' },
    cluster: { name: '点聚合',     hint: '密集的点并成气泡，点一下展开' },
    grid:    { name: '网格聚合',   hint: '按方格统计客户数' },
    hex:     { name: '六边形聚合', hint: '按六边形分箱统计' },
    region:  { name: '分层着色',   hint: '按行政区上色，点一下钻取' },
    heat:    { name: '热力图',     hint: '颜色越暖客户越集中' }
  };

  function applyParamLink() {
    var body = $('parambody');
    if (!body) { return; }
    var meta = MODE_META[params.mode] || MODE_META.point;
    setTxt('mode-hint', meta.hint);
    setTxt('mode-param-name', meta.name);
    var rows = body.querySelectorAll('[data-when]');
    for (var i = 0; i < rows.length; i++) {
      var el = rows[i];
      var when = ' ' + (el.getAttribute('data-when') || '') + ' ';
      var show = when.indexOf(' ' + params.mode + ' ') >= 0;
      if (show && el.getAttribute('data-need') === 'extrude') { show = !!params.extrude; }
      el.classList.toggle('is-off', !show);
    }
  }

  /* ---------------- 参数面板 ---------------- */
  function syncParamsFromUi() {
    params.size = parseInt(getVal('p-size', params.size), 10) || params.size;
    params.alpha = parseInt(getVal('p-alpha', params.alpha), 10) || params.alpha;
    params.label = getChk('p-label', params.label);
    params.lod = getChk('p-lod', params.lod);
    params.extrude = getChk('p-extrude', params.extrude);
    params.gridSize = parseInt(getVal('p-gridsize', params.gridSize), 10) || params.gridSize;
    params.h3Res = parseInt(getVal('p-h3res', params.h3Res), 10) || params.h3Res;
    params.basemap = getVal('p-basemap', params.basemap);
    params.regionLevel = getVal('p-regionlevel', params.regionLevel) || 'province';
    params.regionRamp = getVal('p-regionramp', params.regionRamp) || 'blue';
    params.showLegend = getChk('L-legend', params.showLegend);
    params.showRings = getChk('L-rings', params.showRings);
    params.showBases = getChk('L-bases', params.showBases);
    params.layerPoints = getChk('L-points', params.layerPoints);
    params.glow = getChk('L-glow', params.glow);
    params.color = getVal('p-color', params.color);
    params.radiusKm = parseInt(getVal('p-radius', params.radiusKm), 10) || params.radiusKm;
    params.rings = parseInt(getVal('p-rings', params.rings), 10) || params.rings;
    params.ringLabel = getChk('p-ringlabel', params.ringLabel);
    params.customerRings = getChk('p-custring', params.customerRings);
    params.showLines = getChk('p-lines', params.showLines);
    params.linkStyle = getVal('p-linkstyle', params.linkStyle);
    params.onlyWithin = getChk('p-within', params.onlyWithin);
    params.extrudeScale = parseInt(getVal('p-elevscale', params.extrudeScale), 10) || params.extrudeScale;
    params.lightAmb = (parseInt(getVal('p-lightamb', Math.round(params.lightAmb * 100)), 10) || Math.round(params.lightAmb * 100)) / 100;
    params.sizeByCount = getChk('p-sizebycount', params.sizeByCount);
    params.onlyCount = getChk('p-onlycount', params.onlyCount);
    params.mode = getVal('p-mode', params.mode);
    params.heatRadius = parseInt(getVal('p-heatr', params.heatRadius), 10) || params.heatRadius;
    params.heatIntensity = (parseInt(getVal('p-heati', Math.round(params.heatIntensity * 100)), 10) || Math.round(params.heatIntensity * 100)) / 100;
    params.heatRamp = getVal('p-heatramp', params.heatRamp);
    params.heatTopN = parseInt(getVal('p-heattop', params.heatTopN), 10) || 0;
    var lv = $('p-levels');
    if (lv) {
      Array.prototype.forEach.call(lv.querySelectorAll('input'), function (cb) {
        params.levels[cb.getAttribute('data-q')] = cb.checked;
      });
    }
    setTxt('p-size-v', params.size);
    setTxt('p-alpha-v', params.alpha + '%');
    setTxt('p-radius-v', params.radiusKm + 'km');
    setTxt('p-heatr-v', params.heatRadius);
    setTxt('p-heati-v', params.heatIntensity.toFixed(1));
    setTxt('p-heattop-v', params.heatTopN);
    setTxt('p-elevscale-v', String(params.extrudeScale));
    setTxt('p-lightamb-v', params.lightAmb.toFixed(2));
    applyParamLink();
    lsSet(LS.params, JSON.stringify(params));
  }

  function loadParams() {
    var saved = lsJson(LS.params, null);
    if (saved) {
      if (saved.size) { params.size = saved.size; }
      if (saved.alpha) { params.alpha = saved.alpha; }
      params.label = !!saved.label;
      params.lod = saved.lod !== false;
        if (saved.gridSize) { params.gridSize = saved.gridSize; }
      if (saved.h3Res) { params.h3Res = saved.h3Res; }
      if (saved.regionLevel) { params.regionLevel = saved.regionLevel; }
      params.regionRamp = saved.regionRamp || 'blue';
      params.basemap = saved.basemap || 'normal';
      params.showLegend = saved.showLegend !== false;
      params.showRings = saved.showRings !== false;
      params.showBases = saved.showBases !== false;
      params.layerPoints = saved.layerPoints !== false;
      params.glow = saved.glow !== false;
      params.color = saved.color || 'quality';
      if (saved.radiusKm) { params.radiusKm = saved.radiusKm; }
      if (saved.rings) { params.rings = saved.rings; }
      params.ringLabel = saved.ringLabel !== false;
      params.customerRings = !!saved.customerRings;
      params.showLines = saved.showLines !== false;
      params.linkStyle = saved.linkStyle === 'line' ? 'line' : 'arc';
      params.onlyWithin = !!saved.onlyWithin;
      params.extrude = !!saved.extrude;
      if (saved.extrudeScale) { params.extrudeScale = saved.extrudeScale; }
      if (saved.lightAmb != null) { params.lightAmb = saved.lightAmb; }
      params.sizeByCount = saved.sizeByCount !== false;
      params.onlyCount = !!saved.onlyCount;
      params.mode = (saved.mode === 'heat' || saved.mode === 'grid') ? saved.mode : 'point';
      if (saved.heatRadius) { params.heatRadius = saved.heatRadius; }
      if (saved.heatIntensity) { params.heatIntensity = saved.heatIntensity; }
      params.heatRamp = saved.heatRamp || 'classic';
      if (saved.heatTopN != null) { params.heatTopN = saved.heatTopN; }
      if (saved.levels) {
        for (var lk in params.levels) {
          if (Object.prototype.hasOwnProperty.call(saved.levels, lk)) { params.levels[lk] = saved.levels[lk]; }
        }
      }
    }
    pushParamsToUi();
  }

  /* 把 params 写回控件。重置按钮和"打开时读存档"都走这一个口子 ——
     以前重置是"改 params 再调 syncParamsFromUi()"，而 syncParamsFromUi 是**从控件读回 params**，
     刚设进去的默认值立刻被旧控件值覆盖，点了跟没点一样（这次一并修掉）。 */
  function pushParamsToUi() {
    setVal('p-size', params.size);
    setVal('p-alpha', params.alpha);
    setChk('p-label', params.label);
    setChk('p-lod', params.lod);
    setChk('L-points', params.layerPoints);
    setChk('L-glow', params.glow);
    setChk('L-rings', params.showRings);
    setChk('L-lines', params.showLines);
    setChk('p-lines', params.showLines);
    setChk('L-bases', params.showBases);
    setChk('L-legend', params.showLegend);
    setVal('p-gridsize', params.gridSize);
    setTxt('p-gridsize-v', params.gridSize + 'px');
    setVal('p-h3res', params.h3Res);
    setTxt('p-h3res-v', String(params.h3Res));
    setVal('p-regionlevel', params.regionLevel);
    setVal('p-regionramp', params.regionRamp);
    setVal('p-basemap', params.basemap);
    setVal('p-color', params.color);
    setVal('p-radius', params.radiusKm);
    setVal('p-rings', params.rings);
    setChk('p-ringlabel', params.ringLabel);
    setChk('p-custring', params.customerRings);
    setChk('p-lines', params.showLines);
    setVal('p-linkstyle', params.linkStyle);
    setChk('p-within', params.onlyWithin);
    setChk('p-extrude', params.extrude);
    setVal('p-elevscale', params.extrudeScale);
    setTxt('p-elevscale-v', String(params.extrudeScale));
    setVal('p-lightamb', Math.round(params.lightAmb * 100));
    setTxt('p-lightamb-v', params.lightAmb.toFixed(2));
    setChk('p-sizebycount', params.sizeByCount);
    setChk('p-onlycount', params.onlyCount);
    setVal('p-mode', params.mode);
    setVal('p-heatr', params.heatRadius);
    setVal('p-heati', Math.round(params.heatIntensity * 100));
    setVal('p-heatramp', params.heatRamp);
    setVal('p-heattop', params.heatTopN);
    setTxt('p-heattop-v', params.heatTopN);
    setTxt('p-heatr-v', params.heatRadius);
    setTxt('p-heati-v', params.heatIntensity.toFixed(1));
    var lv2 = $('p-levels');
    if (lv2) {
      Array.prototype.forEach.call(lv2.querySelectorAll('input'), function (cb) {
        var k = cb.getAttribute('data-q');
        cb.checked = params.levels[k] !== false;
      });
    }
    setTxt('p-size-v', params.size);
    setTxt('p-alpha-v', params.alpha + '%');
    setTxt('p-radius-v', params.radiusKm + 'km');
    applyParamLink();
  }


  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    $('btn-settings').addEventListener('click', openSettings);
    on('btn-views', 'click', openViews);
    on('btn-cfg-export', 'click', exportConfig);
    on('btn-cfg-import', 'click', function () { var f = $('cfg-file'); if (f) { f.click(); } });
    on('cfg-file', 'change', function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (f) { importConfigFile(f); }
      ev.target.value = '';
    });
    on('view-save', 'click', function () {
      addView(getVal('view-name', ''));
      setVal('view-name', '');
    });
    var vlist = $('viewlist');
    if (vlist && !vlist.__bound) {
      vlist.__bound = true;
      vlist.addEventListener('click', function (ev) {
        var t = ev.target;
        var del = t.closest ? t.closest('[data-view-del]') : null;
        if (del) { ev.stopPropagation(); removeView(del.getAttribute('data-view-del')); return; }
        var it = t.closest ? t.closest('[data-view-id]') : null;
        if (it) { useView(it.getAttribute('data-view-id')); }
      });
    }
    $('dlg-settings').querySelector('form').addEventListener('submit', saveSettings);

    $('btn-clear-cache').addEventListener('click', function () {
      cache = {}; cacheDirty = true; cacheFlush();
      toast('\u89e3\u6790\u7f13\u5b58\u5df2\u6e05\u7a7a');
    });

    function openImport() {
      var d = $('dlg-import');
      if (!d.open) { d.showModal(); }
      previewImport();
    }
    $('btn-import').addEventListener('click', openImport);
    on('list', 'click', function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-empty]') : null;
      if (!b) { return; }
      var act = b.getAttribute('data-empty');
      if (act === 'import') { openImport(); }
      else if (act === 'demo') { loadRecords(DEMO.map(function (x) { return { raw: x, id: '', lng: null, lat: null }; })); }
    });
    on('btn-import2', 'click', openImport);
    $('btn-preview').addEventListener('click', previewImport);
    $('imp-text').addEventListener('input', function () {
      clearTimeout(/** @type {any} */ (previewImport)._t);
      /** @type {any} */ (previewImport)._t = setTimeout(previewImport, 250);
    });
    $('btn-import-cancel').addEventListener('click', function () { $('dlg-import').close(); });

    $('imp-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) { return; }
      if (f.size <= ImportFlow.MAX_IMPORT_BYTES) { try { $('dlg-import').close(); } catch (e) {} }
      readFile(f).then(function (recs) {
        if (!recs.length) { toast('\u6587\u4ef6\u91cc\u6ca1\u8bfb\u5230\u5730\u5740'); return; }
        loadRecords(recs);
        $('dlg-import').close();
      }).catch(function (err) { toast(err.message || '\u8bfb\u53d6\u5931\u8d25', 4000); });
      e.target.value = '';
    });

    $('btn-import-confirm').addEventListener('click', function () {
      var text = $('imp-text').value;
      var recs = ImportParse.textToRecords(text);
      if (!recs.length) { toast('\u8bf7\u5148\u7c98\u8d34\u5730\u5740\uff0c\u6216\u9009\u62e9\u6587\u4ef6'); return; }
      loadRecords(recs);
      $('dlg-import').close();
    });

    on('btn-demo', 'click', function () {
      loadRecords(DEMO.map(function (t) { return { raw: t, id: '', lng: null, lat: null }; }));
    });

    $('btn-run').addEventListener('click', runGeocode);
    $('btn-export').addEventListener('click', exportCsv);
    on('ana-run', 'click', function () { renderAnalysis({ force: true }); });
    function renderAnswer(res) {
      var box = $('qa-answer');
      if (!box) { return; }
      if (!res) { box.hidden = true; return; }
      var p = res.p;
      var bits = [];
      if (p.region) { bits.push(p.region.name); }
      if (p.plat) { bits.push(p.plat); }
      if (p.timeLabel) { bits.push(p.timeLabel); }
      bits.push(res.measure);
      var head = '<div class="qa-what">我理解为：<b>' + esc(bits.join(' · ')) + '</b></div>';
      var body;
      if (p.topN > 0) {
        var names = res.rows.map(function (r) { return r.name || regionIndex().names[r.adcode] || r.adcode; });
        var vals = res.rows.map(function (r) { return Number(r.v); });
        var max = Math.max.apply(null, vals.concat([1]));
        body = '<div class="qa-list">' + res.rows.map(function (r, i) {
          var nm = names[i];
          return '<div class="qa-li"><span class="qa-n">' + esc(nm) + '</span>' +
            '<span class="qa-bar"><i style="width:' + Math.round(vals[i] / max * 100) + '%"></i></span>' +
            '<span class="qa-v">' + vals[i].toLocaleString() + '</span></div>';
        }).join('') + '</div>';
      } else {
        var one = res.rows[0] || { v: 0, n: 0 };
        body = '<div class="qa-num"><b>' + Number(one.v).toLocaleString() + '</b><span>' + esc(res.measure) + '</span></div>' +
          '<div class="qa-sub">匹配 ' + Number(one.n || 0).toLocaleString() + ' 条记录</div>';
      }
      box.innerHTML = head + body +
        '<div class="qa-acts"><button type="button" class="btn tiny" id="qa-apply">把这句话应用为筛选</button>' +
        '<button type="button" class="btn tiny ghost" id="qa-close">收起</button></div>';
      box.hidden = false;
      var apply = $('qa-apply');
      if (apply) {
        apply.addEventListener('click', function () {
          if (p.from != null) { state.timeFrom = p.from; }
          if (p.to != null) { state.timeTo = p.to; }
          if (p.from != null || p.to != null) {
            state.range = 'custom';
            setVal('f-from', state.timeFrom ? toDateStr(state.timeFrom) : '');
            setVal('f-to', state.timeTo ? toDateStr(state.timeTo) : '');
          }
          if (p.plat) { state.platAll = false; state.platSet = new Set([p.plat]); buildPlatformOptions(); }
          if (p.region) {
            state.regionFilter = { code: p.region.code, name: p.region.name,
              level: p.region.code.slice(2) === '0000' ? 'province' : (p.region.code.slice(4) === '00' ? 'city' : 'district') };
          }
          invalidateView(); updateFilterSummary(); renderTimeAxis();
          renderAnalysis({ force: true }); renderList();
          rebuildMarkers();
          toast('已按这句话设置筛选');
        });
      }
      var close = $('qa-close');
      if (close) { close.addEventListener('click', function () { box.hidden = true; }); }
    }

    async function runQa() {
      var inp = $('qa-input');
      var text = inp ? inp.value : '';
      if (!text.trim()) { return; }
      var btn = $('qa-run');
      if (btn) { btn.disabled = true; btn.textContent = '计算中…'; }
      try {
        var res = await answerQuestion(text);
        renderAnswer(res);
      } catch (e) {
        setTxt('qa-hint', '没算出来：' + ((e && e.message) || e));
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '问一下'; }
      }
    }
    on('qa-run', 'click', runQa);
    var qaInp = $('qa-input');
    if (qaInp) {
      qaInp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); runQa(); } });
    }

    on('ana-measure', 'change', function (ev) {
      state.measure = ev.target.value;
      renderAnalysis({ force: true });
    });
    on('ana-topn', 'change', function (ev) {
      state.topN = parseInt(ev.target.value, 10) || 0;
      AnalysisView.repaintCached();
    });
    on('ana-auto', 'change', function () {
      if (anaAuto()) { renderAnalysis({ force: true }); }
      else { setAnaStatus('已关闭自动查询，筛选变化后点「查询」', true); }
    });
    $('btn-fit').addEventListener('click', fitView);
    on('btn-zoomin', 'click', function () { zoomBy(1); });
    on('btn-zoomout', 'click', function () { zoomBy(-1); });
    on('btn-box', 'click', function () { setBoxMode(!MapView.getBoxState().mode); });
    on('btn-shot', 'click', saveMapShot);
    on('btn-full', 'click', toggleFullscreen);
    on('btn-basemap', 'click', function () {
      var order = ['normal', 'satellite', 'boundary', 'none'];
      params.basemap = order[(order.indexOf(params.basemap) + 1) % order.length];
      setVal('p-basemap', params.basemap);
      { MapView.invalidateDeckBoundary(); rebuildMarkers(); }
      syncParamsFromUi();
      toast('底图：' + (MapView.BASEMAP_NAME[params.basemap] || '标准'));
    });
    on('box-only', 'click', function () {
      var bs = MapView.getBoxState().sel;
      if (!bs) { return; }
      state.boxBounds = bs.b;
      invalidateView(); updateFilterSummary();
      rebuildMarkers(); renderList(); updateStats(); renderTimeAxis();
      toast('已只看框内 ' + bs.cust.toLocaleString() + ' 个客户');
    });
    on('box-clear', 'click', clearBoxSelect);
    /* 换配色方案：只影响画法，不重新聚合，所以直接重画就行 */
    on('p-regionramp', 'change', function () {
      syncParamsFromUi();
      rebuildMarkers(); renderLegend();
    });
    on('p-regionlevel', 'change', function () {
      syncParamsFromUi();
      if (params.mode === 'region') {
        MapView.clearRegionPickList();
        MapView.invalidateDeckRegion();
        rebuildMarkers();
      }
    });
    on('region-only', 'click', applyRegionFilter);
    var chipBox = $('chips');
    if (chipBox && !chipBox.__bound) {
      chipBox.__bound = true;
      chipBox.addEventListener('click', function (ev) {
        var t = ev.target;
        if (!t || !t.closest) { return; }
        if (t.closest('#chip-clear')) { clearAllChips(); return; }
        var x = t.closest('[data-chip-x]');
        if (x) { removeChip(x.getAttribute('data-chip-x')); return; }
        var c2 = t.closest('[data-chip]');
        if (c2) { removeChip(c2.getAttribute('data-chip')); }
      });
    }
    on('region-clear', 'click', clearRegionFilter);
    on('ml-fold', 'click', function () {
      var box = $('maplegend');
      if (!box) { return; }
      box.className = box.className.indexOf('folded') >= 0 ? 'maplegend' : 'maplegend folded';
      setTxt('ml-fold', box.className.indexOf('folded') >= 0 ? '+' : '−');
    });
    ['L-points', 'L-glow', 'L-rings', 'L-lines', 'L-bases', 'L-legend'].forEach(function (id) {
      on(id, 'change', function (ev) {
        var v = !!ev.target.checked;
        if (id === 'L-points') { params.layerPoints = v; }
        else if (id === 'L-glow') { params.glow = v; }
        else if (id === 'L-rings') { params.showRings = v; }
        else if (id === 'L-lines') { params.showLines = v; setChk('p-lines', v); }
        else if (id === 'L-bases') { params.showBases = v; }
        else { params.showLegend = v; }
        syncParamsFromUi();
        rebuildMarkers();
      });
    });
    on('p-gridsize', 'input', function (ev) {
      params.gridSize = parseInt(ev.target.value, 10) || params.gridSize;
      setTxt('p-gridsize-v', params.gridSize + 'px');
      if (params.mode === 'grid' || params.mode === 'hex' || params.mode === 'cluster') { rebuildMarkers(); }
      renderLegend();
      syncParamsFromUi();
    });
    on('p-h3res', 'input', function (ev) {
      params.h3Res = parseInt(ev.target.value, 10) || params.h3Res;
      setTxt('p-h3res-v', String(params.h3Res));
      if (params.mode === 'hex') { rebuildMarkers(); }
      renderLegend();
    });
    on('p-basemap', 'change', function () {
      syncParamsFromUi();      // 先把下拉框的值读进 params，再应用，否则用的是旧值
      rebuildMarkers();
    });
    on('p-linkstyle', 'change', function () {
      syncParamsFromUi();
      rebuildMarkers();
    });
    MapView.bindBoxSelect();
    MapView.ensureOverlayEl('pickring');
    MapView.ensureOverlayEl('boxrect');
    on('basehead', 'click', function () {
      var b = $('basebody');
      b.classList.toggle('collapsed');
      $('basechev').textContent = b.classList.contains('collapsed') ? '\u5c55\u5f00' : '\u6536\u8d77';
    });
    on('btn-base-add', 'click', function () {
      MapView.addBase();
    });
    /* 3D 柱状：勾上时给一个默认倾角（deck 的 MapView 支持 pitch，
       不倾斜的话柱子是正着看的，看不出立体感） */
    on('p-extrude', 'change', function () {
      syncParamsFromUi();
      if (MapView.getEngine() && params.extrude) {
        var engE = MapView.getEngine();
        var v0 = engE.getView();
        if (!v0.pitch) { engE.setView({ pitch: 45 }); }
      }
      rebuildMarkers();
      renderLegend();
    });
    /* 换画法：清掉上一次的区域选中，再重画。
       换热力配色：只重画（参数换了，图层要跟着换色）——
       以前这两件事挤在同一个处理函数里，重画被写进了"只有换画法才走"的分支，
       于是换热力配色只改了参数，地图和图例都纹丝不动。 */
    on('p-mode', 'change', function () {
      syncParamsFromUi();
      if (params.mode !== 'region') {
        MapView.clearRegionPickList();
        var rb = $('regionbar');
        if (rb) { rb.hidden = true; }
      }
      rebuildMarkers(); renderLegend();
    });
    on('p-heatramp', 'change', function () {
      syncParamsFromUi(); rebuildMarkers(); renderLegend();
    });
    /* 柱子高度 / 立体感：只在 3D 模式下需要重画，2D 下改了就存参数，等切 3D 再生效 */
    ['p-elevscale', 'p-lightamb'].forEach(function (id) {
      on(id, 'input', function () {
        syncParamsFromUi();
        clearTimeout(/** @type {any} */ (syncParamsFromUi)._h3);
        /** @type {any} */ (syncParamsFromUi)._h3 = setTimeout(function () {
          if (params.extrude && (params.mode === 'hex' || params.mode === 'grid')) { rebuildMarkers(); }
        }, 90);
      });
    });
    ['p-heatr', 'p-heati', 'p-heattop'].forEach(function (id) {
      on(id, 'input', function () {
        syncParamsFromUi();
        clearTimeout(/** @type {any} */ (syncParamsFromUi)._h);
        /** @type {any} */ (syncParamsFromUi)._h = setTimeout(function () { if (params.mode === 'heat') { rebuildMarkers(); } }, 80);
      });
    });
    ['p-radius', 'p-rings', 'p-ringlabel', 'p-custring', 'p-lines'].forEach(function (id) {
      on(id, 'input', function () {
        syncParamsFromUi();
        if (id === 'p-radius') {
          clearTimeout(/** @type {any} */ (syncParamsFromUi)._r);
          /** @type {any} */ (syncParamsFromUi)._r = setTimeout(function () { renderList(); rebuildMarkers(); }, 90);
        } else { rebuildMarkers(); }
      });
    });
    on('p-within', 'change', function () {
      syncParamsFromUi(); invalidateView(); renderList(); rebuildMarkers();
    });
    /* 只看有客户数据的点：和"只看半径内"一样会影响列表和分析口径，走同一条路 */
    on('p-onlycount', 'change', function () {
      syncParamsFromUi(); invalidateView(); renderList(); rebuildMarkers();
    });
    on('sortby', 'change', function () {
      state.sort = $('sortby').value; renderList();
    });
    on('loading-cancel', 'click', function () { abortImport('\u5df2\u53d6\u6d88\u5bfc\u5165'); });
    var sw = $('viewswitch');
    if (sw) {
      Array.prototype.forEach.call(sw.querySelectorAll('button'), function (b) {
        b.addEventListener('click', function () { switchView(b.getAttribute('data-view')); });
      });
    }
    var nav = document.querySelector('.mapnav');
    if (nav) {
      Array.prototype.forEach.call(nav.querySelectorAll('.mn'), function (b) {
        b.addEventListener('click', function () { showPanel(b.getAttribute('data-panel')); });
      });
    }
    on('panel-close', 'click', function () { var p = $('panel'); if (p) { p.hidden = true; } });
    bindTimeAxis();
    on('ta-reset', 'click', function () { applyTimeSelection(0, (state.taKeys || []).length - 1); });
    on('sf-head', 'click', function () {
      var b = $('sf-body');
      if (!b) { return; }
      b.classList.toggle('collapsed');
      setTxt('sf-chev', b.classList.contains('collapsed') ? '\u5c55\u5f00' : '\u6536\u8d77');
    });
    on('f-from', 'change', function () {
      var v = $('f-from').value;
      state.timeFrom = v ? new Date(v + 'T00:00:00').getTime() : null;
      state.range = 'custom';
      invalidateView(); updateFilterSummary(); renderList(); rebuildMarkers();
    });
    on('f-to', 'change', function () {
      var v = $('f-to').value;
      state.timeTo = v ? new Date(v + 'T23:59:59').getTime() : null;
      state.range = 'custom';
      invalidateView(); updateFilterSummary(); renderList(); rebuildMarkers();
    });
    var qbox = $('sf-quick');
    if (qbox) {
      Array.prototype.forEach.call(qbox.querySelectorAll('button'), function (b) {
        b.addEventListener('click', function () { applyRange(b.getAttribute('data-range')); });
      });
    }
    on('list', 'scroll', function () {
      if (state._scrollRaf) { return; }
      state._scrollRaf = requestAnimationFrame(function () {
        state._scrollRaf = 0;
        renderListWindow();
      });
    });

    $('paramhead').addEventListener('click', function () {
      var b = $('parambody');
      b.classList.toggle('collapsed');
      $('chev').textContent = b.classList.contains('collapsed') ? '\u5c55\u5f00' : '\u6536\u8d77';
    });

    /* 这几个都是"画法参数"：动一下就得重画（p-sizebycount 以前不在里面，勾了没反应，
       要等别的操作顺带重画才生效）。 */
    ['p-size', 'p-alpha', 'p-label', 'p-lod', 'p-color', 'p-sizebycount'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        syncParamsFromUi();
        // 这几个是"画法"参数，拖着调的时候不用整张重建，只重画图层就够快
        if (id === 'p-size' || id === 'p-alpha' || id === 'p-label') {
          if (params.mode !== 'heat') { renderLegend(); }
          clearTimeout(/** @type {any} */ (syncParamsFromUi)._t);
          /** @type {any} */ (syncParamsFromUi)._t = setTimeout(rebuildMarkers, 140);
        } else { rebuildMarkers(); }
      });
    });
    $('p-levels').addEventListener('change', function () {
      syncParamsFromUi(); rebuildMarkers(); renderList();
    });
    $('btn-reset-params').addEventListener('click', function () {
      /* 重置"显示样式"这一页的参数 —— 画法本身不动，
         不然点一下重置就把正在看的图换掉了。底图在「图层」那一页，也不动。 */
      params.size = 14; params.alpha = 85; params.label = false; params.lod = true;
      params.sizeByCount = true; params.color = 'quality';
      params.gridSize = 46; params.h3Res = 5;
      params.extrude = false; params.extrudeScale = 30; params.lightAmb = 0.75;
      params.regionLevel = 'province'; params.regionRamp = 'blue';
      params.heatRadius = 28; params.heatIntensity = 1; params.heatRamp = 'classic'; params.heatTopN = 30;
      params.levels = { custom: true, town: true, district: true, city: true, province: true };
      /* 顺序要紧：先把新值写回控件，syncParamsFromUi 读到的才是重置后的值 */
      pushParamsToUi();
      syncParamsFromUi();
      rebuildMarkers(); renderList();
    });

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        state.filter = t.getAttribute('data-tab');
        invalidateView();
        renderList();
      });
    });
    $('q').addEventListener('input', function () {
      state.q = $('q').value.trim();
      invalidateView();
      renderList();
    });

    $('btn-d-manual').addEventListener('click', startManualPick);
    $('btn-d-retry').addEventListener('click', retryOne);
    $('btn-d-save-place').addEventListener('click', saveCurrentPlace);

    $('btn-dict-import').addEventListener('click', function () { $('dict-file').click(); });
    $('dict-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) { return; }
      importPlacesFile(f).then(function (n) {
        toast('\u5df2\u5bfc\u5165 ' + n + ' \u4e2a\u5730\u70b9\uff0c\u5171 ' + places.length + ' \u6761');
        refreshPlaces();
      }).catch(function (err) { toast(err.message || '\u5bfc\u5165\u5931\u8d25', 4200); });
      e.target.value = '';
    });
    $('btn-dict-export').addEventListener('click', exportPlaces);
    $('btn-dict-clear').addEventListener('click', function () {
      if (!places.length) { toast('\u5b57\u5178\u672c\u6765\u5c31\u662f\u7a7a\u7684'); return; }
      if (!window.confirm('\u786e\u5b9a\u6e05\u7a7a\u5168\u90e8 ' + places.length + ' \u6761\u5730\u70b9\uff1f')) { return; }
      places = []; refreshPlaces(); flushPlaces();
      toast('\u5730\u70b9\u5b57\u5178\u5df2\u6e05\u7a7a');
    });

    window.addEventListener('resize', function () {
      if (MapView.getEngine()) { rebuildMarkers(); }
      // 分析视图的图表按容器实际像素宽度绘制，窗口变化后重画一次
      clearTimeout(chartResizeTimer);
      chartResizeTimer = setTimeout(function () {
        if (currentView === 'analysis' && state.chartData) { try { AnalysisView.paintAllCharts(); } catch (e) {} }
      try { if (!$('timeaxis').hidden) { renderTimeAxis(); } } catch (e) {}
      }, 160);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.manualPick >= 0) {
        state.manualPick = -1;
        document.body.style.cursor = '';
        toast('\u5df2\u53d6\u6d88\u70b9\u9009');
      }
    });
  }

  var chartResizeTimer = null;
  /* ---------------- 启动 ---------------- */
  /* ---------------- 视图与面板 ---------------- */
  var currentView = 'map';
  function switchView(v) {
    currentView = v;
    ['map', 'analysis', 'data'].forEach(function (k) {
      var el = $('view-' + k);
      if (el) { el.hidden = (k !== v); }
    });
    var sw = $('viewswitch');
    if (sw) {
      Array.prototype.forEach.call(sw.querySelectorAll('button'), function (b) {
        b.className = b.getAttribute('data-view') === v ? 'on' : '';
      });
    }
    if (v === 'map') { setTimeout(rebuildMarkers, 60); }
    if (v === 'analysis') { try { renderAnalysis(); } catch (e) {} }
    if (v === 'data') { renderList(); setTimeout(renderListWindow, 30); }
  }

  var PANEL_TITLE = { display: '\u663e\u793a\u6837\u5f0f', radius: '\u8f90\u5c04\u8303\u56f4', base: '\u5e38\u9a7b\u5730\u5740', layers: '\u56fe\u5c42' };
  function showPanel(sec) {
    var p = $('panel');
    if (!p) { return; }
    if (p.hidden === false && p.getAttribute('data-cur') === sec) { p.hidden = true; return; }
    p.hidden = false;
    p.setAttribute('data-cur', sec);
    setTxt('panel-title', PANEL_TITLE[sec] || '');
    ['display', 'radius', 'base', 'layers'].forEach(function (k) {
      var el = $(k === 'display' ? 'parambody' : (k === 'radius' ? 'basebody' : (k === 'base' ? 'basebox' : 'layersbody')));
      if (el) { el.hidden = (k !== sec); }
    });
    var nav = document.querySelector('.mapnav');
    if (nav) {
      Array.prototype.forEach.call(nav.querySelectorAll('.mn'), function (b) {
        b.className = 'mn' + (b.getAttribute('data-panel') === sec ? ' on' : '');
      });
    }
    if (sec === 'base') { try { renderBases(); } catch (e) {} }
  }

  function boot() {
    window.__cmOpenDetail = function (i) { openDetail(i); };
    // 关闭提示用事件委托，且放在最前面：无论后面哪一步出错，都保证能关掉
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') { return; }
      if (state.manualPick >= 0) { state.manualPick = -1; document.body.style.cursor = ''; toast('\u5df2\u53d6\u6d88\u70b9\u9009'); return; }
      if (MapView.beginBasePick()) { return; }
    });
    try { initLocalGeo(); } catch (e) { setMapWarn(e.message); }
    try { refreshPlaces(); } catch (e) {}
    updateFilterSummary();
    try { renderBases(); } catch (e) {}
    try { loadParams(); } catch (e) {}
    try { computeDistances(); } catch (e) {}
    bind();
    updateStats();
    renderList();
    if (!checkWebGL()) {
      setMapWarn('\u5f53\u524d\u6d4f\u89c8\u5668\u4e0d\u652f\u6301 WebGL\uff0c\u5730\u56fe\u65e0\u6cd5\u663e\u793a\u3002\u8bf7\u6539\u7528 Chrome \u6216 Edge \u6253\u5f00\uff0c\u6216\u5173\u6389\u6d4f\u89c8\u5668\u7684\u7701\u7535\u6a21\u5f0f\u540e\u91cd\u8bd5\u3002');
    }
    {
      /* deck.gl 那个 2MB 的包放到空闲时再注入 —— 首屏可交互时间因此不受它影响。 */
      var kickDeck = function () {
        MapView.loadDeckGL().then(function () {
          try { renderDeckMap(); } catch (e) { setMapWarn((e && e.message) || 'deck.gl 初始化失败'); }
        }).catch(function (e) { setMapWarn((e && e.message) || 'deck.gl 加载失败'); });
      };
      if (window.requestIdleCallback) { window.requestIdleCallback(kickDeck, { timeout: 2000 }); }
      else { setTimeout(kickDeck, 300); }
    }
  }

  /* 自查句柄：只读引用，供自动化验证/排查用，不参与业务逻辑 */
  window.__cm = {
    state: state,
    params: params,
    view: function () { return currentView; },
    charts: function () { return { data: state.chartData, prefs: chartPrefs() }; },
    /* deck 引擎的拾取结果由 deck 自己管，这个钩子只保留形状（老用例会读它） */
    picks: function () { return []; },
    layer: function () { return state.layerStats; },
    setMode: function (m) { params.mode = m; setVal('p-mode', m); syncParamsFromUi(); rebuildMarkers(); },
    /* 端到端用例用：强制走 JS 通道，好和 SQL 通道的结果逐项比对 */
    /* 只设开关，不顺手触发查询 —— 否则调用方紧接着点「查询」会被"计算中"挡住（测试里踩过） */
    forceJs: function (on) { AnalysisView.setForceJs(on); },
    anaRuns: function () { return AnalysisView.anaRuns(); },
    lastSqlError: function () { return AnalysisView.lastSqlError(); },
    shot: function () { return shotStats(); },
    engine: function () { return Object.assign({}, Engine.engineStatus(), { cacheBytes: state.cacheBytes || 0, cacheError: state.cacheError || '' }); },
    engineQuery: function (sql) { return Engine.query(sql); },
    engineSpike: function () { return Engine.spike(); },
    /* 导出一次 Parquet 缓存，看它到底成不成（排障用，顺便让"缓存失败"不再静默） */
    engineParquet: function () {
      return Engine.toParquet('rows').then(function (b) {
        return { ok: true, bytes: b ? b.byteLength : 0, type: b ? b.constructor.name : null };
      }, function (e) { return { ok: false, err: String((e && e.message) || e) }; });
    },
    reproWipe: function (sel) { return reproWipe(sel); },
    restore: function () { return restoreFromCache(); },
    restoreError: function () { return state.restoreError || ''; },
    box: function () { var bs2 = MapView.getBoxState(); return { mode: bs2.mode, dragging: bs2.dragging, sel: bs2.sel, bounds: state.boxBounds }; },
    regions: function () { return MapView.getRegionPickList(); },
    /* 视图控制（测试和调试用） */
    setView: function (v) {
      var eng1 = MapView.getEngine();
      if (eng1) { eng1.setView({ longitude: v.lng, latitude: v.lat, zoom: v.zoom, pitch: v.pitch != null ? v.pitch : 0 }); }
      rebuildMarkers();   // deck 只在用户交互时上报视图变化，程序化设置要自己补一次重绘
    },
    /* 引擎无关的辅助（测试用）：把经纬度换成屏幕坐标、拿客户数最大的那个点 */
    screenOf: function (lng, lat) {
      var engV = MapView.getEngine();
      var vp = engV && engV.getViewport();
      if (!vp) { return null; }
      var q = vp.project([lng, lat]);
      var r = $('map').getBoundingClientRect();
      return q ? { x: r.x + q[0], y: r.y + q[1] } : null;
    },
    topItem: function () {
      var items = state.layerItems || [];
      var best = null;
      for (var i = 0; i < items.length; i++) {
        var r = items[i].r;
        if (!best || (r.count || 1) > (best.count || 1)) { best = { lng: r.lng, lat: r.lat, count: r.count || 1 }; }
      }
      return best;
    },
    getView: function () {
      var e3 = MapView.getEngine();
      var vp = e3 && e3.getViewport();
      return vp ? { lng: vp.longitude, lat: vp.latitude, zoom: vp.zoom } : null;
    },
    regionProj: function () { var e2 = MapView.getEngine(); return e2 ? e2.projector() : null; },
    regionAgg: function () { return regionAgg(); },
    pickRegionAt: function (lng, lat) { var p = pickRegionLngLat(lng, lat); return p ? { code: p.code, name: p.name, v: p.v } : null; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }

  /* 启动顺序（P0-1 优化后）：
     1) 立即绑定交互，用户 300ms 内就能操作
     2) 空闲时再加载百度地图脚本 —— 它会在 6.6s / 19.3s 各卡主线程一次，
        放在空闲时段就不会和用户的操作抢时间
     3) 有缓存就先恢复数据 */
  try { applyUrlParams(); } catch (e) { /* 参数有问题就当没有 */ }
  setTimeout(function () { restoreFromCache(); }, 600);

  /* 地图还没就绪时，在图上给一句明确的提示，而不是一片空白 */
  (function mapPlaceholder() {
    var el = $('map');
    if (!el) { return; }
    var tip = document.createElement('div');
    tip.className = 'map-placeholder';
    tip.id = 'map-placeholder';
    tip.textContent = '底图加载中…（数据导入和解析不受影响）';
    el.parentNode.insertBefore(tip, el.nextSibling);
    var stop = setInterval(function () {
      if (document.querySelector('#map canvas')) { tip.remove(); clearInterval(stop); }
    }, 300);
    setTimeout(function () { clearInterval(stop); if (tip.parentNode) { tip.textContent = '底图没能加载，可用「本地边界」底图继续'; } }, 25000);
  })();
