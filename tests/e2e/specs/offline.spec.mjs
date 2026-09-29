import { openApp, checker, ROOT } from '../lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

export const name = '离线可用 / Excel 本地加载 · 无网络导入';

/* 这个工具最值钱的特性是"双击就能用、数据不出本机、不需要任何密钥"。
   所以"能不能断网使用"必须是一条被钉住的断言，而不是一句口号。

   这条用例故意把**所有外部请求都掐断**再导 Excel：
   以前 Excel 组件是从 cdn.jsdelivr.net 拉的，这条会直接失败；
   现在它是本地打包的，断网照样导。—— 改回 CDN 的话这里会立刻变红。 */
const XLSX_FILE = path.join(ROOT, 'tests', 'fixtures', 'orders.xlsx');

export default async function run(browser) {
  const c = checker();

  // 静态检查：产物本身不能依赖任何 CDN
  const html = fs.readFileSync(path.join(ROOT, '打开地图.html'), 'utf8');
  const cdn = html.match(/https?:\/\/[^"'\s>]+/);
  c.ok('产物 HTML 里没有外部链接', !cdn, cdn ? cdn[0] : '');
  c.ok('Excel 组件已本地打包', fs.existsSync(path.join(ROOT, 'vendor', 'xlsx', 'xlsx.full.min.js')));
  c.ok('deck.gl 已本地打包', fs.existsSync(path.join(ROOT, 'vendor', 'deckgl', 'deck.gl.min.js')));

  const page = await openApp(browser);
  const blocked = [];
  await page.route(/^https?:\/\//, (route) => {
    blocked.push(route.request().url());
    route.abort();
  });

  await page.click('#btn-import');
  await page.setInputFiles('#imp-file', XLSX_FILE);
  await page.waitForFunction(() => {
    const l = document.getElementById('loading');
    const s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) >= 5;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(900);

  const got = await page.evaluate(() => {
    const rows = window.__cm.state.rows;
    const scripts = Array.from(document.scripts).map((s) => s.getAttribute('src') || '').filter(Boolean);
    return {
      n: rows.length,
      total: document.getElementById('st-total').textContent,
      first: { raw: rows[0].raw, count: rows[0].count, plat: rows[0].plat, t: rows[0].t },
      xlsxLoaded: !!window.XLSX,
      xlsxSrc: scripts.filter((u) => /xlsx/i.test(u))
    };
  });

  c.eq('断网状态下 Excel 导入成功', got.n, 5);
  c.ok('Excel 组件确实被加载了', got.xlsxLoaded, JSON.stringify(got.xlsxSrc));
  c.ok('组件是从本地 vendor 路径加载的', got.xlsxSrc.some((u) => /^vendor\/xlsx\//.test(u)), JSON.stringify(got.xlsxSrc));
  c.ok('表头识别正确（客户数 / 平台 / 时间）',
    got.first.count === 3 && got.first.plat === '京东' && typeof got.first.t === 'number',
    JSON.stringify(got.first));

  // 底图瓦片本来就该联网取，这里只要求"没有别的外部请求"
  const external = blocked.filter((u) => !/autonavi\.com/.test(u));
  c.ok('除了底图瓦片，没有向任何外部地址发请求', external.length === 0, JSON.stringify(external.slice(0, 5)));

  c.results.push({ name: '没有页面报错', pass: page.__errors.length === 0, detail: page.__errors.join(' | ') });
  await page.close();

  /* 诊断页是给用户双击用的产物，以前一直没人测，结果它停留在"百度引擎"时代、
     给出完全错误的结论。这里把它也钉住：自查必须全部通过。 */
  const diag = await browser.newPage();
  const diagErrs = [];
  diag.on('pageerror', (e) => diagErrs.push(e.message));
  await diag.goto('file:///' + path.join(ROOT, '诊断.html').replace(/\\/g, '/'));
  await diag.waitForFunction(
    () => !/正在检查/.test(document.getElementById('verdict').textContent),
    null, { timeout: 90000 });
  const d = await diag.evaluate(() => ({
    verdict: document.getElementById('verdict').textContent,
    bad: Array.from(document.querySelectorAll('.row.bad')).map((r) => r.querySelector('.label').textContent),
    labels: Array.from(document.querySelectorAll('.row .label')).map((x) => x.textContent)
  }));
  c.ok('诊断页自查全部通过', d.bad.length === 0 && /全部正常/.test(d.verdict),
    JSON.stringify({ verdict: d.verdict, bad: d.bad }));
  c.ok('诊断页真的跑了离线解析和渲染',
    d.labels.some((x) => /离线地址解析/.test(x)) && d.labels.some((x) => /实际渲染测试/.test(x)),
    JSON.stringify(d.labels));
  c.ok('诊断页没有报错', diagErrs.length === 0, diagErrs.join(' | '));
  await diag.close();

  return c.results;
}
