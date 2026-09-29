/* 视觉对象声明表（对应 Power BI 的「视觉对象」这一层）
   ==================================================================
   Power BI 里一个视觉对象是**声明**出来的，不是写死的代码：
     它属于哪个维度、用哪个度量、能换哪几种画法、摆在哪儿。

   这个文件把那张表搬过来。加一个视觉对象 = 在这里加一行 ——
   卡片、标题、提示语、图表切换器、偏好存储、空状态全都自动跟上，
   不用再去 paintAnalysis 里改拼 HTML 的代码。

   改之前是两张分开的表（CHART_TYPES 管"有哪几种画法"、CHART_OPTS 管
   "颜色多高上限多少"），再加上 paintAnalysis 里三段硬编码的卡片 HTML ——
   同一个视觉对象的信息散在三个地方，加一个就得同时改三处。
   ------------------------------------------------------------------ */

/**
 * 视觉对象声明表。字段含义：
 *   id        —— 唯一标识，也是 DOM 上的 data-cg / data-cs，测试直接按它选
 *   title     —— 卡片标题
 *   span      —— 'full' 占满一行，'half' 并排
 *   dimension —— 用的是哪个维度（time / plat / region），和语义层的维度对齐
 *   styles    —— 能切换的画法 [值, 显示名]；第一项之外的顺序就是按钮顺序
 *   items     —— 从分析模型里取出这个视觉对象的行：给 (model, ctx) 返回 [{label,v,click}]
 *   limit     —— 取前 N 的逻辑（可空）：{ by:'topN', other: (n) => '其他 N 项' }
 *   empty     —— 空状态文案
 */
/* 卡片提示语里用的小数字格式（"1.2 万"）。这个文件是纯声明表，不引别的模块，所以自己写一个。 */
function shortNumOf(v) {
  var n = Number(v) || 0;
  if (n >= 100000000) { return (n / 100000000).toFixed(1) + ' 亿'; }
  if (n >= 10000) { return (n / 10000).toFixed(1) + ' 万'; }
  return Math.round(n).toLocaleString();
}

/* 规模分档的显示顺序（从大到小）—— 分档有天然顺序，不能按值排 */
const SIZE_ORDER = ['1000 以上', '100–999', '10–99', '1–9'];

/**
 * 从模型里按维度取"成员 → 度量值"。
 * @param {string[]} [order] 指定顺序（比如客户规模要从大到小分档），不传就按值降序
 */
function fromDim(model, dim, order) {
  var m = (model.dimMap && model.dimMap[dim]) || new Map();
  var list = Array.from(m.entries());
  if (order) {
    list.sort(function (a, b) { return order.indexOf(a[0]) - order.indexOf(b[0]); });
  } else {
    list.sort(function (a, b) { return b[1] - a[1]; });
  }
  return list.map(function (kv) { return { label: kv[0], v: kv[1], click: kv[0] }; });
}

/** 只有一个"未知 XX"时这张图没意义，直接给空（空状态会说明原因） */
function hideUnknownOnly(items) {
  var onlyUnknown = items.length === 1 && String(items[0].label).indexOf('未知') >= 0;
  return onlyUnknown ? [] : items;
}

