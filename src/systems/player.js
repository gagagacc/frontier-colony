/**
 * 玩家控制器：移动 / 闪避 / 采集 / 攻击 / 载具 / 状态。
 */

import { TILE, PLAYER as PCFG, VEHICLE as VCFG, WEAPON_CAPS } from '../core/config.js';
import { clamp, clamp01, dist, dist2, angleTo, TAU, turnToward } from '../core/math.js';
import { rnd } from '../core/rng.js';
import { bus, EV, notice } from '../core/events.js';
import { TILE_DEF, PROP_DEF } from '../data/tiles.js';
import { createProjectile } from './runState.js';
import { WEAPON_DEF } from '../data/weapons.js';

export class PlayerSystem {
  constructor(run) {
    this.run = run;
    this.enabled = true;
    this.harvestTarget = null;
    this.harvestProgress = 0;
    this.autoHarvest = false;
    this._collideList = [];
    this._qb = [];              // 复用的空间查询缓冲，避免每帧产生垃圾
    this._qb2 = [];
    this._propBuf = null;
    this._propBufAt = -1;
  }

  get p() { return this.run.player; }

  // =========================================================
  //  主更新
  // =========================================================

  update(dt, game) {
    const p = this.p;
    const run = this.run;
    const st = p.statSet;
    st.update(dt);

    if (p.dead) {
      // 纯塔防模式没有角色：不允许复活，也不做任何玩家逻辑
      if (p.noRespawn) return;
      p.respawnTimer -= dt;
      if (p.respawnTimer <= 0) this.respawn();
      return;
    }

    // 载具优先
    if (p.inVehicle) {
      this.updateVehicle(dt, game);
      this.updateStatuses(dt);
      this.updateAttack(dt, game, true);
      return;
    }

    this.updateMovement(dt, game);
    this.updateStatuses(dt);
    this.updateAttack(dt, game, false);
    this.updateHarvest(dt, game);
    this.updateEnvironment(dt);
    this.updateInteract(dt, game);
    // 在虫巢副本里，F 还有第二个含义：回入口撤退
    if (run.dungeon) this.updateDungeonExit(game);
  }

  // =========================================================
  //  移动
  // =========================================================

  updateMovement(dt, game) {
    const p = this.p;
    const run = this.run;
    const st = p.statSet;
    const input = game.input;

    // 闪避中的强制位移
    if (p.dodgeTimer > 0) {
      p.dodgeTimer -= dt;
      const speed = PCFG.dodgeSpeed;
      const step = speed * dt;
      this._moveWithCollision(Math.cos(p.dodgeAngle) * step, Math.sin(p.dodgeAngle) * step);
      p.invuln = Math.max(p.invuln, dt);
      return;
    }

    const mv = input.moveVector();
    const moving = mv.x !== 0 || mv.y !== 0;

    // 体力
    const wantSprint = input.isDown('sprint') && moving && p.stamina > 1;
    if (wantSprint) p.stamina = Math.max(0, p.stamina - PCFG.sprintCost * dt);
    else p.stamina = Math.min(p.staminaMax, p.stamina + (PCFG.staminaRegen + st.get('staminaRegen')) * dt);

    // 地形速度
    const terrainSpeed = run.world.speedAtPx(p.x, p.y);
    const tileDef = TILE_DEF[run.world.tileAtPx(p.x, p.y)];
    const dotDmg = (tileDef && tileDef.dot) ? tileDef.dot * (1 - st.get('hazardResist') * 0.6 - st.get('acidResist') * 0.4) : 0;
    if (dotDmg > 0) this.hurt(dotDmg * dt, null, { silent: true, environmental: true, source: '酸沼' });

    let speed = PCFG.baseSpeed * (1 + st.get('speedMult'));
    if (wantSprint) speed *= PCFG.sprintMult;
    // 开拓者击杀狂暴
    if (run.time < p.frenzyUntil) speed *= 1 + st.get('killFrenzySpeed');
    // 负重惩罚
    const load = p.carryUsed / Math.max(1, p.carryMax);
    if (load > 0.9) speed *= clamp(1 - (load - 0.9) * 1.2, 0.55, 1);
    speed *= terrainSpeed;

    if (moving) {
      const step = speed * dt;
      this._moveWithCollision(mv.x * step, mv.y * step);
    }
    // 朝向：手柄右摇杆优先，否则跟鼠标
    p.facing = this._aimAngle(game, p);

    p.distanceWalked += dist(p.lastX, p.lastY, p.x, p.y);
    run.stats.distance = p.distanceWalked;
    p.lastX = p.x; p.lastY = p.y;

    // 闪避触发。
    // 注意顺序：先判所有前置条件，最后才问「有没有按键缓冲」——
    // 这样体力刚好差一点、或那一刻还没开始移动时按下的闪避，
    // 会在条件满足的下一帧立刻生效，而不是被丢掉要重按。
    if (p.dodgeCd <= 0 && p.stamina >= PCFG.dodgeCost && moving && input.pressedBuffered('dodge')) {
      input.consumeBuffered('dodge');
      p.dodgeTimer = PCFG.dodgeTime;
      p.dodgeCd = PCFG.dodgeCooldown * (1 + st.get('dodgeCdMult'));
      p.stamina -= PCFG.dodgeCost;
      p.dodgeAngle = Math.atan2(mv.y, mv.x);
      p.invuln = PCFG.dodgeIFrames;
      bus.emit(EV.SFX, { name: 'dodge' });
    }
    if (p.dodgeCd > 0) p.dodgeCd -= dt;

    // 生命自然回复
    this.regen(dt);
  }

  /**
   * 决定朝向角度。
   * 手柄推了右摇杆就用摇杆方向，否则用鼠标位置 —— 两种设备可以随时混用。
   */
  _aimAngle(game, p) {
    const fromPad = game.input.aimAngle?.(p.x, p.y);
    if (fromPad != null) return fromPad;
    const wm = game.mouseWorld;
    if (wm) return angleTo(p.x, p.y, wm.x, wm.y);
    return p.facing;
  }

  regen(dt) {
    const p = this.p;
    const st = p.statSet;
    let regen = st.get('hpRegen') + this.run.planet.environment.playerDebuff.hpRegen;
    regen += p.hpMax * st.get('regenPct');
    // 基地医疗站加成
    for (const b of this.run.bases) {
      if (b.destroyed) continue;
      if (dist(p.x, p.y, b.x, b.y) < 340) regen += st.get('baseHeal');
    }
    if (regen > 0) p.hp = Math.min(p.hpMax, p.hp + regen * dt);
    // 护盾
    if (st.get('shieldRegen') > 0) {
      p.shield = Math.min(st.get('shieldMax'), (p.shield || 0) + st.get('shieldRegen') * dt);
    }
  }

  _moveWithCollision(dx, dy) {
    const p = this.p;
    const world = this.run.world;
    const r = p.r;

    /*
     * 卡墙自救。
     *
     * 如果玩家当前所在的点已经是「被挡住」的（出生点算错、基地盖在身上、
     * 存档读到一半地图变了……），那么下面每一个方向都会被判定为 blocked，
     * 玩家就彻底动不了 —— 表现是「进了副本卡在原地」。
     * 这里先检测这种情况，然后朝最近的可通行格推出去。
     */
    if (world.circleBlocked(p.x, p.y, r) && (dx || dy)) {
      this.unstick();
      return;
    }

    // X 轴
    if (dx !== 0) {
      const nx = p.x + dx;
      if (!world.circleBlocked(nx, p.y, r)) p.x = nx;
      else {
        // 沿墙滑动
        const sign = Math.sign(dx);
        for (let i = 1; i <= 4; i++) {
          const probe = p.x + (dx / 4) * i;
          if (!world.circleBlocked(probe, p.y, r)) p.x = probe;
          else break;
        }
      }
    }
    if (dy !== 0) {
      const ny = p.y + dy;
      if (!world.circleBlocked(p.x, ny, r)) p.y = ny;
      else {
        for (let i = 1; i <= 4; i++) {
          const probe = p.y + (dy / 4) * i;
          if (!world.circleBlocked(p.x, probe, r)) p.y = probe;
          else break;
        }
      }
    }
    p.x = clamp(p.x, TILE, this.run.world.w * TILE - TILE);
    p.y = clamp(p.y, TILE, this.run.world.h * TILE - TILE);
  }

