/**
 * 清理压缩包与打包死重。
 *
 * 玩家要求：「记得更新那个绿色版的压缩包，别的类型压缩都可以删了」。
 *
 * 做法：
 *   1. 把素材**源文件**（下载来的 `_dl_*.zip` 与解压出来的 `_x_*`）挪出 `assets/`，
 *      放进仓库根的 `assets-src/`。它们只是「取素材」的中间产物，
 *      游戏实际用的文件早就拷进 `godot/assets/` 了，没必要跟着绿色版发出去
 *      （实测白白多 13.2 MB）；
 *   2. 删除分卷（`dist/game.zip.part*`）—— 既然整包能一次发，分卷是多余的；
 *   3. 删除工具链的下载缓存（`tools/godot-dl/*.zip`，195 MB），
 *      引擎已经解压在 `tools/godot-dl/exe/`，需要时脚本会重新下。
 *
 * 用法：node tools/clean-archives.mjs [--dry]
 */
import { existsSync, mkdirSync, renameSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const SRC = join(ROOT, 'assets-src');

const moved = [];
const removed = [];
const kept = [];

function sizeOf(p) {
  if (!existsSync(p)) return 0;
  const s = statSync(p);
  if (!s.isDirectory()) return s.size;
  let sum = 0;
  for (const f of readdirSync(p)) sum += sizeOf(join(p, f));
  return sum;
}
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';

// ---------- ① 素材源文件挪出 assets/ ----------
if (!DRY) mkdirSync(SRC, { recursive: true });
const assetsDir = join(ROOT, 'assets');
for (const name of readdirSync(assetsDir)) {
  const isSource = name.startsWith('_x_') || name.startsWith('_dl_');
  if (!isSource) continue;
  const from = join(assetsDir, name);
  const to = join(SRC, name);
  const sz = sizeOf(from);
  if (DRY) { console.log('[试运行] 会移动 ' + name + '（' + mb(sz) + '）→ assets-src/'); continue; }
  if (existsSync(to)) rmSync(to, { recursive: true, force: true });
  renameSync(from, to);
  moved.push([name, sz]);
}
if (moved.length) {
  console.log('📦 素材源文件已挪到 assets-src/（不进游戏包）：');
  for (const [n, s] of moved) console.log('   ' + n.padEnd(30) + mb(s));
  console.log('   小计 ' + mb(moved.reduce((a, [, s]) => a + s, 0)));
}

// ---------- ② 删分卷 ----------
for (const f of readdirSync(join(ROOT, 'dist'))) {
  if (/^game\.zip\.part\d+$/.test(f)) {
    const p = join(ROOT, 'dist', f);
    const sz = sizeOf(p);
    if (!DRY) rmSync(p, { force: true });
    removed.push([f, sz]);
  }
}

// ---------- ③ 删工具链下载缓存 ----------
const dl = join(ROOT, 'tools', 'godot-dl');
if (existsSync(dl)) {
  for (const f of readdirSync(dl)) {
    if (!f.endsWith('.zip')) continue;
    const p = join(dl, f);
    const sz = sizeOf(p);
    if (!DRY) rmSync(p, { force: true });
    removed.push(['tools/godot-dl/' + f, sz]);
  }
}

if (removed.length) {
  console.log('\n🗑️  已删除：');
  for (const [n, s] of removed) console.log('   ' + n.padEnd(40) + mb(s));
  console.log('   小计 ' + mb(removed.reduce((a, [, s]) => a + s, 0)));
}

// ---------- ④ 保留清单 ----------
const zip = join(ROOT, 'dist', '开拓者-殖民地-绿色版.zip');
if (existsSync(zip)) kept.push(['dist/开拓者-殖民地-绿色版.zip', sizeOf(zip)]);
const godotExe = join(ROOT, 'dist-godot', '开拓者-殖民地.exe');
if (existsSync(godotExe)) kept.push(['dist-godot/开拓者-殖民地.exe', sizeOf(godotExe)]);
console.log('\n✅ 保留：');
for (const [n, s] of kept) console.log('   ' + n.padEnd(40) + mb(s));
console.log('\n提示：assets-src/ 已在 electron 打包排除名单里（见 package.json 的 build.files），');
console.log('      所以它不会再被塞进绿色版。');
