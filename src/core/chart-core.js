/* 图表相关的 HTML 生成（纯函数，不碰 DOM）
   ------------------------------------------------------------------
   注意这里**只剩表格类**的渲染了：
     - 柱状 / 折线 / 面积 / 饼图 / 环形 / 条形 —— 全部由 ECharts 画（见 ui/island.jsx）
     - 表格与矩阵 —— 留在这里直接出 <table>：数据密集、要能选中复制，
       而且矩阵带条件格式数据条，用图表库反而绕

   以前这里有一整套手写 SVG 实现（svgBars / svgHBars / svgLine / svgPie / chartLegend）。
   换成 ECharts 之后没人再调用它们了，2026-09 清掉 —— 留着的话以后改一次样式要改两处，
   而且那些函数还有单测，看上去"有覆盖"，其实测的是死代码。 */
import { esc, shortNum } from './format.js';

export function cAttr(d) {
    return (d && d.click != null && d.click !== '') ?
      ' class="chart-click" data-k="' + esc(String(d.click)) + '"' : '';
  }

export function chartTable(items, o) {
    o = o || {};
    var total = items.reduce(function (a, b) { return a + b.v; }, 0) || 1;
    var rows = items.slice(0, o.limit || 15);
    return '<div class="ct-tablewrap"><table class="ct-table"><thead><tr><th>名称</th><th class="num">数量</th><th class="num">占比</th></tr></thead><tbody>' +
      rows.map(function (d) {
        return '<tr' + cAttr(d) + ' style="cursor:pointer">' +
          '<td title="' + esc(d.label) + '">' + esc(d.label) + '</td>' +
          '<td class="num">' + d.v.toLocaleString() + '</td>' +
          '<td class="num">' + (d.v / total * 100).toFixed(1) + '%</td></tr>';
      }).join('') + '</tbody></table>' +
      (items.length > rows.length ? '<div class="ct-more">共 ' + items.length + ' 项，仅显示前 ' + rows.length + ' 项</div>' : '') +
      '</div>';
  }

export function chartSwitch(id, types, cur) {
    return '<span class="chart-switch" data-cs="' + id + '" role="group" aria-label="切换图表样式">' + types.map(function (t) {
      return '<button type="button" data-ct="' + t[0] + '"' + (t[0] === cur ? ' class="on"' : '') + '>' + t[1] + '</button>';
    }).join('') + '</span>';
  }

export function matrixTable(o) {
  o = o || {};
  var rows = o.rows || [];
  var cols = o.cols || [];
  var get = o.get || function () { return 0; };
  if (!rows.length || !cols.length) { return ''; }
  var max = 0, rowSum = {}, colSum = {}, total = 0;
  rows.forEach(function (r) {
    rowSum[r.key] = 0;
    cols.forEach(function (c) {
      var v = get(r.key, c.key) || 0;
      if (v > max) { max = v; }
      rowSum[r.key] += v;
      colSum[c.key] = (colSum[c.key] || 0) + v;
      total += v;
    });
  });
  var h = '<div class="mtx-wrap"><table class="mtx"><thead><tr><th class="mtx-h">平台 \\ 月份</th>';
  cols.forEach(function (c) {
    h += '<th' + (c.click != null ? ' class="chart-click" data-k="' + esc(String(c.click)) + '"' : '') + '>' + esc(c.label) + '</th>';
  });
  h += '<th class="mtx-sum">合计</th></tr></thead><tbody>';
  rows.forEach(function (r) {
    h += '<tr><th class="mtx-h"' + (r.click != null ? ' class="chart-click" data-k="' + esc(String(r.click)) + '"' : '') + '>' + esc(r.label) + '</th>';
    cols.forEach(function (c) {
      var v = get(r.key, c.key) || 0;
      var w = max ? Math.round(v / max * 100) : 0;
      h += '<td class="mtx-cell" data-mtx="' + esc(r.key + '|' + c.key) + '" title="' + esc(r.label + ' ' + c.label + '：' + v.toLocaleString()) + '">' +
        '<span class="mtx-bar" style="width:' + w + '%"></span>' +
        '<span class="mtx-v">' + (v ? shortNum(v) : '·') + '</span></td>';
    });
    h += '<td class="mtx-sum">' + shortNum(rowSum[r.key]) + '</td></tr>';
  });
  h += '<tr class="mtx-foot"><th class="mtx-h">合计</th>';
  cols.forEach(function (c) {
    h += '<td class="mtx-sum">' + shortNum(colSum[c.key] || 0) + '</td>';
  });
  h += '<td class="mtx-sum">' + shortNum(total) + '</td></tr>';
  h += '</tbody></table></div>';
  return h;
}

