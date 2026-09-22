/**
 * 一键导出 Godot 版（Windows）。
 *
 * 用法：node tools/godot-export.mjs [--debug]
 *
 * 前置：Godot 的**导出模板**。模板是单独下载的（约 1 GB），不属于引擎本体：
 *   https://github.com/godotengine/godot/releases/download/4.4.1-stable/Godot_v4.4.1-stable_export_templates.tpz
 * 下载后改名成 `templates.tpz` 放到 tools/godot-dl/，本脚本会自动装到
 * `%APPDATA%\Godot\export_templates\4.4.1.stable\`（装完就能反复导出）。
 *
 * 这一步的规矩和 JS 版一致：**产物要能直接发给朋友**，所以导出完会检查
 * exe 与 pck 是否都在，并打印体积。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GODOT = join(ROOT, 'tools', 'godot-dl', 'exe', 'Godot_v4.4.1-stable_win64_console.exe');
const TPZ = join(ROOT, 'tools', 'godot-dl', 'templates.tpz');
const TEMPLATE_DIR = join(process.env.APPDATA || '', 'Godot', 'export_templates', '4.4.1.stable');
const OUT_DIR = join(ROOT, 'dist-godot');
const DEBUG_BUILD = process.argv.includes('--debug');
const PRESET = 'Windows Desktop';

function log(msg) { console.log(msg); }

if (!existsSync(GODOT)) {
  console.error(`❌ 找不到 Godot 可执行文件：${GODOT}`);
  process.exit(1);
}

// 1) 模板：没有就尝试从本地 tpz 安装，还是没有就明确告诉用户去下载
if (!existsSync(TEMPLATE_DIR) || readdirSync(TEMPLATE_DIR).length === 0) {
  if (existsSync(TPZ)) {
    log('▶ 安装导出模板…');
    mkdirSync(TEMPLATE_DIR, { recursive: true });
    const tmp = join(ROOT, 'tools', 'godot-dl', '_tpl');
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    // tpz 就是 zip，但 Expand-Archive 只认 .zip 后缀 —— 先复制成 .zip 再解
    const asZip = join(ROOT, 'tools', 'godot-dl', '_tpl.zip');
    copyFileSync(TPZ, asZip);
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${asZip}' -DestinationPath '${tmp}' -Force`], { stdio: 'inherit' });
    rmSync(asZip, { force: true });
    const inner = join(tmp, 'templates');
    if (existsSync(inner)) {
      // ⚠️ 不能用 renameSync：模板装在 C 盘、工程在 D 盘，跨盘 rename 会 EXDEV。
      // 用 PowerShell 复制（1 GB 级别，走系统拷贝更快）。
      execFileSync('powershell', ['-NoProfile', '-Command',
        `Copy-Item -Path '${inner}\\*' -Destination '${TEMPLATE_DIR}' -Recurse -Force`], { stdio: 'inherit' });
    }
    rmSync(tmp, { recursive: true, force: true });
    log('✅ 模板已安装到 ' + TEMPLATE_DIR);
  } else {
    console.error('❌ 还没有导出模板（约 1 GB，引擎本体不带）。请先下载：');
    console.error('   https://github.com/godotengine/godot/releases/download/4.4.1-stable/Godot_v4.4.1-stable_export_templates.tpz');
    console.error(`   存成 ${TPZ} 后重跑本脚本即可（会自动安装）。`);
    process.exit(2);
  }
}

// 2) 导出
mkdirSync(OUT_DIR, { recursive: true });
log(`▶ 导出 ${DEBUG_BUILD ? 'debug' : 'release'} …`);
// 注意下标：--path 后面跟的是工程路径，模式开关不能写到那个位置
const mode = DEBUG_BUILD ? '--export-debug' : '--export-release';
const args = ['--headless', '--path', join(ROOT, 'godot'), mode, PRESET];
execFileSync(GODOT, args, { stdio: 'inherit', cwd: ROOT });

// 2.5) 带 Steam 模块的模板：运行时文件也要一起放进产物目录
//
// GodotSteam 走的是「换模板」路线：预设里 custom_template/release 指向
// godotsteam.441.template.windows64.exe，**运行时还需要同目录的 steam_api64.dll**，
// 开发期还要 steam_appid.txt（480 = Steamworks 的 Spacewar 测试 AppID）。
// 少了这两个文件，导出照样成功，但一启动就报「Steam API 初始化失败」。
const steamDll = join(ROOT, 'godot', 'addons', 'godotsteam', 'steam_api64.dll');
if (existsSync(steamDll)) {
  // 目标可能被上一次运行的游戏进程占用（EBUSY）—— 那是「文件已经是对的了」，
  // 不该让整个导出失败，警告一下继续。
  try {
    copyFileSync(steamDll, join(OUT_DIR, 'steam_api64.dll'));
  } catch (err) {
    log('⚠️ steam_api64.dll 没能覆盖（' + err.code + '）—— 目标可能正被运行中的游戏占用，' +
      '如果它已存在就仍然可用');
  }
  const appidPath = join(OUT_DIR, 'steam_appid.txt');
  if (!existsSync(appidPath)) writeFileSync(appidPath, '480');
  log('▶ steam_api64.dll 与 steam_appid.txt 已就位（发行时把 480 换成自己的 AppID）');
}

// 3) 结果检查：exe 必须真的生出来
const exe = join(OUT_DIR, '开拓者-殖民地.exe');
const pck = join(OUT_DIR, '开拓者-殖民地.pck');
if (!existsSync(exe)) {
  console.error('❌ 导出失败：没有生成 exe');
  process.exit(3);
}
const mb = (p) => existsSync(p) ? (statSync(p).size / 1048576).toFixed(1) + ' MB' : '—';
log(`✅ 导出完成：${exe}（${mb(exe)}）`);
log(`   数据包：${pck}（${mb(pck)}）${existsSync(pck) ? '' : '（内嵌在 exe 里）'}`);
log('   直接把这个目录发给朋友就能玩。');
