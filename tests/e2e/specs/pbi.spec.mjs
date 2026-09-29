import { openApp, importCsv, checker } from '../lib.mjs';

export const name = 'Power BI 风格 / 筛选芯片 · 我的视图 · 钻取';

export default async function run(browser) {
  const c = checker();
  const page = await openApp(browser);
  await importCsv(page);

  // --- 筛选芯片：先用时间轴造一个时间条件 ---
  const r = await page.evaluate(() => { const b = document.getElementById('ta-track').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  await page.mouse.move(r.x + r.w * 0.2, r.y + r.h / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.w * 0.5, r.y + r.h / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const chips = await page.evaluate(() => ({
    n: document.querySelectorAll('#chips .chip').length,
    hasClear: !!document.getElementById('chip-clear'),
    text: [...document.querySelectorAll('#chips .chip')].map(e => e.textContent.trim())
  }));
  c.ok('筛选变成一个可移除的芯片', chips.n === 1 && /时间/.test(chips.text[0]), JSON.stringify(chips));
  c.ok('有"全部清除"', chips.hasClear);

  // 点 ✕ 去掉时间条件
  await page.click('#chips .chip button');
  await page.waitForTimeout(1000);
  const cleared = await page.evaluate(() => ({ n: document.querySelectorAll('#chips .chip').length, hidden: document.getElementById('chips').hidden }));
  c.ok('点 ✕ 能单独去掉条件', cleared.n === 0 && cleared.hidden, JSON.stringify(cleared));

  // --- 我的视图（书签） ---
  await page.click('#btn-views');
  await page.waitForTimeout(300);
  await page.fill('#view-name', '用例视图');
  await page.click('#view-save');
  await page.waitForTimeout(400);
  const saved = await page.evaluate(() => ({
    count: document.getElementById('view-count').textContent,
    names: [...document.querySelectorAll('#viewlist .vname')].map(e => e.textContent)
  }));
  c.eq('保存了一个视图', saved.count, '1');
  c.ok('视图名称正确', saved.names[0] === '用例视图', JSON.stringify(saved.names));

  // 列表是 React 岛渲染的（不是 innerHTML 拼的），条件用标签展示
  const island = await page.evaluate(() => {
    const box = document.getElementById('viewlist');
    return {
      dbg: window.__cmViewsDbg || null,
      items: box.querySelectorAll('.vitem').length,
      tags: box.querySelectorAll('.vmeta i').length,
      del: box.querySelectorAll('.vdel[data-view-del]').length
    };
  });
  c.ok('我的视图由 React 岛渲染', island.dbg && island.dbg.count === 1 && island.items === 1, JSON.stringify(island));
  c.ok('条件以标签形式展示', island.tags > 0, JSON.stringify(island));
  c.ok('每条视图都有删除按钮', island.del === 1, JSON.stringify(island));

  // 存第二个 → 两个条目；点删除（事件委托）→ 回到一个
  await page.fill('#view-name', '临时视图');
  await page.click('#view-save');
  await page.waitForTimeout(400);
  const two = await page.evaluate(() => document.querySelectorAll('#viewlist .vitem').length);
  c.eq('可以保存多个视图', two, 2);
  await page.click('#viewlist .vdel');
  await page.waitForTimeout(500);
  const afterDel = await page.evaluate(() => ({
    n: document.querySelectorAll('#viewlist .vitem').length,
    count: document.getElementById('view-count').textContent,
    names: [...document.querySelectorAll('#viewlist .vname')].map(e => e.textContent)
  }));
  c.ok('点删除能去掉这一条', afterDel.n === 1 && afterDel.count === '1' && afterDel.names[0] === '用例视图', JSON.stringify(afterDel));  await page.click('#dlg-views button[type="submit"]');
  await page.waitForTimeout(300);

  // 改筛选（回到全部）再恢复
  await page.click('#viewswitch button[data-view="map"]');
  await page.waitForTimeout(300);
  await page.click('.mapnav .mn[data-panel="display"]');
  await page.selectOption('#p-mode', 'grid');
  await page.waitForTimeout(700);
  await page.click('#btn-views');
  await page.waitForTimeout(300);
  await page.click('#viewlist .vitem');
  await page.waitForTimeout(2000);
  const restored = await page.evaluate(() => ({ mode: window.__cm.params.mode, open: document.getElementById('dlg-views').open }));
  c.ok('恢复视图会还原地图画法', restored.mode !== 'grid', JSON.stringify(restored));
  c.ok('恢复后自动关闭对话框', restored.open === false);

  // --- 钻取 ---
  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForFunction(() => document.querySelectorAll('#dash .kpi').length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const lv0 = await page.evaluate(() => document.querySelector('.drill-lv').textContent);
  c.ok('初始在省级', /省/.test(lv0), lv0);

  await page.check('#drill-mode');
  await page.waitForTimeout(200);
  const clickTop = () => page.evaluate(() => {
    const d = window.__cm.charts().data.geo[0];
    if (d && window.__cmPicks && window.__cmPicks.geo) { window.__cmPicks.geo(d.click); return d.click; }
    return null;
  });
  await clickTop();
  await page.waitForTimeout(800);
  const lv1 = await page.evaluate(() => ({
    crumbs: document.getElementById('drill-crumbs').textContent.trim(),
    level: document.querySelector('.drill-lv').textContent,
    n: (window.__cm.charts().data.geo || []).length   // geo 现在是 ECharts canvas，改查数据条数
  }));
  c.ok('钻到市级', /市/.test(lv1.level) && lv1.n > 0, JSON.stringify(lv1));
  c.ok('面包屑显示路径', lv1.crumbs.indexOf('›') > 0, lv1.crumbs);

  await clickTop();
  await page.waitForTimeout(800);
  const lv2 = await page.evaluate(() => ({ level: document.querySelector('.drill-lv').textContent, crumbs: document.getElementById('drill-crumbs').textContent.trim() }));
  c.ok('再钻到区县', /区县/.test(lv2.level), JSON.stringify(lv2));

  await page.click('.drill-crumb[data-drill="-1"]');
  await page.waitForTimeout(700);
  const back = await page.evaluate(() => document.getElementById('drill-crumbs').textContent.trim());
  c.ok('面包屑可回到全国', back === '全国', back);

  c.results.push({ name: '没有页面报错', pass: page.__errors.length === 0, detail: page.__errors.join(' | ') });
  await page.close();
  return c.results;
}
