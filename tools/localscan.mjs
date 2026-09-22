/**
 * 自由变量扫描（undef.mjs 的加强版，专门抓「拼错的局部名字」）。
 *
 * 起因：玩家截图里的报错是 `evt is not defined` —— 某个事件回调里写了 `evt`
 * 但没有这个形参。freescan.mjs 抓不到它（它只报「别的模块导出过的名字」），
 * undef.mjs 又被嵌套模板字符串和块级作用域骗得满天误报。
 *
 * 做法：
 *   1. 去掉注释与字符串；
 *   2. 收集文件里**任何位置**声明过的名字（const/let/var/function/class、
 *      解构、形参、catch、import、标签、对象键）；
 *   3. 剩下的标识符里，只看「短名」（<= 5 字符）或「被当函数调用」的，
 *      因为它们最可能是手误；再排除语言内置。
 *
 * 用法：node tools/localscan.mjs [文件名关键字]
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC = join(ROOT, 'src');
const filter = process.argv[2] || '';

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (extname(full) === '.js') acc.push(full);
  }
  return acc;
}

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
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          let depth = 1; i += 2; const start = i;
          while (i < n && depth > 0) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; }
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

/** 只去注释，保留字符串（import 的模块路径要在字符串里才解析得到） */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
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

const GLOBALS = new Set(('globalThis undefined NaN Infinity this true false null arguments super ' +
  'Object Array String Number Boolean Symbol BigInt Math JSON Date RegExp Error TypeError RangeError SyntaxError ' +
  'Map Set WeakMap WeakSet Promise Proxy Reflect Function eval parseInt parseFloat isNaN isFinite ' +
  'console window document localStorage sessionStorage navigator performance requestAnimationFrame ' +
  'cancelAnimationFrame setTimeout clearTimeout setInterval clearInterval queueMicrotask structuredClone ' +
  'fetch Response Request Headers AbortController URL URLSearchParams Blob File FormData Image Audio ' +
  'Path2D OffscreenCanvas ImageData DOMMatrix DOMPoint TextEncoder TextDecoder CustomEvent Event ' +
  'KeyboardEvent MouseEvent WheelEvent GamepadEvent HTMLElement Node Element process require module exports ' +
  'confirm alert prompt btoa atob crypto TextMetrics Path2D IntersectionObserver ResizeObserver ' +
  'Uint8Array Uint8ClampedArray Int32Array Float32Array Float64Array Uint16Array Int16Array ArrayBuffer DataView ' +
  'if for while switch catch return typeof instanceof in of new delete void do else try finally throw case break ' +
  'continue default class extends function const let var await async yield import export from as static get set').split(/\s+/));

const KEYWORDS = /^(if|for|while|switch|catch|return|typeof|instanceof|in|of|new|delete|void|do|else|try|finally|throw|case|break|continue|default|class|extends|function|const|let|var|await|async|yield|import|export|from|as|static|get|set)$/;

/** 这个文件里「声明过」的所有名字（宽松收集，宁多勿少） */
function declared(code) {
  const names = new Set();
  const clean = strip(code);
  for (const m of clean.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  /*
   * 一条语句里声明多个名字：`let head = 0, tail = 0;` / `const x0 = ..., x1 = ...`
   * 只抓第一个名字会漏掉后面那些，然后它们会被当成「没声明」误报 ——
   * 之前 318 条误报里大半是这么来的。
   */
  for (const m of clean.matchAll(/\b(?:const|let|var)\s+([^;\n]+)/g)) {
    for (const part of m[1].split(',')) {
      const t = part.split('=')[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(t)) names.add(t);
    }
  }
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
  // 形参 / 回调参数：把所有 (...) 里的单标识符都算上（宽松），
  // 并且把里面的解构（[k, v] / {x, y}）也拆出来
  for (const m of clean.matchAll(/\(([^()]*)\)/g)) {
    for (const part of m[1].split(',')) {
      const t = part.split('=')[0].trim().replace(/^\.\.\./, '').replace(/^[[{]\s*/, '').replace(/\s*[\]}]$/, '');
      if (/^[A-Za-z_$][\w$]*$/.test(t)) names.add(t);
    }
    // 解构里的名字：[, , mult] / { a: b } / [k, v]
    for (const d of m[1].matchAll(/[[{]([^\]}]*)[\]}]/g)) {
      for (const part of d[1].split(',')) {
        const seg = part.split(':').pop().split('=')[0].trim().replace(/^\.\.\./, '');
        if (/^[A-Za-z_$][\w$]*$/.test(seg)) names.add(seg);
        const keyPart = part.split(':')[0].split('=')[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(keyPart)) names.add(keyPart);
      }
    }
  }
  // 单参数箭头函数：x => ...
  for (const m of clean.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1]);
  // import（必须用「只去注释」的版本，否则 from '...' 里的路径已经被删掉了）
  const withStrings = stripComments(code);
  for (const m of withStrings.matchAll(/\bimport\s+([^;]+?)\s+from\s*['"][^'"]+['"]/g)) {
    const clause = m[1];
    const def = clause.match(/^([A-Za-z_$][\w$]*)/);
    if (def) names.add(def[1]);
    const braced = clause.match(/\{([^}]*)\}/);
    if (braced) for (const part of braced[1].split(',')) {
      const t = part.trim(); if (!t) continue;
      const as = t.split(/\s+as\s+/); names.add((as[1] || as[0]).trim());
    }
    const star = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (star) names.add(star[1]);
  }
  // 对象字面量的键、类方法、标签、getter/setter
  for (const m of clean.matchAll(/(?:^|[{,;\n])\s*([A-Za-z_$][\w$]*)\s*[:(]/g)) names.add(m[1]);
  for (const m of clean.matchAll(/\b(?:get|set)\s+([A-Za-z_$][\w$]*)\s*\(/g)) names.add(m[1]);
  // 大写开头的全局构造器（Uint8Array / Int32Array / Set / Map …）—— 它们是宿主全局
  for (const m of clean.matchAll(/\bnew\s+([A-Z][\w$]*)/g)) names.add(m[1]);
  return names;
}

let total = 0;
for (const f of walk(SRC)) {
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  if (filter && !rel.includes(filter)) continue;
  const code = readFileSync(f, 'utf8');
  const clean = strip(code);
  const dec = declared(code);
  const hits = new Map();
  const lines = clean.split('\n');
  lines.forEach((line, idx) => {
    for (const m of line.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\b(?!\s*(?::|=>))/g)) {
      const id = m[1];
      if (KEYWORDS.test(id) || GLOBALS.has(id)) continue;
      if (dec.has(id)) continue;
      const isCall = /^\s*\(/.test(line.slice(m.index + id.length));
      const short = id.length <= 5;
      if (!isCall && !short) continue;
      if (!hits.has(id)) hits.set(id, []);
      hits.get(id).push(`${idx + 1}: ${line.trim().slice(0, 80)}`);
    }
  });
  if (hits.size) {
    console.log(`\n⚠ ${rel}`);
    for (const [name, where] of hits) {
      total++;
      console.log(`   ${name}`);
      for (const w of where.slice(0, 2)) console.log(`      ${w}`);
    }
  }
}
console.log(`\n合计 ${total} 处可疑（短名 / 被当函数调用，且本文件里找不到声明）`);
