/**
 * import 绑定校验：每个模块导入的名字，在被导入文件里必须真的导出。
 * 这类错误（漏删/漏加一个名字）会让代码在运行到那一行时才炸。
 *
 * 用法：node tools/checkimports.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
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

/** 一个文件导出了哪些名字 */
function exportsOf(code) {
  const names = new Set();
  let hasDefault = false;

  // export const/let/var/function/class  a, b
  for (const m of code.matchAll(/\bexport\s+(?:async\s+)?(?:const|let|var|function\s*\*?|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // export { a, b as c }  （可选 from）
  for (const m of code.matchAll(/\bexport\s*\{([\s\S]*?)\}\s*(?:from\s*['"][^'"]+['"])?/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim().replace(/^type\s+/, '');
      if (!t) continue;
      const asM = t.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
      names.add(asM ? asM[1] : t);
    }
  }
  // export default
  if (/\bexport\s+default\b/.test(code)) hasDefault = true;
  // export * from  -> 无法静态枚举，标记为「有通配导出」
  const hasStar = /\bexport\s*\*\s*from\b/.test(code);

  return { names, hasDefault, hasStar };
}

/** 一个文件导入了哪些名字 -> { local, imported, source, line } */
function importsOf(code) {
  const out = [];
  const lines = code.split('\n');
  let stmt = '';
  let startLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!stmt) {
      if (/^\s*import\b/.test(l) && !/^\s*import\s+['"]/.test(l)) { stmt = l; startLine = i + 1; }
      else continue;
    } else stmt += ' ' + l;
    const t = l.replace(/\s+$/, '');
    if (/['"]\s*;?$/.test(t) || /;\s*$/.test(t) || /\}\s*$/.test(t) || (i + 1 - startLine) > 20) {
      const m = stmt.match(/\bimport\s+([\s\S]*?)\bfrom\b\s*['"]([^'"]+)['"]/);
      if (m) {
        const clause = m[1];
        const source = m[2];
        const braced = clause.match(/\{([\s\S]*?)\}/);
        if (braced) {
          for (const part of braced[1].split(',')) {
            const tt = part.trim();
            if (!tt) continue;
            const asM = tt.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
            out.push({ local: asM ? asM[2] : tt, imported: asM ? asM[1] : tt, source, line: startLine });
          }
        }
        const def = clause.split('{')[0].replace(/,\s*$/, '').trim();
        if (def && !def.startsWith('*')) out.push({ local: def, imported: 'default', source, line: startLine });
        const star = def.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
        if (star) out.push({ local: star[1], imported: '*', source, line: startLine });
      }
      stmt = '';
    }
  }
  return out;
}

const files = walk(join(ROOT, 'src'));
const exportCache = new Map();
function getExports(file) {
  if (exportCache.has(file)) return exportCache.get(file);
  const code = readFileSync(file, 'utf8');
  const e = exportsOf(code);
  exportCache.set(file, e);
  return e;
}

let problems = 0;
for (const file of files) {
  const code = readFileSync(file, 'utf8');
  for (const imp of importsOf(code)) {
    if (imp.imported === '*') continue;
    const target = resolve(dirname(file), imp.source);
    if (!existsSync(target)) {
      console.log(`❌ ${file.replace(ROOT, '')}:${imp.line} 目标文件不存在: ${imp.source}`);
      problems++;
      continue;
    }
    if (extname(target) !== '.js') continue;
    const ex = getExports(target);
    if (ex.hasStar && !ex.names.has(imp.imported)) continue;
    if (!ex.names.has(imp.imported)) {
      console.log(`❌ ${file.replace(ROOT, '').replace(/\\/g, '/')}:${imp.line}  导入的 "${imp.imported}" 在 ${imp.source} 里没有导出`);
      problems++;
    }
  }
}

console.log(problems ? `\n发现 ${problems} 处导入错误` : `\n✅ ${files.length} 个文件的 import 全部有效`);
process.exit(problems ? 1 : 0);