  /**
   * 把卡在障碍里的玩家推到最近的可通行位置。
   * 优先沿「离得最近的可走点」走，找不到就退回基地旁边 —— 宁可被传送，
   * 也不能让玩家永远钉在原地。
   */
  unstick() {
    const p = this.p;
    const world = this.run.world;
    const r = p.r;
    const ox = p.x, oy = p.y;
    // 螺旋向外找第一个能站的点（一圈一圈扩，最多 8 格）
    for (let rad = 1; rad <= 8; rad++) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const nx = ox + Math.cos(ang) * rad * TILE;
        const ny = oy + Math.sin(ang) * rad * TILE;
        if (world.circleBlocked(nx, ny, r)) continue;
        p.x = nx; p.y = ny;
        p.lastX = nx; p.lastY = ny;
        notice('被卡住了', '已把你挪到旁边的空地上。', 'info');
        return true;
      }
    }
    // 实在出不去：丢回基地旁边
    const base = this.run.bases.find(b => !b.destroyed) || this.run.base;
    if (base) {
      const spot = world.findOpenSpot(base.x + 90, base.y + 60, 200);
      if (!world.circleBlocked(spot.x, spot.y, r)) {
        p.x = spot.x; p.y = spot.y;
        p.lastX = p.x; p.lastY = p.y;
        notice('被卡住了', '已把你送回基地。', 'warn');
        return true;
      }
    }
    return false;
  }

  // =========================================================
  //  载具
  // =========================================================

  updateVehicle(dt, game) {
    const run = this.run;
    const v = run.vehicle;
    const p = this.p;
    const st = p.statSet;
    const input = game.input;

    // 上下车冷却：避免按住/连按 F 时立刻又被踢下来
    p.vehicleLock = Math.max(0, (p.vehicleLock || 0) - dt);

    // 被精英怪别住：这段时间油门无效（倒车也不行，必须下车或等它松开）
    if (v.pinned > 0) {
      v.pinned -= dt;
      v.moving = false;
      if (v.pinned <= 0) { v.pinnedBy = null; notice('载具挣脱了', '车头空出来了，可以继续开。', 'info'); }
    }

    // 下车（用缓冲判定，避免连按 F 时上车又被立刻踢下来）
    if (input.pressedBuffered('vehicle', 120) && p.vehicleLock <= 0) {
      input.consumeBuffered('vehicle');
      this.exitVehicle();
      return;
    }

    const mv = input.moveVector();
    const boost = input.isDown('sprint');
    const terrainMult = st.get('terrainIgnore') ? 1 : run.world.speedAtPx(v.x, v.y);
    let speed = VCFG.baseSpeed * (1 + st.get('vehicleSpeedMult')) * terrainMult;
    if (boost && v.fuel > 0) speed *= VCFG.boostMult;
    if (v.pinned > 0) speed = 0;

    if (mv.x || mv.y) {
      const step = speed * dt;
      const prevX = v.x, prevY = v.y;
      const nx = v.x + mv.x * step;
      const ny = v.y + mv.y * step;
      // 扫掠移动：载具速度快，单点判定会穿墙
      if (!this._sweepBlocked(prevX, prevY, nx, v.y, v.r)) v.x = nx;
      if (!this._sweepBlocked(v.x, prevY, v.x, ny, v.r)) v.y = ny;
      v.angle = turnToward(v.angle || 0, Math.atan2(mv.y, mv.x), dt * 8);
      v.moving = true;

      // 油耗
      const fuelUse = VCFG.fuelPerSec * (boost ? 1.8 : 1) * (1 + st.get('fuelMult')) * dt;
      v.fuel = Math.max(0, v.fuel - fuelUse);
      if (st.get('fuelRegen') > 0) v.fuel = Math.min(v.fuelMax, v.fuel + st.get('fuelRegen') * dt);
      // 撞击
      this.vehicleRam(dt, game);
    } else {
      v.moving = false;
      if (st.get('fuelRegen') > 0) v.fuel = Math.min(v.fuelMax, v.fuel + st.get('fuelRegen') * dt);
    }

    // 自动修复模块
    if (st.get('autoRepair') > 0 && v.hp < v.hpMax) {
      v.hp = Math.min(v.hpMax, v.hp + st.get('autoRepair') * dt);
    }

    // 玩家跟随载具
    p.x = v.x; p.y = v.y;
    const wm = game.mouseWorld;
    p.facing = angleTo(v.x, v.y, wm.x, wm.y);

    // 车载武器自动开火
    this.vehicleWeaponsFire(dt, game);

    if (v.fuel <= 0 && v.moving) {
      if (!v._warnedFuel) {
        v._warnedFuel = true;
        notice('燃料耗尽', '载具无法移动。使用燃料罐补充，或带上燃料采集器模块。', 'warn');
      }
    } else if (v.fuel > 5) v._warnedFuel = false;
  }

  vehicleRam(dt, game) {
    const run = this.run;
    const v = run.vehicle;
    const st = this.p.statSet;
    if (v.ramCd > 0) { v.ramCd -= dt; return; }
    // 撞击伤害 = 车体基础 + 悬挂近战模块（撞角 / 电锯）加成
    const meleeBonus = v.meleeModule ? v.meleeModule.damage : 0;
    const dmg = (VCFG.collisionDamage + meleeBonus)
      * (1 + st.get('ramMult'))
      * (1 + (this.p.charId === 'pilot' ? 1 : 0));
    const hits = run.spatial.query(v.x, v.y, v.r + 26, this._qb);
    let rammed = false;
    for (const e of hits) {
      if (e.kind !== 'enemy' || e.dead) continue;
      // 精英怪会「别住」载具：撞上去不是把它撞飞，而是被它卡住
      if (e.elite || e.boss) {
        this.pinVehicle(e, dt);
        rammed = true;
        continue;
      }
      this.damageEnemy(e, dmg, { source: 'vehicle', knockback: 260, x: v.x, y: v.y });
      // 电锯模块：撞击附带流血
      if (v.meleeModule?.bleed) {
        const b = v.meleeModule.bleed;
        e.bleed = { dps: b.dps, remain: b.dur };
      }
      rammed = true;
      if (st.get('collisionHeal')) v.hp = Math.min(v.hpMax, v.hp + st.get('collisionHeal'));
    }
    if (rammed) {
      v.ramCd = VCFG.collisionCooldown;
      bus.emit(EV.SCREEN_SHAKE, { mag: 3, time: 0.14 });
    }
  }

  /**
   * 精英怪别住载具。
   *
   * 这不是 bug，是一条刻意的规则：载具在野外太安全了 ——
   * 有速度、有油、有装甲，玩家可以一路碾过去。让精英怪能把车别停，
   * 就把「野外遇到精英」重新变成一个需要下车解决的麻烦：
   * 要么下车打（暴露在野外），要么倒车绕开（浪费油和时间）。
   *
   * 机制：给载具一个「被别住」计时，期间油门无效；同时精英怪自己也会减速，
   * 不至于把车顶到地图另一头。计时结束（或精英怪死掉）就恢复。
   */
  pinVehicle(e, dt) {
    const run = this.run;
    const v = run.vehicle;
    const p = this.p;
    const st = p.statSet;
    // 装甲科技的「碾压器」类效果可以缩短被别住的时间
    const resist = clamp01(st.get('pinResist') || 0);
    const pinTime = (e.boss ? 1.6 : 1.1) * (1 - resist);
    v.pinned = Math.max(v.pinned || 0, pinTime);
    v.pinnedBy = e.id;
    // 车体受伤：被别住是有代价的
    if (v.pinCd == null || v.pinCd <= 0) {
      v.pinCd = 1.0;
      v.hp = Math.max(1, v.hp - e.dmg * 0.35);
      bus.emit(EV.SCREEN_SHAKE, { mag: 4, time: 0.2 });
      if (!v._pinWarned || run.time - v._pinWarned > 6) {
        v._pinWarned = run.time;
        notice('载具被别住了', `${e.def.name} 顶住了车头 —— 下车解决它，或者倒车绕开。`, 'warn');
      }
    }
    if (v.pinCd > 0) v.pinCd -= dt;
    // 顶住的时候精英怪自己也走不快
    e.speed = Math.min(e.speed, e.def.speed * 0.35);
    e.pinTarget = v.id;
    void dt;
  }

  vehicleWeaponsFire(dt, game) {
    const run = this.run;
    const v = run.vehicle;
    for (const w of v.mounted) {
      if (!w) continue;
      w.cd = (w.cd || 0) - dt;
      if (w.cd > 0) continue;
      const def = WEAPON_DEF[w.weaponId];
      if (!def) continue;
      const target = run.spatial.nearest(v.x, v.y, def.range, e => e.kind === 'enemy' && !e.dead);
      if (!target) continue;
      w.cd = def.cd / (1 + this.p.statSet.get('attackSpeed'));
      this.fireWeaponAt(w, target.x, target.y, game, { mounted: true });
    }
  }

  /** 沿线段检测地形阻挡（高速物体用） */
  _sweepBlocked(x0, y0, x1, y1, r) {
    const world = this.run.world;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.min(10, Math.ceil(dist / Math.max(10, r))));
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      if (world.circleBlocked(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r)) return true;
    }
    return false;
  }

  enterVehicle() {
    const run = this.run;
    const v = run.vehicle;
    // 载具要先「申请」下来：开局只能步行，攒够材料在科技树里解锁后才能开
    if (!run.hasFeature('vehicle')) {
      notice('还没有载具', '开局只能步行。攒够金属与金币后，在【科技树 → 远征探索】里申请第一台载具。', 'warn');
      return false;
    }
    if (v.destroyed) { notice('载具已损毁', '需要在基地用金属修复它。', 'warn'); return false; }
    if (dist(this.p.x, this.p.y, v.x, v.y) > 90) { notice('太远了', '走到载具旁边再上车。', 'warn'); return false; }
    this.p.inVehicle = true;
    this.p.vehicleLock = 0.4;   // 刚上车给一小段锁，避免同一次按键立刻下车
    bus.emit(EV.VEHICLE_ENTER, { vehicle: v });
    bus.emit(EV.SFX, { name: 'engine' });
    return true;
  }

  exitVehicle() {
    const run = this.run;
    const v = run.vehicle;
    const p = this.p;
    p.inVehicle = false;
    p.vehicleLock = 0.4;
    // 找一个旁边不被挡的位置下车
    const spot = run.world.findOpenSpot(v.x, v.y, 70);
    p.x = spot.x; p.y = spot.y;
    p.lastX = p.x; p.lastY = p.y;
    bus.emit(EV.VEHICLE_EXIT, { vehicle: v });
  }

  // =========================================================
  //  状态效果
  // =========================================================

  updateStatuses(dt) {
    const p = this.p;
    if (p.invuln > 0) p.invuln -= dt;
    for (const [name, s] of p.statuses) {
      s.remain -= dt;
      if (s.dot) this.hurt(s.dot * dt, null, { silent: true, source: name });
      if (s.remain <= 0) p.statuses.delete(name);
    }
  }

  updateEnvironment(dt) {
    const run = this.run;
    const p = this.p;
    const st = p.statSet;
    const env = run.planet.environment;
    const hazard = env.playerDebuff.hazardPerSec * (1 - clamp01(st.get('hazardResist')));
    if (hazard > 0.01) this.hurt(hazard * dt, null, { silent: true, environmental: true, source: env.name });
    // 夜间惩罚/加成交给战斗系统，这里不处理
  }

  // =========================================================
  //  交互（上/下车、开箱、进出基地）
  // =========================================================

  updateInteract(dt, game) {
    const run = this.run;
    const input = game.input;
    const p = this.p;

    // F 键：上/下车 或 与最近的可交互物交互。
    // 用带缓冲的判定：离载具还差几步时按下的 F，走近后会自己生效。
    if (input.pressedBuffered('vehicle')) {
      const v = run.vehicle;
      /*
       * 顺序很重要：**载具优先**。
       *
       * 以前是「废弃基地优先」。结果玩家把车停在废弃基地正上方、下车捡完物资，
       * 再按 F 想上车时，命中的是那个已经被搜刮过的 POI ——
       * 只弹一句「材料已经被回收」，人上不了车，只能把车丢在那里。
       * 现在：站在车边就一定先上车；想拆基地就走到车够不着的地方再按 F。
       */
      const nearVehicle = !v.destroyed && dist(p.x, p.y, v.x, v.y) < 90;
      if (nearVehicle) {
        input.consumeBuffered('vehicle');
        this.enterVehicle();
        return;
      }
      const poi = this._nearestPoi(150);
      if (poi) {
        input.consumeBuffered('vehicle');
        this.interactPoi(poi);
        return;
      }
      // 虫巢入口：走过去按 F 进副本
      const nest = this._nearestNest(140);
      if (nest) {
        input.consumeBuffered('vehicle');
        this.enterNest(nest);
        return;
      }
      // 都不满足：留在缓冲里，等玩家走到位置
    }
  }

  /** 附近可以进入的虫巢（已毁或已打过的不能进） */
  _nearestNest(range) {
    const p = this.p;
    let best = null, bd = range * range;
    for (const nest of this.run.world.nests) {
      if (nest.destroyed || nest.dungeonCleared) continue;
      const d = dist2(p.x, p.y, nest.x, nest.y);
      if (d < bd + nest.r * nest.r) { bd = d; best = nest; }
    }
    return best;
  }

  /**
   * 虫巢副本里的 F 键：站在入口按 F 撤退。
   * 用 requestExit 交给主循环处理（副本的进出必须换 RunState，
   * 在系统内部换会把当前这一帧的引用搞乱）。
   */
  updateDungeonExit(game) {
    const run = this.run;
    const input = game.input;
    const d = run.dungeon;
    if (!d) return;
    if (!input.pressedBuffered('vehicle')) return;
    const p = this.p;
    if (dist(p.x, p.y, d.entry.x, d.entry.y) > 150) {
      // 不在入口附近：提示一句，但把这次按键留在缓冲里
      if (!run._exitHintAt || run.time - run._exitHintAt > 8) {
        run._exitHintAt = run.time;
        notice('撤退需要回到入口', '虫巢入口在地图最左边（小地图上的绿点）。', 'info');
      }
      return;
    }
    input.consumeBuffered('vehicle');
    run.requestExit = true;
  }

  /**
   * 进入虫巢副本。
   *
   * 站在巢口按 F。进去之后世界会被就地改造成地下迷宫
   * （见 world/dungeon.js），最深处是 Boss 房。
   * 巢穴一旦被摧毁或副本已通关，就不能再进了。
   */
  enterNest(nest) {
    const run = this.run;
    if (!run || run.dungeon) return false;
    if (nest.destroyed) { notice('巢穴已毁', '这里只剩下焦土，进不去了。', 'warn'); return false; }
    if (nest.dungeonCleared) { notice('已经清剿过', '这个巢穴的核心已经死了，里面没有东西了。', 'info'); return false; }
    bus.emit(EV.SFX, { name: 'alarm' });
    run.enterDungeon(nest);
    return true;
  }

  _nearestPoi(range) {
    const p = this.p;
    let best = null, bd = range * range;
    for (const poi of this.run.world.pois) {
      const d = dist2(p.x, p.y, poi.x, poi.y);
      if (d < bd) { bd = d; best = poi; }
    }
    return best;
  }

  interactPoi(poi) {
    const run = this.run;
    if (!poi.discovered) {
      poi.discovered = true;
      bus.emit(EV.DISCOVERY, { kind: poi.kind, label: poi.name || poi.kind, x: poi.x, y: poi.y });
    }
    if (poi.kind === 'ruin' && poi.beaconSalvage && !poi.beaconTaken) {
      const mult = 1 + run.playerStats.get('salvageMult', 0) + run.playerStats.get('matMult');
      run.addResource('beaconCore', 1, { raw: true });
      run.addResource('metal', 40 * mult);
      run.addResource('parts', 8 * mult);
      run.addResource('crystal', 12 * mult);
      poi.beaconTaken = true;
      run.stats.poisLooted++;
      bus.emit(EV.SFX, { name: 'unlock' });
      notice('回收吸引阵列', '从废弃基地拆下 1 个【吸引核心】，以及一批金属与零件。吸引阵列的燃料有着落了。', 'good');
      run.addLog(`回收 ${poi.name} 的吸引阵列`);
      return;
    }
    if (!poi.looted) {
      poi.looted = true;
      const rng = run.rng;
      run.addResource('metal', rng.range(30, 70));
      run.addResource('parts', rng.range(5, 14));
      run.addResource('gold', rng.range(60, 160));
      if (rng.chance(0.5)) run.addResource('crystal', rng.range(6, 20));
      if (rng.chance(0.4)) run.addResource('tech', rng.range(1, 3));
      if (poi.kind === 'vault' && rng.chance(0.7)) run.resources.beaconCore = (run.resources.beaconCore || 0) + 1;
      run.stats.poisLooted++;

      /*
       * 废弃基地的装备产出（规格来自设计）：
       *   - 35% 概率开出一件「紫色及以下」的装备
       *   - 另有 5% 概率开出一件红色装备
       * 两者独立判定，所以运气好会一次开出两件。
       */
      const gear = [];
      if (rng.chance(0.35)) {
        const it = run.loot.rollEquipment({
          bonus: 1.0, tier: 3, maxRarity: 'epic',
        });
        if (it) gear.push(it);
      }
      if (rng.chance(0.05)) {
        const red = run.loot.rollEquipment({ bonus: 2, tier: 4, forceRarity: 'relic' });
        if (red) gear.push(red);
      }
      for (const it of gear) {
        const res = run.loot.addItemToInventory(it);
        if (res === 'equipped' || res === 'bag' || res === 'hotbar') {
          bus.emit(EV.SFX, { name: 'unlock' });
        } else {
          notice('背包已满', `${it.name} 放不下 —— 先清理背包再来搜刮。`, 'warn');
          run.loot.spawnPickup(poi.x, poi.y - 20, 'equip', 1, it);
        }
      }
      if (gear.some(g => g.rarity === 'relic')) {
        notice('红色装备', `${poi.name || '废弃基地'} 的保险柜里锁着一件【红色】装备 —— 你打开了它。`, 'good');
      }

      bus.emit(EV.SFX, { name: 'pickup' });
      notice('搜刮完成', `${poi.name || '遗迹'} 的物资已回收。${gear.length ? `找到 ${gear.length} 件装备。` : ''}`, 'good');
      return;
    }
    notice('这里已经空了', '该遗迹的物资已被回收干净。', 'info');
  }

  // =========================================================
  //  采集
  // =========================================================

  updateHarvest(dt, game) {
    const run = this.run;
    const p = this.p;
    const input = game.input;

    // 按住 E 持续采集；刚按下的那一瞬间也算（用缓冲判定），
    // 这样「点一下」不会因为当帧没进入按住状态而丢失。
    const holding = input.isDown('interact');
    const tapped = input.pressedBuffered('interact', 120);
    if (!holding && !tapped) {
      this.harvestTarget = null;
      this.harvestProgress = 0;
      this.repairTarget = null;
      return;
    }

    // 找最近的可采集物
    /*
     * 基地废墟优先于一切。
     *
     * 玩家反馈「基地我按 E 重建没反应」：站在废墟旁时，如果脚边正好有一丛
     * 纤维灌木 / 虫卵囊，E 会跑去采集，重建永远不发生 —— 从玩家视角看就是坏了。
     * 现在只要站在自家废墟范围内，E 一定是重建。
     */
    const ruinedBase = run.bases.find(b => b.destroyed && dist(p.x, p.y, b.x, b.y) < b.r + 40);
    // 调试用：出问题时能一眼看出 updateHarvest 走了哪条分支（测试与探针都读它）
    this._harvestDebug = {
      at: run.time, branch: ruinedBase ? 'rebuild' : 'harvest',
      bases: run.bases.length, destroyed: run.bases.filter(b => b.destroyed).length,
      dist: Math.round(run.bases.length ? Math.hypot(p.x - run.bases[0].x, p.y - run.bases[0].y) : -1),
      playerX: Math.round(p.x), playerY: Math.round(p.y),
      dead: !!p.dead, inVehicle: !!p.inVehicle, holding, tapped,
    };
    if (ruinedBase) {
      this.harvestTarget = null;
      this.repairTarget = null;
      this.baseInteract(dt, tapped, input);
      return;
    }
    /*
     * 维修优先于采集：站在一座被打残的塔旁边，你想干的一定是修它。
     * 只有在「没有受损目标」或「采集物明显更近」时才去采集。
     */
    const repairable = run.nearestRepairable(p.x, p.y, 80);
    if (repairable) {
      const propNow = this.harvestTarget && !this.harvestTarget.dead
        ? dist2(p.x, p.y, this.harvestTarget.x, this.harvestTarget.y) : Infinity;
      if (repairable.d * repairable.d <= propNow) {
        const ok = run.repairStructureAt(repairable.target, dt);
        this.repairTarget = repairable;
        this.harvestTarget = null;
        this.harvestProgress = ok ? clamp01(repairable.target.hp / repairable.maxHp) : 0;
        if (ok && rnd.chance(dt * 6)) {
          bus.emit(EV.LOOT, { x: repairable.target.x, y: repairable.target.y - 14, kind: 'repair', amount: 1 });
        }
        return;
      }
    } else {
      this.repairTarget = null;
    }
    if (!this.harvestTarget || this.harvestTarget.dead || dist2(p.x, p.y, this.harvestTarget.x, this.harvestTarget.y) > 78 * 78) {
      this.harvestTarget = this._nearestProp(78);
      this.harvestProgress = 0;
      if (this.harvestTarget && tapped) input.consumeBuffered('interact');
    }
    const prop = this.harvestTarget;
    if (!prop) {
      // 没有可采集物时，E 键用来跟基地交互/修理（也用来重建废墟）
      this.baseInteract(dt, tapped, input);
      return;
    }

    const def = PROP_DEF[prop.type];
    const st = p.statSet;
    let dps = 26 * (1 + st.get('mineSpeed'));
    // 工具匹配加成
    const weapon = this.currentWeapon();
    const tag = weapon ? (weapon.def.subtype === 'blunt' ? 'pick' : weapon.def.subtype === 'blade' ? 'axe' : null) : null;
    if (def.tool && tag === def.tool) dps *= 1.8;
    else if (def.tool) dps *= 0.55;

    prop.hp -= dps * dt;
    prop.shake = 1;
    prop.hitFlash = 1;
    this.harvestProgress = 1 - clamp01(prop.hp / prop.maxHp);

    /*
     * 采集产出改成「一点一点跳」。
     *
     * 以前是采完才一次性结算，右下角显示一个百分比 ——
     * 玩家盯着一个进度条，采到什么、采了多少全靠结算那一下的提示。
     * 现在按「每 0.6 秒一小块」结算，每块都在材料上方跳出 +N 的飘字，
     * 采集的过程本身就有反馈，而且升级采掘镐（+2/+3/+4/+5）能立刻看出来。
     */
    this._payoutChips(prop, def, dt, st);

    if (rnd.chance(dt * 8)) {
      bus.emit(EV.LOOT, { x: prop.x + rnd.range(-10, 10), y: prop.y - 10, kind: 'chip', amount: 1 });
    }

    if (prop.hp <= 0) this.harvestComplete(prop);
  }

  /** 这个可采集物采完大概能出多少（用来决定分几块跳） */
  _estimateYield(def) {
    let total = 0;
    for (const [, [lo, hi]] of Object.entries(def.yield || {})) total += (lo + hi) / 2;
    return total;
  }

  /**
   * 把「整块掉落」拆成若干次小结算。
   * @param {boolean} force 采完时把剩下的零头一次性结清
   */
  _payoutChips(prop, def, dt, st, force = false) {
    const run = this.run;
    const perHit = 1 + Math.max(0, Math.round(st.get('mineYield') || 0));
    const totalEst = this._estimateYield(def);
    // 目标块数：镐子越好，跳得越少但每块越大（2 块起步，最多 10 块）
    const chunks = Math.max(2, Math.min(10, Math.round(totalEst / perHit)));
    const interval = (prop.maxHp / Math.max(1, 26 * (1 + st.get('mineSpeed')))) / chunks;

    prop._mined = (prop._mined || 0) + dt;
    if (!force && prop._mined < (prop._chipAt || interval)) return;
    prop._mined = 0;
    // 下一块的间隔随进度轻微加速，收尾不会拖沓
    prop._chipAt = interval;

    const gains = [];
    for (const [kind, [lo, hi]] of Object.entries(def.yield || {})) {
      // 每块按「期望总量 / 块数」给，至少 1（否则小数会一直四舍五入成 0）
      const perChunk = ((lo + hi) / 2) / chunks + perHit * 0.35;
      let amount = Math.max(kind === 'dna' || kind === 'tech' || kind === 'research' ? 0 : 1, Math.round(perChunk));
      // 稀有小产：只有 roll 中了才给（保持「偶尔掉一个」的惊喜）
      if (lo === 0 && hi <= 1 && run.rng.next() > 0.25) continue;
      amount = this._scaleYield(kind, amount, st);
      if (amount <= 0) continue;
      const added = run.addResource(kind, amount);
      if (added > 0) gains.push({ kind, amount: added });
    }
    for (const g of gains) {
      // 从这个材料的上方跳出 +N
      bus.emit(EV.LOOT, { x: prop.x + rnd.range(-6, 6), y: prop.y - def.r - 6, kind: g.kind, amount: g.amount });
    }
    if (gains.length) {
      prop.popTimer = 0.25;
      if (rnd.chance(0.5)) bus.emit(EV.SFX, { name: 'pickup', volume: 0.25 });
    }
  }

  /** 采集产出的统一加成（矿工护符、材料加成等） */
  _scaleYield(kind, amount, st) {
    if (kind === 'gold') return Math.round(amount * (1 + st.get('goldMult')));
    if (kind === 'tech' || kind === 'research') return amount;
    return Math.max(0, Math.round(amount * (1 + st.get('matMult')) * (1 + st.get('mineSpeed') * 0.2)));
  }

  _nearestProp(range) {
    const run = this.run;
    const p = this.p;
    // 遍历全部障碍物太贵，做一层粗筛缓存：玩家移动超过一定距离或每 0.6 秒重建候选
    const moved = !this._propBufAnchor || dist2(p.x, p.y, this._propBufAnchor.x, this._propBufAnchor.y) > 90 * 90;
    if (!this._propBuf || moved || run.time - (this._propBufAt ?? -99) > 0.6) {
      const list = [];
      const r2 = 300 * 300;
      for (const prop of run.world.props.values()) {
        if (prop.dead) continue;
        if (dist2(p.x, p.y, prop.x, prop.y) > r2) continue;
        list.push(prop);
      }
      this._propBuf = list;
      this._propBufAt = run.time;
      this._propBufAnchor = { x: p.x, y: p.y };
    }
    let best = null, bd = range * range;
    for (const prop of this._propBuf) {
      if (prop.dead) continue;
      const d = dist2(p.x, p.y, prop.x, prop.y);
      if (d < bd) { bd = d; best = prop; }
    }
    return best;
  }

  harvestComplete(prop) {
    const run = this.run;
    const def = PROP_DEF[prop.type];
    if (!def) { run.world.removeProp(prop.id); return; }
    const st = this.p.statSet;
    // 结算最后一块零头，保证「采光了」拿到的总量和以前一致
    this._payoutChips(prop, def, 99, st, true);
    // 方尖碑类的东西额外给研究资料
    if (prop.type === 'dataObelisk') {
      run.resources.research = (run.resources.research || 0) + 1;
      notice('数据方尖碑', '解密出一份研究资料，可以用于实验科技。', 'good');
    }
    /*
     * 旗舰残骸（虫巢深处）的装备产出：
     *   撬开必定掉一件装备，其中 5% 是红色 —— 这是「红装三个入口」的第三个
     *   （另外两个是 Boss 10%、废弃基地 5%）。
     */
    if (def.gearChance) {
      const red = run.rng.chance(def.gearChance);
      const it = red
        ? run.loot.rollEquipment({ bonus: 3, tier: 6, forceRarity: def.gearRarity || 'relic' })
        : run.loot.rollEquipment({ bonus: 1.5, tier: 5, maxRarity: 'epic' });
      if (it) {
        const res = run.loot.addItemToInventory(it);
        if (res !== 'equipped' && res !== 'bag' && res !== 'hotbar') {
          run.loot.spawnPickup(prop.x, prop.y - 20, 'equip', 1, it);
          notice('背包已满', `${it.name} 放不下 —— 掉在残骸旁边了。`, 'warn');
        }
        if (red) {
          notice('红色装备', `${def.name}的货舱里锁着一件【红色】装备 —— 你撬开了它。`, 'good');
          bus.emit(EV.SFX, { name: 'unlock' });
        }
      }
    }
    run.stats.propsHarvested++;
    run.world.onPropHarvested(prop);
    this.harvestTarget = null;
    this.harvestProgress = 0;
    bus.emit(EV.SFX, { name: 'pickup' });
  }

  baseInteract(dt, tapped = false, input = null) {
    const run = this.run;
    const p = this.p;
    for (const b of run.bases) {
      // 废墟也要能靠近重建，所以这里不能用 destroyed 过滤
      if (dist(p.x, p.y, b.x, b.y) < b.r + 40) {
        /*
         * 玩家反馈「按 E 重建没反应」。
         * 原因有两个：一是原来要按住整整 45 秒，二是「点一下」完全不算数。
         * 现在：按住逐帧推进，点一下也直接推进一小块（tapRebuild）。
         */
        if (b.destroyed && tapped) {
          if (run.tapRebuild(b) && input) input.consumeBuffered('interact');
        }
        run.repairAtBase(b, dt);
        return;
      }
    }
  }

  // =========================================================
  //  攻击
  // =========================================================

  currentWeapon() {
    const p = this.p;
    return p.weapons[p.weaponIndex] || p.weapons[0] || null;
  }

  /**
   * 取一项武器成长属性，并套上 WEAPON_CAPS 的上限。
   *
   * 范围 300% / 伤害 300% / 射速 200% / 弹道 3 条 —— 这几个数字是给玩家的承诺，
   * 所以封顶必须发生在**读的时候**：科技树、实验科技、装备词缀、
   * 红色装备的特殊效果全都可能往同一个键上加，只靠「科技节点不超标」是拦不住的。
   */
  weaponStat(key) {
    const raw = this.p.statSet.get(key) || 0;
    const cap = WEAPON_CAPS[key];
    return cap == null ? raw : clamp(raw, 0, cap);
  }

  /** 这把武器当前的射程（吃 rangeMult 上限） */
  weaponRange(def) {
    return (def?.range || 0) * (1 + this.weaponStat('rangeMult'));
  }

  /** 这把武器当前的伤害倍率（吃 damage 上限；rarity / 词缀在调用处另算） */
  weaponDamageMult(extra = 0) {
    return 1 + this.weaponStat('damage') + extra;
  }

  /** 这把武器当前的射击间隔（吃 attackSpeed 上限） */
  weaponCooldown(def) {
    return (def?.cd || 0.5) / (1 + this.weaponStat('attackSpeed'));
  }

  /** 同时发射的弹道条数（1 基础 + 科技加成，上限 3） */
  weaponBarrels() {
    return 1 + Math.round(this.weaponStat('projectiles'));
  }

  updateAttack(dt, game, inVehicle) {
    const p = this.p;
    const st = p.statSet;
    if (p.attackCd > 0) p.attackCd -= dt;
    if (p.reloading > 0) {
      p.reloading -= dt;
      if (p.reloading <= 0) {
        /*
         * 换弹结束：补满弹仓。
         * reloadPending 只有 beginReload() 才会置位 —— 空仓干等（旧逻辑里
         * 那 1.2 秒白送 30 发）不会再给免费子弹。
         */
        if (p.reloadPending) {
          p.reloadPending = false;
          p.ammo = Math.round(p.ammoMax || PCFG.ammoMax);
          p._ammoFrac = 0;
          p._warnedAmmo = false;
          if (p.reloadAuto) bus.emit(EV.SFX, { name: 'build' });
          p.reloadAuto = false;
        }
        p.reloading = 0;
      }
    }

    const w = this.currentWeapon();
    if (!w || inVehicle) return;
    const def = w.def;

    // 瞄准方向 = 鼠标
    const wm = game.mouseWorld;
    const aimAngle = angleTo(p.x, p.y, wm.x, wm.y);

    const wantFire = game.input.mouseIsDown(0);
    if (!wantFire) return;
    if (p.attackCd > 0) return;

    const cd = this.weaponCooldown(def);
    p.attackCd = cd;
    this.performAttack(w, aimAngle, game);
  }

  performAttack(w, angle, game) {
    const run = this.run;
    const p = this.p;
    const st = p.statSet;
    const def = w.def;
    const rarityMult = RARITY_MULT[w.rarity] || 1;
    const affixStats = w.stats || {};
    let dmg = def.damage * rarityMult * this.weaponDamageMult(affixStats.damage || 0);
    // 近战加成
    if (def.kind === 'melee') dmg *= 1 + st.get('meleeMult');
    // 开拓者残血狂暴
    const rage = st.get('rageBonus');
    if (rage > 0) dmg *= 1 + rage * (1 - p.hp / p.hpMax);
    // 夜间加成
    if (isNight(run) && st.get('nightDamage') > 0) dmg *= 1 + st.get('nightDamage');

    switch (def.kind) {
      case 'melee': this.meleeSwing(w, angle, dmg); break;
      case 'projectile': this.shootProjectiles(w, angle, dmg); break;
      case 'beam': this.fireBeam(w, angle, dmg); break;
      case 'lob': this.lobProjectile(w, angle, dmg, game); break;
      case 'cone': this.coneAttack(w, angle, dmg); break;
      case 'chain': this.chainAttack(w, angle, dmg); break;
      default: break;
    }
    bus.emit(EV.SFX, { name: def.kind === 'melee' ? 'melee' : (def.subtype === 'gun' ? 'shoot' : 'shootHeavy') });
  }

  fireWeaponAt(w, tx, ty, game, opts = {}) {
    const p = this.p;
    const def = w.def || WEAPON_DEF[w.weaponId];
    if (!def) return;
    const angle = Math.atan2(ty - p.y, tx - p.x);
    const st = p.statSet;
    const rarityMult = RARITY_MULT[w.rarity] || 1;
    const dmgMult = opts.mounted ? (1 + st.get('vehicleWeaponDamage')) : 1;
    const dmg = def.damage * rarityMult * this.weaponDamageMult() * dmgMult;
    if (def.kind === 'projectile') this.shootProjectiles(w, angle, dmg, opts);
    else if (def.kind === 'lob') this.lobProjectile(w, angle, dmg, game, opts);
    else if (def.kind === 'chain') this.chainAttack(w, angle, dmg, opts);
    else this.fireBeam(w, angle, dmg, opts);
  }

  meleeSwing(w, angle, dmg) {
    const run = this.run;
    const p = this.p;
    const st = p.statSet;
    const def = w.def;
    const range = this.weaponRange(def);
    const half = (def.arc || 1) * 0.5;
    const hits = run.spatial.query(p.x, p.y, range + 20, this._qb);
    let hitAny = false;
    const seen = new Set();
    for (const e of hits) {
      if (e.kind !== 'enemy' || e.dead || seen.has(e)) continue;
      seen.add(e);
      const d = dist(p.x, p.y, e.x, e.y);
      if (d > range + e.r) continue;
      const a = Math.abs(normAngleLocal(angleTo(p.x, p.y, e.x, e.y) - angle));
      if (a > half + 0.25) continue;
      this.damageEnemy(e, dmg, {
        source: 'melee', crit: true, x: p.x, y: p.y,
        knockback: (def.knockback || 0) * (1 + st.get('knockbackMult')),
        ignoreArmor: def.ignoreArmor,
      });
      hitAny = true;
      // 溅射
      if (def.splash) {
        const others = run.spatial.query(e.x, e.y, def.splash.radius, this._qb2);
        for (const o of others) {
          if (o === e || o.kind !== 'enemy' || o.dead) continue;
          this.damageEnemy(o, dmg * def.splash.mult, { source: 'splash', x: e.x, y: e.y });
        }
      }
      if (def.stagger) e.stun = Math.max(e.stun, def.stagger);
    }
    // 近战也能砍障碍物（只在附近有障碍物时遍历）
    const nearby = this._nearestProp(range + 34);
    if (nearby) {
      for (const prop of this._propBuf) {
        if (prop.dead) continue;
        if (dist(p.x, p.y, prop.x, prop.y) > range + prop.r) continue;
        const a = Math.abs(normAngleLocal(angleTo(p.x, p.y, prop.x, prop.y) - angle));
        if (a > half + 0.3) continue;
        prop.hp -= dmg * 0.6;
        prop.shake = 1; prop.hitFlash = 1;
        if (prop.hp <= 0) this.harvestComplete(prop);
        hitAny = true;
      }
    }
    if (hitAny) bus.emit(EV.SFX, { name: 'hit' });
    // 挥击视觉
    run.effects.push({
      kind: 'swing', x: p.x, y: p.y, angle, arc: (def.arc || 1), range,
      life: 0.16, maxLife: 0.16, color: def.color || '#ffe08a',
    });
  }

  /**
   * 开一枪要消耗多少弹药。
   * 等离子 / 喷火这类武器的 ammoPerShot 是小数（0.15），
   * 再加上实验科技的「弹药消耗 -40%」，直接相减一定出现小数。
   */
  ammoCostOf(def) {
    const base = def.ammoPerShot == null ? 1 : def.ammoPerShot;
    const mult = 1 + (this.p.statSet.get('ammoCostMult') || 0);
    return Math.max(0, base * mult);
  }

  /**
   * 弹药结算。
   *
   * 以前是 `p.ammo -= def.ammoPerShot` —— 等离子一枪 0.15，打两枪弹药就变成
   * 159.7，界面上直接显示小数（玩家问「我弹药怎么是现在这个数值」）。
   * 现在弹药本身**永远是整数**：不足 1 发的零头记在 `_ammoFrac` 里，
   * 攒够 1 才真的扣 1 发。手感与消耗速度不变，显示的永远是干净的数字。
   */
  canSpendAmmo(def, mounted) {
    if (mounted) return true;
    const cost = this.ammoCostOf(def);
    if (cost <= 0) return true;
    return this.p.ammo >= 1 || (this.p._ammoFrac || 0) + cost >= 1;
  }

  spendAmmo(def, mounted, times = 1) {
    if (mounted) return;
    const cost = this.ammoCostOf(def) * times;
    if (cost <= 0) return;
    const p = this.p;
    p._ammoFrac = (p._ammoFrac || 0) + cost;
    while (p._ammoFrac >= 1) { p._ammoFrac -= 1; p.ammo -= 1; }
    p.ammo = Math.max(0, Math.round(p.ammo));
  }

  /**
   * 打空了：自动开始换弹。
   *
   * 以前这里只是「咔」一声 + 一句提示，然后要求玩家自己按 R —— 玩家明确说
   * 「换弹改为没子弹自动换弹」。现在打空立刻自动换（按 R 仍然可以提前换）。
   */
  autoReload() {
    const p = this.p;
    const run = this.run;
    if (p.reloading > 0) return false;
    const started = run.beginReload ? run.beginReload(true) : false;
    if (!started) {
      bus.emit(EV.SFX, { name: 'error' });
      if (!p._warnedAmmo) {
        p._warnedAmmo = true;
        notice('弹药打空', '自动换弹没成功 —— 需要金属。打怪也会掉子弹，先把这一波清完。', 'warn');
      }
    } else {
      p._warnedAmmo = false;
    }
    return started;
  }

  shootProjectiles(w, angle, dmg, opts = {}) {
    const run = this.run;
    const p = this.p;
    const st = p.statSet;
    const def = w.def;
    /*
     * 弹道（多管齐射）：科技树「多管弹道」最多加到 3 条同时发射。
     * 每条弹道独立结算伤害与穿透，但弹药按弹道条数一起扣。
     */
    const barrels = 1 + Math.round(this.weaponStat('projectiles'));
    // 弹药
    if (!opts.mounted) {
      if (!this.canSpendAmmo(def, false)) {
        this.autoReload();
        return;
      }
      this.spendAmmo(def, false, barrels);
      p._warnedAmmo = false;
    }
    const pellets = def.pellets || 1;
    const spread = def.spread || 0;
    const speed = def.speed || 800;
    const barrelStep = barrels > 1 ? 0.075 : 0;
    for (let b = 0; b < barrels; b++) {
      // 多条弹道时左右对称散开：中心那条永远对准准星
      const barrelOffset = (b - (barrels - 1) / 2) * barrelStep;
      for (let i = 0; i < pellets; i++) {
        const a = angle + barrelOffset + rnd.range(-spread, spread);
        const proj = createProjectile({
          x: p.x + Math.cos(a) * 18,
          y: p.y + Math.sin(a) * 18,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          r: def.subtype === 'gun' ? 4 : 6,
          damage: dmg,
          life: (this.weaponRange(def) / speed) * 1.15,
          color: def.color,
          pierce: (def.pierce || 0) + this.weaponStat('pierce'),
          owner: 'player',
          knockback: def.knockbackPerPellet || 0,
          effect: def.slow ? { slow: { ...def.slow } } : (def.mark ? { mark: { ...def.mark } } : null),
          ignoreArmor: def.ignoreArmor,
          source: def.id,
        });
        run.projectiles.push(proj);
      }
    }
  }

  fireBeam(w, angle, dmg, opts = {}) {
    const run = this.run;
    const p = this.p;
    const st = p.statSet;
    const def = w.def;
    if (!opts.mounted) {
      if (!this.canSpendAmmo(def, false)) { this.autoReload(); return; }
      this.spendAmmo(def, false);
    }
    const range = this.weaponRange(def);
    const ex = p.x + Math.cos(angle) * range;
    const ey = p.y + Math.sin(angle) * range;
    // 沿射线找所有目标
    const hits = [];
    const steps = Math.ceil(range / 22);
    const seen = new Set();
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const px = p.x + (ex - p.x) * t;
      const py = p.y + (ey - p.y) * t;
      const near = run.spatial.query(px, py, 26, this._qb2);
      for (const e of near) {
        if (e.kind !== 'enemy' || e.dead || seen.has(e)) continue;
        seen.add(e);
        hits.push(e);
      }
      if (run.world.isBlockedPx(px, py)) break;
    }
    for (const e of hits) {
      this.damageEnemy(e, dmg, { source: 'beam', x: p.x, y: p.y, ignoreArmor: def.ignoreArmor });
    }
    run.effects.push({
      kind: 'beam', x: p.x, y: p.y, x2: ex, y2: ey,
      life: 0.22, maxLife: 0.22, color: def.color || '#8fe0ff', width: 5,
    });
    bus.emit(EV.SCREEN_SHAKE, { mag: 4, time: 0.15 });
  }

  lobProjectile(w, angle, dmg, game, opts = {}) {
    const run = this.run;
    const p = this.p;
    const st = p.statSet;
    const def = w.def;
    if (!opts.mounted) {
      if (!this.canSpendAmmo(def, false)) { this.autoReload(); return; }
      this.spendAmmo(def, false);
    }
    const wm = opts.mounted ? null : game?.mouseWorld;
    const range = this.weaponRange(def);
    const tx = opts.mounted ? (opts.tx ?? p.x + Math.cos(angle) * range) : (wm ? wm.x : p.x + Math.cos(angle) * range);
    const ty = opts.mounted ? (opts.ty ?? p.y + Math.sin(angle) * range) : (wm ? wm.y : p.y + Math.sin(angle) * range);
    const d = clamp(dist(p.x, p.y, tx, ty), 60, range);
    const flight = d / 340;
    const proj = createProjectile({
      x: p.x, y: p.y,
      vx: (tx - p.x) / flight,
      vy: (ty - p.y) / flight,
      r: 9, damage: dmg, life: flight + 0.05, maxLife: flight + 0.05,
      color: def.color, friendly: true, owner: 'player',
      targetX: p.x + (tx - p.x) * (d / Math.max(1, dist(p.x, p.y, tx, ty))),
      targetY: p.y + (ty - p.y) * (d / Math.max(1, dist(p.x, p.y, tx, ty))),
      gravity: { arc: 60 },
      onLand: def.cloud ? { cloud: { ...def.cloud } } : null,
      splash: def.splash || (def.cloud ? { radius: def.cloud.radius, mult: 0.6 } : null),
      source: def.id,
    });
    run.projectiles.push(proj);
  }

  coneAttack(w, angle, dmg) {
    const run = this.run;
    const p = this.p;
    const st = p.statSet;
    const def = w.def;
    if (!this.canSpendAmmo(def, false)) { this.autoReload(); return; }
    this.spendAmmo(def, false);
    const range = this.weaponRange(def);
    const hits = run.spatial.query(p.x, p.y, range, this._qb2);
    for (const e of hits) {
      if (e.kind !== 'enemy' || e.dead) continue;
      const a = Math.abs(normAngleLocal(angleTo(p.x, p.y, e.x, e.y) - angle));
      if (a > def.arc + 0.2) continue;
      this.damageEnemy(e, dmg, { source: 'flame', x: p.x, y: p.y, element: 'fire' });
      if (def.burn) applyBurn(e, def.burn, st);
    }
    run.effects.push({
      kind: 'cone', x: p.x, y: p.y, angle, arc: def.arc, range,
      life: 0.14, maxLife: 0.14, color: def.color,
    });
  }

  chainAttack(w, angle, dmg, opts = {}) {
    const run = this.run;
    const p = this.p;
    const st = p.statSet;
    const def = w.def;
    if (!opts.mounted) {
      if (!this.canSpendAmmo(def, false)) { this.autoReload(); return; }
      this.spendAmmo(def, false);
    }
    const first = run.spatial.nearest(p.x + Math.cos(angle) * 40, p.y + Math.sin(angle) * 40, this.weaponRange(def),
      e => e.kind === 'enemy' && !e.dead);
    if (!first) return;
    let cur = first;
    let mult = 1;
    const hit = new Set();
    let prev = { x: p.x, y: p.y };
    const chains = (def.chains || 3) + Math.floor(st.get('pierce'));
    for (let i = 0; i < chains && cur; i++) {
      this.damageEnemy(cur, dmg * mult, { source: 'chain', x: prev.x, y: prev.y });
      run.effects.push({
        kind: 'beam', x: prev.x, y: prev.y, x2: cur.x, y2: cur.y,
        life: 0.16, maxLife: 0.16, color: def.color || '#59d8ff', width: 3,
      });
      hit.add(cur);
      prev = { x: cur.x, y: cur.y };
      mult *= (def.chainFalloff || 0.8);
      const next = run.spatial.nearest(cur.x, cur.y, 170, e => e.kind === 'enemy' && !e.dead && !hit.has(e));
      cur = next;
    }
  }

  // =========================================================
  //  伤害与死亡
  // =========================================================

  damageEnemy(enemy, baseDamage, opts = {}) {
    const run = this.run;
    const p = this.p;
    const st = p.statSet;
    if (!enemy || enemy.dead) return 0;

    // 暴击
    const critChance = clamp01(0.04 + st.get('critChance') + (opts.crit && this.currentWeapon()?.def.kind === 'melee' ? 0.05 : 0));
    const isCrit = run.rng.chance(critChance);
    let dmg = baseDamage;
    if (isCrit) dmg *= 1.5 + st.get('critMult');
    // 对精英/Boss
    if (enemy.elite) dmg *= 1 + st.get('eliteDamage');
    if (enemy.boss) dmg *= 1 + st.get('bossDamage');
    // 标记（生物学家）
    if (enemy.marks > 0) dmg *= 1 + enemy.marks * 0.12;
    // 集火（实验科技）
    // 减伤
    if (!opts.ignoreArmor) {
      let armor = enemy.armor;
      if (enemy.def.frontArmor && isFacing(enemy, opts.x, opts.y)) armor *= (1 + enemy.def.frontArmor);
      dmg = applyArmor(dmg, armor);
    }
    dmg = Math.max(1, dmg);

    enemy.hp -= dmg;
    enemy.hitFlash = 1;
    enemy.aggro = true;
    run.stats.damageDealt += dmg;

    // 吸血 / 中毒 / 减速等附加
    const ls = st.get('lifeSteal') + (this.currentWeapon()?.stats?.lifeSteal || 0);
    if (ls > 0) p.hp = Math.min(p.hpMax, p.hp + dmg * ls);
    if (st.get('poisonOnHit') > 0) applyPoison(enemy, { dps: st.get('poisonOnHit'), dur: 4, max: 5 }, st);

    // 击退
    if (opts.knockback) {
      const a = angleTo(opts.x ?? p.x, opts.y ?? p.y, enemy.x, enemy.y);
      const k = opts.knockback * (enemy.boss ? 0.15 : enemy.elite ? 0.5 : 1) / Math.max(1, enemy.def.r / 12);
      enemy.knockX = (enemy.knockX || 0) + Math.cos(a) * k;
      enemy.knockY = (enemy.knockY || 0) + Math.sin(a) * k;
    }

    bus.emit(EV.DAMAGE, { x: enemy.x, y: enemy.y - enemy.r, amount: Math.round(dmg), crit: isCrit, target: enemy });

    if (enemy.hp <= 0) this.killEnemy(enemy);
    return dmg;
  }

  killEnemy(enemy) {
    const run = this.run;
    if (enemy.dead) return;
    enemy.dead = true;
    run.stats.kills++;
    if (enemy.elite) run.stats.eliteKills++;
    if (enemy.boss) run.stats.bossKills++;

    // 开拓者击杀狂暴
    const st = this.p.statSet;
    if (st.get('killFrenzy') > 0) this.p.frenzyUntil = run.time + st.get('killFrenzy');

    // 处决/标记回血
    const exec = st.mechanics.execute;
    bus.emit(EV.KILL, { enemy, x: enemy.x, y: enemy.y });
    run.loot.onEnemyKilled(enemy);

    // 移除
    const idx = run.enemies.indexOf(enemy);
    if (idx >= 0) swapRemoveAt(run.enemies, idx);
  }

  hurt(amount, source, opts = {}) {
    const run = this.run;
    const p = this.p;
    const st = p.statSet;
    if (p.dead) return;
    if (!opts.environmental && p.invuln > 0) return;

    // 相位壳（基因）
    const phase = st.get('phaseShield');
    if (phase > 0) {
      p._phaseTimer = (p._phaseTimer || 0) - 1;
      if (p._phaseTimer <= 0) { p._phaseTimer = phase; return; }
    }

    let dmg = amount;
    if (!opts.ignoreArmor) dmg = applyArmor(dmg, st.get('armor') + (st.get('lowHpArmor') || 0));
    dmg = Math.max(1, dmg);

    // 护盾吸收
    if ((p.shield || 0) > 0) {
      const absorbed = Math.min(p.shield, dmg);
      p.shield -= absorbed;
      dmg -= absorbed;
    }
    if (dmg <= 0) return;

    p.hp -= dmg;
    p.lastDamageAt = run.time;
    run.stats.damageTaken += dmg;
    if (!opts.silent) {
      bus.emit(EV.SFX, { name: 'hurt' });
      bus.emit(EV.SCREEN_SHAKE, { mag: 3.5, time: 0.16 });
      bus.emit(EV.DAMAGE, { x: p.x, y: p.y - 22, amount: Math.round(dmg), player: true, source: opts.source });
    }
    // 反伤
    const thorn = st.get('thorn');
    if (thorn > 0 && source && source.kind === 'enemy') {
      this.damageEnemy(source, thorn, { source: 'thorn', x: p.x, y: p.y });
    }
    const counter = st.mechanics.counterWave;
    if (counter && source && source.kind === 'enemy') {
      const near = run.spatial.query(p.x, p.y, counter.radius, this._qb2);
      for (const e of near) {
        if (e.kind !== 'enemy' || e.dead) continue;
        this.damageEnemy(e, amount * counter.mult, { source: 'counter', x: p.x, y: p.y });
      }
    }
    if (p.hp <= 0) this.die(opts.source);
  }

  die(source) {
    const run = this.run;
    const p = this.p;
    p.hp = 0;
    p.dead = true;
    run.stats.deaths++;
    bus.emit(EV.SFX, { name: 'explode' });
    bus.emit(EV.SCREEN_SHAKE, { mag: 10, time: 0.6 });

    // 是否掉落资源（有地窖实验则不丢）
    const st = p.statSet;
    if (!st.get('deathPenaltyImmunity')) {
      const lost = Math.floor(run.resources.gold * 0.15);
      run.resources.gold -= lost;
      notice('你倒下了', `损失 ${lost} 金币。救援舱正在赶来……`, 'danger');
    } else {
      notice('你倒下了', '深层地窖保住了你的物资。救援舱正在赶来……', 'warn');
    }

    // 游戏结束判定：基地已毁 + 玩家死亡 = 彻底失败
    if (run.base.destroyed) {
      bus.emit(EV.GAME_OVER, { reason: 'baseLost', source });
      p.respawnTimer = 999;
      return;
    }
    p.respawnTimer = PCFG.reviveTime;
  }

  respawn() {
    const run = this.run;
    const p = this.p;
    const st = p.statSet;
    /*
     * 玩家要求：「在虫巢死亡应该在基地复活」。
     *
     * 原来的做法是把人放在**副本入口大厅**（因为核心舱坐标在世界之外，
     * 按基地坐标复活会掉到地图外面）。但玩家不想再走一遍虫道，
     * 所以现在改成：**直接撤出副本、回到地表基地**复活，死亡惩罚照旧。
     */
    if (run.dungeon) {
      /*
       * 撤出副本之后，**真正要复活的是外层那个 player** ——
       * 内层 run 的基地坐标在世界之外（-9999），在内层放人等于把人扔出地图。
       * 所以这里做完交接就返回，不往下走内层的放置逻辑。
       */
      const outer = run.overworldRun;
      run.exitDungeon({ died: true });
      if (outer) {
        const op = outer.player;
        const ospot = outer.world.findOpenSpot(outer.base.x + 70, outer.base.y + 40, 120);
        op.x = ospot.x; op.y = ospot.y;
        op.lastX = op.x; op.lastY = op.y;
        op.hp = Math.max(1, Math.round(op.hpMax * 0.6));   // 与地表死亡的 60% 一致
        op.dead = false;
        op.invuln = 3;
        op.inVehicle = false;
        if (op.statuses?.clear) op.statuses.clear();
        readyVehicleNear(outer);
        notice('救援完成', '你被拖回了基地医疗舱。', 'info');
      }
      return;
    }
    const atBase = st.get('respawnAtBase') || run.base.destroyed === false;
    const spot = atBase
      ? run.world.findOpenSpot(run.base.x + 70, run.base.y + 40, 120)
      : run.world.findOpenSpot(p.x, p.y, 120);
    p.x = spot.x; p.y = spot.y;
    p.lastX = p.x; p.lastY = p.y;
    p.hp = p.hpMax * 0.6;
    p.dead = false;
    p.invuln = 3;
    p.inVehicle = false;
    p.statuses.clear();
    readyVehicleNear(run);
    notice('救援完成', '你在基地医疗舱里醒来，损失了部分生命值。', 'info');
  }
}

