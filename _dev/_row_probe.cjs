const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
const PAGE = 'file:///D:/codex1/customer-map/index.html';
const CSV = 'D:/codex1/customer-map/汇总_按区县_三维.csv';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(PAGE); await page.waitForTimeout(1000);
  await page.click('#btn-import'); await page.setInputFiles('#imp-file', CSV);
  await page.waitForFunction(() => { const l = document.getElementById('loading'), s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 1000; }, null, { timeout: 600000 });
  const out = await page.evaluate(() => {
    const rows = window.__cm.state.rows;
    const stat = { total: rows.length, withP: 0, withC: 0, withD: 0, noMatch: 0 };
    const samples = [];
    const byLevel = {};
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], m = r.match;
      if (!m) { stat.noMatch++; continue; }
      if (m.p) stat.withP++;
      if (m.c) stat.withC++;
      if (m.d) stat.withD++;
      const lv = m.d ? 'district' : (m.c ? 'city' : (m.p ? 'province' : 'none'));
      byLevel[lv] = (byLevel[lv] || 0) + 1;
      if (samples.length < 6) samples.push({ clean: r.clean, p: m.p, c: m.c, d: m.d, q: r.quality, count: r.count });
    }
    return { stat, byLevel, samples };
  });
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
