/**
 * 静态引用检查：找出「用了但没声明/没导入」的标识符。
 *
 * 这类问题（漏 import、改名后忘改用法）在 import 阶段不报错，
 * 只在真正执行到那一行时才炸 —— 而那一行可能藏得很深，测试也不一定覆盖到。
 *
 * 实现：逐行扫描。
 *   - 每行先把注释与字符串替换成同长度的空格（保持列对齐与行号不变）
 *   - 再收集「声明」与「使用」
 *   - 用同一行做行内判断，避免跨行正则互相干扰
 *
 * 用法：node tools/lint.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** JS / 宿主内置全局 */
const GLOBALS = new Set([
  'undefined', 'null', 'true', 'false', 'NaN', 'Infinity', 'globalThis',
  'Object', 'Array', 'Function', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'Math', 'JSON', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'ReferenceError', 'EvalError', 'URIError', 'AggregateError',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'Promise', 'Proxy', 'Reflect',
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
  'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array',
  'BigInt64Array', 'BigUint64Array', 'Atomics', 'Intl',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'escape', 'unescape', 'eval', 'structuredClone',
  'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
  'console', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
  'fetch', 'FormData', 'Headers', 'Request', 'Response', 'URL', 'URLSearchParams',
  'Blob', 'File', 'FileReader', 'Image', 'Audio', 'AudioContext', 'webkitAudioContext',
  'OffscreenCanvas', 'ImageData', 'Path2D', 'DOMMatrix', 'createImageBitmap',
  'ResizeObserver', 'MutationObserver', 'IntersectionObserver', 'AbortController',
  'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'WheelEvent',
  'process', 'require', 'module', 'exports', '__dirname', '__filename', 'Buffer',
  'btoa', 'atob', 'crypto', 'TextEncoder', 'TextDecoder', 'alert', 'confirm', 'prompt',
  'getComputedStyle', 'matchMedia', 'devicePixelRatio', 'innerWidth', 'innerHeight',
  'addEventListener', 'removeEventListener', 'dispatchEvent', 'self', 'top', 'parent', 'frames',
  'Node', 'Element', 'HTMLElement', 'HTMLCanvasElement', 'CanvasRenderingContext2D',
  // 语言关键字（避免被当成标识符）
  'arguments', 'this', 'super', 'new', 'typeof', 'instanceof', 'in', 'of', 'void', 'delete',
  'await', 'async', 'yield', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case',
  'default', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'class', 'extends',
  'function', 'const', 'let', 'var', 'static', 'get', 'set', 'import', 'export', 'from', 'as',
]);

const ID = '[A-Za-z_$][\\w$]*';

/**
 * 逐行清洗：把注释和字符串内容替换成空格，保留长度与行号。
 * 支持模板字符串（含嵌套 ${}）与多行注释。
 */
function cleanLines(src) {
  const lines = src.split('\n');
  const out = [];
  let inBlock = false;
  let inTemplate = false;
  let tplDepth = 0;

  for (const raw of lines) {
    let s = raw;
    let res = '';
    let i = 0;
    while (i < s.length) {
      const c = s[i], c2 = s[i + 1];
      if (inBlock) {
        if (c === '*' && c2 === '/') { inBlock = false; res += '  '; i += 2; continue; }
        res += ' '; i++; continue;
      }
      if (inTemplate) {
        if (c === '\\') { res += '  '; i += 2; continue; }
        if (c === '`') { inTemplate = false; res += ' '; i++; continue; }
        if (c === '$' && c2 === '{') { tplDepth++; res += '  '; i += 2; continue; }
        if (c === '}' && tplDepth > 0) { tplDepth--; res += ' '; i++; continue; }
        // 模板里 ${} 内部其实是代码，但为简化一律当字符串处理（宁可漏检不误报）
        res += ' '; i++; continue;
      }
      if (c === '/' && c2 === '/') { res += ' '.repeat(s.length - i); break; }
      if (c === '/' && c2 === '*') { inBlock = true; res += '  '; i += 2; continue; }
      if (c === '"' || c === "'") {
        const q = c; res += ' '; i++;
        while (i < s.length) {
          if (s[i] === '\\') { res += '  '; i += 2; continue; }
          if (s[i] === q) { res += ' '; i++; break; }
          res += ' '; i++;
        }
        continue;
      }
      if (c === '`') { inTemplate = true; res += ' '; i++; continue; }
      res += c; i++;
    }
    out.push(res);
  }
  return out;
}

