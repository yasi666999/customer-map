const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
const PAGE = 'file:///D:/codex1/customer-map/index.html';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(PAGE); await page.waitForTimeout(1500);
  const out = await page.evaluate(async () => {
    const m = window.__cmMap, B = window.BMapGL, el = document.getElementById('map');
    const res = { container: [el.clientWidth, el.clientHeight] };
    res.mapSizeBefore = m.getSize ? [m.getSize().width, m.getSize().height] : null;
    m.resize();
    await new Promise(r => setTimeout(r, 400));
    res.mapSizeAfter = m.getSize ? [m.getSize().width, m.getSize().height] : null;

    m.centerAndZoom(new B.Point(116.404, 39.915), 12);
    await new Promise(r => setTimeout(r, 900));
    const px = m.pointToPixel(new B.Point(116.404, 39.915));
    res.centerPixel = [Math.round(px.x), Math.round(px.y)];
    const c = m.getCenter();
    res.getCenter = [ +c.lng.toFixed(5), +c.lat.toFixed(5) ];
    const pxOfGetCenter = m.pointToPixel(c);
    res.pixelOfGetCenter = [Math.round(pxOfGetCenter.x), Math.round(pxOfGetCenter.y)];

    // 正确的仿射：北纬增大 -> y 变小
    const p0 = m.pointToPixel(new B.Point(116.0, 39.5));
    const pL = m.pointToPixel(new B.Point(116.5, 39.5));
    const pB = m.pointToPixel(new B.Point(116.0, 39.0));
    const sx = (pL.x - p0.x) / 0.5;
    const syDown = (pB.y - p0.y) / 0.5;
    res.pxPerDeg = [ +sx.toFixed(3), +syDown.toFixed(3) ];
    const tests = [[115.0, 39.0], [117.5, 40.5], [113.0, 38.0], [120.0, 41.0]];
    res.affineErrPx = tests.map(function (t2) {
      const real = m.pointToPixel(new B.Point(t2[0], t2[1]));
      const ex = p0.x + (t2[0] - 116.0) * sx;
      const ey = p0.y + (t2[1] - 39.5) * (-syDown) * -1;  // lat up -> y down negative
      return [ +(real.x - ex).toFixed(2), +(real.y - (p0.y - (t2[1] - 39.5) * syDown)).toFixed(2) ];
    });
    // 当前缩放级别下 1 像素 = 多少度
    res.degPerPx = [ +(1 / sx).toFixed(6), +(1 / syDown).toFixed(6) ];
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
