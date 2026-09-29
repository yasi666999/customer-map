import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', e => errs.push(String(e.message).slice(0, 150)));
const t0 = Date.now();
await page.goto('file:///D:/codex1/customer-map/打开地图.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#btn-import', { state: 'visible' });
const interactive = Date.now() - t0;
const deckAtBoot = await page.evaluate(() => !!window.deck);
await page.waitForFunction(() => !!window.deck, null, { timeout: 20000 });
const deckMs = Date.now() - t0;
await page.click('#btn-import');
await page.setInputFiles('#imp-file', 'D:/codex1/customer-map/汇总_按区县_三维.csv');
await page.waitForFunction(() => { const l=document.getElementById('loading'), s=document.getElementById('st-total');
  return l && l.hidden && s && parseInt((s.textContent||'0').replace(/,/g,''),10) > 1000; }, null, { timeout: 600000 });
await page.waitForTimeout(5000);
// 3D 六边形
await page.selectOption('#p-mode', 'hex');
await page.waitForTimeout(2500);
await page.check('#p-extrude');
await page.waitForTimeout(3500);
await page.screenshot({ path: 'D:/codex1/customer-map/界面_deckgl_3D六边形.png' });
const final = await page.evaluate(() => {
  const ids = (window.__cmDeck.props.layers || []).map(l => l.id);
  const hex = window.__cmDeck.props.layers.filter(l => l.id === 'hex')[0];
  const vp = window.__cmDeck.getViewports()[0];
  return { 引擎: window.__cm.params.engine, 百度加载: !!window.__cmMap, 图层: ids,
    六边形3D: hex && hex.props.extruded, 倾角: vp && Math.round(vp.pitch), 点数: window.__cmLayer.items };
});
console.log(JSON.stringify({ 可交互ms: interactive, '打开时deck已就绪': deckAtBoot, deck加载完成ms: deckMs, ...final, errs }, null, 1));
await browser.close();
