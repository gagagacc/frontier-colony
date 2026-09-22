/**
 * 「用了但没导入」扫描器（undef.mjs 的补充）。
 *
 * 背景：玩家在建造面板的「吸引装置」页撞到
 *   ReferenceError: TILE is not defined  (panelBuild.js:150)
 * 而 tools/undef.mjs 报的是「$ (行 83)」—— 它被嵌套模板字符串骗了，
 * 真正要命的自由变量反而漏掉。这类错误只在玩家点到那一页时才炸，
 * 静态检查（语法 / import 绑定）全都拦不住。
 *
 * 思路（不做完整作用域分析，只求高信噪比）：
 *   1. 收集全项目所有模块**导出过**的名字；
 *   2. 对每个文件，收集它 import 进来的本地名 + 自己声明过的名字；
 *   3. 如果某文件里用到了「别的模块导出过、自己既没导入也没声明」的名字 → 报出来。
 * 这样只会有「本地变量恰好和某个导出重名」这一类误报，人工扫一眼即可。
 *
 * 用法：node tools/freescan.mjs
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC = join(ROOT, 'src');

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (extname(full) === '.js') acc.push(full);
  }
  return acc;
}

/** 只去注释，保留字符串 —— import 语句必须靠字符串里的模块路径来解析 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += c; i++;
      while (i < n) {
        out += src[i];
        if (src[i] === '\\') { i++; if (i < n) out += src[i]; i++; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** 去掉注释和字符串，避免把文案里的词当成标识符 */
function strip(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        // 模板字符串里的 ${...} 里是真代码，保留下来
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          let depth = 1; i += 2; const start = i;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            i++;
          }
          out += ' ' + src.slice(start, i - 1) + ' ';
          continue;
        }
        i++;
      }
      out += ' ';
      continue;
    }
    out += c; i++;
  }
  return out;
}

const IDENT = /[A-Za-z_$][\w$]*/g;

/** 收集某个模块导出的名字 */
function exportedNames(code) {
  const names = new Set();
  const clean = stripComments(code);
  for (const m of clean.matchAll(/\bexport\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of clean.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const as = t.split(/\s+as\s+/);
      names.add((as[1] || as[0]).trim());
    }
  }
  return names;
}

/** 收集某个文件里 import 进来的本地名 */
function importedNames(code) {
  const names = new Set();
  const clean = stripComments(code);
  for (const m of clean.matchAll(/\bimport\s+([^;]+?)\s+from\s*['"][^'"]+['"]/g)) {
    const clause = m[1].trim();
    // default
    const def = clause.match(/^([A-Za-z_$][\w$]*)/);
    if (def) names.add(def[1]);
    const braced = clause.match(/\{([^}]*)\}/);
    if (braced) {
      for (const part of braced[1].split(',')) {
        const t = part.trim();
        if (!t) continue;
        const as = t.split(/\s+as\s+/);
        names.add((as[1] || as[0]).trim());
      }
    }
    const star = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (star) names.add(star[1]);
  }
  return names;
}

/** 粗略收集「这个文件里声明过的名字」：声明语句 + 形参 + 解构 + catch + 标签 */
function declaredNames(code) {
  const names = new Set();
  const clean = strip(code);
  for (const m of clean.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of clean.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const t = part.split(':').pop().split('=')[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(t)) names.add(t);
    }
  }
  for (const m of clean.matchAll(/\b(?:const|let|var)\s*\[([^\]]*)\]/g)) {
    for (const part of m[1].split(',')) {
      const t = part.split('=')[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(t)) names.add(t);
    }
  }
  // 形参：函数/箭头/catch/(...) => 都比较难精确，这里用「出现过的单独标识符」兜底太多，
  // 所以只抓明显的形参列表：(a, b, c) {  /  (a, b) =>
  for (const m of clean.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) {
    for (const part of m[1].split(',')) {
      const t = part.split('=')[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(t)) names.add(t);
    }
  }
  for (const m of clean.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)) names.add(m[1]);     // 对象字面量键 / switch 标签
  // 类方法 / 简写方法定义（clear() {} / get isDesktop() {} / async run() {}）
  for (const m of clean.matchAll(/^\s*(?:static\s+|async\s+|get\s+|set\s+|\*\s*)?([A-Za-z_$][\w$]*)\s*\(/gm)) names.add(m[1]);
  return names;
}

