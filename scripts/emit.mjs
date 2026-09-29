/* 构建收尾：
   1) 把 dist/app.js 复制成项目根目录的 app.js（经典脚本，file:// 可直接加载）
   2) 用 dev.html 生成 index.html 与 打开地图.html
   3) 把静态资源也复制进 dist/，让 dist 成为一个可直接部署（也能跑 Worker）的完整目录
   源码在 src/ 下模块化，用户侧依然是"双击 HTML 就能用"。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const distApp = path.join(dist, 'app.js');
if (!fs.existsSync(distApp)) {
  console.error('没有找到 dist/app.js，请先运行 vite build');
  process.exit(1);
}
const code = fs.readFileSync(distApp);
fs.writeFileSync(path.join(root, 'app.js'), code);

const ver = crypto.createHash('sha1').update(code).digest('hex').slice(0, 8);
let html = fs.readFileSync(path.join(root, 'dev.html'), 'utf8');
html = html.replace('<script type="module" src="/src/main.js"></script>',
  '<script src="app.js?v=' + ver + '"></script>');
html = html.replace(/<span class="ver" id="ver">[^<]*<\/span>/, '<span class="ver" id="ver">v28</span>');
html = html.replace('</head>', '<link rel="stylesheet" href="ui.css?v=' + ver + '">\n</head>');

fs.writeFileSync(path.join(root, 'index.html'), html);
fs.writeFileSync(path.join(root, '打开地图.html'), html);
fs.writeFileSync(path.join(dist, 'index.html'), html);
fs.writeFileSync(path.join(dist, '打开地图.html'), html);

/* dist 里也要有样式、地址库、边界包、Worker，才能独立部署 */
/* Vite 把 React 岛用的 Tailwind 单独产出成 dist/ui.css，也搬到根目录 */
const uiCss = path.join(dist, 'ui.css');
if (fs.existsSync(uiCss)) { fs.copyFileSync(uiCss, path.join(root, 'ui.css')); }

const STATIC = ['styles.css', 'ui.css', 'address-clean.js', 'geo-data.js', 'local-geocode.js',
  'geo-boundary-p.js', 'geo-boundary-c.js', 'geo-boundary-d.js', 'geocode-worker.js', '诊断.html'];
let copied = 0;
STATIC.forEach(function (f) {
  const src = path.join(root, f);
  if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(dist, f)); copied++; }
});

/* deck.gl 是本地打包的经典脚本（vendor/deckgl/deck.gl.min.js），
   不走 npm 依赖 —— 它是 2MB 的 UMD 包，塞进 IIFE 产物会让增量构建变慢，
   而且它自己会按需创建 worker，独立成文件更稳。dist 里要一起带上。 */
(function copyVendor() {
  const srcDir = path.join(root, 'vendor');
  if (!fs.existsSync(srcDir)) { return; }
  fs.cpSync(srcDir, path.join(dist, 'vendor'), { recursive: true });
})();

console.log('已生成 app.js（' + (code.length / 1024).toFixed(0) + ' KB, v' + ver + '）、index.html、打开地图.html');
/* DuckDB 的 wasm 与 worker 也要进 dist，离线自包含 */
const vendorSrc = path.join(root, 'vendor', 'duckdb');
const vendorDst = path.join(dist, 'vendor', 'duckdb');
if (fs.existsSync(vendorSrc)) {
  fs.mkdirSync(vendorDst, { recursive: true });
  fs.readdirSync(vendorSrc).forEach(function (f) {
    fs.copyFileSync(path.join(vendorSrc, f), path.join(vendorDst, f));
    copied++;
  });
}
console.log('dist/ 已就绪：+' + copied + ' 个静态资源（含 DuckDB wasm，可离线部署）');
