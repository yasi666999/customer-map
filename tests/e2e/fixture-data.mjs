/* 端到端测试的兜底数据：本机没有真实聚合表时，按需生成一份脱敏的
   「地址 / 经纬度 / 客户数 / 时间 / 平台」聚合表。
   区县清单和坐标取自项目自带的边界数据，随机数用固定种子，生成结果可复现。
   生成物落在 tests/.cache/，不入库。

   形状刻意对齐真实导入的数据：
   - 一个地点（同一经纬度）会有多行，行之间是时间 / 平台的差别；
   - 少量地点只有 1 个客户，少量地点是大客户；
   - 时间跨度 18 个月，够「同比 / 环比 / 时间轴」用。
   这样"点位数量、点聚合、只看有客户数据的点、客户规模分档、时间轴平移"
   这些断言才有意义。 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

function loadBoundary(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return JSON.parse(src.slice(src.indexOf('['), src.lastIndexOf(']') + 1));
}

const MUNI = { '11': '北京市', '12': '天津市', '31': '上海市', '50': '重庆市' };
const PLATFORMS = ['拼多多', '淘宝网', '京东', '天猫', '抖音'];

export function buildFixtureCsv() {
  const prov = loadBoundary('geo-boundary-p.js');
  const city = loadBoundary('geo-boundary-c.js');
  const dist = loadBoundary('geo-boundary-d.js');

  const provName = new Map(prov.map((f) => [String(f[0]).slice(0, 2), f[1]]));
  const cityName = new Map(city.map((f) => [String(f[0]), f[1]]));
  const cityBox = new Map(city.map((f) => [String(f[0]), f[2] || null]));

  let seed = 20260929;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

  const months = [];
  for (let y = 2025, m = 4; months.length < 18; m++) {
    if (m > 12) { m = 1; y++; }
    months.push(y + '-' + String(m).padStart(2, '0') + '-01');
  }

  const places = [];
  for (const f of dist) {
    const code = String(f[0]);
    const name = String(f[1]);
    const p2 = code.slice(0, 2);
    const box = f[2] || cityBox.get(code.slice(0, 4) + '00');
    if (!box || box.length < 4) continue;
    const province = MUNI[p2] || provName.get(p2);
    if (!province) continue;
    const cname = cityName.get(code.slice(0, 4) + '00');
    const addr = MUNI[p2]
      ? MUNI[p2] + name
      : (cname && cname !== name ? province + cname + name : province + name);
    places.push({
      addr: addr,
      lng: Math.round((box[0] + box[2]) / 2 * 1e6) / 1e6,
      lat: Math.round((box[1] + box[3]) / 2 * 1e6) / 1e6
    });
  }

  const lines = ['地址,经度,纬度,客户数,时间,平台'];
  for (const p of places) {
    const big = rnd() < 0.04;             // 少量大客户地点（≥1000，撑起规模分档）
    const single = !big && rnd() < 0.18;  // 少量单客户地点（=1）
    const rows = single ? 1 : 4 + Math.floor(rnd() * 3);
    for (let k = 0; k < rows; k++) {
      const n = big && k === 0 ? 1000 + Math.floor(rnd() * 9000)
        : single ? 1
          : 1 + Math.floor(rnd() * 260);
      const mon = months[Math.floor(rnd() * months.length)];
      const plat = PLATFORMS[Math.floor(rnd() * PLATFORMS.length)];
      lines.push([p.addr, p.lng, p.lat, n, mon, plat].join(','));
    }
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

export function ensureFixtureCsv() {
  const dir = path.join(ROOT, 'tests', '.cache');
  const file = path.join(dir, '示例_汇总_区县.csv');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, buildFixtureCsv(), 'utf8');
  }
  return file;
}

if (process.argv[1] && process.argv[1].endsWith('fixture-data.mjs')) {
  const f = ensureFixtureCsv();
  const n = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '').length - 1;
  console.log('兜底测试数据已生成：' + f + '（' + n + ' 行）');
}
