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
  await page.waitForTimeout(2000);

  // 关闭右侧参数面板，拍一张干净的点图层
  await page.click('#panel-close').catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图.png' });

  // 悬停卡片
  const p = await page.evaluate(() => { const ps = window.__cm.picks(); const q = ps.slice().sort((a,b)=>b.count-a.count)[0];
    return q ? { x: q.x, y: q.y } : null; });
  if (p) {
    const r = await page.evaluate(() => { const b = document.getElementById('map').getBoundingClientRect(); return { x: b.x, y: b.y }; });
    await page.mouse.move(r.x + p.x, r.y + p.y);
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_悬停提示.png' });
    await page.mouse.move(r.x + 6, r.y + 6);
  }

  // 网格聚合
  await page.click('.mapnav .mn[data-panel="display"]');
  await page.selectOption('#p-mode', 'grid');
  await page.waitForTimeout(900);
  await page.click('#panel-close');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_网格聚合.png' });

  // 热力图
  await page.click('.mapnav .mn[data-panel="display"]');
  await page.selectOption('#p-mode', 'heat');
  await page.waitForTimeout(2000);
  await page.click('#panel-close');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_热力图.png' });

  // 图层面板
  await page.click('.mapnav .mn[data-panel="layers"]');
  await page.selectOption('#p-mode', 'point').catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_图层面板.png' });

  // 卫星底图
  await page.selectOption('#p-basemap', 'satellite');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_卫星底图.png' });
  console.log('shots ok');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
