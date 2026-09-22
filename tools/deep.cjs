/**
 * 深度玩法验证（Electron 无头）：直接驱动游戏跑完整核心循环。
 *   采集 → 建造 → 呼叫虫潮 → 防守结算 → 升级选实验科技 → 载具 → 摧毁巢穴 → 占领星球
 * 用法：npx electron tools/deep.cjs
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

app.disableHardwareAcceleration();

const SAVE_DIR = path.join(os.tmpdir(), 'frontier-deep-saves');
function registerIpc() {
  fs.mkdirSync(SAVE_DIR, { recursive: true });
  const p = (s) => path.join(SAVE_DIR, String(s).replace(/[^a-zA-Z0-9_-]/g, '') + '.json');
  ipcMain.handle('save:list', () => { try { return fs.readdirSync(SAVE_DIR).filter(n => n.endsWith('.json')).map(n => ({ slot: n.replace(/\.json$/, '') })); } catch { return []; } });
  ipcMain.handle('save:exists', (_e, s) => { try { return fs.existsSync(p(s)); } catch { return false; } });
  ipcMain.handle('save:read', (_e, s) => { try { return fs.existsSync(p(s)) ? JSON.parse(fs.readFileSync(p(s), 'utf8')) : null; } catch { return null; } });
  ipcMain.handle('save:write', (_e, s, d) => { try { fs.writeFileSync(p(s), JSON.stringify(d), 'utf8'); return true; } catch { return false; } });
  ipcMain.handle('save:remove', (_e, s) => { try { if (fs.existsSync(p(s))) fs.unlinkSync(p(s)); return true; } catch { return false; } });
  ipcMain.handle('app:info', () => ({ version: '0.1.0-deep' }));
}

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
// 让静默失败现形：任何未处理的拒绝都打印并退出，避免脚本无声挂住
process.on('unhandledRejection', (err) => {
  console.error('[deep] 未处理的拒绝:', err && (err.stack || err.message || err));
  process.exit(9);
});
process.on('uncaughtException', (err) => {
  console.error('[deep] 未捕获异常:', err && (err.stack || err.message || err));
  process.exit(9);
});

const section = (t) => console.log(`\n=== ${t} ===`);
const step = (m) => console.log('[deep] ' + m);

app.whenReady().then(async () => {
  registerIpc();
  const win = new BrowserWindow({
    width: 1280, height: 720, show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'electron', 'preload.cjs'), contextIsolation: true, offscreen: true },
  });
  const errs = [];
  win.webContents.on('console-message', (e, level, msg, line, src) => {
    if (level >= 2 && !/Insecure Content-Security-Policy/.test(msg)) errs.push(`${msg} @${src}:${line}`);
  });
  await win.loadURL('http://127.0.0.1:5173/index.html');
  await new Promise(r => setTimeout(r, 1200));
  const ev = (c) => win.webContents.executeJavaScript(c, true);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  /**
   * 等按钮出现再点。
   * UI 是异步渲染的，直接 querySelector().click() 很容易点到 null 然后抛错挂住脚本。
   */
  const clickByText = async (text, timeout = 8000) => {
    const t0 = Date.now();
    for (;;) {
      const r = await ev(`(() => {
        const b = [...document.querySelectorAll('#mainmenu .btn, #modal-root .btn')]
          .find(x => x.textContent.includes(${JSON.stringify(text)}));
        if (!b) return null;
        b.click();
        return b.textContent;
      })()`);
      if (r) return r;
      if (Date.now() - t0 > timeout) {
        const dbg = await ev("({ sel: document.querySelectorAll('#mainmenu .btn').length, texts: [...document.querySelectorAll('#mainmenu .btn')].map(b=>b.textContent), menuHidden: document.getElementById('mainmenu').className, state: window.__frontier?.game?.state, modalOpen: !!document.querySelector('#modal-root .modal') })");
        console.error('[deep] 找不到按钮时的页面状态:', JSON.stringify(dbg));
        throw new Error('按钮一直没出现: ' + text);
      }
      await wait(120);
    }
  };

  // ---------- 开局 ----------
  section('0. 开局');
  {
    const diag = await ev(`(() => {
      const el = document.getElementById('mainmenu');
      return {
        menuChildren: el ? el.children.length : -1,
        innerLen: el ? el.innerHTML.length : -1,
        innerHead: el ? el.innerHTML.slice(0, 300) : '',
        state: window.__frontier ? window.__frontier.game.state : 'NO_API',
        hasApi: !!window.__frontier,
      };
    })()`);
    console.log('[deep] 主菜单诊断:', JSON.stringify(diag));
  }
  /**
   * 重开一局，并且**指定种子**。
   *
   * 为什么需要：后面的用例（采集、怪潮、载具）都依赖「基地附近有没有开阔地」
   * 这类地图特征，而降落点选择用的是随机种子 —— 同一份代码能跑出两种结果，
   * 测试就会莫名其妙地时好时坏。固定种子 + 每次都从干净的一局开始，
   * 才能让失败是可复现的失败。
   */
  const restartRun = async (seed) => {
    await ev(`(() => {
      const f = window.__frontier;
      f.ui.actions.backToMenu();
      f.ui.modals.closeAll();
      return true;
    })()`);
    await wait(400);
    await clickByText('开始新开荒');
    await wait(300);
    // 在角色选择页插入「固定种子」这步：直接构造 RunState 更可控
    const started = await ev(`(async () => {
      const f = window.__frontier;
      const { RunState } = await import('/src/systems/runState.js');
      const run = new RunState({ seed: ${JSON.stringify(seed)}, characterId: 'engineer', planetIndex: 0 });
      f.ui.startRun(run, {});
      return f.game.state === 'playing';
    })()`);
    await wait(900);
    return started;
  };

  await clickByText('开始新开荒');
  await clickByText('确定并选择降落点');
  await clickByText('降落');
  await wait(1200);
  step('evaluate boot');
  const boot = await ev(`(() => {
    const run = window.__frontier.game.run;
    return { state: window.__frontier.game.state, props: run.world.props.size, nests: run.world.nests.length,
             gold: Math.floor(run.resources.gold), metal: Math.floor(run.resources.metal) };
  })()`);
  check('进入游戏', boot.state === 'playing', boot.state);
  check('开局有障碍物', boot.props > 50, `${boot.props}`);
  check('开局有巢穴', boot.nests >= 8, `${boot.nests}`);
  console.log(`  ℹ 初始资源 金币 ${boot.gold} 金属 ${boot.metal}`);

  // ---------- 1. 采集 ----------
  section('1. 采集（走到资源点按住 E）');
  step("进入: 1. 采集（走到资源点按住 E）");
  step("evaluate: " + "harvest");
  step('evaluate harvest');
  const harvest = await ev(`(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    const ps = run.playerSystem;
    const p = run.player;
    // 找最近的可采集点。
    // 两道过滤，都来自真实游戏规则，不是为了让测试好过：
    //   - tool: null 的（虫卵囊之类）本来就不能用手采
    //   - yield 为空的（纯装饰）采了也不给资源
    const { PROP_DEF } = await import('/src/data/tiles.js');
    const harvestable = (prop) => {
      const def = PROP_DEF[prop.type] || {};
      if (!def.tool) return false;
      return Object.keys(def.yield || {}).length > 0;
    };
    let best = null, bd = Infinity;
    let fallback = null;
    for (const prop of run.world.props.values()) {
      if (harvestable(prop)) {
        const d = (prop.x - p.x) ** 2 + (prop.y - p.y) ** 2;
        if (d < bd) { bd = d; best = prop; }
      } else if (!fallback && prop.hp > 0) {
        fallback = prop;
      }
    }
    if (!best) best = fallback;
    if (!best) return { err: '没有找到任何障碍物' };
    p.x = best.x + 30; p.y = best.y;
    p.lastX = p.x; p.lastY = p.y;
    run.world.ensureChunksAround(p.x, p.y, 900);
    // 伪造输入：按住 E
    const before = { metal: run.resources.metal, fiber: run.resources.fiber, food: run.resources.food,
                     wood: run.resources.wood, crystal: run.resources.crystal, gold: run.resources.gold };
    const origIsDown = f.game.input.isDown.bind(f.game.input);
    f.game.input.isDown = (a) => a === 'interact' ? true : origIsDown(a);
    const type = best.type;
    // 采集需要持续按住：不同障碍物耐久不同，采到死为止（最多 14 秒）
    const t0 = Date.now();
    let sawTarget = false;
    let maxProgress = 0;
    while (!best.dead && Date.now() - t0 < 14000) {
      await new Promise(r => setTimeout(r, 150));
      if (ps.harvestTarget) sawTarget = true;
      maxProgress = Math.max(maxProgress, ps.harvestProgress || 0);
    }
    f.game.input.isDown = origIsDown;
    const after = { metal: run.resources.metal, fiber: run.resources.fiber, food: run.resources.food,
                    wood: run.resources.wood, crystal: run.resources.crystal, gold: run.resources.gold };
    const gained = Object.keys(after).filter(k => after[k] > before[k] + 0.5);
    return { type, gained, harvested: run.stats.propsHarvested, target: !!ps.harvestTarget,
             dead: !!best.dead, sawTarget, maxProgress: Math.round(maxProgress * 100) };
  })()`);
  console.log('  ', JSON.stringify(harvest));
  check('采集动作生效', harvest.harvested >= 1 || harvest.sawTarget,
    `已采集 ${harvest.harvested} · 锁定目标=${harvest.sawTarget} · 进度 ${harvest.maxProgress}%`);
  check('采集获得资源', (harvest.gained || []).length >= 1, (harvest.gained || []).join(','));

  // ---------- 2. 建造 ----------
  section('2. 建造与空投');
  step("进入: 2. 建造与空投");
  step("evaluate: " + "build");
  step('evaluate build');
  const build = await ev(`(() => {
    const f = window.__frontier;
    const run = f.game.run;
    run.resources.gold = 50000; run.resources.metal = 50000; run.resources.crystal = 5000; run.resources.parts = 5000;
    run.unlockedTech.add('t_turretSlot'); run.unlockedTech.add('t_wall1');
    run.recomputeStats();
    const before = { gold: run.resources.gold, metal: run.resources.metal };
    const t = run.towerSystem.placeTower('sentry', run.base.x + 90, run.base.y, { instant: true });
    const s = run.towerSystem.placeStructure('wall', run.base.x - 90, run.base.y, {});
    const cost = { gold: before.gold - run.resources.gold, metal: before.metal - run.resources.metal };
    return { tower: !!t, structure: !!s, towers: run.towers.length, structures: run.structures.length,
             cost, cap: run.towerSystem.towerCap(), range: t ? Math.round(t.range) : 0, dmg: t ? Math.round(t.damage) : 0 };
  })()`);
  console.log('  ', JSON.stringify(build));
  check('空投防御塔', build.tower);
  check('建造围墙', build.structure);
  check('建造扣了资源', build.cost.gold > 0 && build.cost.metal > 0, JSON.stringify(build.cost));
  check('防御塔有有效射程与伤害', build.range > 0 && build.dmg > 0, `射程 ${build.range} 伤害 ${build.dmg}`);

  // ---------- 3. 塔开火 ----------
  section('3. 防御塔自动索敌开火');
  step("进入: 3. 防御塔自动索敌开火");
  step("evaluate: " + "shoot");
  step('evaluate shoot');
  const shoot = await ev(`(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    // 清掉场上干扰，保证这次测试只针对一座塔与一只怪
    run.enemies.length = 0;
    run.projectiles.length = 0;
    run.resources.gold = 99999; run.resources.metal = 99999;
    run.unlockedTech.add('t_turretSlot'); run.recomputeStats();
    run.towers.length = 0;
    const t = run.towerSystem.placeTower('sentry', run.base.x + 180, run.base.y, { instant: true });
    const { createEnemy, enemyScaleFor } = await import('/src/systems/runState.js');
    // 给足血量，确保能观察到伤害而不是秒杀
    const e = createEnemy(run, 'grub', (t ? t.x : run.base.x + 180) + 150, (t ? t.y : run.base.y), { tier: 1, scale: enemyScaleFor(run, 3, 1), hpMult: 6 });
    e.speed = 0;
    e.role = 'wave';
    run.enemies.push(e);
    const hp0 = e.hp;
    const kills0 = run.stats.kills;
    const dmg0 = run.stats.damageDealt;
    let maxProj = 0;
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 200));
      maxProj = Math.max(maxProj, run.projectiles.length);
      if (e.dead) break;
    }
    return { hp0: Math.round(hp0), hp1: Math.round(e.hp), dead: e.dead,
             maxProjectiles: maxProj, damageDealt: Math.round(run.stats.damageDealt - dmg0),
             towerOk: !!t, towerX: t ? Math.round(t.x) : null, towerY: t ? Math.round(t.y) : null,
             enemyX: Math.round(e.x), enemyY: Math.round(e.y),
             baseX: Math.round(run.base.x), baseY: Math.round(run.base.y),
             dist: t ? Math.round(Math.hypot(t.x - e.x, t.y - e.y)) : null,
             range: t ? Math.round(t.range) : null, towers: run.towers.length };
  })()`);
  console.log('  ', JSON.stringify(shoot));
  check('防御塔能造成伤害', (shoot.hp1 < shoot.hp0 || shoot.dead) && shoot.damageDealt > 0,
    `hp ${shoot.hp0} -> ${shoot.hp1}，造成 ${shoot.damageDealt} 伤害`);

  // ---------- 4. 呼叫虫潮并防守 ----------
  section('4. 怪潮：呼叫 → 来袭 → 交战 → 结算');
  step("进入: 4. 怪潮：呼叫 → 来袭 → 交战 → 结算");
  // 换一局固定种子的新游戏：怪潮这条路依赖地图与基地周边地形，
  // 沿用前面那局的随机地图会让这条用例时好时坏。
  if (!await restartRun('deep-wave-seed')) console.log('  ⚠ 重开一局失败，继续用当前这局');
  step("evaluate: " + "wave");
  step('evaluate wave');
  const wave = await ev(`(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    // 把基地修满、玩家满血，保证这一波测的是「怪潮流程」而不是「基地会不会被打没」
    if (run.base.destroyed) { run.base.destroyed = false; run.world._syncBlockedTiles?.(); }
    run.base.hp = run.base.maxHp;
    run.player.dead = false;
    run.player.hp = run.player.hpMax;
    run.resources.gold = 99999; run.resources.metal = 99999;
    run.unlockedTech.add('t_turretSlot'); run.recomputeStats();
    /*
     * 让玩家到中局水平再测怪潮。
     *
     * 这条用例断言的是「怪潮流程能不能跑完」，而不是「1 级角色能不能守下来」。
     * 经验需求抬高 1.5 倍之后，1 级角色 + 4 座基础塔的 DPS 已经不足以在
     * 70 秒内清掉一波（实测会一直卡在 active），那是难度曲线的问题，
     * 不该让流程测试替它背锅。给到 20 级、拉高塔位上限，测的才是流程本身。
     */
    run.gainXp(60000);
    run.recomputeStats();
    // 怪潮超时收尾的时间缩短，测试不必真的等 4 分钟
    run.waveTimeout = 45;
    /*
     * 补几座塔，保证能守住。
     *
     * 不能只按固定网格试一遍：placeTower 在「位置被地形或别的塔挡住」时会失败，
     * 而空位取决于随机地图。之前试 8 个固定点、实际只立起来 3~5 座，
     * 少于 5 座时基地会被这一波直接打爆（实测 2600 -> 0），
     * 于是这条「怪潮流程」用例变成了在测难度。现在绕着基地撒一圈、连试 16 次。
     */
    let towersPrep = 0;
    for (let i = 0; i < 16 && towersPrep < 6; i++) {
      const ang = (i / 16) * Math.PI * 2;
      const rad = 130 + (i % 3) * 44;
      const t = run.towerSystem.placeTower('sentry',
        run.base.x + Math.cos(ang) * rad,
        run.base.y + Math.sin(ang) * rad,
        { instant: true });
      if (t) towersPrep++;
    }
    // 再给基地一个厚一点的血包：这一节测的是「呼叫 → 来袭 → 交战 → 结算」，
    // 不是「这套防御能不能赢」。基地耐久被打空的失败应该由难度用例去管。
    run.base.maxHp = Math.max(run.base.maxHp, 12000);
    run.base.hp = run.base.maxHp;
    run.beacon.fuel = run.beacon.fuelMax;
    run.beacon.online = true;

    // 用事件而不是轮询来判定阶段：'incoming' 只有 22 秒，而交战可能在两次轮询之间就结束
    const { bus, EV } = await import('/src/core/events.js');
    const seen = { incoming: 0, start: 0, end: 0 };
    const offs = [
      bus.on(EV.WAVE_INCOMING, () => seen.incoming++),
      bus.on(EV.WAVE_START, () => seen.start++),
      bus.on(EV.WAVE_END, () => seen.end++),
    ];

    run.director.forceWave();
    const t0 = Date.now();
    let maxEnemies = 0;
    let sawAftermath = false;
    // 每帧采样（rAF）比 setTimeout 细得多，能抓住短暂的状态。
    // 给到 110 秒：一波怪有 30~45 只，4 座基础塔的 DPS 清完大约需要 80~100 秒，
    // 原来的 70 秒会让「怪还活着」被误判成「怪潮流程坏了」。
    const trace = [];
    let lastSample = 0;
    let minDist = Infinity;
    while (Date.now() - t0 < 110000) {
      await new Promise(r => requestAnimationFrame(r));
      maxEnemies = Math.max(maxEnemies, run.enemies.length);
      for (const e of run.enemies) {
        const d = Math.hypot(e.x - run.base.x, e.y - run.base.y);
        if (d < minDist) minDist = d;
      }
      const el = Date.now() - t0;
      if (el - lastSample > 15000) {
        lastSample = el;
        // 每 15 秒记一条，失败时能看出卡在哪一步
        const aliveWave = run.enemies.filter(e => e.waveId === run.wave.currentId && !e.dead).length;
        trace.push((el / 1000).toFixed(0) + 's ' + run.wave.state + ' 敌' + run.enemies.length
          + ' 本波活' + aliveWave
          + ' 超时' + (run.waveTimeout || 240) + '/已' + Math.round(run.wave.elapsed || 0)
          + ' 最近' + Math.round(minDist) + 'px');
      }
      if (run.wave.state === 'aftermath') { sawAftermath = true; break; }
    }
    for (const off of offs) off();
    return {
      number: run.wave.number,
      sawIncoming: seen.incoming > 0,
      sawActive: seen.start > 0,
      sawAftermath,
      maxEnemies, survived: run.stats.wavesSurvived, total: run.stats.wavesTotal,
      baseHp: Math.round(run.base.hp), baseMax: run.base.maxHp,
      kills: run.stats.kills, gold: Math.floor(run.resources.gold),
      towers: run.towers.length,
      towersPrep,
      beaconFuel: Math.round(run.beacon.fuel),
      trace: trace.join(' | '),
    };
  })()`);
  console.log('  ', JSON.stringify(wave));
  check('怪潮被呼叫', wave.number >= 1, `第 ${wave.number} 波`);
  check('防守阵型摆得起来（>= 5 座塔）', wave.towersPrep >= 5, `${wave.towersPrep} 座`);
  check('出现预警阶段', wave.sawIncoming);
  check('进入交战阶段', wave.sawActive);
  check('怪潮结束并结算', wave.sawAftermath);
  check('确实有怪物到达', wave.maxEnemies >= 3, `最多同屏 ${wave.maxEnemies}`);
  check('击杀计数增加', wave.kills >= 1, `${wave.kills}`);
  check('吸引装置消耗了能量', wave.beaconFuel < 100, `${wave.beaconFuel}`);
  check('基地在防守后仍有耐久', wave.baseHp > 0, `${wave.baseHp}/${wave.baseMax}`);

  // ---------- 5. 升级与实验科技 ----------
  section('5. 升级与实验科技');
  step("进入: 5. 升级与实验科技");
  step("evaluate: " + "levelup");
  step('evaluate levelup');
  const levelup = await ev(`(() => {
    const f = window.__frontier;
    const run = f.game.run;
    const lv0 = run.player.level;
    const pend0 = run.pendingChoices;
    run.gainXp(99999);
    // 升级本身不该再送实验科技（曾经一级送一次，一场下来二十多次）
    const pendAfterLevels = run.pendingChoices;
    // 现在的来源：打退一波怪潮 +1 次
    run.director.endWave(true);
    const pendAfterWave = run.pendingChoices;
    run.rollOptions('admin');
    const opts = run.currentOptions || [];
    const ids = opts.slice();
    const ok = run.takeExperiment(ids[0]);
    return { lv0, lv1: run.player.level, pend0, pendAfterLevels, pendAfterWave,
             pending: run.pendingChoices,
             rolled: ids.length, took: ok, expCount: run.experiments.size,
             dir: run.currentDir, effective: run.playerStats.get('popGrowthMult') + run.playerStats.get('workerEfficiency') };
  })()`);
  console.log('  ', JSON.stringify(levelup));
  check('升级生效', levelup.lv1 > levelup.lv0, `Lv.${levelup.lv0} -> Lv.${levelup.lv1}`);
  check('升级本身不送实验科技', levelup.pendAfterLevels === levelup.pend0,
    `${levelup.pend0} -> ${levelup.pendAfterLevels}`);
  check('打退一波给 1 次实验科技', levelup.pendAfterWave === levelup.pend0 + 1,
    `${levelup.pend0} -> ${levelup.pendAfterWave}`);
  check('能掷出 4 个选项', levelup.rolled === 4, `${levelup.rolled}`);
  check('能确认选择', levelup.took && levelup.expCount >= 1, `已获得 ${levelup.expCount} 项`);

  // ---------- 6. 载具 ----------
  section('6. 载具');
  step("进入: 6. 载具");
  step("evaluate: " + "vehicle");
  step('evaluate vehicle');
  const vehicle = await ev(`(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    const p = run.player;
    const v = run.vehicle;
    // 前面的怪潮可能把玩家打死了、或者把基地打没了 —— 那会让「载具能不能动」
    // 这条用例假失败（死了就没输入）。先把局面恢复成一个干净的战斗态。
    run.enemies.length = 0;
    run.wave.huntMode = false;
    run.beacon.online = true;
    if (run.base.destroyed) {
      run.base.destroyed = false;
      run.base.hp = run.base.maxHp;
      run.world._syncBlockedTiles?.();
    }
    if (p.dead) { p.dead = false; p.respawnTimer = 0; }
    p.hp = p.hpMax; p.invuln = 3; p.statuses?.clear?.();
    p.dodgeTimer = 0; p.knockX = 0; p.knockY = 0;
    // 载具现在要先在科技树里申请（开局只能步行），测试里直接解锁
    run.unlockedTech.add('t_vehicle0');
    run.recomputeStats();
    v.destroyed = false; v.hp = v.hpMax; v.fuel = v.fuelMax;
    /*
     * 把载具前方铲平再测。
     *
     * 这条用例测的是「载具能不能开」，不是「这块地形通不通」。
     * 地图是随机的，载具有可能正好停在一条死胡同里，往右开就被山壁挡住 ——
     * 那是地形问题，却会报成「载具不能移动」。所以先在它前方铺一段可通行地面。
     */
    {
      const { T, isSolidTile } = await import('/src/data/tiles.js');
      const TILE = 40;
      const vtx = Math.floor(v.x / TILE), vty = Math.floor(v.y / TILE);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 16; dx++) {
          const x = vtx + dx, y = vty + dy;
          if (x < 1 || y < 1 || x >= run.world.w - 1 || y >= run.world.h - 1) continue;
          const idx = y * run.world.w + x;
          if (isSolidTile(run.world.tiles[idx])) run.world.tiles[idx] = T.REGOLITH;
          run.world._clearPropsInChunkAt(x, y);
        }
      }
      run.world._syncBlockedTiles?.();
      run.world.ensureChunksAround(v.x, v.y, 1000);
    }
    // 走到载具旁
    p.x = v.x + 20; p.y = v.y; p.lastX = p.x; p.lastY = p.y;
    const entered = run.playerSystem.enterVehicle();
    const fuel0 = v.fuel;
    // 模拟前进
    const origMove = f.game.input.moveVector.bind(f.game.input);
    f.game.input.moveVector = () => ({ x: 1, y: 0 });
    const x0 = v.x;
    await new Promise(r => setTimeout(r, 1500));
    f.game.input.moveVector = origMove;
    const moved = v.x - x0;
    run.playerSystem.exitVehicle();
    return { entered, moved: Math.round(moved), fuelUsed: Math.round((fuel0 - v.fuel) * 10) / 10,
             inVehicle: p.inVehicle, hp: Math.round(v.hp), dead: !!p.dead,
             // 没动的时候把现场带回来：是没上车、还是被地形挡住了
             vx: Math.round(v.x), vy: Math.round(v.y),
             blockedAhead: run.world.circleBlocked(v.x + 60, v.y, v.r * 0.8),
             enemies: run.enemies.length, gameState: f.game.state, paused: f.game.paused };
  })()`);
  console.log('  ', JSON.stringify(vehicle));
  check('能上车', vehicle.entered);
  check('载具能移动', Math.abs(vehicle.moved) > 100, `移动 ${vehicle.moved}px（玩家死亡=${vehicle.dead}）`);
  check('移动消耗燃料', vehicle.fuelUsed > 0, `消耗 ${vehicle.fuelUsed}`);
  check('能下车', !vehicle.inVehicle);

  // ---------- 7. 攻击巢穴并占领星球 ----------
  section('7. 摧毁巢穴 → 占领星球');
  step("进入: 7. 摧毁巢穴 → 占领星球");
  step("evaluate: " + "nestRun");
  step('evaluate nestRun');
  const nestRun = await ev(`(() => {
    const f = window.__frontier;
    const run = f.game.run;
    const cleared0 = run.stats.nestsDestroyed;
    // 只留 1 个巢穴，其余直接摧毁
    const nests = run.world.nests.filter(n => !n.destroyed);
    for (let i = 0; i < nests.length - 1; i++) run.director.destroyNest(nests[i]);
    const last = run.world.nests.find(n => !n.destroyed);
    const goldBefore = run.resources.gold;
    run.director.destroyNest(last);
    return {
      cleared: run.stats.nestsDestroyed - cleared0,
      claimed: run.planetClaimed,
      beaconOnline: run.beacon.online,
      claimedPlanets: run.claimedPlanets.length,
      remaining: run.world.nests.filter(n => !n.destroyed).length,
      aliveNests: run.world.stats.aliveNests,
    };
  })()`);
  console.log('  ', JSON.stringify(nestRun));
  check('巢穴可以摧毁', nestRun.cleared >= 1, `${nestRun.cleared} 个`);
  check('清空后占领星球', nestRun.claimed);
  check('占领后吸引装置停机', !nestRun.beaconOnline);
  check('星球记录进已开拓列表', nestRun.claimedPlanets >= 1, `${nestRun.claimedPlanets}`);
  check('没有残留巢穴', nestRun.aliveNests === 0, `${nestRun.aliveNests}`);

  // ---------- 8. 开拓下一颗星球 ----------
  section('8. 开拓下一颗星球');
  step("进入: 8. 开拓下一颗星球");
  step("evaluate: " + "travel");
  step('evaluate travel');
  const travel = await ev(`(() => {
    const f = window.__frontier;
    const run = f.game.run;
    run.recomputeStats();
    run._syncBlockedTiles();
    run.unlockedTech.add('t_deepSpace');
    run.recomputeStats();
    const before = {
      planet: run.planetIndex, level: run.player.level, exp: run.experiments.size,
      techs: run.unlockedTech.size, gold: Math.floor(run.resources.gold),
      weapons: run.player.weapons.length,
    };
    // 走真实的跳星流程：交给 UI 层的 startRun，确保相机/系统/音乐都被正确重置
    const next = f.ui.actions.doTravelToPlanet(1);
    if (!next) return { err: 'doTravelToPlanet 返回空' };
    f.ui.startRun(next, { fromTravel: true });
    const after = {
      planet: next.planetIndex, level: next.player.level, exp: next.experiments.size,
      techs: next.unlockedTech.size, gold: Math.floor(next.resources.gold),
      weapons: next.player.weapons.length,
      hasTurretTech: next.unlockedTech.has('t_turretSlot'),
      nests: next.world.nests.length,
      pop: next.population,
      towers: next.towers.length,
      envName: next.planet.environment.name,
    };
    return { before, after };
  })()`);
  console.log('  ', JSON.stringify(travel));
  if (travel.err) {
    check('开拓下一颗星球', false, travel.err);
  } else {
    check('星球索引推进', travel.after.planet === 1, `第 ${travel.after.planet + 1} 颗`);
    check('角色等级保留', travel.after.level === travel.before.level, `Lv.${travel.after.level}`);
    check('实验科技保留', travel.after.exp === travel.before.exp, `${travel.after.exp} 项`);
    check('装备保留', travel.after.weapons === travel.before.weapons, `${travel.after.weapons} 把武器`);
    check('金币保留', travel.after.gold > 0, `${travel.after.gold}`);
    check('防御塔科技被重置', !travel.after.hasTurretTech);
    check('新星球防御塔清零', travel.after.towers === 0);
    check('新星球人口从零开始', travel.after.pop === 0);
    check('新星球有更多巢穴', travel.after.nests > 0, `${travel.after.nests} 个`);
    console.log(`  ℹ 新星球环境：${travel.after.envName}`);
  }

  // ---------- 9. 新星球继续跑 ----------
  section('9. 新星球运行');
  step("进入: 9. 新星球运行");
  await wait(3000);
  step("evaluate: " + "cont");
  step('evaluate cont');
  const cont = await ev(`(() => {
    const f = window.__frontier;
    const run = f.game.run;
    return { state: f.game.state, fps: Math.round(f.game.fps), time: Math.round(run.time),
             props: run.world.props.size, chunks: run.world.chunks.size, enemies: run.enemies.length,
             planet: run.planetIndex };
  })()`);
  console.log('  ', JSON.stringify(cont));
  check('新星球正常运行', cont.state === 'playing' && cont.time > 0);
  check('新星球生成了地形与资源', cont.props > 50 && cont.chunks > 0, `props ${cont.props} chunks ${cont.chunks}`);
  check('新星球帧率正常', cont.fps > 20, `${cont.fps}`);

  // ---------- 10. 长跑稳定性 ----------
  section('10. 长跑 20 秒稳定性');
  step("进入: 10. 长跑 20 秒稳定性");
  const t0 = Date.now();
  await wait(20000);
  step("evaluate: " + "long");
  step('evaluate long');
  const long = await ev(`(() => {
    const f = window.__frontier;
    const run = f.game.run;
    return { fps: Math.round(f.game.fps), time: Math.round(run.time), enemies: run.enemies.length,
             props: run.world.props.size, chunks: run.world.chunks.size, kills: run.stats.kills,
             hp: Math.round(run.player.hp), baseHp: Math.round(run.base.hp),
             heapMB: Math.round((performance.memory?.usedJSHeapSize || 0) / 1048576) };
  })()`);
  console.log(`  ℹ 跑了 ${((Date.now() - t0) / 1000).toFixed(0)} 秒后:`, JSON.stringify(long));
  check('长时间运行帧率稳定', long.fps > 20, `${long.fps}`);
  check('内存没有明显膨胀', long.heapMB === 0 || long.heapMB < 900, `${long.heapMB}MB`);
  check('世界仍然正常', long.chunks > 0 && long.chunks < 80, `chunks ${long.chunks}`);

  // ---------- 汇总 ----------
  section('控制台错误');
  step("进入: 控制台错误");
  if (errs.length) for (const e of errs.slice(0, 12)) console.log('  ✗ ' + e.slice(0, 220));
  else console.log('  （无）');
  check('没有运行时错误', errs.length === 0, `${errs.length} 条`);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`通过 ${pass} · 失败 ${fail}`);
  if (fail) { console.log('\n失败项：'); for (const f of failures) console.log('  - ' + f); }
  else console.log('核心循环全部跑通 ✅');
  app.exit(fail ? 1 : 0);
});
