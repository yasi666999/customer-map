/* 语义层（对应 Power BI 的「模型」这一层）
   ==================================================================
   抄 Power BI 的模型层，核心是三件事：

   1. **维度（Dimension）—— 一个维度只有一种口径。**
      改之前项目里"地区"有三套算法：地图按行政区编码、分析页按"省+市+区"名字拼串、
      SQL 路径按清洗后地址文本去重。同一份数据、同一个筛选，三个口径给出三个不同的数 ——
      而且各自都能自圆其说，这本身就是问题。
      现在钉死成一种：**行政区编码（adcode）**，地图早就在用，分析页改过来。

   2. **度量（Measure）—— 是定义，不是代码。**
      原来 MEASURES 里写死 3 个，加一个指标要改代码 + 改 HTML 下拉 + 改测试。
      现在是一张定义表：声明"怎么算"，UI 从表里生成下拉。

   3. **日期表（Date table）—— 连续日历。**
      Power BI 的时间智能（环比/同比）建立在连续日期上，缺月记 0。
      原来"环比"取的是"上一个有数据的月"，7 月没单就把 6 月和 9 月比。

   这个文件是**纯定义 + 纯函数**，不认识 state、不碰 DOM，可以直接单测。
   ------------------------------------------------------------------ */

/* ================= 一、维度 ================= */

/* 地区层级 → 编码位数。和地图的 regionAgg 完全对齐：
   - 省级：取前 2 位（直辖市也是 2 位）
   - 市级：取前 4 位
   - 区县：完整 6 位
   注意"市级"只统计真的有市级编码的行（长度 ≥ 4），"省级"统计长度 ≥ 2 的行 ——
   和地图那边逐级归集的规则一模一样，这样两边永远对得上。 */
export const REGION_LEVELS = [
  { key: 'province', label: '省', len: 2 },
  { key: 'city', label: '市', len: 4 },
  { key: 'district', label: '区县', len: 6 }
];

export function regionLen(level) {
  var hit = REGION_LEVELS.filter(function (l) { return l.key === level; })[0];
  return hit ? hit.len : 2;
}
export function regionLevelLabel(level) {
  var hit = REGION_LEVELS.filter(function (l) { return l.key === level; })[0];
  return hit ? hit.label : '省';
}

/**
 * 把一个行政区编码按层级归桶。**这是全站唯一的地区口径。**
 * @param {string} adcode 行政区编码（省 2 位 / 市 4 位 / 区县 6 位，可能更短或为空）
 * @param {string} level province | city | district
 * @returns {string} 归桶后的编码；不够长则返回 ''（表示"这一级它归不进去"）
 */
export function regionBucket(adcode, level) {
  var s = String(adcode == null ? '' : adcode).replace(/\D/g, '');
  var n = regionLen(level);
  if (s.length < n) { return ''; }
  return s.slice(0, n);
}

/**
 * 地区维度的 SQL 表达式（和 regionBucket 一个规则，两条通道口径必须一致）。
 * 显式 CAST 成 VARCHAR：adcode 是由数字组成的编码，DuckDB 自动嗅探会把它当整数，
 * 而 length() 对整数没有匹配的函数（实测踩过，而且错误被静默吞掉了）。
 */
export function regionSql(level, col) {
  var c = 'CAST(' + (col || 'adcode') + ' AS VARCHAR)';
  var n = regionLen(level);
  return { expr: 'substr(' + c + ', 1, ' + n + ')', cond: 'length(' + c + ') >= ' + n };
}

/* 维度表。**加一个分析维度 = 在这里加一行** —— 模型会自动为它产出聚合，
   视觉对象只要声明 dimension 就能用（不用再改计算代码）。

   每个维度声明三件事：
     of(r, i, ctx) —— 这一行归到哪个成员（JS 通道用）
     sql           —— 对应的 SQL 表达式（SQL 通道用）
     cond          —— 这个成员有效的前提（比如时间要有值、地区至少 6 位编码）
   两条通道共用同一份声明，这是"两边对得上数"的前提。 */
