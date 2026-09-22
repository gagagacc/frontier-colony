/**
 * 设置与模式测试：在无头浏览器里验证
 *   1. 按键绑定真的生效（改键之后按新键能触发动作、旧键不再触发）
 *   2. 冲突处理（一个键只能归一个动作）、恢复默认、持久化
 *   3. 显示设置（界面缩放、全屏接口、窗口预设）能改且不报错
 *   4. 纯塔防模式真的能从主菜单开起来，而且没有角色、没有巢穴
 *
 * 用法：npx electron tools/settings.cjs
 * 需要先跑 npm run dev（同 headless.cjs）
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const errors = [];
let exitCode = 0;

process.on('uncaughtException', (err) => {
  console.error('[settings] 主进程未捕获异常:', (err && err.stack) || err);
  errors.push('main uncaughtException: ' + (err && err.message));
});
process.on('unhandledRejection', (err) => {
  console.error('[settings] 主进程未处理拒绝:', (err && err.stack) || err);
  errors.push('main unhandledRejection: ' + (err && err.message));
});

// 存档 IPC 桩（和 headless 一样，避免 preload 报「没有处理器」）
const SAVE_DIR = path.join(os.tmpdir(), 'frontier-settings-saves');
function registerIpc() {
  fs.mkdirSync(SAVE_DIR, { recursive: true });
  const slotPath = (slot) => path.join(SAVE_DIR, String(slot).replace(/[^a-zA-Z0-9_-]/g, '') + '.json');
  ipcMain.handle('save:list', () => []);
  ipcMain.handle('save:exists', (_e, slot) => fs.existsSync(slotPath(slot)));
  ipcMain.handle('save:read', (_e, slot) => (fs.existsSync(slotPath(slot)) ? JSON.parse(fs.readFileSync(slotPath(slot), 'utf8')) : null));
  ipcMain.handle('save:write', (_e, slot, data) => { fs.writeFileSync(slotPath(slot), JSON.stringify(data), 'utf8'); return true; });
  ipcMain.handle('save:remove', (_e, slot) => { if (fs.existsSync(slotPath(slot))) fs.unlinkSync(slotPath(slot)); return true; });
  ipcMain.handle('app:info', () => ({ version: '0.1.0-headless', platform: process.platform, dev: true }));
  // 窗口控制也要有桩，否则窗口相关的按钮会抛错
  ipcMain.handle('window:get', () => ({ fullscreen: false, maximized: false, width: 1280, height: 720, workArea: { width: 1920, height: 1080 } }));
  ipcMain.handle('window:setFullscreen', () => false);
  ipcMain.handle('window:setSize', () => true);
  ipcMain.handle('window:setRatio', () => true);
  // Steam 桥的桩：测试环境没有 Steam，按「未连接」回，让游戏走降级路径。
  // 不加这些桩的话，渲染进程的 invoke 会以「No handler registered」reject，
  // 污染控制台错误统计（真实打包环境里 preload 和主进程是一起发的，不会缺）。
  ipcMain.handle('steam:status', () => ({ available: false, appId: 0, player: null, achievements: 12 }));
  ipcMain.handle('steam:unlock', () => false);
  ipcMain.handle('steam:setStat', () => false);
  ipcMain.handle('steam:store', () => false);
  ipcMain.handle('steam:achievements', () => ({}));
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  registerIpc();
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
    },
  });

  win.webContents.on('console-message', (e, level, message, line, source) => {
    if (level >= 2) {
      if (/Insecure Content-Security-Policy/.test(message)) return;
      errors.push(`${message} @ ${source}:${line}`);
    }
  });
  win.webContents.on('render-process-gone', (e, d) => errors.push('渲染进程崩溃: ' + JSON.stringify(d)));

  const url = process.env.GAME_URL || 'http://127.0.0.1:5173/index.html';
  console.log('[settings] 加载', url);
  try {
    await win.loadURL(url);
  } catch (err) {
    console.error('[settings] 打不开页面：', err.message, '\n  请先启动 node tools/dev-server.mjs');
    app.exit(1);
    return;
  }

  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const evaluate = async (code) => {
    try {
      return await win.webContents.executeJavaScript(code, true);
    } catch (err) {
      console.error('[settings] evaluate 失败:', (err && err.stack) || err);
      errors.push('evaluate: ' + (err && err.message));
      return null;
    }
  };

  await wait(1500);

  // 每次跑测试都从「没动过设置」的状态开始：设置存在 localStorage 里，
  // 上一次测试留下的自定义键会让「默认值」断言全部失败（真实踩过）。
  await evaluate(`(() => { try { localStorage.removeItem('frontier-settings-v1'); } catch {} return true; })()`);
  await win.webContents.reload();
  await wait(1800);

  // =========================================================
  section('1. 设置层的存在与默认值');
  // =========================================================
  const base = await evaluate(`(async () => {
    const f = window.__frontier;
    // 必须用游戏自己加载的那份 settings —— 用 import() 再导一次会拿到**另一个实例**，
    // 改它不会影响游戏，看起来像「改了没用」。
    const S = await import('/src/core/settings.js');
    const m = f.modes;
    return {
      hasSettings: !!f.settings,
      sameInstance: f.settings === S.settings,
      bindCount: S.BINDABLE_ACTIONS.length,
      upKeys: f.settings.keysFor('up'),
      buildKeys: f.settings.keysFor('build'),
      pauseKeys: f.settings.keysFor('pause'),
      labelW: S.keyLabel('KeyW'),
      labelArrow: S.keyLabel('ArrowUp'),
      labelSpace: S.keyLabel('Space'),
      defaultTechKeys: f.settings.keysFor('tech'),
      storedRaw: (() => { try { return localStorage.getItem('frontier-settings-v1'); } catch { return 'n/a'; } })(),
      modes: m.MODE_LIST,
      hasOpenSettings: typeof f.ui.openSettings === 'function',
      mode: f.ui.mode,
    };
  })()`);
  console.log('  ', JSON.stringify(base));
  check('设置模块可用', base?.hasSettings === true);
  check('可改键的动作数量合理', base?.bindCount >= 20, `${base?.bindCount}`);
  check('默认移动键是 W / ↑', JSON.stringify(base?.upKeys) === '["KeyW","ArrowUp"]', JSON.stringify(base?.upKeys));
  check('默认建造键是 B', JSON.stringify(base?.buildKeys) === '["KeyB"]', JSON.stringify(base?.buildKeys));
  check('默认暂停键是 Esc', JSON.stringify(base?.pauseKeys) === '["Escape"]', JSON.stringify(base?.pauseKeys));
  check('按键显示名友好', base?.labelW === 'W' && base?.labelArrow === '↑' && base?.labelSpace === '空格',
    `${base?.labelW}/${base?.labelArrow}/${base?.labelSpace}`);
  check('有两种游戏模式', Array.isArray(base?.modes) && base.modes.length === 2, JSON.stringify(base?.modes));
  check('主菜单有设置入口', base?.hasOpenSettings === true);

  // =========================================================
  section('2. 改键真的生效');
  // =========================================================
  const rebind = await evaluate(`(async () => {
    const f = window.__frontier;
    const s = { settings: f.settings };
    const input = f.input;
    const out = {};

    // 先进一局，才有得测
    if (!f.game.run) {
      const start = [...document.querySelectorAll('#mainmenu .btn')].find(x => x.textContent.includes('开始新开荒'));
      start && start.click();
      await new Promise(r => setTimeout(r, 300));
      const go = [...document.querySelectorAll('#mainmenu .btn')].find(x => x.textContent.includes('确定并选择降落点'));
      go && go.click();
      await new Promise(r => setTimeout(r, 600));
      const drop = [...document.querySelectorAll('#mainmenu .btn')].find(x => x.textContent.includes('降落'));
      drop && drop.click();
      await new Promise(r => setTimeout(r, 800));
    }
    out.inGame = f.game.state === 'playing';

    // 从干净的默认设置开始，否则上一次跑测试留下的自定义键会串味
    s.settings.resetAll();

    // 模拟一次真实按键。
    // 注意：pressed() 是「本帧的边沿」，而游戏的渲染循环每帧都会调用 endFrame()
    // 把它清掉，所以测试里不能在派发事件之后再去读 pressed —— 中间可能已经跑过一帧。
    // 稳的读法是看「按住状态」（keys / down），它只受 keydown/keyup 影响。
    const down = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    const up = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));

    // 先清掉上一帧残留
    input.endFrame();
    input.releaseAll();

    // 默认：按住 T 应该触发 tech 动作
    down('KeyT');
    out.defaultTech = input.keys.has('KeyT') && input.isDown('tech');
    out.dbgJust = [...input.justPressed];
    up('KeyT');
    input.endFrame();
    out.techReleased = !input.isDown('tech');

    // 改成：把 tech 绑到 KeyJ
    s.settings.bind('tech', 'KeyJ');
    out.newKeys = s.settings.keysFor('tech');
    input.endFrame();
    down('KeyJ');
    out.reboundTech = input.isDown('tech');
    up('KeyJ');
    input.endFrame();

    // 旧键不该再触发
    down('KeyT');
    out.oldKeyDead = input.isDown('tech');
    up('KeyT');
    input.endFrame();

    // 冲突：把 build 也绑到 KeyJ —— tech 只有这一个键，应该被拒绝
    out.conflictRejected = s.settings.bind('build', 'KeyJ') === false;
    out.afterConflict = {
      tech: s.settings.keysFor('tech').slice(),
      build: s.settings.keysFor('build').slice(),
    };
    out.orphanReported = s.settings.wouldOrphan('build', 'KeyJ');

    // 给 tech 多加两个键之后，占用 KeyJ 就不再会掏空它了
    s.settings.bind('tech', 'KeyT', 'add');
    s.settings.bind('tech', 'KeyU', 'add');
    out.multiKeys = s.settings.keysFor('tech').slice();
    input.endFrame();
    down('KeyU');
    out.altKeyWorks = input.isDown('tech');
    up('KeyU');
    input.endFrame();
    out.nowTransferable = s.settings.bind('build', 'KeyJ') === true;
    out.techAfterTransfer = s.settings.keysFor('tech').slice();
    out.buildAfterTransfer = s.settings.keysFor('build').slice();
    s.settings.bind('build', 'KeyB');   // 还原

    // 解绑：一个个删，删到最后一个会自动回退默认（动作不能变得不可触发）
    // 注意用 up（默认 W / ↑ 两个键）来测「只删一个」更干净：
    // tech 在这里已经被转移成 KeyT/KeyU，默认值恰好也是 KeyT，容易看不出来。
    s.settings.unbind('up', 'ArrowUp');
    out.unbindOne = s.settings.keysFor('up').slice();
    s.settings.unbind('tech', 'KeyU');
    out.step1 = s.settings.keysFor('tech').slice();
    s.settings.unbind('tech', 'KeyT');            // 删掉最后一个 -> 回退默认
    out.afterUnbindAll = s.settings.keysFor('tech').slice();
    out.defaultTechKeys = s.settings.binds.tech.slice();

    // 恢复默认
    s.settings.resetAll();
    out.resetTech = s.settings.keysFor('tech');
    out.resetUp = s.settings.keysFor('up');
    out.customized = s.settings.anyCustomized;

    // Esc 不允许被绑定（它是改键界面的取消键）
    out.escRejected = s.settings.bind('tech', 'Escape') === false;

    return out;
  })()`);
  console.log('  ', JSON.stringify(rebind));
  check('能进入游戏', rebind?.inGame === true);
  check('默认按 T 触发科技', rebind?.defaultTech === true);
  check('松开按键后动作解除', rebind?.techReleased === true);
  check('改键后新键生效', rebind?.reboundTech === true, JSON.stringify(rebind?.newKeys));
  check('改键后旧键失效', rebind?.oldKeyDead === false);
  check('会掏空别的动作的键被拒绝', rebind?.conflictRejected === true, JSON.stringify(rebind?.afterConflict));
  check('能指出会被掏空的动作', rebind?.orphanReported === 'tech', String(rebind?.orphanReported));
  check('一个动作可以绑多个键', (rebind?.multiKeys || []).length === 3, JSON.stringify(rebind?.multiKeys));
  check('备用键同样生效', rebind?.altKeyWorks === true);
  check('有余量时键位可以被转移', rebind?.nowTransferable === true,
    `tech=${JSON.stringify(rebind?.techAfterTransfer)} build=${JSON.stringify(rebind?.buildAfterTransfer)}`);
  check('解绑单个键只删那一个', JSON.stringify(rebind?.unbindOne) === '["KeyW"]',
    JSON.stringify(rebind?.unbindOne));
  check('解绑到空会回退默认', JSON.stringify(rebind?.afterUnbindAll) === JSON.stringify(rebind?.defaultTechKeys)
    && (rebind?.defaultTechKeys || []).length > 0,
    `解绑后=${JSON.stringify(rebind?.afterUnbindAll)} 默认=${JSON.stringify(rebind?.defaultTechKeys)}`);
  check('恢复默认生效', JSON.stringify(rebind?.resetTech) === '["KeyT"]' && JSON.stringify(rebind?.resetUp) === '["KeyW","ArrowUp"]',
    `${JSON.stringify(rebind?.resetTech)} / ${JSON.stringify(rebind?.resetUp)}`);
  check('恢复默认后不再标记为已修改', rebind?.customized === false);
  check('Esc 不能被绑定', rebind?.escRejected === true);

  // =========================================================
  section('3. 设置面板 UI');
  // =========================================================
  const panel = await evaluate(`(async () => {
    const f = window.__frontier;
    // 先把可能还开着的面板都关掉：section 2 按过 T（科技），那个面板会留在栈里，
    // 关掉设置之后它会重新显示出来 —— 那不是「设置关不掉」。
    f.ui.modals.closeAll();
    f.game.paused = false;
    await new Promise(r => setTimeout(r, 900));   // 等游戏自己的循环把面板状态也清干净
    f.game.paused = true;
    f.ui.openSettings('keys');
    await new Promise(r => setTimeout(r, 300));
    const modal = document.querySelector('#modal-root .modal');
    const out = {
      opened: !!modal,
      title: modal ? (modal.querySelector('.modal-head h2') || {}).textContent : null,
      rows: document.querySelectorAll('#modal-root .list-row').length,
      keyChips: document.querySelectorAll('#modal-root .gp-key').length,
    };
    // 切到显示页
    const tabs = [...document.querySelectorAll('#modal-root .btn')];
    const disp = tabs.find(b => b.textContent.includes('显示'));
    disp && disp.click();
    await new Promise(r => setTimeout(r, 250));
    out.displaySection = document.querySelector('#modal-root .modal-body').textContent.includes('全屏');
    out.presets = document.querySelectorAll('#modal-root .card').length;
    // 切到游戏性页
    const gp = [...document.querySelectorAll('#modal-root .btn')].find(b => b.textContent.includes('游戏性'));
    gp && gp.click();
    await new Promise(r => setTimeout(r, 250));
    out.gameplaySection = document.querySelector('#modal-root .modal-body').textContent.includes('伤害飘字');
    out.modeCards = document.querySelectorAll('#modal-root .card').length;
    // 关掉：检查「设置这一层没了」，而不是「一个模态都不剩」——
    // 脚本触发的快捷键可能顺带打开了别的面板（比如科技），那不算设置关不掉。
    out.titleBeforeClose = (document.querySelector('#modal-root .modal-head h2') || {}).textContent;
    const close = document.querySelector('#modal-root .modal-close');
    close && close.click();
    await new Promise(r => setTimeout(r, 250));
    out.stackAfterClose = f.ui.modals.stack.length;
    out.topKind = f.ui.modals.top
      ? (f.ui.modals.top.kind || (f.ui.modals.top.modal.querySelector('.modal-head h2') || {}).textContent)
      : null;
    out.settingsGone = f.ui.modals.stack.every(e => e.kind !== 'settings');
    out.closed = out.settingsGone && out.titleBeforeClose === '设置';
    f.game.paused = false;
    f.ui.modals.closeAll();
    return out;
  })()`);
  console.log('  ', JSON.stringify(panel));
  check('能打开设置面板', panel?.opened === true, String(panel?.title));
  check('按键页列出了每个动作', panel?.rows >= 20, `${panel?.rows} 行`);
  check('每个按键都有徽标', panel?.keyChips >= 20, `${panel?.keyChips} 个`);
  check('显示页有全屏选项', panel?.displaySection === true);
  check('显示页有窗口预设', panel?.presets >= 5, `${panel?.presets} 个预设`);
  check('游戏性页有玩法开关', panel?.gameplaySection === true);
  check('游戏性页能选模式', panel?.modeCards === 2, `${panel?.modeCards} 张卡`);
  check('能关掉设置面板', panel?.closed === true, `关闭前=${panel?.titleBeforeClose} 栈=${panel?.stackAfterClose} 顶层=${panel?.topKind}`);
  check('设置关闭后若还有面板则回到它', (panel?.stackAfterClose ?? 0) === 0 || panel?.topKind !== '设置',
    `顶层=${panel?.topKind}`);

  // =========================================================
  section('4. 显示设置生效');
  // =========================================================
  const display = await evaluate(`(async () => {
    const f = window.__frontier;
    const s = { settings: f.settings };
    const g = await import('/src/core/game.js');
    const out = {};
    const root = document.documentElement;

    s.settings.setDisplay({ uiScale: 'auto' });
    await new Promise(r => setTimeout(r, 120));
    out.autoScale = getComputedStyle(root).getPropertyValue('--ui-scale').trim();
    out.autoComputed = g.computeUiScale(1280, 720, 'auto');
    out.bigComputed = g.computeUiScale(2560, 1440, 'auto');
    out.clamped = g.computeUiScale(6000, 4000, 'auto');

    s.settings.setDisplay({ uiScale: '1.5' });
    await new Promise(r => setTimeout(r, 200));
    out.manualScale = getComputedStyle(root).getPropertyValue('--ui-scale').trim();
    out.fontScaled = parseFloat(getComputedStyle(document.body).fontSize) > 14;

    // 窗口预设清单存在且至少包含全屏能力
    const w = await import('/src/core/window.js');
    out.presets = w.WINDOW_PRESETS.map(p => p.id);
    out.isDesktop = w.isDesktop();
    out.winState = await w.getWindowState();

    s.settings.setDisplay({ uiScale: 'auto' });
    return out;
  })()`);
  console.log('  ', JSON.stringify(display));
  check('基准窗口的缩放是 1', Math.abs((display?.autoComputed ?? 0) - 1) < 0.06, String(display?.autoComputed));
  check('窗口变大时界面跟着放大', (display?.bigComputed ?? 0) > 1.3, String(display?.bigComputed));
  check('极端分辨率下缩放被限幅', (display?.clamped ?? 0) <= 1.9, String(display?.clamped));
  check('手动缩放写进了 CSS 变量', display?.manualScale === '1.5', String(display?.manualScale));
  check('手动缩放真的放大了字号', display?.fontScaled === true);
  check('窗口预设齐全', (display?.presets || []).length >= 5, JSON.stringify(display?.presets));
  check('窗口状态可读', !!display?.winState, JSON.stringify(display?.winState));

  // =========================================================
  section('5. 纯塔防模式');
  // =========================================================
  const td = await evaluate(`(async () => {
    const f = window.__frontier;
    const out = {};
    // 回主菜单 → 选塔防 → 开始
    f.ui.actions.backToMenu();
    await new Promise(r => setTimeout(r, 300));
    const modeBtn = [...document.querySelectorAll('#mainmenu .btn')].find(b => b.textContent.includes('纯塔防模式'));
    out.hasModeButton = !!modeBtn;
    modeBtn && modeBtn.click();
    await new Promise(r => setTimeout(r, 250));
    out.modeSelected = f.ui.mode;

    const start = [...document.querySelectorAll('#mainmenu .btn')].find(b => b.textContent.includes('开始塔防'));
    out.startLabel = !!start;
    start && start.click();
    await new Promise(r => setTimeout(r, 350));

    const go = [...document.querySelectorAll('#mainmenu .btn')].find(b => b.textContent.includes('开始塔防'));
    go && go.click();
    await new Promise(r => setTimeout(r, 900));

    const run = f.game.run;
    out.state = f.game.state;
    out.isTd = !!run?.isTowerDefense;
    out.nests = run ? run.world.nests.length : -1;
    out.pois = run ? run.world.pois.length : -1;
    out.playerDead = run ? !!run.player.dead : null;
    out.landingChoices = run ? run.world.landingSites.length : -1;
    out.camOnBase = run ? (Math.abs(f.camera.x - run.base.x) < 120 && Math.abs(f.camera.y - run.base.y) < 120) : false;
    out.hudHotbarHidden = getComputedStyle(document.getElementById('hud-bottom-center')).display === 'none';
    out.hudMinimapHidden = getComputedStyle(document.getElementById('hud-bottom-left')).display === 'none';
    out.hudVisible = getComputedStyle(document.getElementById('hud')).display !== 'none';

    // 建一座塔，确认塔防模式能正常建造
    run.resources.metal = 999; run.resources.gold = 9999;
    const tower = run.towerSystem.placeTower('sentry', run.base.x + 260, run.base.y + 60, { instant: true });
    out.towerPlaced = !!tower;
    out.nearBlocked = run.world.isBlockedPx(run.base.x + 260, run.base.y + 60);
    out.nearTerrain = (() => {
      const T = 40;
      const tx = Math.floor((run.base.x + 260) / T), ty = Math.floor((run.base.y + 60) / T);
      const idx = ty * run.world.w + tx;
      return { tile: run.world.tiles[idx], blocked: run.world.blocked[idx] };
    })();
    out.nearSpot = run.towerSystem.findPlacement(run.base.x + 260, run.base.y + 60, 1);
    out.cap = run.towerSystem.towerCap();
    out.towers = run.towers.length;
    // 阵地边缘也能建（范围是整片阵地，不只是基地旁边）
    const far = run.towerSystem.placeTower('sentry', run.base.x + run.modeDef.fieldRadius * 0.7, run.base.y, { instant: true });
    out.farTowerPlaced = !!far;

    // 打一波，确认怪会来
    run.director.startWave();
    out.waveSpawned = run.enemies.length;
    const bx = run.base.x, by = run.base.y;
    out.allOutside = run.enemies.every(e => Math.hypot(e.x - bx, e.y - by) > run.modeDef.fieldRadius);

    // 玩家输入不该让人物动起来
    const px0 = run.player.x, py0 = run.player.y;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD', bubbles: true }));
    out.playerMoved = Math.hypot(run.player.x - px0, run.player.y - py0);
    return out;
  })()`);
  console.log('  ', JSON.stringify(td));
  check('主菜单有纯塔防入口', td?.hasModeButton === true);
  check('能选中纯塔防模式', td?.modeSelected === 'towerDefense', String(td?.modeSelected));
  check('按钮文案跟着模式变', td?.startLabel === true);
  check('纯塔防能开局', td?.state === 'playing' && td?.isTd === true, `${td?.state}/${td?.isTd}`);
  check('塔防没有虫巢', td?.nests === 0, `${td?.nests}`);
  check('塔防没有遗迹', td?.pois === 0, `${td?.pois}`);
  check('塔防只有一个落点', td?.landingChoices === 1, `${td?.landingChoices}`);
  check('塔防没有可操控的角色', td?.playerDead === true);
  check('镜头钉在基地上', td?.camOnBase === true);
  check('HUD 隐藏了武器快捷栏', td?.hudHotbarHidden === true);
  check('HUD 隐藏了小地图', td?.hudMinimapHidden === true);
  check('HUD 本身仍然显示', td?.hudVisible === true);
  check('塔防能建造防御塔', td?.towerPlaced === true);
  check('阵地边缘也能建造', td?.farTowerPlaced === true);
  check('塔防能发起怪潮', (td?.waveSpawned ?? 0) > 0, `${td?.waveSpawned} 只`);
  check('怪从阵地外进来', td?.allOutside === true);
  check('按方向键角色不会移动', (td?.playerMoved ?? 99) < 1, `位移 ${td?.playerMoved}px`);

  // =========================================================
  section('6. 塔防跑一段时间');
  // =========================================================
  await wait(6000);
  const steady = await evaluate(`(() => {
    const f = window.__frontier;
    const run = f.game.run;
    return {
      fps: Math.round(f.game.fps),
      state: f.game.state,
      enemies: run.enemies.length,
      pickups: run.pickups.length,
      resources: { gold: Math.round(run.resources.gold), metal: Math.round(run.resources.metal), fiber: Math.round(run.resources.fiber || 0) },
      kills: run.stats.kills,
      wave: run.wave.state,
    };
  })()`);
  console.log('  ', JSON.stringify(steady));
  check('塔防模式帧率正常', (steady?.fps ?? 0) > 20, `${steady?.fps}`);
  check('塔防模式仍在运行', steady?.state === 'playing', String(steady?.state));

  // =========================================================
  section('7. 虫巢副本（真机流程）');
  // =========================================================
  const dungeon = await evaluate(`(async () => {
    const f = window.__frontier;
    const out = {};
    // 重新开一局开拓模式
    f.ui.actions.backToMenu();
    await new Promise(r => setTimeout(r, 400));
    const { RunState } = await import('/src/systems/runState.js');
    const run = new RunState({ seed: 'dungeon-ui', characterId: 'engineer', planetIndex: 0 });
    f.ui.startRun(run, {});
    out.started = f.game.state === 'playing';
    await new Promise(r => setTimeout(r, 700));

    const nest = run.world.nests[0];
    out.nestTier = nest ? nest.tier : 0;

    // 走到巢口按 F 进副本
    run.player.x = nest.x + 20; run.player.y = nest.y;
    run.player.lastX = run.player.x; run.player.lastY = run.player.y;
    out.entered = run.playerSystem.enterNest(nest);
    await new Promise(r => setTimeout(r, 1000));

    const inner = f.game.run;
    out.swapped = inner !== run;
    out.isDungeonInner = !!inner.isDungeonInner;
    out.hasDungeon = !!inner.dungeon;
    out.tier = inner.dungeon ? inner.dungeon.tier : null;
    out.solidWalls = inner.world.tiles.filter(t => t === 16).length;
    out.wrecks = [...inner.world.props.values()].filter(p => p.type === 'wreckCache').length;
    out.outerIntact = run.world.nests.length > 0;

    // 放出巢穴主
    const boss = inner.enemySystem.spawnDungeonBoss(inner.dungeon);
    out.boss = boss ? boss.def.name : null;
    out.bossHp = boss ? Math.round(boss.hpMax) : 0;

    // 撤退回地面（没打 Boss，巢穴应该保持可再进）
    inner.requestExit = true;
    await new Promise(r => setTimeout(r, 1000));
    out.backToOuter = f.game.run === run;
    out.nestStillOpenAfterRetreat = !nest.dungeonCleared && !nest.destroyed;

    // 再进一次，这次标记为通关
    out.entered2 = run.playerSystem.enterNest(nest);
    await new Promise(r => setTimeout(r, 900));
    const inner2 = f.game.run;
    inner2.dungeonClearedNow = true;
    await new Promise(r => setTimeout(r, 900));
    out.backToOuter2 = f.game.run === run;
    out.clearedRecorded = !!nest.dungeonCleared || !!nest.destroyed;
    out.cannotReenter = run.playerSystem.enterNest(nest) === false;
    return out;
  })()`);
  console.log('  ', JSON.stringify(dungeon));
  check('能开一局用于副本测试', dungeon?.started === true);
  check('巢穴等级在 1~10 之间', (dungeon?.nestTier ?? 0) >= 1 && (dungeon?.nestTier ?? 0) <= 10,
    `等级 ${dungeon?.nestTier}`);
  check('按 F 能进入虫巢', dungeon?.entered === true);
  check('进入后切换到了副本那一局', dungeon?.swapped === true && dungeon?.isDungeonInner === true);
  check('副本有独立的地图数据', dungeon?.hasDungeon === true && (dungeon?.solidWalls ?? 0) > 1000,
    `巢壁 ${dungeon?.solidWalls} 块`);
  check('副本里有旗舰残骸', (dungeon?.wrecks ?? 0) >= 1, `${dungeon?.wrecks} 台`);
  check('副本能生成巢穴主', !!dungeon?.boss, String(dungeon?.boss));
  check('外层世界在副本期间保持完整', dungeon?.outerIntact === true);
  check('没打完就撤退，巢穴仍然可再进', dungeon?.nestStillOpenAfterRetreat === true);
  check('能撤退回地面', dungeon?.backToOuter === true);
  check('能再次进入同一个巢穴', dungeon?.entered2 === true);
  check('打完 Boss 后巢穴被记录为已清剿', dungeon?.clearedRecorded === true);
  check('清剿后的巢穴不可再进入', dungeon?.cannotReenter === true);

  // =========================================================
  section('8. 建造模式必须时停（回归：按 B 建东西时角色在开枪）');
  // =========================================================
  const build = await evaluate(`(async () => {
    const f = window.__frontier;
    f.ui.actions.backToMenu();
    await new Promise(r => setTimeout(r, 400));
    const { RunState } = await import('/src/systems/runState.js');
    const run = new RunState({ seed: 'build-mode', characterId: 'engineer', planetIndex: 0 });
    f.ui.startRun(run, {});
    await new Promise(r => setTimeout(r, 700));
    run.resources.gold = 99999; run.resources.metal = 99999;
    run.unlockedTech.add('t_turretSlot'); run.recomputeStats();
    const o = {};
    const stack = () => f.ui.modals.stack.length;
    const tapB = async () => {
      f.input.endFrame();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyB', bubbles: true }));
      await new Promise(r => setTimeout(r, 380));
    };

    await tapB();
    o.panelOpen = stack() > 0;
    o.pausedAtPanel = f.game.paused;

    const card = document.querySelector('#modal-root .card');
    card && card.click();
    await new Promise(r => setTimeout(r, 350));
    o.placing = !!f.ui.actions.pendingPlacement;
    o.pausedAtPlacing = f.game.paused;
    o.panelClosed = stack() === 0;

    // 放置期间按住左键：不该开火
    const ammo0 = run.player.ammo;
    const orig = f.input.mouseIsDown.bind(f.input);
    f.input.mouseIsDown = (b) => (b === 0 ? true : orig(b));
    for (let i = 0; i < 40; i++) await new Promise(r => requestAnimationFrame(r));
    f.input.mouseIsDown = orig;
    o.ammoDropped = run.player.ammo < ammo0;
    o.projectilesFired = run.projectiles.length;
    o.simRanWhilePlacing = f.game.simActive;

    // 放置一座塔：应该成功且仍留在放置模式、仍然暂停
    const before = run.towers.length;
    o.placed = f.ui.actions.confirmPlacement(run.base.x + 120, run.base.y);
    o.towersAdded = run.towers.length - before;
    o.stillPlacing = !!f.ui.actions.pendingPlacement;
    o.pausedAfterPlace = f.game.paused;

    // B 结束建造 -> 回到面板，仍然暂停
    await tapB();
    o.exitPlacing = !f.ui.actions.pendingPlacement;
    o.panelBack = stack() > 0;
    o.pausedAtPanelAgain = f.game.paused;

    // 关面板 -> 恢复
    const close = document.querySelector('#modal-root .modal-close');
    close && close.click();
    await new Promise(r => setTimeout(r, 320));
    o.panelClosed2 = stack() === 0;
    o.resumed = !f.game.paused;

    // 暂停菜单用 Esc 能关掉（暂停时键盘输入不能失效）
    f.ui.actions.openPause();
    await new Promise(r => setTimeout(r, 300));
    o.pauseOpened = stack() > 0 && f.game.paused;
    f.input.endFrame();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 320));
    o.escClosedPause = stack() === 0 && !f.game.paused;
    // 顺手把暂停菜单的按钮文案带回去（「退出游戏」在不在）
    f.ui.actions.openPause();
    await new Promise(r => setTimeout(r, 250));
    o.pauseButtons = [...document.querySelectorAll('#modal-root .btn')].map(b => b.textContent);
    f.ui.modals.closeAll(); f.game.paused = false;
    return o;
  })()`);
  console.log('  ', JSON.stringify(build));
  check('B 打开建造面板并暂停', build?.panelOpen === true && build?.pausedAtPanel === true);
  check('选建筑进入放置模式且仍然暂停', build?.placing === true && build?.pausedAtPlacing === true);
  check('放置模式下面板已收起', build?.panelClosed === true);
  check('放置期间游戏没有推进', build?.simRanWhilePlacing === false);
  check('放置期间左键不会开火', build?.ammoDropped === false && build?.projectilesFired === 0,
    `弹药变化=${build?.ammoDropped} 投射物=${build?.projectilesFired}`);
  check('能放置防御塔', build?.placed === true && build?.towersAdded === 1);
  check('放完仍在放置模式（可以连着放）', build?.stillPlacing === true && build?.pausedAfterPlace === true);
  check('B 能结束建造并回到面板', build?.exitPlacing === true && build?.panelBack === true);
  check('回到面板时仍然暂停', build?.pausedAtPanelAgain === true);
  check('关掉面板才恢复游戏', build?.panelClosed2 === true && build?.resumed === true);
  check('暂停时 Esc 能关掉暂停菜单', build?.pauseOpened === true && build?.escClosedPause === true);

  // =========================================================
  section('9. 菜单与退出');
  // =========================================================
  const menu = await evaluate(`(async () => {
    const f = window.__frontier;
    f.ui.actions.backToMenu();
    await new Promise(r => setTimeout(r, 400));
    const labels = [...document.querySelectorAll('#mainmenu .btn')].map(b => b.textContent);
    return {
      labels,
      settingsCount: labels.filter(t => t.includes('设置')).length,
      hasQuit: labels.includes('退出游戏'),
      isDesktop: !!f.game.isDesktop,
      // 桌面版才有退出入口；浏览器里 window.close() 关不掉用户开的标签页
      quitHiddenInBrowser: !f.game.isDesktop,
    };
  })()`);
  console.log('  ', JSON.stringify(menu));
  check('主菜单只有一个设置入口', menu?.settingsCount === 1, JSON.stringify(menu?.labels));
  check('主菜单有退出游戏', menu?.hasQuit === true, JSON.stringify(menu?.labels));
  check('暂停菜单也有退出游戏',
    (build?.pauseButtons || []).includes('退出游戏') || menu?.isDesktop === false);

  // ---------- 汇总 ----------
  console.log('\n--- 控制台错误 ---');
  if (errors.length) for (const e of errors.slice(0, 20)) console.log('  ✗ ' + e);
  else console.log('  （无）');
  check('运行期间没有控制台错误', errors.length === 0, `${errors.length} 条`);

  console.log(`\n${'='.repeat(46)}`);
  console.log(`通过 ${pass} · 失败 ${fail}`);
  if (fail) {
    console.log('\n失败项：');
    for (const f of failures) console.log('  - ' + f);
    exitCode = 1;
  } else {
    console.log('设置与模式全部通过 ✅');
  }
  app.exit(exitCode);
});

let pass = 0, fail = 0;
const failures = [];
function section(name) {
  console.log(`\n=== ${name} ===`);
}
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
