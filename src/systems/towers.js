/**
 * 防御塔系统。
 *
 * - 全部自动索敌开火，玩家可以「手动接管」某座塔获得爆发加成。
 * - 建造 / 空投需要时间，期间塔是脆的（这是怪潮时最危险的窗口）。
 * - 实验科技带来的爆炸 / 减速 / 燃烧 / 链式 / 过载在这里生效。
 */

import { TILE } from '../core/config.js';
import { clamp, clamp01, dist, dist2, angleTo, turnToward, swapRemove } from '../core/math.js';
import { rnd } from '../core/rng.js';
import { bus, EV, notice } from '../core/events.js';
import { TOWER_DEF, STRUCTURE_DEF, STRUCTURE } from '../data/towers.js';
import { createProjectile, createTower, createStructure } from './runState.js';

const TOWER_GAP = 44;        // 空地上塔与塔的最小圆心距离（略大于一格）
const PLATFORM_R = 26;       // 「站在防御塔基座上」的判定半径

export class TowerSystem {
  constructor(run) {
    this.run = run;
    this.enabled = true;
    this.manualTower = null;
    this.aimAngle = 0;
    this._qb = [];
    this._qb2 = [];
  }

  update(dt, game) {
    const run = this.run;
    this.updateConstruction(dt);
    this.updateStructures(dt);
    this.updateAutoRebuild(dt);
    this.updateManual(game);
    this.updateTowerLinks();
    this._linkTimer = (this._linkTimer || 0) + dt;

    for (const t of run.towers) {
      if (t.building) continue;
      this.updateTower(t, dt, game);
    }

    // 基地护盾恢复
    const shieldCfg = run.playerStats.mechanics.baseShield;
    if (shieldCfg) {
      for (const b of run.bases) {
        if (b.destroyed) continue;
        b.shield = Math.min(b.maxShield, b.shield + (shieldCfg.regen || 0) * dt);
      }
    }
  }

  // =========================================================
  //  建造
  // =========================================================

  updateConstruction(dt) {
    const run = this.run;
    const speed = 1 + run.playerStats.get('buildSpeed');
    for (const t of run.towers) {
      if (!t.building) continue;
      t.cd -= dt * speed;
      t.buildProgress = 1 - clamp01(t.cd / Math.max(0.001, t.def.buildTime || 3));
      if (t.cd <= 0) {
        t.building = false;
        t.buildProgress = 1;
        bus.emit(EV.TOWER_BUILT, { tower: t });
        bus.emit(EV.SFX, { name: 'build' });
        bus.emit(EV.SCREEN_SHAKE, { mag: 3, time: 0.2 });
        notice('空投完成', `${t.def.name} 已就位并开始自动索敌。`, 'good');
      }
    }
    for (const s of run.structures) {
      if (!s.building) continue;
      s.buildProgress += dt * speed / Math.max(0.4, s.def.buildTime || 2);
      if (s.buildProgress >= 1) {
        s.building = false;
        s.buildProgress = 1;
        bus.emit(EV.SFX, { name: 'build' });
      }
    }
  }

  updateAutoRebuild(dt) {
    const run = this.run;
    if (!run.autoRebuildQueue.length) return;
    for (let i = run.autoRebuildQueue.length - 1; i >= 0; i--) {
      const job = run.autoRebuildQueue[i];
      if (run.time < job.at) continue;
      const def = TOWER_DEF[job.type];
      if (!def) { swapRemove(run.autoRebuildQueue, i); continue; }
      const discount = 1 + run.playerStats.get('buildCostMult') - run.playerStats.get('rebuildDiscount');
      const cost = scaleCost(def.cost, 0.6 * Math.max(0.2, discount));
      if (!run.canAfford(cost)) continue;
      run.pay(cost);
      swapRemove(run.autoRebuildQueue, i);
      this.placeTower(job.type, job.x, job.y, { auto: true });
    }
  }