export const DIMENSIONS = {
  time: {
    key: 'time', label: '月份', kind: 'time',
    of: function (r) { return r.t == null ? '' : monthKey(r.t); },
    sql: "strftime(to_timestamp(t/1000), '%Y-%m')",
    cond: 't IS NOT NULL'
  },
  plat: {
    key: 'plat', label: '平台', kind: 'category',
    of: function (r) { return r.plat || '（未知平台）'; },
    sql: 'plat',
    cond: "plat IS NOT NULL"
  },
  region: {
    key: 'region', label: '地区', kind: 'region',
    of: null,   // 地区走 regionOf（行政区编码），由调用方注入
    // 和 regionSql 一个规则，也带 CAST（adcode 会被 DuckDB 嗅探成整数）
    sql: 'substr(CAST(adcode AS VARCHAR), 1, 6)',
    cond: 'length(CAST(adcode AS VARCHAR)) >= 6'
  },
  /* 客户规模：把"这个点有多少客户"分档。
     用来回答"客户是集中在少数几个点，还是均匀铺开"——
     光看地区排行看不出这个。 */
  size: {
    key: 'size', label: '客户规模', kind: 'category',
    of: function (r) { return sizeBucketOf(r.count); },
    sql: "CASE WHEN cnt >= 1000 THEN '1000 以上' WHEN cnt >= 100 THEN '100–999' " +
      "WHEN cnt >= 10 THEN '10–99' ELSE '1–9' END",
    cond: 'true'
  },
  shop: {
    key: 'shop', label: '店铺', kind: 'category',
    of: function (r) { return r.shop || '（未知店铺）'; },
    sql: 'shop',
    cond: "shop IS NOT NULL AND shop <> ''"
  },
  /* 客户画像（粗）：用"人均单量"把每个地点×平台×店铺的客户粗分成四档。
     为什么用人均单量：这份数据里能反映客户价值的就是"下过几单"（没有金额、没有年龄性别）。
     阈值 personaBucketOf() 与 SQL 里的 CASE 必须一模一样，否则两条通道会对不上。 */
  persona: {
    key: 'persona', label: '客户画像', kind: 'category',
    of: function (r) { return personaBucketOf(r.orders, r.count); },
    sql: "CASE WHEN orders IS NULL OR cnt IS NULL OR cnt = 0 THEN NULL " +
      "WHEN orders / cnt <= 1.2 THEN '一次性为主' " +
      "WHEN orders / cnt <= 3 THEN '复购型' " +
      "WHEN orders / cnt <= 6 THEN '高频复购' " +
      "ELSE '重度客户' END",
    cond: 'true'
  }
};

/* 画像分档规则（JS 与 SQL 两条通道共用同一套边界）。
   orders = 这段里的订单数，cust = 去重客户数；没有这两列的老数据返回 ''（不进画像）。 */
export var PERSONA_BUCKETS = [
  { max: 1.2, label: '一次性为主', note: '人均 1 单出头，基本不复购' },
  { max: 3, label: '复购型', note: '人均 1~3 单，有复购但不频繁' },
  { max: 6, label: '高频复购', note: '人均 3~6 单，是回头客主力' },
  { max: Infinity, label: '重度客户', note: '人均 6 单以上，最值钱的一批' }
];
export function personaBucketOf(orders, cust) {
  var o = Number(orders) || 0, c = Number(cust) > 0 ? Number(cust) : 0;
  if (!o || !c) { return ''; }
  var f = o / c;
  for (var i = 0; i < PERSONA_BUCKETS.length; i++) {
    if (f <= PERSONA_BUCKETS[i].max) { return PERSONA_BUCKETS[i].label; }
  }
  return PERSONA_BUCKETS[PERSONA_BUCKETS.length - 1].label;
}

/* 客户规模的分档规则。JS 和 SQL 两条通道必须用同一套边界，
   否则同一个问题两个答案（这个坑在"覆盖地区"上踩过一次）。 */
export var SIZE_BUCKETS = [
  { min: 1000, label: '1000 以上' },
  { min: 100, label: '100–999' },
  { min: 10, label: '10–99' },
  { min: 1, label: '1–9' }
];
export function sizeBucketOf(count) {
  var n = Number(count) > 1 ? Number(count) : 1;
  for (var i = 0; i < SIZE_BUCKETS.length; i++) {
    if (n >= SIZE_BUCKETS[i].min) { return SIZE_BUCKETS[i].label; }
  }
  return '1–9';
}

/**
 * 一批行政区编码 → 这份数据"实际到哪一级"（province / city / district）。
 *
 * 规则看编码后两位：110101 → 区县码；110100 → 市级码；110000 → 省级码。
 * **按行数取多数**，不是"只要有一行是区县就算区县"：
 * 地名再解析时偶尔会把市级标签里的短名匹到区县（"湖南省长沙市" 里的 "长沙" 会命中 "长沙县"），
 * 几万行里混进几百行很正常，不能因为这几百行就把整个口径说成区县级。
 *
 * @param {Array<string|{d?:string}>} codes 编码数组，或 rowRegions 那种 { d: 编码 } 数组
 */
