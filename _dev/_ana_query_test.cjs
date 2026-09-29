const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
const PAGE = 'file:///D:/codex1/customer-map/index.html';
const CSV = 'D:/codex1/customer-map/汇总_按区县_三维.csv';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1560, height: 950 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/baidu|ERR_FAILED/.test(m.text())) errs.push(m.text()); });
  await page.goto(PAGE); await page.waitForTimeout(1000);
  await page.click('#btn-import'); await page.setInputFiles('#imp-file', CSV);
  await page.waitForFunction(() => { const l = document.getElementById('loading'), s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 1000; }, null, { timeout: 600000 });
  await page.waitForTimeout(1500);
  const R = {};

  // 1) 第一次进分析页：应能看到"正在计算"
  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForTimeout(60);
  R.busy = await page.evaluate(() => ({ status: document.getElementById('ana-status').textContent,
    btn: document.getElementById('ana-run').textContent, disabled: document.getElementById('ana-run').disabled,
    loading: !!document.querySelector('#dash .ana-loading'), loadingText: (document.querySelector('#dash .ana-loading') || {}).textContent }));
  await page.waitForFunction(() => document.querySelectorAll('#dash .kpi').length > 0, null, { timeout: 60000 });
  R.done = await page.evaluate(() => ({ status: document.getElementById('ana-status').textContent,
    btn: document.getElementById('ana-run').textContent, kpis: [...document.querySelectorAll('#dash .kpi')].map(e => e.textContent.trim()) }));
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_分析_查询条.png' });

  // 2) 再切一次：应该秒出（用缓存）
  const t2 = Date.now();
  await page.click('#viewswitch button[data-view="map"]');
  await page.waitForTimeout(300);
  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForFunction(() => document.querySelectorAll('#dash .kpi').length > 0, null, { timeout: 20000 });
  R.cached = await page.evaluate(() => document.getElementById('ana-status').textContent);
  R.cachedMs = Date.now() - t2;

  // 3) 关掉自动查询，改筛选，再回分析页 → 应提示去点查询
  await page.click('#ana-auto');
  await page.waitForTimeout(200);
  R.autoOff = await page.evaluate(() => document.getElementById('ana-status').textContent);
  await page.click('#viewswitch button[data-view="map"]');
  await page.waitForTimeout(300);
  // 用时间轴改一下筛选
  const rect = await page.evaluate(() => { const r = document.getElementById('ta-track').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.move(rect.x + rect.w * 0.3, rect.y + rect.h / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.w * 0.6, rect.y + rect.h / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
  R.filtered = await page.evaluate(() => ({ sum: document.getElementById('sf-sum').textContent.trim() }));
  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForTimeout(900);
  R.stale = await page.evaluate(() => ({ status: document.getElementById('ana-status').textContent,
    warn: document.getElementById('ana-status').className,
    kpis: [...document.querySelectorAll('#dash .kpi')].map(e => e.textContent.trim()),
    sum: document.getElementById('sf-sum').textContent.trim() }));

  // 4) 手动点查询
  await page.click('#ana-run');
  await page.waitForTimeout(80);
  R.manualBusy = await page.evaluate(() => document.getElementById('ana-status').textContent);
  await page.waitForFunction(() => document.getElementById('ana-status').textContent.indexOf('用时') === 0, null, { timeout: 60000 });
  R.manualDone = await page.evaluate(() => ({ status: document.getElementById('ana-status').textContent,
    kpis: [...document.querySelectorAll('#dash .kpi')].map(e => e.textContent.trim()),
    charts: document.querySelectorAll('#dash .ct-body').length }));
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_分析_手动查询.png' });

  // 5) 打开自动查询，拖时间轴后回分析页应自动算
  await page.click('#ana-auto');
  await page.waitForTimeout(600);
  R.autoOn = await page.evaluate(() => document.getElementById('ana-status').textContent);

  R.errs = errs;
  console.log(JSON.stringify(R, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
