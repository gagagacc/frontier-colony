/**
 * 打包「解压即玩」的绿色版（不需要对方装 Node / Electron）。
 *
 * 为什么不用 electron-builder：它是 devDependency，而这个项目一直是零依赖跑起来的；
 * 直接手工拼一个 Electron 的便携目录更快也更可控 —— 布局就是 Electron 认的
 * `resources/app/`，不需要 asar、不需要联网装打包器。
 *
 * 用法：
 *   node tools/make-portable.mjs                  # 只生成文件夹
 *   node tools/make-portable.mjs --zip            # 顺便压成 zip（用系统自带 tar，比 Compress-Archive 快很多）
 *   node tools/make-portable.mjs --zip --split    # 再切成 60MB 分卷（绕过微信/QQ 的 100MB 上限）
 *   node tools/make-portable.mjs --zip --split=40 # 自定义分卷大小（MB）
 *
 * 产物：dist/开拓者-殖民地-绿色版/
 *   ├─ 开拓者.exe            ← 双击就能玩（已改名，但图标仍是 Electron 的）
 *   ├─ 启动游戏.cmd          ← 等价入口（路径含中文时更保险）
 *   ├─ 怎么玩.txt            ← 给朋友看的说明
 *   └─ resources/app/…       ← 游戏本体（index.html / src / assets / electron）
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const NAME = '开拓者-殖民地-绿色版';
const OUT = join(DIST, NAME);
const ELECTRON_DIST = join(ROOT, 'node_modules', 'electron', 'dist');
const BUILT = join(DIST, 'win-unpacked');          // electron-builder 的产物（图标 + 版本信息都在）
const APP = join(OUT, 'resources', 'app');
const DO_ZIP = process.argv.includes('--zip');
const SPLIT_ARG = process.argv.find(a => a === '--split' || a.startsWith('--split='));
const SPLIT = !!SPLIT_ARG;
const SPLIT_MB = (() => {
  const m = /^--split=(\d+)$/.exec(SPLIT_ARG || '');
  return m ? Math.max(10, Number(m[1])) : 60;
})();

/*
 * 优先用 electron-builder 的产物做底子。
 *
 * `npm run dist:dir` 出来的 dist/win-unpacked 里，exe **带着游戏图标和版本信息**
 * （产品名 / 公司 / 版本号），这才是能上架 Steam、发给朋友也体面的那份。
 * 没跑过 electron-builder 时才退回「手工拼 Electron 便携目录」——
 * 那条路的 exe 图标还是 Electron 默认的。
 */
