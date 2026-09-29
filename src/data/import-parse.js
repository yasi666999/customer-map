/* 导入解析层
   ==================================================================
   从 main.js 里搬出来的「CSV / Excel → 记录数组」这一段。搬家的目的：

   1. 这里全是**纯逻辑**（字符串进、数据出），不碰 DOM、绝大部分也不碰全局 UI 状态，
      放在独立文件里可以直接写单元测试，不用起浏览器。
   2. main.js 已经 4400 多行，找东西要滚半天。

   和 UI 的边界约定（搬家时特意改的，别改回去）：
   - 模块自己不写 state。表头识别出来的提示语 / 时间列名放在返回值上
     （cols.warn / cols.timeCol），由调用方决定要不要写进全局状态。
   - 解析中断通过参数传进来（isAborted），模块不知道 state.importAbort 的存在。
   - 表头识别完成的时机通过 onColumns 回调交出去（流式解析时表头不是一开始就能确定的）。
   ------------------------------------------------------------------ */

/** 空数组常量：行对象上大量字段的默认值都指向它，冻结后防止被误改 */
export const EMPTY_ARR = Object.freeze([]);

export const ADDR_KEYS = ['\u5730\u5740', '\u6536\u8d27\u5730\u5740', '\u5ba2\u6237\u5730\u5740', '\u8be6\u7ec6\u5730\u5740',
  '\u8054\u7cfb\u5730\u5740', '\u9001\u8d27\u5730\u5740', '\u6536\u4ef6\u5730\u5740', 'address', 'addr'];
export const LNG_KEYS = ['\u7ecf\u5ea6', 'lng', 'lon', 'longitude'];
export const LAT_KEYS = ['\u7eac\u5ea6', 'lat', 'latitude'];
export const ID_KEYS = ['\u7f16\u53f7', '\u5ba2\u6237\u7f16\u53f7', '\u8ba2\u5355\u53f7', '\u7f16\u7801', 'id', '\u5e8f\u53f7'];
export const COUNT_KEYS = ['\u5ba2\u6237\u6570', '\u6570\u91cf', '\u8ba2\u5355\u6570', '\u6761\u6570', 'count'];
// 下面这几组按 ddl.txt 的字段名来认
export const TIME_KEYS = ['create_time', 'trade_time', 'payment_time', 'gj_create_time', 'gj_trade_time',
  '\u521b\u5efa\u65f6\u95f4', '\u6210\u4ea4\u65f6\u95f4', '\u4e0b\u5355\u65f6\u95f4', '\u4ed8\u6b3e\u65f6\u95f4', '\u8ba2\u5355\u65f6\u95f4', '\u65f6\u95f4', '\u65e5\u671f'];
export const PLAT_KEYS = ['platform', '\u5e73\u53f0'];
export const SHOP_KEYS = ['shop_name', 'original_shop_name', '\u5e97\u94fa\u540d', '\u5e97\u94fa'];
export const SRC_KEYS = ['order_source', '\u6765\u6e90\u7cfb\u7edf', '\u8ba2\u5355\u6765\u6e90', '\u6765\u6e90'];
export const CODE_KEYS = ['order_code', '\u8ba2\u5355\u53f7', '\u8ba2\u5355\u7f16\u53f7', '\u9500\u552e\u5355\u53f7'];
// 只有行政区划编码、没有地址字符串时用这几列（province / city / area）
export const PROV_KEYS = ['province', '\u7701', '\u7701\u4efd'];
export const CITY_KEYS = ['city', '\u5e02', '\u57ce\u5e02'];
export const AREA_KEYS = ['area', 'district', '\u533a', '\u533a\u53bf', '\u53bf'];
export const PHONE_KEYS = ['phone', '\u624b\u673a\u53f7', '\u624b\u673a', '\u7535\u8bdd', 'buyer_phone'];
/* 客户画像那几列（聚合工具「批量解析大文件.js」会写出来）。
   注意顺序：COUNT_KEYS 里"客户数"排在"订单数"前面，所以客户数不会被订单数抢先认走。 */
