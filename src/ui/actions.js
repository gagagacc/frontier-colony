/**
 * 所有玩家操作的统一入口。
 * 键盘、按钮、面板都调用这里，保证行为一致（也方便以后加手柄/宏）。
 */

import { TILE, BEACON } from '../core/config.js';
import { clamp, dist } from '../core/math.js';
import { bus, EV, notice } from '../core/events.js';
import { ITEM_DEF } from '../data/weapons.js';
import { planetDef } from '../data/planets.js';
import { TECH_MAP } from '../data/tech.js';
// costText：按钮与提示里到处在用，之前漏了这行 import ——
// 只有真的点到「装填 / 升级 / 维修」时才会 ReferenceError。
import { costText } from '../systems/towers.js';
import { VEHICLE_MELEE } from '../systems/runState.js';
import { openTechPanel } from './panelTech.js';
import { openTownPanel } from './panelTown.js';
import { openInventoryPanel } from './panelInventory.js';
import { openBuildPanel } from './panelBuild.js';
import { openMapPanel } from './panelMap.js';
import { openDungeonMap } from './panelDungeonMap.js';
import { openExperimentFlow } from './panelExperiment.js';
import { openPauseMenu, openGameOver, openSavesPanel } from './panelSystem.js';
import { openPlanetPanel } from './panelPlanet.js';

export class Actions {
  constructor(game, hud) {
    this.game = game;
    this.hud = hud;
    this.pendingPlacement = null;   // { kind:'tower'|'structure'|'town', id }
    this.selectedHotbar = -1;
    // 消耗品库存（简化：不占背包格，单独计数）
    game.run && (game.run.itemCounts = game.run.itemCounts || { medkit: 2, stimpack: 1, repairKit: 1 });
  }

  get run() { return this.game.run; }
  get run_() { return this.game.run; }

  // =========================================================
  //  面板
  // =========================================================

  openTech() {
    if (!this.run) return;
    this.game.paused = true;
    openTechPanel(this.game, this);
  }

  openTown() {
    if (!this.run) return;
    this.game.paused = true;
    openTownPanel(this.game, this);
  }

  openExperiments() {
    if (!this.run) return;
    this.game.paused = true;
    openExperimentFlow(this.game, this);
  }

  openInventory() {
    if (!this.run) return;
    this.game.paused = true;
    openInventoryPanel(this.game, this);
  }

  openBuild() {
    if (!this.run) return;
    this.game.paused = true;
    openBuildPanel(this.game, this);
  }

  /** M 键：在外面是行星地图，在虫巢副本里是虫巢地图 */
  openMap() {
    if (!this.run) return;
    this.game.paused = true;
    if (this.run.dungeon) openDungeonMap(this.game, this.run);
    else openMapPanel(this.game, this);
  }

  openPlanets() {
    if (!this.run) return;
    this.game.paused = true;
    openPlanetPanel(this.game, this);
  }

  openSaves() {
    openSavesPanel(this.game, this);
  }

  /** 操作说明已并入设置面板（按键表从设置实时读，不会出现两份对不上的说明） */
  openHelp() {
    this.game.ui?.openSettings?.('help');
  }

  openPause() {
    if (this.game.state !== 'playing') return;
    this.game.paused = true;
    openPauseMenu(this.game, this);
  }

  openGameOver(reason) {
    openGameOver(this.game, this, reason);
  }

  // =========================================================
  //  快捷栏与武器
  // =========================================================

  selectHotbar(i) {
    const run = this.run;
    if (!run) return;
    const p = run.player;
    if (i < 4) {
      if (i < p.weapons.length) {
        p.weaponIndex = i;
        run.recomputeStats();
        bus.emit(EV.SFX, { name: 'uiClick' });
      }
      return;
    }
    if (i === 4) { this.reload(); return; }
    // 6-8 消耗品
    const id = ['medkit', 'stimpack', 'repairKit'][i - 5];
    if (id) this.useItem(id);
  }

  reload() {
    // 换弹逻辑搬到 runState.beginReload()：打空时自动换弹走的是同一条路，
    // 免得两处各写一份费用/时间。这里只负责「玩家按了 R」这一侧。
    this.run?.beginReload(false);
  }

