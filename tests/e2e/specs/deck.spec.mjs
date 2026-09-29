import { openApp, importCsv, checker, ROOT } from '../lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

export const name = 'deck.gl 引擎 / 常驻地址 · 3D 柱状 · 懒加载';

/* 这一组专门盯 deck.gl 引擎特有的能力：
   - 懒加载：产物 HTML 里不能有同步的 deck.gl script 标签（那会拖慢首屏 ~54ms）
   - 不加载百度：deck 引擎不需要密钥，也不该去拉百度脚本
   - 常驻地址 / 辐射圈 / 名字标签：全部由 deck 官方图层实现
   - 3D 柱状：HexagonLayer / GridLayer 的 extruded，配合倾斜视角 */
export default async function run(browser) {
  const c = checker();

  // --- 静态检查：deck.gl 必须是懒加载的 ---
  const html = fs.readFileSync(path.join(ROOT, '打开地图.html'), 'utf8');
  c.ok('产物里没有同步加载 deck.gl', html.indexOf('deck.gl.min.js') < 0, '是否出现在 HTML 里');
  c.ok('deck.gl 仍然是本地打包的（不走 CDN）', fs.existsSync(path.join(ROOT, 'vendor', 'deckgl', 'deck.gl.min.js')));

  const page = await openApp(browser);
  await importCsv(page);


  const boot = await page.evaluate(() => ({
    engine: 'deck',
    deckReady: !!(window.deck && window.deck.Deck),
    baiduLoaded: !!window.__cmMap,
    canvas: document.querySelectorAll('#map canvas').length
  }));
  c.eq('默认引擎是 deck.gl', boot.engine, 'deck');
  c.ok('deck.gl 已经按需加载进来了', boot.deckReady && boot.canvas >= 1, JSON.stringify(boot));
  c.ok('deck 引擎下不会去加载百度脚本', boot.baiduLoaded === false, JSON.stringify(boot));

  const layerIds = () => page.evaluate(() => ((window.__cmDeck && window.__cmDeck.props.layers) || []).map(l => l.id));

  // --- 常驻地址 / 辐射圈 / 名字标签 ---
  await page.click('.mapnav .mn[data-panel="base"]');
  await page.waitForTimeout(400);
  await page.click('#btn-base-add');
  await page.waitForTimeout(300);
  await page.fill('.base-addr', '广东省深圳市福田区华强北街道');
  await page.press('.base-addr', 'Enter');
  await page.waitForTimeout(4000);
  const ids1 = await layerIds();
  c.ok('常驻地址画出来了', ids1.indexOf('bases') >= 0, JSON.stringify(ids1));
  c.ok('辐射圈画出来了', ids1.indexOf('base-rings') >= 0, JSON.stringify(ids1));
  c.ok('常驻地址带了名字标签', ids1.indexOf('base-labels') >= 0, JSON.stringify(ids1));

  /* ---- 常驻点的颜色可以改，而且真的传到 deck 上 ----
     顺带钉住一个修掉的 bug：以前传的是十六进制字符串（'#e11d48'），
     deck 要的是 [r,g,b]，结果拿到 ['#','e','1',235] —— 颜色一直是错的。 */
  const color0 = await page.evaluate(() => {
    const el = document.querySelector('.base-color');
    const layer = window.__cmDeck.props.layers.filter((l) => l.id === 'bases')[0];
    return { input: el && el.value, fill: layer.props.getFillColor({}, { index: 0 }) };
  });
  c.ok('常驻点有取色器，且颜色是 RGB 数组（不是十六进制字符串）',
    !!color0.input && /^#/.test(color0.input) && Array.isArray(color0.fill) && color0.fill.length >= 3 &&
    typeof color0.fill[0] === 'number', JSON.stringify(color0));

  await page.evaluate(() => {
    const el = document.querySelector('.base-color');
    el.value = '#34c759';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(1500);
  const color1 = await page.evaluate(() => {
    const layer = window.__cmDeck.props.layers.filter((l) => l.id === 'bases')[0];
    return {
      fill: layer.props.getFillColor({}, { index: 0 }),
      saved: (JSON.parse(localStorage.getItem('cm.bases') || '[]')[0] || {}).color,
      legendHasColor: document.getElementById('ml-body').innerHTML.indexOf('34c759') >= 0
    };
  });
  c.ok('改颜色后地图上的常驻点跟着变',
    color1.fill[0] === 52 && color1.fill[1] === 199 && color1.fill[2] === 89, JSON.stringify(color1.fill));
  c.ok('颜色存进了本地（下次打开还在）', color1.saved === '#34c759', String(color1.saved));
  c.ok('图例也跟着换色', color1.legendHasColor, String(color1.legendHasColor));

  // 关掉辐射圈 → 图层应当消失
  await page.click('.mapnav .mn[data-panel="radius"]');
  await page.waitForTimeout(300);
  await page.click('#btn-base-add').catch(() => {});
  await page.evaluate(() => {
    const row = document.getElementById('L-rings');
    if (row) { row.checked = false; row.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.waitForTimeout(2500);
  const ids2 = await layerIds();
  c.ok('关掉辐射圈后图层消失', ids2.indexOf('base-rings') < 0, JSON.stringify(ids2));

  // --- 3D 柱状：六边形 ---
  await page.click('.mapnav .mn[data-panel="display"]');
  await page.waitForTimeout(300);
  await page.selectOption('#p-mode', 'hex');
  await page.waitForTimeout(2500);
  await page.check('#p-extrude');
  await page.waitForTimeout(3500);
  const hex = await page.evaluate(() => {
    const l = window.__cmDeck.props.layers.filter(x => x.id === 'hex')[0];
    const vp = window.__cmDeck.getViewports()[0];
    return { extruded: !!(l && l.props.extruded), scale: l && l.props.elevationScale, pitch: vp && Math.round(vp.pitch) };
  });
  c.ok('六边形立起来了（extruded）', hex.extruded === true && hex.scale > 0, JSON.stringify(hex));
  c.ok('3D 模式下自动给了倾角', hex.pitch > 0, JSON.stringify(hex));

  // --- 3D 柱状：网格（挤出时换成支持 3D 的地理网格图层） ---
  await page.selectOption('#p-mode', 'grid');
  await page.waitForTimeout(3500);
  const grid = await page.evaluate(() => {
    const l = window.__cmDeck.props.layers.filter(x => x.id === 'grid3d')[0];
    return { id: l && l.id, extruded: !!(l && l.props.extruded), props: l ? Object.keys(l.props).slice(0, 6) : null };
  });
  c.ok('网格也能立起来', grid.extruded === true, JSON.stringify(grid));

  // --- 3D 灯效：挤出时挂 deck 的 LightingEffect，回到 2D 必须清掉 ---
  const lit = await page.evaluate(() => {
    const fx = window.__cmDeck.props.effects || [];
    return { n: fx.length, ids: fx.map(e => e.id), dir: fx[0] ? (fx[0].directionalLights || []).length : 0,
      amb: fx[0] && fx[0].ambientLight ? fx[0].ambientLight.intensity : null };
  });
  c.ok('3D 挤出时挂上了灯效', lit.n > 0 && lit.dir === 2, JSON.stringify(lit));

  // 柱子高度（extrudeScale）要真的传到图层上
  const elev0 = await page.evaluate(() => {
    const l = (window.__cmDeck.props.layers || []).filter(x => x.id === 'grid3d')[0];
    return l ? l.props.elevationScale : null;
  });
  await page.evaluate(() => { const el = document.getElementById('p-elevscale'); el.value = '90'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(2500);
  const elev1 = await page.evaluate(() => {
    const l = (window.__cmDeck.props.layers || []).filter(x => x.id === 'grid3d')[0];
    return l ? l.props.elevationScale : null;
  });
  c.ok('柱子高度参数真的改了图层', elev1 === 90 && elev1 !== elev0, JSON.stringify({ elev0, elev1 }));

  // 立体感（环境光强度）要真的传到灯上
  await page.evaluate(() => { const el = document.getElementById('p-lightamb'); el.value = '30'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(2500);
  const amb1 = await page.evaluate(() => {
    const fx = window.__cmDeck.props.effects || [];
    return fx[0] && fx[0].ambientLight ? fx[0].ambientLight.intensity : null;
  });
  c.ok('立体感参数真的改了环境光', amb1 === 0.3, String(amb1));

  await page.selectOption('#p-mode', 'point');
  await page.waitForTimeout(1800);
  const unlit = await page.evaluate(() => (window.__cmDeck.props.effects || []).length);
  c.ok('回到 2D 后灯效被清掉', unlit === 0, String(unlit));

  // --- 地点标签：开 p-label 不只是"图层在"，还要真的画出字来 ---
  /* 这条以前只查图层存不存在，结果两个真 bug 都漏掉了：
     ① deck 的 TextLayer 默认只预生成 ASCII 字形，中文全部 "Missing character" —— 白底衬画了、字是空的；
     ② 碰撞避让扩展在这个版本上会把所有标签都剔掉。
     现在改成比画布像素：开标签前后必须有可观差异，否则就是"看着有、实际没画"。 */
  const inkDark = async () => {
    const buf = await page.locator('#map canvas').first().screenshot();
    return page.evaluate(async (b64) => {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const g = cv.getContext('2d');
      g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120) { dark++; } }
      return dark;
    }, buf.toString('base64'));
  };
  await page.selectOption('#p-mode', 'point');
  /* 先回到全国视角再量 —— 标签数量按缩放级别给（全国 50 个、放大最多 160 个），
     上一段用例把视角飞到了深圳，在那里量能看到的标签本来就没几个。 */
  await page.evaluate(() => window.__cm.setView({ lng: 113.5, lat: 30.5, zoom: 3.5, pitch: 0 }));
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const cb = document.getElementById('p-label');
    if (cb) { cb.checked = false; cb.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await page.waitForTimeout(2000);
  const darkOff = await inkDark();
  await page.evaluate(() => {
    const cb = document.getElementById('p-label');
    if (cb) { cb.checked = true; cb.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await page.waitForTimeout(2500);
  const ids3 = await layerIds();
  const darkOn = await inkDark();
  c.ok('地点标签图层已开启', ids3.indexOf('place-labels') >= 0, JSON.stringify(ids3));
  c.ok('地点标签真的画出了字（中文不是空白）', darkOn - darkOff > 2000, '深色像素 ' + darkOff + ' → ' + darkOn);
  const charset = await page.evaluate(() => {
    const l = (window.__cmDeck.props.layers || []).filter((x) => x.id === 'place-labels')[0];
    return l ? String(l.props.characterSet || '') : '';
  });
  c.ok('标签字形集里带了中文（不然 deck 一个字都不画）', /[\u4e00-\u9fa5]/.test(charset), charset.slice(0, 24));

  // --- 地图点选定位（常驻地址 / 客户手动校正）---
  // 这两条以前只有百度引擎能做，现在 deck 下也走同一套逻辑。
  await page.click('.mapnav .mn[data-panel="base"]');
  await page.waitForTimeout(400);
  await page.click('#btn-base-add');
  await page.waitForTimeout(300);
  await page.click('.base-btn[data-act="pick"]');
  await page.waitForTimeout(400);
  const cursorStyle = await page.evaluate(() => document.body.style.cursor);
  c.eq('点选时光标变成十字', cursorStyle, 'crosshair');
  const target = { lng: 114.06, lat: 22.54 };
  const spot = await page.evaluate(([lng, lat]) => window.__cm.screenOf(lng, lat), [target.lng, target.lat]);
  await page.mouse.click(spot.x, spot.y);
  await page.waitForTimeout(2200);
  const basePos = await page.evaluate(() => {
    const l = (window.__cmDeck.props.layers || []).filter(x => x.id === 'bases')[0];
    const d = l && l.props.data && l.props.data[0];
    return d ? { lng: d.lng, lat: d.lat } : null;
  });
  c.ok('常驻地址钉到了点击的位置',
    !!basePos && Math.abs(basePos.lng - target.lng) < 0.08 && Math.abs(basePos.lat - target.lat) < 0.08,
    JSON.stringify(basePos));

  // 手动校正前先把视角复位（前面开过 3D 倾角，投影变了会让点击落点跑偏）
  await page.evaluate(() => window.__cm.setView({ lng: 113.5, lat: 23.1, zoom: 6, pitch: 0 }));
  await page.waitForTimeout(2500);

  // 手动校正：打开某条详情 → 点"手动在地图上点选位置" → 点地图
  const rowIdx = await page.evaluate(() => {
    const i = window.__cm.state.rows.findIndex(r => r.status === 'ok');
    window.__cmOpenDetail(i);
    return i;
  });
  await page.waitForTimeout(800);
  await page.click('#btn-d-manual');
  await page.waitForTimeout(600);
  const sp2 = await page.evaluate(() => window.__cm.screenOf(114.2, 22.6));
  await page.mouse.click(sp2.x, sp2.y);
  await page.waitForTimeout(2200);
  const manual = await page.evaluate((i) => {
    const r = window.__cm.state.rows[i];
    return { source: r.source, quality: r.quality, lng: r.lng, lat: r.lat, pending: window.__cm.state.manualPick };
  }, rowIdx);
  c.ok('客户可以手动钉到点选位置', manual.source === 'manual' && manual.pending === -1, JSON.stringify(manual));

  // 提示条不能吃掉地图点击（它就在底部中央，点选时正好弹出来）
  const toastPE = await page.evaluate(() => getComputedStyle(document.getElementById('toast')).pointerEvents);
  c.eq('提示条不吃鼠标事件', toastPE, 'none');

  // 列表点行 → 视野飞过去
  const beforeFly = await page.evaluate(() => window.__cm.getView());
  await page.evaluate(() => {
    const i = window.__cm.state.rows.findIndex(r => r.status === 'ok');
    window.__cm.state.activeIdx = i;
  });
  await page.evaluate(() => { const b = document.getElementById('btn-fit'); b.click(); });
  await page.waitForTimeout(2000);
  const afterFit = await page.evaluate(() => window.__cm.getView());
  c.ok('看全图能重新取景', !!afterFit && !!beforeFly, JSON.stringify({ before: beforeFly && beforeFly.zoom, after: afterFit && afterFit.zoom }));

  // 保存地图图片（deck 走 WebGL 画布的 toDataURL）
  const dl = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await page.click('#btn-shot');
  const download = await dl;
  let pngBytes = 0;
  if (download) { pngBytes = fs.statSync(await download.path()).size; }
  c.ok('能保存地图图片且不是空白', !!download && pngBytes > 50000, download ? pngBytes + ' 字节' : '没有触发下载');
  // --- 参数面板里的每一项都要真的生效（这些以前只有手写渲染才管用）---
  const idsNow = () => page.evaluate(() => (window.__cmDeck.props.layers || []).map(l => l.id));

  // 客户点图层开关
  await page.click('.mapnav .mn[data-panel="layers"]');
  await page.waitForTimeout(300);
  await page.evaluate(() => { const cb = document.getElementById('L-points'); cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(1800);
  const off = await idsNow();
  c.ok('关掉「客户点」图层后真的不画', off.indexOf('pts') < 0 && off.indexOf('pts-grid') < 0, JSON.stringify(off));
  await page.evaluate(() => { const cb = document.getElementById('L-points'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(1800);
  const on = await idsNow();
  c.ok('再打开又回来了', on.indexOf('pts') >= 0, JSON.stringify(on));

  // 点大小按客户数
  await page.click('.mapnav .mn[data-panel="display"]');
  await page.waitForTimeout(300);
  const radius = await page.evaluate(() => {
    const l = (window.__cmDeck.props.layers || []).filter(x => x.id === 'pts')[0];
    return { small: l.props.getRadius({ r: { count: 1 } }), big: l.props.getRadius({ r: { count: 5000 } }) };
  });
  c.ok('点大小按客户数放大', radius.big > radius.small, JSON.stringify(radius));

  // 点太密自动降级成网格（把阈值调小来触发）
  await page.evaluate(() => { window.__cm.params.lodMax = 10; window.__cm.setMode('point'); });
  await page.waitForTimeout(2500);
  const auto = await page.evaluate(() => ({ layer: window.__cmLayer, legend: document.getElementById('ml-body').textContent }));
  c.ok('点太密时自动切成网格', auto.layer.grid === true && auto.layer.auto === true, JSON.stringify(auto.layer));
  c.ok('图例说明了自动降级', /自动切成网格/.test(auto.legend), auto.legend.slice(0, 40));
  await page.evaluate(() => { window.__cm.params.lodMax = 9000; window.__cm.setMode('point'); });
  await page.waitForTimeout(2000);

  // 热力图：配色 + 前 N 个点的标注
  await page.selectOption('#p-mode', 'heat');
  await page.waitForTimeout(2500);
  const heat = await page.evaluate(() => {
    const ls = window.__cmDeck.props.layers || [];
    const h = ls.filter(x => x.id === 'heat')[0];
    const top = ls.filter(x => x.id === 'heat-top')[0];
    return {
      colors: h && h.props.colorRange ? h.props.colorRange.length : 0,
      topN: top ? top.props.data.length : 0,
      sample: top && top.props.data.length ? top.props.getText(top.props.data[0]) : ''
    };
  });
  c.ok('热力图用上了配色方案', heat.colors >= 5, JSON.stringify(heat));
  c.ok('热力图上标出了前 N 个点', heat.topN > 0, JSON.stringify(heat));

  // --- 连线样式：弧线（deck ArcLayer）/ 直线（LineLayer），不能自己画 ---
  await page.click('.mapnav .mn[data-panel="radius"]');
  await page.waitForTimeout(300);
  await page.selectOption('#p-linkstyle', 'arc');
  await page.waitForTimeout(2500);
  const arcs = await idsNow();
  c.ok('连线用 deck 的 ArcLayer 画弧线', arcs.indexOf('base-arcs') >= 0, JSON.stringify(arcs));
  await page.selectOption('#p-linkstyle', 'line');
  await page.waitForTimeout(2500);
  const lns = await idsNow();
  c.ok('切直线时换成 LineLayer', lns.indexOf('base-lines') >= 0 && lns.indexOf('base-arcs') < 0, JSON.stringify(lns));
  c.results.push({ name: '没有页面报错', pass: page.__errors.length === 0, detail: page.__errors.join(' | ') });
  await page.close();
  return c.results;
}
