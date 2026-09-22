/**
 * 入口：装配所有系统、绑定输入、驱动主循环。
 */

import { TILE, WORLD_PX } from './core/config.js';
import { Game, GS, resizeCanvas, computeUiScale } from './core/game.js';
import { Camera } from './core/camera.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { SaveManager } from './core/save.js';
import { GamepadManager } from './core/gamepad.js';
import { settings } from './core/settings.js';
import { steamClient } from './core/steamClient.js';
import { AssetManager } from './core/assets.js';
import * as settingsModule from './core/settings.js';
import * as modesModule from './data/modes.js';
import * as materialsModule from './data/materials.js';
import * as weaponsModule from './data/weapons.js';
import * as configModule from './core/config.js';
import { applyDisplaySettings, extraInstanceInfo } from './core/window.js';
import { bus, EV, notice } from './core/events.js';
import { clamp, dist, dist2 } from './core/math.js';

import { Renderer } from './render/renderer.js';
import { Ui } from './ui/ui.js';
import { injectRunModule } from './ui/actions.js';

import { RunState } from './systems/runState.js';
import { PlayerSystem } from './systems/player.js';
import { EnemySystem } from './systems/enemies.js';
import { ProjectileSystem } from './systems/projectiles.js';
import { TowerSystem } from './systems/towers.js';
import { Director } from './systems/director.js';
import { LootSystem } from './systems/loot.js';
import { TownSystem } from './systems/town.js';
import { SpatialHash } from './world/spatialHash.js';
import { TOWER_DEF } from './data/towers.js';
import { GAME_MODE } from './data/modes.js';

// 给 actions 注入 RunState（避免循环依赖）
injectRunModule({ RunState });

// =========================================================
//  引导
// =========================================================

const canvas = document.getElementById('game');
const game = new Game(canvas);
const camera = new Camera(window.innerWidth, window.innerHeight);
const input = new Input(canvas);
const audio = new Audio();
const saveManager = new SaveManager();
const renderer = new Renderer(canvas);
// 素材层：可选。没有 assets/manifest.json 或文件缺失时静默回退到程序化绘制。
const assets = new AssetManager();
renderer.assets = assets;
assets.load();
const ui = new Ui(game);
const gamepad = new GamepadManager(input);
ui.attachGamepad(gamepad);

game.setup({ input, camera, renderer, audio, ui, saveManager });
game.camera = camera;
game.renderer = renderer;
game.ui = ui;

// =========================================================
//  尺寸自适应
// =========================================================

function fit() {
  const uiScale = computeUiScale(window.innerWidth, window.innerHeight, settings.display.uiScale);
  const { dpr, w, h } = resizeCanvas(canvas, camera, uiScale);
  renderer.resize(w, h, dpr);
  const mm = document.getElementById('minimap');
  if (mm) {
    const size = clamp(Math.round(Math.min(w, h) * 0.19 * uiScale), 130, 320);
    mm.width = size;
    mm.height = size;
    mm.style.width = Math.round(size / (uiScale || 1)) + 'px';
    mm.style.height = Math.round(size / (uiScale || 1)) + 'px';
  }
}
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', fit);

// 设置变了也要重新适配：缩放系数就在设置里
settings.onChange(() => fit());

// =========================================================
//  安装一局游戏
// =========================================================

