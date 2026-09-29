import { describe, it, expect } from 'vitest';
import {
  MEASURES, measureKeyOf, measureWeight, monthKey,
  buildAnalysisModelJs, sqlWhere, measureSql, buildFilterPlan
} from '../../src/analysis/model.js';

/* 分析计算层：给一批行 + 一个度量，产出 KPI / 平台分布 / 地区分布 / 月份趋势 / 矩阵。
   这层以前埋在 main.js 里，只能靠端到端用例兜。拆出来之后这里直接跑。 */

const mkRow = (o) => Object.assign({
  count: 0, plat: '', t: null, clean: '', raw: '', match: null, status: 'ok'
}, o);

const ROWS = [
  mkRow({ count: 3, plat: '京东', clean: '深圳A', t: new Date(2026, 8, 1, 8, 0, 0).getTime(),
    match: { p: '广东省', c: '深圳市', d: '福田区' } }),
  mkRow({ count: 5, plat: '京东', clean: '深圳B', t: new Date(2026, 8, 20, 8, 0, 0).getTime(),
    match: { p: '广东省', c: '深圳市', d: '南山区' } }),
  mkRow({ count: 2, plat: '天猫', clean: '杭州A', t: new Date(2026, 9, 3, 8, 0, 0).getTime(),
    match: { p: '浙江省', c: '杭州市', d: '余杭区' } }),
  mkRow({ count: 0, plat: '', clean: '没平台的', t: null, match: null })   // 无平台、无时间
];
const ALL = [0, 1, 2, 3];

/* 语义层里的"地区口径"桩：测试里直接指定每行属于哪个区县。
   真实运行时这个函数来自 ensureRowRegions() + regionBucket()。 */
const REGION_OF = (i) => ['440304', '440304', '330110', ''][i] || '';

