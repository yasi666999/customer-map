const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
const CSV = 'D:/codex1/customer-map/汇总_按区县_三维.csv';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1560, height: 950 } });
  await page.goto('file:///D:/codex1/customer-map/index.html'); await page.waitForTimeout(1000);
  await page.click('#btn-import'); await page.setInputFiles('#imp-file', CSV);
  await page.waitForFunction(() => { const l = document.getElementById('loading'), s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 1000; }, null, { timeout: 600000 });
  await page.waitForTimeout(1200);
  // 在页面里记录状态条的每一次变化，看用户实际会看到什么
  await page.evaluate(() => {
    window.__log = [];
    const el = document.getElementById('ana-status');
    const box = document.getElementById('dash');
    const t0 = performance.now();
    new MutationObserver(() => {
      window.__log.push({ t: Math.round(performance.now() - t0), status: el.textContent,
        loading: !!box.querySelector('.ana-loading'), btn: document.getElementById('ana-run').textContent });
    }).observe(el, { childList: true, characterData: true, subtree: true });
    new MutationObserver(() => {
      window.__log.push({ t: Math.round(performance.now() - t0), status: el.textContent,
        loading: !!box.querySelector('.ana-loading'), btn: document.getElementById('ana-run').textContent, paint: true });
    }).observe(box, { childList: true });
  });
  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForTimeout(2500);
  const log = await page.evaluate(() => window.__log.filter((e, i, arr) => i === 0 || e.status !== arr[i-1].status || e.loading !== arr[i-1].loading));
  console.log(JSON.stringify(log.slice(0, 12), null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
