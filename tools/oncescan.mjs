/**
 * 「只出现过一次的标识符」扫描。
 *
 * 拼错的名字有个共同特征：**整个项目里只出现一次**（写错的那次），
 * 而真正的变量/函数名至少会出现两次（声明 + 使用），或者本身就是 import 的绑定。
 * 这条规律很便宜，能直接把人眼扫不过来的东西缩到十几条。
 *
 * 用法：node tools/oncescan.mjs [最少出现次数，默认 1]
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC = join(ROOT, 'src');
const MAX = Number(process.argv[2] || 1);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (extname(full) === '.js') acc.push(full);
  }
  return acc;
}

/** 去注释、去字符串（模板里的 ${} 保留） */
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

const files = walk(SRC);
const counts = new Map();     // name -> [{file, line, text}]
for (const f of files) {
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  const clean = strip(readFileSync(f, 'utf8'));
  clean.split('\n').forEach((line, idx) => {
    for (const m of line.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\b/g)) {
      const id = m[1];
      if (!counts.has(id)) counts.set(id, []);
      counts.get(id).push({ file: rel, line: idx + 1, text: line.trim().slice(0, 90) });
    }
  });
}

const words = new Set(('const let var function class return if else for while do switch case break continue new delete typeof instanceof in of this null true false undefined ' +
  'import export from as default async await try catch finally throw yield static get set extends super ' +
  'Object Array String Number Boolean Math JSON Date Map Set Promise console window document ' +
  'length push pop map filter forEach slice splice join split replace test match indexOf includes ' +
  'x y z t i j k n v w h e r a b c d f g m o p q s u angle life time dt id key type name value ' +
  'min max abs floor ceil round sqrt pow sin cos atan2 hypot random sign').split(/\s+/));

const rare = [...counts.entries()]
  .filter(([id, hits]) => hits.length <= MAX && !words.has(id) && id.length > 1)
  .sort((a, b) => a[0].localeCompare(b[0]));

console.log(`\n=== 只出现 ${MAX} 次的标识符（拼写错误的典型特征）===`);
for (const [id, hits] of rare) {
  console.log(`\n  ${id}   ×${hits.length}`);
  for (const h of hits) console.log(`     ${h.file}:${h.line}  ${h.text}`);
}
console.log(`\n合计 ${rare.length} 个（含少量本来只用一次的局部名，人工扫一眼）`);
