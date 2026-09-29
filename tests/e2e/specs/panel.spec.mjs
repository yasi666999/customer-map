import { openApp, importCsv, checker } from '../lib.mjs';

export const name = '显示样式 · 参数分组与联动';

/* 显示样式面板按"谁跟谁联动"分成三组：
     ① 画法  ② 该画法的参数  ③ 通用
   这组用例盯两件事：
     a) 分组是不是真的跟着画法联动（不该出现的行确实不出现，通用行始终在）；
     b) 每一档里露出来的控件是不是真的作用到了 deck 图层上 ——
        包括这次挪了位置 / 重新接线的（格子大小、六边形层级、网格透明度、重置按钮）。 */

const MODE_NAME = {
  point: '标记点', cluster: '点聚合', grid: '网格聚合', hex: '六边形聚合', region: '分层着色', heat: '热力图'
};

const EXPECT = {
  point: {
    on: ['点大小', '透明度', '着色', '按客户数调整大小', '点太密时自动聚合成网格'],
    off: ['六边形层级', '格子大小', '3D 柱状', '柱子高度', '热力半径', '区域层级']
  },
  cluster: {
    on: [],
    off: ['点大小', '格子大小', '六边形层级', '热力半径', '区域层级', '3D 柱状']
  },
  grid: {
    on: ['格子大小', '3D 柱状', '透明度'],
    off: ['点大小', '六边形层级', '热力半径', '区域层级', '柱子高度']
  },
  hex: {
    on: ['六边形层级', '3D 柱状', '透明度'],
    off: ['点大小', '格子大小', '热力半径', '区域层级', '柱子高度']
  },
  region: {
    on: ['区域层级', '区域配色'],
    off: ['点大小', '透明度', '格子大小', '六边形层级', '热力半径', '3D 柱状']
  },
  heat: {
    on: ['热力半径', '热力强度', '热力配色', '标注前N'],
    off: ['点大小', '透明度', '格子大小', '六边形层级', '区域层级', '3D 柱状']
  }
};

/* 面板里每一行"在不在"：只看 .row[data-when]，用行首那句话说事 */
function rowsVisible(page) {
  return page.evaluate(() => {
    const out = {};
    document.querySelectorAll('#parambody .row[data-when]').forEach((el) => {
      const lab = el.querySelector('span');
      out[(lab ? lab.textContent : el.textContent).trim()] = getComputedStyle(el).display !== 'none';
    });
    out['通用·显示地点名称'] = (() => {
      const el = document.getElementById('p-label');
      return !!el && getComputedStyle(el.closest('.row')).display !== 'none';
    })();
    out['通用·显示哪些精度'] = (() => {
      const el = document.getElementById('p-levels');
      return !!el && getComputedStyle(el).display !== 'none';
    })();
    return out;
  });
}

const layerProps = (page, id) => page.evaluate((lid) => {
  const l = (window.__cmDeck && window.__cmDeck.props.layers || []).filter((x) => x.id === lid)[0];
  if (!l) { return null; }
  const p = l.props || {};
  return {
    id: lid, class: (l.constructor && l.constructor.layerName) || '',
    cellSizePixels: p.cellSizePixels, opacity: p.opacity, radius: p.radius,
    radiusPixels: p.radiusPixels, intensity: p.intensity,
    elevationScale: p.elevationScale, extruded: p.extruded,
    colorRange: p.colorRange ? JSON.stringify(p.colorRange).slice(0, 120) : null
  };
}, id);

const hasLayer = (page, id) => page.waitForFunction((lid) =>
  ((window.__cmDeck && window.__cmDeck.props.layers) || []).some((x) => x.id === lid), id, { timeout: 60000 });

const noLayer = (page, id) => page.waitForFunction((lid) =>
  !((window.__cmDeck && window.__cmDeck.props.layers) || []).some((x) => x.id === lid), id, { timeout: 60000 });

const waitProp = (page, id, key, val) => page.waitForFunction(([lid, k, v]) => {
  const l = ((window.__cmDeck && window.__cmDeck.props.layers) || []).filter((x) => x.id === lid)[0];
  if (!l) { return false; }
  const now = l.props[k];
  return now != null && Math.abs(now - v) < 0.001;
}, [id, key, val], { timeout: 60000 });