  /** 建造一座建筑（墙/仓库/农田等） */
  placeStructure(type, x, y) {
    const run = this.run;
    const def = STRUCTURE_DEF[type];
    if (!def) return null;
    const cost = scaleCost(def.cost, 1 + run.playerStats.get('buildCostMult'));
    if (!run.canAfford(cost)) {
      notice('资源不足', `建造 ${def.name} 需要 ${costText(cost)}`, 'warn');
      bus.emit(EV.SFX, { name: 'error' });
      return null;
    }
    const spot = this.findPlacement(x, y, def.size || 1, { forTower: false });
    if (!spot) {
      notice('无法建造', '这里没有足够的空地。', 'warn');
      bus.emit(EV.SFX, { name: 'error' });
      return null;
    }
    run.pay(cost);
    const s = createStructure(run, type, spot.x, spot.y, {});
    run.structures.push(s);
    run._syncBlockedTiles();
    run.enemySystem?.invalidateFlow();
    run.stats.structuresBuilt++;
    bus.emit(EV.SFX, { name: 'build' });
    return s;
  }

  /** 申请空投一座防御塔 */
  placeTower(type, x, y, opts = {}) {
    const run = this.run;
    const def = TOWER_DEF[type];
    if (!def) return null;
    // 上限检查
    const cap = this.towerCap();
    if (run.towers.length >= cap) {
      notice('塔位已满', `当前防御塔上限 ${cap}，需要研发科技或实验科技来扩建。`, 'warn');
      bus.emit(EV.SFX, { name: 'error' });
      return null;
    }
    const charMult = run.charDef.passive.towerCostMult || 1;
    const cost = scaleCost(def.cost, charMult * (1 + run.playerStats.get('buildCostMult')));
    if (!opts.free && !run.canAfford(cost)) {
      notice('申请被驳回', `${def.name} 需要 ${costText(cost)}`, 'warn');
      bus.emit(EV.SFX, { name: 'error' });
      return null;
    }
    const spot = this.findPlacement(x, y, 1, { forTower: true });
    if (!spot) {
      notice('无法空投', '这里没有合适的落点。', 'warn');
      bus.emit(EV.SFX, { name: 'error' });
      return null;
    }
    if (!opts.free) run.pay(cost);

    const t = createTower(run, type, spot.x, spot.y, { instant: !!opts.instant });
    if (!t) return null;
    // 空投时间受科技影响
    if (!opts.instant) {
      const dropMult = 1 + run.playerStats.get('airDropSpeed');
      t.cd = (def.buildTime || 3) / Math.max(0.2, dropMult);
      t.dropTimer = t.cd;
    }
    run.towers.push(t);
    run.stats.towersBuilt++;
    bus.emit(EV.SFX, { name: 'build' });

    // 空投可视化
    run.effects.push({
      kind: 'drop', x: spot.x, y: spot.y, r: 60,
      life: t.building ? t.cd : 0.4, maxLife: t.building ? t.cd : 0.4,
      color: '#8fe0ff',
    });
    return t;
  }

  towerCap() {
    const run = this.run;
    return Math.round(4 + run.playerStats.get('towerCap'));
  }

