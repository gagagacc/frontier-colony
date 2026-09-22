/**
 * 静态引用扫描（提示性）。
 *
 * 注意：这是启发式扫描，会有误报 —— 比如 `import { PLAYER as PCFG }` 这类
 * 别名导入、以及跨行声明的局部变量都可能被误判。所以它只作为「值得人工看一眼」
 * 的线索输出，不作为构建门禁；真正会拦人的是 tools/checkimports.mjs
 * （导入的名字必须在目标文件里真的导出）与运行期测试。
 *
 * 用法：node tools/undef.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (extname(full) === '.js') acc.push(full);
  }
  return acc;
}

/** 用 vm.SourceTextModule 不可用时，退回到「编译成脚本并收集自由变量」 */
function freeVarsOf(code, filename) {
  // 把 ESM 语法改写成可以在 vm 里解析的形式不可行，所以用正则法：
  // 1) 收集所有声明（含 import、函数参数、解构）
  // 2) 收集所有标识符用法
  // 3) 差集 = 自由变量
  const declared = new Set();
  const add = (n) => { if (n) declared.add(n); };

  const lines = code.split('\n');

  // import 语句（跨行）
  let stmt = '', startLine = 0;
  const importNames = new Set();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!stmt) {
      if (/^\s*import\b/.test(l) && !/^\s*import\s+['"]/.test(l)) { stmt = l; startLine = i; }
      else continue;
    } else stmt += ' ' + l;
    const t = l.replace(/\s+$/, '');
    if (/['"]\s*;?$/.test(t) || /;\s*$/.test(t) || /\}\s*$/.test(t) || i - startLine > 20) {
      const m = stmt.match(/\bimport\s+([\s\S]*?)\bfrom\b/);
      if (m) {
        const braced = m[1].match(/\{([\s\S]*?)\}/);
        if (braced) for (const p of braced[1].split(',')) {
          const tt = p.trim(); if (!tt) continue;
          const asM = tt.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
          add(asM ? asM[1] : tt);
        }
        const head = m[1].split('{')[0].replace(/,\s*$/, '').trim();
        if (head) for (const p of head.split(',')) { const tt = p.trim(); if (tt) add(tt); }
      }
      stmt = '';
    }
  }

  // 所有声明关键字
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of code.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of code.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([\s\S]*?)\}\s*=/g)) {
    for (const p of m[1].split(',')) {
      const tt = p.trim().replace(/\.\.\./, '');
      if (tt) add(tt.split(':').pop().replace(/=.*$/, '').trim());
    }
  }
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\[([\s\S]*?)\]\s*=/g)) {
    for (const p of m[1].split(',')) {
      const tt = p.trim().replace(/\.\.\./, '').replace(/=.*$/, '').trim();
      if (tt) add(tt);
    }
  }
  // 所有括号里的参数
  for (const m of code.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) {
    for (const p of m[1].split(',')) {
      const tt = p.trim().replace(/\.\.\./, '').replace(/=.*$/, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(tt)) add(tt);
      else if (/^[{[]/.test(tt)) {
        for (const sub of tt.replace(/[{}[\]]/g, '').split(',')) {
          const u = sub.trim().split(':').pop().trim();
          if (/^[A-Za-z_$][\w$]*$/.test(u)) add(u);
        }
      }
    }
  }
  for (const m of code.matchAll(/(?:^|[(,=\s])([A-Za-z_$][\w$]*)\s*=>/gm)) add(m[1]);
  for (const m of code.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of code.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
  // 方法定义与对象键（保守：一律算声明，宁可漏报不可误报）
  for (const m of code.matchAll(/^\s*(?:async\s+)?(?:get\s+|set\s+|\*\s*)?([A-Za-z_$][\w$]*)\s*\(/gm)) add(m[1]);
  for (const m of code.matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*[:,}]/gm)) add(m[1]);

  // 用法：挖空注释与字符串，去掉属性访问
  let body = '';
  {
    let i = 0, block = false;
    while (i < code.length) {
      const c = code[i], c2 = code[i + 1];
      if (block) { if (c === '*' && c2 === '/') { block = false; body += '  '; i += 2; } else { body += c === '\n' ? '\n' : ' '; i++; } continue; }
      if (c === '/' && c2 === '/') { while (i < code.length && code[i] !== '\n') { body += ' '; i++; } continue; }
      if (c === '/' && c2 === '*') { block = true; body += '  '; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') {
        const q = c; body += ' '; i++;
        while (i < code.length) {
          if (code[i] === '\\') { body += '  '; i += 2; continue; }
          if (code[i] === q) { body += ' '; i++; break; }
          body += code[i] === '\n' ? '\n' : ' '; i++;
        }
        continue;
      }
      body += c; i++;
    }
  }
  body = body.replace(/\??\.\s*[A-Za-z_$][\w$]*/g, '.');

  const free = new Map();
  body.split('\n').forEach((line, idx) => {
    for (const m of line.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)/g)) {
      const n = m[2];
      if (declared.has(n)) continue;
      if (!free.has(n)) free.set(n, idx + 1);
    }
  });
  return free;
}

