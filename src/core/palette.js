/* 配色与分级：热力色阶、网格色阶、分级统计色的断点计算（纯函数） */

export function rampColor(ramp, t) {
    t = Math.max(0, Math.min(0.999, t));
    var n = ramp.length - 1, f = t * n, i = Math.floor(f), fr = f - i;
    var a = ramp[i], b = ramp[Math.min(n, i + 1)];
    return [Math.round(a[0] + (b[0] - a[0]) * fr), Math.round(a[1] + (b[1] - a[1]) * fr), Math.round(a[2] + (b[2] - a[2]) * fr)];
  }

export function regionBreaks(map) {
    var vals = [];
    map.forEach(function (v) { vals.push(v); });
    vals.sort(function (a, b) { return a - b; });
    var max = vals.length ? vals[vals.length - 1] : 0;
    if (!vals.length) { return { breaks: [1, 2, 3, 4], max: 0, vals: vals }; }
    var breaks = [];
    for (var k = 1; k <= 4; k++) {
      var pos = Math.floor(vals.length * k / 5);
      if (pos >= vals.length) { pos = vals.length - 1; }
      breaks.push(vals[pos]);
    }
    for (var j = 1; j < breaks.length; j++) {
      if (breaks[j] <= breaks[j - 1]) { breaks[j] = breaks[j - 1] + 1; }
    }
    return { breaks: breaks, max: max, vals: vals };
  }

export function regionColor(v, cls, rampKey) {
    var ramp = regionRamp(rampKey);
    if (!v) { return REGION_EMPTY; }
    var b = cls.breaks;
    var k = 0;
    for (var i = 0; i < b.length; i++) { if (v > b[i]) { k = i + 1; } }
    // 最大值必须落在最深的一档，否则"最高的那个"永远上不了最深色
    if (cls.max > 0 && v >= cls.max) { k = ramp.length - 1; }
    var c = ramp[Math.min(k, ramp.length - 1)];
    return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
  }

export function regionRamp(key) { return REGION_RAMPS[key] || REGION_RAMPS.blue; }

export var HEAT_RAMPS = {
    classic: [[0, 40, 200], [0, 190, 255], [60, 220, 110], [255, 215, 0], [255, 50, 0]],
    warm: [[70, 0, 140], [175, 0, 145], [240, 55, 90], [255, 155, 0], [255, 240, 90]],
    red: [[55, 0, 0], [145, 0, 0], [220, 30, 30], [255, 115, 40], [255, 225, 130]]
  };

export var CHART_COLORS = ['#0071e3', '#34c759', '#ff9500', '#af52de', '#ff3b30', '#5ac8fa',
  '#ffcc00', '#8e8e93', '#30d158', '#0a84ff', '#ff9f0a', '#bf5af2'];

export var GRID_RAMP = [[56, 132, 255], [52, 199, 89], [255, 214, 10], [255, 149, 0], [255, 59, 48]];

/* 区域分层着色的配色方案：都是 ColorBrewer 那几套经典顺序色阶（浅 → 深），
   不是随手调的 —— 顺序色阶的关键是"相邻两档肉眼能分清、整体单调变深"，
   ColorBrewer 的这几套是专门为此设计的，拿来即用比自己配靠谱。
   默认仍然是原来的蓝色，用户可以在面板上换。 */
export var REGION_RAMPS = {
  blue: [[222, 235, 247], [166, 206, 227], [106, 168, 224], [49, 109, 180], [8, 48, 107]],
  orange: [[254, 237, 222], [253, 208, 162], [253, 174, 107], [241, 105, 19], [127, 39, 4]],
  green: [[237, 248, 233], [199, 233, 192], [161, 217, 155], [116, 196, 118], [0, 109, 44]],
  purple: [[242, 240, 247], [218, 218, 235], [188, 189, 220], [158, 154, 200], [84, 39, 143]],
  red: [[254, 229, 217], [252, 187, 161], [252, 146, 114], [222, 45, 38], [103, 0, 13]]
};
/* 兼容老引用 */
export var REGION_RAMP = REGION_RAMPS.blue;

export var REGION_EMPTY = 'rgba(128,128,128,.13)';
