const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
const PAGE = 'file:///D:/codex1/customer-map/index.html';
const CSV = 'D:/codex1/customer-map/汇总_按区县_三维.csv';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1560, height: 980 } });
  await page.goto(PAGE); await page.waitForTimeout(900);
  await page.click('#btn-import'); await page.setInputFiles('#imp-file', CSV);
  await page.waitForFunction(() => { const l = document.getElementById('loading'), s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 1000; }, null, { timeout: 600000 });
  await page.click('#viewswitch button[data-view="analysis"]'); await page.waitForTimeout(900);
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_分析_图表切换.png' });
  await page.click('#dash .chart-switch[data-cs="time"] button[data-ct="area"]');
  await page.click('#dash .chart-switch[data-cs="plat"] button[data-ct="donut"]');
  await page.click('#dash .chart-switch[data-cs="geo"] button[data-ct="hbar"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_分析_面积环形.png' });
  // 窄屏
  await page.setViewportSize({ width: 900, height: 980 }); await page.waitForTimeout(600);
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_分析_窄屏.png' });
  console.log('shots done');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