const GLOBALS = new Set([
  'undefined', 'null', 'true', 'false', 'NaN', 'Infinity', 'globalThis', 'arguments', 'this',
  'Object', 'Array', 'Function', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Math', 'JSON',
  'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'Map', 'Set',
  'WeakMap', 'WeakSet', 'Promise', 'Proxy', 'Reflect', 'ArrayBuffer', 'DataView', 'Int8Array',
  'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
  'Float32Array', 'Float64Array', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'eval', 'structuredClone', 'window', 'document',
  'navigator', 'location', 'localStorage', 'sessionStorage', 'console', 'performance',
  'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'queueMicrotask', 'fetch', 'URL', 'URLSearchParams', 'Blob', 'Image', 'Audio',
  'AudioContext', 'webkitAudioContext', 'OffscreenCanvas', 'ImageData', 'Path2D', 'process', 'require',
  'module', 'exports', '__dirname', '__filename', 'Buffer', 'btoa', 'atob', 'crypto', 'TextEncoder',
  'TextDecoder', 'alert', 'confirm', 'prompt', 'getComputedStyle', 'matchMedia', 'devicePixelRatio',
  'innerWidth', 'innerHeight', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'self',
  'Node', 'Element', 'HTMLElement', 'HTMLCanvasElement', 'CanvasRenderingContext2D', 'DOMMatrix',
  'createImageBitmap', 'ResizeObserver', 'MutationObserver', 'IntersectionObserver', 'AbortController',
  'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'WheelEvent', 'FormData',
  'Headers', 'Request', 'Response', 'File', 'FileReader', 'WeakRef', 'Intl', 'Atomics',
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'try', 'catch',
  'finally', 'throw', 'return', 'new', 'typeof', 'instanceof', 'in', 'of', 'void', 'delete', 'await',
  'async', 'yield', 'class', 'extends', 'function', 'const', 'let', 'var', 'static', 'get', 'set',
  'import', 'export', 'from', 'as', 'super',
]);

const files = walk(join(ROOT, 'src'));
let total = 0;
for (const file of files) {
  const code = readFileSync(file, 'utf8');
  const free = freeVarsOf(code, file);
  const bad = [...free.entries()].filter(([n]) => !GLOBALS.has(n));
  if (bad.length) {
    total += bad.length;
    console.log(`❌ ${relative(ROOT, file).replace(/\\/g, '/')}`);
    for (const [n, line] of bad) console.log(`     ${n}  (行 ${line})`);
  }
}
console.log(total
  ? `\n⚠ 扫描到 ${total} 处可疑的自由变量（含误报，仅供人工排查线索）`
  : `\n✅ ${files.length} 个文件没有未定义标识符`);
// 故意始终返回成功：这是提示性工具，不做门禁
process.exit(0);
