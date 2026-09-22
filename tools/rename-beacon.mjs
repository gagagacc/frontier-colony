/**
 * 一次性文案迁移：吸引装置 → 吸引阵列（核心舱的一部分）。
 *
 * 「便携吸引装置」（载具上那台）是另一件东西，名字保持不变 ——
 * 所以先把它占位保护起来，替换完再还原。
 *
 * 用 Node 读写（不是 PowerShell 文本管道）：这个项目里已经因为
 * PowerShell 按 ANSI 解码 UTF-8 毁过一次源码。
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TARGETS = ['src'];

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (extname(full) === '.js') acc.push(full);
  }
  return acc;
}

let files = 0, hits = 0;
for (const dir of TARGETS) {
  for (const f of walk(join(ROOT, dir))) {
    const src = readFileSync(f, 'utf8');
    if (!src.includes('吸引装置')) continue;
    const out = src
      .replaceAll('便携吸引装置', '@@PORTABLE@@')
      .replaceAll('吸引装置', '吸引阵列')
      .replaceAll('@@PORTABLE@@', '便携吸引装置');
    if (out !== src) {
      const n = (src.match(/吸引装置/g) || []).length;
      hits += n;
      files++;
      writeFileSync(f, out, 'utf8');
      console.log(`  ${f.replace(ROOT, '').replace(/\\/g, '/')}  (${n} 处)`);
    }
  }
}
console.log(`\n共 ${files} 个文件、${hits} 处文案迁移完成`);
