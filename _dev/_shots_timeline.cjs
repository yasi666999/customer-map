const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
const CSV = 'D:/codex1/customer-map/汇总_按区县_三维.csv';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1560, height: 950 } });
  await page.goto('file:///D:/codex1/customer-map/index.html'); await page.waitForTimeout(1000);
  await page.click('#btn-import'); await page.setInputFiles('#imp-file', CSV);
  await page.waitForFunction(() => { const l = document.getElementById('loading'), s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 1000; }, null, { timeout: 600000 });
  await page.waitForTimeout(2000);
  await page.click('#panel-close').catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_时间轴.png' });
  // 拖一段范围
  const r = await page.evaluate(() => { const b = document.getElementById('ta-track').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  await page.mouse.move(r.x + r.w * 0.25, r.y + r.h / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.w * 0.55, r.y + r.h / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1400);
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_时间轴选中.png' });
  console.log('ok');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
