const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
const CSV = 'D:/codex1/customer-map/汇总_按区县_三维.csv';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1560, height: 960 } });
  await page.goto('file:///D:/codex1/customer-map/打开地图.html'); await page.waitForTimeout(1200);
  await page.click('#btn-import'); await page.setInputFiles('#imp-file', CSV);
  await page.waitForFunction(() => { const l = document.getElementById('loading'), s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 1000; }, null, { timeout: 600000 });
  await page.waitForTimeout(1600);

  // 造两个筛选条件，拍筛选芯片
  const r = await page.evaluate(() => { const b = document.getElementById('ta-track').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  await page.mouse.move(r.x + r.w * 0.25, r.y + r.h / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.w * 0.6, r.y + r.h / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1400);
  // 再加一个平台筛选
  await page.evaluate(() => {
    const cb = document.querySelector('#f-plats input[type=checkbox]');
    if (cb) { cb.click(); }
  });
  await page.waitForTimeout(1200);
  await page.click('#panel-close').catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_筛选芯片.png' });

  // 我的视图
  await page.click('#btn-views');
  await page.waitForTimeout(400);
  await page.fill('#view-name', '本月广东省重点客户');
  await page.click('#view-save');
  await page.fill('#view-name', '只看深圳');
  await page.click('#view-save');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_我的视图.png' });
  await page.click('#dlg-views button[type="submit"]');
  await page.waitForTimeout(300);

  // 钻取
  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForFunction(() => document.querySelectorAll('#dash .kpi').length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(600);
  await page.check('#drill-mode');
  await page.waitForTimeout(300);
  await page.click('#dash .ct-body[data-cg="geo"] [data-k]');
  await page.waitForTimeout(900);
  await page.click('#dash .ct-body[data-cg="geo"] [data-k]');
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_分析_钻取.png' });
  console.log('shots ok');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
