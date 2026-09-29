const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
const PAGE = 'file:///D:/codex1/customer-map/index.html';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(PAGE); await page.waitForTimeout(2500);
  await page.evaluate(() => {
    window.__ev = {};
    const names = ['moving', 'movestart', 'moveend', 'dragging', 'dragstart', 'dragend', 'mousemove', 'mouseup', 'zoomstart', 'zoomend'];
    names.forEach(n => { try { window.__cmMap.addEventListener(n, function () { window.__ev[n] = (window.__ev[n] || 0) + 1; }); } catch (e) {} });
  });
  const r = await page.evaluate(() => { const b = document.getElementById('map').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(r.x + r.w / 2 + i * 12, r.y + r.h / 2 + i * 6); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.waitForTimeout(800);
  const ev = await page.evaluate(() => window.__ev);
  // 再看 panTo 会不会触发 moving
  await page.evaluate(() => { window.__ev = {}; const m = window.__cmMap; m.panTo(new window.BMapGL.Point(m.getCenter().lng + 1, m.getCenter().lat)); });
  await page.waitForTimeout(1200);
  const ev2 = await page.evaluate(() => window.__ev);
  console.log(JSON.stringify({ drag: ev, panTo: ev2 }, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
