/* 分析视图（Power BI 风格的仪表盘）
   ==================================================================
   从 main.js 搬出来的整块分析页：图表样式切换、钻取、自然语言问答、平台×月份矩阵、
   以及它们和地图/列表之间的联动。约有 600 行，是 main.js 最后一块大石头。

   拆的时候定的规矩（和前面拆出去的几块一致）：
   1. 模块不自己去读全局 —— 需要什么从 createAnalysisView(ctx) 的参数进来。
   2. 数据汇总的重活不在这里 —— 在 analysis/model.js（纯计算，有单测）。
      这里只负责"把模型画出来"和"把点击翻译成筛选"。
   3. 图表本身交给 ECharts（ui/island.jsx）。这里只拼卡片外壳、处理切换与联动。

   为什么要拆：main.js 已经 4276 行，而这一块几乎可以整体平移 —— 它和外面的耦合
   集中在"读筛选条件"和"改筛选条件"两头，中间的绘制、问答、矩阵都是自洽的。
   ------------------------------------------------------------------ */

import { chartTable, chartSwitch } from '../core/chart-core.js';
import { VISUALS, visualOf, visualIds, defaultPrefs, applyTopN } from './visuals.js';
import {
  MEASURES, measureKeyOf, measureList, formatValue,
  regionBucket, prevMonth, calendarMonths, monthIndex, monthKeyOfIndex
} from './semantic.js';