game.installRun = function installRun(run) {
  // 清理上一局
  disposeRun();

  run.spatial = new SpatialHash(84);
  run.camera = camera;
  this.world = run.world;          // Game.update 靠这个引用推进世界（生成区块、刷新障碍物）
  this.run = run;

  run.playerSystem = new PlayerSystem(run);
  run.enemySystem = new EnemySystem(run);
  run.projectileSystem = new ProjectileSystem(run);
  run.towerSystem = new TowerSystem(run);
  run.director = new Director(run);
  run.loot = new LootSystem(run);
  run.town = new TownSystem(run);

  run.recomputeStats();
  run._syncBlockedTiles();
  run.loot.collectTimer = 0;

  // 防御性检查：任何一条装配线出问题，这里就会立刻大声报错，
  // 而不是安静地退化成一个"没有地形、没有资源"的空世界。
  const required = ['world', 'player', 'playerSystem', 'enemySystem', 'towerSystem', 'director', 'loot', 'town'];
  const missing = required.filter(k => !run[k]);
  if (missing.length) throw new Error('RunState 装配不完整，缺少: ' + missing.join(', '));
  if (!this.world) throw new Error('installRun 未能挂上 world 引用');

  // 先把玩家周围的地形与资源准备好，避免开局第一帧是空的
  // （纯塔防没有玩家，就看基地附近）
  const focusX = run.isTowerDefense ? run.base.x : run.player.x;
  const focusY = run.isTowerDefense ? run.base.y : run.player.y;
  run.world.ensureChunksAround(focusX, focusY, 1150);

  // 相机
  camera.setBounds(run.world.w * TILE, run.world.h * TILE);
  camera.snapTo(focusX, focusY);
  camera.zoom = 1;
  camera.targetZoom = 1;

  // 系统更新顺序很关键：
  // 空间哈希 -> 玩家 -> 敌人 -> 投射物 -> 防御塔 -> 导演 -> 掉落 -> 城镇 -> 世界
  game.systems = [
    { name: 'spatial', update: () => run.spatial.build(run.enemies, (e) => e.r) },
    run.playerSystem,
    run.enemySystem,
    run.projectileSystem,
    run.towerSystem,
    run.director,
    run.loot,
    run.town,
  ];

  ui.autoSaveTimer = 0;
  ui.actions.pendingPlacement = null;
  ui.hud.build();

  // 音乐
  audio.init();
  audio.startMusic('calm');

  return run;
};

function disposeRun() {
  const old = game.run;
  if (!old) return;
  old.dispose?.();
}

// 读档后重建
game._rebuild = function rebuildFromSave(data) {
  const run = new RunState({
    seed: data.seedStr || String(Date.now()),
    characterId: data.characterId || 'engineer',
    planetIndex: data.planetIndex ?? 0,
    // 模式要在构造时传进去：世界是按模式生成的（纯塔防没有巢穴/遗迹），
    // 先生成再改模式会留下一堆用不上的巢穴
    mode: data.mode || GAME_MODE.FRONTIER,
  });
  run.restore(data);
  game.run = run;
  game.installRun(run);
  ui.mainMenuEl.classList.add('hidden');
  ui.modals.closeAll();
  game.paused = false;
  game.setState(GS.PLAYING);
  const label = run.isTowerDefense
    ? `${run.modeDef.name} · 第 ${run.wave.number} 波`
    : `${run.planet.name} · 第 ${run.day} 天 · ${run.charDef.name} Lv.${run.player.level}`;
  notice('读档完成', label, 'good');
};

// =========================================================
//  每帧的逻辑（输入、相机、交互）
// =========================================================

/**
 * 手柄轮询：菜单、暂停、游戏中都要跑，所以放在 run 判空之前。
 * 必须在固定步长更新之前注入，注入的动作本帧就能生效。
 */
function pollGamepad() {
  gamepad.poll({
    modalOpen: ui.modals.isOpen,
    paused: game.paused,
    state: game.state,
    pendingPlacement: ui.actions.pendingPlacement,
    actions: ui.actions,
    game,
  });
}

/**
 * 副本 Boss：玩家走近最深处的房间时把巢穴主放出来。
 * 只有一只，死了就算通关。
 */
function updateDungeonBoss(run, dt) {
  const d = run.dungeon;
  if (!d || d.cleared) return;
  if (!run.dungeonBossPending) {
    // Boss 已经放出来了 —— 检查它死了没有
    if (d.bossEnemy && (d.bossEnemy.dead || d.bossEnemy.hp <= 0)) {
      d.cleared = true;
      run.dungeonClearedNow = true;
      notice('巢穴主已伏诛', '核心停止了搏动。这个虫巢彻底死了。', 'good');
      bus.emit(EV.SFX, { name: 'explode' });
    }
    return;
  }
  const p = run.player;
  const dist = Math.hypot(p.x - d.boss.x, p.y - d.boss.y);
  if (dist > 520) return;
  run.dungeonBossPending = false;
  const boss = run.enemySystem?.spawnDungeonBoss?.(d);
  if (!boss) { run.dungeonBossPending = true; return; }
  d.bossEnemy = boss;
  bus.emit(EV.SCREEN_SHAKE, { mag: 12, time: 0.9 });
  notice('巢穴主苏醒', `${boss.def.name} 从巢核里站了起来。`, 'danger');
}

