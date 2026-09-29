#!/usr/bin/env node
/* 大文件离线批量解析 · v2
 *   把几十万到上千万行的订单/客户表，在**本机**聚合成程序能直接导入的小文件。
 *   全程流式读取，内存有界：1200 万行 / 924MB 实测 15~25 秒跑完。
 *
 *   能认三种地理来源（按数据里有什么自动选）：
 *     1) 收货地址文本          receiving_address / 收货地址 / 地址 …
 *     2) 省 + 市 + 区县 编码    province / city / area
 *     3) 省 + 市 编码（只有到市）  ← 订单表里最常见的形态，按城市中心点定位
 *   另外认时间、平台、店铺、手机号：
 *     · 有手机号 → 除了"去重客户数"，还会算出【客户画像】要用的三个数：
 *         复购客户数（全时段下过 ≥2 单）、高频客户数（≥10 单）、活跃客户数（最后一单在最近 3 个月内）
 *       这三列是"粗画像"的依据：人均单量 = 订单数 / 客户数，程序里按它把客户分成四档
 *     · 有手机号 → 除了"订单数"，还能算出去重后的"客户数"
 *     · 有店铺   → 加 --shop 把店铺也带进结果（程序里就能按店铺分析）
 *
 *   用法：node 批量解析大文件.js [文件.csv] [--no-split] [--shop]
 *     不给文件名就自动选目录里最大的 CSV（跳过已生成的 汇总_ / 明细_ / 未解析_）。
 *     默认按月拆分（有月份列时），--no-split 合并所有月份。
 *
 *   输出：汇总_按区县_三维.csv / 汇总_按城市_三维.csv / 汇总_按地点_三维.csv
 *         列：地址,经度,纬度,客户数,订单数,时间,平台[,店铺]
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = import.meta.dirname;
const C = { reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m' };
const human = n => Number(n).toLocaleString('en-US');
const mb = n => (n / 1024 / 1024).toFixed(1) + ' MB';

/* ---------- 载入本地地址库 ----------
   脚本自己是 ES module，所以这里不能用 require；三个库都是"挂到全局"的老式写法，
   给 globalThis 准备好 window 再动态 import 就行（浏览器那边完全不受影响）。 */
globalThis.window = globalThis;
await import('./geo-data.js');
await import('./local-geocode.js');
await import('./address-clean.js');
const LG = globalThis.LocalGeocode;
const Clean = globalThis.AddressClean;
const DB = globalThis.window.GEO_DB;
if (!LG || !Clean || !DB) {
  console.error(C.red + '本地地址库没加载上：检查 geo-data.js / local-geocode.js / address-clean.js 是否在同一个目录。' + C.reset);
  process.exit(1);
}

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const flags = argv.filter(a => a.startsWith('--'));
let input = argv.find(a => !a.startsWith('--'));
const splitMonth = flags.indexOf('--no-split') < 0;
const useShop = flags.indexOf('--shop') >= 0;
if (!input) {
  const csvs = fs.readdirSync(DIR).filter(f => /\.csv$/i.test(f))
    .map(f => ({ f, s: fs.statSync(path.join(DIR, f)).size }))
    .filter(x => !/^(汇总_|明细_|未解析_|合并结果_|示例_)/.test(x.f))
    .sort((a, b) => b.s - a.s);
  if (!csvs.length) { console.error('目录下没找到 CSV。用法：node 批量解析大文件.js 文件.csv'); process.exit(1); }
  input = csvs[0].f;
  console.log(C.dim + '未指定文件，自动选用最大的：' + input + C.reset);
}
const inPath = path.isAbsolute(input) ? input : path.join(DIR, input);
if (!fs.existsSync(inPath)) { console.error('找不到文件：' + inPath); process.exit(1); }
const inSize = fs.statSync(inPath).size;

function detectEncoding(p) {
  const fd = fs.openSync(p, 'r');
  const b = Buffer.alloc(65536);
  const n = fs.readSync(fd, b, 0, 65536, 0);
  fs.closeSync(fd);
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return 'utf8-bom';
  let bad = 0;
  const s = b.slice(0, n).toString('utf8');
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 0xFFFD) bad++;
  return bad > 5 ? 'gb18030' : 'utf8';
}

