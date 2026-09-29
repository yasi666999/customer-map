#!/usr/bin/env node
/* 把小程序本体 + 聚合好的数据拼成一个"双击就能用"的文件夹
 *
 * 用法：
 *   node make-bundle.mjs --data <汇总.csv> [--data <再来一份.csv>...] --out <输出目录> [--name "客户地址地图"]
 *   node make-bundle.mjs --help
 *
 * 产物：<输出目录>/<name>/  里面是 打开地图.html + 程序文件 + 数据 csv + 使用说明.txt
 * 为什么要有这一步：assets/app 里的 html 依赖同目录的 js/vendor，
 * 单独把 html 拷给用户是打不开的 —— 必须整个目录一起给。
 */
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const APP = path.join(HERE, '..', 'assets', 'app');

function usage() {
  console.log([
    '用法：node make-bundle.mjs --data <汇总.csv> [--data <再一份.csv>...] --out <输出目录> [--name "客户地址地图"]',
    '',
    '  --data  聚合工具产出的汇总 csv（可以给多次）',
    '  --out   写到哪个目录下（会在里面新建 --name 那个文件夹）',
    '  --name  文件夹名，默认「客户地址地图」',
    '  --force 目标文件夹已存在时先清空'
  ].join('\n'));
}
const argv = process.argv.slice(2);
if (!argv.length || argv.indexOf('--help') >= 0) { usage(); process.exit(argv.length ? 0 : 1); }
const datas = [];
for (let i = 0; i < argv.length; i++) { if (argv[i] === '--data' && argv[i + 1]) { datas.push(argv[i + 1]); } }
const outArg = argv[argv.indexOf('--out') + 1] || '';
const name = argv.indexOf('--name') >= 0 ? argv[argv.indexOf('--name') + 1] : '客户地址地图';
const force = argv.indexOf('--force') >= 0;
if (!datas.length) { usage(); console.error('\n缺少 --data'); process.exit(1); }
if (!outArg) { usage(); console.error('\n缺少 --out'); process.exit(1); }
for (const d of datas) { if (!fs.existsSync(d)) { console.error('找不到数据文件：' + d); process.exit(1); } }

const target = path.join(path.resolve(outArg), name);
if (fs.existsSync(target)) {
  if (!force) { console.error('目标已存在：' + target + '（加 --force 覆盖）'); process.exit(1); }
  fs.rmSync(target, { recursive: true, force: true });
}
fs.mkdirSync(target, { recursive: true });
fs.cpSync(APP, target, { recursive: true });
for (const d of datas) { fs.copyFileSync(d, path.join(target, path.basename(d))); }

/* 使用说明：不同数据集不一样的部分（有哪些表、多少行）当场写进去 */
const files = datas.map((d) => ({ name: path.basename(d), lines: fs.readFileSync(d, 'utf8').split('\n').filter(Boolean).length - 1 }));
const readme = [
  '客户地址地图 —— 使用说明',
  '========================================',
  '',
  '【怎么打开】双击「打开地图.html」。不需要装东西、不需要联网、不需要密钥，',
  '数据全程在本机，不会上传。',
  '',
  '【导入哪一份】',
  ...files.map((f) => '  ' + f.name + '   ' + f.lines.toLocaleString() + ' 行'),
  '  （行数少的那份先导入，秒开；要按店铺分析就用带"店铺"的那份）',
  '',
  '【能看什么】',
  '  · 六种画法：标记点 / 点聚合 / 网格 / 六边形 / 分层着色 / 热力图',
  '  · 时间轴（可拖拽选时间段）、平台筛选、地区钻取、店铺分布',
  '  · 分析页有「客户画像（粗）」：按人均单量分四档（一次性为主 / 复购型 / 高频复购 / 重度客户）',
  '  · 常驻地址 + 辐射圈 + 连线：用来判断"这个客户离我多远、先跑哪一片"',
  '',
  '【断网了底图是空的？】',
  '  在线底图取不到时，点左上「图层」把底图切成「本地边界（免密钥）」，边界和客户分布照样清楚。',
  '',
  '【口径提醒】',
  '  · 客户数 = 同一地点同一维度下去重后的号码数（不是订单行数）',
  '  · 卡片上的比率是"分组平均口径"；全站唯一客户的口径看聚合时打印的数据体检',
  '',
  '【想换数据】用 skill 的 scripts/aggregate.js 重新聚合一份，再放进这个文件夹导入即可。',
  ''
].join('\r\n');
fs.writeFileSync(path.join(target, '使用说明.txt'), '\uFEFF' + readme);

let bytes = 0, count = 0;
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); } else { bytes += fs.statSync(p).size; count++; }
  }
})(target);
console.log('');
console.log('  打包完成：' + target);
console.log('  文件 ' + count + ' 个，共 ' + (bytes / 1048576).toFixed(1) + ' MB');
console.log('  双击里面的「打开地图.html」就能用。');