export const VISUALS = [
  {
    id: 'time',
    title: '时间趋势',
    span: 'full',
    dimension: 'time',
    color: '#0071e3',
    height: 220,
    styles: [['bar', '柱状'], ['line', '折线'], ['area', '面积'], ['cumulative', '累计'], ['table', '表格']],
    defaultStyle: 'bar',
    seriesLimit: 60,
    tableLimit: 16,
    hint: function (model, s) {
      return model.withT
        ? '取自 ' + (s.timeCol || '时间') + '，点一下图形可筛选该月'
        : '未识别到时间列';
    },
    empty: function (model) {
      return model.withT ? '当前筛选下没有时间数据' : '数据里没有可用的时间列（优先识别 create_time）';
    },
    items: function (model, ctx) {
      return Array.from(model.timeMap.keys()).sort().map(function (k) {
        return { label: ctx.fmtMonth(k), v: model.timeMap.get(k), click: k };
      });
    }
  },
  {
    id: 'plat',
    title: '平台分布',
    span: 'half',
    dimension: 'plat',
    color: '#0071e3',
    height: 210,
    styles: [['hbar', '条形'], ['pie', '饼图'], ['donut', '环形'], ['pareto', '帕累托'], ['table', '表格']],
    defaultStyle: 'hbar',
    seriesLimit: 20,
    tableLimit: 14,
    hint: function (model, s) { return '点一下只看该平台'; },
    empty: function (model, s) { return '数据里没有平台列，或全都是未知平台'; },
    limit: { by: 'topN', other: function (n) { return '其他 ' + n + ' 个平台'; } },
    items: function (model) { return fromDim(model, 'plat'); },
    postprocess: hideUnknownOnly
  },
  {
    id: 'geo',
    title: '地区排行',
    span: 'half',
    dimension: 'region',
    color: '#ff9500',
    height: 210,
    styles: [['hbar', '排行'], ['bar', '柱状'], ['pie', '饼图'], ['pareto', '帕累托'], ['table', '表格']],
    defaultStyle: 'hbar',
    seriesLimit: 20,
    tableLimit: 14,
    hint: function (model, s) { return s.drillMode ? '点柱子钻进下一级' : '点柱子飞到地图'; },
    empty: function (model, s) { return '还没有解析出地理位置，先点「开始解析」'; },
    limit: { by: 'topN', other: function (n) { return '其他 ' + n + ' 项'; } },
    /* 地区排行不走分析模型，走地图那边的行政区聚合（同一套口径，还带下钻） */
    items: function (model, ctx) { return ctx.drillItems(); },
    /* 这张卡片标题下面多一条面包屑（钻取用） */
    barHtml: function (ctx) { return ctx.drillBarHtml(); }
  },
  {
    /* 这是加进来的第 4 个视觉对象 —— 整个改动就是这一块：
       声明"我是哪个维度、能换哪几种画法"，取数和卡片都自动跟上。
       数据那条路（店铺维度）已经在 semantic.js 的 DIMENSIONS 里声明好了。 */
    id: 'shop',
    title: '店铺分布',
    span: 'half',
    dimension: 'shop',
    color: '#34c759',
    height: 210,
    styles: [['hbar', '条形'], ['pie', '饼图'], ['donut', '环形'], ['pareto', '帕累托'], ['table', '表格']],
    defaultStyle: 'hbar',
    seriesLimit: 20,
    tableLimit: 14,
    hint: function (model, s) { return '点一下只看该店铺'; },
    empty: function (model, s) {
      /* 空状态要说"怎么办"，不能只说"没有"：这份数据确实常缺店铺列，
         但目录里就有一份带店铺的汇总文件，直接告诉他导哪个。 */
      return '这份数据没有店铺列（导入「汇总_按城市_店铺_三维.csv」就能看店铺维度）';
    },
    limit: { by: 'topN', other: function (n) { return '其他 ' + n + ' 个店铺'; } },
    items: function (model) { return fromDim(model, 'shop'); },
    postprocess: hideUnknownOnly
  },
  {
    /* 客户画像（粗）：用"人均单量"把客户粗分成四档 —— 一次性为主 / 复购型 / 高频复购 / 重度客户。
       这份数据里能反映客户价值的只有"下过几单"（没有金额、年龄、性别），所以画像就是 RFM 里的 F 轴。
       和别的卡片一样：维度声明在 semantic.js（DIMENSIONS.persona），这里只声明"怎么显示"。 */
    id: 'persona',
    title: '客户画像（粗）',
    span: 'half',
    dimension: 'persona',
    color: '#af52de',
    height: 210,
    styles: [['hbar', '条形'], ['pie', '饼图'], ['donut', '环形'], ['table', '表格']],
    defaultStyle: 'hbar',
    seriesLimit: 12,
    tableLimit: 12,
    hint: function (model, s) {
      /* 一句话把画像说清楚：主力档是谁 + 当前度量是多少 */
      var map = (model.dimMap && model.dimMap.persona) || null;
      if (!map || !map.size) { return '按人均单量分档（需要聚合工具写出复购/订单数字段）'; }
      var top = Array.from(map.entries()).sort(function (a, b) { return b[1] - a[1]; })[0];
      var fmt = model.measureFormat;
      var v = fmt === 'pct' ? (top[1] * 100).toFixed(1) + '%'
        : fmt === 'num1' ? Number(top[1]).toFixed(1)
        : fmt === 'money' ? shortNumOf(top[1])
        : shortNumOf(top[1]);
      return '按人均单量分档 · 主力档：' + top[0] + '（' + v + ' ' + (model.measureLabel || '') + '）';
    },
    empty: function (model, s) {
      return '这份数据没有画像字段 —— 用「一键解析大文件.bat」重新聚合一次，就会带上复购/高频/活跃客户数和订单数';
    },
    limit: { by: 'topN', other: function (n) { return '其他 ' + n + ' 档'; } },
    items: function (model) { return fromDim(model, 'persona'); }
  },
  {
    /* 客户规模分布：把"每个点有多少客户"分档。
       地区排行告诉你"哪片客户多"，这个告诉你"客户是集中在少数几个点，还是均匀铺开"。 */
    id: 'size',
    title: '客户规模分布',
    span: 'half',
    dimension: 'size',
    color: '#af52de',
    height: 210,
    styles: [['hbar', '条形'], ['pie', '饼图'], ['donut', '环形'], ['table', '表格']],
    defaultStyle: 'hbar',
    seriesLimit: 10,
    tableLimit: 10,
    hint: function () { return '按每个地点有多少客户分档'; },
    empty: function () { return '还没有解析出地理位置，先点「开始解析」'; },
    /* 分档有天然顺序，别按值排 —— 否则图上看不出"规模越大越少"这件事 */
    items: function (model) { return fromDim(model, 'size', SIZE_ORDER); },
    order: true
  }
];


export function visualOf(id) {
  for (var i = 0; i < VISUALS.length; i++) { if (VISUALS[i].id === id) { return VISUALS[i]; } }
  return null;
}

/** 图表偏好（每张图上次用的是哪种画法）的默认值 —— 从声明表生成，不用手写 */
export function defaultPrefs() {
  var out = {};
  VISUALS.forEach(function (v) { out[v.id] = v.defaultStyle; });
  return out;
}

/** 视觉对象的 id 列表（重画全部图表时用） */
export function visualIds() {
  return VISUALS.map(function (v) { return v.id; });
}

/**
 * 把 items 按"取前 N"截断，并追加一条"其他"。
 * @param {any[]} items
 * @param {number} topN 0 = 全部
 * @param {{other?: (n:number)=>string}} limit
 */
export function applyTopN(items, topN, limit) {
  if (!topN || topN <= 0 || items.length <= topN) { return items; }
  var total = items.length;
  var rest = 0;
  for (var i = topN; i < items.length; i++) { rest += items[i].v; }
  var out = items.slice(0, topN);
  if (rest > 0) {
    var label = (limit && limit.other) ? limit.other(total - topN) : ('其他 ' + (total - topN) + ' 项');
    out.push({ label: label, v: rest, click: '' });
  }
  return out;
}
