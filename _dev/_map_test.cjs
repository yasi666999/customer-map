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
  await page.waitForTimeout(2200);
  const R = {};

  // ---- 0) canvas 真的画上东西了吗（采样像素） ----
  R.painted = await page.evaluate(() => {
    const cv = document.getElementById('ptlayer');
    const g = cv.getContext('2d');
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let on = 0, cols = new Set();
    for (let i = 0; i < d.length; i += 4 * 37) {
      if (d[i + 3] > 8) { on++; cols.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]); }
    }
    return { sampled: Math.floor(d.length / (4 * 37)), painted: on, colors: cols.size };
  });

  // ---- 1) 悬停拾取 ----
  const pt = await page.evaluate(() => {
    const ps = window.__cm.picks();
    if (!ps.length) return null;
    const p = ps.slice().sort((a, b) => b.count - a.count)[0];
    return { x: p.x, y: p.y, count: p.count, kind: p.kind };
  });
  if (pt) {
    const rect = await page.evaluate(() => { const r = document.getElementById('map').getBoundingClientRect(); return { x: r.x, y: r.y }; });
    await page.mouse.move(rect.x + pt.x, rect.y + pt.y);
    await page.waitForTimeout(350);
    R.hover = await page.evaluate(() => {
      const tip = document.getElementById('maptip');
      const ring = document.getElementById('pickring');
      return { visible: !tip.hidden, text: tip.textContent.trim().slice(0, 60), ring: ring ? !ring.hidden : null };
    });
    // 移开
    await page.mouse.move(rect.x + 4, rect.y + 4);
    await page.waitForTimeout(250);
    R.hoverAway = await page.evaluate(() => document.getElementById('maptip').hidden);
  }

  // ---- 2) 网格聚合模式 ----
  await page.selectOption('#p-mode', 'grid');
  await page.waitForTimeout(900);
  R.grid = await page.evaluate(() => ({
    stats: window.__cmLayer, legend: document.getElementById('ml-title').textContent,
    legendText: document.getElementById('ml-body').textContent.trim().slice(0, 60),
    cells: window.__cm.picks().length, mode: window.__cm.params.mode
  }));
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_网格聚合.png' });

  // ---- 3) 网格悬停 + 点格子放大 ----
  const cell = await page.evaluate(() => { const c = window.__cm.picks(); return c.length ? { x: c[0].x, y: c[0].y, n: c[0].count } : null; });
  if (cell) {
    const rect = await page.evaluate(() => { const r = document.getElementById('map').getBoundingClientRect(); return { x: r.x, y: r.y }; });
    await page.mouse.move(rect.x + cell.x, rect.y + cell.y);
    await page.waitForTimeout(300);
    R.cellHover = await page.evaluate(() => ({ text: document.getElementById('maptip').textContent.trim().slice(0, 60), visible: !document.getElementById('maptip').hidden }));
    const z0 = await page.evaluate(() => window.__cm.map().getZoom());
    await page.mouse.click(rect.x + cell.x, rect.y + cell.y);
    await page.waitForTimeout(1400);
    const z1 = await page.evaluate(() => window.__cm.map().getZoom());
    R.cellClick = { z0: z0, z1: z1, zoomed: z1 > z0 };
  }

  // ---- 4) 点模式点选客户 ----
  await page.selectOption('#p-mode', 'point');
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__cm.map().setZoom(6));
  await page.waitForTimeout(1200);
  const pt2 = await page.evaluate(() => { const ps = window.__cm.picks(); if (!ps.length) return null;
    const p = ps.slice().sort((a, b) => b.count - a.count)[0]; return { x: p.x, y: p.y, i: p.item.i }; });
  if (pt2) {
    const rect = await page.evaluate(() => { const r = document.getElementById('map').getBoundingClientRect(); return { x: r.x, y: r.y }; });
    await page.mouse.click(rect.x + pt2.x, rect.y + pt2.y);
    await page.waitForTimeout(1500);
    R.pointClick = await page.evaluate(() => ({ active: window.__cm.state.activeIdx, zoom: window.__cm.map().getZoom() }));
  }

  // ---- 5) 工具条 ----
  await page.click('#btn-zoomout'); await page.waitForTimeout(200);
  const zA = await page.evaluate(() => window.__cm.map().getZoom());
  await page.click('#btn-zoomin'); await page.waitForTimeout(200);
  const zB = await page.evaluate(() => window.__cm.map().getZoom());
  await page.click('#btn-fit'); await page.waitForTimeout(900);
  const zC = await page.evaluate(() => window.__cm.map().getZoom());
  R.tools = { afterZoomOut: zA, afterZoomIn: zB, afterFit: zC };

  // ---- 6) 底图切换 ----
  const bm = [];
  for (let i = 0; i < 3; i++) {
    await page.click('#btn-basemap'); await page.waitForTimeout(400);
    bm.push(await page.evaluate(() => ({ b: window.__cm.params.basemap, nobase: document.getElementById('view-map').className.indexOf('nobase') >= 0,
      baseCanvasOpacity: getComputedStyle(document.querySelector('#map canvas')).opacity })));
  }
  R.basemap = bm;

  // ---- 7) 框选 ----
  await page.evaluate(() => { const m = window.__cm.map(); m.centerAndZoom(new window.BMapGL.Point(113.6, 34.8), 6); });
  await page.waitForTimeout(1600);
  const dense = await page.evaluate(() => { const ps = window.__cm.picks(); if (!ps.length) return null;
    const p = ps.slice().sort((a, b) => b.count - a.count)[0]; return { x: p.x, y: p.y }; });
  await page.click('#btn-box'); await page.waitForTimeout(200);
  const r2 = await page.evaluate(() => { const r = document.getElementById('map').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const cx = r2.x + (dense ? dense.x : r2.w * 0.5), cy = r2.y + (dense ? dense.y : r2.h * 0.5);
  await page.mouse.move(cx - 150, cy - 110);
  await page.mouse.down();
  await page.mouse.move(cx + 150, cy + 110, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  R.box = await page.evaluate(() => ({ bar: !document.getElementById('boxbar').hidden, text: document.getElementById('box-text').textContent,
    debug: window.__cm.box() }));
  R.boxDense = dense;
  if (!R.box.bar) { console.log('BOX FAILED', JSON.stringify(R.box)); }
  await page.click('#box-only', { timeout: 5000 }).catch(e => { R.boxClickErr = String(e).slice(0, 80); });
  await page.waitForTimeout(900);
  R.boxOnly = await page.evaluate(() => ({ summary: document.getElementById('sf-sum').textContent.trim(),
    total: document.getElementById('st-total').textContent, stats: window.__cmLayer }));
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_地图_框选.png' });
  await page.click('#box-clear'); await page.waitForTimeout(700);
  R.boxClear = await page.evaluate(() => ({ summary: document.getElementById('sf-sum').textContent.trim(), total: document.getElementById('st-total').textContent }));

  // ---- 8) 平移时画布跟随 ----
  await page.click('#btn-fit'); await page.waitForTimeout(700);
  R.pan = await (async () => {
    const rr = await page.evaluate(() => { const b = document.getElementById('map').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
    const before = await page.evaluate(() => document.getElementById('ptlayer').style.transform);
    await page.mouse.move(rr.x + rr.w * 0.6, rr.y + rr.h * 0.55);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(rr.x + rr.w * 0.6 - i * 14, rr.y + rr.h * 0.55 + i * 5); await page.waitForTimeout(25); }
    const during = await page.evaluate(() => document.getElementById('ptlayer').style.transform);
    await page.mouse.up();
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => document.getElementById('ptlayer').style.transform);
    return { before: before, during: during, after: after };
  })();

  // ---- 9) 导出图片 ----
  R.shot = await page.evaluate(() => {
    return window.__cm.shot();
  });
  R.legend = await page.evaluate(() => ({ title: document.getElementById('ml-title').textContent, body: document.getElementById('ml-body').textContent.trim().slice(0, 60) }));
  R.errs = errs;
  console.log(JSON.stringify(R, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
