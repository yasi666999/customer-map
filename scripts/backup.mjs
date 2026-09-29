/* 改动前的自动快照。
   背景：这个项目改一次要动 5000 行的主文件，用字符串替换很容易误删代码
   （已经有两次误删 buildAnalysisModelSql / sqlWhere 的教训）。
   每次跑 npm test 之前自动把 src/ 快照一份，出问题能直接对照还原。
   只保留最近 10 份。 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const srcDir = path.join(root, 'src');
const backupRoot = path.join(root, '_backup');
const KEEP = 10;

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) { copyDir(a, b); } else { fs.copyFileSync(a, b); }
  }
}

if (!fs.existsSync(srcDir)) { console.log('没有 src/ 目录，跳过备份'); process.exit(0); }
fs.mkdirSync(backupRoot, { recursive: true });

const name = stamp();
const dest = path.join(backupRoot, name);
copyDir(srcDir, dest);

let files = 0, bytes = 0;
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); } else { files++; bytes += fs.statSync(p).size; }
  }
})(dest);

/* 只留最近 KEEP 份 */
const all = fs.readdirSync(backupRoot).filter(n => /^\d{8}-\d{6}$/.test(n)).sort();
all.slice(0, Math.max(0, all.length - KEEP)).forEach(n => {
  fs.rmSync(path.join(backupRoot, n), { recursive: true, force: true });
});

console.log('已快照 src/ → _backup/' + name + '（' + files + ' 个文件，' + (bytes / 1024).toFixed(0) + ' KB，保留最近 ' + KEEP + ' 份）');