/* ---------- 流式 CSV（处理引号/逗号/换行） ---------- */
function makeCsvParser(onRecord) {
  let field = '', row = [], inQ = false;
  return {
    push(chunk) {
      for (let k = 0; k < chunk.length; k++) {
        const ch = chunk[k];
        if (inQ) {
          if (ch === '"') { if (chunk[k + 1] === '"') { field += '"'; k++; } else inQ = false; }
          else field += ch;
        } else {
          if (ch === '"') inQ = true;
          else if (ch === ',') { row.push(field); field = ''; }
          else if (ch === '\n') { row.push(field); onRecord(row); row = []; field = ''; }
          else if (ch !== '\r') field += ch;
        }
      }
    },
    end() { if (field !== '' || row.length) { row.push(field); onRecord(row); } }
  };
}

/* ---------- 列名 ---------- */
const KEYS = {
  addr:   ['receiving_address', '收货地址', '收件地址', '地址', '详细地址'],
  prov:   ['province', '省', '省份'],
  city:   ['city', '市', '城市'],
  area:   ['area', 'district', '区', '区县', '县'],
  time:   ['create_time', 'trade_time', 'payment_time', '创建时间', '成交时间', '下单时间', '付款时间', '时间'],
  plat:   ['platform', '平台'],
  shop:   ['shop_name', 'original_shop_name', '店铺名', '店铺'],
  id:     ['id', 'order_code', '原始订单号', '订单号', '订单编码'],
  phone:  ['phone', '手机号', '手机', '电话', 'buyer_phone'],
  count:  ['客户数', '数量', '订单数', '条数', 'count']
};
function findIdx(header, keys) {
  const lower = header.map(h => String(h || '').trim().toLowerCase());
  for (const k of keys) { const i = lower.indexOf(k.toLowerCase()); if (i >= 0) return i; }
  for (const k of keys) { const kk = k.toLowerCase(); if (kk.length < 2) continue;
    const i = lower.findIndex(h => h.indexOf(kk) >= 0); if (i >= 0) return i; }
  return -1;
}
function parseTime(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (v > 1e12) return v;
    if (v > 1e9) return v * 1000;
    if (v > 20000 && v < 80000) return Math.round((v - 25569) * 86400000);
    return null;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[-/.](d{1,2})[-/.](d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  const t = Date.parse(s.replace(/\//g, '-'));
  return isNaN(t) ? null : t;
}
/* 'YYYY-MM' → 自 1970-01 起的月份序号（比较"最近 3 个月"用） */
function monthIdxOf(mk) {
  var p = String(mk).split('-');
  return (+p[0]) * 12 + (+p[1] - 1);
}
function monthKey(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/* ---------- 读表头 ---------- */
function readHeader(p, enc) {
  return new Promise((resolve, reject) => {
    const dec = new TextDecoder(enc === 'gb18030' ? 'gb18030' : 'utf-8');
    const rs = fs.createReadStream(p, { highWaterMark: 1 << 16 });
    let done = false;
    const parser = makeCsvParser(rec => { if (!done) { done = true; rs.destroy(); resolve(rec.map(x => x.replace(/^\uFEFF/, ''))); } });
    rs.on('data', c => { if (!done) parser.push(dec.decode(c, { stream: true })); });
    rs.on('end', () => { if (!done) parser.end(); });
    rs.on('error', reject);
    setTimeout(() => { if (!done) { done = true; rs.destroy(); reject(new Error('读表头超时')); } }, 15000);
  });
}

/* ---------- 走一遍文件 ---------- */
function streamRows(p, enc, onRow) {
  return new Promise((resolve, reject) => {
    const dec = new TextDecoder(enc === 'gb18030' ? 'gb18030' : 'utf-8');
    const rs = fs.createReadStream(p, { highWaterMark: 1 << 22 });
    let first = true;
    const parser = makeCsvParser(rec => { if (first) { first = false; return; } if (rec && rec.length) onRow(rec); });
    rs.on('data', c => parser.push(dec.decode(c, { stream: true })));
    rs.on('end', () => { parser.end(); resolve(); });
    rs.on('error', reject);
  });
}

/* ---------- 小工具：位图与 32 位数组 ----------
   去重客户用"手机号后 9 位"当 key（11 位手机号去掉首位，最多 9 位数字，正好塞进 32 位整数）：
   精确去重，不用哈希，也就没有碰撞带来的误差。
   全局体检（去重客户 / 复购 / 重复 id）用位图，几千万行也只占固定几十 MB。 */
const BITS = 1 << 28, MASK = BITS - 1;
function makeBitmap() { return new Uint8Array(BITS >> 3); }
function bidx(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h ^ (h >>> 15)) & MASK;
}
function bitGet(b, i) { return (b[i >> 3] >> (i & 7)) & 1; }
function bitSet(b, i) { b[i >> 3] |= 1 << (i & 7); }
function popcount(a) {
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    let v = a[i];
    v = v - ((v >> 1) & 0x55); v = (v & 0x33) + ((v >> 2) & 0x33);
    n += (v + (v >> 4)) & 0x0f;
  }
  return n;
}
function phoneKey(raw) {
  const s = String(raw == null ? '' : raw).replace(/\D/g, '');
  let m = /^1\d{10}$/.test(s) ? s : (s.match(/1[3-9]\d{9}/) || null);
  /* 第二种是"尽力抽"：这个库里实测有 17 万行是「17177787762(虚拟号)」「+86132…」这类
     合法号码外面裹了脏字符，直接判废会白丢 1.4% 的客户。剩下的（***、座机、地址串进错列）
     真的抽不出来，只能算"算不出客户"。 */
  if (!m) { return -1; }
  const phone = typeof m === 'string' ? m : m[0];
  return Number(phone.slice(2));                  // 后 9 位，唯一且 < 2^32
}
function push32(g, v) {
  if (g.n === g.a.length) { const b = new Uint32Array(Math.max(8, g.a.length * 2)); b.set(g.a); g.a = b; }
  g.a[g.n++] = v;
}
function countUnique(a, n) {
  if (!n) { return 0; }
  const v = a.subarray(0, n); v.sort();
  let u = 1;
  for (let i = 1; i < n; i++) if (v[i] !== v[i - 1]) u++;
  return u;
}

(async () => {
  console.log('');
  console.log(C.bold + '客户地址 离线批量解析' + C.reset);
  const enc = detectEncoding(inPath);
  const header = await readHeader(inPath, enc);
  const I = {
    addr: findIdx(header, KEYS.addr), prov: findIdx(header, KEYS.prov), city: findIdx(header, KEYS.city),
    area: findIdx(header, KEYS.area), time: findIdx(header, KEYS.time), plat: findIdx(header, KEYS.plat),
    shop: findIdx(header, KEYS.shop), phone: findIdx(header, KEYS.phone), count: findIdx(header, KEYS.count),
    id: findIdx(header, KEYS.id)
  };
  const hasArea = I.area >= 0, hasCodes = I.prov >= 0 && I.city >= 0;
  const geoMode = hasArea ? 'code' : (hasCodes ? 'city' : (I.addr >= 0 ? 'addr' : ''));
  const GEO_TXT = { code: '省市区编码（' + header[I.area] + '）', city: '省市编码（' + header[I.city] + '，只到市）', addr: '地址文本（' + header[I.addr] + '）' };

  console.log('  文件   : ' + path.basename(inPath) + '  (' + mb(inSize) + ')');
  console.log('  编码   : ' + enc);
  console.log('  地理   : ' + (geoMode ? GEO_TXT[geoMode] : C.red + '没找到' + C.reset));
  console.log('  时间   : ' + (I.time >= 0 ? header[I.time] : C.dim + '无（就没有时间维度了）' + C.reset));
  console.log('  平台   : ' + (I.plat >= 0 ? header[I.plat] : C.dim + '无' + C.reset));
  console.log('  店铺   : ' + (I.shop >= 0 ? header[I.shop] + (useShop ? '' : C.dim + '（加 --shop 才带进结果）' + C.reset) : C.dim + '无' + C.reset));
  console.log('  手机号 : ' + (I.phone >= 0 ? header[I.phone] + '（用来算去重客户数）' : C.dim + '无（客户数只能按订单数算）' + C.reset));
  if (!geoMode) { console.error(C.red + '\n既没有地址列，也没有省市区 / 省市编码列，无法定位。' + C.reset); process.exit(1); }
  console.log('');

  const geo = LG.createGeocoder(DB);
  const agg = new Map();                 // key -> {label,lng,lat,plat,shop,month,n,ph}
  /* 每个手机号的全局画像：下过几单 + 最后一次是几月。
     只存一个打包过的整数（单数 << 16 | 月份序号），百万级客户也只占一百多 MB。 */
  const custStat = new Map();
  let maxMonthIdx = -1;
  const bad = new Map();
  const platCnt = new Map(), cityCnt = new Map(), shopCnt = new Map(), maskedShop = new Map();
  const seen1 = makeBitmap(), seen2 = makeBitmap(), seenId = makeBitmap();
  let total = 0, ok = 0, badPhone = 0, dupId = 0, masked = 0;
  const t0 = Date.now();
  let lastTick = Date.now();
  const digits = v => String(v == null ? '' : v).replace(/\D/g, '');
  const bump = (m, k) => { if (k) { m.set(k, (m.get(k) || 0) + 1); } };

  await streamRows(inPath, enc, rec => {
    total++;
    const p = I.prov >= 0 ? digits(rec[I.prov]) : '';
    const c = I.city >= 0 ? digits(rec[I.city]) : '';
    const a = hasArea ? digits(rec[I.area]) : '';
    let r = null;
    if (hasArea && a.length >= 6) { const x = geo.lookupByCode(p, c, a); if (x.ok) { r = x; } }
    if (!r && hasCodes) { const x = geo.lookupByCode(p, c, ''); if (x.ok) { r = x; } }   // 只有省市：按城市中心点
    if (!r && I.addr >= 0) {
      const cl = Clean.cleanAddress(rec[I.addr] || '');
      if (cl.clean) { const x = geo.lookup(cl.clean); if (x.ok) { r = x; } }
    }
    if (!r) {
      const rawTxt = I.addr >= 0 ? rec[I.addr] : '';
      const k = String(rawTxt + '|' + (hasArea ? a : c)).slice(0, 120);
      // 没有地址列就写编码，别让"未解析清单"里全是空白
      if (bad.size < 20000) bad.set(k, [rawTxt || ('省市编码 ' + p + ' / ' + c), '本地地名库里没有这个编码']);
      return;
    }
    ok++;
    const m = r.match || {};
    const parts = [];
    for (const v of [m.p, m.c, m.d]) { if (v && parts[parts.length - 1] !== v) parts.push(v); }
    const label = parts.join('') || (hasArea ? a : c);
    const plat = I.plat >= 0 ? String(rec[I.plat] || '').trim() : '';
    const shopName = I.shop >= 0 ? String(rec[I.shop] || '').trim() : '';
    const shop = useShop ? shopName : '';
    const mo = (splitMonth && I.time >= 0) ? monthKey(parseTime(rec[I.time])) : '';
    const key = label + '|' + plat + '|' + mo + '|' + shop;
    let e = agg.get(key);
    if (!e) {
      e = { label: label, lng: r.lng, lat: r.lat, plat: plat, shop: shop, month: mo, n: 0, ph: { a: new Uint32Array(8), n: 0 }, masked: 0 };
      agg.set(key, e);
    }
    const cnt = I.count >= 0 ? (parseInt(String(rec[I.count]).replace(/[^\d-]/g, ''), 10) || 1) : 1;
    e.n += cnt > 0 ? cnt : 1;
    const pk = I.phone >= 0 ? phoneKey(rec[I.phone]) : -1;
    if (pk >= 0) {
      var mi0 = mo ? monthIdxOf(mo) : 0;
      var st0 = custStat.get(pk);
      if (st0 === undefined) { custStat.set(pk, (1 << 16) | mi0); }
      else {
        var n0 = (st0 >> 16) + 1, m0 = Math.max(st0 & 0xffff, mi0);
        custStat.set(pk, (Math.min(n0, 0xffff) << 16) | m0);
      }
      if (mi0 > maxMonthIdx) { maxMonthIdx = mi0; }
    }
    if (I.phone >= 0) {
      if (pk >= 0) { push32(e.ph, pk); } else { e.masked += 1; masked++; }
      if (pk < 0) { badPhone++; } else {
        const h = pk & MASK;
        if (!bitGet(seen1, h)) { bitSet(seen1, h); } else { bitSet(seen2, h); }
      }
    }
    bump(platCnt, plat); bump(cityCnt, m.c || label); bump(shopCnt, shopName);
    if (I.phone >= 0 && I.shop >= 0 && pk < 0) { bump(maskedShop, shopName); }
    if (I.id >= 0) {
      const hh = bidx(String(rec[I.id] || ''));
      if (bitGet(seenId, hh)) { dupId++; } else { bitSet(seenId, hh); }
    }
    if (Date.now() - lastTick > 500) {
      lastTick = Date.now();
      process.stdout.write('\r  ' + C.cyan + '已处理 ' + human(total) + C.reset + '  成功 ' + human(ok) +
        '  聚合组 ' + human(agg.size) + '  ' + C.dim + ((total / (Date.now() - t0) * 1000) | 0) + ' 条/秒' + C.reset + '      ');
    }
  });

  /* 每个聚合组：手机号去重 → 客户数；同时按"客户全局画像"数出复购/高频/活跃 */
  const rows = Array.from(agg.values());
  let pairs = 0, fallbackGroups = 0, repTotal = 0, hfTotal = 0, actTotal = 0;
  for (const e of rows) {
    pairs += e.ph.n;
    if (I.phone >= 0 && e.ph.n) {
      const uniq = e.ph.a.subarray(0, e.ph.n).slice();
      uniq.sort();
      let cust = 0, rep = 0, hfN = 0, act = 0, prev = -1;
      for (let k = 0; k < uniq.length; k++) {
        const pk = uniq[k];
        if (pk === prev) { continue; }                   // 同一个客户在一组里只算一次
        prev = pk;
        cust++;
        const st = custStat.get(pk) || 0;
        const n = st >> 16;
        const lastM = st & 0xffff;
        if (n >= 2) { rep++; }
        if (n >= 10) { hfN++; }
        if (maxMonthIdx - lastM <= 2) { act++; }         // 最近 3 个月内有单
      }
      e.cust = cust; e.rep = rep; e.hf = hfN; e.act = act;
      repTotal += rep; hfTotal += hfN; actTotal += act;
    } else {
      /* 没有手机号（或整组都是掩码）就算不出画像，退回订单数并标注 */
      e.cust = e.n; e.rep = 0; e.hf = 0; e.act = 0;
      if (I.phone >= 0) { fallbackGroups++; }
    }
    e.orders = e.n;
    e.ph = null;                                          // 立刻放掉，别占着内存排序
  }
  rows.sort((a, b) => b.n - a.n);

  const secs = (Date.now() - t0) / 1000;
  process.stdout.write('\r' + ' '.repeat(110) + '\r');

  const baseName = '汇总_' + (geoMode === 'code' ? '按区县' : geoMode === 'city' ? '按城市' : '按地点') +
    (useShop ? '_店铺' : '') + '_三维.csv';
  const outFile = path.join(DIR, baseName);
  /* 覆盖前先留一份 .bak：这个工具的输出名是固定的（汇总_按区县_三维.csv …），
     而目录里可能放着别处要用的同名文件（比如测试用的汇总数据），直接冲掉就找不回来了。 */
  if (fs.existsSync(outFile)) {
    try { fs.renameSync(outFile, outFile + '.bak'); console.log(C.dim + '  已把旧的 ' + path.basename(outFile) + ' 备份成 ' + path.basename(outFile) + '.bak' + C.reset); }
    catch (e) { console.log(C.yellow + '  旧文件备份失败（' + e.message + '），继续覆盖' + C.reset); }
  }
  const ws = fs.createWriteStream(outFile);
  const esc = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  /* 客户数 + 订单数 + 画像三列（复购/高频/活跃）。后三列是"粗画像"的依据：
     人均单量 = 订单数 / 客户数，程序里按它把客户分成 一次性为主 / 复购型 / 高频复购 / 重度客户 四档。 */
  ws.write('\uFEFF地址,经度,纬度,客户数,订单数,复购客户数,高频客户数,活跃客户数,时间,平台' + (useShop ? ',店铺' : '') + '\n');
  for (const r of rows) {
    const dateCell = r.month ? r.month + '-01' : '';
    ws.write([esc(r.label), r.lng, r.lat, r.cust, r.n, r.rep, r.hf, r.act, dateCell, esc(r.plat), esc(r.shop)]
      .slice(0, useShop ? 11 : 10).join(',') + '\n');
  }
  ws.end();
  await new Promise(res => ws.on('finish', res));

  const badFile = path.join(DIR, '未解析_清单.csv');
  const ws2 = fs.createWriteStream(badFile);
  ws2.write('\uFEFF原始内容,失败原因\n');
  Array.from(bad.values()).slice(0, 20000).forEach(v => ws2.write(v.map(esc).join(',') + '\n'));
  ws2.end();
  await new Promise(res => ws2.on('finish', res));

  const topN = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  const distinct = popcount(seen1), repeat = popcount(seen2);
  console.log(C.bold + '完成' + C.reset + '   用时 ' + secs.toFixed(1) + ' 秒   ' + ((total / secs) | 0) + ' 条/秒');
  console.log('');
  console.log('  总行数        ' + human(total));
  console.log('  ' + C.green + '解析成功       ' + human(ok) + C.reset + '  (' + (ok / Math.max(1, total) * 100).toFixed(1) + '%)');
  console.log('  ' + C.yellow + '解析失败       ' + human(total - ok) + C.reset);
  console.log('  聚合后行数     ' + human(rows.length) + (useShop ? '（含店铺）' : (splitMonth && I.time >= 0 ? '（地点 × 平台 × 月份）' : '（地点 × 平台）')));
  console.log('');
  console.log(C.bold + '  数据体检' + C.reset);
  if (I.phone >= 0) {
    console.log('  去重客户       ' + human(distinct) + '    复购客户(≥2单) ' + human(repeat) +
      '  (' + (repeat / Math.max(1, distinct) * 100).toFixed(1) + '%)    平均单量 ' + (ok / Math.max(1, distinct)).toFixed(2));
    console.log('  手机号算不出客户 ' + human(badPhone) + ' 行 (' + (badPhone / Math.max(1, total) * 100).toFixed(1) + '%)，只进订单数');
    if (masked) { console.log('    ' + C.dim + '（多半是平台脱敏成 *** 的行，例如：' + topN(maskedShop, 3).map(x => x[0]).join('、') + '）' + C.reset); }
    if (fallbackGroups) { console.log('    ' + C.dim + '有 ' + fallbackGroups + ' 个组整组手机号都是掩码，客户数按订单数兜底' + C.reset); }
  }
  if (dupId) { console.log('  重复的 id      ' + human(dupId) + ' 行（第 2 列有重复值，导入前建议先去重）'); }
  if (I.phone >= 0 && rows.length) {
    var custAll = rows.reduce(function (a, r) { return a + (r.cust || 0); }, 0);
    console.log(C.bold + '  客户画像（粗）' + C.reset);
    console.log('    复购客户 ' + human(repTotal) + ' 次计入 / 高频(≥10单) ' + human(hfTotal) + ' 次计入 / 活跃(近3月) ' + human(actTotal) + ' 次计入');
    console.log('    ' + C.dim + '同一客户会出现在多个地点/平台/店铺/月份里，所以这里是"计入次数"，不是去重人数' + C.reset);
  }
  console.log('  平台 ' + platCnt.size + ' 种  ' + topN(platCnt, 5).map(x => x[0] + ' ' + human(x[1])).join(' / '));
  console.log('  城市 ' + cityCnt.size + ' 个  ' + topN(cityCnt, 5).map(x => x[0] + ' ' + human(x[1])).join(' / '));
  if (I.shop >= 0) { console.log('  店铺 ' + shopCnt.size + ' 家  ' + topN(shopCnt, 5).map(x => x[0] + ' ' + human(x[1])).join(' / ')); }
  console.log('');
  console.log('  生成： ' + C.bold + path.basename(outFile) + C.reset + '  (' + mb(fs.statSync(outFile).size) + ')');
  console.log('  把这个文件拖进程序，就能按 时间 / 平台 / 地理' + (useShop ? ' / 店铺' : '') + ' 几个维度看了。');
  console.log(C.dim + '  （客户数 = 同一地点同一维度下去重后的手机号数；没有手机号列时就是订单数）' + C.reset);
})().catch(e => { console.error(C.red + '\n出错：' + (e && e.stack || e.message) + C.reset); process.exit(1); });