export function regionLevelOfCodes(codes) {
  var nD = 0, nC = 0, nP = 0;
  for (var i = 0; i < codes.length; i++) {
    var raw = codes[i];
    var s = String(raw == null ? '' : (typeof raw === 'object' ? raw.d : raw)).replace(/\D/g, '');
    if (s.length >= 6 && s.slice(4) !== '00') { nD++; }
    else if (s.length >= 4 && s.slice(2, 4) !== '00') { nC++; }
    else if (s) { nP++; }
  }
  if (nD > nC) { return 'district'; }
  if (nC > 0) { return 'city'; }
  return 'province';
}

/** 覆盖范围的叫法：覆盖区县 / 覆盖城市 / 覆盖省份 */
export function coverageLabelOf(level) {
  return level === 'district' ? '覆盖区县' : (level === 'city' ? '覆盖城市' : '覆盖省份');
}

/** 覆盖范围的量词：区县 / 城市 / 省份 */
export function regionUnitOf(level) {
  return level === 'district' ? '区县' : (level === 'city' ? '城市' : '省份');
}

/** 维度列表（模型遍历它产出聚合；视觉对象按 key 取用） */
export function dimensionKeys() { return Object.keys(DIMENSIONS); }

/* ================= 二、度量 ================= */

/* 度量定义表。三种类型：
     sum      —— 逐行累加（count / sum 都属于这种：记录数的权重恒为 1）
     distinct —— 去重计数，按分组收集
     calc     —— 派生度量（比率类），引用其它度量的结果（相当于 DAX 的 DIVIDE）
   加一个指标 = 加一行定义；UI 的下拉和分析都是从这里读的。 */
export const MEASURES = {
  cust: {
    label: '客户数', kind: 'sum', format: 'num',
    sql: 'CAST(sum(cnt) AS BIGINT)',
    weight: function (r) { return r.count > 1 ? r.count : 1; }
  },
  rows: {
    label: '记录数', kind: 'sum', format: 'num',
    sql: 'count(*)',
    weight: function () { return 1; }
  },
  amount: {
    label: '成交金额', kind: 'sum', format: 'money',
    sql: 'sum(amount)',
    weight: function (r) { return Number(r.amount) || 0; }
  },
  places: {
    label: '覆盖地区', kind: 'distinct', format: 'num',
    sql: 'count(DISTINCT {region})',   // {region} 由当前层级替换
    key: function (r, i, regionOf) { return regionOf ? regionOf(i) : ''; }
  },
  shops: {
    label: '店铺数', kind: 'distinct', format: 'num',
    sql: 'count(DISTINCT shop)',
    key: function (r) { return r.shop || ''; }
  },
  aov: {
    label: '客单价', kind: 'calc', format: 'money',
    sql: 'sum(amount) / nullif(sum(cnt), 0)',   // 分母为 0 时给 null，不是报错
    deps: ['amount', 'cust'],
    value: function (a) { return a.cust ? a.amount / a.cust : 0; }
  },
  /* —— 客户画像用的度量。数据里要有对应列（聚合工具会写出来），没有就都是 0 —— */
  /* 复购客户数：这个分组里累计下过 ≥2 单的客户（按整份数据全时段算，不是只看本行） */
  rep: {
    label: '复购客户数', kind: 'sum', format: 'num',
    sql: 'CAST(sum(rep) AS BIGINT)',
    weight: function (r) { return Number(r.rep) || 0; }
  },
  /* 高频客户数：累计 ≥10 单 */
  highfreq: {
    label: '高频客户数', kind: 'sum', format: 'num',
    sql: 'CAST(sum(hf) AS BIGINT)',
    weight: function (r) { return Number(r.hf) || 0; }
  },
  /* 活跃客户数：最后一次下单在数据最新月份往前 3 个月内（不是"沉睡客"） */
  active: {
    label: '活跃客户数', kind: 'sum', format: 'num',
    sql: 'CAST(sum(act) AS BIGINT)',
    weight: function (r) { return Number(r.act) || 0; }
  },
  orders: {
    label: '订单数', kind: 'sum', format: 'num',
    sql: 'CAST(sum(orders) AS BIGINT)',
    weight: function (r) { return Number(r.orders) || 0; }
  },
  repRate: {
    label: '复购率（分组）', kind: 'calc', format: 'pct',
    sql: 'sum(rep) / nullif(sum(cnt), 0)',
    deps: ['rep', 'cust'],
    value: function (a) { return a.cust ? (a.rep || 0) / a.cust : 0; }
  },
  activeRate: {
    label: '活跃率（分组）', kind: 'calc', format: 'pct',
    sql: 'sum(act) / nullif(sum(cnt), 0)',
    deps: ['active', 'cust'],
    value: function (a) { return a.cust ? (a.act || 0) / a.cust : 0; }
  },
  freq: {
    label: '人均单量（分组）', kind: 'calc', format: 'num1',
    sql: 'sum(orders) / nullif(sum(cnt), 0)',
    deps: ['orders', 'cust'],
    value: function (a) { return a.cust ? (a.orders || 0) / a.cust : 0; }
  }
};