  /**
   * 找一个不重叠的建造点。
   *
   * 规则（按玩家要求改回来）：
   *   - 塔放在**空地**上时必须保持间隔（`TOWER_GAP` = 44px，比一格略大）；
   *   - 塔放在**【防御塔基座】上**时**不需要间隔**，可以贴着一座挨一座地摆。
   * 这正是防御塔基座存在的意义 —— 不然它只是一块贵一点的空地，
   * 玩家原话是「这个防御塔基座太鸡肋了」。
   *
   * 判据：候选点附近有己方的 turretSlot（`PLATFORM_R` 内）就算「站在基座上」。
   * 顺带修了一个死结：structures 的冲突检查原来把基座自己也算进去，
   * 于是塔**永远放不到基座上**（那才是它鸡肋的真正原因）。
   */
  findPlacement(x, y, size = 1, opts = {}) {
    const run = this.run;
    const forTower = !!opts.forTower;
    const candidates = [
      [x, y], [x + TILE, y], [x - TILE, y], [x, y + TILE], [x, y - TILE],
      [x + TILE, y + TILE], [x - TILE, y - TILE], [x + TILE, y - TILE], [x - TILE, y + TILE],
      [x + TILE * 2, y], [x - TILE * 2, y], [x, y + TILE * 2], [x, y - TILE * 2],
    ];
    for (const [cx, cy] of candidates) {
      const tx = Math.floor(cx / TILE), ty = Math.floor(cy / TILE);
      const px = tx * TILE + TILE / 2, py = ty * TILE + TILE / 2;
      if (run.world.isBlockedPx(px, py)) continue;
      const onPlatform = this.platformAt(px, py) !== null;
      let clash = false;
      // 「塔与塔要留间隔」只约束**塔**：铺基座时不该被旁边的塔挡住 ——
      // 否则你永远没法在已有的塔边上补一块基座（这条曾经把相邻基座推到 80px 外）
      if (forTower && !onPlatform) {
        for (const t of run.towers) if (dist2(px, py, t.x, t.y) < TOWER_GAP * TOWER_GAP) { clash = true; break; }
      }
      // 和别的建筑冲突（基座本身不算冲突 —— 塔就是要坐在它上面）
      if (!clash) {
        for (const s of run.structures) {
          if (s.type === STRUCTURE.TURRET_SLOT) continue;
          if (s.hp <= 0) continue;
          if (dist2(px, py, s.x, s.y) < 40 * 40) { clash = true; break; }
        }
      }
      if (!clash) for (const b of run.bases) if (dist2(px, py, b.x, b.y) < (b.r * 0.6) ** 2) { clash = true; break; }
      if (clash) continue;
      // 必须在基地的建造范围内（或用便携建造许可）
      // 纯塔防模式的范围是整片阵地，见 runState.buildRadiusFrom
      const nearBase = run.bases.some(b => !b.destroyed && dist(px, py, b.x, b.y) < run.buildRadiusFrom(b));
      if (!nearBase) continue;
      return { x: px, y: py, onPlatform };
    }
    return null;
  }

  /** 这个位置是不是站在某块【防御塔基座】上（是就返回那块基座） */
  platformAt(x, y) {
    const run = this.run;
    for (const s of run.structures) {
      if (s.type !== STRUCTURE.TURRET_SLOT) continue;
      if (s.hp <= 0) continue;
      if (dist2(x, y, s.x, s.y) <= PLATFORM_R * PLATFORM_R) return s;
    }
    return null;
  }

  /**
   * 相邻的两块基座之间不需要间隔（40px = 一格）。
   * 基座与基座的冲突单独用结构间距判断，见 findPlacement。
   */
  structureGap() { return 40; }

  // =========================================================
  //  建筑行为（生产/治疗/修理）
  // =========================================================

  updateStructures(dt) {
    const run = this.run;
    // 基地自动修复（来自实验/科技）
    const autoRepair = run.playerStats.get('autoRepairBase');
    if (autoRepair > 0) {
      const costMult = 0.15;
      for (const b of [...run.towers, ...run.structures]) {
        if (b.hp >= b.hpMax) continue;
        const heal = autoRepair * dt;
        if (run.resources.metal < heal * costMult) break;
        run.resources.metal -= heal * costMult;
        b.hp = Math.min(b.hpMax, b.hp + heal);
      }
    }
    for (const s of run.structures) {
      if (s.building) continue;
      s.cd = (s.cd || 0) - dt;
      if (s.cd > 0) continue;
      const def = s.def;
      // 维修坞
      if (def.autoRepair) {
        s.cd = 1;
        const mult = 1 + (s.workers > 0 ? 1 : 0);
        for (const b of [...run.towers, ...run.structures, ...run.bases]) {
          if (b.hp >= (b.hpMax || b.maxHp)) continue;
          if (dist(s.x, s.y, b.x, b.y) > def.autoRepair.radius) continue;
          const max = b.hpMax || b.maxHp;
          b.hp = Math.min(max, b.hp + def.autoRepair.rate * mult);
        }
      }
      // 力场/护盾类塔
      if (def.shieldPool) {
        s.cd = 1;
        // 给范围内建筑分配共享护盾
        const targets = [...run.towers, ...run.structures].filter(b => b !== s && dist(s.x, s.y, b.x, b.y) < def.range);
        const share = def.shieldPool.amount / Math.max(1, targets.length);
        for (const b of targets) {
          b.shieldMax = Math.max(b.shieldMax || 0, share);
          b.shield = Math.min(b.shieldMax, (b.shield || 0) + def.shieldPool.regen);
        }
      }
    }
  }