describe('analysis-model / 度量', () => {
  it('客户数按 cnt 累加（cnt<=1 算 1）', () => {
    expect(measureWeight('cust', mkRow({ count: 5 }))).toBe(5);
    expect(measureWeight('cust', mkRow({ count: 1 }))).toBe(1);
    expect(measureWeight('cust', mkRow({ count: 0 }))).toBe(1);
  });
  it('记录数 / 覆盖地点每行算 1', () => {
    expect(measureWeight('rows', mkRow({ count: 9 }))).toBe(1);
    expect(measureWeight('places', mkRow({ count: 9 }))).toBe(1);
  });
  it('度量名不认识时回到客户数', () => {
    expect(measureKeyOf('cust')).toBe('cust');
    expect(measureKeyOf('nope')).toBe('cust');
    expect(measureKeyOf(undefined)).toBe('cust');
  });
  it('度量的 SQL 表达式来自语义层，覆盖地区按区县编码去重', () => {
    expect(MEASURES.cust.sql).toMatch(/sum\(cnt\)/);
    expect(MEASURES.rows.sql).toBe('count(*)');
    // 以前是 count(DISTINCT clean) —— 那会和地图的行政区口径对不上（实测差 52 个）。
    // 现在统一按区县编码去重，而且只算真的有区县编码的行。
    const sql = measureSql('places');
    expect(sql).toMatch(/count\(DISTINCT CASE WHEN length\(CAST\(adcode AS VARCHAR\)\) >= 6/);
    expect(sql).toMatch(/substr\(CAST\(adcode AS VARCHAR\), 1, 6\)/);
  });
  it('比率类度量的 SQL 是"先聚合再相除"，不是逐行相除', () => {
    const sql = measureSql('aov');
    expect(sql).toMatch(/sum\(amount\)/);
    expect(sql).toMatch(/nullif\(sum\(cnt\), 0\)/);
  });
  it('月份键按本地时区，和界面显示一致', () => {
    expect(monthKey(new Date(2026, 8, 1).getTime())).toBe('2026-09');
    expect(monthKey(new Date(2026, 11, 31).getTime())).toBe('2026-12');
  });
});

describe('analysis-model / JS 汇总', () => {
  it('客户数合计 = 各行 cnt 之和', () => {
    const m = buildAnalysisModelJs(ROWS, ALL, 'cust');
    expect(m.custSum).toBe(3 + 5 + 2 + 1);
  });
  it('覆盖地区度量下合计 = 去重后的区县数（按行政区编码，不是地址文本）', () => {
    // 前两行同一个区县、第三行另一个区县、第四行没有行政区 → 只算得出 2 个区县
    const m = buildAnalysisModelJs(ROWS, ALL, 'places', { regionOf: REGION_OF });
    expect(m.custSum).toBe(2);
    expect(m.placeCount).toBe(2);
  });
  it('平台分布按客户数累加，空平台归到「（未知平台）」', () => {
    const m = buildAnalysisModelJs(ROWS, ALL, 'cust');
    expect(m.platMap.get('京东')).toBe(8);
    expect(m.platMap.get('天猫')).toBe(2);
    expect(m.platMap.get('（未知平台）')).toBe(1);
  });
  it('月份趋势按月累加', () => {
    const m = buildAnalysisModelJs(ROWS, ALL, 'cust');
    expect(m.timeMap.get('2026-09')).toBe(8);
    expect(m.timeMap.get('2026-10')).toBe(2);
  });
  it('时间范围取最小 / 最大，并统计有多少行带时间', () => {
    const m = buildAnalysisModelJs(ROWS, ALL, 'cust');
    expect(m.withT).toBe(3);
    expect(m.minT).toBe(new Date(2026, 8, 1, 8, 0, 0).getTime());
    expect(m.maxT).toBe(new Date(2026, 9, 3, 8, 0, 0).getTime());
  });
  it('平台×月份矩阵用 \\u0001 拼键（避免平台名和月份撞车）', () => {
    const m = buildAnalysisModelJs(ROWS, ALL, 'cust');
    expect(m.pmMap.get('京东\u00012026-09')).toBe(8);
    expect(m.pmMap.get('天猫\u00012026-10')).toBe(2);
  });
  it('地区按行政区编码归并（和地图同一套口径），同一片累加', () => {
    const m = buildAnalysisModelJs(ROWS, ALL, 'cust', { regionOf: REGION_OF });
    // 前两行都是 440304（深圳福田）→ 3 + 5 = 8；第三行 330110（杭州余杭）；第四行没编码
    expect(m.geoMap.size).toBe(2);
    expect(m.custSum).toBe(3 + 5 + 2 + 1);
  });
  it('只传部分下标时只统计那部分', () => {
    const m = buildAnalysisModelJs(ROWS, [0, 1], 'cust', { regionOf: REGION_OF });
    expect(m.custSum).toBe(8);
    expect(m.rows.length).toBe(2);
    expect(m.geoMap.size).toBe(1);   // 两行都在同一个区县
  });
  it('空集不炸：合计 0，时间范围是初始值', () => {
    const m = buildAnalysisModelJs(ROWS, [], 'cust');
    expect(m.custSum).toBe(0);
    expect(m.withT).toBe(0);
    expect(m.minT).toBe(Infinity);
  });
});

describe('analysis-model / 筛选拆分（能下推的 vs 留给公式引擎的）', () => {
  const P = { onlyCount: false, onlyWithin: false };
  const S = {};
  const whereOf = (st, pr, deps) => buildFilterPlan(st, pr, deps).where;

  it('没有任何筛选时 WHERE 是空串，也没有残差', () => {
    const plan = buildFilterPlan({}, P);
    expect(plan.where).toBe('');
    expect(plan.sql.length).toBe(0);
    expect(plan.residual.length).toBe(0);
  });
  it('时间范围拼成 t >= / t <=，能下推', () => {
    const w = whereOf({ timeFrom: 100, timeTo: 200 }, P);
    expect(w).toContain('t >= 100');
    expect(w).toContain('t <= 200');
    expect(w.startsWith(' WHERE ')).toBe(true);
  });
  it('平台多选拼成 IN，并把单引号转义掉', () => {
    expect(whereOf({ platAll: false, platSet: new Set(['京东', "O'Brien"]) }, P))
      .toContain("plat IN ('京东','O''Brien')");
  });
  it('平台「全选」时不加平台条件', () => {
    expect(whereOf({ platAll: true, platSet: new Set(['京东']) }, P)).not.toContain('plat IN');
  });
  it('地区筛选按层级截取 adcode 位数：省 2 / 市 4 / 区县 6', () => {
    // 表达式里带 CAST —— adcode 全是数字，不转换 DuckDB 会当整数，length() 直接报错
    expect(whereOf({ regionFilter: { level: 'province', code: '440000' } }, P))
      .toContain("substr(CAST(adcode AS VARCHAR), 1, 2) = '44'");
    expect(whereOf({ regionFilter: { level: 'city', code: '440300' } }, P))
      .toContain("substr(CAST(adcode AS VARCHAR), 1, 4) = '4403'");
    expect(whereOf({ regionFilter: { level: 'district', code: '440304' } }, P))
      .toContain("substr(CAST(adcode AS VARCHAR), 1, 6) = '440304'");
  });
  it('框选拼成经纬度区间', () => {
    const w = whereOf({ boxBounds: { x1: 113, x2: 114, y1: 22, y2: 23 } }, P);
    expect(w).toContain('lng BETWEEN 113 AND 114');
    expect(w).toContain('lat BETWEEN 22 AND 23');
  });
  it('只看已定位 / 待解析', () => {
    expect(whereOf({ filter: 'ok' }, P)).toContain('lng IS NOT NULL');
    expect(whereOf({ filter: 'todo' }, P)).toContain('lng IS NULL');
  });
  it('只看有客户数的点 → cnt > 1', () => {
    expect(whereOf(S, { onlyCount: true, onlyWithin: false })).toContain('cnt > 1');
  });
  it('多个能下推的条件用 AND 串起来', () => {
    const w = whereOf({ timeFrom: 100, filter: 'ok' }, P);
    expect(w).toContain('t >= 100 AND lng IS NOT NULL');
  });

  /* ---- 下面几条是这个设计的关键：推不下去的绝不下推、也绝不悄悄放行 ---- */
  it('搜索词不下推（表里没有编号/电话列，下推会漏行），整条留给残差', () => {
    const plan = buildFilterPlan({ q: "深圳'特区" }, P);
    expect(plan.where).not.toContain('LIKE');
    expect(plan.residual.length).toBe(1);
    // 残差用的还是 rowMatches 那一套字段：能靠编号搜到
    const match = plan.residual[0];
    expect(match({ raw: 'x', clean: 'y', id: "深圳'特区", phones: [] })).toBe(true);
    expect(match({ raw: 'x', clean: 'y', id: '', phones: [] })).toBe(false);
  });
  it('半径筛选交给调用方给的谓词，不下推 SQL', () => {
    const within = () => false;
    const plan = buildFilterPlan(S, { onlyCount: false, onlyWithin: true }, { withinRadius: within });
    expect(plan.residual).toEqual([within]);
    expect(plan.mustUseJs).toBe(false);
  });
  it('开了半径但调用方没给谓词 → 标记必须走 JS，绝不当作没这个条件', () => {
    const plan = buildFilterPlan(S, { onlyCount: false, onlyWithin: true });
    expect(plan.mustUseJs).toBe(true);
    expect(sqlWhere(S, { onlyCount: false, onlyWithin: true })).toBe(null);
  });
  it('搜索词和半径能同时排进去：SQL 部分照常下推，两条件都留残差', () => {
    const plan = buildFilterPlan({ q: '福田', timeFrom: 100 }, { onlyCount: false, onlyWithin: true }, { withinRadius: () => true });
    expect(plan.where).toContain('t >= 100');
    expect(plan.residual.length).toBe(2);
  });
});