// 语言与宿主自带的全局，直接忽略
const BUILTINS = new Set(('globalThis undefined NaN Infinity this true false null ' +
  'Object Array String Number Boolean Symbol BigInt Math JSON Date RegExp Error TypeError RangeError ' +
  'Map Set WeakMap WeakSet Promise Proxy Reflect Function eval parseInt parseFloat isNaN isFinite ' +
  'console window document localStorage sessionStorage navigator performance requestAnimationFrame ' +
  'cancelAnimationFrame setTimeout clearTimeout setInterval clearInterval queueMicrotask structuredClone ' +
  'fetch Response Request Headers AbortController URL URLSearchParams Blob File FormData Image Audio ' +
  'Path2D OffscreenCanvas ImageData DOMMatrix DOMPoint TextEncoder TextDecoder CustomEvent Event ' +
  'KeyboardEvent MouseEvent WheelEvent GamepadEvent HTMLElement Node Element RequestAnimationFrame ' +
  'DeviceOrientationEvent process require module exports __dirname __filename').split(/\s+/));

const files = walk(SRC);
const sources = new Map();
const allExports = new Map();   // name -> [files]
for (const f of files) {
  const code = readFileSync(f, 'utf8');
  sources.set(f, code);
  for (const n of exportedNames(code)) {
    if (!allExports.has(n)) allExports.set(n, []);
    allExports.get(n).push(relative(ROOT, f).replace(/\\/g, '/'));
  }
}

let total = 0;
const report = [];
for (const f of files) {
  const code = sources.get(f);
  const clean = strip(code);
  const imp = importedNames(code);
  const dec = declaredNames(code);
  const hits = new Map();   // name -> lines
  const lines = clean.split('\n');
  for (const line of lines) {
    if (/^\s*(?:import|export)\b/.test(line)) continue;          // import 子句里的原名（PLAYER as PCFG）不是自由变量
    // 排除属性访问（foo.bar 里的 bar）、对象字面量的键（key: value）、导入别名（X as Y）
    for (const m of line.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\b(?!\s*:)(?!\s+as\b)/g)) {
      const id = m[1];
      if (BUILTINS.has(id)) continue;
      if (imp.has(id) || dec.has(id)) continue;
      if (!allExports.has(id)) continue;               // 只报「别的模块导出过」的名字
      if (allExports.get(id).includes(relative(ROOT, f).replace(/\\/g, '/'))) continue;  // 自己导出的
      if (!hits.has(id)) hits.set(id, []);
      hits.get(id).push(line.trim().slice(0, 90));
    }
  }
  if (hits.size) {
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    report.push({ file: rel, hits });
    total += hits.size;
  }
}

console.log('\n=== 「用了但没导入」扫描（undef.mjs 的补充）===\n');
if (!report.length) console.log('  ✅ 没有发现可疑的自由变量');
for (const r of report) {
  console.log(`⚠ ${r.file}`);
  for (const [name, samples] of r.hits) {
    console.log(`     ${name}  ← 由 ${allExports.get(name).join(', ')} 导出`);
    for (const s of samples.slice(0, 3)) console.log(`        ${s}`);
  }
}
if (!report.length) console.log('\n通过 1 · 失败 0');
else console.log(`\n通过 0 · 失败 ${total}`);
console.log(total ? `\n合计 ${total} 处可疑（含少量「本地变量与导出重名」的误报）` : '\n合计 0 处可疑');
// 有可疑就非零退出：这类错误只在玩家点到那一步时才炸，必须在提交前拦住
process.exit(total ? 1 : 0);
