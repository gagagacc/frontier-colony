/**
 * 把 Godot 版**单独整理成一个独立项目**（用于第二个 GitHub 仓库）。
 *
 *   node tools/stage-godot-repo.mjs [--out godot-repo]
 *
 * 玩家要求：「和 html 版本区分开隔离成两个项目上传」——
 * 所以这个仓库的**根目录就是 Godot 工程本身**（`project.godot` 在根上），
 * clone 下来直接用 Godot 打开就能跑，不用先找子目录。
 *
 * 只带「跑得起来 + 能重建」的东西，不带：
 *   - 引擎/模板二进制（几百 MB，脚本会重下）
 *   - 导出产物（走 Releases）
 *   - 素材源包（CC0 可重下）
 */
import { existsSync, mkdirSync, rmSync, cpSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const OUT = join(ROOT, arg('out', 'godot-repo'));

// ---------- 要带的 ----------
const COPY = [
  // Godot 工程本体（根目录就是工程）
  ['godot/project.godot', 'project.godot'],
  ['godot/icon.svg', 'icon.svg'],
  ['godot/icon.png', 'icon.png'],
  ['godot/icon.ico', 'icon.ico'],
  ['godot/scenes', 'scenes'],
  ['godot/scripts', 'scripts'],
  ['godot/data', 'data'],                 // 由 JS 侧导出生成，但**必须带**：没有它工程跑不起来
  ['godot/tests', 'tests'],
  ['godot/assets', 'assets'],
  ['godot/export_presets.cfg', 'export_presets.cfg'],
  // 验证与构建脚本
  ['tools/godot-verify.mjs', 'tools/godot-verify.mjs'],
  ['tools/godot-golden.mjs', 'tools/godot-golden.mjs'],
  ['tools/godot-shot.mjs', 'tools/godot-shot.mjs'],
  ['tools/godot-export.mjs', 'tools/godot-export.mjs'],
  ['tools/assertion-matrix.mjs', 'tools/assertion-matrix.mjs'],
  ['tools/make-shortcut.mjs', 'tools/make-shortcut.mjs'],
  ['tools/make-icon.mjs', 'tools/make-icon.mjs'],
  // 文档
  ['godot/PORT-PLAN.md', 'PORT-PLAN.md'],
];

// ---------- 不带的重东西（有一份说明在 README 里）----------
const SKIP_DIRS = new Set(['.godot', 'exe']);
const SKIP_EXT = new Set(['.exe', '.tpz', '.zip', '.log', '.bak']);

function sizeOf(p) {
  const s = statSync(p);
  if (!s.isDirectory()) return s.size;
  let n = 0;
  for (const f of readdirSync(p)) n += sizeOf(join(p, f));
  return n;
}

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let copied = 0;
let bytes = 0;
const skipped = [];
for (const [from, to] of COPY) {
  const src = join(ROOT, from);
  if (!existsSync(src)) { skipped.push(from + '（不存在）'); continue; }
  const dst = join(OUT, to);
  mkdirSync(dirname(dst), { recursive: true });
  // 逐文件拷，顺手跳过重东西
  const walk = (s, d) => {
    const st = statSync(s);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(s.split(/[\\/]/).pop())) { skipped.push(relative(ROOT, s) + '/'); return; }
      mkdirSync(d, { recursive: true });
      for (const f of readdirSync(s)) walk(join(s, f), join(d, f));
      return;
    }
    const ext = s.slice(s.lastIndexOf('.'));
    if (SKIP_EXT.has(ext)) { skipped.push(relative(ROOT, s)); return; }
    mkdirSync(dirname(d), { recursive: true });
    cpSync(s, d);
    copied++;
    bytes += st.size;
  };
  walk(src, dst);
}

console.log(`✅ Godot 独立项目已整理到 ${relative(ROOT, OUT)}/`);
console.log(`   ${copied} 个文件 · ${(bytes / 1048576).toFixed(1)} MB`);
if (skipped.length) {
  console.log('   跳过（重东西/不存在）：' + skipped.slice(0, 10).join('、') + (skipped.length > 10 ? ` 等 ${skipped.length} 项` : ''));
}

// ---------- 该仓库自己的 .gitignore ----------
writeFileSync(join(OUT, '.gitignore'), [
  '# 引擎与模板（几百 MB，从官网重下即可）',
  '.godot/',
  'addons/godotsteam/*.exe',
  'tools/godot-dl/',
  '*.tpz',
  '',
  '# 导出产物（走 Releases 下载，不进仓库）',
  'dist-godot/',
  'build/',
  '',
  '# 本地临时',
  'tools/_*.mjs',
  '*.log',
  '*.bak',
  '.DS_Store',
  'Thumbs.db',
  '',
].join('\n'));
console.log('✅ 已写入该仓库的 .gitignore');
