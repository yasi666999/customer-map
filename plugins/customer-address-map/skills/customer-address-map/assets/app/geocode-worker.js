/* 地址批量解析 Worker
   把"地名 → 行政区"的匹配放到后台线程跑，主线程不卡。
   两个库都是挂在 window 上的经典脚本，这里补一个 window 指向 self 再 importScripts。
   注意：file:// 下浏览器不允许创建 Worker，主程序会自动退回主线程处理。 */
self.window = self;
importScripts('geo-data.js', 'local-geocode.js');

var geo = null;
function ensure() {
  if (!geo) { geo = self.LocalGeocode.createGeocoder(self.GEO_DB); }
  return geo;
}

self.onmessage = function (e) {
  var msg = e.data || {};
  if (msg.type !== 'parse') { return; }
  var g = ensure();
  var list = msg.list || [];
  var map = {};
  for (var i = 0; i < list.length; i++) {
    var txt = list[i];
    try {
      var res = g.lookup(txt);
      if (res && res.ok && res.match) { map[txt] = res.match; }
    } catch (err) { /* 单条失败不影响整体 */ }
    if (i % 400 === 0) { self.postMessage({ type: 'progress', done: i, total: list.length }); }
  }
  self.postMessage({ type: 'done', map: map, total: list.length });
};