  useItem(id) {
    const run = this.run;
    if (!run) return;
    const def = ITEM_DEF[id];
    if (!def) return;
    const counts = run.itemCounts || (run.itemCounts = {});
    if (!(counts[id] > 0)) {
      notice('没有库存', `${def.name} 已用完。可以在基地或贸易站补充。`, 'warn');
      bus.emit(EV.SFX, { name: 'error' });
      return;
    }
    const p = run.player;
    const st = p.statSet;
    const use = def.use || {};
    if (use.heal) {
      const amount = use.heal * (1 + st.get('healPower'));
      p.hp = Math.min(p.hpMax, p.hp + amount);
      bus.emit(EV.LOOT, { x: p.x, y: p.y, kind: 'heal', amount: Math.round(amount) });
    }
    if (use.buff) {
      p.statSet.addBuff(
        { attackSpeed: use.buff.attackSpeed, speedMult: use.buff.speedMult },
        use.buff.dur, 'stimpack',
      );
    }
    if (use.repair) {
      // 修最近的建筑
      let best = null, bd = 200 * 200;
      for (const b of [...run.towers, ...run.structures]) {
        const d = (b.x - p.x) ** 2 + (b.y - p.y) ** 2;
        if (d < bd) { bd = d; best = b; }
      }
      if (best) {
        best.hp = Math.min(best.hpMax, best.hp + use.repair);
        notice('维修完成', `${best.def.name} 恢复了 ${use.repair} 点耐久。`, 'good');
      } else if (!run.base.destroyed && dist(p.x, p.y, run.base.x, run.base.y) < 200) {
        run.base.hp = Math.min(run.base.maxHp, run.base.hp + use.repair);
        notice('维修完成', `核心舱恢复 ${use.repair} 点耐久。`, 'good');
      } else {
        notice('附近没有可修的建筑', '走到受损建筑旁边再用。', 'warn');
        return;
      }
    }
    if (use.fuel) {
      const v = run.vehicle;
      if (dist(p.x, p.y, v.x, v.y) > 140 && !p.inVehicle) { notice('离载具太远', '走到载具旁边再用。', 'warn'); return; }
      v.fuel = Math.min(v.fuelMax, v.fuel + use.fuel);
      notice('补充燃料', `载具燃料 ${Math.ceil(v.fuel)}/${v.fuelMax}`, 'good');
    }
    if (use.beaconFuel) {
      run.director.refuelBeacon(use.beaconFuel);
    }
    if (use.bioPoint) {
      run.bioPoints = (run.bioPoints || 0) + 1;
      run.grantExperimentChoice(1);
    }
    if (use.recall) {
      const spot = run.world.findOpenSpot(run.base.x + 60, run.base.y + 40, 140);
      p.x = spot.x; p.y = spot.y; p.lastX = p.x; p.lastY = p.y;
      notice('已传送回基地', '回城芯片烧毁了。', 'good');
      bus.emit(EV.SFX, { name: 'unlock' });
    }
    if (use.scan) {
      let found = 0;
      for (const n of run.world.nests) {
        if (n.destroyed || n.discovered) continue;
        if (dist(p.x, p.y, n.x, n.y) < use.scan) { n.discovered = true; found++; }
      }
      for (const poi of run.world.pois) {
        if (poi.discovered) continue;
        if (dist(p.x, p.y, poi.x, poi.y) < use.scan) { poi.discovered = true; found++; }
      }
      notice('扫描完成', found ? `标记了 ${found} 个目标，看大地图（M）。` : '附近没有新的目标。', found ? 'good' : 'info');
    }
    if (use.deploy) {
      const t = run.towerSystem.placeTower(use.deploy, p.x, p.y, { free: true, instant: true });
      if (!t) return;
    }
    counts[id] = counts[id] - 1;
    bus.emit(EV.SFX, { name: 'pickup' });
  }