const USE_BUILT = existsSync(join(BUILT, 'Colony Frontier.exe'));
if (!USE_BUILT && !existsSync(ELECTRON_DIST)) {
  console.error('[错误] 既没有 dist/win-unpacked（npm run dist:dir），也没有 node_modules/electron/dist —— 先跑 npm install');
  process.exit(1);
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

console.log('▶ 清理旧产物…');
rmSync(OUT, { recursive: true, force: true });

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

if (USE_BUILT) {
  console.log('▶ 用 electron-builder 的产物打底（图标与版本信息都嵌在 exe 里）…');
  cpSync(BUILT, OUT, { recursive: true });
  // 统一成一个好认的名字（改名不影响 exe 内嵌的图标/版本信息）
  renameSync(join(OUT, 'Colony Frontier.exe'), join(OUT, '开拓者.exe'));
} else {
  console.log('（没找到 dist/win-unpacked，退回手工拼装 —— 先跑 npm run dist:dir 会得到带图标的正式版）');
  mkdirSync(APP, { recursive: true });
  console.log('▶ 拷贝 Electron 运行时（约 270MB，稍等）…');
  cpSync(ELECTRON_DIST, OUT, { recursive: true });
  // 默认占位 app：有 resources/app 之后它就没用了，留着只是白占空间
  rmSync(join(OUT, 'resources', 'default_app.asar'), { force: true });

  console.log('▶ 写入游戏本体…');
  for (const item of ['index.html', 'src', 'assets', 'electron']) {
    const from = join(ROOT, item);
    if (!existsSync(from)) { console.warn(`   ⚠ 缺少 ${item}，跳过`); continue; }
    cpSync(from, join(APP, item), { recursive: true });
  }
  // assets 里的过程性产物（截图/清单）不用带走，但 manifest 与图标要留
  rmSync(join(APP, 'assets', 'shots'), { recursive: true, force: true });

  // package.json：只保留 Electron 启动需要的那几个字段
  writeFileSync(join(APP, 'package.json'), JSON.stringify({
    name: pkg.name,
    productName: pkg.productName,
    version: pkg.version,
    description: pkg.description,
    main: pkg.main,
    author: pkg.author,
    license: pkg.license,
  }, null, 2) + '\n', 'utf8');

  const exeOld = join(OUT, 'electron.exe');
  if (existsSync(exeOld)) renameSync(exeOld, join(OUT, '开拓者.exe'));
}

/*
 * 启动脚本刻意写成**纯 ASCII**。
 *
 * 这是踩过的坑：.cmd 里的中文要受控制台代码页影响（GBK / UTF-8 两种系统设置都有），
 * 写成 UTF-8 的脚本在一部分机器上会把路径变成乱码、连命令都解析不了 ——
 * 玩家那边的表现就是「双击没反应」。用通配符引用 exe，脚本里就不需要任何中文。
 */
writeFileSync(join(OUT, '启动游戏.cmd'),
  '@echo off\r\n'
  + 'rem Portable launcher: start the only .exe next to this script.\r\n'
  + 'cd /d "%~dp0"\r\n'
  + 'for %%f in ("*.exe") do start "" "%%~ff"\r\n', 'ascii');

writeFileSync(join(OUT, '怎么玩.txt'), [
  '开拓者：殖民地 —— 外星开荒（测试版）',
  '',
  '【怎么启动】',
  '  双击「开拓者.exe」（或「启动游戏.cmd」）。第一次开 Windows 可能会问',
  '  「是否允许此应用对你的设备进行更改」——选“是”即可，不用装任何东西。',
  '',
  '【怎么玩】',
  '  W A S D        移动（Shift 冲刺，空格闪避）',
  '  E              采集 / 维修（按住）；站在核心舱废墟旁按住 E 重建',
  '  鼠标左键       开火（打空会自动换弹，R 也能手动换）',
  '  1-8            快捷栏：1-4 武器、5 装弹、6-8 消耗品',
  '  空格           闪避翻滚（有无敌帧）',
  '  F              上车 / 进虫巢副本 / 与遗迹交互',
  '  B / T / G / V  建造、科技、城镇、实验科技',
  '  Tab            背包与装备（有排序键）',
  '  M              行星地图 / 虫巢地图',
  '  Esc            暂停（里面能存读档、看设置与操作说明、退出游戏）',
  '',
  '【开局三步】',
  '  1. 在地图上点一下选降落点（绿圈=可以落），按「降落」；',
  '  2. 先按 E 采资源，再按 B 铺【防御塔基座】并空投防御塔；',
  '  3. 守住第一波虫潮 —— 打退一波会给一次实验科技三选一。',
  '',
  '【存档在哪】',
  '  存档跟着你的 Windows 用户走：%APPDATA%\\Colony Frontier\\saves',
  '  所以换台电脑玩不会带着存档；把那个 saves 文件夹复制过去即可。',
  '',
  '【异常怎么办】',
  '  游戏里按 Esc → 错误日志，能看到出错的文件与行号，把那段发我最快定位。',
  '  也可以按 F12 打开控制台，输入 __frontierErrors 回车。',
  '',
  `版本 ${pkg.version} · 打包时间 ${new Date().toLocaleString()}`,
].join('\r\n'), 'utf8');

// 统计体积
const total = execFileSync(process.platform === 'win32' ? 'powershell' : 'sh', process.platform === 'win32'
  ? ['-NoProfile', '-Command', `(Get-ChildItem -LiteralPath '${OUT}' -Recurse -File | Measure-Object Length -Sum).Sum`]
  : ['-c', `du -sb '${OUT}' | cut -f1`], { encoding: 'utf8' }).trim();
console.log(`\n✅ 绿色版已生成：${relative(ROOT, OUT)}  （${mb(Number(total))}）`);

if (DO_ZIP) {
  const zip = join(DIST, `${NAME}.zip`);
  rmSync(zip, { force: true });
  console.log('▶ 压缩中（用系统自带 tar，268MB 大约 1-2 分钟）…');
  // Windows 10+ 自带 bsdtar：-a 按扩展名选 zip 格式
  execFileSync('tar', ['-a', '-c', '-f', zip, '-C', DIST, NAME], { stdio: 'inherit' });
  const zsize = statSync(zip).size;
  console.log(`\n✅ 压缩包：${relative(ROOT, zip)}  （${mb(zsize)}）`);
  console.log('   把这个 zip 发给朋友就行。');

  /*
   * 分卷：微信 / QQ 的单个文件上限常在 100MB，而压缩包正好 110MB 左右卡在门口。
   * zip 本身不支持分卷，但**按字节切开再拼回去**是最稳的土办法：
   * 附一个「合并并解压.cmd」，朋友双击就能得到完整压缩包。
   */
  if (SPLIT) {
    const CHUNK = SPLIT_MB * 1024 * 1024;
    const buf = readFileSync(zip);
    const parts = [];
    // 分卷统一叫 game.zip.partNN（纯 ASCII），脚本里就不需要出现任何中文
    for (let i = 0, n = 1; i < buf.length; i += CHUNK, n++) {
      const slice = buf.subarray(i, Math.min(i + CHUNK, buf.length));
      const p = join(DIST, `game.zip.part${String(n).padStart(2, '0')}`);
      writeFileSync(p, slice);
      parts.push({ p, size: slice.length });
    }
    const cmd = [
      '@echo off',
      'rem Join the split volumes back into one zip, then extract it.',
      'rem (ASCII only on purpose: CJK inside .cmd breaks on some code pages.)',
      'setlocal',
      'cd /d "%~dp0"',
      'if exist game.zip del game.zip',
      'copy /b game.zip.part* game.zip >nul',
      'if errorlevel 1 goto failed',
      'powershell -NoProfile -Command "Expand-Archive -LiteralPath \'game.zip\' -DestinationPath \'.\' -Force"',
      'if errorlevel 1 goto failed',
      'echo.',
      'echo Done! Open the extracted folder and run the .exe inside.',
      'pause',
      'exit /b 0',
      ':failed',
      'echo Join/extract FAILED. Make sure every part file is in this folder.',
      'pause',
      'exit /b 1',
    ].join('\r\n');
    // 分卷也用 ASCII 名（game.zip.partNN），脚本里就不出现任何中文
    writeFileSync(join(DIST, '合并并解压.cmd'), cmd, 'ascii');
    console.log(`\n✅ 已切成 ${parts.length} 个分卷（每卷 ${SPLIT_MB}MB 上限）：`);
    for (const { p, size } of parts) console.log(`   ${relative(ROOT, p)}  （${mb(size)}）`);
    console.log(`   连同「合并并解压.cmd」一起发给朋友：他全部放进同一个文件夹、双击那个 cmd 就行。`);
  }
} else {
  console.log('   想直接得到压缩包：node tools/make-portable.mjs --zip');
  console.log('   微信/QQ 有 100MB 上限时：node tools/make-portable.mjs --zip --split');
}
console.log('\n提示：聊天软件对单个文件常有 100MB 左右的限制，压缩后是 110MB 左右，');
console.log('      发不动就用 --split 切成 60MB 的分卷，或者走网盘 / U 盘。');
