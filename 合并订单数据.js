#!/usr/bin/env node
/* 把两张表合并成程序能直接导入的一个 CSV
 *   表 A（订单/销售表）→ 时间 / 平台 / 店铺 / 金额
 *   表 B（收货信息表）→ 收件人 / 电话 / 收货地址
 * 两张表靠 order_code 关联。
 *
 * 用法： node 合并订单数据.js 订单中心.csv 无仓订单.csv [输出.csv]
 *       也可以把两个文件拖到 合并订单数据.bat 上
 */
import fs from 'node:fs';
import path from 'node:path';
const DIR = import.meta.dirname;
const C = { reset:'\x1b[0m', dim:'\x1b[2m', bold:'\x1b[1m', green:'\x1b[32m', yellow:'\x1b[33m', red:'\x1b[31m', cyan:'\x1b[36m' };
const human = n => Number(n).toLocaleString('en-US');
const mb = n => (n / 1024 / 1024).toFixed(1) + ' MB';

const rawArgv = process.argv.slice(2);
const argv = rawArgv.filter(a => !a.startsWith('--'));
var timeCol = '';
for (var ai = 0; ai < rawArgv.length; ai++) {
  if (rawArgv[ai] === '--time' && rawArgv[ai + 1]) { timeCol = rawArgv[ai + 1]; }
}
if (argv.length < 2) {
  console.log('用法： node 合并订单数据.js <订单中心表.csv> <无仓订单表.csv> [输出.csv]');
  console.log('说明：第一个文件提供时间/平台，第二个文件提供收货地址，靠 order_code 关联。');
  console.log('可加参数 --time trade_time 指定用哪个时间列（默认 create_time）。');
  process.exit(1);
}
const fA = path.isAbsolute(argv[0]) ? argv[0] : path.join(DIR, argv[0]);
const fB = path.isAbsolute(argv[1]) ? argv[1] : path.join(DIR, argv[1]);
const fOut = argv[2] ? (path.isAbsolute(argv[2]) ? argv[2] : path.join(DIR, argv[2])) : path.join(DIR, '合并结果_可导入.csv');
for (const f of [fA, fB]) { if (!fs.existsSync(f)) { console.error(C.red + '找不到文件：' + f + C.reset); process.exit(1); } }

/* ---------- 编码探测 ---------- */
function detectEncoding(p) {
  const fd = fs.openSync(p, 'r');
  const b = Buffer.alloc(65536);
  const n = fs.readSync(fd, b, 0, 65536, 0);
  fs.closeSync(fd);
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) { return 'utf8-bom'; }
  let bad = 0;
  const s = b.slice(0, n).toString('utf8');
  for (let i = 0; i < s.length; i++) { if (s.charCodeAt(i) === 0xFFFD) { bad++; } }
  return bad > 5 ? 'gb18030' : 'utf8';
}

/* ---------- 流式 CSV 解析（正确处理引号/逗号/换行） ---------- */
function makeCsvParser(onRecord) {
  let field = '', row = [], inQ = false;
  return {
    push(chunk) {
      for (let k = 0; k < chunk.length; k++) {
        const ch = chunk[k];
        if (inQ) {
          if (ch === '"') { if (chunk[k + 1] === '"') { field += '"'; k++; } else { inQ = false; } }
          else { field += ch; }
        } else {
          if (ch === '"') { inQ = true; }
          else if (ch === ',') { row.push(field); field = ''; }
          else if (ch === '\n') { row.push(field); onRecord(row); row = []; field = ''; }
          else if (ch !== '\r') { field += ch; }
        }
      }
    },
    end() { if (field !== '' || row.length) { row.push(field); onRecord(row); } }
  };
}

/* ---------- 列名匹配 ---------- */
const KEYS = {
  code:   ['order_code', '订单中心销售单号', '订单号', '订单编号', '销售单号', '原始订单号'],
  addr:   ['receiving_address', '收货地址', '收件地址', '地址'],
  time:   ['create_time', 'trade_time', 'payment_time', '创建时间', '成交时间', '下单时间', '付款时间'],
  plat:   ['platform', '平台'],
  shop:   ['shop_name', 'original_shop_name', '店铺名', '原始店铺名'],
  source: ['order_source', '来源系统', '订单来源'],
  amount: ['payment_price', 'total_trade_price', '实付金额', '成交价格', '金额']
};
function findIdx(header, keys) {
  const lower = header.map(h => String(h || '').trim().toLowerCase());
  for (const k of keys) {
    const kk = k.toLowerCase();
    let i = lower.indexOf(kk);
    if (i >= 0) return i;
  }
  for (const k of keys) {
    const kk = k.toLowerCase();
    let i = lower.findIndex(h => h.indexOf(kk) >= 0);
    if (i >= 0) return i;
  }
  return -1;
}

