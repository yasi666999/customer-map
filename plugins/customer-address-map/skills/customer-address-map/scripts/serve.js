#!/usr/bin/env node
/* 可选的本地静态服务。file:// 下浏览器不给用 Worker，
   走 http://localhost 时后台解析线程能起来，几十万行导入更顺。
   用法：node serve.js [--dir <目录>] [--port 5173]
        默认服务 assets/app（也就是小程序本体所在目录）。 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const argv = process.argv.slice(2);
const argOf = (n) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : '');
if (argv.indexOf('--help') >= 0) {
  console.log('用法：node serve.js [--dir <目录>] [--port 5173]');
  process.exit(0);
}
const ROOT = path.resolve(argOf('--dir') || path.join(HERE, '..', 'assets', 'app'));
const PORT = Number(argOf('--port')) || 5173;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8'
};
http.createServer((req, res) => {
  let url = decodeURIComponent(String(req.url || '/').split('?')[0]);
  if (url === '/') { url = '/打开地图.html'; }
  const file = path.join(ROOT, url.replace(/^\/+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 ' + url);
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log('客户地址地图：http://localhost:' + PORT + '/  （目录 ' + ROOT + '）');
});
