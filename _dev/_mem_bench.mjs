/* P0-2 内存基准：可复现的"改前/改后"对照测量
   用法：node _dev/_mem_bench.mjs [csv路径] [标签]

   为什么不用 performance.memory：
     Chromium 出于安全考虑把 usedJSHeapSize 量化到 100KB，并且**最多每 20 分钟才更新一次**。
     实测导入 42.7 万行后它纹丝不动（一直是 82MB），完全不可用。
   改成 CDP：
     Runtime.getHeapUsage  → 精确堆大小（usedSize）
     HeapProfiler.collectGarbage → 权威强制 GC，不依赖 --expose-gc
*/
import { chromium } from 'playwright';
import path from 'node:path';

const CSV = process.argv[2] || 'D:/codex1/customer-map/汇总_按区县_三维.csv';
const LABEL = process.argv[3] || 'baseline';
const APP_ARG = process.argv[4] || '';
const APP = APP_ARG ? ('file:///D:/codex1/customer-map/' + APP_ARG) : 'file:///D:/codex1/customer-map/打开地图.html';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1560, height: 950 } });
const cdp = await page.context().newCDPSession(page);
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR ' + String(e.message).slice(0, 160)));
page.on('console', m => { if (m.type() === 'error' && !/baidu|ERR_FAILED|404/.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 160)); });

const heapMB = async (gcRounds = 3) => {
  for (let i = 0; i < gcRounds; i++) {
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(150);
  }
  const u = await cdp.send('Runtime.getHeapUsage');
  return Math.round(u.usedSize / 1048576);
};

await page.goto(APP);
await page.waitForTimeout(1200);
const before = await heapMB();

const t0 = Date.now();
await page.click('#btn-import');
await page.setInputFiles('#imp-file', CSV);
await page.waitForFunction(() => {
  const l = document.getElementById('loading'), s = document.getElementById('st-total');
  return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 1000;
}, null, { timeout: 900000 });
const importMs = Date.now() - t0;
await page.waitForTimeout(1500);

const rows = await page.evaluate(() => window.__cm.state.rows.length);
const after = await heapMB(4);

const t1 = Date.now();
await page.click('#viewswitch button[data-view="analysis"]');
await page.waitForFunction(() => /^用时/.test(document.getElementById('ana-status').textContent), null, { timeout: 300000 });
const analysisMs = Date.now() - t1;
await page.waitForTimeout(800);

const t2 = Date.now();
await page.click('#viewswitch button[data-view="map"]');
await page.waitForFunction(() => !document.getElementById('view-map').hidden, null, { timeout: 60000 });
const mapMs = Date.now() - t2;

console.log(JSON.stringify({
  标签: LABEL,
  数据文件: path.basename(CSV),
  行数: rows,
  打开后MB: before,
  导入后MB: after,
  '每行字节': rows ? Math.round((after - before) * 1048576 / rows) : null,
  导入耗时s: +(importMs / 1000).toFixed(2),
  分析页耗时s: +(analysisMs / 1000).toFixed(2),
  回地图耗时s: +(mapMs / 1000).toFixed(2),
  报错: errs.length
}, null, 1));
await browser.close();