/* ---------- 读取文件头 ---------- */
function readHeader(p, enc) {
  return new Promise((resolve, reject) => {
    const dec = new TextDecoder(enc === 'gb18030' ? 'gb18030' : 'utf-8');
    const rs = fs.createReadStream(p, { highWaterMark: 1 << 16 });
    let head = '', headDone = false;
    const parser = makeCsvParser(rec => { if (!headDone) { headDone = true; rs.destroy(); resolve(rec.map(x => x.replace(/^\uFEFF/, ''))); } });
    rs.on('data', c => { if (!headDone) parser.push(dec.decode(c, { stream: true })); });
    rs.on('end', () => { if (!headDone) { parser.end(); } });
    rs.on('error', reject);
    setTimeout(() => { if (!headDone) { headDone = true; rs.destroy(); reject(new Error('读取表头超时')); } }, 15000);
  });
}

(async () => {
  console.log('');
  console.log(C.bold + '订单数据合并（订单中心 + 无仓订单表）' + C.reset);
  console.log('');
  const encA = detectEncoding(fA), encB = detectEncoding(fB);
  const headA = await readHeader(fA, encA);
  const headB = await readHeader(fB, encB);
  console.log('  A ' + path.basename(fA) + '  (' + mb(fs.statSync(fA).size) + ')');
  console.log('  B ' + path.basename(fB) + '  (' + mb(fs.statSync(fB).size) + ')');

  // 判断哪个文件有地址、哪个有时间和平台
  function role(header) {
    return { code: findIdx(header, KEYS.code), addr: findIdx(header, KEYS.addr),
             time: findIdx(header, KEYS.time), plat: findIdx(header, KEYS.plat),
             shop: findIdx(header, KEYS.shop), source: findIdx(header, KEYS.source),
             amount: findIdx(header, KEYS.amount) };
  }
  // --time 指定时间列时，把它放到候选最前
  function pickTime(header) {
    if (timeCol) {
      const i = findIdx(header, [timeCol]);
      if (i >= 0) { return i; }
      console.log(C.yellow + '  提示：指定的时间列 ' + timeCol + ' 没找到，改用默认列' + C.reset);
    }
    return findIdx(header, KEYS.time);
  }
  let A = { f: fA, enc: encA, head: headA, r: role(headA), size: fs.statSync(fA).size };
  let B = { f: fB, enc: encB, head: headB, r: role(headB), size: fs.statSync(fB).size };
  // 让 A=有时间/平台的，B=有地址的
  if (A.r.addr >= 0 && A.r.time < 0 && B.r.time >= 0) { const t = A; A = B; B = t; }
  console.log('');
  A.r.time = pickTime(A.head);
  console.log('  时间/平台取自： ' + path.basename(A.f) + (A.r.time >= 0 ? '  ✓ 时间列 = ' + A.head[A.r.time] : '  ' + C.red + '（没找到时间列）' + C.reset));
  if (A.head.indexOf('create_time') >= 0 && A.head.indexOf('trade_time') >= 0 && !timeCol) {
    console.log(C.dim + '    提示：表里有多个时间列，默认用了 create_time；要换成别的加参数 --time trade_time' + C.reset);
  }
  console.log('  收货地址取自： ' + path.basename(B.f) + (B.r.addr >= 0 ? '  ✓' : '  ' + C.red + '（没找到地址列）' + C.reset));
  if (A.r.code < 0 || B.r.code < 0) { console.error(C.red + '两个文件都必须有 order_code 列' + C.reset); process.exit(1); }
  if (B.r.addr < 0) { console.error(C.red + '找不到收货地址列（receiving_address / 收货地址）' + C.reset); process.exit(1); }

  /* ---------- 索引较小的那个文件 ---------- */
  const indexB = B.size <= A.size;                 // 通常无仓订单表更小
  const idxFile = indexB ? B : A;
  const strFile = indexB ? A : B;
  const idxRole = indexB ? idxFile.r : idxFile.r;
  console.log('');
  console.log(C.dim + '  用 ' + path.basename(idxFile.f) + ' 建索引（' + mb(idxFile.size) + '），另一个流式读取…' + C.reset);

  const idxMap = new Map();
  await new Promise((resolve, reject) => {
    const dec = new TextDecoder(idxFile.enc === 'gb18030' ? 'gb18030' : 'utf-8');
    const rs = fs.createReadStream(idxFile.f, { highWaterMark: 1 << 22 });
    let first = true, n = 0;
    const parser = makeCsvParser(rec => {
      if (first) { first = false; return; }
      const code = String(rec[idxFile.r.code] || '').trim();
      if (!code) { return; }
      if (indexB) { idxMap.set(code, String(rec[idxFile.r.addr] || '').trim()); }
      else {
        idxMap.set(code, {
          t: idxFile.r.time >= 0 ? String(rec[idxFile.r.time] || '').trim() : '',
          plat: idxFile.r.plat >= 0 ? String(rec[idxFile.r.plat] || '').trim() : '',
          shop: idxFile.r.shop >= 0 ? String(rec[idxFile.r.shop] || '').trim() : '',
          src: idxFile.r.source >= 0 ? String(rec[idxFile.r.source] || '').trim() : '',
          amt: idxFile.r.amount >= 0 ? String(rec[idxFile.r.amount] || '').trim() : ''
        });
      }
      n++;
      if (n % 500000 === 0) { process.stdout.write('\r  已索引 ' + human(n) + ' 条…     '); }
    });
    rs.on('data', c => parser.push(dec.decode(c, { stream: true })));
    rs.on('end', () => { parser.end(); process.stdout.write('\r' + ' '.repeat(46) + '\r'); console.log('  索引完成：' + human(idxMap.size) + ' 个订单号'); resolve(); });
    rs.on('error', reject);
  });

  if (idxMap.size > 6000000) { console.log(C.yellow + '  提示：索引量很大，内存占用较高' + C.reset); }

  /* ---------- 流式关联并输出 ---------- */
  const out = fs.createWriteStream(fOut);
  out.write('\uFEFForder_code,create_time,platform,shop_name,order_source,receiving_address,payment_price\n');
  function cell(v) { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

  let total = 0, matched = 0, noAddr = 0, t0 = Date.now();
  await new Promise((resolve, reject) => {
    const dec = new TextDecoder(strFile.enc === 'gb18030' ? 'gb18030' : 'utf-8');
    const rs = fs.createReadStream(strFile.f, { highWaterMark: 1 << 22 });
    let first = true, ticks = Date.now();
    const parser = makeCsvParser(rec => {
      if (first) { first = false; return; }
      const code = String(rec[strFile.r.code] || '').trim();
      if (!code) { return; }
      total++;
      var addr = '', t = '', plat = '', shop = '', src = '', amt = '';
      if (indexB) {
        addr = idxMap.get(code) || '';
        t = strFile.r.time >= 0 ? String(rec[strFile.r.time] || '').trim() : '';
        plat = strFile.r.plat >= 0 ? String(rec[strFile.r.plat] || '').trim() : '';
        shop = strFile.r.shop >= 0 ? String(rec[strFile.r.shop] || '').trim() : '';
        src = strFile.r.source >= 0 ? String(rec[strFile.r.source] || '').trim() : '';
        amt = strFile.r.amount >= 0 ? String(rec[strFile.r.amount] || '').trim() : '';
      } else {
        const v = idxMap.get(code);
        if (v) { t = v.t; plat = v.plat; shop = v.shop; src = v.src; amt = v.amt; }
        addr = strFile.r.addr >= 0 ? String(rec[strFile.r.addr] || '').trim() : '';
      }
      if (!addr) { noAddr++; } else { matched++; }
      out.write([code, t, plat, shop, src, addr, amt].map(cell).join(',') + '\n');
      if (Date.now() - ticks > 500) {
        ticks = Date.now();
        process.stdout.write('\r  ' + C.cyan + '已处理 ' + human(total) + ' 条' + C.reset + '  有地址 ' + human(matched) + '  缺地址 ' + human(noAddr) + '     ');
      }
    });
    rs.on('data', c => parser.push(dec.decode(c, { stream: true })));
    rs.on('end', () => { parser.end(); out.end(); resolve(); });
    rs.on('error', reject);
  });

  const secs = (Date.now() - t0) / 1000;
  process.stdout.write('\r' + ' '.repeat(80) + '\r');
  console.log('');
  console.log(C.bold + '完成' + C.reset + '  用时 ' + secs.toFixed(1) + ' 秒');
  console.log('  总记录      ' + human(total));
  console.log('  ' + C.green + '关联到地址   ' + human(matched) + C.reset + '  (' + (matched / Math.max(1, total) * 100).toFixed(1) + '%)');
  console.log('  ' + C.yellow + '没关联到     ' + human(noAddr) + C.reset);
  console.log('');
  console.log('  输出： ' + C.bold + path.basename(fOut) + C.reset + '  (' + mb(fs.statSync(fOut).size) + ')');
  console.log('  把这个文件拖进程序就能用了。');
})().catch(e => { console.error(C.red + '\n出错：' + e.message + C.reset); process.exit(1); });
