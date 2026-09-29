import { openApp, importCsv, checker, ROOT } from '../lib.mjs';
import path from 'node:path';

export const name = '分析 / 12 种图表样式';

export default async function run(browser) {
  const c = checker();
  const page = await openApp(browser);
  await importCsv(page);
  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForFunction(() => document.querySelectorAll('#dash .kpi').length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(500);

  /* 卡片数量跟着 visuals.js 的声明走：时间趋势 / 平台分布 / 地区排行 / 店铺分布 / 客户规模 / 客户画像（粗） */
  const cards = await page.$$eval('#dash .ct-body', e => e.length);
  c.eq('六张图表卡片', cards, 6);

  /* 注意：这份测试数据（汇总_按区县_三维.csv）里没有客户画像那几列，所以
     「客户画像（粗）」是空状态 —— 它的画法切换由 core.spec 里那份带画像列的小表覆盖，这里不重复点。 */
  const groups = ['time', 'plat', 'geo', 'shop', 'size'];
  /* 这份测试数据（汇总_按区县_三维.csv）里没有"店铺"列，所以「店铺分布」应当是
     一张带原因的空状态 —— 那也是要验证的行为，不是失败。
     其余三张图的维度数据里都有，必须真画出来。 */
  const EXPECT_EMPTY = ['shop'];   // 这份数据没有店铺列；size 是按客户数分档，数据里有
  let total = 0;
  for (const g of groups) {
    const types = await page.$$eval('#dash .chart-switch[data-cs="' + g + '"] button', bs => bs.map(b => b.getAttribute('data-ct')));
    for (const t of types) {
      await page.click('#dash .chart-switch[data-cs="' + g + '"] button[data-ct="' + t + '"]');
      await page.waitForTimeout(180);
      const info = await page.evaluate(({ g, t }) => {
        const body = document.querySelector('#dash .ct-body[data-cg="' + g + '"]');
        const on = document.querySelector('#dash .chart-switch[data-cs="' + g + '"] button.on');
        return {
          active: on && on.getAttribute('data-ct'),
          has: !!body.querySelector('svg') || !!body.querySelector('table.ct-table') || !!body.querySelector('canvas'),
          clickable: body.querySelectorAll('[data-k]').length,
          empty: !!body.querySelector('.an-empty')
        };
      }, { g, t });
      total++;
      const wantEmpty = EXPECT_EMPTY.indexOf(g) >= 0;
      const ok = info.active === t && (wantEmpty ? info.empty : (info.has && !info.empty));
      c.ok(g + ' / ' + t + (wantEmpty ? '（这份数据没有该维度 → 出空状态）' : ''), ok, JSON.stringify(info));
    }
  }
  c.eq('图表样式总数', total, 24);

  // 时间趋势点击 → 时间筛选
  await page.click('#dash .chart-switch[data-cs="time"] button[data-ct="bar"]');
  await page.waitForTimeout(200);
  // 时间趋势已改用 ECharts（canvas 渲染）
  const hasCanvas = await page.evaluate(() => !!document.querySelector('#dash .ct-body[data-cg="time"] canvas'));
  c.ok('时间趋势使用 ECharts canvas', hasCanvas, String(hasCanvas));

  // ECharts 点击联动：验证图表把点击回传给了筛选逻辑
  // （ECharts 自身的鼠标命中由它自己保证，这里验证我们接的那一段）
  const link = await page.evaluate(() => {
    const d = window.__cm.charts().data.plat[0];
    if (!d || !window.__cmPicks || !window.__cmPicks.plat) { return 'no-hook'; }
    window.__cmPicks.plat(d.click);
    return d.click;
  });
  await page.waitForTimeout(1200);
  const sum = (await page.textContent('#sf-sum')).trim();
  c.ok('图表点击能联动筛选', link !== 'no-hook' && /平台/.test(sum), link + ' → ' + sum);
  await page.click('#chip-clear').catch(() => {});
  await page.waitForTimeout(900);

  /* ---- 声明式视觉对象的证明：换一份"有店铺列"的数据，第 4 张图直接就有内容 ----
     这份测试数据里没有店铺列，所以上面那张图是空状态（也是对的）。
     这里换成示例订单数据，验证「加一个视觉对象 = 加一行声明」真的成立：
     没有为它写过取数代码、没有改过卡片 HTML，只是声明了 dimension: 'shop'。 */
  await page.click('#btn-import');
  await page.setInputFiles('#imp-file', path.join(ROOT, '示例_订单数据.csv'));
  await page.waitForFunction(() => {
    const l = document.getElementById('loading');
    const s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 400;
  }, null, { timeout: 120000 });
  await page.waitForTimeout(900);
  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForFunction(() => document.querySelectorAll('#dash .kpi').length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  const shop = await page.evaluate(() => {
    const body = document.querySelector('#dash .ct-body[data-cg="shop"]');
    const items = (window.__cm.charts().data.shop || []);
    return {
      // 画法由偏好决定（前面的循环把它留在了表格上），所以三种都算"画出来了"
      rendered: !!(body.querySelector('canvas') || body.querySelector('svg') || body.querySelector('table.ct-table')),
      empty: !!body.querySelector('.an-empty'),
      pref: window.__cm.charts().prefs.shop,
      n: items.length,
      /* 是否按度量降序 —— 不依赖具体店铺名 */
      sorted: items.every((x, i) => i === 0 || items[i - 1].v >= x.v),
      top: items.slice(0, 2).map((x) => x.label + '=' + x.v)
    };
  });
  c.ok('有店铺列的数据 → 店铺分布真的画出来了', shop.rendered && !shop.empty && shop.n > 0, JSON.stringify(shop));
  /* 只验"取到了多家店铺、且按度量降序" —— 不绑定具体店铺名（换数据也不用改用例） */
  c.ok('店铺排行按度量排序', shop.n > 1 && shop.sorted, JSON.stringify({ n: shop.n, top: shop.top.slice(0, 3) }));

  c.results.push({ name: '没有页面报错', pass: page.__errors.length === 0, detail: page.__errors.join(' | ') });
  await page.close();
  return c.results;
}
