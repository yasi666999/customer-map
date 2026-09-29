/* 接线自检：模块声明要用 ctx 里的哪些东西，main.js 就得把哪些传进去。
   ------------------------------------------------------------------
   为什么要有这个检查：拆 main.js 的时候踩过两次同一类坑 ——
   模块的 ctx 少传一项，类型检查查不出来（ctx 是 any），页面能打开、
   大部分功能正常，只有点到那个按钮才炸（"xxx is not a function"）。
   两次都是靠端到端用例才发现的。这个脚本把这类问题提前到构建前。

   还有一类坑它也能看出来：模块里如果有个局部变量也叫 ctx（比如 canvas 的
   2d 上下文），会盖住 factory 的 ctx —— 这里会报"疑似被覆盖"。 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');

/* main.js 里都有 createXxx({ ... }) 这种工厂调用 */
const calls = [...main.matchAll(/var\s+([A-Za-z_$][\w$]*)\s*=\s*(create[A-Za-z0-9_]+)\(\{/g)];
let problems = 0;

for (const c of calls) {
  const fn = c[2];
  // 找出工厂实现文件：扫描 src/ 下的 .js（跳过 main.js 自己）
  const candidates = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); }
      else if (e.name.endsWith('.js')) { candidates.push(p); }
    }
  })(path.join(root, 'src'));
  const file = candidates.find((p) => p !== path.join(root, 'src', 'main.js')
    && new RegExp('export function ' + fn + '\\s*\\(').test(fs.readFileSync(p, 'utf8')));
  if (!file) { continue; }

  const mod = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file).replace(/\\/g, '/');

  // 调用处传进去的键
  const start = main.indexOf(c[0]);
  const end = main.indexOf('\n  });', start);
  const call = main.slice(start, end);
  const provided = new Set([...call.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1]));

  // 模块声明里用到的键
  const needed = new Set([...mod.matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));

  const missing = [...needed].filter((k) => !provided.has(k)).sort();
  if (missing.length) {
    problems++;
    console.error('✗ ' + rel + ' 需要的 ctx 没传：' + missing.join(', '));
  }

  // 局部变量盖住 ctx
  const shadow = [...mod.matchAll(/^\s*(?:var|let|const)\s+ctx\s*=/gm)];
  if (shadow.length) {
    problems++;
    console.error('✗ ' + rel + ' 里有局部变量也叫 ctx，会盖住 factory 参数（改个名，比如 g2d）');
  }
}

if (problems) {
  console.error('\n接线自检没通过：上面这些键补进 main.js 的工厂调用里。');
  process.exit(1);
}
console.log('接线自检通过（' + calls.length + ' 个模块工厂）');
