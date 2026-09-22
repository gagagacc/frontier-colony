/**
 * 手柄支持测试（Electron 无头）。
 *
 * 假手柄通过 tools/fakePad.cjs 注入：contextIsolation 下 preload 改不了页面的
 * navigator，所以直接接管 GamepadManager 的三个硬件读取方法。
 *
 * 用法：先跑 npm run dev，然后 npx electron tools/gamepad.cjs
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { FAKE_PAD_SCRIPT } = require('./fakePad.cjs');

app.disableHardwareAcceleration();

const SAVE_DIR = path.join(os.tmpdir(), 'frontier-gp-saves');
function registerIpc() {
  fs.mkdirSync(SAVE_DIR, { recursive: true });
  const p = (s) => path.join(SAVE_DIR, String(s).replace(/[^a-zA-Z0-9_-]/g, '') + '.json');
  ipcMain.handle('save:list', () => {
    try { return fs.readdirSync(SAVE_DIR).filter(n => n.endsWith('.json')).map(n => ({ slot: n.replace(/\.json$/, '') })); }
    catch { return []; }
  });
  ipcMain.handle('save:exists', (_e, s) => { try { return fs.existsSync(p(s)); } catch { return false; } });
  ipcMain.handle('save:read', (_e, s) => { try { return fs.existsSync(p(s)) ? JSON.parse(fs.readFileSync(p(s), 'utf8')) : null; } catch { return null; } });
  ipcMain.handle('save:write', () => true);
  ipcMain.handle('save:remove', () => true);
  ipcMain.handle('app:info', () => ({ version: '0.1.0-gamepad' }));
}

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const section = (t) => console.log(`\n=== ${t} ===`);

app.whenReady().then(async () => {
  registerIpc();
  const win = new BrowserWindow({
    width: 1280, height: 720, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'gamepad-prepad.cjs'),
      contextIsolation: true,     // 和真实运行一致
      offscreen: true,
    },
  });
  const errs = [];
  win.webContents.on('console-message', (e, l, m, ln, s) => {
    if (l >= 2 && !/Insecure Content-Security-Policy/.test(m)) errs.push(`${m} @${s}:${ln}`);
  });
  win.webContents.on('render-process-gone', (e, d) => {
    console.error('[gp] 渲染进程崩溃', JSON.stringify(d));
    process.exit(3);
  });

  await win.loadURL('http://127.0.0.1:5173/index.html');
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const ev = (c) => win.webContents.executeJavaScript(c, true);

  /** 把游戏恢复到「可以操作」的状态，并等界面真的关干净再返回 */
  const resetUi = async () => {
    const r = await ev(`(() => {
      const f = window.__frontier;
      if (f.ui.modals.isOpen) f.ui.modals.closeAll();
      f.ui.actions.cancelPlacement();
      f.game.paused = false;
      return { modal: !!document.querySelector('#modal-root .modal'), paused: f.game.paused };
    })()`);
    // 等界面导航状态跟着切回「战斗」，否则按键会被当成都给菜单用
    const t0 = Date.now();
    while (Date.now() - t0 < 2000) {
      const st = await ev(`(() => {
        const f = window.__frontier;
        return { nav: f.gamepad.uiNav.active, modal: !!document.querySelector('#modal-root .modal') };
      })()`);
      if (!st.nav && !st.modal) break;
      await wait(100);
    }
    return r;
  };

  /** 装假手柄并让它立刻进入已连接状态 */
  await wait(900);
  const install = await ev(`(() => { ${FAKE_PAD_SCRIPT}; return 'OK'; })()`);
  await ev('(() => { window.__frontier.gamepad._read(); return 1; })()');
  await wait(400);

  // =========================================================
  section('1. 连接识别');
  const conn = await ev(`(() => {
    const f = window.__frontier;
    const st = document.getElementById('gamepad-status');
    return {
      detected: !!f.gamepad && f.gamepad.connected,
      name: f.gamepad ? f.gamepad.displayName : '',
      statusText: st ? String(st.textContent) : '',
    };
  })()`);
  console.log('  ', JSON.stringify(conn));
  check('假手柄安装成功', install === 'OK', String(install));
  check('游戏识别到手柄', conn.detected, conn.name);
  check('界面显示连接状态', conn.statusText.includes('已连接'), conn.statusText.slice(0, 32));

  // =========================================================
  section('2. 用手柄开局：主菜单 → 角色 → 降落（全程不碰键鼠）');
  // 顺序很重要：建造/科技这类面板要求「有进行中的一局」才会打开，
  // 所以必须先用 A 键开一局，之后才能测面板导航与战斗。
  const navStart = await ev(`(async () => {
    const f = window.__frontier, pad = window.__fakePad;
    const out = { log: [] };
    const step = (m) => out.log.push(m);
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    pad.releaseAll();

    /** 用左摇杆把焦点挪到指定文字的按钮上（走真实输入，不直接调 move） */
    const padSeek = async (text, maxSteps = 26) => {
      for (let i = 0; i < maxSteps; i++) {
        const cur = f.gamepad.uiNav.focus;
        if (cur && cur.textContent.includes(text)) return 'FOUND';
        if (!cur) f.gamepad.focusFirst();
        const before = f.gamepad.uiNav.focus;
        pad.setAxis(1, 1);
        const t0 = Date.now();
        while (Date.now() - t0 < 500 && f.gamepad.uiNav.focus === before) {
          await new Promise(r => requestAnimationFrame(r));
        }
        pad.setAxis(1, 0);
        await wait(70);
        if (f.gamepad.uiNav.focus === before) { f.gamepad.focusFirst(); await wait(60); }
      }
      return 'NOT_FOUND';
    };
    const pressA = async (settle) => {
      pad.press(pad.BTN.A);
      await wait(150);
      pad.release(pad.BTN.A);
      await wait(settle || 500);
    };

    out.navActiveAtMenu = f.gamepad.uiNav.active;
    out.focusAtMenu = f.gamepad.uiNav.focus ? f.gamepad.uiNav.focus.textContent.trim().slice(0, 16) : null;

    out.locateStart = await padSeek('开始新开荒');
    await pressA(600);
    out.stateAfterStart = f.game.state;
    step('A 确认开始新开荒 -> ' + f.game.state);

    out.locateNext = await padSeek('确定并选择降落点');
    await pressA(1100);
    out.stateAtLanding = f.game.state;
    step('A 确认降落点 -> ' + f.game.state);

    out.locateDrop = await padSeek('降落');
    await pressA(1800);
    out.state = f.game.state;
    out.hasRun = !!f.game.run;
    step('A 确认降落 -> ' + f.game.state);
    pad.releaseAll();
    return out;
  })()`);
  console.log('  ', JSON.stringify(navStart));
  check('主菜单自动进入导航模式', navStart.navActiveAtMenu === true);
  check('主菜单有焦点', !!navStart.focusAtMenu, String(navStart.focusAtMenu));
  check('摇杆能找到「开始新开荒」', navStart.locateStart === 'FOUND', navStart.locateStart);
  check('A 键确认进入角色选择', navStart.stateAfterStart === 'charSelect', navStart.stateAfterStart);
  check('摇杆能找到「确定并选择降落点」', navStart.locateNext === 'FOUND', navStart.locateNext);
  check('A 键确认进入降落页', navStart.stateAtLanding === 'landing', navStart.stateAtLanding);
  check('摇杆能找到「降落」', navStart.locateDrop === 'FOUND', navStart.locateDrop);
  check('A 键确认成功开局', navStart.state === 'playing' && navStart.hasRun, navStart.state);

  // =========================================================
  section('3. 面板内导航：摇杆选 / A 确认 / 十字键 / RB 切页签 / B 返回');
  await resetUi();
  await wait(150);
  const panels = await ev(`(async () => {
    const f = window.__frontier, pad = window.__fakePad;
    const out = {};
    pad.releaseAll();

    f.ui.actions.openBuild();
    await new Promise(r => setTimeout(r, 400));
    out.buildOpened = !!document.querySelector('#modal-root .modal');
    out.buildTitle = document.querySelector('#modal-root .modal-head h2')?.textContent || null;
    out.navActive = f.gamepad.uiNav.active;
    out.focusText = f.gamepad.uiNav.focus ? f.gamepad.uiNav.focus.textContent.trim().slice(0, 16) : null;
    out.focusInsideModal = f.gamepad.uiNav.focus ? !!f.gamepad.uiNav.focus.closest('#modal-root') : false;
    out.focusHasRing = f.gamepad.uiNav.focus ? f.gamepad.uiNav.focus.classList.contains('gp-focus') : false;

    /** 朝某方向推摇杆，直到焦点变化 */
    const push = async (axis, value, timeout) => {
      const before = f.gamepad.uiNav.focus;
      pad.setAxis(axis, value);
      const t0 = Date.now();
      while (Date.now() - t0 < (timeout || 1500) && f.gamepad.uiNav.focus === before) {
        await new Promise(r => requestAnimationFrame(r));
      }
      pad.setAxis(axis, 0);
      await new Promise(r => setTimeout(r, 150));
      return f.gamepad.uiNav.focus !== before;
    };

    out.movedDown = await push(1, 0.9);
    out.ringCount = document.querySelectorAll('.gp-focus').length;
    out.movedRight = await push(0, 0.9);

    const beforeDpad = f.gamepad.uiNav.focus;
    pad.press(pad.BTN.DOWN);
    await new Promise(r => setTimeout(r, 250));
    pad.release(pad.BTN.DOWN);
    await new Promise(r => setTimeout(r, 250));
    out.dpadMoved = f.gamepad.uiNav.focus !== beforeDpad;

    const beforeTab = document.querySelector('#modal-root .btn.primary')?.textContent?.trim().slice(0, 10);
    pad.press(pad.BTN.RB);
    await new Promise(r => setTimeout(r, 250));
    pad.release(pad.BTN.RB);
    await new Promise(r => setTimeout(r, 350));
    const afterTab = document.querySelector('#modal-root .btn.primary')?.textContent?.trim().slice(0, 10);
    out.tabChanged = beforeTab !== afterTab;
    out.tabs = beforeTab + ' -> ' + afterTab;

    pad.press(pad.BTN.B);
    await new Promise(r => setTimeout(r, 250));
    pad.release(pad.BTN.B);
    await new Promise(r => setTimeout(r, 350));
    out.closedByB = !document.querySelector('#modal-root .modal');

    // START 暂停 → B 恢复
    pad.releaseAll();
    // 先确认真的回到了「没有面板」的战斗态。
    // togglePause 的语义是「面板开着就关面板，否则才暂停」——
    // 上一个面板要是还没关干净，按 START 就只是关闭面板，
    // 这条用例会假失败（实测偶发，非常难复现）。
    for (let i = 0; i < 40 && document.querySelector('#modal-root .modal'); i++) {
      await new Promise(r => setTimeout(r, 50));
    }
    await new Promise(r => setTimeout(r, 250));
    const uiCtxBefore = f.gamepad.isUiContext({});
    out.modalGoneBeforeStart = !document.querySelector('#modal-root .modal');
    // 关键前提：必须是「进行中的一局」。
    // 如果这一段之前玩家被打死了，状态会变成 gameover，
    // togglePause 直接 return —— 按 START 什么都不会发生，
    // 看起来完全像「手柄失灵」，其实是局面已经结束了。
    out.stateBeforeStart = f.game.state;
    out.playerHp = Math.round(f.game.run?.player?.hp ?? 0);
    out.baseDestroyed = !!f.game.run?.base?.destroyed;
    pad.press(pad.BTN.START);
    // 记录按下后每一帧的状态，定位到底是哪一步没生效
    const startTrace = [];
    for (let i = 0; i < 24; i++) {
      await new Promise(r => requestAnimationFrame(r));
      startTrace.push((f.game.paused ? 'P' : '-') + (document.querySelector('#modal-root .modal') ? 'M' : '-') + (f.gamepad.uiNav.active ? 'U' : '-'));
      if (i === 6) pad.release(pad.BTN.START);
    }
    out.startTrace = [...new Set(startTrace)].join(' ');
    out.uiCtxBefore = uiCtxBefore;
    await new Promise(r => setTimeout(r, 300));
    out.paused = f.game.paused;
    out.pauseTitle = document.querySelector('#modal-root .modal-head h2')?.textContent || null;
    pad.press(pad.BTN.B);
    await new Promise(r => setTimeout(r, 300));
    pad.release(pad.BTN.B);
    await new Promise(r => setTimeout(r, 700));
    out.resumed = !f.game.paused && !document.querySelector('#modal-root .modal');
    pad.releaseAll();
    return out;
  })()`);
  console.log('  ', JSON.stringify(panels));
  check('能打开建造面板', panels.buildOpened, String(panels.buildTitle));
  check('焦点落在面板内的按钮上', !!panels.focusText && panels.focusInsideModal,
    `${panels.focusText} insideModal=${panels.focusInsideModal}`);
  check('焦点显示焦点环', panels.focusHasRing);
  check('同时只有一个焦点环', panels.ringCount <= 1, `${panels.ringCount}`);
  check('摇杆向下能移动焦点', panels.movedDown);
  check('摇杆向右能移动焦点', panels.movedRight);
  check('十字键能移动焦点', panels.dpadMoved);
  check('RB 能切页签', panels.tabChanged, panels.tabs);
  check('B 键能关闭面板', panels.closedByB);
  check('START 能暂停', panels.paused,
    `state=${panels.stateBeforeStart} hp=${panels.playerHp} 基地毁=${panels.baseDestroyed} 面板已关=${panels.modalGoneBeforeStart} trace=${panels.startTrace} 标题=${panels.pauseTitle}`);
  check('B 能关闭暂停菜单', panels.resumed);

  // =========================================================
  section('4. 战斗：摇杆移动 / 右摇杆瞄准 / RT 开火 / A 采集 / B 闪避');
  await resetUi();
  await wait(150);
  const combat = await ev(`(async () => {
    const f = window.__frontier, pad = window.__fakePad;
    const run = f.game.run;
    const p = run.player;
    const out = {};
    pad.releaseAll();
    await new Promise(r => setTimeout(r, 200));

    // --- 左摇杆移动 ---
    // 用「固定帧数」而不是「固定毫秒」来测：机器忙的时候 500ms 只能跑到几帧，
    // 位移自然就小，这条用例会假失败（实测偶发 dx=36）。
    p.x = run.base.x + 120; p.y = run.base.y;
    p.lastX = p.x; p.lastY = p.y;
    p.dodgeTimer = 0; p.knockX = 0; p.knockY = 0;
    const x0 = p.x;
    pad.setAxis(0, 1);
    await new Promise(r => setTimeout(r, 120));      // 让移动向量先生效
    const mv = f.game.input.moveVector();
    out.moveVector = { x: +mv.x.toFixed(2), y: +mv.y.toFixed(2) };
    for (let i = 0; i < 45; i++) await new Promise(r => requestAnimationFrame(r));
    pad.setAxis(0, 0);
    await new Promise(r => setTimeout(r, 120));
    out.movedDx = Math.round(p.x - x0);
    out.moveFrames = 45;

    // --- 右摇杆瞄准 ---
    pad.setAxis(2, 0); pad.setAxis(3, -1);
    for (let i = 0; i < 12; i++) await new Promise(r => requestAnimationFrame(r));
    out.aimUp = +p.facing.toFixed(2);
    const aimAngle = f.game.input.aimAngle(p.x, p.y);
    out.aimAngleOk = aimAngle !== null && Math.abs(aimAngle + Math.PI / 2) < 0.1;
    pad.setAxis(2, 1); pad.setAxis(3, 0);
    for (let i = 0; i < 12; i++) await new Promise(r => requestAnimationFrame(r));
    out.aimRight = +p.facing.toFixed(2);
    pad.setAxis(2, 0); pad.setAxis(3, 0);

    // --- RT 开火：放一只怪在面前，验证真的打出伤害 ---
    pad.releaseAll();
    await new Promise(r => setTimeout(r, 300));
    p.dodgeTimer = 0;
    const { createEnemy, enemyScaleFor, makeWeaponInstance } = await import('/src/systems/runState.js');
    run.enemies.length = 0;
    // 换成枪，这样弹药消耗也是可观测的证据
    p.weapons[0] = makeWeaponInstance('pistol', 'common');
    p.weaponIndex = 0;
    run.recomputeStats();
    const dummy = createEnemy(run, 'grub', p.x + 45, p.y, { tier: 1, scale: enemyScaleFor(run, 1, 1), hpMult: 40 });
    dummy.speed = 0;
    dummy.role = 'wave';
    run.enemies.push(dummy);
    run.spatial.build(run.enemies, (e) => e.r);
    pad.setAxis(2, 1); pad.setAxis(3, 0);
    await new Promise(r => setTimeout(r, 150));
    const hp0 = dummy.hp, ammo0 = p.ammo;
    pad.press(pad.BTN.RT);
    // 记录开火期间的逐帧状态：RT 有没有被读到、主循环有没有在跑、有没有开枪。
    // 这条用例偶发失败，没有这些数据就只能靠猜。
    const fireTrace = [];
    const shots0 = run.stats.shotsFired ?? 0;
    let pausedSeen = 0;
    const tStart = performance.now();
    while (performance.now() - tStart < 900) {
      await new Promise(r => requestAnimationFrame(r));
      const down = f.game.input.isDown('fire');
      const mouse = f.game.input.mouseIsDown(0);
      if (f.game.paused) pausedSeen++;
      const tag = (down ? 'F' : '-') + (mouse ? 'M' : '-') + (f.game.paused ? 'P' : '-');
      if (fireTrace[fireTrace.length - 1] !== tag) fireTrace.push(tag);
    }
    pad.release(pad.BTN.RT);
    out.fire = {
      weapon: p.weapons[0].def.name,
      hpBefore: Math.round(hp0), hpAfter: Math.round(dummy.hp),
      ammoBefore: ammo0, ammoAfter: p.ammo,
      trace: fireTrace.join(' '),
      shots: (run.stats.shotsFired ?? 0) - shots0,
      state: f.game.state, pausedFrames: pausedSeen,
      pd: f.gamepad.pad ? 'pad' : 'nopad',
      ra: f.game.run?.player?.dead ? '死' : '活',
    };
    out.firedSomething = dummy.hp < hp0 - 0.5 || p.ammo < ammo0;
    pad.setAxis(2, 0);
    run.enemies.length = 0;

    // --- A 采集（按住） ---
    let prop = null, bd = Infinity;
    for (const pr of run.world.props.values()) {
      const d = (pr.x - p.x) ** 2 + (pr.y - p.y) ** 2;
      if (d < bd) { bd = d; prop = pr; }
    }
    if (prop) {
      p.x = prop.x + 24; p.y = prop.y; p.lastX = p.x; p.lastY = p.y;
      pad.press(pad.BTN.A);
      await new Promise(r => setTimeout(r, 800));
      out.interactIsDown = f.game.input.isDown('interact');
      out.harvestTarget = run.playerSystem.harvestTarget ? run.playerSystem.harvestTarget.type : null;
      out.harvestProgress = Math.round((run.playerSystem.harvestProgress || 0) * 100);
      const t0 = Date.now();
      while (!prop.dead && Date.now() - t0 < 14000) await new Promise(r => setTimeout(r, 150));
      pad.release(pad.BTN.A);
      out.harvested = run.stats.propsHarvested;
    }

    // --- B 闪避（需要同时推着方向） ---
    pad.releaseAll();
    await new Promise(r => setTimeout(r, 200));
    p.dodgeCd = 0; p.stamina = p.staminaMax;
    pad.setAxis(0, 1);
    await new Promise(r => setTimeout(r, 150));
    pad.press(pad.BTN.B);
    await new Promise(r => setTimeout(r, 120));
    pad.release(pad.BTN.B);
    out.dodgeTimer = +p.dodgeTimer.toFixed(3);
    out.dodged = p.dodgeTimer > 0 || p.dodgeCd > 0;
    // 归位并等翻滚结束，否则后续测试会在位移中开始
    pad.releaseAll();
    await new Promise(r => setTimeout(r, 400));
    p.dodgeTimer = 0;
    return out;
  })()`);
  console.log('  ', JSON.stringify(combat));
  check('左摇杆产生移动向量', Math.abs(combat.moveVector.x) > 0.8, JSON.stringify(combat.moveVector));
  check('角色真的移动了', Math.abs(combat.movedDx) > 60, `dx=${combat.movedDx}`);
  check('右摇杆控制瞄准（朝上）', Math.abs(combat.aimUp + 1.57) < 0.15, String(combat.aimUp));
  check('右摇杆控制瞄准（朝右）', Math.abs(combat.aimRight) < 0.15, String(combat.aimRight));
  check('aimAngle 接口正确', combat.aimAngleOk);
  check('RT 能开火并造成伤害', combat.firedSomething, JSON.stringify(combat.fire));
  check('A 键触发采集（按住）', combat.interactIsDown === true || combat.harvested > 0,
    `isDown=${combat.interactIsDown} 目标=${combat.harvestTarget} 进度=${combat.harvestProgress}%`);
  check('B 键触发闪避', combat.dodged === true, `timer=${combat.dodgeTimer}`);

  // =========================================================
  section('5. 手动接管炮塔 / 十字键切武器 / 长按 VIEW 呼救');
  await resetUi();
  await wait(200);
  const misc = await ev(`(async () => {
    const f = window.__frontier, pad = window.__fakePad;
    const run = f.game.run;
    const p = run.player;
    const out = {};
    pad.releaseAll();
    await new Promise(r => setTimeout(r, 250));

    run.resources.gold = 99999; run.resources.metal = 99999;
    run.unlockedTech.add('t_turretSlot'); run.recomputeStats();
    run.towers.length = 0;
    run.towerSystem.placeTower('sentry', run.base.x + 60, run.base.y, { instant: true });
    run.towerSystem.placeTower('sentry', run.base.x + 130, run.base.y, { instant: true });
    p.x = run.base.x + 60; p.y = run.base.y; p.lastX = p.x; p.lastY = p.y;
    await new Promise(r => setTimeout(r, 200));

    pad.press(pad.BTN.R3);
    await new Promise(r => setTimeout(r, 250));
    pad.release(pad.BTN.R3);
    await new Promise(r => setTimeout(r, 300));
    out.manualTower = run.towerSystem.manualTower ? run.towerSystem.manualTower.def.name : null;
    out.manualCount = run.towers.filter(t => t.manual).length;

    const { makeWeaponInstance } = await import('/src/systems/runState.js');
    if (p.weapons.length < 3) {
      p.weapons.push(makeWeaponInstance('pistol', 'rare'));
      p.weapons.push(makeWeaponInstance('rifle', 'epic'));
      run.recomputeStats();
    }
    const idx0 = p.weaponIndex;
    pad.press(pad.BTN.RIGHT);
    await new Promise(r => setTimeout(r, 250));
    pad.release(pad.BTN.RIGHT);
    await new Promise(r => setTimeout(r, 300));
    out.crossRight = p.weaponIndex !== idx0 ? (idx0 + ' -> ' + p.weaponIndex) : ('未切换(' + idx0 + ')');
    const idx1 = p.weaponIndex;
    pad.press(pad.BTN.LEFT);
    await new Promise(r => setTimeout(r, 250));
    pad.release(pad.BTN.LEFT);
    await new Promise(r => setTimeout(r, 300));
    out.crossLeft = p.weaponIndex !== idx1;

    // 长按 VIEW 呼救怪潮
    run.wave.state = 'calm';
    run.wave.timer = 400;
    run.beacon.online = true;
    run.beacon.fuel = run.beacon.fuelMax;
    const timerBefore = run.wave.timer;
    pad.press(pad.BTN.BACK);
    await new Promise(r => setTimeout(r, 1400));
    pad.release(pad.BTN.BACK);
    await new Promise(r => setTimeout(r, 250));
    out.waveTimerBefore = Math.round(timerBefore);
    out.waveTimerAfter = Math.round(run.wave.timer);
    out.waveCalled = run.wave.timer < 60;
    pad.releaseAll();
    return out;
  })()`);
  console.log('  ', JSON.stringify(misc));
  check('R3 能手动接管炮塔', !!misc.manualTower, String(misc.manualTower));
  check('只有一座塔被接管', misc.manualCount === 1, `${misc.manualCount}`);
  check('十字键右键切下一把武器', misc.crossRight.includes('->'), misc.crossRight);
  check('十字键左键切上一把武器', misc.crossLeft);
  check('长按 VIEW 能呼救怪潮', misc.waveCalled, `${misc.waveTimerBefore}s -> ${misc.waveTimerAfter}s`);

  // =========================================================
  section('6. 震动反馈');
  const rumble = await ev(`(async () => {
    const f = window.__frontier, pad = window.__fakePad;
    const p = f.game.run.player;
    // 先等过震动限流窗口（GamepadManager 有 45ms 节流），并清掉无敌帧，
    // 否则这次 hurt 可能被忽略 —— 那就是假失败。
    p.invuln = 0; p.dodgeTimer = 0; p.hp = p.hpMax; p.dead = false;
    await new Promise(r => setTimeout(r, 200));
    const before = pad.rumbles();
    const hp0 = p.hp;
    f.game.run.playerSystem.hurt(12, null, { source: '测试' });
    await new Promise(r => setTimeout(r, 150));
    const afterHurt = pad.rumbles();
    const hp1 = p.hp;
    const { bus, EV } = await import('/src/core/events.js');
    await new Promise(r => setTimeout(r, 120));
    bus.emit(EV.SFX, { name: 'explode' });
    await new Promise(r => setTimeout(r, 150));
    const afterBoom = pad.rumbles();
    return { before, afterHurt, afterBoom, last: pad.lastRumble(), hp0: Math.round(hp0), hp1: Math.round(hp1) };
  })()`);
  console.log('  ', JSON.stringify(rumble));
  check('受伤触发震动', rumble.afterHurt > rumble.before, `${rumble.before} -> ${rumble.afterHurt}`);
  check('受伤真的扣血', rumble.hp1 < rumble.hp0, `${rumble.hp0} -> ${rumble.hp1}`);
  check('爆炸触发震动', rumble.afterBoom > rumble.afterHurt, `${rumble.afterHurt} -> ${rumble.afterBoom}`);
  check('震动参数合法', !!(rumble.last && rumble.last.duration > 0 && rumble.last.strongMagnitude >= 0),
    JSON.stringify(rumble.last));

  // =========================================================
  section('7. 提示条与断开处理');
  await resetUi();
  const hints = await ev(`(async () => {
    const f = window.__frontier, pad = window.__fakePad;
    pad.releaseAll();
    const bar = document.getElementById('gamepad-bar');
    const out = {};

    // 战斗中：碰一下摇杆让输入源变成手柄
    pad.setAxis(0, 0.9);
    await new Promise(r => setTimeout(r, 300));
    pad.setAxis(0, 0);
    await new Promise(r => setTimeout(r, 250));
    out.lastSource = f.game.input.lastSource;
    out.barVisibleCombat = bar ? bar.classList.contains('on') : false;
    out.barItemsCombat = bar ? bar.querySelectorAll('.gp-item').length : 0;
    out.combatKeys = bar ? [...bar.querySelectorAll('.gp-key')].map(e => e.textContent) : [];

    // 面板中：应切换成界面操作提示
    f.ui.actions.openBuild();
    await new Promise(r => setTimeout(r, 500));
    out.barItemsUi = bar ? bar.querySelectorAll('.gp-item').length : 0;
    out.firstHintUi = bar && bar.querySelector('.gp-key') ? bar.querySelector('.gp-key').textContent : null;
    out.uiKeys = bar ? [...bar.querySelectorAll('.gp-key')].map(e => e.textContent) : [];

    // 放置模式（战斗中）：提示条要换成「确认落点 / 取消放置」
    f.ui.modals.closeAll();
    await new Promise(r => setTimeout(r, 400));
    f.ui.actions.startPlacement('tower', 'sentry');
    await new Promise(r => setTimeout(r, 400));
    out.barItemsPlacing = bar ? bar.querySelectorAll('.gp-item').length : 0;
    out.placingKeys = bar ? [...bar.querySelectorAll('.gp-key')].map(e => e.textContent) : [];
    f.ui.actions.cancelPlacement();

    // 关掉面板后提示条要切回「战斗」那一套，等一帧渲染完成再读
    await new Promise(r => setTimeout(r, 700));
    out.barItemsBackToCombat = bar ? bar.querySelectorAll('.gp-item').length : 0;

    // 播放中状态行是隐藏的（避免挡画面），先暂停让状态行可见再断言文本
    f.game.paused = true;
    pad.disconnect();
    f.gamepad.pad = null;
    f.gamepad.connected = false;
    f.gamepad.index = -1;
    window.dispatchEvent(new Event('gamepaddisconnected'));
    for (let i = 0; i < 40; i++) {
      await new Promise(r => requestAnimationFrame(r));
      const el = document.getElementById('gamepad-status');
      if (el && el.textContent.includes('未检测')) break;
    }
    out.afterDisconnect = f.gamepad.connected;
    out.barHidden = !(bar && bar.classList.contains('on'));
    const st2 = document.getElementById('gamepad-status');
    out.statusAfter = st2 ? String(st2.textContent).slice(0, 22) : '';
    out.statusVisibleWhenPaused = st2 ? st2.style.display !== 'none' : false;
    f.game.paused = false;
    pad.connect();
    await new Promise(r => setTimeout(r, 400));
    out.reconnected = f.gamepad.connected;
    return out;
  })()`);
  console.log('  ', JSON.stringify(hints));
  check('输入源识别为手柄', hints.lastSource === 'gamepad', hints.lastSource);
  check('战斗中显示手柄提示条', hints.barVisibleCombat);
  check('战斗提示条目数正确（含装填/接管/地图/切武器）', hints.barItemsCombat === 13 || hints.barItemsCombat === 14,
    `${hints.barItemsCombat}${hints.barItemsCombat === 14 ? '（含「上/下车」，因为玩家站在车旁）' : ''}`);
  // 之前漏掉的键：LT 装填、R3 接管炮塔、VIEW 地图、十字键切武器
  const needKeys = ['LT', 'R3', 'VIEW', '十字键 ←→'];
  const missing = needKeys.filter(k => !(hints.combatKeys || []).includes(k));
  check('战斗提示包含所有手柄键', missing.length === 0, missing.length ? `缺 ${missing.join(' ')}` : '齐全');
  check('面板中切换为界面操作提示',
    hints.barItemsUi === 6 && hints.firstHintUi === '左摇杆 / 十字键 / 右摇杆',
    `${hints.barItemsUi} 条，首项=${hints.firstHintUi}`);
  check('放置模式提示换成确认/取消',
    hints.barItemsPlacing === 10
      && (hints.placingKeys || []).includes('RT / A')
      && (hints.placingKeys || []).includes('B')
      && !(hints.placingKeys || []).includes('Y'),
    `${hints.barItemsPlacing} 条 · ${(hints.placingKeys || []).join('/')}`);
  check('关掉面板后切回战斗提示',
    hints.barItemsBackToCombat === hints.barItemsCombat,
    `${hints.barItemsBackToCombat} 条（战斗中 ${hints.barItemsCombat} 条）`);
  check('断开后状态更新', hints.afterDisconnect === false && hints.statusAfter.includes('未检测'),
    hints.statusAfter);
  check('断开后隐藏手柄提示条', hints.barHidden);
  check('重新插上能自动识别', hints.reconnected === true);
  // =========================================================
  section('控制台错误');
  if (errs.length) for (const e of errs.slice(0, 10)) console.log('  ✗ ' + e.slice(0, 200));
  else console.log('  （无）');
  check('没有运行时错误', errs.length === 0, `${errs.length} 条`);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`通过 ${pass} · 失败 ${fail}`);
  if (fail) { console.log('\n失败项：'); for (const f of failures) console.log('  - ' + f); }
  else console.log('手柄支持全部通过 ✅');
  app.exit(fail ? 1 : 0);
});
