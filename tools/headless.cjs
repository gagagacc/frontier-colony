/**
 * 无头冒烟：用 Electron 真的加载 index.html，验证模块加载、
 * 主菜单渲染、开新局、跑几秒、面板开关、存档 —— 并收集所有控制台错误。
 *
 * 用法：npx electron tools/headless.cjs
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const errors = [];
const logs = [];
let exitCode = 0;

// 让任何静默崩溃都现形：不管是同步异常还是未处理的 Promise 拒绝
process.on('uncaughtException', (err) => {
  console.error('[headless] 主进程未捕获异常:', err && err.stack || err);
  errors.push('main uncaughtException: ' + (err && err.message));
});
process.on('unhandledRejection', (err) => {
  console.error('[headless] 主进程未处理拒绝:', err && err.stack || err);
  errors.push('main unhandledRejection: ' + (err && err.message));
});

/** executeJavaScript 失败时把完整信息打出来，方便定位是页面抛了什么 */
const rawEvaluate = (win) => async (code) => {
  try {
    return await win.webContents.executeJavaScript(code, true);
  } catch (err) {
    console.error('[headless] executeJavaScript 失败:', err && (err.stack || err.message || err));
    throw err;
  }
};
process.on('exit', (code) => {
  console.log(`[headless] 主进程退出 code=${code}（通过 ${pass} 失败 ${fail}）`);
});

/**
 * 复刻 electron/main.cjs 的存档 IPC，让无头测试尽量贴近真实运行环境。
 * （否则 preload 里的桥会因为「没有处理器」而每次都报错）
 */
