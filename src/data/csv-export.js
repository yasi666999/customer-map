/* CSV 导出（纯函数）
   ------------------------------------------------------------------
   从 main.js 里搬出来的"数据 → CSV 文本"这一段。搬家的理由不只是行数：

   1. 转义规则原来**写了两遍**（客户表一份、地点字典一份），写法还略有不同。
      地址里出现逗号、引号、换行都很常见（实测有「门牌16"院内」这种），
      转义写错整个导出文件就串行了。现在只有一份实现，而且有单元测试。
   2. 纯字符串进、字符串出，不用起浏览器就能验证。 */

import { toDateStr } from '../core/format.js';

/** 一个单元格的转义：含逗号 / 引号 / 换行就套双引号，内部的引号翻倍。
    注意 \r 也要算进去 —— 老实现只判了 \n，字段里夹一个回车就会把一行劈成两行。 */
export function csvCell(v) {
  var s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? ('"' + s.replace(/"/g, '""') + '"') : s;
}

/** 一行单元格 → 一行 CSV */
export function csvLine(cells) {
  return cells.map(csvCell).join(',');
}

/** 客户地址导出表的列（顺序就是导出文件里的列顺序，改了要同步 README） */
export const EXPORT_COLUMNS = [
  '序号', '原始地址', '清洗后地址',
  '经度(高德GCJ02)', '纬度(高德GCJ02)',
  '经度(百度BD09)', '纬度(百度BD09)',
  '精度等级', '匹配到的地名', '客户数',
  '时间', '平台', '店铺', '订单号', '金额',
  '距常驻点(km)', '最近常驻点', '编号', '电话', '状态', '备注'
];

/**
 * 客户地址 → 整段 CSV 文本（带 BOM，Excel 打开不乱码）
 * @param {any[]} rows 行数据
 * @param {{bases:any[], hasCoord:(r:any)=>boolean, qualityLabel:(r:any)=>string,
 *          toBd09:(lng:number,lat:number)=>number[], statusLabel:(r:any)=>string}} ctx
 *        依赖都从外面传进来，模块自己不认识全局状态
 */
export function buildRowsCsv(rows, ctx) {
  var bases = (ctx && ctx.bases) || [];
  var hasCoord = ctx && ctx.hasCoord || function () { return false; };
  var qualityLabel = ctx && ctx.qualityLabel || function () { return ''; };
  var toBd09 = ctx && ctx.toBd09 || function () { return null; };
  var statusLabel = ctx && ctx.statusLabel || function () { return ''; };

  var lines = [EXPORT_COLUMNS.join(',')];
  rows.forEach(function (r, i) {
    var ok = hasCoord(r);
    var bd = ok ? toBd09(r.lng, r.lat) : null;
    var mk = r.match ? [r.match.p, r.match.c, r.match.d, r.match.t].filter(Boolean).join(' / ') : '';
    lines.push(csvLine([
      i + 1,
      r.raw,
      r.clean,
      ok ? r.lng : '',
      ok ? r.lat : '',
      bd ? bd[0] : '',
      bd ? bd[1] : '',
      qualityLabel(r),
      mk || r.level || '',
      r.count > 1 ? r.count : '',
      r.t ? toDateStr(r.t) : '',
      r.plat || '',
      r.shop || '',
      r.code || '',
      r.amount ? r.amount : '',
      r.distKm != null ? r.distKm.toFixed(2) : '',
      (r.distKm != null && r.baseIdx >= 0 && bases[r.baseIdx]) ? (bases[r.baseIdx].name || '') : '',
      r.id || '',
      (r.phones || []).join(' / '),
      statusLabel(r),
      (r.flags || []).join('；')
    ]));
  });
  // BOM：不加的话 Excel 打开中文是乱码
  return '\uFEFF' + lines.join('\r\n');
}

export const PLACE_COLUMNS = ['名称', '经度(高德GCJ02)', '纬度(高德GCJ02)'];

/** 地点字典 → CSV 文本（同样带 BOM） */
export function buildPlacesCsv(places) {
  var lines = [PLACE_COLUMNS.join(',')];
  places.forEach(function (p) {
    lines.push(csvLine([p.name, p.lng, p.lat]));
  });
  return '\uFEFF' + lines.join('\r\n');
}