export const REP_KEYS = ['\u590d\u8d2d\u5ba2\u6237\u6570', '\u590d\u8d2d\u5ba2\u6237'];
export const HF_KEYS = ['\u9ad8\u9891\u5ba2\u6237\u6570'];
export const ACT_KEYS = ['\u6d3b\u8dc3\u5ba2\u6237\u6570'];
export const ORDERS_KEYS = ['\u8ba2\u5355\u6570'];
export const AMOUNT_KEYS = ['payment_price', 'total_trade_price', '\u5b9e\u4ed8\u91d1\u989d', '\u6210\u4ea4\u4ef7\u683c', '\u91d1\u989d'];

/* 时间解析：兼容 2026-09-01 12:30:00 / 2026/9/1 / Excel 序列号 / 时间戳 */
export function parseTime(v) {
  if (v == null || v === '') { return null; }
  if (v instanceof Date) { return isNaN(v.getTime()) ? null : v.getTime(); }
  if (typeof v === 'number') {
    if (v > 1e12) { return v; }
    if (v > 1e9) { return v * 1000; }
    if (v > 20000 && v < 80000) { return Math.round((v - 25569) * 86400000); }
    return null;
  }
  var s = String(v).trim();
  var m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) { return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime(); }
  var t = Date.parse(s.replace(/\//g, '-'));
  return isNaN(t) ? null : t;
}

export function matchHeader(h, keys) {
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (h === k) { return true; }
    if (k.length >= 2 && h.indexOf(k) >= 0) { return true; }
  }
  return false;
}