/** 换一局（进出虫巢副本用）：保留相机与系统，**不** dispose 旧的一局 —— 外层世界要留着 */
game.replaceRun = function replaceRun(next) {
  if (!next || next === this.run) return;
  this.run = next;
  this.world = next.world;
  next.spatial = next.spatial || new SpatialHash(84);
  next.camera = camera;
  next.playerSystem = new PlayerSystem(next);
  next.enemySystem = new EnemySystem(next);
  next.projectileSystem = new ProjectileSystem(next);
  next.towerSystem = new TowerSystem(next);
  next.director = new Director(next);
  next.loot = new LootSystem(next);
  next.town = new TownSystem(next);
  next.recomputeStats();
  next._syncBlockedTiles();
  this.systems = [
    { name: 'spatial', update: () => next.spatial.build(next.enemies, (e) => e.r) },
    next.playerSystem, next.enemySystem, next.projectileSystem,
    next.towerSystem, next.director, next.loot, next.town,
  ];
  camera.setBounds(next.world.w * TILE, next.world.h * TILE);
  camera.snapTo(next.player.x, next.player.y);
  next.world.ensureChunksAround(next.player.x, next.player.y, 1150);
  ui.hud.build();
};

function preUpdate(dt) {
  const run = game.run;
  if (!run) return;

  /*
   * 虫巢副本的进出。
   *
   * 副本是「另一个 RunState」，两边通过 run.dungeonRun / run.overworldRun 互相引用。
   * 主循环发现指针变了就换一局 —— 这样进出副本不需要重载页面，
   * 也不要把地下地图硬塞进世界地图里。
   */
  if (run.dungeonRun && game.run !== run.dungeonRun) {
    game.replaceRun(run.dungeonRun);
    return;
  }
  if (run.isDungeonInner && run.overworldRun && game.run === run) {
    updateDungeonBoss(run, dt);
    const cleared = !!run.dungeonClearedNow;
    if (run.requestExit || cleared) {
      const outer = run.overworldRun;
      run.exitDungeon({ cleared });
      game.replaceRun(outer);
      return;
    }
  }

  // 相机跟随。
  // 纯塔防模式没有角色要跟，镜头钉在基地上 —— 那里就是整场战斗的舞台。
  const focusX = run.isTowerDefense ? run.base.x
    : run.player.inVehicle ? run.vehicle.x : run.player.x;
  const focusY = run.isTowerDefense ? run.base.y
    : run.player.inVehicle ? run.vehicle.y : run.player.y;
  camera.follow(focusX, focusY, dt);
  camera.update(dt);

  // 放置预览（鼠标世界坐标已在 beforeFrame 里算好）
  updatePlacementPreview(run, game.mouseWorld);

  // 载具便携吸引装置
  if (run.vehicle.beacon && run.player.inVehicle) {
    run.vehicle.beacon.x = run.vehicle.x;
    run.vehicle.beacon.y = run.vehicle.y;
  }
}

function updatePlacementPreview(run, wm) {
  const pl = ui.actions.pendingPlacement;
  if (!pl || !wm) { renderer.placementPreview = null; return; }
  const snapped = {
    x: Math.floor(wm.x / TILE) * TILE + TILE / 2,
    y: Math.floor(wm.y / TILE) * TILE + TILE / 2,
  };
  let valid = !run.world.isBlockedPx(snapped.x, snapped.y);
  let range = 0;
  // 建造范围统一走 run.buildRadiusFrom：纯塔防模式是整片阵地，其余是基地 + 延伸
  const inBuildRange = (pad = 0) =>
    run.bases.some(b => !b.destroyed && dist(snapped.x, snapped.y, b.x, b.y) < run.buildRadiusFrom(b) + pad);
  if (pl.kind === 'tower') {
    const def = TOWER_DEF[pl.id];
    range = def ? def.range : 0;
    valid = valid && inBuildRange() && run.towers.length < run.towerSystem.towerCap();
  } else if (pl.kind === 'structure') {
    valid = valid && inBuildRange(40);
    // 不能和已有建筑重叠
    for (const t of run.towers) if (dist2(snapped.x, snapped.y, t.x, t.y) < 40 * 40) valid = false;
    for (const s of run.structures) if (dist2(snapped.x, snapped.y, s.x, s.y) < 40 * 40) valid = false;
  } else if (pl.kind === 'town') {
    valid = valid && inBuildRange(-40);
    for (const b of run.townBuildings) if (dist2(snapped.x, snapped.y, b.x, b.y) < 46 * 46) valid = false;
  }
  renderer.placementPreview = { x: snapped.x, y: snapped.y, valid, range };
  return snapped;
}

