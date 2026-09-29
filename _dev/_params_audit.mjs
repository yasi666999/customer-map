import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errs = [];
page.on('pageerror', e => errs.push(String(e.message).slice(0, 150)));
await page.goto('file:///D:/codex1/customer-map/打开地图.html');
await page.waitForTimeout(2500);
await page.click('#btn-import');
await page.setInputFiles('#imp-file', 'D:/codex1/customer-map/汇总_按区县_三维.csv');
await page.waitForFunction(() => { const l=document.getElementById('loading'), s=document.getElementById('st-total');
  return l && l.hidden && s && parseInt((s.textContent||'0').replace(/,/g,''),10) > 1000; }, null, { timeout: 600000 });
await page.waitForTimeout(5000);
const ids = () => page.evaluate(() => (window.__cmDeck.props.layers || []).map(l => l.id));
const out = {};

// 1) 客户点图层开关
await page.click('.mapnav .mn[data-panel="layers"]'); await page.waitForTimeout(300);
await page.evaluate(() => { const c = document.getElementById('L-points'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(1800);
out['关掉客户点后没有 pts 图层'] = !(await ids()).includes('pts');
await page.evaluate(() => { const c = document.getElementById('L-points'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(1800);
out['打开后又回来了'] = (await ids()).includes('pts');

// 2) 按客户数定大小（看 updateTriggers 里有没有 sizeByCount）
await page.click('.mapnav .mn[data-panel="display"]'); await page.waitForTimeout(300);
const sizeOff = await page.evaluate(() => {
  const l = (window.__cmDeck.props.layers || []).filter(x => x.id === 'pts')[0];
  return { 触发器: JSON.stringify(l.props.updateTriggers), 半径1: l.props.getRadius({ r: { count: 1 } }), 半径大: l.props.getRadius({ r: { count: 5000 } }) };
});
out['按客户数定大小'] = { ...sizeOff, 不同: sizeOff.半径1 !== sizeOff.半径大 };

// 3) 自动降级：把阈值调到 10，点图层应当变成网格
await page.evaluate(() => { window.__cm.params.lodMax = 10; window.__cm.setMode('point'); });
await page.waitForTimeout(2500);
const auto = await page.evaluate(() => ({ ids: (window.__cmDeck.props.layers || []).map(l => l.id), layer: window.__cmLayer, 图例: document.getElementById('ml-body').textContent.slice(0, 40) }));
out['点太密自动降级'] = auto;
await page.evaluate(() => { window.__cm.params.lodMax = 9000; window.__cm.setMode('point'); });
await page.waitForTimeout(2000);

// 4) 热力图配色 + top N 标注
await page.selectOption('#p-mode', 'heat'); await page.waitForTimeout(2500);
const heat = await page.evaluate(() => {
  const l = (window.__cmDeck.props.layers || []).filter(x => x.id === 'heat')[0];
  const top = (window.__cmDeck.props.layers || []).filter(x => x.id === 'heat-top')[0];
  return { 有配色: !!(l && l.props.colorRange && l.props.colorRange.length), 首色: l && l.props.colorRange && l.props.colorRange[0],
    有TopN: !!top, TopN条数: top ? top.props.data.length : 0, TopN文本: top ? top.props.getText(top.props.data[0]) : null };
});
out['热力图配色与TopN'] = heat;

console.log(JSON.stringify({ ...out, errs }, null, 1));
await browser.close();
