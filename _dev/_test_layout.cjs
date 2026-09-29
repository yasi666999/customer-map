const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
const PAGE = 'file:///D:/codex1/customer-map/index.html';
const CSV = 'D:/codex1/customer-map/汇总_按区县_三维.csv';

async function audit(page, label) {
  const out = { label };
  for (const g of ['time', 'plat', 'geo']) {
    const types = await page.$$eval('#dash .chart-switch[data-cs="' + g + '"] button', bs => bs.map(b => b.getAttribute('data-ct')));
    for (const tp of types) {
      await page.click('#dash .chart-switch[data-cs="' + g + '"] button[data-ct="' + tp + '"]');
      await page.waitForTimeout(150);
      const r = await page.evaluate(({ g, tp }) => {
        const body = document.querySelector('#dash .ct-body[data-cg="' + g + '"]');
        const svg = body.querySelector('svg');
        const out = { overX: 0, overY: 0, svgW: 0, bodyW: Math.round(body.clientWidth) };
        if (svg) {
          const sb = svg.getBoundingClientRect(), bb = body.getBoundingClientRect();
          out.svgW = Math.round(sb.width);
          out.overX = Math.round(Math.max(0, sb.right - bb.right));
          out.overY = Math.round(Math.max(0, sb.bottom - bb.bottom));
        }
        return out;
      }, { g, tp });
      out[g + '/' + tp] = r;
    }
  }
  out.page = await page.evaluate(() => ({
    docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth,
    dashScrollH: document.getElementById('view-analysis').scrollHeight,
    dashClientH: document.getElementById('view-analysis').clientHeight,
    canScroll: document.getElementById('view-analysis').scrollHeight > document.getElementById('view-analysis').clientHeight
  }));
  return out;
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1560, height: 950 } });
  await page.goto(PAGE); await page.waitForTimeout(900);
  await page.click('#btn-import'); await page.setInputFiles('#imp-file', CSV);
  await page.waitForFunction(() => { const l = document.getElementById('loading'), s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 1000; }, null, { timeout: 600000 });
  await page.click('#viewswitch button[data-view="analysis"]'); await page.waitForTimeout(700);
  const wide = await audit(page, '1560px');

  await page.setViewportSize({ width: 1080, height: 900 }); await page.waitForTimeout(500);
  const mid = await audit(page, '1080px');

  await page.setViewportSize({ width: 900, height: 900 }); await page.waitForTimeout(500);
  const narrow = await audit(page, '900px');
  await page.screenshot({ path: 'D:/codex1/customer-map/界面_分析_窄屏.png' });

  console.log(JSON.stringify({ wide, mid, narrow }, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
