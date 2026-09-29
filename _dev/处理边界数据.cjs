/* 把下载的行政区边界简化、压缩成 3 个离线 JS 包（省 / 市 / 区县）。
   原始数据是完整精度（25.9MB），直接用会又大又慢；
   这里用 Douglas-Peucker 抽稀 + 坐标降到 4 位小数（约 11 米精度），
   在屏幕上肉眼看不出差别，体积能掉一个数量级。 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '_boundary_raw');
const OUT = path.join(__dirname, '..');

/* Douglas-Peucker 抽稀：flat 是 [x0,y0,x1,y1,...] */
function dp(flat, tol) {
  const n = flat.length / 2;
  if (n < 4) return flat;
  const keep = new Uint8Array(n);
  keep[0] = 1; keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const seg = stack.pop();
    const a = seg[0], b = seg[1];
    if (b - a < 2) continue;
    const ax = flat[a * 2], ay = flat[a * 2 + 1];
    const bx = flat[b * 2], by = flat[b * 2 + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1, maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const px = flat[i * 2], py = flat[i * 2 + 1];
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      const qx = ax + t * dx, qy = ay + t * dy;
      const d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy);
      if (d2 > maxD) { maxD = d2; maxI = i; }
    }
    if (maxD > tol2) { keep[maxI] = 1; stack.push([a, maxI], [maxI, b]); }
  }
  const out = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(flat[k * 2], flat[k * 2 + 1]);
  return out;
}

const r4 = v => Math.round(v * 10000) / 10000;

/* 一个 GeoJSON feature → [adcode, name, bbox, rings] */
function pack(ft, tol) {
  const g = ft.geometry;
  if (!g) return null;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const rings = [];
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  polys.forEach(poly => {
    (poly || []).forEach(ring => {
      let flat = [];
      for (let i = 0; i < ring.length; i++) {
        flat.push(ring[i][0], ring[i][1]);
        const x = ring[i][0], y = ring[i][1];
        if (x < minx) minx = x;
        if (y < miny) miny = y;
        if (x > maxx) maxx = x;
        if (y > maxy) maxy = y;
      }
      if (flat.length < 8) return;                 // 太小的碎片直接丢掉
      flat = dp(flat, tol);
      if (flat.length < 8) return;
      for (let i = 0; i < flat.length; i++) flat[i] = r4(flat[i]);
      rings.push(flat);
    });
  });
  if (!rings.length) return null;
  var cen = ft.properties.centroid || ft.properties.center;
  if (!cen || !isFinite(cen[0])) { cen = [(minx + maxx) / 2, (miny + maxy) / 2]; }
  return [String(ft.properties.adcode), ft.properties.name,
    [r4(minx), r4(miny), r4(maxx), r4(maxy)], rings, [r4(cen[0]), r4(cen[1])]];
}

function load(f) {
  return JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8'));
}
function write(name, globalName, list) {
  let pts = 0;
  list.forEach(f => f[3].forEach(r => { pts += r.length / 2; }));
  const txt = 'window.' + globalName + '=' + JSON.stringify(list) + ';';
  fs.writeFileSync(path.join(OUT, name), txt, 'utf8');
  console.log(name + ' → ' + list.length + ' 个区域 / ' + pts.toLocaleString() + ' 个点 / ' +
    (Buffer.byteLength(txt) / 1048576).toFixed(2) + ' MB');
}

const top = load('100000_full.json');
const provinces = top.features.filter(f => /^\d{6}$/.test(String(f.properties.adcode)) && String(f.properties.adcode) !== '100000');

const provFeat = [], cityFeat = [], distFeat = [];
provinces.forEach(ft => {
  const packed = pack(ft, 0.02);
  if (packed) provFeat.push(packed);
});

const files = fs.readdirSync(SRC).filter(f => /^\d{6}_full\.json$/.test(f) && f !== '100000_full.json');
// 省级文件形如 440000_full.json（后四位 0000），其余是市级文件
const provFiles = files.filter(f => f.slice(2, 6) === '0000');
const cityFiles = files.filter(f => f.slice(2, 6) !== '0000');
const cityCodes = [];
provFiles.forEach(f => {
  const j = load(f);
  (j.features || []).forEach(ft => {
    const ad = String(ft.properties.adcode), lv = ft.properties.level;
    const packed = pack(ft, lv === 'city' ? 0.008 : 0.006);
    if (!packed) return;
    if (lv === 'city') { cityFeat.push(packed); cityCodes.push(ad); }
    else if (lv === 'district') {
      // 直辖市：这一层同时当作"市"和"区县"
      cityFeat.push(packed);
      distFeat.push(packed);
    }
  });
});

let cityMiss = 0;
cityFiles.forEach(f => {
  const code = f.slice(0, 6);
  const j = load(f);
  (j.features || []).forEach(ft => {
    const packed = pack(ft, 0.004);
    if (packed) distFeat.push(packed);
  });
});

console.log('省级 ' + provFeat.length + ' | 市级 ' + cityFeat.length + ' | 区县 ' + distFeat.length +
  ' | 无下级文件的市（直筒子市）' + cityMiss);
write('geo-boundary-p.js', 'CN_BOUNDARY_P', provFeat);
write('geo-boundary-c.js', 'CN_BOUNDARY_C', cityFeat);
write('geo-boundary-d.js', 'CN_BOUNDARY_D', distFeat);
