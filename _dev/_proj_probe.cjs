const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
const PAGE = 'file:///D:/codex1/customer-map/index.html';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(PAGE); await page.waitForTimeout(1500);
  const out = await page.evaluate(async () => {
    const m = window.__cmMap; const B = window.BMapGL; const el = document.getElementById('map');
    const res = {};
    res.canvas = { w: el.clientWidth, h: el.clientHeight };
    m.centerAndZoom(new B.Point(116.404, 39.915), 12);
    await new Promise(r => setTimeout(r, 600));
    const c = m.getCenter();
    res.centerAtTiananmen = [c.lng, c.lat];
    const px = m.pointToPixel(new B.Point(116.404, 39.915));
    res.pixelOfCenter = [px.x, px.y];
    res.expectCenterPixel = [el.clientWidth / 2, el.clientHeight / 2];
    // 用两个锚点反推每度像素，并验证线性投影的误差
    const p0 = m.pointToPixel(new B.Point(116.0, 39.5));
    const pL = m.pointToPixel(new B.Point(116.5, 39.5));
    const pB = m.pointToPixel(new B.Point(116.0, 39.0));
    const sx = (pL.x - p0.x) / 0.5, sy = (p0.y - pB.y) / 0.5;
    res.pxPerDeg = [sx, sy];
    // 检验：任意点用线性公式预测 vs 真实 pointToPixel
    const tests = [[116.3, 39.7], [116.7, 39.3], [115.8, 40.1], [117.0, 39.0]];
    res.affineErr = tests.map(function (t) {
      const real = m.pointToPixel(new B.Point(t[0], t[1]));
      const ex = p0.x + (t[0] - 116.0) * sx, ey = p0.y - (t[1] - 39.5) * sy;
      return [ +(real.x - ex).toFixed(2), +(real.y - ey).toFixed(2) ];
    });
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
