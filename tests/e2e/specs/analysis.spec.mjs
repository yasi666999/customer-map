import { openApp, importCsv, checker } from '../lib.mjs';

export const name = '分析 / 查询与计算状态';

export default async function run(browser) {
  const c = checker();
  const page = await openApp(browser);
  await importCsv(page);

  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForFunction(() => document.querySelectorAll('#dash .kpi').length > 0, null, { timeout: 60000 });
  const done = await page.evaluate(() => ({
    status: document.getElementById('ana-status').textContent,
    kpis: [...document.querySelectorAll('#dash .kpi')].map(e => e.textContent.trim()),
    run: document.getElementById('ana-run').textContent
  }));
  c.ok('出结果并显示用时', /^用时/.test(done.status), done.status);
  c.eq('查询按钮恢复可用', done.run, '查询');
  /* 不写死业务数字：只要"记录数"是个正整数即可（KPI 卡片文本形如 "1,234记录数"） */
  c.ok('KPI 有记录数', parseInt(done.kpis[0].replace(/[^\d]/g, ''), 10) > 0 && /记录数/.test(done.kpis[0]), done.kpis[0]);

  // 缓存：切走再回来应当命中缓存
  await page.click('#viewswitch button[data-view="map"]');
  await page.waitForTimeout(300);
  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForFunction(() => document.querySelectorAll('#dash .kpi').length > 0, null, { timeout: 20000 });
  const cached = await page.evaluate(() => document.getElementById('ana-status').textContent);
  c.ok('同样的筛选命中缓存', /已是最新/.test(cached), cached);

  // 关掉自动查询 → 改筛选 → 提示待刷新
  await page.click('#ana-auto');
  await page.waitForTimeout(200);
  const off = await page.evaluate(() => document.getElementById('ana-status').textContent);
  c.ok('可关闭自动查询', /已关闭自动查询/.test(off), off);

  await page.click('#viewswitch button[data-view="map"]');
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => { const b = document.getElementById('ta-track').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  await page.mouse.move(r.x + r.w * 0.3, r.y + r.h / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.w * 0.6, r.y + r.h / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(1200);

  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForTimeout(800);
  const stale = await page.evaluate(() => ({ status: document.getElementById('ana-status').textContent, cls: document.getElementById('ana-status').className }));
  c.ok('提示筛选已改变', /筛选已改变/.test(stale.status), stale.status);
  c.ok('提示用警示色', /warn/.test(stale.cls), stale.cls);

  // 手动查询
  await page.click('#ana-run');
  await page.waitForFunction(() => /^用时/.test(document.getElementById('ana-status').textContent), null, { timeout: 60000 });
  const manual = await page.evaluate(() => ({
    status: document.getElementById('ana-status').textContent,
    kpis: [...document.querySelectorAll('#dash .kpi')].map(e => e.textContent.trim())
  }));
  c.ok('手动查询后结果变化', manual.kpis[0] !== done.kpis[0], done.kpis[0] + ' → ' + manual.kpis[0]);
  c.ok('状态栏显示用时与条数', /record|条记录/.test(manual.status) || /条记录/.test(manual.status), manual.status);

  c.results.push({ name: '没有页面报错', pass: page.__errors.length === 0, detail: page.__errors.join(' | ') });
  await page.close();
  return c.results;
}
