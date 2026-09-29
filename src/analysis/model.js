/* 分析计算层（在语义层之上做聚合）
   ==================================================================
   这一层只干一件事：**把当前筛选下的行，按各个维度聚合成度量值**。

   度量怎么算、地区怎么分桶、日历怎么排 —— 全在 semantic.js（语义层）。
   这里负责"扫行 / 交给 SQL / 把结果摆成界面要的形状"。

   两条通道（Power BI 里也是这么分的）：
     · SQL 通道  —— 存储引擎（DuckDB）做 group by，主线程只收结果
     · JS 通道   —— 筛选条件下推不下去时的兜底（比如"只看常驻点半径内"）
   两条通道**必须给出一模一样的模型结构**，所以它们共用语义层的同一份定义。
   ------------------------------------------------------------------ */

import { monthStartMs, monthEndMs } from '../core/geo-core.js';
import {
  MEASURES, measureKeyOf, measureValue, sumKeysOf, formatValue,
  monthKey, regionBucket, regionSql, regionLen, DIMENSIONS, dimensionKeys,
  regionLevelOfCodes, coverageLabelOf, regionUnitOf
} from './semantic.js';

/* 度量定义表在语义层，这里原样转出去 —— 外部（配置、界面）一直是从这里拿的 */
export { MEASURES, measureKeyOf, monthKey, regionLevelOfCodes, coverageLabelOf, regionUnitOf };

/** @deprecated 用语义层的 measureValue 代替；保留是为了老调用点不炸 */
export function measureWeight(measure, r) {
  var d = MEASURES[measureKeyOf(measure)];
  return d.kind === 'sum' ? d.weight(r) : 1;
}

/** 覆盖地区按「区县」级去重（和地图分层着色在区县层级下的数字完全一致） */
export const PLACES_LEVEL = 'district';

/* 度量的 SQL 表达式（两条通道口径必须一致，所以放一起看） */
export function measureSql(measure) {
  var key = measureKeyOf(measure);
  var d = MEASURES[key];
  if (d.kind === 'calc') {
    // 比率类：分子分母各自聚合后再除，不能逐行除（DAX 的 DIVIDE 同一个道理）。
    // 定义里写了 sql 就用它（写得清楚），没写就按依赖项拼一个。
    if (d.sql) { return d.sql; }
    var num = d.deps[0], den = d.deps[1];
    return '(' + MEASURES[num].sql + ') / nullif(' + MEASURES[den].sql + ', 0)';
  }
  if (d.kind === 'distinct') {
    if (key === 'places') {
      // 只统计真的有区县编码的行，和地图那边同一条规则
      var rc = regionSql(PLACES_LEVEL, 'adcode');
      return 'count(DISTINCT CASE WHEN ' + rc.cond + ' THEN ' + rc.expr + ' END)';
    }
    return d.sql;
  }
  return d.sql;
}

/**
 * JS 通道：扫一遍行，按维度把度量聚合出来。
 * @param {any[]} allRows 全部行
 * @param {number[]} idx 当前筛选命中的行下标
 * @param {string} measure 度量 key
 * @param {{regionOf?: (i:number)=>string}} [opts] regionOf 提供"这行属于哪个行政区"（语义层统一口径）
 */
