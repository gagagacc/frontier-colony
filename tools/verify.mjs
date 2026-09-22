/**
 * 一键验证：语法 → 静态引用 → 导入绑定 → 逻辑冒烟 → 浏览器端 → 核心循环。
 *
 * 用法：
 *   node tools/verify.mjs          只跑不需要 Electron 的部分
 *   node tools/verify.mjs --all    连浏览器端和核心循环一起跑（需要 Electron + dev-server）
 */
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const IS_WIN = process.platform === 'win32';
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', IS_WIN ? 'electron.exe' : 'electron');
const ALL = process.argv.includes('--all');

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (extname(full) === '.js') acc.push(full);
  }
  return acc;
}

/**
 * 各子测试自报的通过数。
 *
 * 之前标题里的「（126 项）」是手写的，加了测试就忘改，汇总表里的数字越来越假。
 * 现在从子进程输出里抓「通过 N」自动填，标题永远和实际一致。
 */
const counts = new Map();

/**
 * 从子进程输出里抓「通过 N · 失败 M」。
 * 注意要同时容忍中文被控制台代码页弄坏的情况 ——
 * 坏掉了就退化成找「数字 · 数字」这种形状，数字不会坏。
 */
function extractCount(text) {
  const s = text || '';
  let m = /通过\s*(\d+)/.exec(s);
  if (!m) m = /(\d{1,4})\s*·\s*(\d{1,4})/.exec(s);
  if (!m) m = /(\d{1,4})\s+(\d{1,4})\s*\n[^\n]*(?:通过|✅)/.exec(s);
  return m ? Number(m[1]) : 0;
}

/** 跑一个子进程：实时转发输出，返回 { ok, count } */
function runChild(cmd, args, label) {
  console.log(`\n${'─'.repeat(60)}\n▶ ${label}\n${'─'.repeat(60)}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  return { ok: r.status === 0, count: extractCount(out) };
}

/** 跑一个 node 脚本，实时转发输出 */
function runNode(label, script) {
  return runChild(process.execPath, [script], label);
}

/** 跑 Electron 脚本（无头） */
function runElectron(label, script) {
  if (!existsSync(ELECTRON)) {
    console.log(`\n${'─'.repeat(60)}\n▶ ${label}\n${'─'.repeat(60)}`);
    console.log('  ⚠ 找不到 Electron，跳过（先跑 npm install）');
    return { ok: true, count: 0 };
  }
  return runChild(ELECTRON, [script], label);
}

/** 第一步：语法检查（最便宜也最常见的问题） */
function syntaxCheck() {
  console.log(`\n${'─'.repeat(60)}\n▶ 语法检查\n${'─'.repeat(60)}`);
  const files = walk(join(ROOT, 'src')).concat(walk(join(ROOT, 'tools')));
  let bad = 0;
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) {
      bad++;
      console.log(`  ❌ ${f.replace(ROOT, '').replace(/\\/g, '/')}`);
      console.log((r.stderr || '').split('\n').slice(0, 4).map(l => '     ' + l).join('\n'));
    }
  }
  console.log(bad ? `  ${bad} 个文件语法错误` : `  ✅ ${files.length} 个文件语法全部正常`);
  return bad === 0;
}

const results = [];
results.push(['语法检查', { ok: syntaxCheck(), count: 0 }]);
results.push(['静态引用（未声明标识符）', runNode('静态引用检查', 'tools/undef.mjs')]);
results.push(['导入绑定有效性', runNode('导入绑定检查', 'tools/checkimports.mjs')]);
// 「用了但没导入」：玩家在建造面板撞到的 TILE is not defined 就是这一类，
// 语法检查与 import 绑定检查都拦不住（import 检查的是「导入的名字存在吗」，
// 而不是「用到的名字导入了吗」）。
results.push(['未导入的自由变量', runNode('未导入自由变量扫描', 'tools/freescan.mjs')]);
results.push(['输入缓冲', runNode('输入缓冲测试', 'tools/inputBuffer.mjs')]);
results.push(['逻辑冒烟', runNode('逻辑冒烟测试', 'tools/smoke.mjs')]);

if (ALL) {
  results.push(['浏览器端', runElectron('浏览器端集成测试', 'tools/headless.cjs')]);
  results.push(['核心循环', runElectron('核心循环玩法测试', 'tools/deep.cjs')]);
  results.push(['设置与模式', runElectron('设置与模式测试', 'tools/settings.cjs')]);
  results.push(['手柄支持', runElectron('手柄支持测试', 'tools/gamepad.cjs')]);
  results.push(['手柄映射', runElectron('手柄映射测试', 'tools/gamepadMap.cjs')]);
}

console.log(`\n${'═'.repeat(60)}\n验证汇总\n${'═'.repeat(60)}`);
let total = 0;
for (const [name, r] of results) {
  total += r.count || 0;
  console.log(`  ${r.ok ? '✅' : '❌'} ${name}${r.count ? `（${r.count} 项）` : ''}`);
}
console.log(`\n  合计 ${total} 项断言`);
const failed = results.filter(([, r]) => !r.ok);
console.log(failed.length ? `\n${failed.length} 项未通过` : '\n全部通过 ✅');
if (!ALL) console.log('\n提示：加 --all 可以连浏览器端与核心循环一起验证（需要 Electron）。');
process.exit(failed.length ? 1 : 0);