/**
 * 在鼠标附近找一块可建造的格子。
 * 玩家点得偏一格就失败会让人以为「按键不灵」，所以放宽到周围几格。
 */
function findNearestBuildable(run, wx, wy, radiusTiles = 3) {
  const baseTx = Math.floor(wx / TILE), baseTy = Math.floor(wy / TILE);
  let best = null, bestD = Infinity;
  for (let dy = -radiusTiles; dy <= radiusTiles; dy++) {
    for (let dx = -radiusTiles; dx <= radiusTiles; dx++) {
      const tx = baseTx + dx, ty = baseTy + dy;
      const px = tx * TILE + TILE / 2, py = ty * TILE + TILE / 2;
      if (run.world.isBlockedPx(px, py)) continue;
      let clash = false;
      for (const t of run.towers) if (dist2(px, py, t.x, t.y) < 40 * 40) { clash = true; break; }
      if (!clash) for (const s of run.structures) if (dist2(px, py, s.x, s.y) < 40 * 40) { clash = true; break; }
      if (clash) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = { x: px, y: py }; }
    }
  }
  return best;
}

/** 在固定步长更新之后调用（处理输入这类一次性的东西） */
function postUpdate(dt) {
  const run = game.run;
  if (!run) return;

  // 面板开关
  // 暂停键任何时候都有效（面板开着时用它关闭面板）。
  // 走缓冲通道：手柄的一次按压可能跨帧，甚至可能整个错过某一帧的主循环，
  // 原始 pressed 只在「按下那一帧」为真 —— 错过就是「按了没反应」。
  // 缓冲会把这次意图留 160ms，并在真正生效的那一帧被消费掉。
  if (input.pressedBuffered('pause')) { input.consumeBuffered('pause'); ui.actions.togglePause(); return; }

  // 面板开着时，只允许 Esc 关闭；其余按键交给面板自己处理（避免「又开一个面板」）
  if (game.ui.modals.isOpen || document.querySelector('#modal-root .modal')) return;

  if (input.pressedBuffered('tech')) { input.consumeBuffered('tech'); ui.actions.openTech(); return; }
  if (input.pressedBuffered('town')) { input.consumeBuffered('town'); ui.actions.openTown(); return; }
  if (input.pressedBuffered('experiments')) { input.consumeBuffered('experiments'); ui.actions.openExperiments(); return; }
  if (input.pressedBuffered('inventory')) { input.consumeBuffered('inventory'); ui.actions.openInventory(); return; }
  // 建造面板：已经在放置模式里时，B 再按一次 = 取消放置（而不是又开一个面板）
  if (input.pressedBuffered('build')) {
    input.consumeBuffered('build');
    if (ui.actions.pendingPlacement) ui.actions.cancelPlacement();
    else ui.actions.openBuild();
    return;
  }
  if (input.pressedBuffered('map')) { input.consumeBuffered('map'); ui.actions.openMap(); return; }

  // 快速存档
  if (input.keys.has('F5')) { input.keys.delete('F5'); ui.actions.save('auto'); }
  if (input.keys.has('F9')) { input.keys.delete('F9'); game.load('auto'); }
  if (input.keys.has('F3')) { input.keys.delete('F3'); renderer.showDebug = !renderer.showDebug; }
  if (input.keys.has('F4')) { input.keys.delete('F4'); renderer.showFlow = !renderer.showFlow; }

  // 武器切换。用缓冲通道：手柄的一次按压可能跨帧甚至错过某一帧的主循环，
  // 只看原始 pressed 就会出现「按了没反应」。消费掉缓冲保证只切一格。
  const slot = input.slotPressed();
  if (slot >= 0) ui.actions.selectHotbar(slot);
  const wantPrev = input.pressedBuffered('prevWeapon');
  const wantSwap = input.pressedBuffered('swapWeapon');
  const wantNext = input.pressedBuffered('nextWeapon');
  // 无论能不能切都要消费掉：否则这次按压会在缓冲里躺满整个窗口，
  // 中途一旦变成「武器多于一把」就会莫名其妙地自己切一格。
  input.consumeBuffered('prevWeapon');
  input.consumeBuffered('nextWeapon');
  input.consumeBuffered('swapWeapon');
  if (wantPrev || wantSwap || wantNext) {
    const p = run.player;
    if (p.weapons.length > 1) {
      const dir = wantPrev ? -1 : 1;
      p.weaponIndex = ((p.weaponIndex + dir) % p.weapons.length + p.weapons.length) % p.weapons.length;
      run.recomputeStats();
      bus.emit(EV.SFX, { name: 'uiClick' });
    }
  }
  if (input.pressedBuffered('reload')) { input.consumeBuffered('reload'); ui.actions.reload(); }
  if (input.pressed('heal')) ui.actions.useItem('medkit');

  // 放置 / 取消
  if (ui.actions.pendingPlacement) {
    if (input.mousePressed(2) || input.pressed('pause')) {
      ui.actions.cancelPlacement();
    } else if (input.mousePressed(0)) {
      const wm = game.mouseWorld;
      if (wm) {
        // 落点稍微偏一点也能建：先在鼠标处试，不行就在附近几格里找最近的合法位置
        if (!ui.actions.confirmPlacement(wm.x, wm.y)) {
          const spot = findNearestBuildable(run, wm.x, wm.y, 3);
          if (spot) ui.actions.confirmPlacement(spot.x, spot.y);
        }
      }
    }
    return;
  }

  // 主动呼叫虫潮
  if (input.pressed('ping') && input.isDown('sprint')) {
    ui.actions.forceWave();
  }

  // 实验科技待选提示
  if (run.pendingChoices > 0 && !run._notifiedPending) {
    run._notifiedPending = true;
    notice('实验科技可用', `你有 ${run.pendingChoices} 次实验科技选择机会。按 V 打开（先选方向，再四选一）。`, 'good');
  }
  if (run.pendingChoices === 0) run._notifiedPending = false;
}