  // =========================================================
  //  建造
  // =========================================================
  //
  // 放置模式是**时停**的：进入就暂停，放完不退出来可以继续放，
  // 按 B / Esc / 右键才退出，退出后回到建造面板（仍然暂停），
  // 关掉面板才恢复游戏。
  //
  // 为什么这么改：以前面板卡片里写的是
  //     modals.close();  startPlacement(...)
  // 而 `modals.close()` 会触发面板的 onClose -> `game.paused = false`。
  // 于是「放置模式」其实是**在跑着的游戏里**放置：怪在动、塔在打，
  // 而且那时候左键既落点又开火 —— 玩家按 B 想建东西，结果角色对着地面开枪。
  // 现在 `startPlacement` 自己负责暂停，不再依赖调用方的顺序。

  /** 进入放置模式（会自动暂停游戏并收起面板） */
  startPlacement(kind, id) {
    const ui = this.game.ui;
    ui?.modals?.closeAll?.();
    this.game.paused = true;
    this.pendingPlacement = { kind, id };
    notice('放置模式',
      '左键落点，可以连续放。按 B / Esc / 右键结束建造（游戏在建造期间是暂停的）。', 'info');
  }

  /**
   * 结束放置模式。
   * @param {boolean} reopen 是否回到建造面板（默认回，保持暂停）
   */
  endPlacement(reopen = true) {
    this.pendingPlacement = null;
    if (this.run?.world) this.game.renderer.placementPreview = null;
    const reopenFn = this.game.ui?.pendingPanelReopen;
    if (reopen && reopenFn) {
      this.game.ui.pendingPanelReopen = null;
      this.game.paused = true;
      reopenFn();
    } else {
      this.game.paused = false;
    }
  }

  /** 取消放置（B / Esc / 右键）——回到建造面板继续挑 */
  cancelPlacement() {
    this.endPlacement(true);
  }

  confirmPlacement(worldX, worldY) {
    const run = this.run;
    const pl = this.pendingPlacement;
    if (!run || !pl) return false;
    let result = null;
    if (pl.kind === 'tower') result = run.towerSystem.placeTower(pl.id, worldX, worldY);
    else if (pl.kind === 'structure') result = run.towerSystem.placeStructure(pl.id, worldX, worldY);
    else if (pl.kind === 'town') result = run.town.placeBuilding(pl.id, worldX, worldY);
    if (result) {
      /*
       * 落点成功后**不退出来**：玩家通常要连着放好几座塔。
       * 进度暂停着，放完按 B 结束。
       * 唯一的例外是城镇建筑 —— 它一次一般只建一座，而且建完面板会重新算解锁状态，
       * 所以直接回到面板。
       */
      if (pl.kind === 'town') {
        this.endPlacement(true);
      } else {
        this.game.paused = true;
        bus.emit(EV.SFX, { name: 'uiClick' });
      }
      return true;
    }
    return false;
  }

  // =========================================================
  //  科技
  // =========================================================

  unlockTech(id) {
    const run = this.run;
    const def = TECH_MAP[id];
    if (!def) return false;
    const ok = run.unlockTech(id);
    if (!ok) {
      if (!run.canAfford(def.cost)) notice('资源不足', `需要 ${costText(def.cost)}`, 'warn');
      else notice('前置未满足', '需要先解锁前置科技。', 'warn');
      bus.emit(EV.SFX, { name: 'error' });
    }
    return ok;
  }

  // =========================================================
  //  实验科技
  // =========================================================

  chooseExperimentDir(dir) {
    const run = this.run;
    if (!run) return null;
    const opts = run.rollOptions(dir);
    return opts;
  }

  rerollExperiments() {
    return this.run?.reroll() || false;
  }

  takeExperiment(id) {
    return this.run?.takeExperiment(id) || false;
  }

  // =========================================================
  //  基地与吸引阵列
  // =========================================================

  refuelBeaconFromCore() {
    const run = this.run;
    if (!run) return;
    const cores = run.resources.beaconCore || 0;
    if (cores <= 0) { notice('没有吸引核心', '摧毁巢穴 Boss 或回收废弃基地的吸引阵列可以获得。', 'warn'); return; }
    run.resources.beaconCore = cores - 1;
    run.director.refuelBeacon(run.beacon.fuelMax);
    notice('吸引阵列充能', '消耗 1 个吸引核心，装置能量补满。', 'good');
  }

