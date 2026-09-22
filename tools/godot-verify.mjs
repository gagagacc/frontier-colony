/**
 * Godot 侧验证入口：生成黄金值 → 跑 Godot headless 测试 → 断言。
 *
 * 用法：node tools/godot-verify.mjs
 * 退出码非 0 = 移植代码与 JS 版出现数值分歧（或 Godot 侧报错）。
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GODOT_CANDIDATES = [
  join(ROOT, 'tools', 'godot-dl', 'exe', 'Godot_v4.4.1-stable_win64_console.exe'),
  join(ROOT, 'tools', 'godot-dl', 'exe', 'Godot_v4.4.1-stable_win64.exe'),
  'godot',
];

const godot = GODOT_CANDIDATES.find(p => p === 'godot' || existsSync(p));
if (!godot) {
  console.error('❌ 找不到 Godot。放进 tools/godot-dl/exe/ 或加进 PATH。');
  process.exit(1);
}

console.log('▶ 生成黄金值（用现有 JS 实现）…');
execFileSync(process.execPath, [join(ROOT, 'tools', 'godot-golden.mjs')], { stdio: 'inherit' });

console.log('▶ 跑 Godot headless 测试…');
let out = '';
try {
  out = execFileSync(godot, [
    '--headless', '--path', join(ROOT, 'godot'),
    '--script', 'res://tests/run_tests.gd',
    '--', `--golden=${join(ROOT, 'godot', 'tests', 'golden.json')}`,
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
} catch (err) {
  out = `${err.stdout || ''}${err.stderr || ''}`;
}

const m = /GODOT_TEST_RESULT (\{.*\})/.exec(out);
if (!m) {
  console.error('❌ 没拿到测试结果。Godot 输出：');
  console.error(out.split('\n').filter(l => /ERROR|error|SCRIPT/i.test(l)).slice(0, 20).join('\n') || out.slice(0, 2000));
  process.exit(1);
}

const res = JSON.parse(m[1]);
console.log(`\nGodot 黄金对比：通过 ${res.pass} · 失败 ${res.fail}`);
if (res.fail) {
  console.log('失败项：');
  for (const f of res.failures) console.log('  - ' + f);
  process.exit(1);
}

// 长时模拟（阶段 13）：把一整套系统连续跑 120 秒 ——
// 「某个函数算得对不对」之外，还要证明「连起来跑不会炸、计数说得通」。
let simOut = '';
try {
  simOut = execFileSync(godot, [
    '--headless', '--path', join(ROOT, 'godot'),
    '--script', 'res://tests/sim_long.gd', '--', '--seconds=120',
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 600000 });
} catch (err) {
  simOut = `${err.stdout || ''}${err.stderr || ''}`;
}
const simLine = simOut.split('\n').find(l => l.startsWith('GODOT_SIM '));
if (simLine) {
  const sim = JSON.parse(simLine.slice('GODOT_SIM '.length));
  console.log(`长时模拟 ${sim.seconds}s：击杀 ${sim.kills} · 弹丸命中 ${sim.hits} · 峰值弹丸 ${sim.projectilesPeak} · 存活 ${sim.alive} · 断言 ${sim.pass} 通过 / ${sim.fail} 失败`);
  if (sim.fail > 0) {
    console.log('失败项：');
    for (const f of sim.failures) console.log('  - ' + f);
    process.exit(1);
  }
} else {
  console.log('⚠️ 长时模拟没有输出结果（跳过）');
}
console.log('Godot 移植与 JS 版逐位一致 ✅');