// =========================================================
//  每帧钩子：不依赖「是否有进行中的一局」
// =========================================================

/**
 * 每帧都跑（包括主菜单、角色选择、暂停）。
 * 手柄轮询和鼠标世界坐标必须在这里，否则这些界面上手柄会完全没反应。
 */
game.beforeFrame = function beforeFrame(dt) {
  // 鼠标世界坐标（手柄瞄准不需要，但鼠标玩家随时可能接管）
  const wm = camera.screenToWorld(input.mouse.x, input.mouse.y);
  game.mouseWorld = wm;
  input.setMouseWorld(wm.x, wm.y);

  pollGamepad();

  /*
   * 暂停时也要处理界面输入。
   *
   * 这是个大坑：`postUpdate` 一直挂在 `Game.update()` 里，而 `update()` 只在
   * `simActive`（playing 且未暂停）时跑。于是**一旦暂停，所有键盘输入就全失效**：
   *   - Esc 关不掉暂停菜单（只能拿鼠标点「继续游戏」）
   *   - 建造模式（本身就是暂停的）按 B 退不出来，人会卡在放置模式里
   * 玩家报的「不能退出游戏」和「建筑模式退不出」都是这一条。
   * 现在暂停/菜单状态下改由 beforeFrame 调用，每帧仍然只处理一次。
   */
  if (!this.simActive) postUpdate(dt);
};

// =========================================================
//  重写 Game 的 update 以插入「有局时」的前后钩子
// =========================================================

const baseUpdate = Game.prototype.update;
Game.prototype.update = function (dt) {
  preUpdate(dt);
  baseUpdate.call(this, dt);
  postUpdate(dt);
};