  // =========================================================
  //  防御塔开火
  // =========================================================

  updateTower(t, dt, game) {
    const run = this.run;
    const def = t.def;
    if (t.hitFlash > 0) t.hitFlash = Math.max(0, t.hitFlash - dt * 4);

    // 支援型塔没有攻击
    if (def.kind === 'support' || !def.dmg) {
      if (def.repair) this.supportRepair(t, dt);
      return;
    }

    // 手动接管
    if (t.manual) {
      const wm = game.mouseWorld;
      t.angle = angleTo(t.x, t.y, wm.x, wm.y);
      if (!game.input.mouseIsDown(0)) { t.cd -= dt; return; }
      t.cd -= dt;
      if (t.cd > 0) return;
      t.cd = (t.attackCd * 0.75) / (1 + (t.vengeanceRate || 0));
      this.fire(t, t.angle, game, { manual: true });
      return;
    }

    // 自动索敌
    t.cd -= dt;
    const range = t.range;
    if (!t.target || t.target.dead || t.target.hp <= 0 || dist2(t.x, t.y, t.target.x, t.target.y) > range * range) {
      t.target = this.acquireTarget(t, range);
    }
    if (!t.target) return;
    t.angle = turnToward(t.angle, angleTo(t.x, t.y, t.target.x, t.target.y), dt * 6);
    if (t.cd > 0) return;

    // 集火协议：同一目标被多座塔打时增伤
    // 复仇协议给的攻速在这里生效（以前只算不生效）
    t.cd = t.attackCd / (1 + (t.vengeanceRate || 0));
    this.fire(t, t.angle, game, {});
  }

