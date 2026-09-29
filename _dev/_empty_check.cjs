const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/baidu|ERR_FAILED/.test(m.text())) errs.push(m.text()); });
  await page.goto('file:///D:/codex1/customer-map/index.html');
  await page.waitForTimeout(1500);
  const out = {};
  out.empty = await page.evaluate(() => ({ legend: document.getElementById('maplegend').hidden,
    canvas: document.getElementById('ptlayer').hidden, tools: document.querySelectorAll('.maptools .toolbtn').length }));
  // 空数据下点各种按钮不应报错
  for (const id of ['#btn-zoomin', '#btn-zoomout', '#btn-fit', '#btn-box', '#btn-basemap']) { await page.click(id).catch(() => {}); await page.waitForTimeout(150); }
  await page.click('#btn-box'); // 退出框选
  await page.selectOption('#p-mode', 'grid');
  await page.waitForTimeout(500);
  await page.click('.mapnav .mn[data-panel="layers"]');
  await page.waitForTimeout(300);
  out.layersOnEmpty = await page.evaluate(() => ({ title: document.getElementById('panel-title').textContent,
    visible: !document.getElementById('layersbody').hidden }));
  // 各面板都能开
  const panels = [];
  for (const k of ['display', 'radius', 'base', 'layers']) {
    await page.click('.mapnav .mn[data-panel="' + k + '"]');
    await page.waitForTimeout(150);
    panels.push(await page.evaluate(s => ({ sec: s, title: document.getElementById('panel-title').textContent,
      body: !document.getElementById(s === 'display' ? 'parambody' : s === 'radius' ? 'basebody' : s === 'base' ? 'basebox' : 'layersbody').hidden }), k));
  }
  out.panels = panels;
  out.errs = errs;
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
