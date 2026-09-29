/* 用「示例_订单数据.csv」重新生成插件商店用的三张预览图。
   只读脱敏示例数据，不依赖任何真实业务文件。
   用法：node _dev/_regen_plugin_shots.mjs                                */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PAGE = 'file:///' + path.join(ROOT, '打开地图.html').replace(/\\/g, '/');
const CSV = path.join(ROOT, '示例_订单数据.csv');
const OUT = path.join(ROOT, 'plugins', 'customer-address-map', 'assets');

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1500, height: 940 }, deviceScaleFactor: 1, colorScheme: 'light' });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

await page.goto(PAGE);
await page.waitForTimeout(1500);
await page.click('#btn-import');
await page.setInputFiles('#imp-file', CSV);
await page.waitForFunction(() => {
  const l = document.getElementById('loading'), s = document.getElementById('st-total');
  return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 400;
}, null, { timeout: 120000 });
await page.waitForTimeout(800);
await page.click('#btn-run');
await page.waitForFunction(() => {
  const b = document.getElementById('btn-run'), t = document.getElementById('st-todo');
  return b && b.textContent.indexOf('开始解析') === 0 && t && t.textContent.trim() === '0';
}, null, { timeout: 180000 });
await page.waitForTimeout(2500);

// ① 地图 · 热力图
await page.selectOption('#p-mode', 'heat');
await page.waitForTimeout(3000);
await page.screenshot({ path: path.join(OUT, 'screenshot1.png') });
console.log('① 地图热力图 OK');

// ② 解析分析页
await page.click('#viewswitch button[data-view="analysis"]');
await page.waitForFunction(() => document.querySelectorAll('#dash .kpi').length > 0, null, { timeout: 60000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: path.join(OUT, 'screenshot2.png') });
console.log('② 分析页 OK');

// ③ 地图 · 3D 六边形
await page.click('#viewswitch button[data-view="map"]');
await page.waitForTimeout(1200);
await page.selectOption('#p-mode', 'hex');
await page.waitForTimeout(1500);
await page.check('#p-extrude');
await page.waitForTimeout(3500);
await page.screenshot({ path: path.join(OUT, 'screenshot3.png') });
console.log('③ 3D 六边形 OK');

for (const f of ['screenshot1.png', 'screenshot2.png', 'screenshot3.png']) {
  const p = path.join(OUT, f);
  console.log(f, fs.statSync(p).size, 'bytes');
}
if (errors.length) { console.log('页面报错:', errors.join(' | ')); process.exitCode = 1; }
await browser.close();

