const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
const PAGE = 'file:///D:/codex1/customer-map/index.html';
const CSV = 'D:/codex1/customer-map/汇总_按区县_三维.csv';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1560, height: 950 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/baidu|ERR_FAILED/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  await page.goto(PAGE); await page.waitForTimeout(1200);
  await page.click('#btn-import'); await page.setInputFiles('#imp-file', CSV);
  await page.waitForFunction(() => { const l = document.getElementById('loading'), s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 1000; }, null, { timeout: 600000 });
  await page.waitForTimeout(2000);
  const R = {};

  // 热力图
  await page.selectOption('#p-mode', 'heat');
  await page.waitForTimeout(2200);
  R.heat = await page.evaluate(() => ({
    heat: window.__cmHeat, ptHidden: document.getElementById('ptlayer').hidden,
    heatHidden: document.getElementById('heatmap').hidden,
    legend: document.getElementById('ml-title').textContent,
    legendBody: document.getElementById('ml-body').textContent.trim().slice(0, 40)
  }));
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_热力图.png' });

  // 热力参数可调
  await page.evaluate(() => { const s = document.getElementById('p-heatr'); s.value = '60'; s.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(1200);
  R.heatTuned = await page.evaluate(() => ({ radius: window.__cm.params.heatRadius, heat: window.__cmHeat }));

  // 回到点模式
  await page.selectOption('#p-mode', 'point');
  await page.waitForTimeout(1000);
  R.backToPoint = await page.evaluate(() => ({ layer: window.__cmLayer, heatHidden: document.getElementById('heatmap').hidden, ptHidden: document.getElementById('ptlayer').hidden }));

  // 图层开关
  await page.click('.mapnav .mn[data-panel="layers"]');
  await page.waitForTimeout(300);
  R.layersPanel = await page.evaluate(() => ({ title: document.getElementById('panel-title').textContent,
    visible: !document.getElementById('layersbody').hidden, count: document.querySelectorAll('#layersbody .layer').length }));
  await page.uncheck('#L-points');
  await page.waitForTimeout(600);
  R.pointsOff = await page.evaluate(() => ({ ptHidden: document.getElementById('ptlayer').hidden, legend: document.getElementById('ml-title').textContent }));
  await page.check('#L-points');
  await page.uncheck('#L-legend');
  await page.waitForTimeout(500);
  R.legendOff = await page.evaluate(() => document.getElementById('maplegend').hidden);
  await page.check('#L-legend');
  await page.waitForTimeout(500);

  // 格子大小在图层面板里；透明度在显示样式面板里
  R.alpha = await page.evaluate(() => window.__cm.params.alpha);
  await page.evaluate(() => { const s = document.getElementById('p-gridsize'); s.value = '80'; s.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(400);
  R.gridSizeSlider = await page.evaluate(() => window.__cm.params.gridSize);
  // 切回显示样式面板换画法
  await page.click('.mapnav .mn[data-panel="display"]');
  await page.waitForTimeout(300);
  await page.selectOption('#p-mode', 'grid');
  await page.waitForTimeout(900);
  R.grid80 = await page.evaluate(() => ({ size: window.__cm.params.gridSize, layer: window.__cmLayer, legend: document.getElementById('ml-title').textContent }));
  await page.selectOption('#p-mode', 'point');
  await page.waitForTimeout(600);

  // 常驻地址 + 辐射圈
  await page.click('.mapnav .mn[data-panel="base"]');
  await page.waitForTimeout(300);
  await page.click('#btn-base-add');
  await page.waitForTimeout(300);
  R.baseInputs = (await page.$('#baselist input[type="text"]')).length;
  await page.fill('#baselist .base-addr', '广东省深圳市罗湖区笋岗街道');
  await page.focus('#baselist .base-addr');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  R.base = await page.evaluate(() => ({ list: document.getElementById('baselist').textContent.trim().slice(0, 60),
    stat: document.getElementById('basestat').textContent.trim().slice(0, 60), legend: document.getElementById('ml-body').textContent.trim().slice(0, 40) }));
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_辐射圈.png' });

  // 时间轴联动
  await page.click('.mapnav .mn[data-panel="layers"]');
  await page.waitForTimeout(200);
  const ta = await page.evaluate(() => { const t = document.getElementById('ta-track'); const r = t.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.click(ta.x + ta.w * 0.6, ta.y + ta.h / 2);
  await page.waitForTimeout(1400);
  R.timeline = await page.evaluate(() => ({ sum: document.getElementById('sf-sum').textContent.trim(),
    layer: window.__cmLayer, legend: document.getElementById('ml-body').textContent.trim().slice(0, 40) }));

  // 看全图 + 保存地图
  await page.click('#btn-fit'); await page.waitForTimeout(1800);
  R.fit = await page.evaluate(() => ({ zoom: window.__cm.map().getZoom(), layer: window.__cmLayer }));

  // 分析页回归
  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForTimeout(900);
  R.analysis = await page.evaluate(() => ({ cards: document.querySelectorAll('#dash .ct-body').length,
    switches: document.querySelectorAll('#dash .chart-switch').length,
    kpis: [...document.querySelectorAll('#dash .kpi')].map(e => e.textContent.trim()) }));
  await page.click('#dash .chart-switch[data-cs="plat"] button[data-ct="donut"]');
  await page.waitForTimeout(400);
  R.analysisChart = await page.evaluate(() => ({ paths: document.querySelectorAll('#dash .ct-body[data-cg="plat"] path').length,
    legend: !!document.querySelector('#dash .ct-body[data-cg="plat"] .ct-legend') }));

  // 数据页
  await page.click('#viewswitch button[data-view="data"]');
  await page.waitForTimeout(600);
  R.data = await page.evaluate(() => ({ count: document.getElementById('list-count').textContent }));
  await page.click('#viewswitch button[data-view="map"]');
  await page.waitForTimeout(600);

  R.errs = errs;
  console.log(JSON.stringify(R, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