export function buildAnalysisModelJs(allRows, idx, measure, opts) {
  opts = opts || {};
  var measureKey = measureKeyOf(measure);
  var def = MEASURES[measureKey];
  var regionOf = opts.regionOf || function () { return ''; };
  var needPlaces = measureKey === 'places';
  var needShops = measureKey === 'shops';
  var needTime = true;

  /* 每个分组一个累加器。三种和一直累加（便宜），去重集合只在该度量需要时才建。 */
  function newAcc() {
    /* rep/hf/act/orders 是客户画像那组度量（数据里没有这些列时全是 0） */
    var a = { rows: 0, cust: 0, amount: 0, rep: 0, hf: 0, act: 0, orders: 0 };
    if (needPlaces) { a._set_places = new Set(); }
    if (needShops) { a._set_shops = new Set(); }
    return a;
  }
  function add(acc, r, i, rowId) {
    acc.rows += 1;
    acc.cust += r.count > 1 ? r.count : 1;
    acc.amount += Number(r.amount) || 0;
    acc.rep += Number(r.rep) || 0;
    acc.hf += Number(r.hf) || 0;
    acc.act += Number(r.act) || 0;
    acc.orders += Number(r.orders) || 0;
    if (needPlaces) { var rg = regionOf(i); if (rg) { acc._set_places.add(rg); } }
    if (needShops) { var sh = r.shop || ''; if (sh) { acc._set_shops.add(sh); } }
  }

  var total = newAcc();
  var rows = new Array(idx.length);
  var minT = Infinity, maxT = 0, withT = 0;

  /* 每个维度一张聚合表 —— 这是"通用维度"的关键：
     加维度只要在 semantic.js 的 DIMENSIONS 里加一行，这里自动就有了。 */
  var dims = dimensionKeys();
  var buckets = {};
  dims.forEach(function (d) { buckets[d] = new Map(); });
  var pmMap = new Map();   // 平台 × 月份：矩阵视觉对象专用的交叉表

  for (var i = 0; i < idx.length; i++) {
    var ri = idx[i];
    var r = allRows[ri];
    rows[i] = r;
    add(total, r, ri, i);
    if (r.t != null) {
      withT++;
      if (r.t < minT) { minT = r.t; }
      if (r.t > maxT) { maxT = r.t; }
    }
    for (var di = 0; di < dims.length; di++) {
      var dk = dims[di];
      var member = dk === 'region' ? regionOf(ri) : DIMENSIONS[dk].of(r, ri, { regionOf: regionOf });
      if (!member) { continue; }
      var m = buckets[dk];
      if (!m.has(member)) { m.set(member, newAcc()); }
      add(m.get(member), r, ri, i);
    }
    if (r.t != null) {
      var pmk = (r.plat || '（未知平台）') + '\u0001' + monthKey(r.t);
      if (!pmMap.has(pmk)) { pmMap.set(pmk, newAcc()); }
      add(pmMap.get(pmk), r, ri, i);
    }
  }

  function squeeze(m) {
    var out = new Map();
    m.forEach(function (acc, k) { out.set(k, measureValue(measureKey, acc)); });
    return out;
  }

  var dimMap = {};
  dims.forEach(function (dk) { dimMap[dk] = squeeze(buckets[dk]); });

  return {
    rows: rows, idx: idx,
    measureKey: measureKey, measureLabel: def.label, measureFormat: def.format || 'num',
    /* KPI 上用的大数（合计） */
    custSum: measureValue(measureKey, total),
    /* 通用维度聚合：任何视觉对象按 dimension 取用 */
    dimMap: dimMap,
    /* 老接口保留（视图层和测试一直在用），指向同一份数据 */
    platMap: dimMap.plat || new Map(),
    timeMap: dimMap.time || new Map(),
    geoMap: buckets.region || new Map(),
    pmMap: squeeze(pmMap),
    placeCount: (buckets.region || new Map()).size,
    minT: minT, maxT: maxT, withT: withT
  };
}

/* ================= 筛选拆成「能下推的」和「留给公式引擎的」 =================
   Power BI 的做法不是"要么全下推、要么全放弃"，而是：
   存储引擎先按能下推的条件把行砍掉，剩下的谓词在公式引擎里收尾。

   返回 { sql: [...条件], residual: [...(row, i) => boolean] }：
     sql      —— 交给 DuckDB 的 WHERE 片段（列式扫描 + group by 都在那边做）
     residual —— 推不下去的谓词；**必须作用在明细行上**，不能拿到聚合结果上过滤

   哪些推不下去、为什么：
     · 搜索词：JS 那边搜的是「原始地址 + 清洗地址 + 编号 + 电话」，而 DuckDB 表里
       只有清洗地址。拿 clean LIKE 去下推会把"靠编号/电话搜到"的行漏掉 ——
       所以整条留给残差，宁可慢一点也不能两个通道给出不同的行。
     · 半径：要拿常驻点坐标算球面距离。常驻点在 JS 侧、还会随时增删改，
       与其在 SQL 里复刻一遍 haversine（浮点边界上两边可能差一丝），
       不如让存储引擎先把候选行砍出来、再用**同一个** withinRadius 判一遍。 */
