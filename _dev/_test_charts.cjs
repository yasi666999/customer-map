const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
const PAGE = 'file:///D:/codex1/customer-map/index.html';
const CSV = 'D:/codex1/customer-map/汇总_按区县_三维.csv';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1560, height: 950 } });
  const errs = [];
  const failed = [];
  page.on('requestfailed', r => failed.push(r.url().slice(0, 100) + ' :: ' + ((r.failure() || {}).errorText || '')));
  page.on('response', r => { if (r.status() >= 400) failed.push('HTTP ' + r.status() + ' ' + r.url().slice(0, 100)); });
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/baidu/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  await page.goto(PAGE);
  await page.waitForTimeout(1200);

  const t0 = Date.now();
  await page.click('#btn-import');
  await page.setInputFiles('#imp-file', CSV);
  await page.waitForFunction(() => {
    const l = document.getElementById('loading'); const s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 1000;
  }, null, { timeout: 600000 });
  const importMs = Date.now() - t0;
  const mapDiag = await page.evaluate(() => {
    const w = document.getElementById('mapwarn');
    return { warn: w && !w.hidden ? w.textContent.trim().slice(0, 120) : '', hasBaidu: typeof window.BMapGL !== 'undefined' };
  });

  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForTimeout(700);

  const html = await page.evaluate(() => {
    const g = document.querySelector('#dash .dash-grid');
    return { kpis: [...document.querySelectorAll('#dash .kpi')].map(e => e.textContent.trim()),
             bodies: document.querySelectorAll('#dash .ct-body').length,
             switches: [...document.querySelectorAll('#dash .chart-switch')].map(s => s.getAttribute('data-cs')),
             cols: getComputedStyle(g).gridTemplateColumns };
  });

  const results = [];
  for (const g of ['time', 'plat', 'geo']) {
    const types = await page.$$eval('#dash .chart-switch[data-cs="' + g + '"] button', bs => bs.map(b => b.getAttribute('data-ct')));
    for (const t of types) {
      await page.click('#dash .chart-switch[data-cs="' + g + '"] button[data-ct="' + t + '"]');
      await page.waitForTimeout(200);
      const info = await page.evaluate(({ g, t }) => {
        const body = document.querySelector('#dash .ct-body[data-cg="' + g + '"]');
        const on = document.querySelector('#dash .chart-switch[data-cs="' + g + '"] button.on');
        const svg = body.querySelector('svg');
        const pie = body.querySelector('.ct-pie');
        const leg = body.querySelector('.ct-legend');
        let sideBySide = null, geoInfo = '';
        if (pie && leg) {
          const a = pie.querySelector('svg').getBoundingClientRect(), b = leg.getBoundingClientRect();
          sideBySide = b.left > a.right - 4 && Math.abs(a.top - b.top) <= 40;
          geoInfo = JSON.stringify({
            pieW: Math.round(pie.getBoundingClientRect().width),
            svg: [Math.round(a.left), Math.round(a.top), Math.round(a.width), Math.round(a.height)],
            leg: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)],
            cq: CSS.supports('container-type: inline-size'),
            cols: getComputedStyle(pie).gridTemplateColumns
          });
        }
        return { active: on && on.getAttribute('data-ct'), svg: !!svg,
          rects: svg ? svg.querySelectorAll('rect').length : 0,
          paths: svg ? svg.querySelectorAll('path').length : 0,
          clickable: body.querySelectorAll('[data-k]').length,
          table: !!body.querySelector('table.ct-table'),
          rows: body.querySelectorAll('table.ct-table tbody tr').length,
          legend: !!leg, sideBySide, geoInfo,
          note: (body.querySelector('.ct-more') || {}).textContent || '',
          empty: !!body.querySelector('.an-empty') };
      }, { g, t });
      results.push(Object.assign({ g, t }, info));
    }
  }

  // ---- 联动 1：点时间柱子 → 时间筛选 ----
  await page.click('#dash .chart-switch[data-cs="time"] button[data-ct="bar"]');
  await page.waitForTimeout(200);
  await page.click('#dash .ct-body[data-cg="time"] rect[data-k]');
  await page.waitForTimeout(700);
  const timeFilter = { sum: (await page.textContent('#sf-sum')).trim(), rec: (await page.textContent('#dash .kpi b')).trim() };
  await page.click('#dash .ct-body[data-cg="time"] rect[data-k]');   // 再点一次取消
  await page.waitForTimeout(700);
  const afterCancel = (await page.textContent('#sf-sum')).trim();

  // ---- 联动 2：点平台条 → 平台筛选 ----
  await page.click('#dash .chart-switch[data-cs="plat"] button[data-ct="hbar"]');
  await page.waitForTimeout(200);
  await page.click('#dash .ct-body[data-cg="plat"] rect[data-k]');
  await page.waitForTimeout(700);
  const platFilter = (await page.textContent('#sf-sum')).trim();

  // 清掉平台筛选，回到全部
  await page.evaluate(() => {
    const b = document.querySelector('#sf-quick button[data-range="all"]');
    if (b) b.click();
  });
  await page.waitForTimeout(500);

  // ---- 联动 3：点地区条形 → 跳地图并选中 ----
  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForTimeout(400);
  await page.click('#dash .chart-switch[data-cs="geo"] button[data-ct="hbar"]');
  await page.waitForTimeout(250);
  await page.click('#dash .ct-body[data-cg="geo"] rect[data-k]');
  await page.waitForTimeout(1600);
  const mapJump = await page.evaluate(() => {
    const cm = window.__cm;
    const m = cm.map();
    const geo = (cm.charts().data.geo || [])[0] || {};
    const row = cm.state.rows[geo.click];
    const c = m ? m.getCenter() : null;
    return { view: document.querySelector('#view-map').hidden ? 'no' : 'yes',
      zoom: m ? m.getZoom() : null,
      center: c ? [ +c.lng.toFixed(5), +c.lat.toFixed(5) ] : null,
      rowCoord: row ? [ row.lng, row.lat ] : null,
      topGeo: geo.label || '',
      infoOpen: document.querySelectorAll('#view-map [class*="infowindow"], #view-map [class*="InfoWindow"]').length };
  });

  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_分析_图表切换.png' });
  await page.click('#dash .chart-switch[data-cs="geo"] button[data-ct="pie"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_分析_饼图.png' });

  console.log(JSON.stringify({ importMs, mapDiag, failed, html, timeFilter, afterCancel, platFilter, mapJump, results, errs }, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
