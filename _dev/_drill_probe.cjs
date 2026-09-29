const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
const CSV = 'D:/codex1/customer-map/汇总_按区县_三维.csv';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1560, height: 960 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await page.goto('file:///D:/codex1/customer-map/index.html'); await page.waitForTimeout(1000);
  await page.click('#btn-import'); await page.setInputFiles('#imp-file', CSV);
  await page.waitForFunction(() => { const l = document.getElementById('loading'), s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 1000; }, null, { timeout: 600000 });
  await page.waitForTimeout(1200);
  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForFunction(() => document.querySelectorAll('#dash .kpi').length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const out = await page.evaluate(() => {
    const cd = window.__cm.charts().data;
    const agg = window.__cm.regionAgg();
    const g = document.querySelector('#dash .ct-body[data-cg="geo"]');
    return {
      geoLen: cd.geo.length,
      geoSample: cd.geo.slice(0, 3),
      leafSize: agg.leaf ? agg.leaf.size : 'no-leaf',
      aggKeys: Object.keys(agg),
      geoHtml: g ? g.innerHTML.slice(0, 160) : 'no-geo-body',
      dataK: document.querySelectorAll('#dash .ct-body[data-cg="geo"] [data-k]').length,
      drillBar: !!document.querySelector('.drill-bar'),
      crumbs: (document.getElementById('drill-crumbs') || {}).textContent
    };
  });
  console.log(JSON.stringify(out, null, 1));
  console.log('errs', JSON.stringify(errs));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