// =========================================================
//  工具
// =========================================================

const RARITY_MULT = {
  common: 1.0, uncommon: 1.18, rare: 1.42, epic: 1.75, legendary: 2.15, relic: 2.6,
};

function normAngleLocal(a) {
  while (a > Math.PI) a -= TAU;
  while (a <= -Math.PI) a += TAU;
  return a;
}

function applyArmor(dmg, armor) {
  if (armor <= 0) return dmg;
  // 护甲按「减伤百分比」结算，避免高护甲完全免疫
  const reduction = armor / (armor + 42);
  return dmg * (1 - reduction);
}

function isFacing(enemy, fromX, fromY) {
  if (fromX == null) return false;
  const a = Math.atan2(fromY - enemy.y, fromX - enemy.x);
  const diff = Math.abs(normAngleLocal(a - enemy.angle));
  return diff < 1.1;
}

function isNight(run) {
  const phase = (run.time % 240) / 240;
  return phase > 0.6;
}

function applyBurn(enemy, burn, st) {
  const mult = 1 + st.get('dotMult');
  const dps = burn.dps * mult;
  if (enemy.burn) {
    enemy.burn.dps = Math.max(enemy.burn.dps, dps);
    enemy.burn.remain = Math.max(enemy.burn.remain, burn.dur);
    enemy.burn.stacks = Math.min(burn.max || 3, (enemy.burn.stacks || 1) + 1);
  } else {
    enemy.burn = { dps, remain: burn.dur, stacks: 1, max: burn.max || 3 };
  }
}

function applyPoison(enemy, poison, st) {
  const mult = 1 + st.get('dotMult');
  const dps = poison.dps * mult;
  if (enemy.poison) {
    enemy.poison.dps = Math.max(enemy.poison.dps, dps);
    enemy.poison.remain = Math.max(enemy.poison.remain, poison.dur);
    enemy.poison.stacks = Math.min(poison.max || 5, (enemy.poison.stacks || 1) + 1);
  } else {
    enemy.poison = { dps, remain: poison.dur, stacks: 1, max: poison.max || 5 };
  }
}

function swapRemoveAt(arr, i) {
  const last = arr.length - 1;
  if (i !== last) arr[i] = arr[last];
  arr.pop();
}

function readyVehicleNear(run) {
  // 死亡后把载具拉回基地，避免玩家复活后要走很远
  const v = run.vehicle;
  if (v.destroyed) return;
  const spot = run.world.findOpenSpot(run.base.x + 120, run.base.y + 80, 200);
  v.x = spot.x; v.y = spot.y;
}

export { applyArmor, isNight };
