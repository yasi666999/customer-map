#!/usr/bin/env node
/* 自检：这个 skill 装好之后到底能不能用。
   三件事，全都不需要联网、不需要浏览器：
     1) 应用资产齐全（打开地图.html 引用的每个本地文件都在）
     2) 用 examples 里的 40 行样例跑一遍 aggregate.js，产物列名/行数/口径对不对
     3) 用 make-bundle.mjs 拼一个分发包，确认"双击就能用"的那些文件都在
   用法：node selfcheck.mjs
   退出码 0 = 全过；非 0 = 有硬问题，别把它交付给用户 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const HERE = import.meta.dirname;
const ROOT = path.join(HERE, '..');
const APP = path.join(ROOT, 'assets', 'app');
const EX = path.join(ROOT, 'examples', 'mini-orders.csv');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cam-selfcheck-'));

let fail = 0, pass = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + '  ' + (detail || '')); }
};

console.log('\n0) SKILL.md 与 agents/openai.yaml');
{
  /* 格式自检（不依赖 Python/PyYAML）：frontmatter 齐全、name 与目录同名、没有占位符 */
  const md = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const nameLine = fm ? (fm[1].match(/^name:\s*(.+)$/m) || [])[1] : '';
  const descLine = fm ? (fm[1].match(/^description:\s*(.+)$/m) || [])[1] : '';
  ok('SKILL.md 有 frontmatter', !!fm);
  ok('name 与目录名一致', String(nameLine).trim() === path.basename(ROOT), String(nameLine).trim() + ' vs ' + path.basename(ROOT));
  ok('description 说清了"什么时候用"', !!descLine && descLine.length > 60, (descLine || '').slice(0, 40) + '…');
  ok('没有留下占位符', !/\bTODO\b|\bXXX\b|\[待填\]/.test(md));
  const yml = fs.readFileSync(path.join(ROOT, 'agents', 'openai.yaml'), 'utf8');
  ok('openai.yaml 有 display_name / default_prompt',
    /display_name:/.test(yml) && /default_prompt:.*\$customer-address-map/.test(yml), '');
  ok('参考文件都在', ['schema.md', 'metrics.md', 'troubleshooting.md']
    .every((f) => fs.existsSync(path.join(ROOT, 'references', f))));
}

console.log('\n1) 应用资产');
ok('打开地图.html 存在', fs.existsSync(path.join(APP, '打开地图.html')));
ok('app.js / styles.css / ui.css 都在', ['app.js', 'styles.css', 'ui.css'].every((f) => fs.existsSync(path.join(APP, f))));
ok('地图引擎 vendor/deckgl 在', fs.existsSync(path.join(APP, 'vendor', 'deckgl', 'deck.gl.min.js')));
ok('本地地名库 / 边界包在', ['geo-data.js', 'local-geocode.js', 'address-clean.js', 'geo-boundary-p.js', 'geo-boundary-c.js', 'geo-boundary-d.js']
  .every((f) => fs.existsSync(path.join(APP, f))));
/* html 里引用的本地文件必须都存在 —— 少一个就是"客户双击后白屏" */
const html = fs.readFileSync(path.join(APP, '打开地图.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
  .filter((u) => !/^https?:|^data:|^#/.test(u)).map((u) => u.split('?')[0]);
const missing = refs.filter((u) => !fs.existsSync(path.join(APP, u)));
ok('html 引用的本地文件齐全（' + refs.length + ' 个）', missing.length === 0, missing.join(', '));

console.log('\n2) 聚合脚本（40 行样例）');
const outDir = path.join(TMP, 'out');
execFileSync(process.execPath, [path.join(HERE, 'aggregate.js'), '--input', EX, '--out', outDir], { stdio: 'pipe' });
const agg = path.join(outDir, '汇总_按城市_三维.csv');
ok('产出 汇总_按城市_三维.csv', fs.existsSync(agg));
const lines = fs.readFileSync(agg, 'utf8').split('\n').filter(Boolean);
const head = lines[0].replace(/^\uFEFF/, '').split(',');
ok('表头含客户数/订单数/画像三列', ['客户数', '订单数', '复购客户数', '高频客户数', '活跃客户数'].every((c) => head.indexOf(c) >= 0), head.join('|'));
ok('聚合行数合理（>10 且 < 源行数）', lines.length - 1 > 10 && lines.length - 1 < 40, String(lines.length - 1));
const first = lines[1].split(',');
const iCust = head.indexOf('客户数');
ok('客户数都是正整数', lines.slice(1).every((l) => Number(l.split(',')[iCust]) > 0));
const anyRep = lines.slice(1).some((l) => Number(l.split(',')[head.indexOf('复购客户数')]) > 0);
ok('复购客户数有非零值（画像算出来了）', anyRep);

console.log('\n3) 分发包');
const bundleOut = path.join(TMP, 'dist');
execFileSync(process.execPath, [path.join(HERE, 'make-bundle.mjs'), '--data', agg, '--out', bundleOut, '--name', '自检包'], { stdio: 'pipe' });
const bundle = path.join(bundleOut, '自检包');
ok('分发包里有 打开地图.html', fs.existsSync(path.join(bundle, '打开地图.html')));
ok('分发包里有 app.js 与 vendor', fs.existsSync(path.join(bundle, 'app.js')) && fs.existsSync(path.join(bundle, 'vendor', 'deckgl', 'deck.gl.min.js')));
ok('分发包里有数据文件', fs.existsSync(path.join(bundle, '汇总_按城市_三维.csv')));
ok('分发包里有 使用说明.txt', fs.existsSync(path.join(bundle, '使用说明.txt')));

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项\n');
process.exit(fail ? 1 : 0);
