import { openApp, importCsv, checker } from '../lib.mjs';

export const name = '分层着色 / 省 · 市 · 区县';

export default async function run(browser) {
  const c = checker();
  const page = await openApp(browser);
  await importCsv(page);

  await page.selectOption('#p-mode', 'region');
  await page.waitForFunction(() => window.__cmLayer && window.__cmLayer.region === 'province', null, { timeout: 60000 });
  await page.waitForTimeout(600);
  const prov = await page.evaluate(() => ({ layer: window.__cmLayer, title: document.getElementById('ml-title').textContent }));
  c.eq('省级区域数', prov.layer.drawn, 34);
  c.ok('图例标题正确', /省/.test(prov.title), prov.title);

  // 悬停一个省
  const pt = await page.evaluate(() => {
    const l = window.__cm.regions().slice().sort((a, b) => b.v - a.v)[0];
    const P = window.__cm.regionProj();
    return { x: P.x(l.cen[0]), y: P.y(l.cen[1]), name: l.name, v: l.v };
  });
  const rect = await page.evaluate(() => { const b = document.getElementById('map').getBoundingClientRect(); return { x: b.x, y: b.y }; });
  await page.mouse.move(rect.x + pt.x, rect.y + pt.y);
  await page.waitForTimeout(400);
  const tip = await page.evaluate(() => ({ hidden: document.getElementById('maptip').hidden, text: document.getElementById('maptip').textContent }));
  c.ok('悬停显示区域客户数', !tip.hidden && tip.text.indexOf(pt.name) >= 0, tip.text.slice(0, 40));

  // 只看这个区域
  await page.mouse.click(rect.x + pt.x, rect.y + pt.y);
  await page.waitForTimeout(900);
  const bar = await page.evaluate(() => ({ hidden: document.getElementById('regionbar').hidden, text: document.getElementById('region-text').textContent }));
  c.ok('点击区域出操作条', !bar.hidden, bar.text);
  await page.click('#region-only');
  await page.waitForTimeout(1200);
  const filtered = await page.evaluate(() => ({
    sum: document.getElementById('sf-sum').textContent.trim(),
    total: window.__cm.regionAgg().total
  }));
  c.ok('只看该区域后数字与图上一致', filtered.total === pt.v, JSON.stringify(filtered) + ' 图上=' + pt.v);
  await page.click('#chips .chip[data-chip="region"] button');
  await page.waitForTimeout(900);

  // 市 / 区县
  await page.selectOption('#p-regionlevel', 'city');
  await page.waitForFunction(() => window.__cmLayer && window.__cmLayer.region === 'city', null, { timeout: 120000 });
  const city = await page.evaluate(() => window.__cmLayer);
  c.ok('市级区域数合理', city.drawn > 300, String(city.drawn));

  /* 直辖市的市界文件里放的是"区"（110101 东城区…），而数据是按"市"（110100）存的。
     以前直接按 feature 的 code 查，直辖市四块（北京/上海/天津/重庆）全是灰的，
     看上去就是"改了配色没反应"。这条断言钉住"直辖市也有颜色"。 */
  const beijing = await page.evaluate(() => {
    const l = (window.__cmDeck.props.layers || []).filter((x) => String(x.id).indexOf('region') === 0)[0];
    const fs = (l && l.props.data && l.props.data.features) || [];
    const valued = fs.filter((f) => f.properties.v > 0).length;
    const bj = fs.filter((f) => String(f.properties.code).indexOf('110') === 0);
    return { features: fs.length, valued: valued, bjN: bj.length, bjValued: bj.filter((f) => f.properties.v > 0).length };
  });
  c.ok('市级着色：绝大多数市界有颜色（直辖市不再整片灰）',
    beijing.valued > beijing.features * 0.8, JSON.stringify(beijing));
  c.ok('市级着色：北京的区也按市的值上了色',
    beijing.bjN > 0 && beijing.bjValued === beijing.bjN, JSON.stringify(beijing));

  await page.selectOption('#p-regionlevel', 'district');
  await page.waitForFunction(() => window.__cmLayer && window.__cmLayer.region === 'district', null, { timeout: 180000 });
  const dist = await page.evaluate(() => window.__cmLayer);
  c.ok('区县区域数合理', dist.drawn > 2000, String(dist.drawn));
  c.ok('区县渲染够快', dist.ms < 800, dist.ms + 'ms');

  /* ---- 层级切过去要能切回来（以前切不回来） ----
     现象：省 → 市 → 省 之后，图层数据已经是 34 个省，但**画面上还是密密麻麻的市界**。
     根因：deck 用同一个图层 id 换 data 时不会把旧几何清干净 —— 所以这条断言
     比的是**渲染结果**（画布像素），不是图层数据；只查数据的话这个 bug 会漏掉
     （一开始就是这么被骗过去的：__cmLayer.region 一直是 'province'）。
     底图也关掉，否则量到的是瓦片加载进度。 */
  const paintAt = async (lv) => {
    await page.selectOption('#p-regionlevel', lv);
    await page.waitForFunction((want) => window.__cmLayer && window.__cmLayer.region === want, lv, { timeout: 120000 });
    await page.waitForTimeout(1200);
    return page.evaluate(() => {
      const cv = window.__cmDeck.getCanvas();
      const t = document.createElement('canvas');
      t.width = cv.width; t.height = cv.height;
      const g = t.getContext('2d');
      g.drawImage(cv, 0, 0);
      const d = g.getImageData(0, 0, t.width, t.height).data;
      let sum = 0, n = 0;
      const set = new Set();
      for (let i = 0; i < d.length; i += 4 * 31) {
        sum += d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7; n++;
        if (d[i + 3] > 30) { set.add((d[i] >> 3) + ',' + (d[i + 1] >> 3) + ',' + (d[i + 2] >> 3)); }
      }
      return { hash: Math.round(sum / n), colors: set.size };
    });
  };
  await page.evaluate(() => {
    const sel = document.getElementById('p-basemap');
    if (sel) { sel.value = 'none'; }
    window.__cm.setMode('region');   // 走一次完整重绘，让"无底图"生效
  });
  await page.waitForTimeout(1800);
  const provAgain1 = await paintAt('province');
  await paintAt('city');
  const provAgain2 = await paintAt('province');
  /* ---- 区域配色可以换 ---- */
  const rampOf = () => page.evaluate(() => {
    const reg = (window.__cmDeck.props.layers || []).filter((l) => l.id.indexOf('region-') === 0)[0];
    return { id: reg.id, fill: reg.props.getFillColor({ properties: { v: 1e9 } }) };
  });
  const blue = await rampOf();
  await page.selectOption('#p-regionramp', 'orange');
  await page.waitForTimeout(1200);
  const orange = await rampOf();
  await page.selectOption('#p-regionramp', 'green');
  await page.waitForTimeout(1200);
  const green = await rampOf();
  c.ok('区域配色能换（蓝 / 橙 / 绿 各不相同）',
    blue.fill[0] !== orange.fill[0] && orange.fill[0] !== green.fill[0] && green.fill[1] > green.fill[0],
    JSON.stringify({ blue: blue.fill, orange: orange.fill, green: green.fill }));
  const legendHasRamp = await page.evaluate(() => /rgb\(/.test(document.getElementById('ml-body').innerHTML));
  c.ok('图例跟着换色（和地图同一套）', legendHasRamp, String(legendHasRamp));
  await page.selectOption('#p-regionramp', 'blue');
  await page.waitForTimeout(900);

  c.ok('省 → 市 → 省 之后画面真的回到省级（比像素，不是比数据）',
    Math.abs(provAgain1.hash - provAgain2.hash) <= 2 && Math.abs(provAgain1.colors - provAgain2.colors) <= 3,
    JSON.stringify({ 省: provAgain1, 切回: provAgain2 }));

  // 直辖市在市一级应当有颜色（110105 之类），而不是全灰
  const bj = await page.evaluate(() => {
    const agg = window.__cm.regionAgg();
    let n = 0;
    agg.city.forEach((v, k) => { if (k.indexOf('11') === 0) { n++; } });
    return n;
  });
  c.ok('直辖市市级着色有数据', bj > 0, bj + ' 个');

  /* ---- 口径一致性：地图和分析页必须是同一个数 ----
     地图分层着色按「行政区编码」归桶，分析页改之前按「省+市+区 名字拼串」——
     同一份数据、同一个筛选会给出两个不同的数（而且各自都对）。
     现在两边都走语义层的 regionBucket（行政区编码），这条断言就是把它钉死。 */
  const mapDistricts = await page.evaluate(() => window.__cmRegionAgg.dist);
  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForFunction(() => document.querySelectorAll('#dash .kpi').length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  const anaPlaces = await page.evaluate(() => {
    const el = [].slice.call(document.querySelectorAll('#dash .kpi')).filter(function (e) { return /覆盖区县/.test(e.textContent); })[0];
    return el ? parseInt(el.textContent.replace(/[^0-9]/g, ''), 10) : null;
  });
  c.eq('地图与分析页的「覆盖区县」是同一个数', anaPlaces, mapDistricts);

  c.results.push({ name: '没有页面报错', pass: page.__errors.length === 0, detail: page.__errors.join(' | ') });
  await page.close();
  return c.results;
}