export function createAnalysisView(ctx) {
  /* ------------------------------------------------------------------
     把 main.js 里的东西接进来。之所以是"显式传"而不是让模块自己去读全局：
     模块只认识 ctx 里的这些东西，想多用一个就得先在这里加一行 —— 依赖是看得见的。
     state / params 是共享对象（分析页要读写筛选条件：时间、平台、区域、钻取路径），
     模块只碰和分析有关的那几个字段。 */
  var state = ctx.state;
  var params = ctx.params;
  var $ = ctx.$;
  var esc = ctx.esc;
  var fmtMonth = ctx.fmtMonth;
  var fmtDate = ctx.fmtDate;
  var fmtYearMonth = ctx.fmtYearMonth || function (ms) { var d = new Date(ms); return d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0'); };
  /* 所有出数的地方都走这里：格式跟着"度量"走（金额缩写、比率百分比、人均一位小数、计数千分位），
     以前最新月/矩阵格子里直接 shortNum()，换成复购率就吐一串 0.9715… 的原始小数。 */
  /* 每个度量的口径说明（鼠标悬停在 KPI 卡片上能看到）。
     为什么必须写清楚：明细是按 地点×平台×店铺×月份 去重后聚合的，
     同一个人会出现在多个分组里，所以凡是带"客户数"的比率都是**分组平均口径**，
     不等于"全站唯一客户的复购率"（那个数只有聚合工具在原始明细上算得出来）。 */
  var MEASURE_HINTS = {
    cust: '按 地点 × 平台 × 月份 各自去重后的客户数相加；跨分组同一个人会被重复计入，不等于全站去重客户数',
    rep: '分组内累计下过 ≥2 单的客户数（按整份数据全时段判定）；跨分组会重复计入',
    highfreq: '分组内累计 ≥10 单的客户数；跨分组会重复计入',
    active: '分组内"最后一单在最近 3 个月内"的客户数；跨分组会重复计入',
    orders: '分组内订单行数合计',
    repRate: '分组内复购客户数 ÷ 分组内客户数 —— 分组平均口径，不是全站唯一客户的复购率',
    activeRate: '分组内活跃客户数 ÷ 分组内客户数 —— 同样是分组平均口径',
    freq: '分组内订单数 ÷ 分组内客户数 —— 不是"某个客户平均下几单"（那需要客户级明细）'
  };
  function measureHint(key) { return MEASURE_HINTS[key]; }

  function fmtByMeasure(v, format) {
    if (format && format !== 'num') { return formatValue(v, format); }
    return shortNum(v);
  }
  var shortNum = ctx.shortNum;
  var toDateStr = ctx.toDateStr;
  var lsSet = ctx.lsSet;
  var lsJson = ctx.lsJson;
  var setVal = ctx.setVal;
  var setTxt = ctx.setTxt;
  var Engine = ctx.Engine;
  var AnalysisModel = ctx.AnalysisModel;
  var chartTable = ctx.chartTable;
  var chartSwitch = ctx.chartSwitch;
  var mountKpi = ctx.mountKpi;
  var mountTrend = ctx.mountTrend;
  var mountChart = ctx.mountChart;
  var mountMatrix = ctx.mountMatrix;
  var regionAgg = ctx.regionAgg;
  var regionIndex = ctx.regionIndex;
  var ensureRowRegions = ctx.ensureRowRegions;
  var withinRadius = ctx.withinRadius;
  var cityKeyOf = ctx.cityKeyOf;
  var toast = ctx.toast;
  var viewKey = ctx.viewKey;
  var viewIndices = ctx.viewIndices;
  var invalidateView = ctx.invalidateView;
  var updateFilterSummary = ctx.updateFilterSummary;
  var renderTimeAxis = ctx.renderTimeAxis;
  var renderList = ctx.renderList;
  var rebuildMarkers = ctx.rebuildMarkers;
  var buildPlatformOptions = ctx.buildPlatformOptions;
  var selectRow = ctx.selectRow;
  var switchView = ctx.switchView;
  var isAnalysisView = ctx.isAnalysisView;

  /* ================= 视觉对象（声明表在 analysis/visuals.js） =================
     这里不再写死"有哪几张图、各能换哪几种画法、颜色多高上限多少" ——
     那些都是声明表里的事。这里只负责：按声明取数、按声明拼卡片。 */
  function chartPrefs() {
    if (!state.chartPrefs) { state.chartPrefs = lsJson('cm.charts', defaultPrefs()); }
    return state.chartPrefs;
  }

  /* ---- 出图入口 ----
     柱状 / 折线 / 面积 / 饼图 / 环形 / 条形 —— 全部交给 ECharts（见 ui/island.jsx 的
     mountChart / mountTrend）。这里原来还有一整套手写 SVG 画法，是换 ECharts 之前的版本，
     已经没人调用了，2026-09 一起清掉：留着的话改一次样式要改两处，还容易只改对一处。
     留给这里的只有「表格」—— 数据密集、要能选中复制，直接出 <table> 更合适。 */
  function chartPaint(id, pref, items, o) {
    o = o || {};
    if (!items || !items.length) { return '<div class="an-empty">' + esc(o.empty || '暂无可分析的数据') + '</div>'; }
    return chartTable(items, { limit: o.tableLimit });
  }

  /* ================= 钻取（参考 Power BI 的下钻） =================
     点一根柱子就钻进下一级：全国 → 省 → 市 → 区县，
     上面的面包屑可以往回跳。钻取只影响这张排行榜，不改全局筛选；
     想真筛选就用地图上的"只看这个区域"。 */
  var DRILL_LEVELS = ['province', 'city', 'district'];
  var DRILL_LEVEL_CN = { province: '省', city: '市', district: '区县' };

  function drillLevel() {
    return DRILL_LEVELS[Math.min((state.drillPath || []).length, 2)];
  }

  function drillItems() {
    var agg = regionAgg();
    var idx = regionIndex();
    var path = state.drillPath || [];
    var node = path.length ? path[path.length - 1] : null;
    var level = drillLevel();
    var out = new Map();
    var reps = {};
    // 省级按前 2 位、市级按前 4 位筛，不能拿完整编码去比——那样子区域全会被滤掉
    var plen = 6;
    if (node) {
      if (node.code.slice(2) === '0000') { plen = 2; }
      else if (node.code.slice(4) === '00') { plen = 4; }
      else { plen = 6; }
    }
    agg.leaf.forEach(function (v, code) {
      if (node && code.slice(0, plen) !== node.code.slice(0, plen)) { return; }
      var key;
      if (level === 'province') { key = code.slice(0, 2) + '0000'; }
      else if (level === 'city') { key = cityKeyOf(code); }
      else { key = code; }
      out.set(key, (out.get(key) || 0) + v);
      if (reps[key] == null) { reps[key] = agg.leafRep.get(code); }
    });
    var arr = [];
    out.forEach(function (v, code) {
      arr.push({ code: code, label: idx.names[code] || code, v: v, click: code });
    });
    arr.sort(function (x, y) { return y.v - x.v; });
    state.drillRep = reps;
    return arr;
  }

  function drillInto(code) {
    if (!state.drillPath) { state.drillPath = []; }
    if (state.drillPath.length >= 2) { return; }
    var idx = regionIndex();
    var lvl = DRILL_LEVELS[state.drillPath.length];
    state.drillPath.push({ code: code, name: idx.names[code] || code, level: lvl });
    state.drillMode = true;
    if (isAnalysisView()) { renderAnalysis(); }
  }
  function drillTo(i) {
    if (!state.drillPath) { state.drillPath = []; }
    state.drillPath = i < 0 ? [] : state.drillPath.slice(0, i + 1);
    if (isAnalysisView()) { renderAnalysis(); }
  }
  function drillCrumbs() {
    var path = state.drillPath || [];
    var parts = ['<button type="button" class="drill-crumb' + (path.length ? '' : ' on') + '" data-drill="-1">全国</button>'];
    path.forEach(function (n, i) {
      parts.push('<span class="drill-sep">›</span>');
      parts.push('<button type="button" class="drill-crumb' + (i === path.length - 1 ? ' on' : '') +
        '" data-drill="' + i + '">' + esc(n.name) + '</button>');
    });
    return parts.join('');
  }
  function drillBarHtml() {
    var lv = drillLevel();
    return '<div class="drill-bar">' +
      '<span class="drill-crumbs" id="drill-crumbs">' + drillCrumbs() + '</span>' +
      '<span class="drill-lv">当前：' + DRILL_LEVEL_CN[lv] + '</span>' +
      '<label class="drill-mode"><input type="checkbox" id="drill-mode"' + (state.drillMode ? ' checked' : '') + '><span>钻取模式</span></label>' +
      '<span class="drill-tip" id="drill-tip">' + (state.drillMode ? '点柱子钻进下一级' : '点柱子飞到地图') + '</span>' +
      '</div>';
  }

  /* ---- 分析视图：KPI + 三张可切换图表 ----
     把重活（扫几十万行）单独抽出来，并且按筛选条件缓存结果：
     同样的筛选来回切视图不重算；筛选变了先显示"正在计算"，再出结果。
     自动查询可以关掉，改成手动点「查询」——数据大的时候更好控制。 */
  var anaCache = null;      // { key, model, ms }
  var TOPN_OPTIONS = [10, 20, 50, 0];   // 0 = 全部

  /* 度量：和 Power BI 一样，"看什么口径"和"怎么画"是两件事。
     换度量之后 KPI、趋势、排行、矩阵全部跟着换，不用重新导数据。 */
  var MEASURES = AnalysisModel.MEASURES;   // 度量定义在 analysis/model.js
  function measureKey() { return AnalysisModel.measureKeyOf(state.measure); }

  /* 度量下拉从语义层的定义表生成：加一个度量只要在 semantic.js 里加一行，
     不用再改 dev.html 的 option、也不用改这里的代码。 */
  function renderMeasureOptions() {
    var sel = $('ana-measure');
    if (!sel || sel.__filled === measureList().length) { return; }
    var cur = measureKey();
    sel.innerHTML = measureList().map(function (m) {
      return '<option value="' + m.key + '">' + esc(m.label) + '</option>';
    }).join('');
    sel.__filled = measureList().length;
    sel.value = cur;
  }
  function measureLabel() { return MEASURES[measureKey()].label; }
  function measureWeight(r) { return AnalysisModel.measureWeight(measureKey(), r); }

  var anaBusy = false;
  /* 强制走 JS 通道（只给测试用：比对两条通道结果是否一致） */
  var forceJs = false;
  /* 上一次 SQL 通道失败的原因。以前这里是个静默 catch ——
     SQL 挂了就当 JS 用，界面上一点提示都没有，问题能藏很久。 */
  var lastSqlError = '';
  var anaTimer = null;
  /* 算完一次 +1。端到端用例靠它判断「这一次真的跑完了」——
     靠状态栏文案判断会被抢跑（测试里踩过）。 */
  var anaRunId = 0;

  function analysisKey() { return viewKey() + '|' + state.rows.length + '|' + measureKey(); }
  function anaAuto() { var cb = $('ana-auto'); return !cb || cb.checked; }
  function setAnaStatus(txt, warn) {
    var el = $('ana-status');
    if (!el) { return; }
    el.textContent = txt;
    el.className = 'ana-status' + (warn ? ' warn' : '');
  }
  function setAnaBusy(on, label) {
    var b = $('ana-run');
    if (b) { b.disabled = !!on; b.textContent = on ? '计算中…' : '查询'; }
    clearInterval(anaTimer);
    if (!on) { return; }
    var t0 = performance.now();
    setAnaStatus(label || '正在计算…');
    anaTimer = setInterval(function () {
      setAnaStatus((label || '正在计算…') + ' 已用 ' + Math.round(performance.now() - t0) + ' ms');
    }, 120);
  }

  /* 这份数据实际到哪一级：地区编码后两位是 00 → 市级码（310100），再后两位也是 00 → 省级（310000）。
     KPI 上写"覆盖区县"还是"覆盖城市"要跟着数据走 —— 不然数字（353）、标签（区县）和地图（市界）三边对不上。 */
  var coverageLevelCache = null, coverageLevelFor = null;
  function coverageLevel() {
    if (coverageLevelFor === state.rows && coverageLevelCache) { return coverageLevelCache; }
    var lvl = 'province';
    try {
      /* 口径统一在语义层（regionLevelOfCodes）：按行数取多数，
         免得几万行里混进几百行"市级标签被匹到区县"就把整份数据说成区县级。 */
      lvl = AnalysisModel.regionLevelOfCodes(ensureRowRegions ? ensureRowRegions() : []);
    } catch (e) { lvl = 'district'; }
    coverageLevelCache = lvl; coverageLevelFor = state.rows;
    return lvl;
  }
  function coverageUnit() {
    return AnalysisModel.regionUnitOf(coverageLevel());
  }

  /* 重活：把当前筛选下的数据汇总成一个模型 */
  function buildAnalysisModelJs() {
    /* regionOf 是全站唯一的地区口径：行政区编码按区县归桶。地图分层着色用的是
       同一套规则，所以覆盖范围这个数在地图和分析页一定对得上。 */
    var reg = ensureRowRegions();
    return AnalysisModel.buildAnalysisModelJs(state.rows, viewIndices(), measureKey(), {
      regionOf: function (i) {
        var g = reg[i];
        return regionBucket(g ? (g.d || g.c || g.p || '') : '', AnalysisModel.PLACES_LEVEL);
      }
    });
  }

  /* 轻活：把模型画成 HTML（同一份模型可以反复重画，不用重新汇总） */
  function paintAnalysis(model) {
    var box = $('dash');
    if (!box) { return; }
    var rows = model.rows, platMap = model.platMap, geoMap = model.geoMap, timeMap = model.timeMap;
    var withT = model.withT, minT = model.minT, maxT = model.maxT;
    var topN = state.topN == null ? 20 : state.topN;
    /* 每个视觉对象自己声明"数据从哪来"和"取前 N 怎么显示其他" */
    var vctx = { fmtMonth: fmtMonth, drillItems: drillItems, drillBarHtml: drillBarHtml };
    var chartData = {}, chartEmpty = {};
    VISUALS.forEach(function (v) {
      var items = v.items(model, vctx);
      if (v.limit && v.limit.by === 'topN') { items = applyTopN(items, topN, v.limit); }
      if (v.postprocess) { items = v.postprocess(items); }
      chartData[v.id] = items;
      chartEmpty[v.id] = v.empty(model, state);
    });
    state.chartData = chartData;
    state.chartEmpty = chartEmpty;

    /* 环比：走日期表。
       以前取的是"上一个有数据的月"—— 7 月没单就会拿 6 月和 9 月比，
       虽然标签写的是真实月份没骗人，但和"环比"这个词的心智不符。
       现在按日历排：缺的月补 0，上个月就是日历上的上个月（Power BI 的做法）。 */
    var mkAll = calendarMonths(Array.from(timeMap.keys()));
    var momHtml = '';
    var lastMk = mkAll.length ? mkAll[mkAll.length - 1] : '';
    var prevMk = lastMk ? prevMonth(lastMk) : '';
    var lastV = lastMk ? (timeMap.get(lastMk) || 0) : 0;
    var prevV = prevMk ? (timeMap.get(prevMk) || 0) : 0;
    if (lastMk && prevMk && prevV > 0) {
      var mom = (lastV - prevV) / prevV * 100;
      var cls = mom >= 0 ? 'up' : 'down';
      momHtml = '<div class="mom ' + cls + '"><b>' + (mom >= 0 ? '+' : '') + mom.toFixed(1) + '%</b>' +
        '<span>' + fmtMonth(prevMk) + ' → ' + fmtMonth(lastMk) + '</span></div>';
    }

    var prefs = chartPrefs();
    var h = '<div class="dash-head"><div class="dash-title">客户分布分析</div>' +
      '<div class="dash-sub">当前筛选下的结果' +
      (withT ? '，时间跨度 ' + fmtYearMonth(minT) + ' – ' + fmtYearMonth(maxT) : '') +
      '，' + rows.length.toLocaleString() + ' 条记录</div></div>';

    // KPI 行改由 React + Tailwind 渲染（保留 .kpi 类名，测试和样式都兼容）
    /* KPI 的标签和格式都从度量定义表来 —— 加一个度量不用改这里 */
    var mLabel = model.measureLabel || measureLabel();
    var isRatio = MEASURES[model.measureKey || measureKey()].kind === 'calc';
    /** @type {Array<{value:string,label:string,delta?:number,deltaLabel?:string,hint?:string}>} */
    var kpiItems = [
      { value: rows.length.toLocaleString(), label: '记录数' },
      { value: formatValue(model.custSum, model.measureFormat), label: isRatio ? mLabel : (mLabel + '合计'),
        /* 这个数不是"全站去重客户"：明细已经按 地点×平台×月份 各去重过一次，
           再相加必然有重复。把口径写在悬停提示里，免得被当成唯一客户数。 */
        hint: measureHint(model.measureKey || measureKey()) },
      { value: String(platMap.size), label: '平台数' },
      { value: Number(model.placeCount != null ? model.placeCount : geoMap.size).toLocaleString(), label: '覆盖' + coverageUnit() }
    ];
    if (lastMk) {
      kpiItems.push({ value: fmtByMeasure(lastV, model.measureFormat), label: '最新月 ' + fmtMonth(lastMk),
        delta: (lastMk && prevV > 0) ? (lastV - prevV) / prevV * 100 : undefined,
        deltaLabel: prevMk ? fmtMonth(prevMk) + ' → ' + fmtMonth(lastMk) : '' });
    }

    /* 同比（Year over Year）：和**去年同月**比。
       环比只看相邻两个月，容易受季节性影响 —— 比如 2 月本来就少。
       日期表补齐之后，"去年同月"才拿得准（不然缺月会把对比挪到别的月份上）。 */
    if (lastMk) {
      var yoyMk = monthKeyOfIndex(monthIndex(lastMk) - 12);
      var yoyV = timeMap.get(yoyMk) || 0;
      if (yoyV > 0) {
        var yoy = (lastV - yoyV) / yoyV * 100;
        kpiItems.push({
          value: fmtByMeasure(yoyV, model.measureFormat),
          label: '去年同月 ' + fmtMonth(yoyMk),
          delta: yoy,
          deltaLabel: '同比 ' + (yoy >= 0 ? '+' : '') + yoy.toFixed(1) + '%'
        });
      }
    }
    h += '<div id="kpi-root" class="kpis" data-kpis="react"></div>';

    /* 卡片也按声明表生成：加一个视觉对象不用再改这里的拼字符串 */
    h += '<div class="dash-grid">';
    VISUALS.forEach(function (v) {
      h += '<div class="card2' + (v.span === 'full' ? ' full' : '') + '">' +
        '<div class="ct-head"><h4>' + v.title + '<small>' + esc(v.hint(model, state)) + '</small></h4>' +
        chartSwitch(v.id, v.styles, prefs[v.id]) + '</div>' +
        (v.barHtml ? v.barHtml(vctx) : '') +
        '<div class="ct-body" data-cg="' + v.id + '"></div></div>';
    });
    h += matrixCard(model, topN);
    h += '</div>';

    box.innerHTML = h;
    mountKpi(box.querySelector('#kpi-root'), kpiItems);
    if (state.matrixData && box.querySelector('#mtx-root')) {
      mountMatrix(box.querySelector('#mtx-root'), state.matrixData, applyMatrixPick);
    }
    paintAllCharts();
    setAnaBusy(false);
  }

  /* 矩阵交叉表：行 = 平台，列 = 最近 12 个月。
     Power BI 里这个视觉对象叫"矩阵"，配上数据条一眼就能看出哪个平台哪个月最猛。 */
  /* 把一句话拆成"时间 + 区域 + 平台 + 度量"四件事。
     纯本地、不联网、不调用任何模型——就是一套中文规则匹配。 */
  function parseQuestion(text) {
    var q = String(text || '').replace(/\s+/g, '');
    if (!q) { return null; }
    var out = { raw: q, from: null, to: null, timeLabel: '', region: null, plat: null, measure: measureKey(), topN: 0 };
    var now = new Date();

    // 时间
    var m;
    if ((m = q.match(/最近(\d+)个月/))) {
      var n = Math.min(60, parseInt(m[1], 10));
      var end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      var start = new Date(now.getFullYear(), now.getMonth() - n + 1, 1);
      out.from = start.getTime(); out.to = end.getTime();
      out.timeLabel = '最近 ' + n + ' 个月';
    } else if ((m = q.match(/(\d{4})年(\d{1,2})月/))) {
      var y = +m[1], mo = +m[2] - 1;
      out.from = new Date(y, mo, 1).getTime();
      out.to = new Date(y, mo + 1, 0, 23, 59, 59).getTime();
      out.timeLabel = y + '年' + (mo + 1) + '月';
    } else if ((m = q.match(/(\d{4})年/))) {
      var y2 = +m[1];
      out.from = new Date(y2, 0, 1).getTime();
      out.to = new Date(y2, 11, 31, 23, 59, 59).getTime();
      out.timeLabel = y2 + '年';
    } else if (/上月|上个月/.test(q)) {
      out.from = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
      out.to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).getTime();
      out.timeLabel = '上月';
    } else if (/本月|这个月/.test(q)) {
      out.from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      out.to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).getTime();
      out.timeLabel = '本月';
    } else if (/今年/.test(q)) {
      out.from = new Date(now.getFullYear(), 0, 1).getTime();
      out.to = new Date(now.getFullYear(), 11, 31, 23, 59, 59).getTime();
      out.timeLabel = '今年';
    }

    // 平台（拿已加载的平台名去匹配，取最长命中）
    var plats = state.platList || [];
    var best = '';
    plats.forEach(function (kv) {
      var name = String(kv[0]);
      if (name.length > 1 && q.indexOf(name) >= 0 && name.length > best.length) { best = name; }
    });
    if (best) { out.plat = best; }

    // 行政区（省 / 市 / 区县名，取最长命中）
    var idx = regionIndex();
    var hitCode = '', hitName = '';
    Object.keys(idx.names).forEach(function (code) {
      var nm = idx.names[code];
      if (!nm || nm.length < 2) { return; }
      if (q.indexOf(nm) >= 0 && nm.length > hitName.length) { hitName = nm; hitCode = code; }
    });
    if (hitCode) { out.region = { code: hitCode, name: hitName }; }

    // 度量
    if (/记录|订单数|多少条/.test(q)) { out.measure = 'rows'; }
    else if (/覆盖|多少地方|多少地点|多少个区县/.test(q)) { out.measure = 'places'; }

    // 排序
    if ((m = q.match(/前\s*(\d+)/))) { out.topN = Math.min(50, parseInt(m[1], 10)); }
    else if (/最多|最高|排名|排行|top/i.test(q)) { out.topN = 10; }
    return out;
  }

  function questionWhere(p) {
    var t = [];
    if (p.from != null) { t.push('t >= ' + p.from); }
    if (p.to != null) { t.push('t <= ' + p.to); }
    if (p.plat) { t.push("plat = '" + p.plat.replace(/'/g, "''") + "'"); }
    if (p.region) {
      var code = p.region.code;
      var need = code.slice(2) === '0000' ? 2 : (code.slice(4) === '00' ? 4 : 6);
      t.push("substr(adcode, 1, " + need + ") = '" + code.slice(0, need) + "'");
    }
    return t.length ? (' WHERE ' + t.join(' AND ')) : '';
  }

  async function answerQuestion(text) {
    var p = parseQuestion(text);
    if (!p) { return null; }
    var M = MEASURES[p.measure].sql;
    // 没有 SQL 引擎就临时用 JS 算（数据量不大时够快）
    if (Engine.engineStatus().status !== 'ready' || !state.engineOn) {
      return answerQuestionJs(p);
    }
    var where = questionWhere(p);
    var rows;
    if (p.topN > 0) {
      rows = await Engine.query('SELECT adcode, ' + M + ' AS v FROM rows' + where +
        " GROUP BY 1 ORDER BY v DESC LIMIT " + p.topN);
    } else {
      rows = await Engine.query('SELECT ' + M + ' AS v, count(*) AS n FROM rows' + where);
    }
    return { p: p, measure: MEASURES[p.measure].label, rows: rows };
  }

  function answerQuestionJs(p) {
    var idx = viewIndices();
    var w = 0, n = 0;
    var buckets = new Map();
    var need = p.region ? (p.region.code.slice(2) === '0000' ? 2 : (p.region.code.slice(4) === '00' ? 4 : 6)) : 0;
    var rIdx = ensureRowRegions();
    var geoNames = regionIndex().names;
    for (var i = 0; i < idx.length; i++) {
      var ri = idx[i], r = state.rows[ri];
      if (p.from != null && (r.t == null || r.t < p.from)) { continue; }
      if (p.to != null && (r.t == null || r.t > p.to)) { continue; }
      if (p.plat && (r.plat || '') !== p.plat) { continue; }
      var reg = rIdx[ri];
      if (p.region) {
        var code = reg ? (reg.d || reg.c || reg.p) : '';
        if (!code || code.slice(0, need) !== p.region.code.slice(0, need)) { continue; }
      }
      n++;
      if (p.measure === 'rows') { w += 1; }
      else if (p.measure === 'places') { w += 1; }
      else { w += (r.count > 1 ? r.count : 1); }
      if (p.topN > 0) {
        var k = reg ? (reg.d || reg.c || reg.p) : '';
        if (k) { buckets.set(k, (buckets.get(k) || 0) + (p.measure === 'cust' ? (r.count > 1 ? r.count : 1) : 1)); }
      }
    }
    if (p.topN > 0) {
      var arr = Array.from(buckets.entries()).sort(function (a, b) { return b[1] - a[1]; }).slice(0, p.topN);
      return { p: p, measure: MEASURES[p.measure].label, rows: arr.map(function (kv) { return { adcode: kv[0], v: kv[1], name: geoNames[kv[0]] || kv[0] }; }) };
    }
    return { p: p, measure: MEASURES[p.measure].label, rows: [{ v: w, n: n }] };
  }

  /* 矩阵单元格的交叉筛选：平台 + 月份一起筛 */
  function applyMatrixPick(pk, mk) {
    if (!pk || !mk) { return; }
    var y = +mk.slice(0, 4), mo = +mk.slice(5, 7) - 1;
    state.platAll = false;
    state.platSet = new Set([pk]);
    state.timeFrom = new Date(y, mo, 1).getTime();
    state.timeTo = new Date(y, mo + 1, 0, 23, 59, 59).getTime();
    state.range = 'custom';
    setVal('f-from', toDateStr(state.timeFrom));
    setVal('f-to', toDateStr(state.timeTo));
    buildPlatformOptions();
    invalidateView();
    updateFilterSummary();
    renderTimeAxis();
    renderAnalysis();
    renderList();
    rebuildMarkers();
    toast('已交叉筛选：' + pk + ' · ' + mk);
  }

  function matrixCard(model, topN) {
    var mLbl = model.measureLabel || '客户数';      // 矩阵标题/单元格说明要跟着当前度量走
    var mk = Array.from(model.timeMap.keys()).sort().slice(-12);
    if (!mk.length || !model.platMap.size) { return ''; }
    var plats = Array.from(model.platMap.entries()).sort(function (a, b) { return b[1] - a[1]; });
    if (topN > 0) { plats = plats.slice(0, Math.min(topN, 10)); }
    else { plats = plats.slice(0, 10); }
    if (plats.length < 2) { return ''; }
    var cols = mk.map(function (k) { return { key: k, label: fmtMonth(k) }; });
    var rws = [], vals = [], rowSum = [], colSum = [];
    for (var c0 = 0; c0 < cols.length; c0++) { colSum.push(0); }
    plats.forEach(function (kv) {
      var v = [], s = 0;
      for (var ci = 0; ci < cols.length; ci++) {
        var n = model.pmMap.get(kv[0] + '\u0001' + cols[ci].key) || 0;
        v.push(n); s += n; colSum[ci] += n;
      }
      rws.push({ key: kv[0], name: kv[0], v: v, sum: s });
      vals.push(v); rowSum.push(s);
    });
    var total = rowSum.reduce(function (a, b) { return a + b; }, 0);
    state.matrixData = { rows: rws, cols: cols, values: vals, rowSum: rowSum, colSum: colSum, total: total,
      format: model.measureFormat || 'num', measure: mLbl };
    return '<div class="card2 full"><div class="ct-head"><h4>平台 × 月份 矩阵<small>格子里是' + esc(mLbl) + '（' +
      esc(model.measureFormat === 'pct' ? '百分比' : model.measureFormat === 'money' ? '金额' : '数值') +
      '），点一下＝只看这个平台＋这个月</small></h4></div>' +
      '<div id="mtx-root" style="min-height:120px"></div></div>';
  }

  /* 全站唯一的地区口径（语义层的 regionBucket），两条通道共用 */
  function regionOfRow(i) {
    var g = ensureRowRegions()[i];
    return regionBucket(g ? (g.d || g.c || g.p || '') : '', AnalysisModel.PLACES_LEVEL);
  }

  /* 把当前筛选拆成「能下推给 DuckDB 的」和「留给公式引擎收尾的」 */
  function buildFilterPlan() {
    return AnalysisModel.buildFilterPlan(state, params, { withinRadius: withinRadius });
  }

  /* SQL 版的聚合。能全下推就全下推（group by 也在 DuckDB 那边做）；
     有推不下去的条件（搜索词 / 半径）就先砍候选行、再在 JS 里用同一个谓词收尾。 */
  async function runSqlAnalysis() {
    var plan = buildFilterPlan();
    return AnalysisModel.buildAnalysisModelSql(Engine, plan, measureKey(), {
      allRows: state.rows,
      regionOf: regionOfRow
    });
  }

  function runAnalysis(key) {
    if (anaBusy) { return; }
    anaBusy = true;
    var box = $('dash');
    if (box) {
      box.innerHTML = '<div class="ana-loading"><span class="spin sm"></span>' +
        '<span>正在汇总 ' + state.rows.length.toLocaleString() + ' 条数据…</span></div>';
    }
    setAnaBusy(true);
    // 先让浏览器把"正在计算"画出来，再开始占用主线程，用户才知道是在算而不是卡死
    requestAnimationFrame(function () {
      setTimeout(async function () {
        var t0 = performance.now();
        /* 测试缝：需要"两条通道给出同一份结果"才能比对。
           平时不许打开，只有端到端用例会调 window.__cm.forceJs(true)。 */
        var useSql = !forceJs && Engine.engineStatus().status === 'ready' && state.engineOn;
        var model = null, via = 'JS';
        if (useSql) {
          try {
            var res = await runSqlAnalysis();
            if (res && res.model) { model = res.model; via = res.via; }
            else { via = 'JS'; }   // 一个条件都下推不了，绕 SQL 没意义
          } catch (e) { via = 'JS'; lastSqlError = String((e && e.message) || e); }
        }
        if (!model) { model = buildAnalysisModelJs(); }
        var ms = Math.round(performance.now() - t0);
        anaCache = { key: key, model: model, ms: ms, via: via };
        anaBusy = false;
        anaRunId++;
        paintAnalysis(model);
        setAnaStatus('用时 ' + ms + ' ms · ' + model.rows.length.toLocaleString() + ' 条记录 · ' +
          (model.placeCount != null ? model.placeCount : model.geoMap.size).toLocaleString() + ' 个' + coverageUnit() +
          (via === 'JS' ? '' : ' · ' + via) +
          (model.narrowedFrom ? '（先砍到 ' + model.narrowedFrom.toLocaleString() + ' 行）' : ''));
        // 算的过程中筛选又变了，就再算一次
        if (analysisKey() !== key) { renderAnalysis(); }
      }, 20);
    });
  }

  function renderAnalysis(opts) {
    var box = $('dash');
    if (!box) { return; }
    bindDashOnce();
    renderMeasureOptions();
    if (!state.rows.length) {
      state.chartData = null;
      box.innerHTML = '<div class="dash-head"><div class="dash-title">还没有数据</div>' +
        '<div class="dash-sub">先导入订单或客户数据，这里会自动生成分析</div></div>';
      setAnaStatus('还没有数据');
      return;
    }
    var key = analysisKey();
    var fresh = anaCache && anaCache.key === key;
    var force = !!(opts && opts.force);
    if (fresh && !force) {
      paintAnalysis(anaCache.model);
      setAnaStatus('用时 ' + anaCache.ms + ' ms · 结果已是最新' + (anaCache.via === 'SQL' ? ' · SQL' : ''));
      return;
    }
    if (!fresh && !force && !anaAuto()) {
      if (anaCache) { paintAnalysis(anaCache.model); }
      else { box.innerHTML = '<div class="ana-loading">筛选已经改变，点上面的「查询」开始分析</div>'; }
      setAnaStatus('筛选已改变，点「查询」刷新', true);
      return;
    }
    runAnalysis(key);
  }

  /* ---- 只重画某一张图（切样式时用，避免整页重排） ---- */
  function paintChartGroup(id) {
    var el = document.querySelector('#dash .ct-body[data-cg="' + id + '"]');
    if (!el) { return; }
    var items = (state.chartData && state.chartData[id]) || [];
    var o = {};
    var base = visualOf(id) || {};
    for (var k in base) { if (Object.prototype.hasOwnProperty.call(base, k)) { o[k] = base[k]; } }
    o.empty = (state.chartEmpty && state.chartEmpty[id]) || '暂无可分析的数据';
    o.width = Math.max(260, el.clientWidth || 0);
    var pref = chartPrefs()[id];
    if (!items.length) {
      el.innerHTML = chartPaint(id, pref, items, o);
      return;
    }
    // 表格保留原实现（数据密集、要能选中复制），其余画法统一交给 ECharts
    if (pref !== 'table') {
      var h = id === 'time' ? (o.height + 10) : (id === 'plat' ? 300 : 340);
      el.innerHTML = '';
      var host = document.createElement('div');
      el.appendChild(host);
      var pick = function (key) { dashClick(id, key); };
      // 供自动化测试直接验证"点图表 → 联动筛选"这条链路（绕开 ECharts 自身的鼠标命中）
      window.__cmPicks = window.__cmPicks || {};
      window.__cmPicks[id] = pick;
      /* 卡片 id 一路传下去：图表实例会挂到 window.__cmCharts[id]，测试和排障能读到画了什么 */
      if (id === 'time') { mountTrend(host, items, pref, pick); } else { mountChart(host, items, pref, h, pick, id); }
      state.chartRendered = (state.chartRendered || {});
      state.chartRendered[id] = 'echarts';
      return;
    }
    el.innerHTML = chartPaint(id, pref, items, o);
  }
  function paintAllCharts() { visualIds().forEach(paintChartGroup); }

  /* ---- 事件代理：只绑一次，重渲染后依然有效 ---- */
  function bindDashOnce() {
    var box = $('dash');
    if (!box || box.__bound) { return; }
    box.__bound = true;
    box.addEventListener('change', function (ev) {
      if (ev.target && ev.target.id === 'drill-mode') {
        state.drillMode = !!ev.target.checked;
        setTxt('drill-tip', state.drillMode ? '点柱子钻进下一级' : '点柱子飞到地图');
      }
    });
    box.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) { return; }
      var swBtn = t.closest('.chart-switch button');
      if (swBtn) {
        var wrap = swBtn.closest('.chart-switch');
        var gid = wrap.getAttribute('data-cs');
        var p = chartPrefs();
        p[gid] = swBtn.getAttribute('data-ct');
        lsSet('cm.charts', JSON.stringify(p));
        Array.prototype.forEach.call(wrap.querySelectorAll('button'), function (b) {
          if (b === swBtn) { b.className = 'on'; } else { b.className = ''; }
        });
        paintChartGroup(gid);
        return;
      }
      var mtxCell = t.closest('[data-mtx]');
      if (mtxCell) {
        var parts = mtxCell.getAttribute('data-mtx').split('|');
        applyMatrixPick(parts[0], parts[1]);
        return;
      }
      var crumb = t.closest('.drill-crumb');
      if (crumb) {
        drillTo(parseInt(crumb.getAttribute('data-drill'), 10));
        return;
      }
      var kEl = t.closest('[data-k]');
      if (kEl) {
        var holder = kEl.closest('[data-cg]');
        dashClick(holder ? holder.getAttribute('data-cg') : '', kEl.getAttribute('data-k'));
      }
    });
  }

  /* ---- 图表联动：时间 / 平台 / 地区 ---- */
  function dashClick(group, key) {
    if (group === 'time' && key) {
      var y = +key.slice(0, 4), mo = +key.slice(5, 7) - 1;
      var f = new Date(y, mo, 1).getTime(), t = new Date(y, mo + 1, 0, 23, 59, 59).getTime();
      if (state.timeFrom === f && state.timeTo === t) {
        state.timeFrom = null; state.timeTo = null; state.range = 'all';
        setVal('f-from', ''); setVal('f-to', '');
        toast('已取消时间筛选');
      } else {
        state.timeFrom = f; state.timeTo = t; state.range = 'custom';
        setVal('f-from', toDateStr(f)); setVal('f-to', toDateStr(t));
        toast('已筛选 ' + key);
      }
      invalidateView(); updateFilterSummary(); renderAnalysis(); renderTimeAxis();
    } else if (group === 'plat' && key) {
      state.platAll = false; state.platSet = new Set([key]);
      buildPlatformOptions(); invalidateView(); updateFilterSummary();
      renderAnalysis(); renderTimeAxis();
      toast('只看：' + key);
    } else if (group === 'geo' && key !== '') {
      if (state.drillMode) { drillInto(key); return; }
      var rep = (state.drillRep || {})[key];
      if (rep != null) { switchView('map'); selectRow(rep, true); }
    }
  }

  /* 对外只暴露 main.js 真正会用到的那几个。其余（钻取、问答解析、图表重画…）
     都是这个模块的内部细节，外面想用就得先在这里加一行 —— 接口是看得见的。 */
  return {
    renderAnalysis: renderAnalysis,
    chartPrefs: chartPrefs,
    measureKey: measureKey,
    answerQuestion: answerQuestion,
    anaAuto: anaAuto,
    setAnaStatus: setAnaStatus,
    setForceJs: function (on) { forceJs = !!on; },
    anaRuns: function () { return anaRunId; },
    lastSqlError: function () { return lastSqlError; },
    /* 窗口尺寸变了只重画图表，不重算数据 */
    paintAllCharts: paintAllCharts,
    /* 「Top N」这类只用重画的开关：已经有算好的模型就直接重画，不然什么都不做 */
    repaintCached: function () {
      if (anaCache && isAnalysisView()) { paintAnalysis(anaCache.model); }
    }
  };
}
