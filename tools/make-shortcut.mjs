/**
 * 在桌面（以及开始菜单）创建游戏快捷方式。
 *
 * 为什么用 Node 而不是 .cmd：批处理文件里的中文要受控制台代码页影响，
 * 一不小心就变成乱码，连命令本身都解析不了。Node 默认 UTF-8，
 * 而且这里本来就有 Node，没理由再引一层 .cmd。
 *
 * 用法：
 *   node tools/make-shortcut.mjs           # JS/Electron 版（默认）
 *   node tools/make-shortcut.mjs --godot   # Godot 绿色版
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FOR_GODOT = process.argv.includes('--godot');
const ICON = FOR_GODOT ? join(ROOT, 'godot', 'icon.ico') : join(ROOT, 'assets', 'icon.ico');
const VBS = join(ROOT, 'tools', 'launch-hidden.vbs');
const NAME = FOR_GODOT ? '开拓者-殖民地（Godot 版）' : '开拓者-殖民地';

if (!existsSync(ICON)) {
  console.log('图标不存在，正在生成…');
  execFileSync(process.execPath, [join(ROOT, 'tools', 'make-icon.mjs')], { stdio: 'inherit' });
}

/*
 * 两种模式的目标不一样：
 *   - JS 版走 wscript + 隐藏启动器（双击不闪黑框，也不依赖 electron 的绝对路径）；
 *   - Godot 版直接指向导出的 exe（它自己就是窗口程序，不需要壳），
 *     但**工作目录必须设成 exe 所在目录** —— 绿色版靠同目录的 .pck 找资源，
 *     工作目录错了会起不来。
 */
let target;
let args = '';
let workDir;
if (FOR_GODOT) {
  const exe = join(ROOT, 'dist-godot', '开拓者-殖民地.exe');
  if (!existsSync(exe)) {
    console.error('❌ 还没导出 Godot 绿色版：' + exe);
    console.error('   先跑：node tools/godot-export.mjs');
    process.exit(2);
  }
  target = exe;
  workDir = dirname(exe);
} else {
  if (!existsSync(VBS)) {
    console.error(`[错误] 找不到启动器：${VBS}`);
    process.exit(1);
  }
  target = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');
  args = `"${VBS}"`;
  workDir = ROOT;
}

const ps = `
$ErrorActionPreference = 'Stop'
$ws = New-Object -ComObject WScript.Shell
$targets = @(
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs')
)
foreach ($dir in $targets) {
  if (-not (Test-Path $dir)) { continue }
  $path = Join-Path $dir '${NAME}.lnk'
  $lnk = $ws.CreateShortcut($path)
  $lnk.TargetPath = '${target}'
  if ('${args}' -ne '') { $lnk.Arguments = '${args}' }
  $lnk.WorkingDirectory = '${workDir}'
  $lnk.IconLocation = '${ICON},0'
  $lnk.Description = '开拓者：殖民地 —— 2D 外星殖民：塔防 + 开放世界 + 城镇经营'
  $lnk.Save()
  Write-Output $path
}
`;

// 脚本写进临时文件再执行：避免把多行中文塞进命令行参数的编码泥潭
const psFile = join(tmpdir(), 'frontier-shortcut.ps1');
writeFileSync(psFile, '\ufeff' + ps, 'utf8');

try {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile], {
    encoding: 'utf8',
  });
  for (const line of out.split(/\r?\n/)) {
    const t = line.trim();
    if (t.toLowerCase().endsWith('.lnk')) console.log(`  已创建：${t}`);
  }
  console.log('\n完成。桌面上应该能看到「' + NAME + '」快捷方式了。');
} catch (err) {
  console.error('[失败] 创建快捷方式出错：', err.message);
  if (err.stdout) console.error(String(err.stdout));
  process.exit(1);
}

void mkdirSync;