// =========================================================
//  事件 -> 音效 / 震屏 / 其他反馈
// =========================================================

bus.on(EV.SFX, ({ name, volume }) => audio.play(name, { volume }));
// 震动强度受设置控制：关掉之后爆炸不再晃屏（有人会晕）
bus.on(EV.SCREEN_SHAKE, ({ mag, time }) => {
  if (settings.gameplay.screenShake === false) return;
  camera.shake(mag, time);
});

// 设置里的「显示帧率」也要生效，不然那个开关是假的
settings.onChange(() => {
  renderer.showDebug = !!settings.display.showFps;
});

// 手柄震动：受伤最重，爆炸与巢穴摧毁次之，其余按力度给一点反馈
bus.on(EV.DAMAGE, (d) => {
  if (d && d.player) gamepad.rumble(0.75, 140);
});
bus.on(EV.SFX, ({ name }) => {
  switch (name) {
    case 'explode': gamepad.rumble(0.55, 160); break;
    case 'hit': gamepad.rumble(0.18, 55); break;
    case 'melee': gamepad.rumble(0.22, 70); break;
    case 'shootHeavy': gamepad.rumble(0.3, 80); break;
    case 'nestBreak': gamepad.rumble(0.8, 320); break;
    case 'baseAlarm': gamepad.rumble(0.9, 420); break;
    case 'levelup': gamepad.rumble(0.35, 200); break;
    case 'error': gamepad.rumble(0.25, 90); break;
    default: break;
  }
});
bus.on(EV.WAVE_INCOMING, () => { audio.setMood('tense'); });
bus.on(EV.WAVE_END, () => { audio.setMood('calm'); });
bus.on(EV.BASE_DESTROYED, () => { audio.setMood('dark'); });
bus.on(EV.NEST_DESTROYED, () => { camera.shake(10, 0.6); });
bus.on(EV.PLANET_CLAIMED, () => { audio.setMood('calm'); });
bus.on(EV.GAME_OVER, ({ reason }) => {
  audio.setMood('dark');
  game.setState(GS.GAMEOVER);
  ui.actions.openGameOver(reason);
});
// 实验科技待选
bus.on('experimentPending', () => { audio.play('levelup'); });

// =========================================================
//  Steam 成就
//  触发点全部集中在这里：游戏逻辑里不需要知道 Steam 的存在，
//  以后要改成别的平台（或加主机）也只动这一段。
// =========================================================

/** 解锁 + 弹提示（Steam 上架后这些提示会同时打到 Steam 覆盖层） */
function achieve(id) {
  steamClient.unlock(id, (info) => {
    notice(`成就解锁 · ${info.name}`, info.desc || '', 'good');
    bus.emit(EV.SFX, { name: 'unlock' });
  });
}

const ACH = {
  LANDING: 'ACH_FIRST_LANDING',
  WAVE: 'ACH_FIRST_WAVE',
  TOWER: 'ACH_FIRST_TOWER',
  VEHICLE: 'ACH_FIRST_VEHICLE',
  RED: 'ACH_FIRST_RED',
  NEST: 'ACH_NEST_CLEAR',
  BOSS: 'ACH_DUNGEON_BOSS',
  PLANET: 'ACH_PLANET_CLAIMED',
  TEN_WAVES: 'ACH_TEN_WAVES',
  TOWN: 'ACH_TOWN_CITY',
  TD_MODE: 'ACH_TD_MODE',
  ALL_NESTS: 'ACH_ALL_NESTS',
};

// 开局（进入 playing 状态）
bus.on('stateChange', ({ to }) => {
  if (to !== GS.PLAYING) return;
  if (game.run?.isTowerDefense) return;   // 纯塔防没有「降落」
  achieve(ACH.LANDING);
});

// 击退虫潮
bus.on(EV.WAVE_END, () => {
  audio.setMood('calm');
  const run = game.run;
  if (!run) return;
  achieve(ACH.WAVE);
  const survived = run.stats.wavesSurvived || 0;
  if (run.isTowerDefense) { if (survived >= 10) achieve(ACH.TD_MODE); }
  else if (survived >= 10) achieve(ACH.TEN_WAVES);
  steamClient.setStat('waves_survived', survived);
});

