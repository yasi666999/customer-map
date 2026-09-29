const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
const PAGE = 'file:///D:/codex1/customer-map/index.html';
const CSV = 'D:/codex1/customer-map/汇总_按区县_三维.csv';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1560, height: 950 } });
  await page.goto(PAGE); await page.waitForTimeout(1200);
  await page.click('#btn-import'); await page.setInputFiles('#imp-file', CSV);
  await page.waitForFunction(() => { const l = document.getElementById('loading'), s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 1000; }, null, { timeout: 600000 });
  await page.waitForTimeout(1500);
  const base = await page.evaluate(() => {
    const m = window.__cmMap;
    return { zoom: m.getZoom(), center: [m.getCenter().lng, m.getCenter().lat],
      overlays: document.querySelectorAll('#map > div').length,
      markers: document.querySelectorAll('#map img').length,
      labels: document.querySelectorAll('#map div[style*="border-radius"]').length,
      heatCanvasHidden: document.getElementById('heatmap').hidden };
  });
  // 计时：手动触发一次重建
  const timing = await page.evaluate(async () => {
    window.__phases = [];
    const m = window.__cmMap;
    m.setZoom(11);
    await new Promise(r => setTimeout(r, 1200));
    const z11 = { overlays: document.querySelectorAll('#map > div').length, imgs: document.querySelectorAll('#map img').length };
    m.setZoom(14);
    await new Promise(r => setTimeout(r, 1200));
    const z14 = { overlays: document.querySelectorAll('#map > div').length, imgs: document.querySelectorAll('#map img').length };
    return { z11, z14, heat: window.__cmHeat || null };
  });
  // 平移一屏耗时
  const panMs = await page.evaluate(async () => {
    const m = window.__cmMap;
    const t0 = performance.now();
    m.panTo(new window.BMapGL.Point(m.getCenter().lng + 1.5, m.getCenter().lat));
    await new Promise(r => setTimeout(r, 900));
    return { ms: Math.round(performance.now() - t0), overlays: document.querySelectorAll('#map > div').length };
  });
  // 热力图耗时
  const heatMs = await page.evaluate(async () => {
    const sel = document.getElementById('p-mode'); sel.value = 'heat'; sel.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 1500));
    return window.__cmHeat || null;
  });
  console.log(JSON.stringify({ base, timing, panMs, heatMs }, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
