import { openApp, importCsv, checker } from '../lib.mjs';

export const name = '二期补齐 / H3 六边形 · 本地边界底图';

const layerIdsOf = () => '((window.__cmDeck && window.__cmDeck.props && window.__cmDeck.props.layers) || []).map(l => l.id)';

export default async function run(browser) {
  const c = checker();
  const page = await openApp(browser);
  await importCsv(page);

  // --- H3 六边形聚合 ---
  await page.selectOption('#p-mode', 'hex');
  await page.waitForTimeout(1500);
  const hex = await page.evaluate(() => ({
    layer: window.__cmLayer,
    legend: document.getElementById('ml-title').textContent,
    ids: ((window.__cmDeck && window.__cmDeck.props && window.__cmDeck.props.layers) || []).map(l => l.id)
  }));
  c.ok('六边形模式生效', hex.layer && hex.layer.hex === true, JSON.stringify(hex.layer));
  c.ok('六边形图层已渲染', hex.ids.indexOf('hex') >= 0, JSON.stringify(hex.ids));
  c.ok('图例切成六边形', /六边形/.test(hex.legend), hex.legend);
  c.ok('六边形有格子数统计', hex.layer && hex.layer.drawn > 0, JSON.stringify({ drawn: hex.layer && hex.layer.drawn }));

  // 悬停一格（用客户数最大的点定位，保证落在某个格子里）
  const hexAt = await page.evaluate(() => {
    const top = window.__cm.topItem();
    if (!top) { return null; }
    return window.__cm.screenOf(top.lng, top.lat);
  });
  if (hexAt) {
    await page.mouse.move(hexAt.x, hexAt.y);
    await page.waitForTimeout(600);
    const tip = await page.evaluate(() => document.getElementById('maptip').textContent);
    c.ok('悬停显示本格客户与层级', /本格客户/.test(tip), tip.slice(0, 48));
  } else { c.ok('悬停显示本格客户与层级', false, '拿不到可命中的点'); }

  // 调层级后格子数应当变化
  const before = hex.layer.drawn;
  await page.evaluate(() => { const s = document.getElementById('p-h3res'); s.value = '7'; s.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => window.__cmLayer.drawn);
  c.ok('调层级后六边形数量变化', after !== before, before + ' → ' + after);
  await page.evaluate(() => { const s = document.getElementById('p-h3res'); s.value = '5'; s.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(900);

  // --- 本地边界底图（免密钥） ---
  await page.selectOption('#p-mode', 'point');
  await page.waitForTimeout(600);
  await page.click('.mapnav .mn[data-panel="layers"]');
  await page.waitForTimeout(300);
  await page.selectOption('#p-basemap', 'boundary');
  await page.waitForTimeout(2500);
  const bm = await page.evaluate(() => {
    const ids = ((window.__cmDeck && window.__cmDeck.props && window.__cmDeck.props.layers) || []).map(l => l.id);
    return {
      ids: ids,
      layer: window.__cmLayer,
      boundaryLoaded: !!window.CN_BOUNDARY_C || !!window.CN_BOUNDARY_P
    };
  });
  c.ok('本地边界底图模式生效', bm.ids.indexOf('boundary') >= 0 && bm.ids.indexOf('basemap') < 0, JSON.stringify(bm.ids));
  c.ok('边界数据已就绪', bm.boundaryLoaded);
  c.ok('点上仍然照常渲染', bm.layer && bm.layer.items > 0, JSON.stringify(bm.layer));

  // 边界底图不依赖网络：把网络全断掉再切一次
  await page.route('**://**', r => r.abort());
  await page.selectOption('#p-basemap', 'normal');
  await page.waitForTimeout(600);
  await page.selectOption('#p-basemap', 'boundary');
  await page.waitForTimeout(1500);
  const offline = await page.evaluate(() => window.__cmLayer);
  c.ok('断网也能用本地边界底图', offline && offline.items > 0, JSON.stringify(offline));
  await page.unroute('**://**');

  c.results.push({ name: '没有页面报错', pass: page.__errors.length === 0, detail: page.__errors.join(' | ') });
  await page.close();
  return c.results;
}
