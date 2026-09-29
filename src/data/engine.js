/* ================= 数据引擎（二期）=================
   用 DuckDB-WASM 在浏览器里跑 SQL：筛选、聚合、交叉表都交给它，
   主线程不再一行一行地循环几十万条数据。
   另外把数据写成 Parquet 存进 IndexedDB，下次打开直接读，不用重新解析 CSV。

   注意：file:// 下浏览器不允许取 wasm，会自动退回内置的 JS 计算路径，
   所以"双击就能用"依然成立，只是大数据时比 http 慢一点。 */
import * as duckdb from '@duckdb/duckdb-wasm';

/* 用绝对地址：Worker 内部 fetch 时，相对路径会以 worker 脚本为基准而拼错 */
const WASM_URL = new URL('vendor/duckdb/duckdb-eh.wasm', document.baseURI).href;
const WORKER_URL = new URL('vendor/duckdb/duckdb-browser-eh.worker.js', document.baseURI).href;
const DB_NAME = 'cm-data';
const STORE = 'files';

let db = null;
let conn = null;
let status = 'idle';      // idle | loading | ready | failed
let lastError = '';

export function engineStatus() { return { status, error: lastError, hasDb: !!db }; }

/* 启动 DuckDB。失败就返回 null，调用方走 JS 兜底，不影响功能。 */
export async function initEngine() {
  if (db) { return db; }
  if (status === 'failed') { return null; }
  if (typeof Worker === 'undefined' || location.protocol === 'file:') {
    status = 'failed';
    lastError = '当前打开方式不支持 wasm（file:// 或没有 Worker）';
    return null;
  }
  status = 'loading';
  try {
    const worker = new Worker(WORKER_URL);
    db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
    await db.instantiate(WASM_URL);
    conn = await db.connect();
    status = 'ready';
    return db;
  } catch (e) {
    status = 'failed';
    lastError = (e && e.message) || String(e);
    db = null;
    conn = null;
    return null;
  }
}

/* 把行数据装进 DuckDB。只带分析要用的列，能明显减少内存和传输。 */
export async function ingest(rows, regionCodes) {
  if (!conn) { return false; }
  const n = rows.length;
  const idx = new Int32Array(n);
  const cnt = new Int32Array(n);
  const t = new Float64Array(n);
  const plat = new Array(n);
  const lng = new Float64Array(n);
  const lat = new Float64Array(n);
  const adcode = new Array(n);
  const clean = new Array(n);
  const amount = new Float64Array(n);
  const shop = new Array(n);
  const rep = new Int32Array(n);
  const hf = new Int32Array(n);
  const act = new Int32Array(n);
  const orders = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    idx[i] = i;
    cnt[i] = r.count > 1 ? r.count : 1;
    t[i] = r.t == null ? Number.NaN : r.t;
    plat[i] = r.plat || '（未知平台）';
    lng[i] = typeof r.lng === 'number' ? r.lng : Number.NaN;
    lat[i] = typeof r.lat === 'number' ? r.lat : Number.NaN;
    adcode[i] = (regionCodes && regionCodes[i]) ? (regionCodes[i].d || regionCodes[i].c || regionCodes[i].p || '') : '';
    clean[i] = r.clean || '';
    amount[i] = Number(r.amount) || 0;
    shop[i] = r.shop || '';
    rep[i] = Number(r.rep) || 0;
    hf[i] = Number(r.hf) || 0;
    act[i] = Number(r.act) || 0;
    orders[i] = Number(r.orders) || 0;
  }
  /* 走"虚拟文件 + DuckDB 读表"这条路：DuckDB 的列式读取是它最强的地方。
     用制表符分隔而不是逗号——平台名、编码里可能出现逗号，用 \\t 就完全不用处理转义。 */
  /* amount / shop 是后加的列：语义层要用它们算「成交金额」「店铺数」这类度量。
     每列都会占内存，所以只加真正会被聚合的，不做"把整行都灌进去"。 */
  const parts = ['idx\tcnt\tt\tplat\tlng\tlat\tadcode\tclean\tamount\tshop\trep\thf\tact\torders'];
  for (let i = 0; i < n; i++) {
    parts.push(idx[i] + '\t' + cnt[i] + '\t' + (isNaN(t[i]) ? '' : t[i]) + '\t' +
      plat[i] + '\t' + (isNaN(lng[i]) ? '' : lng[i]) + '\t' + (isNaN(lat[i]) ? '' : lat[i]) + '\t' +
      adcode[i] + '\t' + clean[i] + '\t' + amount[i] + '\t' + shop[i] + '\t' +
      rep[i] + '\t' + hf[i] + '\t' + act[i] + '\t' + orders[i]);
  }
  await db.registerFileText('rows.tsv', parts.join('\n'));
  /* adcode 必须显式声明成 VARCHAR：它全是数字，自动嗅探会当成 BIGINT，
     于是 length(adcode) 这类字符串函数直接报 Binder Error ——
     而且错误被"静默退回 JS"吞掉，界面上完全看不出来。 */
  await conn.query("CREATE TABLE rows AS SELECT * FROM read_csv_auto('rows.tsv', header=true, delim='\\t', " +
    "nullstr='', sample_size=-1, types={'adcode': 'VARCHAR'})");
  // 自检：确认表真的建出来了，否则后续 SQL 会莫名其妙找不到表
  try {
    const chk = await conn.query('SELECT count(*) AS n FROM rows');
    const n2 = Number(chk.toArray()[0].n);
    lastError = '';
    return n2;
  } catch (err) {
    lastError = '建表后查不到数据：' + ((err && err.message) || err);
    throw err;
  }
}