  /** 建立第二基地（需要科技） */
  buildSecondBase(worldX, worldY) {
    const run = this.run;
    if (!run) return false;
    if (!run.hasFeature('secondBase')) {
      notice('尚未获得授权', '需要先研发【第二基地授权】科技。', 'warn');
      return false;
    }
    if (run.bases.filter(b => !b.isPrimary).length >= 2) {
      notice('已达上限', '最多可以建立两座分基地。', 'warn');
      return false;
    }
    const cost = { gold: 800, metal: 300, parts: 50 };
    if (!run.canAfford(cost)) { notice('资源不足', `需要 ${costText(cost)}`, 'warn'); return false; }
    // 距离已有基地太近不行
    for (const b of run.bases) {
      if (dist(worldX, worldY, b.x, b.y) < 1400) {
        notice('离主基地太近', '分基地必须建在更远的地方（至少 1400 像素）。', 'warn');
        return false;
      }
    }
    const nest = run.world.nests.reduce((best, n) => {
      if (n.destroyed) return best;
      const d = dist(worldX, worldY, n.x, n.y);
      return d < (best?.d ?? Infinity) ? { n, d } : best;
    }, null);
    if (nest && nest.d < 420) {
      notice('太靠近虫巢', '先把附近的巢穴清掉再建基地，否则它会立刻被淹没。', 'warn');
      return false;
    }
    run.pay(cost);
    const base = run.addBase(worldX, worldY, false);
    run.enemySystem?.invalidateFlow();
    notice('第二基地已落成', `${base.name} 开始运转。它有自己的塔位与人口，共享科技。`, 'good');
    return true;
  }

  /** 手动触发怪潮（拉收益） */
  forceWave() {
    const run = this.run;
    if (!run) return;
    if (run.wave.huntMode) { notice('无法呼叫', '基地已毁，怪潮不听你的了。', 'warn'); return; }
    if (!run.beacon.online) { notice('装置离线', '先给吸引阵列充能。', 'warn'); return; }
    run.director.forceWave();
  }

  /** 升级吸引阵列（消耗科技点/资源，主科技树之外的加速途径） */
  upgradeBeacon() {
    const run = this.run;
    const b = run.beacon;
    if (b.level >= BEACON.maxLevel) { notice('已达上限', '吸引阵列升到顶了。', 'warn'); return; }
    const cores = 1 + Math.floor(b.level / 2);
    const cost = { gold: 200 + b.level * 160, metal: 60 + b.level * 40, crystal: 10 + b.level * 12 };
    if ((run.resources.beaconCore || 0) < cores) {
      notice('吸引核心不足', `升级到 Lv${b.level + 1} 需要 ${cores} 个吸引核心。`, 'warn');
      return;
    }
    if (!run.canAfford(cost)) {
      notice('资源不足', `需要 ${costText(cost)} 与 ${cores} 个吸引核心`, 'warn');
      return;
    }
    run.pay(cost);
    run.resources.beaconCore -= cores;
    b.level++;
    b.refresh(run);
    notice(`吸引阵列 Lv${b.level}`, `牵引半径 ${Math.round(b.radius)}，牵引强度 ${(b.intensity * 100).toFixed(0)}%。怪会更多更强，但金币与经验也更多。`, 'good');
    run.addLog(`吸引阵列升级到 Lv${b.level}`);
  }

  // =========================================================
  //  城镇
  // =========================================================

  placeTownBuilding(type, x, y) {
    return this.run?.town.placeBuilding(type, x, y) || null;
  }

  setWorkers(id, n) { return this.run?.town.setWorkers(id, n) || false; }
  demolishBuilding(id) { return this.run?.town.demolish(id) || false; }
  autoAssignWorkers() {
    this.run?.town.autoAssign();
    notice('已自动分配人口', '空闲人口被派往有岗位的建筑。', 'info');
  }

  // =========================================================
  //  背包与装备
  // =========================================================

