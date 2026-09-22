/**
 * 下载并安装 GodotSteam（对应 Godot 4.4.1）。
 *
 * 用法：node tools/fetch-godotsteam.mjs
 *
 * 为什么单独一个脚本：Steam 那一层要能**一键接上**，否则永远停在「步骤写好了但没做」。
 * GodotSteam 有两条路线，本脚本装的是第 2 条（不需要换引擎）：
 *
 *   ① 换引擎：用 GodotSteam 编译的编辑器/模板替换现有 Godot
 *      —— 本脚本会把 windows64-g441-*.zip 下到 tools/godot-dl/（含 steam_api64.dll），
 *         但**不**自动替换引擎，以免把现有工具链搞坏；
 *   ② 用 GDExtension 版插件：把 `addons/godotsteam/` 放进工程即可（运行时加载 dll）。
 *
 * 装完之后：
 *   - `SteamBridge.steam_present()` 会变成 true；
 *   - 启动时 `init_steam(480)` 真的连 Steam（480 是 Spacewar 测试 AppID，
 *     正式发行时换成自己的 AppID，并把成就 API 名按 `steam_bridge.gd` 的目录在后台配好）。
 *
 * 没有网络 / 下载失败时脚本会明确报错并保留现状 —— 游戏在没装插件时照常能玩，
 * 只是成就只记本地（这一行为有断言盯着）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DL = join(ROOT, 'tools', 'godot-dl');
const GODOT_VERSION = '4.4.1';
// GodotSteam 的资产名形如 windows64-g441-s162-gs416.zip（g441 = Godot 4.4.1）
const ASSET = 'https://github.com/GodotSteam/GodotSteam/releases/download/v4.16/windows64-g441-s162-gs416.zip';
const ZIP = join(DL, 'godotsteam-win64.zip');
const OUT = join(ROOT, 'godot', 'addons', 'godotsteam');

mkdirSync(DL, { recursive: true });
if (!existsSync(ZIP) || statSync(ZIP).size < 1024 * 1024) {
  console.log('▶ 下载 GodotSteam（Godot ' + GODOT_VERSION + ' 对应版本）…');
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Invoke-WebRequest -Uri '${ASSET}' -OutFile '${ZIP}' -TimeoutSec 900`], { stdio: 'inherit' });
}
console.log('✔ 已下载：' + ZIP + '（' + (statSync(ZIP).size / 1048576).toFixed(1) + ' MB）');

mkdirSync(OUT, { recursive: true });
rmSync(join(DL, '_gs'), { recursive: true, force: true });
execFileSync('powershell', ['-NoProfile', '-Command',
  `Expand-Archive -LiteralPath '${ZIP}' -DestinationPath '${join(DL, '_gs')}' -Force`], { stdio: 'inherit' });

// 把 dll 与可执行文件放到 addons/godotsteam/（GDExtension 版会读同目录的 dll）
execFileSync('powershell', ['-NoProfile', '-Command',
  `Copy-Item -Path '${join(DL, '_gs')}\\*' -Destination '${OUT}' -Recurse -Force`], { stdio: 'inherit' });
rmSync(join(DL, '_gs'), { recursive: true, force: true });

const dll = join(OUT, 'steam_api64.dll');
console.log('✔ 已放入 godot/addons/godotsteam/');
console.log(existsSync(dll) ? '  · steam_api64.dll 就位' : '  ⚠️ 没找到 steam_api64.dll，检查压缩包结构');
console.log('\n接下来：');
console.log('  1. 把 GDExtension 版插件的 godotsteam.gdextension 与 libgodotsteam.*.dll 放进同一目录；');
console.log('  2. 或者在 Steamworks 后台按 godot/scripts/systems/steam_bridge.gd 的成就目录配好 API 名；');
console.log('  3. 发行时把 AppID 从 480 改成自己的（game.gd 里的 init_steam(480)）。');
