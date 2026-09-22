/**
 * 用 Godot 自己截图：跑指定帧数后把 viewport 存成 PNG 并退出。
 *
 * 为什么不用系统 API 抓窗口：Godot 是 GPU 渲染，抓屏经常抓到别的窗口或一片黑
 *（第一次就抓到桌面壁纸）。让游戏在 `frame_post_draw` 之后自己取 viewport 最可靠，
 * 也能在无人值守的流水线里跑。
 *
 * 用法：node tools/godot-shot.mjs --out tools/shots/godot-game.png [--seed xxx] [--frames 90] [--move 1,0]
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

const OUT = resolve(ROOT, arg('out', 'tools/shots/godot-game.png'));
const SEED = arg('seed', 'frontier-golden-a');
const FRAMES = arg('frames', '90');
const MOVE = arg('move', '');
const FIRE = arg('fire', '');
const BUILD = arg('build', '');
const WAVETIMER = arg('wavetimer', '');
const DUNGEON = arg('dungeon', '');
const TECH = arg('tech', '');
const BOSSVIEW = arg('bossview', '');
const PANEL = arg('panel', '');
const MENU = arg('menu', '0');
const FLOW = arg('flow', '');

const GODOT = [
  join(ROOT, 'tools', 'godot-dl', 'exe', 'Godot_v4.4.1-stable_win64_console.exe'),
  join(ROOT, 'tools', 'godot-dl', 'exe', 'Godot_v4.4.1-stable_win64.exe'),
].find(p => existsSync(p));
if (!GODOT) { console.error('找不到 Godot'); process.exit(1); }

mkdirSync(dirname(OUT), { recursive: true });
const args = ['--path', join(ROOT, 'godot'), '--resolution', '1280x720', '--'];
args.push(`--shot=${OUT}`, `--frames=${FRAMES}`, `--seed=${SEED}`);
if (MOVE) args.push(`--move=${MOVE}`);
if (FIRE) args.push(`--fire=${FIRE}`);
if (BUILD) args.push(`--build=${BUILD}`);
if (WAVETIMER) args.push(`--wavetimer=${WAVETIMER}`);
if (DUNGEON) args.push(`--dungeon=${DUNGEON}`);
if (TECH) args.push(`--tech=${TECH}`);
if (BOSSVIEW) args.push(`--bossview=${BOSSVIEW}`);
if (PANEL) args.push(`--panel=${PANEL}`);
args.push(`--menu=${MENU}`);
if (FLOW) args.push(`--flow=${FLOW}`);

console.log('▶ 启动 Godot 截图…');
// 注意：Godot 退出码非 0 时 execFileSync 会抛，但**截图可能已经成功**，
// 所以这里接住异常、照样去检查文件（否则会把「已经拍好的图」当成失败）
let out = '';
try {
  out = execFileSync(GODOT, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 180000 });
} catch (err) {
  out = `${err.stdout || ''}${err.stderr || ''}`;
}
const line = out.split('\n').filter(l => l.includes('[godot]'));
for (const l of line) console.log('  ' + l.trim());
// 顺手把脚本报错也打出来：
// 之前只看 `[godot]` 行，结果「面板构建到一半抛异常」这类问题完全看不见 ——
// 表现只是「后半截内容没出现」，非常难查。
const errs = out.split('\\n').filter(l => /SCRIPT ERROR|Invalid (call|access)|Nonexistent/.test(l));
if (errs.length) {
  console.log('  ⚠️ 有脚本报错（这通常意味着某段逻辑被中断了）：');
  for (const e of errs.slice(0, 5)) console.log('     ' + e.trim().slice(0, 180));
}
console.log(existsSync(OUT) ? `✅ 截图已生成：${OUT}` : '❌ 截图没生成');
process.exit(existsSync(OUT) ? 0 : 1);