// 建造第一座塔
bus.on(EV.TOWER_BUILT, () => achieve(ACH.TOWER));

// 载具到手 / 解锁深空航线
bus.on(EV.TECH_UNLOCKED, ({ id, def }) => {
  void def;
  if (id === 't_vehicle0') achieve(ACH.VEHICLE);
  if (id === 't_deepSpace') steamClient.setStat('planet_unlock', 1);
});

// 清剿巢穴 / 清光星球
bus.on(EV.NEST_DESTROYED, () => {
  camera.shake(10, 0.6);
  const run = game.run;
  if (!run) return;
  achieve(ACH.NEST);
  const alive = run.world.nests.filter(n => !n.destroyed).length;
  steamClient.setStat('nests_cleared', run.world.nests.length - alive);
  if (alive === 0) achieve(ACH.ALL_NESTS);
});
bus.on('dungeonExit', ({ cleared }) => { if (cleared) achieve(ACH.BOSS); });

// 占领星球
bus.on(EV.PLANET_CLAIMED, () => { audio.setMood('calm'); achieve(ACH.PLANET); });

// 城镇发展到「拓荒城市」：人口 30（POP_TIERS 第 3 档）
bus.on('townTierUp', ({ index }) => { if (index >= 3) achieve(ACH.TOWN); });

/*
 * 「拿到红色装备」没有独立事件，用低频扫描解决。
 * 每 4 秒扫一遍背包与装备；红色装备少，这个开销可以忽略。
 * 不用每帧扫是因为没有意义 —— 成就提示早 4 秒晚 4 秒没人会在意。
 */
setInterval(() => {
  const run = game.run;
  if (!run) return;
  const owned = [...run.player.equipment, ...run.player.inventory, ...run.player.weapons]
    .filter(Boolean).some(it => it.rarity === 'relic');
  if (owned) achieve(ACH.RED);
}, 4000);

// 存档时顺便提交 Steam 统计（云同步靠这一步）
bus.on(EV.SAVE, () => steamClient.store());


// =========================================================
//  全局错误兜底
//  单个系统报错不应该把整个游戏循环干掉 —— 抓到就提示，并继续跑。
// =========================================================

/**
 * 错误日志。
 *
 * 为什么要有：玩家截图里只拍到「运行出错 / xxx is not defined」，
 * 连是哪个文件的第几行都看不清，而我在无头环境里跑同样的操作却复现不出来。
 * 现在每条错误都留在 window.__frontierErrors 里（含完整堆栈前几帧），
 * 暂停菜单里也能直接打开看 —— 下次再出问题，一眼就能定位。
 */
window.__frontierErrors = [];
function recordError(kind, msg, where, stack) {
  const entry = {
    at: new Date().toLocaleTimeString(),
    kind, msg: String(msg), where: where || '',
    stack: String(stack || '').split('\n').slice(0, 6).join('\n'),
  };
  window.__frontierErrors.push(entry);
  if (window.__frontierErrors.length > 40) window.__frontierErrors.shift();
  return entry;
}

/** 从堆栈里挑出「第一帧属于本项目的代码」，这比 e.filename 精确得多 */
function firstUserFrame(stack) {
  const lines = String(stack || '').split('\n');
  for (const l of lines) {
    const m = /((?:file|https?):\/\/[^\s)]+?|\/src\/[^\s):]+?):(\d+):(\d+)/.exec(l);
    if (m && /\/src\//.test(m[1])) return `${m[1].replace(/^.*\/src\//, 'src/')}:${m[2]}`;
  }
  return '';
}

