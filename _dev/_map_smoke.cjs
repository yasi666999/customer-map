const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
const PAGE = 'file:///D:/codex1/customer-map/index.html';
const CSV = 'D:/codex1/customer-map/汇总_按区县_三维.csv';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1560, height: 950 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/baidu/.test(m.text()) && !/ERR_FAILED/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  await page.goto(PAGE); await page.waitForTimeout(1200);
  await page.click('#btn-import'); await page.setInputFiles('#imp-file', CSV);
  await page.waitForFunction(() => { const l = document.getElementById('loading'), s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 1000; }, null, { timeout: 600000 });
  await page.waitForTimeout(2200);
  const st = await page.evaluate(() => {
    const cv = document.getElementById('ptlayer');
    const r = cv.getBoundingClientRect();
    return { hidden: cv.hidden, w: cv.width, h: cv.height, cssW: Math.round(r.width), cssH: Math.round(r.height),
      stats: window.__cmLayer || null, overlays: window.__cmMap.getOverlays ? window.__cmMap.getOverlays().length : -1,
      legend: document.getElementById('maplegend').hidden ? 'hidden' : document.getElementById('ml-title').textContent,
      legendRows: document.getElementById('ml-body').textContent.trim().slice(0, 70), zoom: window.__cmMap.getZoom() };
  });
  console.log(JSON.stringify({ st, errs }, null, 1));
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_点图层.png' });
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
