const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/baidu|ERR_FAILED/.test(m.text())) errs.push(m.text()); });
  await page.goto('file:///D:/codex1/customer-map/index.html');
  await page.waitForTimeout(1500);
  await page.selectOption('#p-mode', 'region');
  await page.waitForTimeout(1200);
  const out = {};
  out.emptyRegion = await page.evaluate(() => ({ canvas: document.getElementById('ptlayer').hidden,
    legend: document.getElementById('maplegend').hidden, title: document.getElementById('ml-title').textContent,
    layer: window.__cmLayer }));
  await page.selectOption('#p-regionlevel', 'city');
  await page.waitForTimeout(1500);
  out.emptyCity = await page.evaluate(() => ({ canvas: document.getElementById('ptlayer').hidden, layer: window.__cmLayer }));
  await page.selectOption('#p-mode', 'point');
  await page.waitForTimeout(800);
  out.back = await page.evaluate(() => ({ canvas: document.getElementById('ptlayer').hidden }));
  out.errs = errs;
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