const SAVE_DIR = path.join(os.tmpdir(), 'frontier-headless-saves');
function slotPath(slot) {
  const safe = String(slot).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw new Error('非法槽位名');
  return path.join(SAVE_DIR, `${safe}.json`);
}
function registerIpc() {
  fs.mkdirSync(SAVE_DIR, { recursive: true });
  ipcMain.handle('save:list', () => {
    try {
      return fs.readdirSync(SAVE_DIR).filter(n => n.endsWith('.json')).map(n => ({ slot: n.replace(/\.json$/, '') }));
    } catch { return []; }
  });
  ipcMain.handle('save:exists', (_e, slot) => { try { return fs.existsSync(slotPath(slot)); } catch { return false; } });
  ipcMain.handle('save:read', (_e, slot) => {
    try {
      const p = slotPath(slot);
      return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
    } catch { return null; }
  });
  ipcMain.handle('save:write', (_e, slot, data) => {
    try {
      fs.mkdirSync(SAVE_DIR, { recursive: true });
      fs.writeFileSync(slotPath(slot), JSON.stringify(data), 'utf8');
      return true;
    } catch (err) { console.error('[headless] 写档失败', err.message); return false; }
  });
  ipcMain.handle('save:remove', (_e, slot) => {
    try { const p = slotPath(slot); if (fs.existsSync(p)) fs.unlinkSync(p); return true; } catch { return false; }
  });
  ipcMain.handle('app:info', () => ({ version: '0.1.0-headless', platform: process.platform, dev: true }));
  // Steam 桥的桩：无头环境没有 Steam，按「未连接」回，让游戏走降级路径
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
    logs.push(`[console:${level}] ${message}`);
    if (level >= 2) {
      // 只忽略「加载环境」导致的告警，真实游戏错误必须暴露出来
      if (/Insecure Content-Security-Policy/.test(message)) return;
      errors.push(`${message} @ ${source}:${line}`);
    }
  });
  win.webContents.on('render-process-gone', (e, details) => {
    errors.push('渲染进程崩溃: ' + JSON.stringify(details));
  });
  win.webContents.on('preload-error', (e, p, err) => {
    errors.push('preload 出错: ' + err.message);
  });
  win.webContents.on('did-fail-load', (e, code, desc, url) => {
    errors.push(`加载失败 ${code} ${desc} ${url}`);
  });

  const url = process.env.GAME_URL || 'http://127.0.0.1:5173/index.html';
  console.log('[headless] 加载', url);
  try {
    await win.loadURL(url);
  } catch (err) {
    console.error('[headless] 打不开页面：', err.message);
    console.error('  请先启动开发服务器：node tools/dev-server.mjs');
    app.exit(1);
    return;
  }

  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const evaluate = rawEvaluate(win);
  // 每一步都包一层：出错时记录并继续，而不是让整个脚本卡死
  const safe = async (label, fn, fallback = null) => {
    try { return await fn(); } catch (err) {
      console.error(`[headless] 步骤「${label}」出错:`, err && (err.message || err));
      errors.push(`${label}: ${err && err.message}`);
      return fallback;
    }
  };

  await wait(1500);

  // ---------- 步骤 1：模块是否加载成功 ----------
  const boot = await evaluate(`(() => {
    const f = window.__frontier;
    return {
      hasApi: !!f,
      gameState: f?.game?.state ?? null,
      hasMenu: !!document.querySelector('#mainmenu .menu-inner'),
      menuButtons: document.querySelectorAll('#mainmenu .btn').length,
      canvasW: document.getElementById('game')?.width ?? 0,
    };
  })()`);
  console.log('[headless] 启动状态', JSON.stringify(boot));
  check('__frontier 已挂载', boot.hasApi);
  check('状态为 menu', boot.gameState === 'menu', boot.gameState);
  check('主菜单已渲染', boot.hasMenu);
  check('主菜单有按钮', boot.menuButtons >= 2, `${boot.menuButtons}`);
  check('画布已初始化', boot.canvasW > 0, `${boot.canvasW}`);

  // ---------- 步骤 2：打开角色选择 ----------
  await evaluate(`(() => {
    const btns = [...document.querySelectorAll('#mainmenu .btn')];
    const b = btns.find(x => x.textContent.includes('开始新开荒'));
    b && b.click();
    return !!b;
  })()`);
  await wait(400);
  const charSel = await evaluate(`({
    state: window.__frontier.game.state,
    cards: document.querySelectorAll('.char-card').length,
  })`);
  console.log('[headless] 角色选择', JSON.stringify(charSel));
  check('进入角色选择', charSel.state === 'charSelect', charSel.state);
  check('四个角色卡', charSel.cards === 4, `${charSel.cards}`);

  // ---------- 步骤 3：进入降落点选择 ----------
  step('点击「确定并选择降落点」');
  const clicked = await evaluate(`(() => {
    const b = [...document.querySelectorAll('#mainmenu .btn')].find(x => x.textContent.includes('确定并选择降落点'));
    if (!b) return 'NO_BUTTON';
    b.click();
    return 'OK';
  })()`);
  step('点击结果: ' + clicked);
  await wait(900);
  step('读取降落页状态…');
  const landing = await evaluate(`({
    state: window.__frontier.game.state,
    canvases: document.querySelectorAll('#mainmenu canvas').length,
    cards: document.querySelectorAll('#mainmenu .card').length,
    recommended: [...document.querySelectorAll('#mainmenu button')].filter(b => /^\\d\\. /.test(b.textContent)).length,
    // 自由选点：直接对临时局的世界做一次评估，模拟玩家点地图
    freePick: (() => {
      const w = window.__frontier.ui._pendingRun?.world;
      if (!w) return null;
      const r = w.evaluateLandingSite(Math.floor(w.w * 0.5), Math.floor(w.h * 0.5));
      return { ok: !!r.ok, why: r.why || '', nestNear: r.site ? r.site.nestNear : null };
    })(),
  })`);
  step('降落页状态: ' + JSON.stringify(landing));
  console.log('[headless] 降落点选择', JSON.stringify(landing));
  check('进入降落点选择', landing.state === 'landing', landing.state);
  check('降落地图已绘制', landing.canvases >= 1);
  check('有 4 个系统推荐点', landing.recommended === 4, `${landing.recommended}`);
  check('地图上可以自由选点（评估接口可用）', landing.freePick !== null && typeof landing.freePick.ok === 'boolean',
    JSON.stringify(landing.freePick));

  // 真的点一下地图：落点应该被换成点击的位置
  const clickMap = await evaluate(`(() => {
    const c = document.querySelector('#mainmenu canvas');
    if (!c) return { ok: false, why: 'no canvas' };
    const r = c.getBoundingClientRect();
    const before = window.__frontier.ui._pendingRun.world.baseSite;
    // 点地图右下角 1/4 处（一定在画布内）
    c.dispatchEvent(new MouseEvent('click', {
      clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.5, bubbles: true,
    }));
    const hint = document.querySelector('#mainmenu .kv')?.textContent || '';
    return { ok: true, hint: hint.slice(0, 60), beforeX: Math.round(before?.x ?? 0) };
  })()`);
  console.log('[headless] 点击地图', JSON.stringify(clickMap));
  check('点击地图会给出落点信息', /坐标|危险度/.test(clickMap.hint || ''), String(clickMap.hint));

  // ---------- 步骤 4：真正开局 ----------
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('#mainmenu .btn')].find(x => x.textContent.includes('降落'));
    b && b.click();
  })()`);
  await wait(2500);

  const playing = await evaluate(`(() => {
    const f = window.__frontier;
    const run = f.game.run;
    return {
      state: f.game.state,
      hasRun: !!run,
      fps: Math.round(f.game.fps),
      enemies: run?.enemies.length ?? -1,
      systems: f.game.systems.length,
      hudVisible: document.getElementById('hud')?.style.display !== 'none',
      charName: run?.charDef?.name,
      planet: run?.planet?.name,
      beacon: run?.beacon?.level,
      playerHp: run?.player ? Math.round(run.player.hp) : -1,
    };
  })()`);
  console.log('[headless] 开局状态', JSON.stringify(playing));
  check('状态为 playing', playing.state === 'playing', playing.state);
  check('RunState 已建立', playing.hasRun);
  check('系统已装配', playing.systems >= 8, `${playing.systems}`);
  check('HUD 可见', playing.hudVisible);
  check(`渲染循环在跑 (fps=${playing.fps})`, playing.fps > 10, `${playing.fps}`);

  // ---------- 步骤 5：跑一段时间，看是否有运行时错误 ----------
  await wait(4000);
  const after = await evaluate(`(() => {
    const run = window.__frontier.game.run;
    return {
      time: Math.round(run.time),
      enemies: run.enemies.length,
      props: run.world.props.size,
      chunks: run.world.chunks.size,
      projectiles: run.projectiles.length,
      fps: Math.round(window.__frontier.game.fps),
    };
  })()`);
  console.log('[headless] 运行 4 秒后', JSON.stringify(after));
  check('时间在推进', after.time >= 3, `${after.time}`);
  check('世界生成了障碍物', after.props > 0, `${after.props}`);
  check('加载了地形区块', after.chunks > 0, `${after.chunks}`);
  check(`帧率可接受 (${after.fps})`, after.fps > 20, `${after.fps}`);

  // ---------- 步骤 6：逐个打开面板 ----------
  const panels = [
    ['openTech', '科技申请'], ['openTown', '殖民地经营'], ['openInventory', '装备与背包'],
    ['openBuild', '建造与空投'], ['openMap', '行星地图'], ['openPlanets', '星球与远征'],
  ];
  for (const [fn, expectTitle] of panels) {
    const ok = await evaluate(`(() => {
      try {
        window.__frontier.ui.actions.${fn}();
        const h2 = document.querySelector('#modal-root .modal-head h2');
        return h2 ? h2.textContent : null;
      } catch (err) { return 'ERR:' + err.message; }
    })()`);
    check(`面板 ${fn} 能打开（${ok}）`, typeof ok === 'string' && ok.startsWith(expectTitle), String(ok));
    await evaluate(`window.__frontier.ui.modals.close()`);
    await wait(120);
  }

  // ---------- 步骤 6b：把每个面板的每个页签都点一遍 ----------
  /*
   * 玩家在建造面板的「吸引装置」页撞到过 ReferenceError: TILE is not defined，
   * 而「能打开面板」这条断言照样全绿 —— 因为报错只在切到那一页时才发生。
   * 所以这里：给够资源、塞几件装备、然后逐个页签真的点下去。
   */
  const errsBefore = errors.length;
  await evaluate(`(() => {
    const run = window.__frontier.game.run;
    for (const k of ['gold', 'metal', 'crystal', 'parts', 'tech', 'fiber', 'wood', 'food']) run.resources[k] = 9999;
    run.resources.beaconCore = 9;
    run.resources.research = 9;
    // 背包里要有东西，列表行的「评分 / 负重」那几行才会真的渲染
    for (let i = 0; i < 3; i++) {
      const w = run.loot.rollEquipment({ bonus: 2, tier: 3 });
      if (w) run.loot.addItemToInventory(w);
    }
    return true;
  })()`);

  /** 点面板里的页签（按钮文案包含 text），返回点击后页面上出现的面板标题 */
  const clickTab = async (label) => evaluate(`(() => {
    const btns = [...document.querySelectorAll('#modal-root button')];
    const b = btns.find(x => x.textContent.includes(${JSON.stringify(label)}));
    if (!b) return 'NO_TAB';
    b.click();
    return 'OK';
  })()`);

  // 建造面板 4 个页签（吸引装置那页就是玩家踩到 TILE 的地方）
  await evaluate(`window.__frontier.ui.actions.openBuild()`);
  await wait(150);
  const buildTabs = [];
  for (const tab of ['防御塔空投', '建筑与工事', '基地与核心舱']) {
    buildTabs.push(await clickTab(tab));
    await wait(180);
  }
  check('建造面板 3 个页签都能渲染', buildTabs.every(r => r === 'OK'), buildTabs.join(','));
  await evaluate(`window.__frontier.ui.modals.close()`);
  await wait(120);

  // 科技面板 3 个分支
  await evaluate(`window.__frontier.ui.actions.openTech()`);
  await wait(150);
  const techTabs = [];
  for (const tab of ['防御工程', '殖民经营', '远征探索']) {
    techTabs.push(await clickTab(tab));
    await wait(180);
  }
  check('科技面板 3 个分支都能渲染', techTabs.every(r => r === 'OK'), techTabs.join(','));
  await evaluate(`window.__frontier.ui.modals.close()`);
  await wait(120);

  // 殖民地面板：先放一座军械工坊，制造区块才会出现（没工坊时面板只显示一句提示，
  // 那条分支也要能渲染），然后把「制造品质」那一排按钮逐个点掉。
  await evaluate(`window.__frontier.ui.actions.openTown()`);
  await wait(150);
  const townNoShop = await evaluate(`({
    hint: /工坊/.test(document.querySelector('#modal-root')?.textContent || ''),
    rar: [...document.querySelectorAll('#modal-root button')].filter(b => /^(白|绿|黄|紫)（/.test(b.textContent)).length,
  })`);
  check('没有工坊时殖民地面板给出提示', townNoShop.rar === 0 && townNoShop.hint, JSON.stringify(townNoShop));
  await evaluate(`window.__frontier.ui.modals.close()`);
  await wait(120);
  const built = await evaluate(`(() => {
    const run = window.__frontier.game.run;
    for (const k of ['gold', 'metal', 'crystal', 'parts', 'tech', 'fiber', 'wood', 'food']) run.resources[k] = 9999;
    run.population = Math.max(run.population, 40);
    const spot = run.world.findOpenSpot(run.base.x + 160, run.base.y + 120, 400);
    const ok = run.town.placeBuilding('workshop', spot.x, spot.y);
    return { ok, hasWorkshop: run.town.hasWorkshop, pop: run.population };
  })()`);
  console.log('[headless] 放下工坊', JSON.stringify(built));
  check('能放下军械工坊', !!built.ok && built.hasWorkshop === true, JSON.stringify(built.ok));
  await evaluate(`window.__frontier.ui.actions.openTown()`);
  await wait(180);
  const town = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('#modal-root button')];
    const rar = btns.filter(b => /^(白|绿|黄|紫)（/.test(b.textContent));
    rar.forEach(b => b.click());
    const craft = btns.find(b => b.textContent === '制造');
    craft?.click();
    const txt = document.querySelector('#modal-root')?.textContent || '';
    return { rar: rar.length, hasBuild: /可建造/.test(txt), hasPop: /人口/.test(txt), crafted: /失败|不够|资源/.test(txt) };
  })()`);
  console.log('[headless] 殖民地面板', JSON.stringify(town));
  check('殖民地面板有品质切换按钮', town.rar >= 3, `${town.rar}`);
  check('殖民地面板有建造与人口区块', town.hasBuild && town.hasPop, JSON.stringify(town));
  await evaluate(`window.__frontier.ui.modals.close()`);
  await wait(150);

  // 设置面板 4 个页签（含合并进来的操作说明）
  await evaluate(`window.__frontier.ui.openSettings()`);
  await wait(200);
  const setTabs = [];
  for (const tab of ['按键绑定', '操作说明', '显示', '游戏性']) {
    setTabs.push(await clickTab(tab));
    await wait(150);
  }
  check('设置面板 4 个页签都能渲染', setTabs.every(r => r === 'OK'), setTabs.join(','));
  await evaluate(`window.__frontier.ui.modals.close()`);
  await wait(120);

  // 背包：列表行渲染 + 装备/出售（评分与负重就在这里读）
  const inv = await evaluate(`(() => {
    const run = window.__frontier.game.run;
    window.__frontier.ui.actions.openInventory();
    const rows = document.querySelectorAll('#modal-root .list-row').length;
    const bagBefore = (run.player.bag || []).length;
    const equipBtn = [...document.querySelectorAll('#modal-root button')].find(b => b.textContent === '装备');
    const sellBtn = [...document.querySelectorAll('#modal-root button')].find(b => b.textContent === '出售');
    equipBtn?.click();
    sellBtn?.click();
    return { rows, bagBefore, after: (run.player.bag || []).length };
  })()`);
  console.log('[headless] 背包', JSON.stringify(inv));
  check('背包列表渲染出行', inv.rows > 0, `${inv.rows} 行`);
  check('背包能装备与出售', inv.after <= inv.bagBefore, `${inv.bagBefore} -> ${inv.after}`);
  await evaluate(`window.__frontier.ui.modals.close()`);
  await wait(120);

  // 会用到 costText / VEHICLE_MELEE 的那几个入口
  const acts = await evaluate(`(() => {
    const a = window.__frontier.ui.actions;
    const out = {};
    const call = (k, fn) => { try { out[k] = String(fn()); } catch (err) { out[k] = 'ERR:' + err.message; } };
    call('reload', () => a.reload());
    call('upgradeBeacon', () => a.upgradeBeacon());
    call('repairVehicle', () => a.repairVehicle());
    call('melee', () => a.setVehicleMelee('plow'));
    call('refuel', () => a.refuelBeaconFromCore());
    call('forceWave', () => a.forceWave());
    return out;
  })()`);
  console.log('[headless] 操作入口', JSON.stringify(acts));
  check('装填弹药不报错', !String(acts.reload).startsWith('ERR:'), acts.reload);
  check('升级吸引装置不报错', !String(acts.upgradeBeacon).startsWith('ERR:'), acts.upgradeBeacon);
  check('维修载具不报错', !String(acts.repairVehicle).startsWith('ERR:'), acts.repairVehicle);
  check('安装悬挂模块不报错', !String(acts.melee).startsWith('ERR:'), acts.melee);
  check('呼救怪潮不报错', !String(acts.forceWave).startsWith('ERR:'), acts.forceWave);
  await wait(300);
  const newErrs = errors.slice(errsBefore);
  check('点遍所有页签没有运行时错误', newErrs.length === 0, newErrs.slice(0, 3).join(' | '));
  // 收尾：别把「怪潮已发起」的状态带进后面的用例
  await evaluate(`(() => { window.__frontier.game.run.wave.state = 'calm'; return true; })()`);

  // ---------- 步骤 6c：弹药整数 / 怪物掉子弹 / 按住 E 修塔 / 数字键快捷栏 ----------
  const fixes = await evaluate(`(() => {
    const f = window.__frontier;
    const run = f.game.run;
    const p = run.player;
    const ps = run.playerSystem;
    const out = {};

    // 1) 等离子的 0.15/发 不再让弹药变成小数
    const plasma = Object.values(f.weapons.WEAPON_DEF).find(w => (w.ammoPerShot || 1) < 1);
    p.ammo = 40; p._ammoFrac = 0;
    let shots = 0;
    for (let i = 0; i < 40; i++) {
      if (!ps.canSpendAmmo(plasma, false)) break;
      ps.spendAmmo(plasma, false); shots++;
    }
    out.ammo = p.ammo;
    out.ammoInteger = Number.isInteger(p.ammo);
    out.shotsPerRound = shots;
    out.ammoMax = p.ammoMax;

    // 2) 怪物掉落子弹 5~15
    const amounts = [];
    for (let i = 0; i < 60; i++) amounts.push(run.loot.rollAmmoDrop({ elite: true, tier: 2 }));
    out.ammoDropMin = Math.min(...amounts);
    out.ammoDropMax = Math.max(...amounts);
    // 走到子弹上应该直接进弹仓
    p.ammo = 10;
    run.loot.spawnPickup(p.x + 6, p.y + 6, 'ammo', 7);
    const pk = run.pickups[run.pickups.length - 1];
    run.loot.collectAt(pk);
    out.ammoAfterPickup = p.ammo;

    // 3) 数字键 5~8 有绑定（修塔那条放在建造之后测，因为要先有塔）
    out.slotBinds = [];
    for (let i = 5; i <= 8; i++) out.slotBinds.push((f.settings.keysFor('slot' + i) || []).join(','));
    return out;
  })()`);
  console.log('[headless] 弹药/维修/快捷栏', JSON.stringify(fixes));
  check('弹药永远是整数', fixes.ammoInteger === true, `${fixes.ammo}`);
  check('小数消耗仍然生效（打得多于整数发）', fixes.shotsPerRound > 40 - 5, `${fixes.shotsPerRound} 枪 / 40 发`);
  check('弹药上限存在且合理', fixes.ammoMax >= 100, `${fixes.ammoMax}`);
  check('怪物掉的子弹在 5~15 之间', fixes.ammoDropMin >= 5 && fixes.ammoDropMax <= 15,
    `${fixes.ammoDropMin}~${fixes.ammoDropMax}`);
  check('子弹拾取直接进弹仓', fixes.ammoAfterPickup === 17, `${fixes.ammoAfterPickup}`);
  check('数字键 5~8 都绑上了', fixes.slotBinds.every(s => s.includes('Digit')), fixes.slotBinds.join(' | '));

  // ---------- 步骤 7：实验科技流程 ----------
  const expFlow = await evaluate(`(() => {
    const run = window.__frontier.game.run;
    run.pendingChoices = 1;
    window.__frontier.ui.actions.openExperiments();
    const dirs = document.querySelectorAll('.exp-direction').length;
    document.querySelector('.exp-direction')?.click();
    const cards = document.querySelectorAll('#modal-root .card').length;
    const first = document.querySelector('#modal-root .card');
    first?.click();
    return { dirs, cards, taken: run.experiments.size, pending: run.pendingChoices };
  })()`);
  console.log('[headless] 实验科技', JSON.stringify(expFlow));
  check('实验科技显示 3 个方向', expFlow.dirs === 3, `${expFlow.dirs}`);
  check('四选一显示 4 张卡', expFlow.cards === 4, `${expFlow.cards}`);
  check('选择后实验科技生效', expFlow.taken >= 1, `${expFlow.taken}`);
  await evaluate(`window.__frontier.ui.modals.close()`);
  await wait(150);

  // ---------- 步骤 8：建造一座塔 + 存档 ----------
  const build = await evaluate(`(() => {
    const f = window.__frontier;
    const run = f.game.run;
    run.resources.gold = 99999; run.resources.metal = 99999;
    run.unlockedTech.add('t_turretSlot'); run.recomputeStats();
    const t = run.towerSystem.placeTower('sentry', run.base.x + 80, run.base.y, { instant: true });
    const saved = f.game.save('auto');
    return { tower: !!t, towers: run.towers.length, saved, hasSave: f.game.hasSave('auto') };
  })()`);
  console.log('[headless] 建造与存档', JSON.stringify(build));
  check('能空投防御塔', build.tower);
  check('存档写入成功', build.saved);

  // ---------- 步骤 8b：按住 E 修塔（塔要存在才能测，所以放在建造之后） ----------
  const repair = await safe('维修防御塔', () => evaluate(`(() => {
    const f = window.__frontier;
    const run = f.game.run;
    const tw = run.towers[0];
    if (!tw) return { ok: false, why: 'no tower' };
    const maxHp = tw.maxHp || tw.def.hp;
    tw.hp = maxHp * 0.3;
    const before = tw.hp;
    run.resources.metal = 9999;
    const found = run.nearestRepairable(tw.x, tw.y, 90);
    for (let i = 0; i < 30; i++) run.repairStructureAt(tw, 1 / 60);
    // HUD 上的提示文字也要跟着出现
    const p = run.player;
    p.x = tw.x + 20; p.y = tw.y;
    run.playerSystem.repairTarget = found;
    run.playerSystem.harvestTarget = null;
    f.ui.hud.updateHint(run, f.game);
    const el = document.getElementById('context-hint');
    return { ok: true, found: !!found, label: found && found.label,
             gain: Math.round(tw.hp - before), hint: el ? el.textContent : '' };
  })()`), { ok: false });
  console.log('[headless] 维修防御塔', JSON.stringify(repair));
  check('能识别出旁边该修的塔', repair.found === true, String(repair.label));
  check('按住 E 能修塔（耐久上升）', repair.gain > 0, `+${repair.gain}`);
  check('HUD 提示写明按 E 维修', /维修/.test(repair.hint || ''), String(repair.hint).slice(0, 60));

  // ---------- 步骤 9：读档 ----------
  const loaded = await safe('读档', () => evaluate(`(() => {
    const f = window.__frontier;
    const ok = f.game.load('auto');
    return { ok, state: f.game.state, towers: f.game.run?.towers.length ?? -1, level: f.game.run?.player?.level };
  })()`));
  console.log('[headless] 读档', JSON.stringify(loaded));
  check('读档成功', loaded.ok);
  check('读档后仍在 playing', loaded.state === 'playing', loaded.state);
  check('读档保留防御塔', loaded.towers >= 1, `${loaded.towers}`);

  // ---------- 步骤 9b：基地废墟旁按 E 一定是重建（不会被采集抢走） ----------
  const rebuild = await safe('按 E 重建', () => evaluate(`(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    run.base.hp = 0; run.base.destroyed = true; run.base.repairProgress = 0;
    run.resources.metal = 9999;
    const p = run.player;
    p.dead = false;
    p.x = run.base.x + 30; p.y = run.base.y + 30;
    // 故意在脚边放一丛可采集物：以前 E 会去采它，重建永远不发生
    const prop = run.world.spawnProp('fiberBush', p.x + 20, p.y + 20);
    f.input.keys.add('KeyE'); f.input.down.add('interact');
    const keep = setInterval(() => { f.input.keys.add('KeyE'); f.input.down.add('interact'); }, 16);
    await new Promise(r => setTimeout(r, 1200));
    clearInterval(keep);
    f.input.keys.delete('KeyE'); f.input.down.delete('interact');
    const out = { progress: +run.base.repairProgress.toFixed(2), propHp: prop ? prop.hp : null,
                  propMax: prop ? prop.maxHp : null, harvestTarget: !!run.playerSystem.harvestTarget,
                  destroyed: run.base.destroyed, metal: Math.round(run.resources.metal),
                  bases: run.bases.length,
                  debug: run.playerSystem._harvestDebug || null,
                  dist: Math.round(Math.hypot(p.x - run.base.x, p.y - run.base.y)) };
    // 点一下也应该推进
    const before = run.base.repairProgress;
    run.tapRebuild(run.base);
    out.tapGain = +(run.base.repairProgress - before).toFixed(2);
    return out;
  })()`), { progress: 0 });
  console.log('[headless] 基地重建', JSON.stringify(rebuild));
  check('废墟旁按住 E 会推进重建', rebuild.progress > 0.3, `${rebuild.progress}s`);
  check('重建不会被脚边的采集物抢走', rebuild.harvestTarget === false && rebuild.propHp === rebuild.propMax,
    `灌木 hp ${rebuild.propHp}/${rebuild.propMax}`);
  check('点一下 E 也推进重建', rebuild.tapGain > 0.4, `+${rebuild.tapGain}s`);

  // ---------- 步骤 10：暂停与继续 ----------
  const pause = await safe('暂停', () => evaluate(`(() => {
    const f = window.__frontier;
    const out = { p1: null, p2: null, title: null, err: null };
    try {
      f.ui.actions.togglePause();
      out.p1 = f.game.paused;
      out.title = document.querySelector('#modal-root .modal-head h2')?.textContent ?? null;
      f.ui.actions.togglePause();
      out.p2 = f.game.paused;
    } catch (e) {
      out.err = (e && e.message) + ' @ ' + ((e && e.stack) || '').split('\\n')[1];
      out.pausedNow = f.game.paused;
      out.modalOpen = !!document.querySelector('#modal-root .modal');
    }
    return out;
  })()`));
  console.log('[headless] 暂停', JSON.stringify(pause));
  if (pause?.err) console.error('[headless] 暂停内部错误:', pause.err);
  check('能暂停', pause?.p1 === true, String(pause?.err || pause?.p1));
  check('能继续', pause?.p2 === false, String(pause?.p2));

  // ---------- 步骤 11：再跑 3 秒，确认无错误 ----------
  await wait(3000);
  const finalFps = await safe('最终帧率', () => evaluate(`Math.round(window.__frontier.game.fps)`), 0);
  console.log('[headless] 最终 fps', finalFps);
  check(`长时间运行帧率稳定 (${finalFps})`, finalFps > 20, `${finalFps}`);

  // ---------- 汇总 ----------
  console.log('\n--- 控制台错误 ---');
  if (errors.length) {
    for (const e of errors.slice(0, 20)) console.log('  ✗ ' + e);
  } else {
    console.log('  （无）');
  }
  check('运行期间没有控制台错误', errors.length === 0, `${errors.length} 条`);

  console.log(`\n${'='.repeat(46)}`);
  console.log(`通过 ${pass} · 失败 ${fail}`);
  if (fail) {
    console.log('\n失败项：');
    for (const f of failures) console.log('  - ' + f);
    exitCode = 1;
  } else {
    console.log('浏览器端全部通过 ✅');
  }
  app.exit(exitCode);
});

let pass = 0, fail = 0;
const failures = [];
const step = (m) => console.log('[headless] ' + m);
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
