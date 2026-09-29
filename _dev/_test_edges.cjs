const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
const PAGE = 'file:///D:/codex1/customer-map/index.html';
const SMALL = 'D:/codex1/customer-map/_dev/_test_small.csv';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1560, height: 950 } });
  const errs = [], failed = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  page.on('requestfailed', r => failed.push(r.url().slice(0, 90) + ' :: ' + (r.failure() || {}).errorText));
  await page.goto(PAGE);
  await page.waitForTimeout(1000);

  // A. 空状态
  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForTimeout(300);
  const emptyState = (await page.textContent('#dash')).trim();

  // B. 导入没有时间/平台列的小数据
  await page.click('#viewswitch button[data-view="map"]');
  await page.click('#btn-import');
  await page.setInputFiles('#imp-file', SMALL);
  await page.waitForFunction(() => {
    const l = document.getElementById('loading'); const s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 0;
  }, null, { timeout: 120000 });
  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForTimeout(500);
  const beforeParse = await page.evaluate(() => ({
    kpis: [...document.querySelectorAll('#dash .kpi')].map(e => e.textContent.trim()),
    bodies: [...document.querySelectorAll('#dash .ct-body')].map(b => (b.textContent || '').trim().slice(0, 60)),
    switches: document.querySelectorAll('#dash .chart-switch').length
  }));

  // C. 解析后地理图应有数据
  await page.click('#viewswitch button[data-view="map"]');
  await page.click('#btn-run');
  await page.waitForFunction(() => {
    const l = document.getElementById('loading'); const s = document.getElementById('st-total'); const ok = document.getElementById('st-ok');
    return l && l.hidden && ok && parseInt((ok.textContent || '0').replace(/,/g, ''), 10) > 0;
  }, null, { timeout: 180000 });
  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForTimeout(600);
  const afterParse = await page.evaluate(() => {
    const cm = window.__cm;
    return { kpis: [...document.querySelectorAll('#dash .kpi')].map(e => e.textContent.trim()),
      geoItems: (cm.charts().data.geo || []).slice(0, 3).map(d => d.label + '=' + d.v),
      geoClick: document.querySelector('#dash .ct-body[data-cg="geo"]').innerHTML.slice(0, 40),
      timeEmpty: (document.querySelector('#dash .ct-body[data-cg="time"]') || {}).textContent,
      platEmpty: (document.querySelector('#dash .ct-body[data-cg="plat"]') || {}).textContent };
  });

  // D. 切到数据视图 + 暗色模式下的分析图
  await page.click('#viewswitch button[data-view="data"]');
  await page.waitForTimeout(400);
  const dataView = await page.evaluate(() => ({
    items: document.querySelectorAll('#list .item, #list > *').length,
    count: (document.getElementById('list-count') || {}).textContent
  }));
  await page.close();
  const darkPage = await browser.newPage({ viewport: { width: 1560, height: 950 }, colorScheme: 'dark' });
  darkPage.on('pageerror', e => errs.push('DARK PAGEERROR ' + e.message));
  await darkPage.goto(PAGE);
  await darkPage.waitForTimeout(900);
  await darkPage.click('#btn-import');
  await darkPage.setInputFiles('#imp-file', SMALL);
  await darkPage.waitForFunction(() => {
    const l = document.getElementById('loading'); const s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 0;
  }, null, { timeout: 120000 });
  const darkPage2 = darkPage;
  await darkPage2.click('#viewswitch button[data-view="analysis"]');
  await darkPage2.waitForTimeout(600);
  await darkPage2.screenshot({ path: 'D:/codex1/customer-map/界面_分析_暗色.png' });
  const dark = await darkPage2.evaluate(() => {
    const s = document.querySelector('#dash .ct-body svg text');
    const card = document.querySelector('#dash .card2');
    return { textFill: s ? getComputedStyle(s).fill : '', svgColor: getComputedStyle(document.querySelector('#dash .ct-body svg')).color,
      cardBg: getComputedStyle(card).backgroundColor, switchOn: getComputedStyle(document.querySelector('#dash .chart-switch button.on')).backgroundColor };
  });
  await darkPage2.close();

  console.log(JSON.stringify({ emptyState, beforeParse, afterParse, dataView, dark, errs, failed }, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
