import { openApp, checker, startServer, ROOT } from '../lib.mjs';
import path from 'node:path';

export const name = 'http 模式 / 后台解析线程 · Parquet 缓存 · 重新打开恢复';

/* 这一组补的是另一块盲区。
   ------------------------------------------------------------------
   项目有两个打开方式：
     · 双击 打开地图.html（file://）—— 主推，但拿不到 Worker / wasm
     · 双击 启动服务.bat（http://localhost）—— 后台解析线程、SQL 引擎、Parquet 缓存都在这边

   端到端一直只跑 file://，所以 http 专属的那几项能力**一次都没被验证过**。
   这一组把它们钉住。写完立刻抓到两个真问题（见下面的注释）。 */

const CSV_ORDER = path.join(ROOT, '示例_订单数据.csv');

async function importAndParse(page) {
  await page.click('#btn-import');
  await page.setInputFiles('#imp-file', CSV_ORDER);
  await page.waitForFunction(() => {
    const l = document.getElementById('loading');
    const s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 400;
  }, null, { timeout: 180000 });
  await page.click('#btn-run');
  await page.waitForFunction(() => document.getElementById('btn-run').textContent.indexOf('开始解析') >= 0, null, { timeout: 180000 });
}

export default async function run(browser) {
  const c = checker();

  /* ---- 0. 先看一眼对照：file:// 下没有后台线程 ---- */
  {
    const p = await openApp(browser);
    await importAndParse(p);
    await p.waitForTimeout(2500);
    const fileMode = await p.evaluate(() => ({
      worker: window.__cmNameMap || null,
      engine: window.__cm.engine().status,
      hasWorkerCtor: typeof Worker !== 'undefined'
    }));
    c.ok('file:// 下不起后台解析线程（浏览器不给 Worker 取脚本）',
      fileMode.worker === null, JSON.stringify(fileMode));
    c.ok('file:// 下 SQL 引擎也起不来（这是设计内，不是故障）',
      fileMode.engine !== 'ready', fileMode.engine);
    await p.close();
  }

  /* ---- 1. http 模式 ---- */
  const srv = await startServer();
  try {
    const page = await openApp(browser, { url: srv.url });
    // 清掉可能残留的缓存，保证这一次是"从零导入"
    await page.evaluate(() => new Promise((r) => {
      const q = indexedDB.deleteDatabase('cm-data');
      q.onsuccess = q.onerror = q.onblocked = () => r();
    }));

    await importAndParse(page);
    // 缓存有超时重试，最坏要几秒才落盘
    await page.waitForFunction(
      () => { const e = window.__cm.engine(); return e.cacheBytes > 0 || e.cacheError; },
      null, { timeout: 40000 });

    const after = await page.evaluate(() => ({
      worker: window.__cmNameMap || null,
      engine: window.__cm.engine(),
      rows: window.__cm.state.rows.length,
      shops: window.__cm.state.rows.filter((r) => r.shop).length,
      amounts: window.__cm.state.rows.filter((r) => r.amount).length
    }));

    c.ok('http 下后台解析线程跑出了结果',
      after.worker && after.worker.names > 0 && after.worker.mapped > 0, JSON.stringify(after.worker));
    c.ok('SQL 引擎就绪', after.engine.status === 'ready', after.engine.status);

    /* 关键：**不允许"既没写成功、也没说为什么"**。
       以前这里就是那样 —— toParquet 的 Promise 永远不 settle，
       cacheBytes 一直是 0、cacheError 一直是空，界面上还写着"引擎已就绪"。
       结果就是"缓存功能看起来在，其实从来没写成过"，而且没有任何地方会告诉你。 */
    c.ok('缓存要么写成功、要么给出明确原因（不许静默）',
      after.engine.cacheBytes > 0 || !!after.engine.cacheError, JSON.stringify(after.engine));
    c.ok('Parquet 缓存写进了 IndexedDB', after.engine.cacheBytes > 0, String(after.engine.cacheBytes));

    /* ---- 2. 关掉重开：应当自动恢复，不用再导一次 ---- */
    await page.reload();
    await page.waitForFunction(
      () => window.__cm && parseInt((document.getElementById('st-total').textContent || '0').replace(/,/g, ''), 10) > 400,
      null, { timeout: 120000 });

    const restored = await page.evaluate(() => ({
      total: document.getElementById('st-total').textContent,
      rows: window.__cm.state.rows.length,
      engine: window.__cm.engine().status,
      toast: document.getElementById('toast').textContent,
      shops: window.__cm.state.rows.filter((r) => r.shop).length,
      amounts: window.__cm.state.rows.filter((r) => r.amount).length
    }));

    c.eq('重新打开后条数一样（不用再导一次）', restored.rows, after.rows);
    c.ok('给了"已恢复"的提示', /已恢复/.test(restored.toast), restored.toast);
    c.ok('恢复后 SQL 引擎还是可用', restored.engine === 'ready', restored.engine);

    /* 恢复的列必须够分析用。
       以前 restoreFromCache 只 SELECT 了 8 列，shop / amount 没取 ——
       恢复之后「店铺分布」是空的、「成交金额」是 0，同样没有任何提示。 */
    c.ok('恢复后店铺列还在', restored.shops > 0, String(restored.shops));
    c.ok('恢复后金额列还在', restored.amounts > 0, String(restored.amounts));

    // 恢复后的数据要能真的参与分析
    await page.click('#viewswitch button[data-view="analysis"]');
    await page.waitForFunction(() => document.querySelectorAll('#dash .kpi').length > 0, null, { timeout: 60000 });
    await page.waitForTimeout(800);
    const ana = await page.evaluate(() => ({
      status: document.getElementById('ana-status').textContent,
      kpis: [].slice.call(document.querySelectorAll('#dash .kpi')).map((e) => e.textContent.trim()),
      shopItems: (window.__cm.charts().data.shop || []).length
    }));
    c.eq('恢复后 KPI 的记录数和导入时一致', ana.kpis[0], after.rows.toLocaleString() + '记录数');
    c.ok('恢复后店铺分布有数据（说明店铺列真的带回来了）', ana.shopItems > 0, String(ana.shopItems));

    c.results.push({ name: '没有页面报错', pass: page.__errors.length === 0, detail: page.__errors.join(' | ') });
    await page.close();
  } finally {
    await srv.close();
  }
  return c.results;
}
