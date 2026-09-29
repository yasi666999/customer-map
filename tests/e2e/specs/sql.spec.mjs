import { openApp, checker, startServer, ROOT } from '../lib.mjs';
import path from 'node:path';

export const name = 'SQL 通道 / 两条路必须给出同一份结果';

/* 这一组是补历史欠账。
   ------------------------------------------------------------------
   在 file:// 下浏览器不给 Worker 取 wasm，DuckDB 引擎起不来 —— 所以
   **SQL 通道在之前整套端到端里一次都没被跑过**。改过它好几次，全靠肉眼。
   这条用例起一个本地 http 服务，把引擎真正拉起来，然后：
     1. 确认分析确实走了 SQL
     2. 同一个筛选下，SQL 通道和 JS 通道的结果**逐项相等**
     3. 推不下去的条件（半径、搜索词）走"先砍行再收尾"，结果仍相等
   顺带把「部分下推」这件事变成可验证的：能全下推时状态栏写 · SQL，
   只下推一部分时写 · SQL→JS。 */

const CSV_ORDER = path.join(ROOT, '示例_订单数据.csv');

/* 把"当前这一屏的结果"抓成一个可比较的快照 */
async function snapshot(page) {
  return page.evaluate(() => {
    const kpis = [].slice.call(document.querySelectorAll('#dash .kpi')).map((e) => e.textContent.trim());
    const data = window.__cm.charts().data;
    const head = (arr) => (arr || []).slice(0, 8).map((x) => x.label + '=' + x.v).join('|');
    return {
      kpis: kpis,
      plat: head(data.plat),
      time: head(data.time),
      status: document.getElementById('ana-status').textContent
    };
  });
}

/* 点「查询」并等**这一次**真的跑完。
   不能只看状态栏是不是"用时…" —— 上一次跑完也长这样，会抢跑（改筛选后
   还没重算就去读结果，抓到的是上一次的数）。所以用运行计数判断。 */
async function runAndWait(page) {
  await page.waitForFunction(() => document.getElementById('ana-run').textContent === '查询', null, { timeout: 120000 });
  const before = await page.evaluate(() => window.__cm.anaRuns());
  await page.click('#ana-run');
  await page.waitForFunction((n0) => window.__cm.anaRuns() > n0, before, { timeout: 120000 });
  await page.waitForTimeout(300);
}

export default async function run(browser) {
  const c = checker();
  const srv = await startServer();
  try {
    const page = await openApp(browser, { url: srv.url });

    // 导入 + 解析（订单数据要先跑本地解析才有坐标）
    await page.click('#btn-import');
    await page.setInputFiles('#imp-file', CSV_ORDER);
    await page.waitForFunction(() => {
      const l = document.getElementById('loading');
      const s = document.getElementById('st-total');
      return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 400;
    }, null, { timeout: 180000 });
    await page.waitForTimeout(1500);
    await page.click('#btn-run');
    await page.waitForFunction(() => document.getElementById('btn-run').textContent.indexOf('开始解析') >= 0, null, { timeout: 180000 });
    await page.waitForTimeout(1200);

    const engine = await page.evaluate(() => window.__cm.engine());
    c.ok('http 下 SQL 引擎起来了（file:// 下是起不来的）', engine.status === 'ready', JSON.stringify(engine));

    // ---- 1. 无额外筛选：应当全下推 ----
    await page.click('#viewswitch button[data-view="analysis"]');
    await page.waitForFunction(() => document.querySelectorAll('#dash .kpi').length > 0, null, { timeout: 60000 });
    await page.waitForTimeout(600);
    const sql1 = await snapshot(page);
    c.ok('分析走了 SQL 通道', /· SQL/.test(sql1.status), sql1.status.slice(0, 60));

    await page.evaluate(() => window.__cm.forceJs(true));
    await runAndWait(page);
    const js1 = await snapshot(page);
    c.ok('强制走 JS 通道生效（状态栏不再显示 SQL）', !/· SQL/.test(js1.status), js1.status.slice(0, 50));
    c.eq('两条通道的 KPI 逐项相等', JSON.stringify(js1.kpis), JSON.stringify(sql1.kpis));
    c.eq('两条通道的平台分布相等', js1.plat, sql1.plat);
    c.eq('两条通道的趋势相等', js1.time, sql1.time);

    // ---- 2. 加常驻点 + 只看半径内：半径推不下去，应当"先砍行再收尾" ----
    await page.evaluate(() => window.__cm.forceJs(false));
    await page.click('#viewswitch button[data-view="map"]');
    await page.click('.mapnav .mn[data-panel="base"]');
    await page.waitForTimeout(400);
    await page.click('#btn-base-add');
    await page.waitForTimeout(300);
    await page.fill('.base-addr', '广东省深圳市福田区华强北街道');
    await page.press('.base-addr', 'Enter');
    await page.waitForTimeout(2500);
    /* 注意：这里必须**同时有一个能下推的条件**（限定平台）。
       如果只有"只看半径内"一个条件，能下推的部分就是空的 —— 那时候绕一圈 SQL
       只是白跑一趟，退回纯 JS 反而是对的（代码里也是这么判的）。 */
    await page.evaluate(() => {
      window.__cm.params.onlyWithin = true;
      const cb = document.getElementById('p-within');
      if (cb) { cb.checked = true; }
      window.__cm.state.platAll = false;
      window.__cm.state.platSet = new Set(['京东']);
    });
    await page.click('#viewswitch button[data-view="analysis"]');
    await runAndWait(page);
    const sql2 = await snapshot(page);
    c.ok('半径筛选下仍然用上了 SQL（先砍行再收尾）', /· SQL→JS/.test(sql2.status), sql2.status.slice(0, 70));

    await page.evaluate(() => window.__cm.forceJs(true));
    await runAndWait(page);
    const js2 = await snapshot(page);
    c.eq('「只看半径内」两条通道 KPI 相等', JSON.stringify(js2.kpis), JSON.stringify(sql2.kpis));
    c.eq('「只看半径内」两条通道平台分布相等', js2.plat, sql2.plat);

    // ---- 3. 搜索词：表格里没有"编号/电话"列，所以也推不下去 ----
    await page.evaluate(() => {
      window.__cm.forceJs(false);
      window.__cm.state.q = '福田';
      document.getElementById('q').value = '福田';
      window.__cm.params.onlyWithin = false;
      const cb = document.getElementById('p-within');
      if (cb) { cb.checked = false; }
    });
    await runAndWait(page);
    const sql3 = await snapshot(page);
    c.ok('搜索词下仍然用上了 SQL', /· SQL→JS/.test(sql3.status), sql3.status.slice(0, 70));

    await page.evaluate(() => window.__cm.forceJs(true));
    await runAndWait(page);
    const js3 = await snapshot(page);
    c.eq('搜索词下两条通道 KPI 相等', JSON.stringify(js3.kpis), JSON.stringify(sql3.kpis));

    c.results.push({ name: '没有页面报错', pass: page.__errors.length === 0, detail: page.__errors.join(' | ') });
    await page.close();
  } finally {
    await srv.close();
  }
  return c.results;
}