export function parseCsv(text) {
  text = String(text).replace(/^\uFEFF/, '');
  var rows = [], row = [], field = '', inQ = false, i = 0;
  var qStart = -1, qLines = 0;
  while (i < text.length) {
    var c = text.charAt(i);
    if (inQ) {
      if (c === '"') {
        if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      if (c === '\n' && ++qLines > MAX_QUOTED_LINES) {
        // 脏引号：回退到引号位置，把它当普通字符重跑（规则同 importCsvPipelined）
        inQ = false; qLines = 0; field = '"'; i = qStart + 1; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') {
      if (field === '') { inQ = true; qStart = i; qLines = 0; i++; continue; }
      field += '"'; i++; continue;
    }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (inQ) { inQ = false; field = '"'; i = qStart + 1; }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* 表头 → 各列下标（只做一次） */
export function detectColumns(headerRow) {
  var header = (headerRow || []).map(function (h) { return String(h == null ? '' : h).trim().toLowerCase(); });
  var o = { header: header, ai: -1, li: -1, ti: -1, ii: -1, ni: -1, mi: -1, pi: -1, si: -1, oi: -1, ci: -1, wi: -1,
            pvi: -1, cvi: -1, avi: -1, phi: -1, repi: -1, hfi: -1, acti: -1, ordi: -1 };
  header.forEach(function (h, i) {
    if (o.ai < 0 && matchHeader(h, ADDR_KEYS)) { o.ai = i; }
    if (o.li < 0 && matchHeader(h, LNG_KEYS)) { o.li = i; }
    if (o.ti < 0 && matchHeader(h, LAT_KEYS)) { o.ti = i; }
    if (o.ii < 0 && matchHeader(h, ID_KEYS)) { o.ii = i; }
    if (o.ni < 0 && matchHeader(h, COUNT_KEYS)) { o.ni = i; }
    if (o.pi < 0 && matchHeader(h, PLAT_KEYS)) { o.pi = i; }
    if (o.si < 0 && matchHeader(h, SHOP_KEYS)) { o.si = i; }
    if (o.oi < 0 && matchHeader(h, SRC_KEYS)) { o.oi = i; }
    if (o.ci < 0 && matchHeader(h, CODE_KEYS)) { o.ci = i; }
    if (o.wi < 0 && matchHeader(h, AMOUNT_KEYS)) { o.wi = i; }
    if (o.pvi < 0 && matchHeader(h, PROV_KEYS)) { o.pvi = i; }
    if (o.cvi < 0 && matchHeader(h, CITY_KEYS)) { o.cvi = i; }
    if (o.avi < 0 && matchHeader(h, AREA_KEYS)) { o.avi = i; }
    if (o.phi < 0 && matchHeader(h, PHONE_KEYS)) { o.phi = i; }
    if (o.repi < 0 && matchHeader(h, REP_KEYS)) { o.repi = i; }
    if (o.hfi < 0 && matchHeader(h, HF_KEYS)) { o.hfi = i; }
    if (o.acti < 0 && matchHeader(h, ACT_KEYS)) { o.acti = i; }
    if (o.ordi < 0 && matchHeader(h, ORDERS_KEYS)) { o.ordi = i; }
  });
  // 时间列按字段名优先级选（create_time 优先），不能按列位置
  for (var tk = 0; tk < TIME_KEYS.length && o.mi < 0; tk++) {
    for (var th = 0; th < header.length; th++) {
      if (matchHeader(header[th], [TIME_KEYS[tk]])) { o.mi = th; break; }
    }
  }
  o.codeMode = o.avi >= 0 || (o.pvi >= 0 && o.cvi >= 0);
  o.hasHeader = o.ai >= 0 || o.li >= 0 || o.ti >= 0 || o.ii >= 0 || o.mi >= 0 ||
                o.pi >= 0 || o.ci >= 0 || o.si >= 0 || o.avi >= 0 || o.pvi >= 0;
  if (!o.hasHeader) { o.warn = '\u6ca1\u8bc6\u522b\u5230\u8868\u5934\uff0c\u5df2\u6309\u65e0\u8868\u5934\u5904\u7406'; }
  else if (o.ai < 0 && !o.codeMode) { o.warn = '\u6ca1\u627e\u5230\u5730\u5740\u5217\uff08\u9700\u8981\u540d\u4e3a receiving_address / \u6536\u8d27\u5730\u5740 / \u5730\u5740 \u7b49\uff09\uff0c\u5f53\u524d\u53d6\u7b2c 1 \u5217\uff0c\u53ef\u80fd\u89e3\u6790\u4e0d\u51fa\u6765'; }
  else { o.warn = ''; }
  o.timeCol = o.mi >= 0 ? String(o.header[o.mi]) : '';
  if (o.ai < 0 && !o.codeMode) { o.ai = 0; }
  return o;
}

/* 一行 → 一条记录（找不到就返回 null） */
export function buildRecordFromCells(cells, cols) {
  if (!cells) { return null; }
  var raw = cols.ai >= 0 ? String(cells[cols.ai] == null ? '' : cells[cols.ai]).trim() : '';
  var acode = cols.avi >= 0 ? String(cells[cols.avi] == null ? '' : cells[cols.avi]).replace(/\D/g, '') : '';
  if (acode.length > 6) { acode = acode.slice(0, 6); }
  var useCode = acode.length === 6;
  var ccode = cols.cvi >= 0 ? String(cells[cols.cvi] == null ? '' : cells[cols.cvi]).replace(/\D/g, '') : '';
  var pcode = cols.pvi >= 0 ? String(cells[cols.pvi] == null ? '' : cells[cols.pvi]).replace(/\D/g, '') : '';
  /* 能定位的行有三种：有地址文本 / 有 6 位区县编码 / 至少有省 + 市编码。
     以前只认前两种，于是「只有 province + city」的订单表
     每一行都被判成空行丢掉：整个文件导进来是 0 行，然后回退到"每行当纯文本"的兜底路径，
     界面看着像导进来了，其实一条都没定位。 */
  if (!raw && !useCode && ccode.length < 4 && pcode.length < 2) { return null; }
  if (raw && /^[-=*_#~]{2,}$/.test(raw)) { return null; }
  var lng = cols.li >= 0 ? parseFloat(cells[cols.li]) : NaN;
  var lat = cols.ti >= 0 ? parseFloat(cells[cols.ti]) : NaN;
  return {
    raw: raw,
    id: cols.ii >= 0 ? String(cells[cols.ii] == null ? '' : cells[cols.ii]).trim() : '',
    lng: isFinite(lng) ? lng : null,
    lat: isFinite(lat) ? lat : null,
    coord: (cols.li >= 0 && /\u767e\u5ea6|bd09/i.test(String(cols.header[cols.li] || ''))) ? 'bd09' : 'gcj02',
    count: cols.ni >= 0 ? (parseInt(String(cells[cols.ni]).replace(/[^0-9]/g, ''), 10) || 0) : 0,
    acode: useCode ? acode : '',
    ccode: ccode,
    pcode: pcode,
    phone: cols.phi >= 0 ? String(cells[cols.phi] == null ? '' : cells[cols.phi]).replace(/\D/g, '') : '',
    t: cols.mi >= 0 ? parseTime(cells[cols.mi]) : null,
    plat: cols.pi >= 0 ? String(cells[cols.pi] == null ? '' : cells[cols.pi]).trim() : (cols.oi >= 0 ? String(cells[cols.oi] == null ? '' : cells[cols.oi]).trim() : ''),
    shop: cols.si >= 0 ? String(cells[cols.si] == null ? '' : cells[cols.si]).trim() : '',
    code: cols.ci >= 0 ? String(cells[cols.ci] == null ? '' : cells[cols.ci]).trim() : '',
    amount: cols.wi >= 0 ? (parseFloat(String(cells[cols.wi]).replace(/[^0-9.\-]/g, '')) || 0) : 0,
    rep: cols.repi >= 0 ? (parseInt(String(cells[cols.repi]).replace(/[^0-9]/g, ''), 10) || 0) : 0,
    hf: cols.hfi >= 0 ? (parseInt(String(cells[cols.hfi]).replace(/[^0-9]/g, ''), 10) || 0) : 0,
    act: cols.acti >= 0 ? (parseInt(String(cells[cols.acti]).replace(/[^0-9]/g, ''), 10) || 0) : 0,
    orders: cols.ordi >= 0 ? (parseInt(String(cells[cols.ordi]).replace(/[^0-9]/g, ''), 10) || 0) : 0
  };
}

/* 一次成型：边解析 CSV 边生成记录，不产生"整表二维数组"这个中间物

   ---- 脏 CSV 的容错（非常重要，别删） ----
   真实导出里经常夹着落单的双引号。严格按 RFC4180 解析时，一个没配对的引号会把
   后面几十万行全吞进同一个字段。真实导出表里落单引号很常见（整个文件引号个数是奇数、
   一片区间跨行几十行都不收尾），旧实现会成片丢行。
   两条容错规则：
     1. 只有**字段开头**的引号才算引号；字段中间出现的（16" 这种）当普通字符
     2. 引号区间跨行超过 MAX_QUOTED_LINES 还没闭合 → 判定为脏引号，
        回退到那个引号的位置，把它当普通字符重跑一遍
   回退范围最多 MAX_QUOTED_LINES 行，代价可以忽略。 */
export const MAX_QUOTED_LINES = 20;

export function importCsvPipelined(text, onProgress, isAborted, onColumns) {
          return new Promise(function (/** @type {any} */ resolve) {
    var len = text.length, i = 0, CHUNK = 300000;
    var field = '', cells = [], inQ = false;
    var qStart = -1, qLines = 0;
    var cols = null, firstDone = false;
    var out = [], nBad = 0;
    function handleCells(cs) {
      if (!firstDone) {
        firstDone = true;
        cols = detectColumns(cs);
        if (onColumns) { onColumns(cols); }
        if (cols.hasHeader) { return; }
      }
      var rec = buildRecordFromCells(cs, cols);
      if (rec) { out.push(rec); } else { nBad++; }
    }
    function step() {
      if (isAborted && isAborted()) { resolve([]); return; }
      var end = Math.min(len, i + CHUNK);
      for (; i < end; i++) {
        var ch = text.charAt(i);
        if (inQ) {
          if (ch === '"') { if (text.charAt(i + 1) === '"') { field += '"'; i++; } else { inQ = false; } }
          else {
            field += ch;
            if (ch === '\n' && ++qLines > MAX_QUOTED_LINES) {
              // 规则 2：引号没配对，回退到引号位置当普通字符重跑
              inQ = false; qLines = 0; field = '"'; i = qStart;
            }
          }
        } else {
          if (ch === '"') {
            // 规则 1：只有字段开头的引号才算引号
            if (field === '') { inQ = true; qStart = i; qLines = 0; }
            else { field += '"'; }
          }
          else if (ch === ',') { cells.push(field); field = ''; }
          else if (ch === '\n') { cells.push(field); handleCells(cells); cells = []; field = ''; }
          else if (ch !== '\r') { field += ch; }
        }
      }
      if (onProgress) { onProgress(i / len, out.length); }
      if (i < len) { setTimeout(step, 0); }
      else {
        if (inQ) {
          // 到文件尾还没闭合，同样按规则 2 回退重跑。
          // 走 setTimeout 而不是直接递归：每回退一次至少消耗一个引号，必然收敛，也不会堆爆调用栈
          inQ = false; qLines = 0; field = '"'; i = qStart;
          setTimeout(step, 0); return;
        }
        if (field !== '' || cells.length) { cells.push(field); handleCells(cells); }
        resolve(out);
      }
    }
    step();
  });
}

/* 给 Excel 路径用：整表已经在内存里，这里只做"表头 + 逐行转换" */
export function buildRecords(rows, onColumns) {
  if (!rows || !rows.length) { return []; }
  var cols = detectColumns(rows[0]);
  if (onColumns) { onColumns(cols); }
  var body = cols.hasHeader ? rows.slice(1) : rows;
  var out = [];
  for (var i = 0; i < body.length; i++) {
    var rec = buildRecordFromCells(body[i], cols);
    if (rec) { out.push(rec); }
  }
  return out;
}

export function textToRecords(text) {
  var lines = String(text).split(/\r?\n/);
  var out = [];
  lines.forEach(function (line) {
    var t = line.trim();
    if (!t || /^[-=*_#~]{2,}$/.test(t)) { return; }
    out.push({ raw: t, id: '', lng: null, lat: null });
  });
  return out;
}

/* ---------- P0-2 行数据瘦身 ----------
   42.7 万行时，每行 25 个属性槽就要 200 多字节，而其中一大半是「几乎永远是同一个值」的字段
   （status 全是 todo，level / error / shop / code / acode / ccode / pcode / phone2 基本全空）。
   两件事：
     1. 这些字段的默认值放到 ROW_PROTO 上兜底，实例上只放真正会变的字段。
        读 row.shop 照样拿到 ''，写 row.shop = 'x' 会正常落到实例上。
        **属性写入顺序固定**：V8 靠属性顺序决定隐藏类，顺序乱会建出多套内存布局，反而更慢更占。
     2. 字符串过一层去重字典。字典有容量上限 —— 汇总表地址只有几千种（收益巨大），
        订单表地址几乎唯一（到上限就停，不会把字典本身变成巨型 Map）。
   实测见 _dev/_mem_bench.mjs（CDP 精确量堆）。 */

/** 每列一个去重字典；超过上限就不再收录 */
export function makeInterner(limit) {
  var m = new Map();
  return function (/** @type {any} */ v) {
    if (typeof v !== 'string' || v === '') { return v; }
    var hit = m.get(v);
    if (hit !== undefined) { return hit; }
    if (m.size >= limit) { return v; }
    m.set(v, v);
    return v;
  };
}

/* 实例上不占槽位的字段：默认值在这里兜底 */
export const ROW_PROTO = {
  id: '', phones: EMPTY_ARR, flags: EMPTY_ARR, match: null,
  shop: '', code: '', amount: 0, acode: '', ccode: '', pcode: '', phone2: '',
  /* 客户画像用的四个计数（聚合工具写出来；老数据没有就是 0） */
  rep: 0, hf: 0, act: 0, orders: 0,
  confidence: null, error: ''
};
