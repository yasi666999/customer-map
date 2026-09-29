const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
const PAGE = 'file:///D:/codex1/customer-map/index.html';
const CSV = 'D:/codex1/customer-map/汇总_按区县_三维.csv';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1560, height: 950 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/baidu|ERR_FAILED/.test(m.text())) errs.push(m.text()); });
  await page.goto(PAGE); await page.waitForTimeout(1000);
  await page.click('#btn-import'); await page.setInputFiles('#imp-file', CSV);
  await page.waitForFunction(() => { const l = document.getElementById('loading'), s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 1000; }, null, { timeout: 600000 });
  await page.waitForTimeout(2000);
  const R = {};
  const rect = await page.evaluate(() => { const r = document.getElementById('ta-track').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });

  R.initial = await page.evaluate(() => ({ range: document.getElementById('ta-range').textContent,
    winHidden: document.getElementById('ta-win').hidden, resetHidden: document.getElementById('ta-reset').hidden,
    keys: window.__cm.state.taKeys.length, canvas: document.getElementById('ta-canvas').width + 'x' + document.getElementById('ta-canvas').height }));

  // 1) 拖出一段范围（在中间空白处按下往右拖）
  await page.mouse.move(rect.x + rect.w * 0.15, rect.y + rect.h / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.w * 0.45, rect.y + rect.h / 2, { steps: 12 });
  const during = await page.evaluate(() => ({ label: document.getElementById('ta-range').textContent,
    win: document.getElementById('ta-win').style.width }));
  await page.mouse.up();
  await page.waitForTimeout(1200);
  R.dragNew = { during: during, after: await page.evaluate(() => ({ label: document.getElementById('ta-range').textContent,
    sum: document.getElementById('sf-sum').textContent.trim(), winHidden: document.getElementById('ta-win').hidden,
    from: document.getElementById('f-from').value, to: document.getElementById('f-to').value })) };

  // 2) 拖右手柄扩大范围
  const w2 = await page.evaluate(() => { const r = document.getElementById('ta-win').getBoundingClientRect(); return { x: r.x, right: r.right, y: r.y + r.height / 2 }; });
  await page.mouse.move(w2.right - 5, w2.y);
  await page.mouse.down();
  await page.mouse.move(w2.right + rect.w * 0.2, w2.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
  R.dragHandle = await page.evaluate(() => ({ label: document.getElementById('ta-range').textContent,
    sum: document.getElementById('sf-sum').textContent.trim(), from: document.getElementById('f-from').value, to: document.getElementById('f-to').value }));

  // 3) 按住中间整体平移
  const w3 = await page.evaluate(() => { const r = document.getElementById('ta-win').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const before3 = await page.evaluate(() => document.getElementById('f-from').value);
  await page.mouse.move(w3.x, w3.y);
  await page.mouse.down();
  await page.mouse.move(w3.x - rect.w * 0.15, w3.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
  R.pan = await page.evaluate(() => ({ label: document.getElementById('ta-range').textContent,
    from: document.getElementById('f-from').value, to: document.getElementById('f-to').value }));
  R.panMoved = before3 !== R.pan.from;

  // 4) 悬停气泡
  await page.mouse.move(rect.x + rect.w * 0.6, rect.y + rect.h / 2);
  await page.waitForTimeout(300);
  R.bubble = await page.evaluate(() => ({ hidden: document.getElementById('ta-bub').hidden, text: document.getElementById('ta-bub').textContent }));

  // 5) 双击重置
  await page.mouse.dblclick(rect.x + rect.w * 0.6, rect.y + rect.h / 2);
  await page.waitForTimeout(1200);
  R.reset = await page.evaluate(() => ({ label: document.getElementById('ta-range').textContent,
    sum: document.getElementById('sf-sum').textContent.trim(), winHidden: document.getElementById('ta-win').hidden,
    from: document.getElementById('f-from').value }));

  // 6) 单点一根柱子（不拖）
  await page.mouse.click(rect.x + rect.w * 0.8, rect.y + rect.h / 2);
  await page.waitForTimeout(1200);
  R.singleClick = await page.evaluate(() => ({ label: document.getElementById('ta-range').textContent,
    sum: document.getElementById('sf-sum').textContent.trim() }));
  await page.click('#ta-reset');
  await page.waitForTimeout(1000);

  R.errs = errs;
  console.log(JSON.stringify(R, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
