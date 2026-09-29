const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
const CSV = 'D:/codex1/customer-map/汇总_按区县_三维.csv';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1560, height: 960 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/baidu|ERR_FAILED/.test(m.text())) errs.push(m.text()); });
  await page.goto('file:///D:/codex1/customer-map/index.html'); await page.waitForTimeout(1000);
  await page.click('#btn-import'); await page.setInputFiles('#imp-file', CSV);
  await page.waitForFunction(() => { const l = document.getElementById('loading'), s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 1000; }, null, { timeout: 600000 });
  await page.waitForTimeout(1500);
  const R = {};

  // ---- 筛选芯片 ----
  await page.selectOption('#p-mode', 'region');
  await page.waitForTimeout(1200);
  await page.selectOption('#p-regionlevel', 'province');
  await page.waitForTimeout(1200);
  // 用时间轴选一段
  const tr = await page.evaluate(() => { const b = document.getElementById('ta-track').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  await page.mouse.move(tr.x + tr.w * 0.2, tr.y + tr.h / 2);
  await page.mouse.down();
  await page.mouse.move(tr.x + tr.w * 0.5, tr.y + tr.h / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(1400);
  // 点一个区域并只看它
  const pt = await page.evaluate(() => { const l = window.__cm.regions().slice().sort((a,b)=>b.v-a.v)[0];
    const P = window.__cm.regionProj(); return l ? { x: P.x(l.cen[0]), y: P.y(l.cen[1]), name: l.name } : null; });
  const mr = await page.evaluate(() => { const b = document.getElementById('map').getBoundingClientRect(); return { x: b.x, y: b.y }; });
  await page.mouse.click(mr.x + pt.x, mr.y + pt.y);
  await page.waitForTimeout(1200);
  await page.click('#region-only');
  await page.waitForTimeout(1600);
  R.chips = await page.evaluate(() => ({
    count: document.querySelectorAll('#chips .chip').length,
    texts: [...document.querySelectorAll('#chips .chip')].map(e => e.textContent.trim()),
    hasClear: !!document.getElementById('chip-clear'), hidden: document.getElementById('chips').hidden,
    sum: document.getElementById('sf-sum').textContent.trim()
  }));
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_筛选芯片.png' });

  // 单独去掉"区域"这个条件
  await page.click('#chips .chip[data-chip="region"] button');
  await page.waitForTimeout(1400);
  R.chipRemoveRegion = await page.evaluate(() => ({ count: document.querySelectorAll('#chips .chip').length,
    texts: [...document.querySelectorAll('#chips .chip')].map(e => e.textContent.trim()),
    sum: document.getElementById('sf-sum').textContent.trim() }));

  // ---- 书签：保存 + 改动 + 恢复 ----
  await page.click('#btn-views');
  await page.waitForTimeout(400);
  await page.fill('#view-name', '测试视图A');
  await page.click('#view-save');
  await page.waitForTimeout(500);
  R.viewSaved = await page.evaluate(() => ({ count: document.getElementById('view-count').textContent,
    items: [...document.querySelectorAll('#viewlist .vitem .vname')].map(e => e.textContent),
    meta: (document.querySelector('#viewlist .vitem .vmeta') || {}).textContent }));
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_我的视图.png' });
  await page.click('#dlg-views button[type="submit"]');   // 关闭
  await page.waitForTimeout(400);

  // 改掉筛选（清空所有芯片）
  await page.click('#chip-clear');
  await page.waitForTimeout(1600);
  R.afterClear = await page.evaluate(() => ({ chips: document.querySelectorAll('#chips .chip').length,
    sum: document.getElementById('sf-sum').textContent.trim() }));

  // 恢复视图
  await page.click('#btn-views');
  await page.waitForTimeout(400);
  await page.click('#viewlist .vitem');
  await page.waitForTimeout(2000);
  R.restored = await page.evaluate(() => ({ chips: [...document.querySelectorAll('#chips .chip')].map(e => e.textContent.trim()),
    sum: document.getElementById('sf-sum').textContent.trim(),
    mode: window.__cm.params.mode, dlgsOpen: document.getElementById('dlg-views').open }));

  // ---- 钻取 ----
  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForFunction(() => document.querySelectorAll('#dash .kpi').length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(600);
  R.drill0 = await page.evaluate(() => ({ crumbs: document.getElementById('drill-crumbs').textContent.trim(),
    level: document.querySelector('.drill-lv').textContent, items: [...document.querySelectorAll('#dash .ct-body[data-cg="geo"] [data-k]')].slice(0,3).map(e => e.getAttribute('data-k')) }));
  await page.check('#drill-mode');
  await page.waitForTimeout(300);
  // 点第一名钻进去
  const first = await page.evaluate(() => { const g = document.querySelector('#dash .ct-body[data-cg="geo"] [data-k]'); return g ? g.getAttribute('data-k') : null; });
  await page.click('#dash .ct-body[data-cg="geo"] [data-k]');
  await page.waitForTimeout(900);
  R.drill1 = await page.evaluate(() => ({ crumbs: document.getElementById('drill-crumbs').textContent.trim(),
    level: document.querySelector('.drill-lv').textContent,
    items: [...document.querySelectorAll('#dash .ct-body[data-cg="geo"] [data-k]')].slice(0,3).map(e => e.getAttribute('data-k') + ':' + e.textContent.trim().slice(0,14)) }));
  // 再钻一级
  await page.click('#dash .ct-body[data-cg="geo"] [data-k]');
  await page.waitForTimeout(900);
  R.drill2 = await page.evaluate(() => ({ crumbs: document.getElementById('drill-crumbs').textContent.trim(),
    level: document.querySelector('.drill-lv').textContent,
    items: [...document.querySelectorAll('#dash .ct-body[data-cg="geo"] [data-k]')].slice(0,3).map(e => e.textContent.trim().slice(0,14)) }));
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_分析_钻取.png' });
  // 面包屑回到全国
  await page.click('.drill-crumb[data-drill="-1"]');
  await page.waitForTimeout(900);
  R.drillBack = await page.evaluate(() => ({ crumbs: document.getElementById('drill-crumbs').textContent.trim(),
    level: document.querySelector('.drill-lv').textContent }));

  // 直辖市的市级着色（之前是灰的）
  await page.click('#viewswitch button[data-view="map"]');
  await page.waitForTimeout(600);
  await page.selectOption('#p-mode', 'region');
  await page.selectOption('#p-regionlevel', 'city');
  await page.waitForTimeout(2000);
  R.municipality = await page.evaluate(() => {
    const agg = window.__cm.regionAgg();
    const bj = [];
    agg.city.forEach((v, k) => { if (k.indexOf('11') === 0) bj.push([k, v]); });
    return { cityKeysUnder11: bj.length, sample: bj.slice(0, 3), beijingTotal: bj.reduce((a, b) => a + b[1], 0) };
  });

  R.errs = errs;
  console.log(JSON.stringify(R, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
