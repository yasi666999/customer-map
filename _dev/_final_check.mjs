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
await page.click('#btn-import');
await page.setInputFiles('#imp-file', 'D:/codex1/customer-map/汇总_按区县_三维.csv');
await page.waitForFunction(() => { const l=document.getElementById('loading'), s=document.getElementById('st-total');
  return l && l.hidden && s && parseInt((s.textContent||'0').replace(/,/g,''),10) > 1000; }, null, { timeout: 600000 });
await page.waitForTimeout(5000);
// 加常驻地址 → 3D 六边形 → 截图
await page.click('.mapnav .mn[data-panel="base"]');
await page.waitForTimeout(300);
await page.click('#btn-base-add');
await page.waitForTimeout(300);
await page.fill('.base-addr', '广东省深圳市福田区华强北街道');
await page.press('.base-addr', 'Enter');
await page.waitForTimeout(3500);
await page.click('.mapnav .mn[data-panel="display"]');
await page.waitForTimeout(300);
await page.selectOption('#p-mode', 'hex');
await page.waitForTimeout(2500);
await page.check('#p-extrude');
await page.waitForTimeout(4000);
await page.screenshot({ path: 'D:/codex1/customer-map/界面_deckgl_全景.png' });
const fin = await page.evaluate(() => ({
  引擎: 'deck', 百度对象: !!window.__cmMap, 百度脚本: !!window.BMapGL,
  图层: (window.__cmDeck.props.layers || []).map(l => l.id),
  六边形3D: (window.__cmDeck.props.layers || []).filter(l => l.id === 'hex')[0].props.extruded,
  点数: window.__cmLayer.items
}));
console.log(JSON.stringify({ 可交互ms: interactive, 打开时deck已加载: deckAtBoot, ...fin, errs }, null, 1));
await browser.close();
