import { openApp, importCsv, checker } from '../lib.mjs';

export const name = '地图 / 点 · 网格 · 热力 · 框选';

/* 地图只有一个引擎：deck.gl，画布在 #map 里。
   能用图层统计判断的就不读画布像素，必须看画布时用截图字节数。 */

async function canvasBytes(page) {
  const shot = await page.locator('#map canvas').first().screenshot();
  return shot.length;
}

export default async function run(browser) {
  const c = checker();
  const page = await openApp(browser);
  await importCsv(page);

  // --- 点图层 ---
  /* ---- 功能栏：所有"能点"的东西都在同一条栏里 ----
     以前切面板的按钮在右上、地图动作在左上，两组分在屏幕两个角。 */
  const bar = await page.evaluate(() => {
    const top = document.querySelector('.maptopbar');
    if (!top) { return null; }
    return {
      navInside: !!top.querySelector('.mapnav'),
      toolsInside: !!top.querySelector('.maptools'),
      navCount: top.querySelectorAll('.mapnav .mn').length,
      toolCount: top.querySelectorAll('.maptools .toolbtn').length,
      sep: !!top.querySelector('.toolsep')
    };
  });
  c.ok('切面板的按钮和地图动作在同一条功能栏里',
    bar && bar.navInside && bar.toolsInside && bar.navCount === 4 && bar.toolCount >= 6,
    JSON.stringify(bar));

  const layer = await page.evaluate(() => window.__cm.layer());
  c.ok('点图层渲染', layer && layer.items > 0 && !layer.grid, JSON.stringify(layer));
  const bytes = await canvasBytes(page);
  c.ok('画布真的画上了内容', bytes > 20000, bytes + ' 字节');

  // --- 悬停出提示卡 ---
  const top = await page.evaluate(() => window.__cm.topItem());
  const at = top ? await page.evaluate(([lng, lat]) => window.__cm.screenOf(lng, lat), [top.lng, top.lat]) : null;
  if (at) {
    await page.mouse.move(at.x, at.y);
    await page.waitForTimeout(450);
    const tip = await page.evaluate(() => ({ hidden: document.getElementById('maptip').hidden, text: document.getElementById('maptip').textContent }));
    c.ok('悬停出提示卡', !tip.hidden && tip.text.indexOf('客户') >= 0, tip.text.slice(0, 40));
    await page.mouse.move(at.x + 40, at.y + 40);
    await page.waitForTimeout(200);
  } else {
    c.ok('悬停出提示卡', false, '拿不到可命中的点');
  }

  // --- 网格聚合 ---
  await page.selectOption('#p-mode', 'grid');
  await page.waitForTimeout(1500);
  const grid = await page.evaluate(() => window.__cmLayer);
  c.ok('网格聚合', grid && grid.grid && grid.drawn > 0, JSON.stringify(grid));

  // --- 热力图 ---
  await page.selectOption('#p-mode', 'heat');
  await page.waitForTimeout(2000);
  const heat = await page.evaluate(() => ({ h: window.__cmHeat, layer: window.__cmLayer }));
  c.ok('热力图渲染', !!(heat.layer && heat.layer.heat && heat.h && heat.h.drawn > 0), JSON.stringify(heat.h));
  await page.selectOption('#p-mode', 'point');
  await page.waitForTimeout(900);

  // --- 矩形框选 ---
  const box = await page.evaluate(() => { const r = document.getElementById('view-map').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.click('#btn-box');
  await page.mouse.move(box.x + box.w * 0.2, box.y + box.h * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w * 0.55, box.y + box.h * 0.7, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const boxRes = await page.evaluate(() => ({
    bar: !document.getElementById('boxbar').hidden,
    text: document.getElementById('box-text').textContent,
    sel: window.__cm.box().sel
  }));
  c.ok('框选出结果条', boxRes.bar, boxRes.text);
  c.ok('框选统计到客户数', !!(boxRes.sel && boxRes.sel.cust > 0), JSON.stringify(boxRes.sel));
  await page.click('#box-clear');
  await page.waitForTimeout(900);

  // --- 拖动 ---
  const before = await page.evaluate(() => window.__cm.getView());
  await page.mouse.move(box.x + box.w * 0.6, box.y + box.h * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w * 0.45, box.y + box.h * 0.5, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => window.__cm.getView());
  c.ok('拖动改变了视野中心', !!(before && after) && Math.abs(after.lng - before.lng) > 0.1,
    JSON.stringify([before && before.lng, after && after.lng]));

  // --- 点聚合（气泡） ---
  await page.evaluate(() => window.__cm.setView({ lng: 113.5, lat: 30.5, zoom: 5 }));
  await page.waitForTimeout(3000);
  await page.selectOption('#p-mode', 'cluster');
  await page.waitForTimeout(3000);

  const cl = await page.evaluate(() => ({ layer: window.__cmLayer, info: window.__cmLayer.clusterInfo }));
  c.ok('点聚合模式生效', cl.layer && cl.layer.cluster === true, JSON.stringify({ cluster: cl.layer && cl.layer.cluster }));
  c.ok('密集的点被聚成气泡（聚合后组数远少于点数）',
    cl.info && cl.info.bubbles > 20 && cl.info.groups < cl.layer.items / 4,
    JSON.stringify({ 点数: cl.layer.items, 气泡: cl.info && cl.info.bubbles, 组数: cl.info && cl.info.groups }));
  c.ok('气泡里带上了数量上限', cl.info && cl.info.max > 1000, JSON.stringify(cl.info));

  await page.evaluate(() => window.__cm.setView({ lng: 113.5, lat: 30.5, zoom: 7 }));
  await page.waitForFunction(() => {
    const i = window.__cmLayer && window.__cmLayer.clusterInfo;
    return i && i.zoom === 7;
  }, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const cl2 = await page.evaluate(() => ({ layer: window.__cmLayer, info: window.__cmLayer.clusterInfo }));
  c.ok('放大后重新按新层级聚合', cl2.info && cl2.info.zoom === 7, JSON.stringify(cl2.info));
  c.ok('放大后细分成更多组', cl2.info && cl.info && cl2.info.groups > cl.info.groups,
    (cl.info && cl.info.groups) + ' → ' + (cl2.info && cl2.info.groups));

  /* ---- 热点高光：客户最多的地方加一层柔光，一眼看出人在哪 ----
     是静态的一层（不是逐帧动画）—— 动画每帧都要重绘，几千个点会拖慢拖动。 */
  await page.selectOption('#p-mode', 'point');   // 高光只在"标记点"这一档
  await page.waitForTimeout(1500);
  const glow = await page.evaluate(() => {
    const l = (window.__cmDeck.props.layers || []).filter((x) => x.id === 'glow')[0];
    return l ? l.props.data.length : 0;
  });
  c.ok('客户最多的点带高光', glow > 0 && glow <= 24, String(glow));
  await page.click('.mapnav .mn[data-panel="layers"]');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const cb = document.getElementById('L-glow');
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(1200);
  const glowOff = await page.evaluate(() =>
    (window.__cmDeck.props.layers || []).some((l) => l.id === 'glow'));
  c.ok('高光可以在图层面板关掉', glowOff === false, String(glowOff));

  /* ---- 平滑飞过去：deck 的过渡没被全局配置禁掉 ----
     全局 transitionDuration 是 0（拖动时必须瞬移，否则动画一直被下一帧打断），
     只有"飞过去"这种一次性动作才带 ms。这里验的正是后者。 */
  const fly = await page.evaluate(async () => {
    const dk = window.__cmDeck;
    const v0 = dk.getViewports()[0];
    const z0 = v0.zoom;
    dk.setProps({ viewState: { longitude: v0.longitude, latitude: v0.latitude, zoom: z0 + 3, transitionDuration: 700 } });
    await new Promise((r) => setTimeout(r, 140));
    const mid = dk.getViewports()[0].zoom;
    await new Promise((r) => setTimeout(r, 1000));
    const end = dk.getViewports()[0].zoom;
    return { z0: +z0.toFixed(2), mid: +mid.toFixed(2), end: +end.toFixed(2) };
  });
  c.ok('"飞过去"有平滑过渡（不是硬切）',
    fly.mid > fly.z0 + 0.05 && fly.mid < fly.end - 0.05, JSON.stringify(fly));

  c.results.push({ name: '没有页面报错', pass: page.__errors.length === 0, detail: page.__errors.join(' | ') });
  await page.close();
  return c.results;
}