let errorCount = 0;
window.addEventListener('error', (e) => {
  errorCount++;
  const msg = e?.error?.message || e?.message || '未知错误';
  const where = firstUserFrame(e?.error?.stack)
    || `${e?.filename ? e.filename.replace(/^.*\/src\//, 'src/') : '?'}:${e?.lineno || 0}`;
  recordError('error', msg, where, e?.error?.stack);
  console.error('[未捕获错误]', msg, where, e?.error);
  if (errorCount <= 5) {
    notice('运行出错', `${msg}（${where}）—— 游戏会继续，但这一步可能没生效。暂停菜单 → 错误日志（或 F12 输入 __frontierErrors）看堆栈。`, 'danger');
  }
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = e?.reason?.message || String(e?.reason ?? '未知');
  /*
   * Electron 环境下没有注册 IPC 处理器时会走到这里，属于环境问题而非游戏 bug。
   * 注意要把 steam: 也算进去 —— 只在主进程注册的通道（浏览器里、或者旧版
   * preload 配新版页面）都会以「No handler registered」的形式出现，
   * 那不是存档失败，也不该弹给玩家看。
   */
  if (/No handler registered|save:|steam:/.test(msg)) {
    console.warn('[IPC] 通道不可用，已回退：', msg);
    return;
  }
  errorCount++;
  const where = firstUserFrame(e?.reason?.stack);
  recordError('rejection', msg, where, e?.reason?.stack);
  console.error('[未处理的 Promise 拒绝]', msg, e?.reason);
  if (errorCount <= 5) notice('运行出错', `${msg}${where ? `（${where}）` : ''}`, 'danger');
});

// 启动
// =========================================================

fit();
camera.setBounds(WORLD_PX, WORLD_PX);
ui.showMainMenu();
game.start();

// 桌面版：问一下主进程 Steam 连上没有（浏览器里会直接降级）
steamClient.refreshStatus().then((st) => {
  if (st?.available) {
    console.log('[steam] 已连接 ·', st.player || '');
    if (st.player) notice('欢迎回来', `${st.player} —— 成就与统计会同步到 Steam。`, 'info');
  }
});

/*
 * 多开提示。
 * 游戏允许同时开多份（比如一边开着开发版、一边开绿色版给朋友看），
 * 但每一份额外的窗口会用独立的存档目录 —— 不然两个进程会互相覆盖自动存档。
 * 不说一声的话，玩家会以为「我的存档怎么没了」。
 */
extraInstanceInfo().then(({ extra, shareSaves, userData }) => {
  // 共用存档这一支 extraInstance 仍是 0（它确实没换目录），所以两个条件都要看
  if (!extra && !shareSaves) return;
  console.log('[multi] 存档目录：', userData, shareSaves ? '(与主实例共用)' : '(独立)');
  notice('多开模式',
    shareSaves
      ? '检测到另一份游戏正在运行 —— 这一份与它共用存档目录（FRONTIER_SHARE_SAVES=1），两边同时存档会互相覆盖。'
      : `检测到另一份游戏正在运行 —— 这一份用独立存档目录（${userData || '未知'}），两边互不影响。`,
    'info');
});

// 把上次保存的显示设置（全屏 / 窗口大小）应用上去
applyDisplaySettings();
// 帧率显示开关也要按设置初始化
renderer.showDebug = !!settings.display.showFps;

// 首次交互时解锁音频
const unlockAudio = () => {
  audio.init();
  if (game.state === GS.PLAYING) audio.startMusic('calm');
  window.removeEventListener('pointerdown', unlockAudio);
  window.removeEventListener('keydown', unlockAudio);
};
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

// 页面隐藏时自动存档一次
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === GS.PLAYING && game.run) game.save('auto');
});

// 暴露给控制台调试
/**
 * 调试入口。
 *
 * 注意这里把 settings / modes / materials 这些模块也挂出来了：
 * 它们是**单例**（settings 尤其是），如果调试脚本用 `import('/src/core/settings.js')`
 * 自己再导一次，浏览器会当成立马加载出一个**新实例** ——
 * 于是「测试改了设置但游戏没变」，看起来像功能坏了，其实是在改另一个对象。
 * 测试一律从 window.__frontier 取，保证操作的是同一份。
 */
window.__frontier = {
  game, camera, renderer, ui, audio, input, gamepad, RunState, bus, EV,
  settings, Settings: settingsModule.Settings, modes: modesModule, materials: materialsModule,
  weapons: weaponsModule, config: configModule,
};

console.log('%c开拓者：殖民地 v0.1.0', 'color:#ffba4c;font-size:16px;font-weight:bold');
console.log('调试入口：window.__frontier（game / camera / renderer / ui / audio）');
