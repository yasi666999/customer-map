const fs = require('fs');
const file = 'D:/codex1/customer-map/app.js';
let c = fs.readFileSync(file, 'utf8');
const before = c;
function sub(from, to) { if (!c.includes(from)) { throw new Error('未找到: ' + from.slice(0,90)); } c = c.split(from).join(to); }

sub("  /* ---------------- 底部时间轴 ---------------- */",
"  /* ================= 图表渲染（参考 Superset：同一份数据可切换图表类型） =================\n" +
"     全部用原生 SVG/HTML 手写，不依赖任何图表库，离线可用、结果可验证。 */\n" +
"  var CHART_COLORS = ['#0071e3', '#34c759', '#ff9500', '#af52de', '#ff3b30', '#5ac8fa',\n" +
"    '#ffcc00', '#8e8e93', '#30d158', '#0a84ff', '#ff9f0a', '#bf5af2'];\n" +
"  function niceMax(v) {\n" +
"    if (!v) { return 1; }\n" +
"    var p = Math.pow(10, Math.floor(Math.log10(v)));\n" +
"    var n = v / p;\n" +
"    var m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;\n" +
"    return m * p;\n" +
"  }\n" +
"  function shortNum(v) {\n" +
"    if (v >= 100000000) { return (v / 100000000).toFixed(1) + '\\u4ebf'; }\n" +
"    if (v >= 10000) { return (v / 10000).toFixed(v >= 100000 ? 0 : 1) + '\\u4e07'; }\n" +
"    return String(v);\n" +
"  }\n" +
"\n" +
"  /* 竖向柱状 */\n" +
"  function svgBars(items, o) {\n" +
"    o = o || {};\n" +
"    var W = 1000, H = o.height || 170, pl = 46, pr = 10, pt = 12, pb = 26;\n" +
"    var max = niceMax(Math.max.apply(null, items.map(function (d) { return d.v; }).concat([1])));\n" +
"    var bw = (W - pl - pr) / Math.max(1, items.length);\n" +
"    var s = '<svg class=\"an-svg\" viewBox=\"0 0 ' + W + ' ' + H + '\" preserveAspectRatio=\"none\" role=\"img\">';\n" +
"    // 网格 + 刻度\n" +
"    for (var g = 0; g <= 2; g++) {\n" +
"      var yy = pt + (H - pt - pb) * g / 2;\n" +
"      s += '<line x1=\"' + pl + '\" y1=\"' + yy + '\" x2=\"' + (W - pr) + '\" y2=\"' + yy + '\" stroke=\"rgba(0,0,0,.07)\" stroke-width=\"1\"/>';\n" +
"      s += '<text x=\"' + (pl - 6) + '\" y=\"' + (yy + 3.5) + '\" text-anchor=\"end\" font-size=\"10\" fill=\"#8e8e93\">' + shortNum(Math.round(max * (1 - g / 2))) + '</text>';\n" +
"    }\n" +
"    items.forEach(function (d, i) {\n" +
"      var h = max ? (d.v / max) * (H - pt - pb) : 0;\n" +
"      var x = pl + i * bw;\n" +
"      s += '<rect x=\"' + (x + bw * 0.16).toFixed(1) + '\" y=\"' + (H - pb - h).toFixed(1) + '\" width=\"' + Math.max(1, bw * 0.68).toFixed(1) +\n" +
"        '\" height=\"' + Math.max(1, h).toFixed(1) + '\" rx=\"2\" fill=\"' + (o.color || CHART_COLORS[0]) + '\" opacity=\"0.9\"' + (d.click ? ' class=\"chart-click\" data-k=\"' + esc(d.click) + '\" style=\"cursor:pointer\"' : '') + '>' +\n" +
"        '<title>' + esc(d.label) + '\\uff1a' + d.v.toLocaleString() + '</title></rect>';\n" +
"      var step = Math.ceil(items.length / 14);\n" +
"      if (items.length <= 16 || i % step === 0) {\n" +
"        s += '<text x=\"' + (x + bw / 2).toFixed(1) + '\" y=\"' + (H - 8) + '\" text-anchor=\"middle\" font-size=\"10\" fill=\"#8e8e93\">' + esc(d.label) + '</text>';\n" +
"      }\n" +
"    });\n" +
"    return s + '</svg>';\n" +
"  }\n" +
"\n" +
"  /* 折线 / 面积 */\n" +
"  function svgLine(items, o) {\n" +
"    o = o || {};\n" +
"    var W = 1000, H = o.height || 170, pl = 46, pr = 10, pt = 12, pb = 26;\n" +
"    var max = niceMax(Math.max.apply(null, items.map(function (d) { return d.v; }).concat([1])));\n" +
"    var n = items.length;\n" +
"    var X = function (i) { return pl + (n <= 1 ? (W - pl - pr) / 2 : (W - pl - pr) * i / (n - 1)); };\n" +
"    var Y = function (v) { return H - pb - (max ? (v / max) * (H - pt - pb) : 0); };\n" +
"    var s = '<svg class=\"an-svg\" viewBox=\"0 0 ' + W + ' ' + H + '\" preserveAspectRatio=\"none\" role=\"img\">';\n" +
"    for (var g = 0; g <= 2; g++) {\n" +
"      var yy = pt + (H - pt - pb) * g / 2;\n" +
"      s += '<line x1=\"' + pl + '\" y1=\"' + yy + '\" x2=\"' + (W - pr) + '\" y2=\"' + yy + '\" stroke=\"rgba(0,0,0,.07)\"/>';\n" +
"      s += '<text x=\"' + (pl - 6) + '\" y=\"' + (yy + 3.5) + '\" text-anchor=\"end\" font-size=\"10\" fill=\"#8e8e93\">' + shortNum(Math.round(max * (1 - g / 2))) + '</text>';\n" +
"    }\n" +
"    var pts = items.map(function (d, i) { return X(i).toFixed(1) + ',' + Y(d.v).toFixed(1); });\n" +
"    var col = o.color || CHART_COLORS[0];\n" +
"    if (o.area) {\n" +
"      s += '<path d=\"M' + X(0).toFixed(1) + ',' + (H - pb) + ' L' + pts.join(' L') + ' L' + X(n - 1).toFixed(1) + ',' + (H - pb) + ' Z\" fill=\"' + col + '\" opacity=\"0.15\"/>';\n" +
"    }\n" +
"    s += '<polyline points=\"' + pts.join(' ') + '\" fill=\"none\" stroke=\"' + col + '\" stroke-width=\"2\" stroke-linejoin=\"round\"/>';\n" +
"    items.forEach(function (d, i) {\n" +
"      if (n <= 60) {\n" +
"        s += '<circle cx=\"' + X(i).toFixed(1) + '\" cy=\"' + Y(d.v).toFixed(1) + '\" r=\"3\" fill=\"#fff\" stroke=\"' + col + '\" stroke-width=\"2\"' + (d.click ? ' class=\"chart-click\" data-k=\"' + esc(d.click) + '\" style=\"cursor:pointer\"' : '') + '><title>' + esc(d.label) + '\\uff1a' + d.v.toLocaleString() + '</title></circle>';\n" +
"      }\n" +
"      var step = Math.ceil(n / 14);\n" +
"      if (n <= 16 || i % step === 0) {\n" +
"        s += '<text x=\"' + X(i).toFixed(1) + '\" y=\"' + (H - 8) + '\" text-anchor=\"middle\" font-size=\"10\" fill=\"#8e8e93\">' + esc(d.label) + '</text>';\n" +
"      }\n" +
"    });\n" +
"    return s + '</svg>';\n" +
"  }\n" +
"\n" +
"  /* 饼图 / 环形图 */\n" +
"  function svgPie(items, o) {\n" +
"    o = o || {};\n" +
"    var data = items.slice(0, 8);\n" +
"    var otherV = items.slice(8).reduce(function (a, b) { return a + b.v; }, 0);\n" +
"    if (otherV > 0) { data.push({ label: '\\u5176\\u4ed6', v: otherV }); }\n" +
"    var total = data.reduce(function (a, b) { return a + b.v; }, 0) || 1;\n" +
"    var S = 190, R = 72, r = o.donut ? 44 : 0, cx = 95, cy = 95;\n" +
"    var ang = -Math.PI / 2;\n" +
"    var s = '<svg class=\"an-svg\" viewBox=\"0 0 ' + S + ' ' + S + '\" style=\"height:190px\" role=\"img\">';\n" +
"    data.forEach(function (d, i) {\n" +
"      var a = d.v / total * Math.PI * 2, a2 = ang + a;\n" +
"      var col = CHART_COLORS[i % CHART_COLORS.length];\n" +
"      var x1 = cx + R * Math.cos(ang), y1 = cy + R * Math.sin(ang);\n" +
"      var x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);\n" +
"      var large = a > Math.PI ? 1 : 0;\n" +
"      var tip = '<title>' + esc(d.label) + '\\uff1a' + d.v.toLocaleString() + '\\uff08' + (d.v / total * 100).toFixed(1) + '%\\uff09</title>';\n" +
"      if (data.length === 1) {\n" +
"        s += '<circle cx=\"' + cx + '\" cy=\"' + cy + '\" r=\"' + R + '\" fill=\"' + col + '\">' + tip + '</circle>';\n" +
"      } else if (o.donut) {\n" +
"        var xi1 = cx + r * Math.cos(a2), yi1 = cy + r * Math.sin(a2);\n" +
"        var xi2 = cx + r * Math.cos(ang), yi2 = cy + r * Math.sin(ang);\n" +
"        s += '<path d=\"M' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) +\n" +
"          ' L' + xi1.toFixed(2) + ' ' + yi1.toFixed(2) + ' A' + r + ' ' + r + ' 0 ' + large + ' 0 ' + xi2.toFixed(2) + ' ' + yi2.toFixed(2) + ' Z\" fill=\"' + col + '\">' + tip + '</path>';\n" +
"      } else {\n" +
"        s += '<path d=\"M' + cx + ' ' + cy + ' L' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z\" fill=\"' + col + '\">' + tip + '</path>';\n" +
"      }\n" +
"      ang = a2;\n" +
"    });\n" +
"    if (o.donut) {\n" +
"      var top = data[0] || { v: 0 };\n" +
"      s += '<text x=\"' + cx + '\" y=\"' + (cy - 2) + '\" text-anchor=\"middle\" font-size=\"17\" font-weight=\"600\" fill=\"#1d1d1f\">' + (top.v / total * 100).toFixed(0) + '%</text>';\n" +
"      s += '<text x=\"' + cx + '\" y=\"' + (cy + 14) + '\" text-anchor=\"middle\" font-size=\"10\" fill=\"#8e8e93\">' + esc(String(top.label).slice(0, 6)) + '</text>';\n" +
"    }\n" +
"    return s + '</svg>';\n" +
"  }\n" +
"\n" +
"  /* 图例（饼图/环形图用） */\n" +
"  function chartLegend(items, o) {\n" +
"    var data = items.slice(0, 8);\n" +
"    var otherV = items.slice(8).reduce(function (a, b) { return a + b.v; }, 0);\n" +
"    if (otherV > 0) { data.push({ label: '\\u5176\\u4ed6', v: otherV }); }\n" +
"    var total = data.reduce(function (a, b) { return a + b.v; }, 0) || 1;\n" +
"    return '<div class=\"ct-legend\">' + data.map(function (d, i) {\n" +
"      return '<span class=\"ct-li\"' + (d.click ? ' data-k=\"' + esc(d.click) + '\" style=\"cursor:pointer\"' : '') + '>' +\n" +
"        '<i style=\"background:' + CHART_COLORS[i % CHART_COLORS.length] + '\"></i>' + esc(d.label) +\n" +
"        '<b>' + (d.v / total * 100).toFixed(1) + '%</b></span>';\n" +
"    }).join('') + '</div>';\n" +
"  }\n" +
"\n" +
"  /* 表格 */\n" +
"  function chartTable(items, o) {\n" +
"    var total = items.reduce(function (a, b) { return a + b.v; }, 0) || 1;\n" +
"    var rows = items.slice(0, o && o.limit ? o.limit : 15);\n" +
"    return '<table class=\"ct-table\"><thead><tr><th>\\u540d\\u79f0</th><th class=\"num\">\\u6570\\u91cf</th><th class=\"num\">\\u5360\\u6bd4</th></tr></thead><tbody>' +\n" +
"      rows.map(function (d) {\n" +
"        return '<tr' + (d.click ? ' class=\"chart-click\" data-k=\"' + esc(d.click) + '\" style=\"cursor:pointer\"' : '') + '>' +\n" +
"          '<td title=\"' + esc(d.label) + '\">' + esc(d.label) + '</td>' +\n" +
"          '<td class=\"num\">' + d.v.toLocaleString() + '</td>' +\n" +
"          '<td class=\"num\">' + (d.v / total * 100).toFixed(1) + '%</td></tr>';\n" +
"      }).join('') + '</tbody></table>';\n" +
"  }\n" +
"\n" +
"  /* 图表类型切换器（Superset 风格：同一份数据换一种画法） */\n" +
"  function chartSwitch(id, types, cur) {\n" +
"    return '<span class=\"chart-switch\" data-cs=\"' + id + '\">' + types.map(function (t) {\n" +
"      return '<button type=\"button\" data-ct=\"' + t[0] + '\"' + (t[0] === cur ? ' class=\"on\"' : '') + '>' + t[1] + '</button>';\n" +
"    }).join('') + '</span>';\n" +
"  }\n" +
"  var CHART_TYPES = {\n" +
"    time: [['bar', '\\u67f1\\u72b6'], ['line', '\\u6298\\u7ebf'], ['area', '\\u9762\\u79ef'], ['table', '\\u8868\\u683c']],\n" +
"    plat: [['hbar', '\\u6893\\u5f62'], ['pie', '\\u997c\\u56fe'], ['donut', '\\u73af\\u5f62'], ['table', '\\u8868\\u683c']],\n" +
"    geo: [['hbar', '\\u6392\\u884c'], ['bar', '\\u67f1\\u72b6'], ['pie', '\\u997c\\u56fe'], ['table', '\\u8868\\u683c']]\n" +
"  };\n" +
"  function chartPrefs() {\n" +
"    if (!state.chartPrefs) { state.chartPrefs = lsJson('cm.charts', { time: 'bar', plat: 'hbar', geo: 'hbar' }); }\n" +
"    return state.chartPrefs;\n" +
"  }\n" +
"\n" +
"  /* ---------------- 底部时间轴 ---------------- */");

if (c === before) { throw new Error('无改动'); }
fs.writeFileSync(file, c, 'utf8');
console.log('图表渲染模块已加入');