/** 度量名的兜底：配置里存了个不认识的值就回到"客户数" */
export function measureKeyOf(measure) { return MEASURES[measure] ? measure : 'cust'; }

/** 给界面生成下拉用的列表（顺序 = 定义顺序） */
export function measureList() {
  return Object.keys(MEASURES).map(function (k) {
    return { key: k, label: MEASURES[k].label, format: MEASURES[k].format || 'num' };
  });
}

/** 这个度量要收集哪些"和"（派生度量需要它的依赖项） */
export function sumKeysOf(measure) {
  var d = MEASURES[measureKeyOf(measure)];
  if (d.kind === 'sum') { return [measureKeyOf(measure)]; }
  if (d.kind === 'calc') { return d.deps.slice(); }
  return [];
}

/** 在"一个分组的累加器"上求这个度量的值 —— 相当于 DAX 在筛选上下文里估值 */
export function measureValue(measure, acc) {
  var key = measureKeyOf(measure);
  var d = MEASURES[key];
  if (d.kind === 'sum') { return acc[key] || 0; }
  if (d.kind === 'calc') { return d.value(acc); }
  // distinct
  var set = acc['_set_' + key];
  return set ? set.size : 0;
}

/* 数字格式。两种口径，故意不一样：
     num   —— 精确数字 + 千分位。KPI 是给人看准数的（"123,456"），缩写反而看不清。
     money —— 缩写（元 / 万 / 亿）。金额动辄七八位数，精确写出来卡片放不下。
   这也是 Power BI 的做法：格式跟着**度量**走，不跟着控件走。 */
export function formatValue(v, format) {
  var n = Number(v) || 0;
  var sign = n < 0 ? '-' : '';
  var a = Math.abs(n);
  if (format === 'money') {
    if (a >= 100000000) { return sign + (a / 100000000).toFixed(2) + ' 亿'; }
    if (a >= 10000) { return sign + (a / 10000).toFixed(2) + ' 万'; }
    return sign + a.toFixed(2);
  }
  /* 比率：内部一律存 0~1 的小数，显示时再乘 100 —— 免得有的地方存百分数有的地方存小数 */
  if (format === 'pct') { return sign + (a * 100).toFixed(1) + '%'; }
  /* 一位小数（人均单量这种"4.6 单"） */
  if (format === 'num1') { return sign + a.toFixed(1); }
  return sign + Math.round(a).toLocaleString();
}

/* ================= 三、日期表 ================= */

/** 'YYYY-MM' → 自 1970-01 起的月份序号（用来做日历运算） */
export function monthIndex(mk) {
  var p = String(mk).split('-');
  return (+p[0]) * 12 + (+p[1] - 1);
}
export function monthKeyOfIndex(n) {
  var y = Math.floor(n / 12), m = (n % 12) + 1;
  return y + '-' + String(m).padStart(2, '0');
}

/** 日历上的上一个月（不是"上一个有数据的月"） */
export function prevMonth(mk) { return monthKeyOfIndex(monthIndex(mk) - 1); }

/**
 * 生成一段连续月份（日期表）。缺的月补上，值为 0 ——
 * 这样环比永远拿的是日历上个月，而不是"上一个有数据的月"。
 * @param {string[]} keys 数据里出现过的月份（'YYYY-MM'）
 * @param {number} [pad] 前后各留几个月（默认 0）
 */
export function calendarMonths(keys, pad) {
  var list = (keys || []).filter(Boolean).slice().sort();
  if (!list.length) { return []; }
  var a = monthIndex(list[0]) - (pad || 0);
  var b = monthIndex(list[list.length - 1]) + (pad || 0);
  var out = [];
  for (var i = a; i <= b; i++) { out.push(monthKeyOfIndex(i)); }
  return out;
}

/** 时间戳 → 'YYYY-MM'（本地时区，和界面上显示的月份一致） */
export function monthKey(t) {
  var d = new Date(t);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