  equipItem(uid) {
    const run = this.run;
    if (!run) return false;
    const item = run.loot.removeFromBag(uid);
    if (!item) return false;
    const p = run.player;
    if (item.type === 'weapon') {
      if (p.weapons.length < 4) {
        p.weapons.push(item);
        p.weaponIndex = p.weapons.length - 1;
      } else {
        const old = p.weapons[p.weaponIndex];
        p.weapons[p.weaponIndex] = item;
        if (old) run.loot.pushToBag(old);
      }
      run.recomputeStats();
      return true;
    }
    if (item.slot === 'module') {
      const v = run.vehicle;
      const idx = v.modules.findIndex(m => !m);
      if (idx < 0) { run.loot.pushToBag(item); notice('模块槽已满', '先卸下一个模块。', 'warn'); return false; }
      v.modules[idx] = item;
      run.recomputeStats();
      return true;
    }
    const slotsFor = { armor: [0], trinket: [1, 2] }[item.slot] || [];
    for (const s of slotsFor) {
      if (!p.equipment[s]) { p.equipment[s] = item; run.recomputeStats(); return true; }
    }
    const s = slotsFor[0];
    const old = p.equipment[s];
    p.equipment[s] = item;
    if (old) run.loot.pushToBag(old);
    run.recomputeStats();
    return true;
  }

  unequipItem(slotIndex) {
    const run = this.run;
    if (!run) return false;
    const p = run.player;
    const item = p.equipment[slotIndex];
    if (!item) return false;
    if (p.carryUsed + 6 > p.carryMax) { notice('背包已满', '卸不下来，先清理背包。', 'warn'); return false; }
    p.equipment[slotIndex] = null;
    run.loot.pushToBag(item);
    if (p.weapons[slotIndex] === item) p.weapons[slotIndex] = null;
    run.recomputeStats();
    return true;
  }

  unequipVehicleModule(i) {
    const run = this.run;
    if (!run) return false;
    const m = run.vehicle.modules[i];
    if (!m) return false;
    if (!run.loot.pushToBag(m)) { notice('背包已满', '卸不下来。', 'warn'); return false; }
    run.vehicle.modules[i] = null;
    run.recomputeStats();
    return true;
  }

  dropWeapon(i) {
    const run = this.run;
    if (!run) return false;
    const p = run.player;
    if (p.weapons.length <= 1) { notice('不能丢弃', '至少要留一把武器。', 'warn'); return false; }
    const w = p.weapons[i];
    if (!w) return false;
    if (!run.loot.pushToBag(w)) { notice('背包已满', '装不下这把武器。', 'warn'); return false; }
    p.weapons.splice(i, 1);
    p.weaponIndex = clamp(p.weaponIndex, 0, p.weapons.length - 1);
    run.recomputeStats();
    return true;
  }

  sellItem(uid) {
    const run = this.run;
    if (!run) return 0;
    const gain = run.loot.sellItem(uid);
    if (gain) notice('已出售', `获得 ${gain} 金币。`, 'good');
    return gain;
  }

  // =========================================================
  //  载具
  // =========================================================

  mountVehicleWeapon(uid, slot) {
    const run = this.run;
    if (!run) return false;
    const item = run.loot.removeFromBag(uid);
    if (!item || item.type !== 'weapon') { if (item) run.loot.pushToBag(item); return false; }
    const v = run.vehicle;
    // 载具炮塔上限固定为 2（科技给挂架，但不会超过 VEHICLE.maxTurrets）
    const max = run.vehicleTurretCap();
    if (slot >= max) {
      run.loot.pushToBag(item);
      notice('槽位未解锁', `载具最多挂 ${max} 座炮塔，先研发【载具炮塔挂架】或换一个槽位。`, 'warn');
      return false;
    }
    const old = v.mounted[slot];
    v.mounted[slot] = item;
    if (old) run.loot.pushToBag(old);
    run.recomputeStats();
    return true;
  }

  /** 安装 / 卸下悬挂近战模块（撞角 / 电锯）—— 只影响撞击伤害 */
  setVehicleMelee(kind) {
    const run = this.run;
    if (!run) return false;
    const v = run.vehicle;
    const def = VEHICLE_MELEE[kind];
    if (!def) return false;
    // unlocks 挂在**玩家**身上（runState: p.unlocks = unlocks），
    // 不在 playerStats（那是 StatSet，只有数值）—— 写错路径会直接 TypeError。
    const mods = run.player?.unlocks?.meleeModules;
    if (!mods || !mods.has(kind)) {
      notice('还没解锁', `${def.name} 需要在科技树里研发。`, 'warn');
      return false;
    }
    v.meleeModule = v.meleeModule && v.meleeModule.kind === kind ? null : { ...def, kind };
    notice(v.meleeModule ? '已安装模块' : '已卸下模块',
      v.meleeModule ? `${def.name}：撞击伤害 +${def.damage}` : '车头恢复原状。', 'good');
    run.recomputeStats();
    return true;
  }

