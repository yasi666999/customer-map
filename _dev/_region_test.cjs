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
  await page.waitForTimeout(1800);
  const R = {};

  // 1) 切到分层着色（省）
  await page.selectOption('#p-mode', 'region');
  await page.waitForTimeout(1600);
  R.province = await page.evaluate(() => ({
    layer: window.__cmLayer, agg: window.__cmRegionAgg,
    legendTitle: document.getElementById('ml-title').textContent,
    legend: document.getElementById('ml-body').textContent.trim().slice(0, 90),
    picks: window.__cm ? window.__cmRegions ? window.__cm.regions().length : 'n/a' : 'n/a'
  }));
  // canvas 真的画了？
  R.painted = await page.evaluate(() => {
    const cv = document.getElementById('ptlayer');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let on = 0, cols = new Set();
    for (let i = 0; i < d.length; i += 4 * 41) { if (d[i + 3] > 8) { on++; cols.add(d[i] + ',' + d[i+1] + ',' + d[i+2]); } }
    return { painted: on, colors: cols.size };
  });
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_分层着色省.png' });

  // 2) 悬停某个省
  const hover = await page.evaluate(() => {
    const list = window.__cm.regions();
    const top = list.slice().sort((a, b) => b.v - a.v)[0];
    const P = window.__cm.regionProj();
    return top ? { x: Math.round((P.x ? 0 : 0)), code: top.code, name: top.name, v: top.v } : null;
  });
  // 用区域外框中心换算到屏幕像素
  const pt = await page.evaluate(() => {
    const list = window.__cm.regions();
    const top = list.slice().sort((a, b) => b.v - a.v)[0];
    const P = window.__cm.regionProj();
    const c = top.cen;
    return { x: P.x(c[0]), y: P.y(c[1]), name: top.name, v: top.v, code: top.code };
  });
  const rect = await page.evaluate(() => { const r = document.getElementById('map').getBoundingClientRect(); return { x: r.x, y: r.y }; });
  await page.mouse.move(rect.x + pt.x, rect.y + pt.y);
  await page.waitForTimeout(500);
  R.hover = await page.evaluate(() => ({ visible: !document.getElementById('maptip').hidden,
    text: document.getElementById('maptip').textContent.trim().slice(0, 70), key: document.getElementById('maptip').getAttribute('data-k') }));
  R.hoverTarget = { name: pt.name, v: pt.v };
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_分层着色悬停.png' });

  // 3) 点击 → 放大 + 出操作条
  const z0 = await page.evaluate(() => window.__cm.map().getZoom());
  R.pickProbe = await page.evaluate(() => {
    const list = window.__cm.regions();
    const top = list.slice().sort((a, b) => b.v - a.v)[0];
    return { n: list.length, top: top ? { code: top.code, name: top.name, v: top.v, cen: top.cen } : null,
      hit: top ? window.__cm.pickRegionAt(top.cen[0], top.cen[1]) : null };
  });
  await page.mouse.click(rect.x + pt.x, rect.y + pt.y);
  await page.waitForTimeout(1500);
  R.clickDebug = await page.evaluate(() => ({ pending: window.__cm.state.pendingRegion ? window.__cm.state.pendingRegion.name : null,
    bar: !document.getElementById('regionbar').hidden, mode: window.__cm.params.mode, regionNames: window.__cm.regions().length }));
  R.click = await page.evaluate(() => ({ zoom: window.__cm.map().getZoom(),
    bar: !document.getElementById('regionbar').hidden, text: document.getElementById('region-text').textContent }));

  // 4) 只看这个区域
  if (!R.click.bar) { console.log('BAR MISSING', JSON.stringify({ hover: R.hover, click: R.click, probe: R.pickProbe, dbg: R.clickDebug }, null, 1)); }
  await page.click('#region-only', { timeout: 8000 }).catch(e => { R.onlyErr = String(e).slice(0, 50); });
  await page.waitForTimeout(1800);
  R.onlyRegion = await page.evaluate(() => ({ summary: document.getElementById('sf-sum').textContent.trim(),
    total: document.getElementById('st-total').textContent, agg: window.__cmRegionAgg, layer: window.__cmLayer }));
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_分层着色只看一省.png' });
  await page.click('#region-clear');
  await page.waitForTimeout(1500);
  R.cleared = await page.evaluate(() => ({ summary: document.getElementById('sf-sum').textContent.trim(), total: document.getElementById('st-total').textContent }));

  // 5) 切市
  const t1 = Date.now();
  await page.selectOption('#p-regionlevel', 'city');
  await page.waitForFunction(() => window.__cmLayer && window.__cmLayer.region === 'city', null, { timeout: 120000 });
  await page.waitForTimeout(1200);
  R.city = await page.evaluate(() => ({ layer: window.__cmLayer, agg: window.__cmRegionAgg, legend: document.getElementById('ml-title').textContent,
    legendBody: document.getElementById('ml-body').textContent.trim().slice(0, 80) }));
  R.city.loadMs = Date.now() - t1;
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_分层着色市.png' });

  // 6) 切区县
  const t2 = Date.now();
  await page.selectOption('#p-regionlevel', 'district');
  await page.waitForFunction(() => window.__cmLayer && window.__cmLayer.region === 'district', null, { timeout: 180000 });
  await page.waitForTimeout(1400);
  R.district = await page.evaluate(() => ({ layer: window.__cmLayer, agg: window.__cmRegionAgg,
    legendBody: document.getElementById('ml-body').textContent.trim().slice(0, 80), title: document.getElementById('ml-title').textContent }));
  R.district.loadMs = Date.now() - t2;
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_分层着色区县.png' });

  // 7) 切回点模式，确认没被区域模式搞坏
  await page.selectOption('#p-mode', 'point');
  await page.waitForTimeout(1500);
  R.backToPoint = await page.evaluate(() => ({ layer: window.__cmLayer, regionNames: window.__cm.regions().length,
    heatHidden: document.getElementById('heatmap').hidden, ptHidden: document.getElementById('ptlayer').hidden }));
  await page.selectOption('#p-mode', 'grid');
  await page.waitForTimeout(1200);
  R.backToGrid = await page.evaluate(() => window.__cmLayer);
  await page.selectOption('#p-mode', 'region');
  await page.waitForTimeout(1500);
  R.backToRegion = await page.evaluate(() => ({ layer: window.__cmLayer, title: document.getElementById('ml-title').textContent }));
  R.errs = errs;
  console.log(JSON.stringify(R, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