/* 跑一句 SQL，返回普通对象数组 */
export async function query(sql) {
  if (!conn) { return null; }
  const res = await conn.query(sql);
  // DuckDB 的 count 返回 BigInt，统一转成普通数值，调用方不用操心
  return res.toArray().map(function (r) {
    const o = r.toJSON ? r.toJSON() : r;
    Object.keys(o).forEach(function (k) { if (typeof o[k] === 'bigint') { o[k] = Number(o[k]); } });
    return o;
  });
}

/* 把当前数据写成 Parquet 字节，便于缓存到本地 */
export async function toParquet(name) {
  if (!db) { return null; }
  const file = (name || 'rows') + '.parquet';
  await conn.query("COPY (SELECT * FROM rows) TO '" + file + "' (FORMAT PARQUET)");
  const buf = await db.copyFileToBuffer(file);
  await db.dropFile(file);
  return buf;
}

/**
 * 导出 Parquet，**带超时重试**。
 *
 * 为什么需要这个：实测 DuckDB-WASM 的 copyFileToBuffer 在"刚建完表"那一刻不稳定，
 * 同一份数据连测三次出现三种结果 —— 秒回空值 / 直接挂住不 settle / 1.4 秒后正常。
 * 挂住是最糟的：既不成功也不失败，调用方的后续代码永远不执行，
 * 于是"缓存写进去了吗"这个问题没有任何答案，缓存就那么静默地一直是空的（踩过）。
 *
 * 超时就重来一次；每次重试前稍等一下，避开刚建完表那段不稳定期。
 */
export async function toParquetStable(name, opts) {
  const tries = (opts && opts.tries) || 3;
  const timeoutMs = (opts && opts.timeoutMs) || 2500;
  const reasons = [];
  for (let i = 0; i < tries; i++) {
    const r = await Promise.race([
      toParquet(name).then(
        (b) => (b && b.byteLength ? { ok: true, bytes: b } : { ok: false, why: '返回空' }),
        (e) => ({ ok: false, why: String((e && e.message) || e) })
      ),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, why: '超时' }), timeoutMs))
    ]);
    if (r.ok) { return r.bytes; }
    reasons.push(r.why);
    await new Promise((resolve) => setTimeout(resolve, 300 * (i + 1)));
  }
  lastError = '导出 Parquet 失败（重试 ' + tries + ' 次）：' + reasons.join(' / ');
  return null;
}

/* 从 Parquet 字节恢复数据 */
export async function fromParquet(bytes, name) {
  if (!db || !conn) { return false; }
  const file = (name || 'rows') + '.parquet';
  // IndexedDB 取回来的可能不是 Uint8Array，统一转一下
  const buf = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes.buffer || bytes);
  await db.registerFileBuffer(file, buf);
  // rows 可能已经是张表（刚导入过），先清掉再挂视图
  try { await conn.query('DROP TABLE IF EXISTS rows'); } catch (e1) { /* 忽略 */ }
  try { await conn.query('DROP VIEW IF EXISTS rows'); } catch (e2) { /* 忽略 */ }
  await conn.query("CREATE VIEW rows AS SELECT * FROM parquet_scan('" + file + "')");
  return true;
}

/* ---------- IndexedDB：把 Parquet 字节存本地 ---------- */
function openIdb() {
  return new Promise(function (resolve, reject) {
    if (typeof indexedDB === 'undefined') { reject(new Error('没有 IndexedDB')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = function () {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) { d.createObjectStore(STORE); }
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}
export async function saveCache(bytes, meta) {
  try {
    const d = await openIdb();
    await new Promise(function (resolve, reject) {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ bytes, meta, at: Date.now() }, 'dataset');
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error); };
    });
    d.close();
    return true;
  } catch (e) { return false; }
}
export async function loadCache() {
  try {
    const d = await openIdb();
    const rec = await new Promise(function (resolve, reject) {
      const tx = d.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get('dataset');
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
    d.close();
    return rec || null;
  } catch (e) { return null; }
}
export async function clearCache() {
  try {
    const d = await openIdb();
    await new Promise(function (resolve) { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete('dataset'); tx.oncomplete = resolve; tx.onerror = resolve; });
    d.close();
  } catch (e) { /* 忽略 */ }
}

/* 临时诊断：验证 CREATE TABLE + SELECT 这条链路在这个构建里到底通不通 */
export async function spike() {
  const out = [];
  if (!conn) { return { ok: false, why: 'no conn' }; }
  try {
    await db.registerFileText('t.csv', 'a,b\n1,x\n2,y\n');
    out.push('registerFileText ok');
    await conn.query("CREATE TABLE tt AS SELECT * FROM read_csv_auto('t.csv', header=true)");
    out.push('create ok');
    const r1 = await conn.query('SELECT count(*) AS n FROM tt');
    out.push('count=' + r1.toArray().map(x => Number(x.n)).join(','));
    const r2 = await conn.query('SHOW TABLES');
    out.push('tables=' + JSON.stringify(r2.toArray().map(x => x.toJSON())));
    const r3 = await conn.query('SELECT * FROM tt');
    out.push('rows=' + r3.numRows);
    return { ok: true, steps: out };
  } catch (err) {
    return { ok: false, steps: out, err: (err && err.message) || String(err) };
  }
}