  unmountVehicleWeapon(slot) {
    const run = this.run;
    if (!run) return false;
    const v = run.vehicle;
    const w = v.mounted[slot];
    if (!w) return false;
    if (!run.loot.pushToBag(w)) { notice('背包已满', '装不下。', 'warn'); return false; }
    v.mounted[slot] = null;
    run.recomputeStats();
    return true;
  }

  repairVehicle() {
    const run = this.run;
    if (!run) return false;
    const v = run.vehicle;
    if (v.hp >= v.hpMax && !v.destroyed) { notice('无需维修', '载具状态良好。', 'info'); return false; }
    const missing = v.destroyed ? v.hpMax : (v.hpMax - v.hp);
    const cost = { metal: Math.ceil(missing * 0.25), parts: Math.ceil(missing * 0.02) };
    if (!run.canAfford(cost)) { notice('资源不足', `维修需要 ${costText(cost)}`, 'warn'); return false; }
    run.pay(cost);
    v.destroyed = false;
    v.hp = v.hpMax;
    notice('载具已修复', '满状态重新上路。', 'good');
    return true;
  }

  installPortableBeacon() {
    const run = this.run;
    if (!run) return false;
    if (!run.hasFeature('portableBeacon')) {
      notice('尚未解锁', '需要【便携吸引装置】科技或实验科技。', 'warn');
      return false;
    }
    const v = run.vehicle;
    if (v.beacon) {
      v.beacon = null;
      notice('已拆除便携吸引装置', '载具不再主动引怪。', 'info');
      return true;
    }
    if ((run.resources.beaconCore || 0) < 1) { notice('需要吸引核心', '安装便携装置需要 1 个吸引核心。', 'warn'); return false; }
    run.resources.beaconCore -= 1;
    v.beacon = { radius: 700, intensity: 0.35 };
    notice('已安装便携吸引装置', '开车时它会牵引附近的虫巢 —— 你可以主动决定怪潮往哪冲。', 'good');
    return true;
  }

  // =========================================================
  //  星球
  // =========================================================

  /** 继续经营当前星球 */
  continueManaging() {
    const run = this.run;
    run.planetClaimed = true;
    notice('继续经营', '虫巢已清空，安心建设你的殖民地。你可以随时在【星球】面板里开拓下一颗星球。', 'good');
  }

  /** 开拓下一颗星球 */
  travelToNextPlanet() {
    const run = this.run;
    if (!run) return false;
    if (!run.planetClaimed) {
      notice('还不能出发', '先清光这颗星球上所有的虫巢，才能申请开拓下一颗。', 'warn');
      return false;
    }
    const nextIndex = run.planetIndex + 1;
    const def = planetDef(nextIndex);

    this.game.paused = true;
    this._confirmTravel = { nextIndex, def };
    openPlanetPanel(this.game, this, { mode: 'confirm', nextIndex, def });
    return true;
  }