/** 从一行里收集声明出来的名字 */
function declaredInLine(line, add) {
  // import / export ... from
  let m = line.match(new RegExp(`\\bimport\\s+(${ID})`, 'g'));
  const importHead = line.match(new RegExp(`\\bimport\\s+([^;]*?)\\bfrom\\b`));
  if (importHead) {
    const clause = importHead[1];
    const braced = clause.match(/\{([\s\S]*?)\}/);
    if (braced) {
      for (const part of braced[1].split(',')) {
        const t = part.trim();
        if (!t) continue;
        const asM = t.match(new RegExp(`\\bas\\s+(${ID})$`));
        add(asM ? asM[1] : t.replace(/\.\.\./, '').trim());
      }
    }
    const head = clause.split('{')[0].replace(/,\s*$/, '').trim();
    if (head) {
      const star = head.match(new RegExp(`\\*\\s+as\\s+(${ID})`));
      if (star) add(star[1]);
      else for (const p of head.split(',')) { const t = p.trim(); if (t) add(t); }
    }
  }
  // 声明
  for (const mm of line.matchAll(new RegExp(`\\b(?:const|let|var)\\s+(${ID})`, 'g'))) add(mm[1]);
  // 解构声明（对象或数组）里的每个名字都算声明。
  // 用宽松的贪婪匹配，保证跨行聚合过的片段也能一次吃下。
  for (const mm of line.matchAll(new RegExp(`\\b(?:const|let|var)\\s*(\\{[\\s\\S]*\\}|\\[[\\s\\S]*\\])\\s*=`, 'g'))) {
    for (const part of mm[1].replace(/[{}[\]]/g, ' ').split(',')) {
      const t = part.trim().replace(/\.\.\./, '');
      if (!t) continue;
      const name = t.split(':').pop().replace(/=.*$/, '').trim();
      if (new RegExp(`^${ID}$`).test(name)) add(name);
    }
  }
  for (const mm of line.matchAll(new RegExp(`\\b(?:const|let|var)\\s*\\{([^}]*)\\}`, 'g'))) {
    for (const part of mm[1].split(',')) {
      const t = part.trim().replace(/\.\.\./, '');
      if (t) add(t.split(':').pop().replace(/=.*$/, '').trim());
    }
  }
  for (const mm of line.matchAll(new RegExp(`\\b(?:const|let|var)\\s*\\[([^\\]]*)\\]`, 'g'))) {
    for (const part of mm[1].split(',')) {
      const t = part.trim().replace(/\.\.\./, '').replace(/=.*$/, '').trim();
      if (t) add(t);
    }
  }
  for (const mm of line.matchAll(new RegExp(`\\bfunction\\s*\\*?\\s*(${ID})`, 'g'))) add(mm[1]);
  for (const mm of line.matchAll(new RegExp(`\\bclass\\s+(${ID})`, 'g'))) add(mm[1]);
  // 函数/方法参数：把括号里的内容整体当成声明（保守，宁可多声明）
  for (const mm of line.matchAll(/\(([^()]*)\)/g)) {
    for (const part of mm[1].split(',')) {
      const t = part.trim().replace(/\.\.\./, '').replace(/=.*$/, '').trim();
      if (new RegExp(`^${ID}$`).test(t)) add(t);
      else if (/^[{[]/.test(t)) {
        for (const sub of t.replace(/[{}[\]]/g, '').split(',')) {
          const u = sub.trim().split(':').pop().trim();
          if (new RegExp(`^${ID}$`).test(u)) add(u);
        }
      }
    }
  }
  // 单参数箭头 x =>
  for (const mm of line.matchAll(new RegExp(`(?:^|[(,=\\s])(${ID})\\s*=>`, 'g'))) add(mm[1]);
  // for (const x of ...)
  for (const mm of line.matchAll(new RegExp(`\\bfor\\s*\\(\\s*(?:const|let|var)\\s+(${ID})`, 'g'))) add(mm[1]);
  // catch (e)
  for (const mm of line.matchAll(new RegExp(`\\bcatch\\s*\\(\\s*(${ID})`, 'g'))) add(mm[1]);
  // 方法定义 name(...) {
  for (const mm of line.matchAll(new RegExp(`^\\s*(?:async\\s+)?(?:get\\s+|set\\s+|\\*\\s*)?(${ID})\\s*\\(`, 'g'))) add(mm[1]);
  // 对象键 name: value  /  { name }  /  name,
  for (const mm of line.matchAll(new RegExp(`(?:^|[{,])\\s*(${ID})\\s*[:,}]`, 'g'))) add(mm[1]);
  for (const mm of line.matchAll(new RegExp(`(?:^|[{,])\\s*(${ID})\\s*$`, 'g'))) add(mm[1]);
  // 标签
  for (const mm of line.matchAll(new RegExp(`^\\s*(${ID})\\s*:\\s*(?:for|while|do)\\b`, 'g'))) add(mm[1]);
}

/** 收集一行里被使用的标识符（排除属性访问、对象键、关键字） */
function usedInLine(line, add) {
  // 去掉属性访问：a.b.c -> a
  const noProps = line.replace(new RegExp(`\\??\\.\\s*${ID}`, 'g'), '.');
  // 去掉对象字面量的键：{ key: -> { :
  const noKeys = noProps.replace(new RegExp(`([{,;]\\s*)(${ID})\\s*:`, 'g'), '$1 :');
  // 去掉 import/export 语句（它们不是"使用"）
  if (/^\s*(?:import|export)\b/.test(noKeys)) {
    // 只保留 from 之后的副作用部分（没有绑定，忽略）
    return;
  }
  for (const mm of noKeys.matchAll(new RegExp(`(?:^|[^.\\w$])(${ID})`, 'g'))) {
    const name = mm[1];
    if (GLOBALS.has(name)) continue;
    add(name);
  }
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (extname(full) === '.js' || extname(full) === '.mjs') acc.push(full);
  }
  return acc;
}

const files = walk(join(ROOT, 'src')).concat(walk(join(ROOT, 'tools')));
let total = 0;
let unusedTotal = 0;

console.log(`静态引用检查：${files.length} 个文件\n`);

for (const file of files) {
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { continue; }
  const rawLines = src.split('\n');
  const lines = cleanLines(src);

  // ---- 预扫描：把（可能跨行的）import / export-from 语句整段收集起来 ----
  const importLines = new Set();
  const importNames = new Set();
  let stmtStart = -1;
  let stmtBuf = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (stmtStart < 0) {
      // 只看 import 语句（以及 export {...} from 这种再导出）
      if (/^\s*import\b/.test(l)) {
        if (/^\s*import\s+['"]/.test(l)) { importLines.add(i); continue; }   // 副作用导入
        stmtStart = i; stmtBuf = l;
      } else if (/^\s*export\s*\{/.test(l) && /\bfrom\b/.test(lines.slice(i, i + 3).join(' '))) {
        stmtStart = i; stmtBuf = l;
      } else continue;
    } else {
      stmtBuf += ' ' + l;
    }
    // 语句在「原文行尾出现引号/分号」时结束 —— 必须用原文判断，
    // 因为模块路径是字符串，挖空后结尾引号就消失了。
    const tRaw = rawLines[i].replace(/\s+$/, '');
    const ends = /['"]\s*;?$/.test(tRaw) || /;\s*$/.test(tRaw) || /\}\s*$/.test(tRaw);
    if (ends || i - stmtStart > 20) {
      for (let k = stmtStart; k <= i; k++) importLines.add(k);
      collectImportNames(stmtBuf, (n) => importNames.add(n));
      stmtStart = -1; stmtBuf = '';
    }
  }

  const declared = new Set(importNames);
  const usedMap = new Map();
  lines.forEach((line, idx) => {
    if (importLines.has(idx)) return;
    declaredInLine(line, (n) => declared.add(n));
    usedInLine(line, (n) => { if (!usedMap.has(n)) usedMap.set(n, idx + 1); });
  });

  const missing = [];
  for (const [name, line] of usedMap) {
    if (declared.has(name)) continue;
    missing.push(`${name}  (行 ${line})`);
  }
  if (missing.length) {
    total += missing.length;
    console.log(`❌ ${relative(ROOT, file).replace(/\\/g, '/')}`);
    for (const m of missing) console.log(`     ${m}`);
  }

  // ---- 附加检查：导入后从未在文件里出现过（拼写不一致 / 死代码） ----
  // 注意要用「挖空字符串与注释」的正文，否则提示文案里恰好同名的词会造成误判。
  // import 行置空而非删除，保持行号对齐。
  const blanked = lines.map((l, i) => (importLines.has(i) ? '' : l)).join('\n');
  const unused = [];
  for (const name of importNames) {
    if (!new RegExp(`(^|[^\\w$.])${name}(?![\\w$])`).test(blanked)) unused.push(name);
  }
  if (unused.length) {
    unusedTotal += unused.length;
    console.log(`⚠️  ${relative(ROOT, file).replace(/\\/g, '/')} 未使用的导入: ${unused.join(', ')}`);
  }
}

console.log(total
  ? `\n发现 ${total} 处未声明引用，${unusedTotal} 个未使用导入`
  : `\n✅ 没有发现未声明的标识符${unusedTotal ? `（有 ${unusedTotal} 个未使用导入，可清理）` : ''}`);
process.exit(total ? 1 : 0);

/** 从一条完整的 import/export 语句里取出绑定的名字 */
function collectImportNames(stmt, add) {
  const head = stmt.match(/\b(?:import|export)\s+([\s\S]*?)\bfrom\b/);
  if (!head) return;
  const clause = head[1];
  const braced = clause.match(/\{([\s\S]*?)\}/);
  if (braced) {
    for (const part of braced[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const asM = t.match(new RegExp(`\\bas\\s+(${ID})$`));
      add(asM ? asM[1] : t.replace(/\.\.\./, '').trim());
    }
  }
  const def = clause.split('{')[0].replace(/,\s*$/, '').trim();
  if (def) {
    const star = def.match(new RegExp(`\\*\\s+as\\s+(${ID})`));
    if (star) add(star[1]);
    else for (const p of def.split(',')) { const t = p.trim(); if (t) add(t); }
  }
}