const setRange = (page, id, v) => page.evaluate(([i, val]) => {
  const el = document.getElementById(i);
  el.value = String(val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, [id, v]);

const setSelect = (page, id, v) => page.evaluate(([i, val]) => {
  const el = document.getElementById(i);
  el.value = String(val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, v]);

/* 真实点一下 checkbox，input + change 都会冒；两个都补上，
   免得"监听的是 change、用例只发了 input"这种假失败 */
const checkBox = (page, id, on) => page.evaluate(([i, v]) => {
  const el = document.getElementById(i);
  el.checked = !!v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, on]);

/* 点图层：拿一个真实的数据点去问它的半径和颜色，等于问"画出来是什么样" */
const pointLook = (page, multi) => page.evaluate((wantMulti) => {
  const l = ((window.__cmDeck && window.__cmDeck.props.layers) || []).filter((x) => x.id === 'pts')[0];
  const items = window.__cm.state.layerItems || [];
  const it = wantMulti ? items.filter((x) => x.r.count > 1)[0] : items[0];
  if (!l || !it) { return null; }
  const col = l.props.getFillColor(it);
  return { r: l.props.getRadius(it), col: col.slice(0, 4).join(',') };
}, multi);

const ambient = (page) => page.evaluate(() => {
  const fx = (window.__cmDeck && window.__cmDeck.props.effects) || [];
  return fx.length && fx[0].ambientLight ? fx[0].ambientLight.intensity : null;
});

export default async function run(browser) {
  const c = checker();
  const page = await openApp(browser);
  await importCsv(page);

  // --- ① 分组本身 ---
  const groups = await page.evaluate(() => Array.from(document.querySelectorAll('#parambody .pg-t'))
    .map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  c.ok('显示样式分成三组（画法 / 该画法的参数 / 通用）',
    groups.length === 3 && /①.*画法/.test(groups[0]) && /②.*参数/.test(groups[1]) && /③.*通用/.test(groups[2]),
    JSON.stringify(groups));

  const titleOf = () => page.evaluate(() => document.getElementById('mode-param-name').textContent);

  // --- ② 每一档画法只留下自己那几行，通用行始终在 ---
  for (const mode of ['point', 'cluster', 'grid', 'hex', 'region', 'heat']) {
    await page.selectOption('#p-mode', mode);
    await page.waitForTimeout(260);
    const vis = await rowsVisible(page);
    const exp = EXPECT[mode];
    const wrongOn = exp.off.filter((k) => vis[k]);
    const wrongOff = exp.on.filter((k) => vis[k] === false);
    const generic = vis['通用·显示地点名称'] === true && vis['通用·显示哪些精度'] === true;
    c.ok('「' + mode + '」只显示这一档的参数', wrongOn.length === 0 && wrongOff.length === 0 && generic,
      JSON.stringify({ 多显示: wrongOn, 少显示: wrongOff, 通用行: generic }));
    const t = await titleOf();
    const same = t.indexOf(MODE_NAME[mode]) >= 0;
    c.ok('「' + mode + '」参数组标题跟着画法走', same, t);
  }

  // --- ③ 标记点：点大小 / 透明度 / 着色 / 按客户数调整大小，一个个问到图层上 ---
  await page.selectOption('#p-mode', 'point');
  await hasLayer(page, 'pts');
  const p0 = await pointLook(page, false);
  await setRange(page, 'p-size', 30);
  await page.waitForTimeout(400);
  const p1 = await pointLook(page, false);
  c.ok('标记点：点大小改的是点半径', p0 && p1 && p1.r > p0.r, JSON.stringify([p0 && p0.r, p1 && p1.r]));

  await setRange(page, 'p-alpha', 40);
  await page.waitForTimeout(400);
  const p2 = await pointLook(page, false);
  c.ok('标记点：透明度改的是填充色的 alpha', p2 && p2.col.split(',')[3] === '102', JSON.stringify([p0 && p0.col, p2 && p2.col]));

  await setSelect(page, 'p-color', 'none');
  await page.waitForTimeout(500);
  const p3 = await pointLook(page, false);
  c.ok('标记点：换着色方案，点颜色跟着换', p3 && p3.col !== p2.col, JSON.stringify([p2 && p2.col, p3 && p3.col]));

  const pmOn = await pointLook(page, true);
  await checkBox(page, 'p-sizebycount', false);
  await page.waitForTimeout(500);
  const pmOff = await pointLook(page, true);
  c.ok('标记点：按客户数调整大小真的在改半径', pmOn && pmOff && pmOn.r !== pmOff.r, JSON.stringify([pmOn && pmOn.r, pmOff && pmOff.r]));
  await checkBox(page, 'p-sizebycount', true);
  await page.waitForTimeout(300);

  /* 点太密自动聚合成网格：把阈值临时压到 2 个点，就能看到它真的会换成网格图层 */
  await page.evaluate(() => { window.__cm.params.lodMax = 2; window.__cm.setMode('point'); });
  await hasLayer(page, 'pts-grid');
  c.ok('标记点：点太密时真的会换成聚合网格', true, '出现了 pts-grid 图层');
  await checkBox(page, 'p-lod', false);
  await hasLayer(page, 'pts');
  c.ok('标记点：关掉"自动聚合成网格"就还画点', true, '回到 pts 图层');
  await page.evaluate(() => { window.__cm.params.lodMax = 9000; });
  await checkBox(page, 'p-lod', true);
  await page.waitForTimeout(400);

  // --- ④ 3D 柱状：勾上才冒出"柱子高度 / 立体感" ---
  await page.selectOption('#p-mode', 'hex');
  await page.waitForTimeout(300);
  const before3d = await rowsVisible(page);
  await page.check('#p-extrude');
  await page.waitForTimeout(400);
  const after3d = await rowsVisible(page);
  c.ok('3D 柱状勾上后「柱子高度 / 立体感」才出现',
    before3d['柱子高度'] === false && after3d['柱子高度'] === true && after3d['立体感'] === true,
    JSON.stringify({ 勾前: before3d['柱子高度'], 勾后: after3d['柱子高度'] }));

  // --- ⑤ 六边形：层级换半径 / 透明度 / 立体感 ---
  await hasLayer(page, 'hex');
  await page.waitForTimeout(400);
  const hex0 = await layerProps(page, 'hex');
  await setRange(page, 'p-h3res', 7);
  await page.waitForFunction((r0) => {
    const l = ((window.__cmDeck && window.__cmDeck.props.layers) || []).filter((x) => x.id === 'hex')[0];
    return !!l && l.props.radius !== r0;
  }, hex0.radius, { timeout: 60000 });
  const hex1 = await layerProps(page, 'hex');
  c.ok('六边形：层级滑块换的是 H3 半径', hex0.radius !== hex1.radius, JSON.stringify([hex0.radius, hex1.radius]));
  await setRange(page, 'p-alpha', 50);
  await page.waitForTimeout(500);
  const hex2 = await layerProps(page, 'hex');
  c.ok('六边形：透明度改的是图层不透明度', hex2 && Math.abs(hex2.opacity - 0.5) < 0.001, JSON.stringify(hex2 && hex2.opacity));
  await setRange(page, 'p-lightamb', 30);
  await page.waitForTimeout(600);
  c.eq('六边形：立体感改的是环境光强度', await ambient(page), 0.3);
  await page.uncheck('#p-extrude');
  await page.waitForTimeout(600);
  c.eq('取消 3D 后灯效被清掉', await ambient(page), null);

  // --- ⑥ 网格：格子大小 / 透明度 / 柱子高度（2D 与 3D 是两个图层） ---
  await page.selectOption('#p-mode', 'grid');
  await setRange(page, 'p-alpha', 85);          // 上一档留在 50，这里先把基准拉回默认
  await hasLayer(page, 'grid2d');
  await waitProp(page, 'grid2d', 'cellSizePixels', 46);
  await waitProp(page, 'grid2d', 'opacity', 0.85);
  const grid0 = await layerProps(page, 'grid2d');
  await setRange(page, 'p-gridsize', 70);
  await waitProp(page, 'grid2d', 'cellSizePixels', 70);
  const grid1 = await layerProps(page, 'grid2d');
  c.ok('网格：格子大小滑块改的是图层格子', grid0.cellSizePixels === 46 && grid1.cellSizePixels === 70,
    JSON.stringify([grid0.cellSizePixels, grid1.cellSizePixels]));

  await setRange(page, 'p-alpha', 40);
  await waitProp(page, 'grid2d', 'opacity', 0.4);
  const grid2 = await layerProps(page, 'grid2d');
  c.ok('网格：透明度滑块真的改到了网格上（以前写死 0.8）',
    Math.abs(grid0.opacity - 0.85) < 0.001 && Math.abs(grid2.opacity - 0.4) < 0.001,
    JSON.stringify([grid0.opacity, grid2.opacity]));

  await page.check('#p-extrude');
  await waitProp(page, 'grid3d', 'elevationScale', 30);
  const grid3d0 = await layerProps(page, 'grid3d');
  c.ok('网格：3D 柱状立起来了（换成支持挤出的地理网格）',
    grid3d0.extruded === true && grid3d0.elevationScale === 30, JSON.stringify(grid3d0));
  await setRange(page, 'p-elevscale', 90);
  await waitProp(page, 'grid3d', 'elevationScale', 90);
  c.ok('网格：柱子高度滑块改的是挤出高度', (await layerProps(page, 'grid3d')).elevationScale === 90, '90');
  /* 切回 2D：以前这里会踩"同一个图层 id 换另一种图层"的坑，屏幕网格会一直报错画不出来 */
  await page.uncheck('#p-extrude');
  await hasLayer(page, 'grid2d');
  await page.waitForTimeout(1500);
  const back2d = await page.evaluate(() => {
    const l = ((window.__cmDeck && window.__cmDeck.props.layers) || []).filter((x) => x.id === 'grid2d')[0];
    return l && l.props.cellSizePixels;
  });
  c.ok('网格：3D 切回 2D 后屏幕网格照常渲染', back2d === 70, String(back2d));
  c.ok('网格：3D 切回 2D 后没有图层报错',
    !page.__errors.some((e) => /onSetColorDomain|ScreenGridLayer/.test(e)), page.__errors.join(' | ').slice(0, 160));

  // --- ⑦ 热力图：半径 / 强度 / 配色 / 标注前N ---
  await page.selectOption('#p-mode', 'heat');
  await hasLayer(page, 'heat');
  await waitProp(page, 'heat', 'radiusPixels', 28);
  await setRange(page, 'p-heatr', 60);
  await waitProp(page, 'heat', 'radiusPixels', 60);
  await setRange(page, 'p-heati', 180);
  await waitProp(page, 'heat', 'intensity', 1.8);
  const heat0 = await layerProps(page, 'heat');
  c.ok('热力图：半径 / 强度都作用到了图层上',
    heat0.radiusPixels === 60 && Math.abs(heat0.intensity - 1.8) < 0.001, JSON.stringify(heat0));

  await setSelect(page, 'p-heatramp', 'warm');
  await page.waitForFunction(() => {
    const l = ((window.__cmDeck && window.__cmDeck.props.layers) || []).filter((x) => x.id === 'heat')[0];
    return !!l && JSON.stringify(l.props.colorRange).indexOf('70,0,140') > 0;
  }, null, { timeout: 60000 });
  const heat1 = await layerProps(page, 'heat');
  c.ok('热力图：换配色，色阶跟着换', heat1 && heat1.colorRange !== heat0.colorRange, JSON.stringify([heat0.colorRange, heat1.colorRange]));

  await hasLayer(page, 'heat-top');
  await setRange(page, 'p-heattop', 0);
  await noLayer(page, 'heat-top');
  c.ok('热力图：标注前N 调到 0 就不标了', true, 'heat-top 图层消失');
  await setRange(page, 'p-heattop', 30);
  await hasLayer(page, 'heat-top');
  c.ok('热力图：标注前N 调回来又出现标注', true, 'heat-top 图层回来了');

  // --- ⑧ 通用：显示地点名称在热力档也管用；显示哪些精度左右画出来的点 ---
  await checkBox(page, 'p-label', true);
  await hasLayer(page, 'place-labels');
  c.ok('通用：显示地点名称在热力档也生效', true, '出现了 place-labels 图层');
  const nBefore = await page.evaluate(() => (window.__cm.state.layerItems || []).length);
  await page.evaluate(() => {
    document.querySelectorAll('#p-levels input').forEach((cb) => { cb.checked = false; });
    document.getElementById('p-levels').dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(1200);
  const nOff = await page.evaluate(() => (window.__cm.state.layerItems || []).length);
  c.ok('通用：精度全关掉，图上就真的没有点了', nBefore > 0 && nOff === 0, JSON.stringify([nBefore, nOff]));
  await page.evaluate(() => {
    document.querySelectorAll('#p-levels input').forEach((cb) => { cb.checked = true; });
    document.getElementById('p-levels').dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(1200);
  const nBack = await page.evaluate(() => (window.__cm.state.layerItems || []).length);
  c.ok('通用：精度勾回来，点又回来了', nBack === nBefore, JSON.stringify([nBefore, nBack]));

  /* 通用之外的"筛选型"开关：只看有客户数据的点 —— 勾上以后图上只留客户数 > 1 的地点 */
  const beforeOnly = await page.evaluate(() => {
    const items = window.__cm.state.layerItems || [];
    return { n: items.length, singles: items.filter((x) => !(x.r.count > 1)).length };
  });
  await checkBox(page, 'p-onlycount', true);
  await page.waitForTimeout(1400);
  const afterOnly = await page.evaluate(() => {
    const items = window.__cm.state.layerItems || [];
    return { n: items.length, singles: items.filter((x) => !(x.r.count > 1)).length };
  });
  c.ok('只看有客户数据的点：勾上以后单个客户的地点不再画',
    /* 过滤是按"原始行"来的：客户数 <=1 的行先被砍掉，包含这些行的格子会一起消失，
       所以总数掉得比"单客户地点数"更多，这里只断言"再没有单客户地点"且总数确实变少。 */
    beforeOnly.singles > 0 && afterOnly.singles === 0 && afterOnly.n > 0 && afterOnly.n < beforeOnly.n,
    JSON.stringify({ 勾前: beforeOnly, 勾后: afterOnly }));
  await checkBox(page, 'p-onlycount', false);
  await page.waitForTimeout(1400);
  const backAll = await page.evaluate(() => (window.__cm.state.layerItems || []).length);
  c.ok('只看有客户数据的点：取消后点又回来', backAll === beforeOnly.n, JSON.stringify([beforeOnly.n, backAll]));

  // --- ⑨ 重置本页参数：回到默认，且不把画法换掉 ---
  const onDisplay = await page.evaluate(() => {
    const p = document.getElementById('panel');
    return !p.hidden && p.getAttribute('data-cur') === 'display';
  });
  if (!onDisplay) { await page.click('.mapnav .mn[data-panel="display"]'); }
  await page.waitForTimeout(200);
  await page.click('#btn-reset-params');
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => {
    const p = window.__cm.params;
    return { mode: p.mode, size: p.size, alpha: p.alpha, gridSize: p.gridSize, h3Res: p.h3Res,
      extrude: p.extrude, elev: p.extrudeScale, amb: p.lightAmb, heatR: p.heatRadius, heatI: p.heatIntensity,
      ramp: p.heatRamp, top: p.heatTopN, color: p.color, label: p.label,
      uiAlpha: document.getElementById('p-alpha').value, uiExtrude: document.getElementById('p-extrude').checked };
  });
  c.ok('重置本页参数：画法不动、参数回默认（控件的值也一起回）',
    after.mode === 'heat' && after.size === 14 && after.alpha === 85 && after.gridSize === 46 &&
    after.h3Res === 5 && after.extrude === false && after.elev === 30 && after.amb === 0.75 &&
    after.heatR === 28 && after.heatI === 1 && after.ramp === 'classic' && after.top === 30 &&
    after.color === 'quality' && after.label === false && after.uiAlpha === '85' && after.uiExtrude === false,
    JSON.stringify(after));
  const resetRows = await rowsVisible(page);
  c.ok('重置后仍只显示当前画法（热力）的参数',
    resetRows['热力半径'] === true && resetRows['格子大小'] === false && resetRows['柱子高度'] === false,
    JSON.stringify({ 热力半径: resetRows['热力半径'], 格子大小: resetRows['格子大小'] }));

  c.results.push({ name: '没有页面报错', pass: page.__errors.length === 0, detail: page.__errors.join(' | ') });
  await page.close();
  return c.results;
}
