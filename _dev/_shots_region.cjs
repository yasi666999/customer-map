const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
const PAGE = 'file:///D:/codex1/customer-map/index.html';
const CSV = 'D:/codex1/customer-map/汇总_按区县_三维.csv';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1560, height: 960 } });
  await page.goto(PAGE); await page.waitForTimeout(1000);
  await page.click('#btn-import'); await page.setInputFiles('#imp-file', CSV);
  await page.waitForFunction(() => { const l = document.getElementById('loading'), s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 1000; }, null, { timeout: 600000 });
  await page.waitForTimeout(1600);

  await page.selectOption('#p-mode', 'region');
  await page.waitForTimeout(1500);
  await page.click('#panel-close').catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_分层着色省.png' });

  // 悬停
  const pt = await page.evaluate(() => {
    const list = window.__cm.regions().slice().sort((a, b) => b.v - a.v)[0];
    const P = window.__cm.regionProj();
    return { x: P.x(list.cen[0]), y: P.y(list.cen[1]) };
  });
  const rect = await page.evaluate(() => { const r = document.getElementById('map').getBoundingClientRect(); return { x: r.x, y: r.y }; });
  await page.mouse.move(rect.x + pt.x, rect.y + pt.y);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_分层着色悬停.png' });

  // 点击某省 → 只看这个区域
  await page.mouse.click(rect.x + pt.x, rect.y + pt.y);
  await page.waitForTimeout(1400);
  await page.click('#region-only');
  await page.waitForTimeout(1600);
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_分层着色只看一省.png' });
  await page.click('#region-clear');
  await page.waitForTimeout(1500);

  // 市
  await page.click('.mapnav .mn[data-panel="display"]');
  await page.selectOption('#p-regionlevel', 'city');
  await page.waitForFunction(() => window.__cmLayer && window.__cmLayer.region === 'city', null, { timeout: 120000 });
  await page.waitForTimeout(1200);
  await page.click('#panel-close');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_分层着色市.png' });

  // 区县
  await page.click('.mapnav .mn[data-panel="display"]');
  await page.selectOption('#p-regionlevel', 'district');
  await page.waitForFunction(() => window.__cmLayer && window.__cmLayer.region === 'district', null, { timeout: 180000 });
  await page.waitForTimeout(1400);
  await page.click('#panel-close');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_分层着色区县.png' });

  // 区县 + 面板打开的样子
  await page.click('.mapnav .mn[data-panel="display"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_分层着色面板.png' });

  console.log('shots ok');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
