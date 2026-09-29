import { chromium } from 'playwright';
import crypto from 'node:crypto';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR ' + String(e.message).slice(0, 180)));
await page.goto('file:///D:/codex1/customer-map/打开地图.html');
await page.waitForTimeout(2500);
await page.click('#btn-import');
await page.setInputFiles('#imp-file', 'D:/codex1/customer-map/汇总_按区县_三维.csv');
await page.waitForFunction(() => { const l=document.getElementById('loading'), s=document.getElementById('st-total');
  return l && l.hidden && s && parseInt((s.textContent||'0').replace(/,/g,''),10) > 1000; }, null, { timeout: 600000 });
await page.waitForTimeout(5000);

// 加一个常驻地址
await page.click('.mapnav .mn[data-panel="base"]');
await page.waitForTimeout(400);
await page.click('#btn-base-add');
await page.waitForTimeout(300);
await page.fill('.base-addr', '广东省深圳市福田区华强北街道');
await page.press('.base-addr', 'Enter');
await page.waitForTimeout(4000);
const base = await page.evaluate(() => {
  const ids = ((window.__cmDeck && window.__cmDeck.props && window.__cmDeck.props.layers) || []).map(l => l.id);
  return { 图层: ids, 有常驻: ids.indexOf('bases') >= 0, 有辐射圈: ids.indexOf('base-rings') >= 0, 有名字: ids.indexOf('base-labels') >= 0,
    列表文本: (document.querySelector('.base-addr') || {}).value || '' };
});
await page.screenshot({ path: 'D:/codex1/customer-map/界面_deckgl_常驻地址.png' });

// 3D 挤出：六边形
await page.click('.mapnav .mn[data-panel="display"]');
await page.waitForTimeout(300);
await page.selectOption('#p-mode', 'hex');
await page.waitForTimeout(2500);
const hex2d = await page.locator('#deckmap canvas').first().screenshot();
await page.check('#p-extrude');
await page.waitForTimeout(3500);
const hex3d = await page.locator('#deckmap canvas').first().screenshot();
const hexInfo = await page.evaluate(() => {
  const ls = window.__cmDeck.props.layers.filter(l => l.id === 'hex');
  const vp = window.__cmDeck.getViewports()[0];
  return { extruded: ls[0] && ls[0].props.extruded, elevationScale: ls[0] && ls[0].props.elevationScale, pitch: vp && Math.round(vp.pitch) };
});
await page.screenshot({ path: 'D:/codex1/customer-map/界面_deckgl_3D六边形.png' });

// 3D 挤出：网格
await page.selectOption('#p-mode', 'grid');
await page.waitForTimeout(3500);
const gridInfo = await page.evaluate(() => {
  const ls = window.__cmDeck.props.layers.filter(l => l.id === 'grid');
  return { 图层类型: ls[0] && ls[0].constructor.name, extruded: ls[0] && ls[0].props.extruded };
});
await page.screenshot({ path: 'D:/codex1/customer-map/界面_deckgl_3D网格.png' });

console.log(JSON.stringify({ 常驻地址: base, 六边形3D: hexInfo, 网格3D: gridInfo,
  '2D画面KB': Math.round(hex2d.length/1024), '3D画面KB': Math.round(hex3d.length/1024),
  画面变了: crypto.createHash('sha1').update(hex2d).digest('hex').slice(0,8) !== crypto.createHash('sha1').update(hex3d).digest('hex').slice(0,8), errs }, null, 1));
await browser.close();
