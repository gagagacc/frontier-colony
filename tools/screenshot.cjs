/**
 * 截图工具：把关键界面与场景截下来，供人工确认视觉。
 *
 * 为什么需要：这个项目的视觉问题（层级错位、面板看不见、地图一片黑）
 * 用断言很难覆盖 —— 「设置面板打不开」就是一个例子：
 * 面板确实打开了，只是被主菜单盖住了，所有断言都通过，玩家却完全用不了。
 * 有了截图，改完样式可以直接看一眼。
 *
 * 用法：npx electron tools/screenshot.cjs
 * 输出：tools/shots/*.png
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const OUT = path.join(__dirname, 'shots');
app.disableHardwareAcceleration();

const SAVE_DIR = path.join(os.tmpdir(), 'frontier-shots');
function registerIpc() {
  fs.mkdirSync(SAVE_DIR, { recursive: true });
  const slotPath = (s) => path.join(SAVE_DIR, String(s).replace(/[^a-zA-Z0-9_-]/g, '') + '.json');
  ipcMain.handle('save:list', () => []);
  ipcMain.handle('save:exists', () => false);
  ipcMain.handle('save:read', () => null);
  ipcMain.handle('save:write', () => true);
  ipcMain.handle('save:remove', () => true);
  ipcMain.handle('app:info', () => ({ version: 'shots', platform: process.platform, dev: true }));
  ipcMain.handle('window:get', () => ({ fullscreen: false, maximized: false, width: 1280, height: 720, workArea: { width: 1920, height: 1080 } }));
  ipcMain.handle('window:setFullscreen', () => false);
  ipcMain.handle('window:setSize', () => true);
  ipcMain.handle('window:setRatio', () => true);
  ipcMain.handle('steam:status', () => ({ available: false, appId: 0, player: null, achievements: 12 }));
  ipcMain.handle('steam:unlock', () => false);
  ipcMain.handle('steam:setStat', () => false);
  ipcMain.handle('steam:store', () => false);
  ipcMain.handle('steam:achievements', () => ({}));
}

app.whenReady().then(async () => {
  registerIpc();
  const win = new BrowserWindow({
    width: 1280, height: 720, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
      contextIsolation: true, offscreen: true,
    },
  });
  const errs = [];
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 2) errs.push(msg); });
  await win.loadURL(process.env.GAME_URL || 'http://127.0.0.1:5173/index.html');
  await new Promise(r => setTimeout(r, 1800));

  fs.mkdirSync(OUT, { recursive: true });
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
    console.log('  ->', name + '.png');
  };
  const ev = (code) => win.webContents.executeJavaScript(code, true);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  // 1) 主菜单
  await shot('01-main-menu');

  // 2) 设置面板（真实点击）
  await ev(`(() => {
    const b = [...document.querySelectorAll('#mainmenu .btn')].find(x => x.textContent.includes('设置'));
    b && b.click(); return !!b;
  })()`);
  await wait(600);
  await shot('02-settings-keys');

  // 3) 操作说明页签
  await ev(`(() => {
    const b = [...document.querySelectorAll('#modal-root .btn')].find(x => x.textContent.includes('操作说明'));
    b && b.click(); return !!b;
  })()`);
  await wait(400);
  await shot('03-settings-help');

  // 4) 显示页签
  await ev(`(() => {
    const b = [...document.querySelectorAll('#modal-root .btn')].find(x => x.textContent.trim() === '显示');
    b && b.click(); return !!b;
  })()`);
  await wait(400);
  await shot('04-settings-display');
  await ev(`window.__frontier.ui.modals.closeAll()`);

  // 4b) 降落页：自由选点（点一下地图，标记与信息卡都要出现）
  await ev(`(() => {
    const b = [...document.querySelectorAll('#mainmenu .btn')].find(x => x.textContent.includes('开始新开荒'));
    b && b.click(); return !!b;
  })()`);
  await wait(500);
  await ev(`(() => {
    document.querySelectorAll('.char-card')[1]?.click();
    const b = [...document.querySelectorAll('button')].find(x => /确定|选择降落点/.test(x.textContent));
    b && b.click(); return !!b;
  })()`);
  await wait(900);
  await ev(`(() => {
    const c = document.querySelector('#mainmenu canvas');
    if (!c) return false;
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('click', {
      clientX: r.left + r.width * 0.62, clientY: r.top + r.height * 0.38, bubbles: true,
    }));
    return true;
  })()`);
  await wait(400);
  await shot('04b-landing-free');

  // 5) 开一局（固定种子，保证截图可复现）
  await ev(`(async () => {
    const f = window.__frontier;
    f.ui.actions.backToMenu();
    const { RunState } = await import('/src/systems/runState.js');
    const run = new RunState({ seed: 'shot-seed', characterId: 'engineer', planetIndex: 0 });
    f.ui.startRun(run, {});
    return true;
  })()`);
  await wait(1500);
  await shot('05-gameplay');

  // 6) 科技树（防御 + 新增的武器火力分支各截一张）
  await ev(`window.__frontier.ui.actions.openTech()`);
  await wait(700);
  await shot('06-tech-tree');
  await ev(`(() => {
    const tabs = [...document.querySelectorAll('#modal-root button')];
    const b = tabs.find(x => x.textContent.includes('武器火力'));
    b && b.click();
    return !!b;
  })()`);
  await wait(600);
  await shot('06b-tech-weapon');
  await ev(`window.__frontier.ui.modals.closeAll(); window.__frontier.game.paused = false;`);
  await wait(300);

  // 7) 城镇（含军械工坊）
  await ev(`window.__frontier.ui.actions.openTown()`);
  await wait(700);
  await shot('07-town');
  await ev(`window.__frontier.ui.modals.closeAll(); window.__frontier.game.paused = false;`);

  // 8) 行星地图
  await wait(200);
  await ev(`window.__frontier.ui.actions.openMap()`);
  await wait(900);
  await shot('08-world-map');
  await ev(`window.__frontier.ui.modals.closeAll(); window.__frontier.game.paused = false;`);

  // 9) 虫巢副本 + 副本地图
  const dungeon = await ev(`(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    const nest = run.world.nests[0];
    // 给玩家一点装备再进副本，否则会被 7 级巢穴当场打死（截图就只剩死亡提示）
    run.gainXp(60000);
    run.player.hp = run.player.hpMax;
    run.player.noRespawn = false;
    run.player.x = nest.x + 20; run.player.y = nest.y;
    const ok = run.playerSystem.enterNest(nest);
    await new Promise(r => setTimeout(r, 900));
    const inner = f.game.run;
    inner.player.hp = inner.player.hpMax;
    inner.player.invuln = 30;      // 截图期间别被打死
    // 把玩家挪到中段，让地图看起来有进度
    if (inner.dungeon) {
      inner.player.x = (inner.dungeon.entry.x + inner.dungeon.boss.x) * 0.4;
      inner.player.y = inner.dungeon.entry.y;
      inner.player.lastX = inner.player.x; inner.player.lastY = inner.player.y;
    }
    return { ok, isInner: !!inner.isDungeonInner, tier: inner.dungeon?.tier };
  })()`);
  console.log('  副本:', JSON.stringify(dungeon));
  await wait(900);
  await shot('09-dungeon');

  await ev(`window.__frontier.ui.actions.openMap()`);
  await wait(900);
  await shot('10-dungeon-map');
  await ev(`window.__frontier.ui.modals.closeAll(); window.__frontier.game.paused = false;`);

  console.log('\n控制台错误:', errs.length ? errs.slice(0, 10).join('\n') : '（无）');
  console.log('输出目录:', OUT);
  app.exit(0);
});
