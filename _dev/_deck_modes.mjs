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
await page.waitForTimeout(6000);
const out = [];
for (const m of ['point', 'cluster', 'grid', 'hex', 'heat', 'region']) {
  await page.selectOption('#p-mode', m);
  await page.waitForTimeout(m === 'region' ? 6000 : 3000);
  const shot = await page.locator('#deckmap canvas').first().screenshot();
  const st = await page.evaluate(() => ({ 图层: window.__cmLayer, 图例: document.getElementById('ml-title').textContent,
    warn: document.getElementById('mapwarn').hidden ? '' : document.getElementById('mapwarn').textContent }));
  out.push({ 画法: m, items: st.图层.items, deck: st.图层.deck, 图例: st.图例,
    画面KB: Math.round(shot.length/1024), 指纹: crypto.createHash('sha1').update(shot).digest('hex').slice(0,8), warn: st.warn });
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_deckgl_' + m + '.png' });
}
console.log(JSON.stringify({ out, errs }, null, 1));
await browser.close();
