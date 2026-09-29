/* 下载全国行政区边界（省/市/区县三级），供地图分层着色使用。
   数据源：阿里云 DataV 行政区边界服务（公开数据），坐标系 GCJ02，与本地地址库一致。 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '_boundary_raw');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

function get(url, tries) {
  tries = tries || 0;
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'codex-customer-map/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location, tries).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        if (tries < 3) return setTimeout(() => get(url, tries + 1).then(resolve, reject), 600);
        return reject(new Error('HTTP ' + res.statusCode + ' ' + url));
      }
      let d = '';
      res.setEncoding('utf8');
      res.on('data', c => { d += c; });
      res.on('end', () => resolve(d));
    }).on('error', e => {
      if (tries < 3) return setTimeout(() => get(url, tries + 1).then(resolve, reject), 800);
      reject(e);
    });
  });
}
const BASE = 'https://geo.datav.aliyun.com/areas_v3/bound/';

async function pool(items, limit, fn, label) {
  let i = 0, done = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const k = i++;
      try { await fn(items[k]); } catch (e) { console.log('FAIL ' + items[k] + ' ' + e.message); }
      done++;
      if (done % 40 === 0) console.log(label + ' ' + done + '/' + items.length);
    }
  });
  await Promise.all(workers);
}

(async () => {
  // 1) 省级
  const top = JSON.parse(await get(BASE + '100000_full.json'));
  fs.writeFileSync(path.join(OUT, '100000_full.json'), JSON.stringify(top));
  const provinces = top.features.map(f => String(f.properties.adcode))
    .filter(a => /^\d{6}$/.test(a) && a !== '100000');
  console.log('省级数量 ' + provinces.length + ' | 顶层要素 ' + top.features.length);

  // 2) 每个省（得到市，或直辖市的区）
  await pool(provinces, 6, async code => {
    const txt = await get(BASE + code + '_full.json');
    fs.writeFileSync(path.join(OUT, code + '_full.json'), txt);
  }, '省级');

  // 3) 每个市（得到区县）
  const cities = [];
  provinces.forEach(code => {
    const p = path.join(OUT, code + '_full.json');
    if (!fs.existsSync(p)) return;
    let j;
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return; }
    (j.features || []).forEach(f => {
      const lv = f.properties.level, ad = String(f.properties.adcode);
      if (lv === 'city' && ad.slice(4) === '00') cities.push(ad);
    });
  });
  console.log('市级数量 ' + cities.length);

  await pool(cities, 6, async code => {
    const txt = await get(BASE + code + '_full.json');
    fs.writeFileSync(path.join(OUT, code + '_full.json'), txt);
  }, '市级');

  const files = fs.readdirSync(OUT);
  let bytes = 0;
  files.forEach(f => { bytes += fs.statSync(path.join(OUT, f)).size; });
  console.log('DONE 文件数 ' + files.length + ' | 合计 ' + (bytes / 1048576).toFixed(1) + ' MB');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