  acquireTarget(t, range) {
    const run = this.run;
    // 优先级：离基地最近 > 血量最高 > 最近
    const near = run.spatial.query(t.x, t.y, range, this._qb);
    let best = null, bestScore = -Infinity;
    for (const e of near) {
      if (e.kind !== 'enemy' || e.dead) continue;
      const d = dist(t.x, t.y, e.x, e.y) - e.r;
      if (d > range) continue;
      let score = -d * 0.01;
      if (e.boss) score += 40;
      else if (e.elite) score += 18;
      // 靠基地越近越优先
      const db = dist(e.x, e.y, run.base.x, run.base.y);
      score += clamp01(1 - db / 1200) * 12;
      if (e.hp < e.hpMax * 0.3) score += 4;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  supportRepair(t, dt) {
    const run = this.run;
    const def = t.def;
    t.cd -= dt;
    if (t.cd > 0) return;
    t.cd = def.cd || 1;
    if (!def.repair) return;
    let healed = false;
    for (const b of [...run.towers, ...run.structures, ...run.bases]) {
      const max = b.hpMax || b.maxHp;
      if (b.hp >= max) continue;
      if (dist(t.x, t.y, b.x, b.y) > def.repair.radius) continue;
      b.hp = Math.min(max, b.hp + def.repair.amount);
      healed = true;
    }
    if (healed) {
      run.effects.push({ kind: 'ring', x: t.x, y: t.y, r: def.repair.radius, life: 0.4, maxLife: 0.4, color: '#6ee7a8' });
    }
  }

  /**
   * 标记「这座塔是不是坐在【防御塔基座】上」。
   *
   * 基座的作用是**取消塔与塔之间的间隔**（玩家澄清过：不是「相连加成」），
   * 所以这里不算任何数值，只维护一个布尔字段，给渲染和 UI 用。
   */
  updateTowerLinks() {
    const run = this.run;
    if (!run.towers.length) return;
    // 只在塔数变化时重算，省掉每帧 O(n²)
    const key = run.towers.length + ':' + run.structures.filter(s => s.type === STRUCTURE.TURRET_SLOT).length;
    if (this._linkKey === key) return;
    this._linkKey = key;
    for (const t of run.towers) {
      t.onPlatform = !!this.platformAt(t.x, t.y);
      const on = this.platformAt(t.x, t.y);
      t.platformId = on ? on.id : null;
    }
  }

  /** 防御塔开火 —— 支持 bullet / shell / beam / chain / aura */
  fire(t, angle, game, opts = {}) {
    const run = this.run;
    const def = t.def;
    const st = run.playerStats;
    let dmg = t.damage * (1 + (t.vengeanceBonus || 0));
    if (opts.manual) {
      const man = st.mechanics.manualDamageMult;
      dmg *= 1 + (man || 0.6);
    }
    // 背水一战
    const ls = st.mechanics.lastStand;
    if (ls && run.base.hp / run.base.maxHp < ls.hpThreshold) {
      dmg *= 1 + ls.towerDamage;
    }
    // 过载
    let forcedCrit = false;
    const oc = st.mechanics.towerOvercharge;
    t.overchargeTimer = (t.overchargeTimer || 0) + t.attackCd;
    if (oc && t.overchargeTimer >= oc.every) { t.overchargeTimer = 0; dmg *= oc.mult; forcedCrit = true; }

    const extraShot = Math.round(st.get('towerCap') * 0) + (st.mechanics.towerExtraShot || 0);
    const shots = 1 + (st.mechanics.towerExtraShot || 0);
    for (let i = 0; i < shots; i++) {
      const a = angle + (i > 0 ? rnd.range(-0.06, 0.06) : 0);
      const shotDmg = dmg * (shots > 1 ? 0.9 : 1);
      switch (def.kind) {
        case 'bullet': this.fireBullet(t, a, shotDmg, opts); break;
        case 'shell': this.fireShell(t, a, shotDmg, opts); break;
        case 'beam': this.fireBeam(t, a, shotDmg, opts); break;
        case 'chain': this.fireChain(t, a, shotDmg, opts); break;
        case 'aura': this.fireAura(t, shotDmg); break;
        default: break;
      }
    }
    bus.emit(EV.SFX, { name: def.kind === 'bullet' ? 'shoot' : 'shootHeavy', volume: opts.manual ? 0.9 : 0.45 });
    run.effects.push({
      kind: 'muzzle', x: t.x + Math.cos(angle) * 20, y: t.y + Math.sin(angle) * 20,
      life: 0.08, maxLife: 0.08, color: def.color, angle,
    });
  }

  fireBullet(t, angle, dmg, opts) {
    const run = this.run;
    const def = t.def;
    const speed = def.bulletSpeed || 900;
    const pr = createProjectile({
      x: t.x + Math.cos(angle) * 20,
      y: t.y + Math.sin(angle) * 20,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 4, damage: dmg, life: (def.range / speed) * 1.2,
      color: def.color, friendly: true, owner: t, source: 'tower',
      pierce: def.pierce || 0,
    });
    this.applyTowerEnchants(pr, t);
    run.projectiles.push(pr);
  }

  fireShell(t, angle, dmg, opts) {
    const run = this.run;
    const def = t.def;
    const speed = 420;
    const range = clamp(def.range * 0.85, def.minRange || 100, def.range);
    const tx = t.x + Math.cos(angle) * range;
    const ty = t.y + Math.sin(angle) * range;
    const flight = range / speed;
    const pr = createProjectile({
      x: t.x, y: t.y,
      vx: (tx - t.x) / flight,
      vy: (ty - t.y) / flight,
      r: 8, damage: dmg, life: flight + 0.05, maxLife: flight + 0.05,
      color: def.color, friendly: true, owner: t, source: 'tower',
      gravity: { arc: 90 },
      splash: { radius: def.splash || 100, mult: 1 },
    });
    this.applyTowerEnchants(pr, t);
    run.projectiles.push(pr);
  }

  fireBeam(t, angle, dmg, opts) {
    const run = this.run;
    const def = t.def;
    const range = t.range;
    const ex = t.x + Math.cos(angle) * range;
    const ey = t.y + Math.sin(angle) * range;
    const seen = new Set();
    const steps = Math.ceil(range / 26);
    for (let s = 1; s <= steps; s++) {
      const k = s / steps;
      const px = t.x + (ex - t.x) * k;
      const py = t.y + (ey - t.y) * k;
      const near = run.spatial.query(px, py, 26, this._qb2);
      for (const e of near) {
        if (e.kind !== 'enemy' || e.dead || seen.has(e)) continue;
        seen.add(e);
        run.enemySystem.damage(e, dmg * (def.pierce ? 1 : 1), { source: 'towerBeam', ignoreArmor: def.ignoreArmor, x: t.x, y: t.y });
        this.applyOnHit(e, t);
        if (def.push) {
          const a = angleTo(t.x, t.y, e.x, e.y);
          e.knockX = (e.knockX || 0) + Math.cos(a) * def.push;
          e.knockY = (e.knockY || 0) + Math.sin(a) * def.push;
        }
      }
      if (run.world.isBlockedPx(px, py)) break;
    }
    run.effects.push({ kind: 'beam', x: t.x, y: t.y, x2: ex, y2: ey, life: 0.24, maxLife: 0.24, color: def.color, width: def.id === 'magneticRail' ? 9 : 5 });
    if (opts.manual) bus.emit(EV.SCREEN_SHAKE, { mag: 4, time: 0.16 });
  }

  fireChain(t, angle, dmg, opts) {
    const run = this.run;
    const def = t.def;
    const startX = t.x + Math.cos(angle) * 30;
    const startY = t.y + Math.sin(angle) * 30;
    let cur = run.spatial.nearest(startX, startY, t.range, e => e.kind === 'enemy' && !e.dead);
    if (!cur) return;
    let mult = 1;
    const hit = new Set();
    let prev = { x: t.x, y: t.y };
    const chains = def.chains || 3;
    for (let i = 0; i < chains && cur; i++) {
      run.enemySystem.damage(cur, dmg * mult, { source: 'towerChain', x: prev.x, y: prev.y });
      this.applyOnHit(cur, t);
      run.effects.push({ kind: 'beam', x: prev.x, y: prev.y, x2: cur.x, y2: cur.y, life: 0.18, maxLife: 0.18, color: def.color, width: 3 });
      hit.add(cur);
      prev = { x: cur.x, y: cur.y };
      mult *= (def.chainFalloff || 0.8);
      cur = run.spatial.nearest(prev.x, prev.y, 160, e => e.kind === 'enemy' && !e.dead && !hit.has(e));
    }
  }

  fireAura(t, dmg) {
    const run = this.run;
    const def = t.def;
    const near = run.spatial.query(t.x, t.y, t.range, this._qb2);
    let any = false;
    for (const e of near) {
      if (e.kind !== 'enemy' || e.dead) continue;
      any = true;
      run.enemySystem.damage(e, dmg, { source: 'towerAura', x: t.x, y: t.y });
      this.applyOnHit(e, t);
    }
    if (any) {
      run.effects.push({
        kind: 'aura', x: t.x, y: t.y, r: t.range,
        life: 0.2, maxLife: 0.2, color: def.color,
      });
    }
  }

  /** 把实验科技的附魔挂到塔的投射物上 */
  applyTowerEnchants(pr, t) {
    const st = this.run.playerStats;
    const m = st.mechanics;
    if (m.towerExplode) pr.splash = { radius: m.towerExplode.radius, mult: m.towerExplode.mult };
    const eff = {};
    if (m.towerSlow) eff.slow = { ...m.towerSlow, max: 3 };
    if (m.towerBurn) eff.burn = { ...m.towerBurn, max: 3 };
    if (m.towerChain) {
      pr.pierce = Math.max(pr.pierce, 0);
      pr.chainOnHit = { chains: m.towerChain.chains, falloff: m.towerChain.falloff };
    }
    if (Object.keys(eff).length) pr.effect = { ...(pr.effect || {}), ...eff };
  }

  /** 命中时的附着效果（光束/链式/光环用） */
  applyOnHit(e, t) {
    const st = this.run.playerStats;
    const m = st.mechanics;
    if (m.towerSlow) {
      e.slow = e.slow
        ? { ...e.slow, remain: Math.max(e.slow.remain, m.towerSlow.dur), stacks: Math.min(3, (e.slow.stacks || 1) + 1) }
        : { amount: m.towerSlow.amount, remain: m.towerSlow.dur, stacks: 1, max: 3 };
    }
    if (m.towerBurn) {
      e.burn = e.burn
        ? { ...e.burn, remain: Math.max(e.burn.remain, m.towerBurn.dur), stacks: Math.min(3, (e.burn.stacks || 1) + 1) }
        : { dps: m.towerBurn.dps, remain: m.towerBurn.dur, stacks: 1, max: 3 };
    }
    if (m.towerExplode) {
      const run = this.run;
      run.effects.push({ kind: 'nova', x: e.x, y: e.y, r: m.towerExplode.radius, life: 0.2, maxLife: 0.2, color: '#ffba4c' });
      const near = run.spatial.query(e.x, e.y, m.towerExplode.radius, this._qb);
      for (const o of near) {
        if (o === e || o.kind !== 'enemy' || o.dead) continue;
        run.enemySystem.damage(o, (t?.damage || 10) * m.towerExplode.mult, { source: 'towerExplode' });
      }
    }
  }

  // =========================================================
  //  手动接管
  // =========================================================

  updateManual(game) {
    const run = this.run;
    const input = game.input;

    // 先处理「已接管」的持续状态
    if (this.manualTower) {
      const t = this.manualTower;
      if (t.hp <= 0 || run.towers.indexOf(t) < 0) {
        this.manualTower = null;
      } else {
        t.manual = true;
      }
    }

    // 用缓冲通道：手柄按一次可能跨帧，只看原始 pressed 会「按了没反应」
    if (input.pressedBuffered('takeover')) {
      input.consumeBuffered('takeover');
      if (this.manualTower) {
        this.manualTower.manual = false;
        notice('已交还控制权', `${this.manualTower.def.name} 恢复自动索敌。`, 'info');
        this.manualTower = null;
      } else {
        // 接管最近的塔：手柄玩家没有鼠标，改成按「离玩家最近」来找
        const wm = game.mouseWorld;
        const p = run.player;
        const wantPad = game.input.gamepad?.active || game.input.lastSource === 'gamepad';
        const limit = wantPad ? 300 * 300 : 160 * 160;
        let best = null, bd = limit;
        for (const t of run.towers) {
          if (t.building) continue;
          if (!t.def.dmg) continue;
          const d = wantPad ? dist2(t.x, t.y, p.x, p.y) : dist2(t.x, t.y, wm.x, wm.y);
          if (d < bd) { bd = d; best = t; }
        }
        if (best) {
          best.manual = true;
          this.manualTower = best;
          notice('已接管', `${best.def.name} 现在由你手动开火（${wantPad ? 'RT / X 射击，R3 交还' : '左键射击，C 交还'}）。`, 'good');
        } else {
          notice('附近没有可接管的塔', wantPad ? '走到防御塔旁边再按 R3。' : '把鼠标移到防御塔附近再按 C。', 'warn');
        }
      }
      bus.emit(EV.SFX, { name: 'uiClick' });
    }
  }
}

// ---------------- 工具 ----------------

export function scaleCost(cost, mult = 1) {
  const out = {};
  for (const [k, v] of Object.entries(cost || {})) {
    out[k] = Math.max(0, Math.ceil(v * mult));
  }
  return out;
}

export function costText(cost) {
  const NAMES = { gold: '金币', metal: '金属', crystal: '晶体', parts: '零件', sulfur: '硫磺', coolant: '冷却剂', fiber: '纤维', food: '食物', tech: '数据核心', research: '研究资料', beaconCore: '吸引核心', dna: '基因样本', biomass: '生物质', wood: '木质', spore: '孢子' };
  return Object.entries(cost || {}).map(([k, v]) => `${NAMES[k] || k} ${v}`).join(' · ');
}

function swapRemoveAt(arr, i) {
  const last = arr.length - 1;
  if (i !== last) arr[i] = arr[last];
  arr.pop();
}