export function buildFilterPlan(state, params, deps) {
  deps = deps || {};
  var sql = [], residual = [];

  if (state.timeFrom != null) { sql.push('t >= ' + state.timeFrom); }
  if (state.timeTo != null) { sql.push('t <= ' + state.timeTo); }
  if (!state.platAll && state.platSet && state.platSet.size) {
    var list = [];
    state.platSet.forEach(function (k) { list.push("'" + String(k).replace(/'/g, "''") + "'"); });
    sql.push('plat IN (' + list.join(',') + ')');
  }
  if (state.regionFilter) {
    var rf = state.regionFilter;
    var rn = regionLen(rf.level);
    // 用语义层那一个表达式，别在这里再手写一遍 substr（两处不一致就又是两套口径）
    sql.push(regionSql(rf.level, 'adcode').expr + " = '" + rf.code.slice(0, rn) + "'");
  }
  if (state.boxBounds) {
    var b = state.boxBounds;
    sql.push('lng BETWEEN ' + b.x1 + ' AND ' + b.x2 + ' AND lat BETWEEN ' + b.y1 + ' AND ' + b.y2);
  }
  if (state.filter === 'ok') { sql.push('lng IS NOT NULL'); }
  if (state.filter === 'todo') { sql.push('lng IS NULL'); }
  if (params.onlyCount) { sql.push('cnt > 1'); }

  /* 搜索词：JS 那边还搜编号和电话，而表里只有清洗地址 —— 下推会漏行，整条留给残差 */
  if (state.q) { residual.push(makeSearchFilter(state.q)); }

  /* 半径：要拿常驻点算球面距离，交给"先砍行再收尾"。 */
  var mustUseJs = false;
  if (params.onlyWithin) {
    if (deps.withinRadius) { residual.push(deps.withinRadius); }
    else {
      /* 调用方没给谓词 —— **绝不能当作没这个条件放行**，那样会静默多出数据。
         标记成必须走 JS，由调用方退回完整路径（那边会照常应用半径）。 */
      mustUseJs = true;
    }
  }

  return {
    sql: sql, residual: residual, mustUseJs: mustUseJs,
    where: sql.length ? (' WHERE ' + sql.join(' AND ')) : ''
  };
}

/* 搜索词的行内判断 —— 和 rowMatches 里那一段保持同一套字段，别只搜 clean */
function makeSearchFilter(raw) {
  var q = String(raw).toLowerCase();
  return function (r) {
    var hay = (r.raw + ' ' + r.clean + ' ' + (r.id || '') + ' ' + (r.phones || []).join(' ')).toLowerCase();
    return hay.indexOf(q) >= 0;
  };
}

/** 兼容老调用：能全下推就返回 WHERE，否则返回 null（调用方走 JS） */
export function sqlWhere(state, params) {
  var plan = buildFilterPlan(state, params);
  return (plan.mustUseJs || plan.residual.length) ? null : plan.where;
}

/* SQL 版的分析聚合：几十万行的 group by 交给 DuckDB，主线程只收结果。
   度量表达式来自语义层，和 JS 通道是同一份定义 —— 这是两条路能对上数的前提。 */
export async function buildAnalysisModelSql(Engine, plan, measure, opts) {
  opts = opts || {};
  var where = plan.where;

  /* 有推不下去的条件：先让存储引擎按能下推的部分把候选行砍出来，
     再在 JS 里用同一个谓词收尾 + 聚合。
     注意残差必须作用在**明细行**上 —— 不能等 SQL 聚合完再过滤，那样口径就错了。 */
  if (plan.mustUseJs || (plan.residual && plan.residual.length)) {
    // 必须走完整 JS 路径的两种情况：调用方没给残差谓词；或者一个条件都下推不了
    // （那样绕一圈 SQL 只是白跑，还要把全部 idx 拉回来）
    if (plan.mustUseJs || !plan.sql.length) { return { model: null, via: 'JS' }; }
    var t1 = performance.now();
    var idxRows = await Engine.query('SELECT idx FROM rows' + where);
    var allRows = opts.allRows || [];
    var kept = [];
    for (var i = 0; i < idxRows.length; i++) {
      var ri = Number(idxRows[i].idx);
      var r = allRows[ri];
      if (!r) { continue; }
      var ok = true;
      for (var f = 0; f < plan.residual.length; f++) {
        if (!plan.residual[f](r, ri)) { ok = false; break; }
      }
      if (ok) { kept.push(ri); }
    }
    var model = buildAnalysisModelJs(allRows, kept, measure, { regionOf: opts.regionOf });
    model.narrowedMs = Math.round(performance.now() - t1);
    model.narrowedFrom = Number(idxRows.length);
    return { model: model, via: 'SQL→JS' };
  }

  var t0 = performance.now();
  var key = measureKeyOf(measure);
  var def = MEASURES[key];
  var M = measureSql(key);
  /* 「覆盖区县」必须和 JS 通道、地图用同一条规则 —— 以前这里写的是
     count(DISTINCT adcode)，那是"叶子编码"（省/市/县混在一起），
     和另外两边差着几十个数，而且从来没人发现，因为 SQL 通道压根没有测试。 */
  var rc = regionSql(PLACES_LEVEL, 'adcode');
  var placesExpr = 'count(DISTINCT CASE WHEN ' + rc.cond + ' THEN ' + rc.expr + ' END)';
  var kpi = (await Engine.query('SELECT count(*) AS n, ' + M + ' AS cust, ' +
    'count(DISTINCT plat) AS plats, ' + placesExpr + ' AS places FROM rows' + where))[0];
  /* 按维度循环产出聚合表 —— 和 JS 通道的 dimMap 一一对应。
     以前这里只硬编码了时间和平板两张，于是"店铺分布"这类新加的视觉对象
     在 SQL 通道下**永远是空的**，而 JS 通道正常（这个不对称是被新用例抓出来的）。 */
  var dims = dimensionKeys();
  var dimMap = {};
  for (var di = 0; di < dims.length; di++) {
    var dk = dims[di], dd = DIMENSIONS[dk];
    var dRows = await Engine.query('SELECT ' + dd.sql + ' AS k, ' + M + ' AS v FROM rows' + where +
      (where ? ' AND ' : ' WHERE ') + dd.cond + ' GROUP BY 1');
    var dm = new Map();
    dRows.forEach(function (r) { if (r.k != null) { dm.set(r.k, Number(r.v) || 0); } });
    dimMap[dk] = dm;
  }
  var pmRows = await Engine.query("SELECT plat, strftime(to_timestamp(t/1000), '%Y-%m') AS mk, " +
    M + ' AS v FROM rows' + where + (where ? ' AND ' : ' WHERE ') + 't IS NOT NULL GROUP BY 1,2');
  var pm = new Map();
  pmRows.forEach(function (r) { pm.set(r.plat + '\u0001' + r.mk, Number(r.v) || 0); });
  var tm = dimMap.time || new Map();
  var pl = dimMap.plat || new Map();
  var mk = Array.from(tm.keys()).sort();
  var rows = new Array(Number(kpi.n));
  return {
    model: {
      rows: rows, idx: null,
      measureKey: key, measureLabel: def.label, measureFormat: def.format || 'num',
      custSum: Number(kpi.cust) || 0,
      platMap: pl, pmMap: pm, timeMap: tm,
      dimMap: dimMap,
      minT: mk.length ? monthStartMs(mk[0]) : 0,
      maxT: mk.length ? monthEndMs(mk[mk.length - 1]) : 0,
      withT: tm.size ? 1 : 0,
      placeCount: Number(kpi.places) || 0,
      geoMap: { size: Number(kpi.places) || 0 },
      sqlMs: Math.round(performance.now() - t0)
    },
    via: 'SQL'
  };
}