  /** 真正执行跳星 */
  doTravelToPlanet(nextIndex) {
    const run = this.run;
    const def = planetDef(nextIndex);

    // 记录旧星球
    if (!run.claimedPlanets.some(p => p.index === run.planetIndex)) {
      run.claimedPlanets.push({ index: run.planetIndex, name: run.planet.name, since: run.time });
    }

    // 保留的东西：玩家等级/装备/科技/实验/资源/人口
    const carry = {
      resources: { ...run.resources },
      unlockedTech: new Set(run.unlockedTech),
      experiments: new Map(run.experiments),
      pendingChoices: run.pendingChoices,
      player: run.player.serialize(),
      population: run.population,
      townBuildings: JSON.parse(JSON.stringify(run.townBuildings)),
      stats: run.stats,
      claimedPlanets: run.claimedPlanets,
      bioPoints: run.bioPoints,
      genes: run.genes.map(g => ({ id: g.id, level: g.level || 1 })),
      log: run.log,
      itemCounts: run.itemCounts || {},
    };

    // 新星球
    const { RunState } = RUN_MODULE;
    const next = new RunState({
      seed: run.seedStr + '|p' + nextIndex,
      planetIndex: nextIndex,
      characterId: run.characterId,
      claimedPlanets: carry.claimedPlanets,
    });

    // 回填
    next.resources = { ...next.resources, ...carry.resources, ...def.startingSupplies };
    next.storageCap = { ...run.storageCap };
    next.unlockedTech = new Set(carry.unlockedTech);
    next.experiments = new Map(carry.experiments);
    next.pendingChoices = carry.pendingChoices;
    next.population = 0;                       // 新星球从零开始建城
    next.townBuildings = [];
    next.stats = carry.stats;
    next.bioPoints = carry.bioPoints;
    next.genes = carry.genes;
    next.log = carry.log;
    next.itemCounts = carry.itemCounts;

    next.player.restore(carry.player);
    const site = next.world.baseSite;
    next.player.x = site.x + TILE * 4;
    next.player.y = site.y;
    next.player.lastX = next.player.x;
    next.player.lastY = next.player.y;
    next.player.hp = next.player.hpMax;
    next.player.inVehicle = false;

    // 防御塔科技重置：新星球需要重新申请空投授权
    if (def.resetTowerTech) {
      const towerTechs = ['t_turretSlot', 't_gatling', 't_mortar', 't_sniper', 't_flame',
        't_cryo', 't_tesla', 't_rail', 't_landing', 't_towerOverclock'];
      for (const t of towerTechs) next.unlockedTech.delete(t);
      next.recomputeStats();
      // 补偿：返还一部分研究资料
      next.resources.research = (next.resources.research || 0) + 6;
    }

    // 交接给 main.js 重建系统
    this._pendingRun = next;
    return next;
  }

  // =========================================================
  //  存档
  // =========================================================

  save(slot = 'auto') {
    const ok = this.game.save(slot);
    notice(ok ? '已保存' : '保存失败', ok ? `存档写入【${slot}】。` : '浏览器存储不可用或已满。', ok ? 'good' : 'danger');
    return ok;
  }

  load(slot = 'auto') {
    return this.game.load(slot);
  }

  deleteSave(slot) { return this.game.deleteSave(slot); }

  // =========================================================
  //  暂停 / 菜单
  // =========================================================

  /**
   * 暂停键的统一入口。
   *
   * 规则（顺序很重要）：
   *   1. 设置面板开着时，暂停键只是「关闭设置」——不能顺手把游戏也取消暂停，
   *      否则玩家会以为「一关设置就自动继续了」。
   *   2. 暂停菜单开着时，关掉它并继续。
   *   3. 其他面板（背包/科技/地图…）开着时，暂停键 = 打开暂停菜单，
   *      而不是把面板关掉丢回游戏 —— 那样玩家会丢失上下文。
   *   4. 都没有的时候，正常在「暂停 / 继续」之间切换。
   */
  togglePause() {
    // 放置模式优先：这时候 Esc / B 的意思是「结束建造」，不是「取消暂停」。
    // 少了这一条，玩家在放置中按 Esc 会直接恢复游戏，而放置模式还挂着。
    if (this.pendingPlacement) { this.endPlacement(true); return; }
    const modals = this.game.ui?.modals;
    if (modals?.isTopSettings?.()) { modals.close(); return; }
    if (modals?.isOpen) { this.game.paused = false; modals.closeAll(); return; }
    if (this.game.state !== 'playing') return;
    if (this.game.paused) { this.game.paused = false; }
    else this.openPause();
  }

  backToMenu() {
    this.game.ui?.modals?.closeAll();
    this.game.paused = false;
    this.game.run = null;
    this.game.setState('menu');
    this.game.ui?.showMainMenu?.();
    bus.emit(EV.SFX, { name: 'uiClose' });
  }
}

// 延迟导入 RunState，避免循环依赖
let RUN_MODULE = null;
export function injectRunModule(mod) { RUN_MODULE = mod; }
