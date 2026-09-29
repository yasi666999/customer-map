/* 端到端测试的公共部分：
   一个浏览器实例，每个用例开一个干净的页面、导入一次数据，跑完断言收工。 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { ensureFixtureCsv } from './fixture-data.mjs';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const PAGE_URL = 'file:///' + path.join(ROOT, '打开地图.html').replace(/\\/g, '/');
/* 默认测试数据：本机有真实聚合表就用它；没有（clone 下来也能跑）就用按需生成的
   脱敏示例聚合表，字段口径完全一致。 */
const BIG_CSV = path.join(ROOT, '汇总_按区县_三维.csv');
export const CSV = fs.existsSync(BIG_CSV) ? BIG_CSV : ensureFixtureCsv();

export async function launch() {
  return chromium.launch({ channel: 'msedge' });
}

/* 起一个本地静态服务，用来跑"需要 Worker + wasm"的用例。
   file:// 下浏览器不给 Worker 取 wasm，DuckDB 引擎起不来 —— 也就是说
   SQL 通道在 file:// 下**永远测不到**。这条通道以前就是这么漏掉的：
   我们改过它好几次，全靠肉眼。 */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.wasm': 'application/wasm', '.csv': 'text/csv; charset=utf-8'
};
export async function startServer() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(String(req.url || '/').split('?')[0]);
    if (url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const file = path.join(ROOT, url.replace(/^\/+/, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('404'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    url: 'http://127.0.0.1:' + port + '/' + encodeURIComponent('打开地图.html'),
    close: () => new Promise((r) => server.close(r))
  };
}

export async function openApp(browser, opts = {}) {
  const page = await browser.newPage({
    viewport: { width: opts.width || 1560, height: opts.height || 950 },
    colorScheme: opts.dark ? 'dark' : 'light'
  });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message + ' @ ' + String(e.stack || '').split('\n')[1]?.trim()));
  page.on('console', m => {
    const t = m.text();
    // 断网用例会故意把网络全断掉，这时底图瓦片取不到是预期内的，
    // 只看是不是来自地图组件的取图失败，避免把这类噪音算成页面错误。
    const fromMapBundle = /deck\.gl\.min\.js/.test(m.location()?.url || '');
    if (m.type() === 'error' && !/ERR_FAILED/.test(t) && !(fromMapBundle && /Failed to fetch|NetworkError|ERR_FAILED/.test(t))) {
      errors.push('CONSOLE ' + t);
    }
  });
  await page.goto(opts.url || PAGE_URL);
  await page.waitForTimeout(900);
  page.__errors = errors;
  return page;
}

export async function importCsv(page, csv = CSV) {
  await page.click('#btn-import');
  await page.setInputFiles('#imp-file', csv);
  await page.waitForFunction(() => {
    const l = document.getElementById('loading');
    const s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 1000;
  }, null, { timeout: 600000 });
  await page.waitForTimeout(1200);
}

/* 极简断言收集器：一个用例里可以放很多条检查，最后统一汇报 */
export function checker() {
  const results = [];
  return {
    ok(name, cond, detail) {
      results.push({ name, pass: !!cond, detail: detail === undefined ? '' : String(detail) });
    },
    eq(name, actual, expected) {
      results.push({ name, pass: actual === expected, detail: '得到 ' + JSON.stringify(actual) + '，期望 ' + JSON.stringify(expected) });
    },
    results
  };
}
