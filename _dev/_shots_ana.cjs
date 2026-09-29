const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
const CSV = 'D:/codex1/customer-map/汇总_按区县_三维.csv';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1560, height: 960 } });
  await page.goto('file:///D:/codex1/customer-map/index.html'); await page.waitForTimeout(1000);
  await page.click('#btn-import'); await page.setInputFiles('#imp-file', CSV);
  await page.waitForFunction(() => { const l = document.getElementById('loading'), s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 1000; }, null, { timeout: 600000 });
  await page.waitForTimeout(1500);
  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForFunction(() => document.querySelectorAll('#dash .kpi').length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_分析_查询条.png' });
  console.log('ana shot ok');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
