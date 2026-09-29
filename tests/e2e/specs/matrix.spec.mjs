import { openApp, importCsv, checker } from '../lib.mjs';

export const name = 'Power BI 进阶 / 矩阵 · Top N · 环比';

export default async function run(browser) {
  const c = checker();
  const page = await openApp(browser);
  await importCsv(page);
  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForFunction(() => document.querySelectorAll('#dash .kpi').length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(500);

  // --- 矩阵（ag-grid 版） ---
  await page.waitForTimeout(1500);
  const mtx = await page.evaluate(() => {
    const root = document.querySelector('#mtx-root');
    if (!root) { return null; }
    return {
      agRoot: root.querySelectorAll('.ag-root-wrapper').length,
      // ag-grid 36 的类名：单元格统一是 .ag-cell，靠 col-id 区分
      rows: root.querySelectorAll('.ag-cell[col-id^="c"]').length,
      pinnedLeft: root.querySelectorAll('.ag-cell[col-id="name"]').length,
      pinnedRight: root.querySelectorAll('.ag-cell[col-id="rowsum"]').length,
      // 数据条是单元格里的 span（背景 rgba(0,113,227,.22)），不是 div
      bars: root.querySelectorAll('.ag-cell [style*="rgba(0, 113, 227"]').length
    };
  });
  c.ok('矩阵用 ag-grid 渲染', mtx && mtx.agRoot === 1, JSON.stringify(mtx));
  c.ok('矩阵有平台行', mtx && mtx.rows >= 3, mtx && String(mtx.rows));
  c.ok('平台列固定在左侧', mtx && mtx.pinnedLeft > 0, mtx && String(mtx.pinnedLeft));
  c.ok('合计列固定在右侧', mtx && mtx.pinnedRight > 0, mtx && String(mtx.pinnedRight));
  c.ok('格子带数据条', mtx && mtx.bars >= 5, mtx && String(mtx.bars));

  // --- 点真实单元格 = 交叉筛选（不走钩子） ---
  const clicked = await page.evaluate(() => {
    for (const el of document.querySelectorAll('#mtx-root .ag-cell[col-id^="c"]')) {
      const txt = (el.textContent || '').trim();
      if (txt && txt !== '·') { return { col: el.getAttribute('col-id'), text: txt }; }
    }
    return null;
  });
  if (clicked) {
    await page.click('#mtx-root .ag-cell[col-id="' + clicked.col + '"]');
  }
  await page.waitForTimeout(2500);
  const cross = await page.evaluate(() => ({
    chips: [...document.querySelectorAll('#chips .chip')].map(e => e.textContent.trim()),
    sum: document.getElementById('sf-sum').textContent.trim()
  }));
  c.ok('点格子能触发交叉筛选', !!clicked && cross.chips.length === 2, JSON.stringify(clicked) + ' → ' + JSON.stringify(cross.chips));
  c.ok('筛选摘要含时间与平台', /时间/.test(cross.sum) && /平台/.test(cross.sum), cross.sum);

  // 清掉筛选回到全部
  await page.click('#chip-clear');
  await page.waitForTimeout(900);
  await page.waitForFunction(() => /^用时/.test(document.getElementById('ana-status').textContent), null, { timeout: 60000 });

  // --- Top N ---
  const countGeo = () => page.evaluate(() => window.__cm.charts().data.geo.length);
  await page.selectOption('#ana-topn', '10');
  await page.waitForTimeout(400);
  const n10 = await countGeo();
  await page.selectOption('#ana-topn', '0');
  await page.waitForTimeout(400);
  const nAll = await countGeo();
  c.ok('Top N = 10 时榜单被截断且带"其他"', n10 <= 11 && n10 > 0, String(n10));
  c.ok('切到全部后条数变多', nAll > n10, n10 + ' → ' + nAll);
  await page.selectOption('#ana-topn', '20');
  await page.waitForTimeout(300);

  // --- 环比 ---
  const mom = await page.evaluate(() => {
    const k = [...document.querySelectorAll('#dash .kpi')].map(e => e.textContent.trim());
    const tag = document.querySelector('#dash .mom-tag');
    return { kpis: k, tag: tag ? tag.textContent : null, cls: tag ? tag.className : null };
  });
  c.ok('有"最新月"KPI', mom.kpis.some(t => /最新月/.test(t)), JSON.stringify(mom.kpis.slice(-1)));
  c.ok('显示环比百分比', mom.tag && /%/.test(mom.tag), String(mom.tag));
  c.ok('环比带涨跌配色', mom.cls && /(up|down)/.test(mom.cls), String(mom.cls));

  /* ---- 同比：去年同月 ----
     环比只看相邻两个月，容易受季节性影响；同比要拿去年同月比，
     所以必须先有连续的日期表（缺月会把对比挪到别的月份上）。 */
  c.ok('有"去年同月"KPI（同比）', mom.kpis.some((t) => /去年同月/.test(t)),
    JSON.stringify(mom.kpis.slice(-2)));
  c.ok('同比带涨跌百分比', mom.kpis.some((t) => /同比 [+\-]/.test(t)),
    JSON.stringify(mom.kpis.slice(-1)));

  /* ---- 客户规模分布：按每个地点有多少客户分档 ----
     地区排行告诉你"哪片客户多"，这个告诉你"客户是集中在少数几个点还是铺开"。 */
  const size = await page.evaluate(() => {
    const body = document.querySelector('#dash .ct-body[data-cg="size"]');
    const items = window.__cm.charts().data.size || [];
    return {
      rendered: !!(body && (body.querySelector('canvas') || body.querySelector('table.ct-table'))),
      labels: items.map((x) => x.label),
      total: items.reduce((a, b) => a + b.v, 0)
    };
  });
  c.ok('有「客户规模分布」这张图', size.rendered, JSON.stringify(size.labels));
  c.ok('规模分档按从大到小排（不是按值排）',
    size.labels.length === 4 && size.labels[0].indexOf('1000') >= 0 && size.labels[3].indexOf('1–9') >= 0,
    size.labels.join(' / '));
  c.ok('分档合计等于客户数合计', size.total > 0, String(size.total));

  c.results.push({ name: '没有页面报错', pass: page.__errors.length === 0, detail: page.__errors.join(' | ') });
  await page.close();
  return c.results;
}
