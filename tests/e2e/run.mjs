/* 端到端测试入口：npm run test:e2e
   一次启动浏览器，依次跑所有用例，最后给一张汇总表。 */
import { launch } from './lib.mjs';
import * as importSpec from './specs/import.spec.mjs';
import * as mapSpec from './specs/map.spec.mjs';
import * as chartsSpec from './specs/charts.spec.mjs';
import * as timelineSpec from './specs/timeline.spec.mjs';
import * as analysisSpec from './specs/analysis.spec.mjs';
import * as pbiSpec from './specs/pbi.spec.mjs';
import * as regionSpec from './specs/region.spec.mjs';
import * as matrixSpec from './specs/matrix.spec.mjs';
import * as coreSpec from './specs/core.spec.mjs';
import * as panelSpec from './specs/panel.spec.mjs';
import * as hexSpec from './specs/hex.spec.mjs';
import * as rowShapeSpec from './specs/rowshape.spec.mjs';
import * as deckSpec from './specs/deck.spec.mjs';
import * as offlineSpec from './specs/offline.spec.mjs';
import * as sqlSpec from './specs/sql.spec.mjs';
import * as httpSpec from './specs/http.spec.mjs';

const SPECS = [importSpec, rowShapeSpec, mapSpec, panelSpec, chartsSpec, timelineSpec, analysisSpec, pbiSpec, matrixSpec, coreSpec, hexSpec, regionSpec, offlineSpec, sqlSpec, httpSpec, deckSpec];
const only = process.argv[2];

const t0 = Date.now();
const browser = await launch();
let pass = 0, fail = 0;
const failed = [];

for (const spec of SPECS) {
  if (only && spec.name.indexOf(only) < 0) { continue; }
  const s0 = Date.now();
  process.stdout.write('▶ ' + spec.name + ' ... ');
  try {
    const results = await spec.default(browser);
    const bad = results.filter(r => !r.pass);
    pass += results.length - bad.length;
    fail += bad.length;
    console.log(bad.length ? '✗' : '✓', '(' + results.length + ' 项 / ' + ((Date.now() - s0) / 1000).toFixed(1) + 's)');
    bad.forEach(b => failed.push({ spec: spec.name, name: b.name, detail: b.detail }));
  } catch (e) {
    fail++;
    console.log('✗ 异常');
    failed.push({ spec: spec.name, name: '用例执行失败', detail: String(e).slice(0, 200) });
  }
}
await browser.close();

console.log('');
console.log('──────── 结果 ────────');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项，用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
if (failed.length) {
  console.log('');
  failed.forEach(f => console.log('  ✗ [' + f.spec + '] ' + f.name + (f.detail ? ' — ' + f.detail : '')));
}
process.exit(fail ? 1 : 0);
