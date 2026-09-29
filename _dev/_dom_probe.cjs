const { chromium } = require('C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\playwright');
const PAGE = 'file:///D:/codex1/customer-map/index.html';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(PAGE); await page.waitForTimeout(2000);
  const out = await page.evaluate(() => {
    const m = document.getElementById('map');
    function tree(el, d) {
      if (d > 3) return null;
      return { tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 40),
        kids: Array.from(el.children).slice(0, 6).map(k => tree(k, d + 1)).filter(Boolean) };
    }
    return {
      globals: { BMAP_NORMAL_MAP: typeof window.BMAP_NORMAL_MAP, BMAP_SATELLITE_MAP: typeof window.BMAP_SATELLITE_MAP,
        BMAP_EARTH_MAP: typeof window.BMAP_EARTH_MAP, BMAP_HYBRID_MAP: typeof window.BMAP_HYBRID_MAP },
      mapApi: ['setMapType', 'setMapStyleV2', 'setDisplayOptions', 'setTilt', 'getTilt', 'setHeading', 'setMapStyle']
        .filter(k => typeof window.__cmMap[k] === 'function'),
      tilt: window.__cmMap.getTilt ? window.__cmMap.getTilt() : null,
      dom: tree(m, 0),
      canvases: document.querySelectorAll('#map canvas').length
    };
  });
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
