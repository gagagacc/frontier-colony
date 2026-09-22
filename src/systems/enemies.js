/**
 * 敌人系统：AI、寻路、群体行为、状态、死亡。
 *
 * AI 分级（对应「怪物有一定智能，会组织进攻」）：
 *   swarm    —— 直冲最近目标，靠数量
 *   flank    —— 侧翼绕行，从防御薄弱的方向切入
 *   ranged   —— 保持距离拉扯，边打边退
 *   charger  —— 蓄力冲撞，撞墙自晕
 *   support  —— 光环增益周围友军，自己躲后面
 *   summoner —— 持续召唤小怪
 *   boss     —— 多阶段 + 特殊技能
 */

import { TILE } from '../core/config.js';
import { clamp, clamp01, dist, dist2, angleTo, turnToward, TAU, swapRemove } from '../core/math.js';
import { rnd } from '../core/rng.js';
import { bus, EV, notice } from '../core/events.js';
import { AI, MONSTER, MONSTER_DEF, NEST_ROSTER, BIOME_MONSTERS } from '../data/monsters.js';
import { createEnemy, createProjectile, enemyScaleFor } from './runState.js';
import { applyArmor } from './player.js';

const FLOW_RECOMPUTE_INTERVAL = 0.45;

/** 冲撞型 AI 的兜底参数（怪物表里没写 charge 时使用） */
const FALLBACK_CHARGE = { windup: 0.6, speed: 380, time: 0.7, cd: 5, stunOnWall: 1.0 };

/**
 * 精英血量相对「同级普通小怪」的上限倍数。
 * 3 = 用户要求的手感：精英最多三倍血，而不是几十倍。
 */
const ELITE_HP_CAP_MULT = 3.0;

/**
 * 巢穴绑定怪的活动范围。
 *
 * 为什么需要这个：流场的目标是整个地图共享的（基地/玩家），
 * 所以任何怪只要「有目标」就会一路走到底 —— 巢穴守卫和 Boss 都会
 * 从地图另一头走到基地来。表现就是玩家刚落地，Boss 就从巢里冲出来追着打。
 *
 * 现在的规则：
 *   - Boss 是巢穴的守门人，只在巢穴周围 BOSS_AGGRO 内接敌，绝不远征；
 *   - 普通守卫可以追出去，但离巢超过 GUARD_LEASH 就脱战回家。
 * 怪潮（role: wave）不受影响，它们本来就该打基地。
 */
const BOSS_AGGRO = 460;
const GUARD_LEASH = 980;

/** 开局多久之内不出精英（秒）——避免「第一波还没来就撞上三倍血的怪」 */
const ELITE_GRACE = 150;

export class EnemySystem {
  constructor(run) {
    this.run = run;
    this.enabled = true;
    this._flowTimer = 0;
    this._target = { x: 0, y: 0 };
    this._queryBuf = [];
    this._queryBuf2 = [];
    this._nestTimer = 0;
    this._wildTimer = 0;
    this._huntTimer = 0;
  }

  get flow() { return this.run.world.flow; }

  // =========================================================
  //  主更新
  // =========================================================

  update(dt, game) {
    const run = this.run;
    this._flowTimer -= dt;
    this._nestTimer -= dt;
    this._wildTimer -= dt;
    this._huntTimer -= dt;

    // 副本守军：进副本后第一次 update 铺开（那时战斗系统才装配好）
    if (run.dungeon && !run.dungeonGarrisonSpawned) this.spawnDungeonGarrison(run.dungeon.tier);

    // 每个巢穴固定一只 Boss，开局就守在巢穴里（不在巢穴里的 Boss 不存在）
    this.ensureNestBosses();

    this.updateFlowTarget(dt);
    this.updateNests(dt);
    this.updateWildSpawns(dt);

    const enemies = run.enemies;
    // 逐个更新
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.dead) { swapRemove(enemies, i); continue; }
      this.updateEnemy(e, dt, game);
      this.unstick(e, dt);
    }

    // 群体分离（避免叠成一坨）—— 用空间哈希做近似
    this.separation(dt);
  }

  // =========================================================
  //  流场目标
  // =========================================================

  updateFlowTarget(dt) {
    const run = this.run;
    const flow = this.flow;
    let tx, ty;
    if (run.wave.huntMode) {
      tx = run.player.x; ty = run.player.y;
    } else if (run.dungeon) {
      /*
       * 副本里核心舱留在外面（坐标在世界之外），流场不能指着它 ——
       * 否则整条巢道的怪都会朝地图角落走。巢里的东西只冲玩家来。
       */
      tx = run.player.x; ty = run.player.y;
    } else {
      // 多基地时按最近的活着的基地
      const base = run.bases.find(b => !b.destroyed && b.isPrimary)
        || run.bases.find(b => !b.destroyed)
        || run.base;
      tx = base.x; ty = base.y;
    }
    const moved = dist2(tx, ty, this._target.x, this._target.y) > 60 * 60;
    if (this._flowTimer <= 0 || moved || !flow.ready) {
      const gx = clamp(Math.floor(tx / TILE), 0, run.world.w - 1);
      const gy = clamp(Math.floor(ty / TILE), 0, run.world.h - 1);
      flow.compute(gx, gy, run.world.tiles, (bx, by) => run.world.blocked[by * run.world.w + bx] === 1);
      this._target.x = tx; this._target.y = ty;
      this._flowTimer = FLOW_RECOMPUTE_INTERVAL;
    }
  }

  /** 让流场立刻重算（建筑被拆掉/新增后调用） */
  invalidateFlow() { this._flowTimer = 0; }

  // =========================================================
  //  巢穴产怪
  // =========================================================

  updateNests(dt) {
    const run = this.run;
    if (this._nestTimer > 0) return;    this._nestTimer = 1.0;   // 每秒结算一次

    const maxEnemies = 260;  // 硬上限，保证帧率
    if (run.enemies.length >= maxEnemies) return;

    for (const nest of run.world.nests) {
      if (nest.destroyed) continue;
      // 只有玩家靠近或巢穴在吸引范围内时才产怪（省性能，也符合设定）。
      // 半径收得比之前小：以前 1900 像素内全都在产怪，玩家还在基地铺塔时
      // 地图上就已经堆满了怪，然后才等到第一波 —— 手感上就是「怪潮没来怪就一大片」。
      const worthSim = dist2(run.player.x, run.player.y, nest.x, nest.y) < 1250 * 1250
        || dist2(run.beacon.x, run.beacon.y, nest.x, nest.y) < run.beacon.radius * 1.1;
      if (!worthSim) continue;

      // 常驻守卫有上限：巢穴只维持一支「驻防队」，不会无限堆积
      let guards = 0;
      for (const e of run.enemies) {
        if (e.role === 'guard' && e.fromNest === nest.id) guards++;
      }
      const guardCap = 3 + nest.tier * 2;
      if (guards >= guardCap) continue;

      nest.spawnTimer -= 1;
      if (nest.spawnTimer > 0) continue;
      // 产怪节奏放慢一倍左右：守卫是「清巢成本」，不该变成没完没了的骚扰
      nest.spawnTimer = (60 / Math.max(0.2, nest.spawnRate * (1 + run.planetIndex * 0.12))) * 2.2;

      const count = 1;
      for (let i = 0; i < count; i++) {
        if (run.enemies.length >= maxEnemies) break;
        if (guards + i >= guardCap) break;
        this.spawnNearNest(nest, { role: 'guard' });
      }
    }
  }

  /**
   * 地表巢穴**不再生成 Boss**。
   *
   * 之前每个巢穴都会在玩家靠近 900 像素时孵出一只「巢穴吞噬者 / 虚空女妖」，
   * 于是玩家一走近巢穴就看到 Boss 蹲在外面 —— 但 Boss 按设定是**巢穴里面的**，
   * 是副本最深处的守关怪。地表遇到 Boss 这件事本身就是错的：
   * 它既没有副本房那样的场地，也没有「深入 → 打 Boss → 通关」的节奏，
   * 只是凭空在野地里多了一只血厚攻高的怪。
   *
   * 现在地表的巢穴只有普通守卫（`spawnNearNest`），Boss 只在
   * `spawnDungeonBoss()` 里生成，也就是玩家真的走进副本、走到最深处的房间时。
   */
  ensureNestBosses() {
    // 故意留空。保留这个方法名是为了让「谁在生成 Boss」这件事只有一个答案：
    // 全项目搜 ensureNestBosses 会看到这条注释，而不是一片沉默。
  }

  spawnNearNest(nest, opts = {}) {    const run = this.run;
    const rng = run.rng;
    // 按巢穴等级选怪
    const pools = [];
    pools.push(...NEST_ROSTER.base.map(t => ({ t, w: 30 })));
    if (nest.tier >= 2) pools.push(...NEST_ROSTER.mid.map(t => ({ t, w: 20 })));
    if (nest.tier >= 3) pools.push(...NEST_ROSTER.high.map(t => ({ t, w: 18 })));
    if (nest.tier >= 3 && rng.chance(0.16)) pools.push(...NEST_ROSTER.special.map(t => ({ t, w: 6 })));
    // 群系特化怪
    const biomePool = BIOME_MONSTERS[nest.biome] || [];
    for (const t of biomePool) pools.push({ t, w: 8 });

    const type = rng.weighted(pools);
    if (!type || !MONSTER_DEF[type]) return null;

    const a = rng.next() * TAU;
    const r = rng.range(nest.r * 1.2, nest.r * 2.6);
    /*
     * 生成点交给 director.spawnPoint 统一决定：
     * 看得见巢就从巢口出来，巢在屏幕外且离玩家够远也从巢里刷，
     * 巢就在屏幕边上则推到屏幕外 —— 避免「虫子贴着玩家凭空出现」。
     */
    const spot = run.director?.spawnPoint
      ? run.director.spawnPoint(nest, { anchor: run.camera || run.player, openRadius: 120 })
      : run.world.findOpenSpot(nest.x + Math.cos(a) * r, nest.y + Math.sin(a) * r, 120);
    void a; void r;
    const eliteChance = (run.playerStats.get('eliteSpawnMult') > 0 ? 0.06 : 0.02) + nest.tier * 0.014;
    const isElite = opts.elite ?? (this.eliteAllowed() && rng.chance(eliteChance));
    const scale = enemyScaleFor(run, nest.tier + run.planetIndex, 1 + (opts.scaleBonus || 0));
    const e = createEnemy(run, type, spot.x, spot.y, {
      tier: nest.tier,
      scale,
      fromNest: nest.id,
      elite: isElite,
      speedMult: opts.speedMult,
    });
    if (!e) return null;
    if (isElite) this.makeElite(e, nest.tier);
    e.homeNest = nest.id;
    e.homeX = nest.x; e.homeY = nest.y;
    e.role = opts.role || 'guard';
    run.enemies.push(e);
    return e;
  }

  /**
   * 现在允不允许刷精英怪。
   *
   * 精英是「三倍血的硬点」，开局玩家只有一把初始武器，
   * 这时候撞上一只精英就是纯粹的劝退。所以给一段宽限期：
   * 开局 ELITE_GRACE 秒内，或者玩家还没到 5 级之前，都不出精英。
   * （Boss 不受影响 —— 它老老实实待在巢穴里，玩家不去惹它就不会遇到。）
   */
  eliteAllowed() {
    const run = this.run;
    if (run.playTime < ELITE_GRACE) return false;
    if ((run.player?.level ?? 1) < 5) return false;
    return true;
  }

  /**
   * 把一只普通怪升级成精英。
   *
   * 关键约束：精英的血量**最多约为同级普通怪的三倍**。
   * 之前直接套用精英模板（基础血量本来就高）+ 额外缩放，
   * 结果精英能达到小怪的几十倍血，前期撞上一只就是「血量离谱」的体验。
   */
  makeElite(e, tier) {
    const run = this.run;
    const bp = rnd.pick([MONSTER.ELITE_STALKER, MONSTER.ELITE_BEHEMOTH, MONSTER.ELITE_HIVELORD]);
    const def = MONSTER_DEF[bp];
    const scale = enemyScaleFor(run, tier, 1);
    const baseHp = def.hp * scale.hp;

    // 参考基准：同等级普通小怪的血量（用基础谱系的均值）
    const gruntRef = ((MONSTER_DEF[MONSTER.GRUB].hp + MONSTER_DEF[MONSTER.CRAWLER].hp) / 2) * scale.hp;
    const cap = gruntRef * ELITE_HP_CAP_MULT;      // 最多三倍
    const hp = Math.min(baseHp, cap);

    Object.assign(e, {
      type: bp, def, r: def.r * (def.scale || 1),
      hp, hpMax: hp,
      dmg: def.dmg * scale.dmg * 0.8,             // 伤害也收一点，别一刀秒人
      speed: def.speed, armor: def.armor,
      xpValue: def.xp * scale.xp * 1.6,
      goldValue: def.gold * scale.gold * 1.8,
      loot: def.loot,
      elite: true, boss: false,
      abilityCd: def.ability ? def.ability.cd : 0,
      summonCd: def.summon ? def.summon.cd * 0.5 : 0,
      flankAngle: run.rng.range(-1, 1) * (def.flank || 0.4),
      scale,
    });
    if (def.aura) e.auraScale = 1;
  }

  /**
   * 地表巢穴 Boss —— **已废弃，不要再调用**。
   *
   * 保留函数体是因为存档里可能有 `bossSpawned` 的旧数据，以及避免外部引用直接报错；
   * 但它现在只会返回 null。Boss 请用 `spawnDungeonBoss()`（副本深处那只）。
   */
  spawnNestBoss(nest) {
    if (nest) nest.bossSpawned = true;   // 标记掉，避免老存档反复尝试
    return null;
  }

  /**
   * 虫巢副本里的巢穴主。
   * 强度按巢穴等级（1~10）缩放；一只，死了副本就算通关。
   */
  spawnDungeonBoss(d) {
    const run = this.run;
    const tier = d?.tier || 1;
    const bossType = run.rng.chance(0.65) ? MONSTER.NEST_DEVOURER : MONSTER.VOID_SIREN;
    const spot = run.world.findOpenSpot(d.boss.x, d.boss.y, 200);
    // 10 级巢穴的 Boss 血量是 1 级的约 3.5 倍
    const scale = enemyScaleFor(run, tier, 0.85 + (tier - 1) * 0.08);
    scale.hp *= 1 + (tier - 1) * 0.22;
    scale.dmg *= 1 + (tier - 1) * 0.12;
    const boss = createEnemy(run, bossType, spot.x, spot.y, {
      tier: Math.min(10, tier), scale, boss: true, elite: true,
    });
    if (!boss) return null;
    boss.role = 'boss';
    boss.dungeonBoss = true;
    boss.homeX = spot.x; boss.homeY = spot.y;
    boss.xpValue *= 2;
    boss.goldValue *= 2;
    /*
     * 副本 Boss 的技能组。
     *
     * 玩家要求三件事：**红色感叹号预警后的冲撞**、**弹幕**、**召唤小怪**。
     * 所以副本 Boss 不再只有一个技能（def.ability），而是带一组、
     * 各自独立冷却（`ab.t`）。预警期间 Boss 停手、把角度锁死 ——
     * 玩家有时间侧移躲开，这才是「预警」的意义。
     */
    boss.abilities = [
      { kind: 'charge', cd: 11 - Math.min(3, tier * 0.2), warn: 1.1, dist: 520, halfWidth: 54,
        dmgMult: 2.2, dashSpeed: 980 },
      { kind: 'barrage', cd: 8.5, count: 7 + Math.floor(tier / 2), spread: 1.15,
        speed: 330, dmgMult: 0.45, waves: 2, waveGap: 0.3 },
      { kind: 'summonAdds', cd: 16, count: Math.min(6, 2 + Math.floor(tier / 3)) },
    ];
    for (const ab of boss.abilities) ab.t = rnd.range(2.0, ab.cd * 0.55);
    run.enemies.push(boss);
    bus.emit(EV.SFX, { name: 'alarm' });
    return boss;
  }

  /**
   * 副本常驻守军（第一次 update 时铺，因为构造 RunState 时还没装上战斗系统）。
   *
   * 数量按层数**固定**（玩家要求「固定数量的小怪」，不是随机刷）：
   * 每间侧室 1~2 只守着宝物，主通道上 2 + 层数/3 只巡逻。
   * 它们用 guard 逻辑（离原位 980px 内追击），不会一路追到入口大厅。
   */
  spawnDungeonGarrison(tier) {
    const run = this.run;
    const d = run.dungeon;
    run.dungeonGarrisonSpawned = true;
    if (!d) return 0;
    let n = 0;
    const chambers = d.chambers || [];
    const perChamber = tier >= 7 ? 2 : 1;
    for (const ch of chambers) {
      for (let k = 0; k < perChamber; k++) {
        const a = run.rng.next() * TAU;
        const spot = run.world.findOpenSpot(ch.x + Math.cos(a) * 70, ch.y + Math.sin(a) * 70, 120);
        if (this.spawnDungeonGuard(spot.x, spot.y, tier)) n++;
      }
    }
    const corridorGuards = 2 + Math.floor(tier / 3);
    for (let i = 0; i < corridorGuards; i++) {
      const tx = d.entry.x + 340 + i * 190;
      if (tx > d.boss.x - 160) break;
      const spot = run.world.findOpenSpot(tx, d.entry.y + (i % 2 ? 34 : -34), 140);
      if (this.spawnDungeonGuard(spot.x, spot.y, tier)) n++;
    }
    run.dungeonGarrison = n;
    return n;
  }

  /** 一只副本守卫：随机怪种，按层数缩放，守在自己那一格附近 */
  spawnDungeonGuard(x, y, tier) {
    const run = this.run;
    const pool = [
      ...NEST_ROSTER.base.map(t => ({ t, w: 26 })),
      ...NEST_ROSTER.mid.map(t => ({ t, w: 20 })),
    ];
    if (tier >= 4) pool.push(...NEST_ROSTER.high.map(t => ({ t, w: 16 })));
    if (tier >= 7) pool.push(...NEST_ROSTER.special.map(t => ({ t, w: 6 })));
    const type = run.rng.weighted(pool);
    if (!type || !MONSTER_DEF[type]) return null;
    const e = createEnemy(run, type, x, y, {
      tier: Math.min(10, tier), scale: enemyScaleFor(run, tier, 1),
    });
    if (!e) return null;
    e.role = 'guard';
    e.dungeonGuard = true;
    e.homeX = x; e.homeY = y;
    run.enemies.push(e);
    return e;
  }

  // =========================================================
  //  野战游荡怪
  // =========================================================

  updateWildSpawns(dt) {
    const run = this.run;
    // 纯塔防模式没有「野外」：怪全部按波次从阵地外进来
    if (run.isTowerDefense) return;
    // 虫巢副本里也没有野外刷怪 —— 怪是按房间布置的
    if (run.dungeon) return;
    if (this._wildTimer > 0) return;
    this._wildTimer = 5.5;
    if (run.enemies.length > 110) return;

    const p = run.player;
    const maxWild = 14 + run.planetIndex * 3;
    let wild = 0;
    for (const e of run.enemies) if (e.role === 'wild') wild++;
    if (wild >= maxWild) return;

    // 在玩家附近但不贴脸的环带上刷。
    // 半径交给 director.spawnPoint（屏幕外 + 缓冲），宽屏也算得进去 ——
    // 以前固定 820~1250，宽屏（2560×1440）半对角线就有 1469，怪直接出现在视野里。
    const spot = run.director?.spawnPoint
      ? run.director.spawnPoint(null, { anchor: run.camera || p, openRadius: 200 })
      : run.world.findOpenSpot(p.x + run.rng.range(-1, 1) * 900, p.y + run.rng.range(-1, 1) * 900, 200);
    if (run.world.circleBlocked(spot.x, spot.y, 12)) return;

    // 按玩家所在地形选怪种
    const biome = run.world.biomeAtPx(p.x, p.y);
    const pool = BIOME_MONSTERS[biome] || BIOME_MONSTERS[0];
    const type = run.rng.pick(pool);
    if (!type) return;

    // 第一颗星球开局只出 1-2 级的怪，越往后越强
    const tier = Math.max(1, Math.min(5, 1 + Math.round(run.planetIndex * 0.7 + rnd.next() * 1.4 - 0.5)));
    const scale = enemyScaleFor(run, tier, 1);
    // 精英率调低：精英现在是「三倍血 + 掉装备」的定位，不该满地跑
    const elite = this.eliteAllowed() && rnd.chance(0.028 + run.playerStats.get('eliteSpawnMult') * 0.4);
    const e = createEnemy(run, type, spot.x, spot.y, { tier, scale, elite });
    if (!e) return;
    if (elite) this.makeElite(e, tier);
    e.role = 'wild';
    e.wanderTarget = { x: spot.x, y: spot.y };
    run.enemies.push(e);
  }

  // =========================================================
  //  单个敌人
  // =========================================================

  updateEnemy(e, dt, game) {
    const run = this.run;

    // 出场动画
    if (e.spawnAnim > 0) e.spawnAnim = Math.max(0, e.spawnAnim - dt);
    if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt * 4);

    // 状态结算
    this.tickStatuses(e, dt);

    if (e.stun > 0) {
      e.stun -= dt;
      this.applyKnockback(e, dt);
      return;
    }

    // 索敌
    this.pickTarget(e);

    // 特殊 AI
    switch (e.def.ai) {
      case AI.CHARGER: this.aiCharger(e, dt); break;
      case AI.RANGED: this.aiRanged(e, dt, game); break;
      case AI.SUPPORT: this.aiSupport(e, dt); break;
      case AI.SUMMONER: this.aiSummoner(e, dt); break;
      case AI.BOSS: this.aiBoss(e, dt, game); break;
      case AI.FLANK: this.aiFlank(e, dt); break;
      default: this.aiSwarm(e, dt); break;
    }

    // 光环
    this.applyAura(e, dt);

    this.applyKnockback(e, dt);
  }

  tickStatuses(e, dt) {
    const run = this.run;
    if (e.burn) {
      e.burn.remain -= dt;
      const dmg = e.burn.dps * e.burn.stacks * dt;
      e.hp -= dmg;
      if (rnd.chance(dt * 6)) bus.emit(EV.DAMAGE, { x: e.x + rnd.range(-8, 8), y: e.y - 14, amount: Math.max(1, Math.round(dmg * 6)), element: 'fire', small: true });
      if (e.burn.remain <= 0) e.burn = null;
      if (e.hp <= 0) { this.kill(e); return; }
    }
    if (e.poison) {
      e.poison.remain -= dt;
      const dmg = e.poison.dps * e.poison.stacks * dt;
      e.hp -= dmg;
      if (rnd.chance(dt * 6)) bus.emit(EV.DAMAGE, { x: e.x + rnd.range(-8, 8), y: e.y - 14, amount: Math.max(1, Math.round(dmg * 6)), element: 'poison', small: true });
      if (e.poison.remain <= 0) e.poison = null;
      if (e.hp <= 0) { this.kill(e); return; }
    }
    if (e.slow) {
      e.slow.remain -= dt;
      if (e.slow.remain <= 0) e.slow = null;
    }
    // 载具电锯造成的流血
    if (e.bleed) {
      e.bleed.remain -= dt;
      const dmg = e.bleed.dps * dt;
      e.hp -= dmg;
      if (rnd.chance(dt * 6)) bus.emit(EV.DAMAGE, { x: e.x + rnd.range(-8, 8), y: e.y - 14, amount: Math.max(1, Math.round(dmg * 6)), element: 'bleed', small: true });
      if (e.bleed.remain <= 0) e.bleed = null;
      if (e.hp <= 0) { this.kill(e); return; }
    }
    if (e.marks > 0) {
      e.markTimer -= dt;
      if (e.markTimer <= 0) { e.marks = 0; }
    }
  }

  /** 决定打谁：基地被毁后追玩家，否则优先建筑/玩家 */
  pickTarget(e) {
    const run = this.run;
    const p = run.player;

    // 巢穴绑定怪：先把「追得太远」的目标丢掉，再重新索敌。
    // Boss 永远只在巢穴周围接敌；普通守卫追出 GUARD_LEASH 就脱战回家。
    const leash = e.boss ? BOSS_AGGRO
      : (e.homeNest && e.role === 'guard') ? GUARD_LEASH
        : Infinity;
    if (e.target && Number.isFinite(leash) && dist(e.x, e.y, e.homeX, e.homeY) > leash) {
      e.target = null;
      e.targetKind = null;
      e.targetPlayer = false;
    }

    // 已有的目标还有效吗
    if (e.target && e.target.dead !== true && e.target.destroyed !== true) {
      const t = e.target;
      const d = dist(e.x, e.y, t.x, t.y);
      if (d < (e.aggroRange || 1400)) return;
    }

    if (run.wave.huntMode) {
      // 追杀模式下全地图的怪都扑向玩家 —— 但 Boss 仍然守在巢里，
      // 否则基地一破玩家就被十几只 Boss 追着跑，那不是难度是荒唐。
      if (e.boss) { e.target = null; e.targetKind = null; e.targetPlayer = false; return; }
      e.target = p;
      e.targetKind = 'player';
      e.targetPlayer = true;
      return;
    }

    const homeD = Number.isFinite(leash) ? dist(e.x, e.y, e.homeX, e.homeY) : 0;
    const outOfLeash = homeD > leash;

    /*
     * 目标选择规则（玩家要求）：
     *   「怪刷出来要看离玩家近还是离基地近，离哪个近先打哪个；
     *     如果玩家在基地吸引阵列范围里，优先打基地。」
     *
     * 所以不再用「玩家 220px 内才打玩家」这种固定半径，而是把
     * 玩家 / 基地 / 塔 / 工事放在一起比距离，最近的优先。
     * 唯一的例外是第 2 条：玩家站在吸引阵列范围内时，基地优先 ——
     * 那正是「把怪吸过来守家」的核心玩法，怪不该绕过基地去追人。
     */
    const dp = dist(e.x, e.y, p.x, p.y);
    const base = run.base;
    const baseAlive = base && !base.destroyed;
    const db = baseAlive ? dist(e.x, e.y, base.x, base.y) : Infinity;
    // 玩家是不是站在核心舱的吸引阵列范围内？
    // 注意这里量的是「玩家 ↔ 阵列（=基地）」的距离，不是「玩家 ↔ 怪」——
    // 后者会把「怪离玩家很近」也误判成「玩家在范围内」。
    const playerInField = baseAlive
      && Math.hypot(p.x - run.beacon.x, p.y - run.beacon.y) <= (run.beacon.radius || 0);

    // 找最近的建筑/塔/工事/基地（离巢太远就不接受新目标，回家再说）
    let best = null, bd = Infinity;
    if (!outOfLeash) {
      for (const t of run.towers) {
        if (t.hp <= 0) continue;
        const d = dist2(e.x, e.y, t.x, t.y);
        if (d < bd) { bd = d; best = t; }
      }
      for (const s of run.structures) {
        if (s.hp <= 0) continue;
        const d = dist2(e.x, e.y, s.x, s.y);
        if (d < bd) { bd = d; best = s; }
      }
      if (baseAlive && db * db < bd) { bd = db * db; best = base; }
    }

    // 1) 玩家在吸引阵列里：基地优先（哪怕玩家更近）
    if (playerInField && best && !p.dead) {
      e.target = best; e.targetKind = best.kind || 'base'; e.targetPlayer = false;
      return;
    }

    // 2) 否则比距离：谁近打谁
    if (!p.dead && !outOfLeash && dp * dp < bd && dp < (e.def.sight || 900)) {
      e.target = p; e.targetKind = 'player'; e.targetPlayer = true;
      return;
    }

    if (best) {
      e.target = best; e.targetKind = best.kind || 'base'; e.targetPlayer = false;
      return;
    }
    if (!p.dead && !outOfLeash && dp < (e.def.sight || 900) * 0.9) {
      e.target = p; e.targetKind = 'player'; e.targetPlayer = true;
      return;
    }
    e.target = null;
    e.targetKind = null;
    e.targetPlayer = false;
  }

  /**
   * 脱战回巢。
   * 走到家附近就停下来重新索敌，避免在巢穴上反复抖动。
   */
  returnHome(e, dt) {
    const d = dist(e.x, e.y, e.homeX, e.homeY);
    if (d < 90) { this.wander(e, dt); return true; }
    this.moveToward(e, e.homeX, e.homeY, dt, 0.85);
    return false;
  }

  // ---------- AI 实现 ----------

  /** 沿流场朝目标走 */
  /**
   * 贴墙绕行：流场用不了（或指的方向直接撞墙）时的兜底。
   *
   * 玩家反馈「有些怪刷出来寻路不对，会对目标走直线被卡住」。
   * 原因是 moveAlongFlow 在拿不到流场方向时会直接朝目标走直线 ——
   * 中间隔着一堵岩壁时，怪就一头顶在墙上原地抖。
   * 这里在 8 个方向里挑一个「没被挡住、又尽量朝向目标」的方向，
   * 相当于最朴素的贴墙滑行，配合 enemies.unstick() 一起兜住。
   */
  fallbackDir(e, tx, ty) {
    const world = this.run.world;
    const want = angleTo(e.x, e.y, tx, ty);
    const probe = e.r + 12;
    let bestA = want, bestScore = -Infinity;
    for (let i = 0; i < 8; i++) {
      // 0, +45, -45, +90, -90, +135, -135, 180 的扫描顺序
      const off = Math.ceil(i / 2) * (Math.PI / 4) * (i % 2 ? 1 : -1);
      const a = want + off;
      const px = e.x + Math.cos(a) * probe;
      const py = e.y + Math.sin(a) * probe;
      if (world.circleBlocked(px, py, e.r * 0.8)) continue;
      // 越贴近目标方向越好，偏离越远扣得越多
      const score = Math.cos(off) - Math.abs(off) * 0.05;
      if (score > bestScore) { bestScore = score; bestA = a; }
    }
    return { x: Math.cos(bestA), y: Math.sin(bestA) };
  }

  moveAlongFlow(e, dt, speedMult = 1) {
    const run = this.run;
    const flow = this.flow;
    const target = e.target;
    const s = flow.sample(e.x, e.y);
    let dx = 0, dy = 0;
    if (s.ok && (s.x || s.y)) {
      dx = s.x; dy = s.y;
      // 流场指的方向如果直接顶墙（贴墙/卡在角落里），换成贪心绕行方向
      const ahead = run.world.circleBlocked(e.x + dx * (e.r + 10), e.y + dy * (e.r + 10), e.r * 0.8);
      if (ahead && target) {
        const fb = this.fallbackDir(e, target.x, target.y);
        dx = fb.x; dy = fb.y;
      }
    } else if (target) {
      // 没有流场信息：绝不走直线，先找能走的方向
      const fb = this.fallbackDir(e, target.x, target.y);
      dx = fb.x; dy = fb.y;
    }
    const speed = this.speedOf(e) * speedMult;
    const step = speed * dt;
    this.tryMove(e, dx * step, dy * step);
    if (dx || dy) e.angle = turnToward(e.angle, Math.atan2(dy, dx), dt * 7);
  }

  /**
   * 直接朝点走。
   *
   * 玩家反馈「有些怪寻路会走最短的直线，会卡在地形上」——
   * 原来这里是无条件直走，一堵墙就顶上去。现在**先探一下前方**：
   * 直走会撞墙就换成贪心绕行方向（fallbackDir），只有真的走得通才直走。
   */
  moveToward(e, tx, ty, dt, mult = 1) {
    const a = angleTo(e.x, e.y, tx, ty);
    const run = this.run;
    let dx = Math.cos(a), dy = Math.sin(a);
    const probe = e.r + 10;
    if (run.world.circleBlocked(e.x + dx * probe, e.y + dy * probe, e.r * 0.8)) {
      const fb = this.fallbackDir(e, tx, ty);
      dx = fb.x; dy = fb.y;
    }
    const speed = this.speedOf(e) * mult;
    this.tryMove(e, dx * speed * dt, dy * speed * dt);
    if (dx || dy) e.angle = turnToward(e.angle, Math.atan2(dy, dx), dt * 7);
  }

  /**
   * 守家：在巢穴周围一小圈里踱步。
   * Boss 的默认状态就是这个 —— 它不巡逻全图，只等玩家上门。
   */
  guardNest(e, dt) {
    if (!Number.isFinite(e.homeX)) { this.wander(e, dt); return; }
    e.wanderTimer = (e.wanderTimer || 0) - dt;
    const strayed = dist(e.x, e.y, e.homeX, e.homeY) > 150;
    if (e.wanderTimer <= 0 || strayed || !e.wanderTarget) {
      e.wanderTimer = rnd.range(2.5, 5.5);
      const a = rnd.next() * TAU;
      const r = rnd.range(30, 140);
      e.wanderTarget = { x: e.homeX + Math.cos(a) * r, y: e.homeY + Math.sin(a) * r };
    }
    const w = e.wanderTarget;
    if (dist2(e.x, e.y, w.x, w.y) < 50 * 50) { e.wanderTarget = null; return; }
    this.moveToward(e, w.x, w.y, dt, 0.5);
  }

  tryMove(e, dx, dy) {
    const world = this.run.world;
    if (e.def.flying) {
      e.x = clamp(e.x + dx, TILE, world.w * TILE - TILE);
      e.y = clamp(e.y + dy, TILE, world.h * TILE - TILE);
      return;
    }
    const nx = e.x + dx;
    const ny = e.y + dy;
    if (!world.circleBlocked(nx, e.y, e.r * 0.8)) e.x = nx;
    else if (Math.abs(dx) > 0.01 && e.def.ai === AI.CHARGER) e.stun = Math.max(e.stun, e.def.charge?.stunOnWall || 1);
    if (!world.circleBlocked(e.x, ny, e.r * 0.8)) e.y = ny;
  }

  /**
   * 卡墙自救。
   *
   * 玩家反馈「有些怪会被地形卡住」。原因：流场是 2 格降采样的，
   * 而实际移动用逐格的 circleBlocked —— 两者在墙角/窄缝处会不一致，
   * 于是怪一边被流场指着「往那边走」，一边被碰撞判定钉在原地，
   * 表现就是一只怪贴着石壁原地抖。
   *
   * 这里兜底：连续 1.2 秒几乎没位移、又不在攻击距离内，就把它挪到最近的可通行点。
   */
  unstick(e, dt) {
    if (e.def.flying) return;
    const run = this.run;
    const moved = Math.hypot(e.x - (e._sx ?? e.x), e.y - (e._sy ?? e.y));
    e._sx = e.x; e._sy = e.y;
    if (moved > 0.5) { e._stuckT = 0; return; }
    // 正在打目标（含拆塔/啃基地）不算卡住
    const t = e.target;
    if (t && dist(e.x, e.y, t.x, t.y) < (e.def.attackRange || 26) + (t.r || 16) + 8) { e._stuckT = 0; return; }
    if (e.stun > 0 || e.burrowed) { e._stuckT = 0; return; }
    e._stuckT = (e._stuckT || 0) + dt;
    if (e._stuckT < 1.2) return;
    /*
     * 卡住的处理：**直接消失，让波次重新刷**。
     *
     * 玩家明确要求：「卡住后也不要突然刷新到基地附近，直接消失掉重新刷就好了」。
     * 原来的做法是 findOpenSpot 就近挪一下 —— 挪不出去时（比如被两块岩石夹住）
     * 会落到更远的地方，看起来就像"凭空出现在基地旁边"。
     * 现在改成退场：标记 dead + 记录原因，由波次导演按正常节奏补一只新的。
     */
    e._stuckT = 0;
    e.dead = true;
    e.despawnReason = 'stuck';
    if (run.director?.onEnemyDespawn) run.director.onEnemyDespawn(e, 'stuck');
  }

  speedOf(e) {    let s = e.speed;
    if (e.slow) s *= (1 - clamp01(e.slow.amount * (e.slow.stacks || 1)));
    if (e.auraSpeed) s *= e.auraSpeed;
    if (e.burrowed) s *= 1.5;
    // 地形：只做温和的差异，避免怪物被地形卡住节奏
    s *= 0.9 + this.run.world.speedAtPx(e.x, e.y) * 0.12;
    return s;
  }

  /** 贴身攻击 */
  attackTarget(e, dt) {
    const run = this.run;
    const t = e.target;
    if (!t) return;
    e.attackCd -= dt;
    if (e.attackCd > 0) return;
    const reach = (e.def.attackRange || 26) + (t.r || 16);
    if (dist(e.x, e.y, t.x, t.y) > reach) return;
    e.attackCd = e.def.attackCd || 1;

    if (e.targetPlayer) {
      run.playerSystem.hurt(e.dmg, e, { source: e.def.name });
    } else if (t.kind === 'tower') {
      this.damageBuilding(t, e.dmg);
    } else if (t.kind === 'structure') {
      this.damageBuilding(t, e.dmg);
    } else {
      run.damageBase(t, e.dmg, e);
    }
    bus.emit(EV.SFX, { name: 'hit', volume: 0.5 });
    // 攻击动作视觉
    run.effects.push({
      kind: 'claw', x: t.x, y: t.y, angle: angleTo(e.x, e.y, t.x, t.y),
      life: 0.14, maxLife: 0.14, color: e.def.color,
    });
    // 甲壳类攻击附带酸液
    if (e.def.onDeath?.pool && rnd.chance(0.15)) {
      run.effects.push(makePool(t.x, t.y, e.def.onDeath.pool));
    }
  }

  damageBuilding(b, amount) {
    const run = this.run;
    if (b.shield > 0) {
      const absorbed = Math.min(b.shield, amount);
      b.shield -= absorbed;
      amount -= absorbed;
    }
    const dmg = applyArmor(amount, b.armor || 0);
    b.hp -= dmg;
    b.hitFlash = 1;
    bus.emit(EV.STRUCTURE_DAMAGED, { structure: b, amount: dmg });
    if (b.hp <= 0) {
      b.hp = 0;
      run.destroyBuilding(b);
    }
  }

  aiSwarm(e, dt) {
    if (!e.target) {
      // 守卫脱战/无目标：离巢太远就回去，别在野外一路朝基地蹭
      if (e.homeNest && e.role === 'guard' && dist(e.x, e.y, e.homeX, e.homeY) > GUARD_LEASH) {
        this.returnHome(e, dt);
        return;
      }
      this.wander(e, dt);
      return;
    }
    const reach = (e.def.attackRange || 26) + (e.target.r || 16) + 4;
    const d = dist(e.x, e.y, e.target.x, e.target.y);
    if (d <= reach) {
      // 面向目标并攻击
      e.angle = turnToward(e.angle, angleTo(e.x, e.y, e.target.x, e.target.y), dt * 9);
      this.attackTarget(e, dt);
    } else {
      this.moveAlongFlow(e, dt);
      e.attackCd = Math.max(0, e.attackCd - dt);
    }
    this.trySummon(e, dt);
  }

  aiFlank(e, dt) {
    if (!e.target) { this.wander(e, dt); return; }
    const t = e.target;
    const reach = (e.def.attackRange || 26) + (t.r || 16) + 4;
    const d = dist(e.x, e.y, t.x, t.y);
    if (d <= reach) {
      e.angle = turnToward(e.angle, angleTo(e.x, e.y, t.x, t.y), dt * 9);
      this.attackTarget(e, dt);
      return;
    }
    // 侧翼：在目标周围绕一个角度后再切进去
    if (!e.flankPoint || dist2(e.x, e.y, e.flankPoint.x, e.flankPoint.y) < 60 * 60 || d < 260) {
      const base = angleTo(t.x, t.y, e.x, e.y) + (e.flankAngle || 0.5);
      const r = Math.max(120, d * 0.55);
      e.flankPoint = { x: t.x + Math.cos(base) * r, y: t.y + Math.sin(base) * r };
    }
    const fp = e.flankPoint;
    if (!this.run.world.circleBlocked(fp.x, fp.y, e.r * 0.8)) {
      this.moveToward(e, fp.x, fp.y, dt, 1.08);
    } else {
      this.moveAlongFlow(e, dt, 1.08);
    }
    this.trySummon(e, dt);
  }

  aiRanged(e, dt, game) {
    const run = this.run;
    const t = e.target;
    if (!t) { this.wander(e, dt); return; }
    const d = dist(e.x, e.y, t.x, t.y);
    const keep = e.def.keepDist || 200;
    const maxR = e.def.attackRange || 300;

    if (d > maxR) {
      this.moveAlongFlow(e, dt, 1);
    } else if (d < keep * 0.7) {
      // 后退
      const a = angleTo(t.x, t.y, e.x, e.y);
      this.tryMove(e, Math.cos(a) * this.speedOf(e) * dt, Math.sin(a) * this.speedOf(e) * dt);
      e.angle = turnToward(e.angle, angleTo(e.x, e.y, t.x, t.y), dt * 6);
    } else {
      // 侧移
      const a = angleTo(t.x, t.y, e.x, e.y) + Math.PI / 2 * (e.wobble > Math.PI ? 1 : -1);
      this.tryMove(e, Math.cos(a) * this.speedOf(e) * 0.5 * dt, Math.sin(a) * this.speedOf(e) * 0.5 * dt);
      e.angle = turnToward(e.angle, angleTo(e.x, e.y, t.x, t.y), dt * 6);
    }

    e.attackCd -= dt;
    if (e.attackCd <= 0 && d <= maxR) {
      e.attackCd = e.def.attackCd || 2;
      this.fireRanged(e, t);
    }
  }

  fireRanged(e, t) {
    const run = this.run;
    const rd = e.def.ranged;
    if (!rd || !t) return;
    const a = angleTo(e.x, e.y, t.x, t.y) + rnd.range(-0.06, 0.06);
    const speed = rd.speed || 300;
    const proj = createProjectile({
      x: e.x + Math.cos(a) * (e.r + 4),
      y: e.y + Math.sin(a) * (e.r + 4),
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      r: rd.r || 8,
      damage: e.dmg,
      friendly: false,
      color: rd.kind === 'void' ? '#b080ff' : rd.kind === 'acid' ? '#9fe06a' : '#e0d060',
      life: 2.4,
      owner: e,
      homing: rd.arc ? { target: t, turn: 1.2, speed } : null,
      target: t,
      effect: rd.kind === 'acid' ? { pool: { r: 50, dmg: e.dmg * 0.4, dur: 4 } } : null,
      source: 'enemy',
    });
    run.projectiles.push(proj);
    bus.emit(EV.SFX, { name: 'shoot', volume: 0.4 });
  }

  aiCharger(e, dt) {
    const run = this.run;
    const t = e.target;
    // 有的怪 AI 标了 CHARGER 但没配 charge 参数（比如精英变体），
    // 这种情况下退化成直接冲锋，不要让 cfg.windup 抛错。
    const cfg = e.def.charge || FALLBACK_CHARGE;
    if (!t) { this.wander(e, dt); return; }

    if (e.charging) {
      e.chargeTime -= dt;
      const step = cfg.speed * dt;
      this.tryMove(e, Math.cos(e.chargeAngle) * step, Math.sin(e.chargeAngle) * step);
      // 撞到玩家/建筑
      const hits = run.spatial.query(e.x, e.y, e.r + 30, this._queryBuf2);
      for (const o of hits) {
        if (o.kind === 'enemy') continue;
        if (run.playerSystem.damageEnemy) { /* 玩家不在空间哈希里 */ }
      }
      if (!run.player.dead && dist(e.x, e.y, run.player.x, run.player.y) < e.r + run.player.r + 8) {
        run.playerSystem.hurt(e.dmg * 1.5, e, { source: '冲撞' });
        e.charging = false;
      }
      for (const b of [...run.towers, ...run.structures, ...run.bases]) {
        if (b.hp <= 0 || b.destroyed) continue;
        if (dist(e.x, e.y, b.x, b.y) < e.r + (b.r || 30)) {
          this.damageBuilding(b, e.dmg * 1.6);
          e.charging = false;
          e.stun = 0.5;
        }
      }
      if (e.chargeTime <= 0) {
        e.charging = false;
        e.chargeCd = cfg.cd;
        run.effects.push({ kind: 'ring', x: e.x, y: e.y, r: 40, life: 0.3, maxLife: 0.3, color: '#ff9a6a' });
      }
      return;
    }

    e.chargeCd = (e.chargeCd || 0) - dt;
    e.chargeWindup = (e.chargeWindup || 0) - dt;

    // 潜地
    if (e.def.burrow) {
      e.burrowTimer = (e.burrowTimer || e.def.burrow.interval) - dt;
      if (e.burrowTimer <= 0) {
        e.burrowed = !e.burrowed;
        e.burrowTimer = e.burrowed ? e.def.burrow.time : e.def.burrow.interval;
        run.effects.push({ kind: 'ring', x: e.x, y: e.y, r: 30, life: 0.35, maxLife: 0.35, color: '#9a7a4a' });
      }
    }

    const d = dist(e.x, e.y, t.x, t.y);
    if (d < 380 && e.chargeCd <= 0 && e.chargeWindup <= 0) {
      e.chargeWindup = cfg.windup;
      e.chargeAngle = angleTo(e.x, e.y, t.x, t.y);
      run.effects.push({ kind: 'telegraph', x: e.x, y: e.y, angle: e.chargeAngle, len: 340, width: 40, life: cfg.windup, maxLife: cfg.windup, color: '#ff5f6d' });
      return;
    }
    if (e.chargeWindup > 0) {
      if (e.chargeWindup <= 0.001) {
        // 蓄力完成，开始冲
      }
      // 蓄力期间缓慢转向
      e.chargeAngle = turnToward(e.chargeAngle, angleTo(e.x, e.y, t.x, t.y), dt * 2.2);
      if (e.chargeWindup <= 0) {
        e.charging = true;
        e.chargeTime = cfg.time;
        bus.emit(EV.SFX, { name: 'shootHeavy', volume: 0.5 });
      }
      return;
    }

    const reach = (e.def.attackRange || 30) + (t.r || 16);
    if (d <= reach) {
      e.angle = turnToward(e.angle, angleTo(e.x, e.y, t.x, t.y), dt * 8);
      this.attackTarget(e, dt);
    } else {
      this.moveAlongFlow(e, dt, 1);
    }
  }

  aiSupport(e, dt) {
    const t = e.target;
    if (!t) { this.wander(e, dt); return; }
    const d = dist(e.x, e.y, t.x, t.y);
    const maxR = e.def.attackRange || 260;
    if (d > maxR) this.moveAlongFlow(e, dt, 0.9);
    else if (d < 200) {
      const a = angleTo(t.x, t.y, e.x, e.y);
      this.tryMove(e, Math.cos(a) * this.speedOf(e) * 0.8 * dt, Math.sin(a) * this.speedOf(e) * 0.8 * dt);
      e.angle = turnToward(e.angle, angleTo(e.x, e.y, t.x, t.y), dt * 5);
    }
    e.attackCd -= dt;
    if (e.attackCd <= 0 && d <= maxR) {
      e.attackCd = e.def.attackCd || 2;
      this.fireRanged(e, t);
    }
    this.trySummon(e, dt);
  }

  aiSummoner(e, dt) {
    const t = e.target;
    if (!t) { this.wander(e, dt); return; }
    const d = dist(e.x, e.y, t.x, t.y);
    const maxR = e.def.attackRange || 40;
    if (d > maxR * 0.9) this.moveAlongFlow(e, dt, 0.85);
    else { e.angle = turnToward(e.angle, angleTo(e.x, e.y, t.x, t.y), dt * 5); this.attackTarget(e, dt); }
    this.trySummon(e, dt);
  }

  aiBoss(e, dt, game) {
    const run = this.run;
    const t = e.target;
    // 阶段
    const hpFrac = e.hp / e.hpMax;
    const phases = e.def.phases || [];
    for (let i = e.phaseIndex; i < phases.length; i++) {
      if (hpFrac <= phases[i].at) {
        e.phaseIndex = i + 1;
        const ph = phases[i];
        bus.emit(EV.SFX, { name: 'alarm' });
        bus.emit(EV.SCREEN_SHAKE, { mag: 7, time: 0.5 });
        notice(`${e.def.name} · ${ph.name}`, 'Boss 进入新阶段！', 'danger');
        if (ph.add) {
          for (let k = 0; k < ph.add.count; k++) {
            const a = rnd.next() * TAU;
            const spawn = run.world.findOpenSpot(e.x + Math.cos(a) * 90, e.y + Math.sin(a) * 90, 150);
            const add = createEnemy(run, ph.add.type, spawn.x, spawn.y, {
              tier: e.tier, scale: enemyScaleFor(run, e.tier, 1), summoned: true,
            });
            if (add) { add.role = 'wave'; run.enemies.push(add); }
          }
        }
        if (ph.summon) {
          for (let k = 0; k < ph.summon.count; k++) {
            const a = rnd.next() * TAU;
            const spawn = run.world.findOpenSpot(e.x + Math.cos(a) * 120, e.y + Math.sin(a) * 120, 180);
            const add = createEnemy(run, ph.summon.type, spawn.x, spawn.y, {
              tier: e.tier, scale: enemyScaleFor(run, e.tier, 1), summoned: true,
            });
            if (add) { add.role = 'wave'; run.enemies.push(add); }
          }
        }
        if (ph.speedMult) e.speed = e.def.speed * ph.speedMult;
        if (ph.dmgMult) e.dmg = e.def.dmg * ph.dmgMult * (e.scale?.dmg || 1);
        if (ph.cdMult) e.phaseCdMult = ph.cdMult;
        if (ph.teleport) e.canTeleport = true;
        run.effects.push({ kind: 'ring', x: e.x, y: e.y, r: 220, life: 0.7, maxLife: 0.7, color: '#ff5f6d', big: true });
      }
    }

    /*
     * 冲撞中：只管往前撞（结算在 updateBossDash 里）。
     *
     * 必须放在「没有目标」判断**之前** —— 冲撞不需要目标。
     * 放在后面的话，玩家一跑远、目标一丢，`e.dash` 就永远留在 Boss 身上：
     * 它会拖着一条红色尾迹慢慢晃，而冲撞距离再也不推进（实测单次冲撞从
     * 32 帧变成 288 帧）。这是自己写出来的 bug，靠帧计数才抓出来。
     */
    if (e.dash) { this.updateBossDash(e, dt); return; }

    if (!t) {
      // Boss 没有目标就守在巢边，绝不乱跑
      this.guardNest(e, dt);
      return;
    }

    /*
     * 技能组（副本 Boss）：每个技能各自冷却，预警期间 Boss 停手不动。
     * 旧的地表 Boss 仍然走下面那个单技能分支。
     */
    if (e.abilities) {
      if (e.casting) {
        this.updateBossCast(e, dt);
        return;
      }
      this.updateBossBarrage(e, dt);
      for (const ab of e.abilities) {
        ab.t -= dt;
        if (ab.t <= 0) { ab.t = ab.cd * (e.phaseCdMult || 1); this.bossAbility(e, ab); }
      }
      if (e.casting) return;   // 刚起手，这一帧不再走位
    }

    // 技能（冷却每帧都要走，否则被脱战打断一次就再也不放了）
    e.abilityCd -= dt;
    const ab = e.def.ability;
    if (ab && e.abilityCd <= 0 && !e.abilities) {
      e.abilityCd = ab.cd * (e.phaseCdMult || 1);
      this.bossAbility(e, ab);
    }
    if (e.canTeleport) {
      e.teleportCd = (e.teleportCd || 6) - dt;
      if (e.teleportCd <= 0 && e.def.role === 'boss' && e.def.ranged) {
        e.teleportCd = 7;
        const a = rnd.next() * TAU;
        const spot = run.world.findOpenSpot(e.x + Math.cos(a) * 320, e.y + Math.sin(a) * 320, 200);
        run.effects.push({ kind: 'ring', x: e.x, y: e.y, r: 60, life: 0.3, maxLife: 0.3, color: '#8f5fff' });
        e.x = spot.x; e.y = spot.y;
        run.effects.push({ kind: 'ring', x: e.x, y: e.y, r: 60, life: 0.3, maxLife: 0.3, color: '#8f5fff' });
      }
    }

    const d = dist(e.x, e.y, t.x, t.y);
    const maxR = e.def.attackRange || 60;
    // 追击时也不能离家太远：超出 BOSS_AGGRO 就直接往巢的方向走。
    // （用流场会一路走向基地，那就是「Boss 追着你打」的老毛病）
    const homeD = dist(e.x, e.y, e.homeX, e.homeY);
    if (homeD > BOSS_AGGRO) {
      this.returnHome(e, dt);
    } else if (d > maxR) {
      this.moveAlongFlow(e, dt, 1);
    } else {
      e.angle = turnToward(e.angle, angleTo(e.x, e.y, t.x, t.y), dt * 5);
      if (e.def.ranged) {
        e.attackCd -= dt;
        if (e.attackCd <= 0) { e.attackCd = e.def.attackCd || 1.5; this.fireRanged(e, t); }
      } else this.attackTarget(e, dt);
    }
    this.trySummon(e, dt);
  }

  /**
   * 预警中的技能推进（目前只有冲撞需要）。
   *
   * 预警期间 Boss **不动手也不走位**，只把角度锁死并闪红感叹号 ——
   * 玩家有 1.1 秒侧移躲开。时间到就真的冲出去。
   */
  updateBossCast(e, dt) {
    const run = this.run;
    const c = e.casting;
    c.t -= dt;
    if (c.t > 0) {
      // 蓄力抖动：让「它要冲了」这件事在视觉上也成立
      e.chargeShake = 1;
      return;
    }
    e.chargeShake = 0;
    if (c.kind === 'charge') {
      e.dash = {
        x: Math.cos(c.angle), y: Math.sin(c.angle),
        remain: c.ab.dist, speed: c.ab.dashSpeed, halfWidth: c.ab.halfWidth,
        dmg: e.dmg * c.ab.dmgMult, hit: new Set(),
      };
      bus.emit(EV.SFX, { name: 'explode', volume: 0.8 });
      bus.emit(EV.SCREEN_SHAKE, { mag: 7, time: 0.3 });
    }
    e.casting = null;
  }

  /**
   * 弹幕推进：一波一波地撒弹丸（每波间隔 gap 秒）。
   * 挂在 Boss 身上而不是浏览器计时器上，所以暂停/加速/读档都不会错位。
   */
  updateBossBarrage(e, dt) {
    const run = this.run;
    const b = e.barrage;
    if (!b) return;
    b.timer -= dt;
    if (b.timer > 0) return;
    b.timer = b.gap;
    b.left--;
    const n = b.count;
    for (let i = 0; i < n; i++) {
      const a = b.base + (i - (n - 1) / 2) * (b.spread / n) * 2;
      const speed = b.speed * rnd.range(0.94, 1.06);
      run.projectiles.push(createProjectile({
        x: e.x + Math.cos(a) * (e.r + 4),
        y: e.y + Math.sin(a) * (e.r + 4),
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        r: 9,
        damage: e.dmg * b.dmgMult,
        friendly: false,
        color: '#ff7a4c',
        life: 3.2,
        owner: e,
        source: 'enemy',
      }));
    }
    bus.emit(EV.SFX, { name: 'shootHeavy', volume: 0.45 });
    if (b.left <= 0) e.barrage = null;
  }

  /** 冲撞中的位移与撞击结算（每帧调用，撞墙就停） */
  updateBossDash(e, dt) {
    const run = this.run;
    const d = e.dash;
    const step = Math.min(d.speed * dt, d.remain);
    const nx = e.x + d.x * step;
    const ny = e.y + d.y * step;
    if (run.world.circleBlocked(nx, ny, e.r * 0.8)) {
      // 撞墙：停下并震一下（也顺便给玩家一个「躲进死角」的战术）
      e.dash = null;
      e.stun = Math.max(e.stun, 0.5);
      run.effects.push({ kind: 'ring', x: e.x, y: e.y, r: 90, life: 0.35, maxLife: 0.35, color: '#ff5f6d' });
      bus.emit(EV.SCREEN_SHAKE, { mag: 6, time: 0.25 });
      return;
    }
    e.x = nx; e.y = ny;
    d.remain -= step;
    run.effects.push({ kind: 'trail', x: e.x, y: e.y, r: e.r, life: 0.25, maxLife: 0.25, color: '#ff5f6d' });

    // 撞到玩家
    const p = run.player;
    if (!p.dead && !d.hit.has('player') && dist(e.x, e.y, p.x, p.y) < e.r + p.r + 6) {
      d.hit.add('player');
      run.playerSystem.hurt(d.dmg, e, { source: '冲撞' });
      p.knockX = d.x * 620; p.knockY = d.y * 620;
      bus.emit(EV.SCREEN_SHAKE, { mag: 10, time: 0.35 });
    }
    // 撞到建筑
    for (const o of [...run.towers, ...run.structures, ...run.bases]) {
      if (o.hp <= 0 || o.destroyed || d.hit.has(o)) continue;
      if (dist(e.x, e.y, o.x, o.y) > e.r + (o.r || 30)) continue;
      d.hit.add(o);
      this.damageBuilding(o, d.dmg * 0.8);
    }
    if (d.remain <= 0.5) e.dash = null;
  }

  bossAbility(e, ab) {
    const run = this.run;
    const t = e.target || run.player;
    switch (ab.kind) {
      /*
       * 红色感叹号预警后的冲撞。
       * 起手时不结算伤害，只登记 casting；真正冲出去在 updateBossCast 里。
       */
      case 'charge': {
        if (!t) break;
        e.casting = { kind: 'charge', t: ab.warn, angle: angleTo(e.x, e.y, t.x, t.y), ab };
        e.angle = e.casting.angle;
        bus.emit(EV.SFX, { name: 'alarm', volume: 0.7 });
        run.effects.push({ kind: 'ring', x: e.x, y: e.y, r: 120, life: ab.warn, maxLife: ab.warn, color: '#ff3f4f' });
        notice(`${e.def.name} · 蓄力冲撞`, '红感叹号出现时立刻侧移 —— 正面吃一下很疼。', 'warn');
        break;
      }
      /*
       * 弹幕：以 Boss 为圆心朝玩家方向扇形撒一串弹丸，共 waves 波。
       * 用敌人的投射物（owner = e），所以会正常打到玩家与建筑。
       */
      case 'barrage': {
        const base = t ? angleTo(e.x, e.y, t.x, t.y) : rnd.next() * TAU;
        const n = Math.max(3, ab.count | 0);
        /*
         * 分波发射不挂 setTimeout（那是浏览器计时器，和游戏暂停/加速脱节），
         * 而是记在 Boss 自己身上，由 updateBossCast 之外的每帧推进
         * —— 见 `e.barrage`。
         */
        e.barrage = {
          base, left: Math.max(1, ab.waves || 1), gap: ab.waveGap || 0.3, timer: 0,
          count: n, spread: ab.spread, speed: ab.speed || 320, dmgMult: ab.dmgMult || 0.5,
        };
        run.effects.push({
          kind: 'barrageHint', x: e.x, y: e.y, angle: base,
          life: 0.45, maxLife: 0.45, color: '#ff9a4c',
        });
        bus.emit(EV.SFX, { name: 'shootHeavy', volume: 0.5 });
        break;
      }
      /* 召唤固定数量的小怪（有上限，避免无限堆怪） */
      case 'summonAdds': {
        const live = run.enemies.filter(o => o.summoned && o.role === 'wave' && !o.dead).length;
        const want = Math.max(0, Math.min(ab.count | 0, 8 - live));
        const pool = [
          ...NEST_ROSTER.base.map(tt => ({ t: tt, w: 24 })),
          ...NEST_ROSTER.mid.map(tt => ({ t: tt, w: 18 })),
        ];
        for (let i = 0; i < want; i++) {
          const a = rnd.next() * TAU;
          const spot = run.world.findOpenSpot(e.x + Math.cos(a) * 110, e.y + Math.sin(a) * 110, 180);
          const type = run.rng.weighted(pool);
          const add = createEnemy(run, type, spot.x, spot.y, {
            tier: e.tier, scale: enemyScaleFor(run, e.tier, 1), summoned: true,
          });
          if (!add) continue;
          add.role = 'wave';
          run.enemies.push(add);
          run.effects.push({ kind: 'ring', x: spot.x, y: spot.y, r: 40, life: 0.4, maxLife: 0.4, color: '#c08cff' });
        }
        if (want > 0) {
          bus.emit(EV.SFX, { name: 'alarm', volume: 0.6 });
          notice(`${e.def.name} 召唤了增援`, `${want} 只小怪从地下钻了出来。`, 'warn');
        }
        break;
      }
      case 'acidNova': {
        run.effects.push({ kind: 'nova', x: e.x, y: e.y, r: ab.range, life: 0.5, maxLife: 0.5, color: '#b0e060' });
        const R = ab.range;
        if (!run.player.dead && dist(e.x, e.y, run.player.x, run.player.y) < R) {
          run.playerSystem.hurt(e.dmg * ab.dmgMult, e, { source: '酸爆' });
        }
        for (const o of [...run.towers, ...run.structures, ...run.bases]) {
          if (o.hp <= 0 || o.destroyed) continue;
          if (dist(e.x, e.y, o.x, o.y) < R) this.damageBuilding(o, e.dmg * ab.dmgMult * 0.7);
        }
        bus.emit(EV.SFX, { name: 'explode' });
        bus.emit(EV.SCREEN_SHAKE, { mag: 8, time: 0.4 });
        break;
      }
      case 'groundSlam': {
        run.effects.push({ kind: 'nova', x: e.x, y: e.y, r: ab.range, life: 0.4, maxLife: 0.4, color: '#ff9a4c' });
        if (!run.player.dead && dist(e.x, e.y, run.player.x, run.player.y) < ab.range) {
          run.playerSystem.hurt(e.dmg * ab.dmgMult, e, { source: '震地' });
          // 击退
          const a = angleTo(e.x, e.y, run.player.x, run.player.y);
          run.player.knockX = Math.cos(a) * ab.knockback;
          run.player.knockY = Math.sin(a) * ab.knockback;
        }
        bus.emit(EV.SCREEN_SHAKE, { mag: 9, time: 0.45 });
        break;
      }
      case 'voidLance': {
        const a = angleTo(e.x, e.y, t.x, t.y);
        const ex = e.x + Math.cos(a) * ab.range;
        const ey = e.y + Math.sin(a) * ab.range;
        run.effects.push({ kind: 'beam', x: e.x, y: e.y, x2: ex, y2: ey, life: 0.4, maxLife: 0.4, color: '#b080ff', width: 18 });
        if (!run.player.dead && pointNearSegment(run.player.x, run.player.y, e.x, e.y, ex, ey) < 30) {
          run.playerSystem.hurt(e.dmg * ab.dmgMult, e, { source: '虚空长矛' });
        }
        bus.emit(EV.SFX, { name: 'explode', volume: 0.6 });
        break;
      }
      case 'dashStrike': {
        const a = angleTo(e.x, e.y, t.x, t.y);
        const spot = run.world.findOpenSpot(t.x - Math.cos(a) * 40, t.y - Math.sin(a) * 40, 200);
        run.effects.push({ kind: 'beam', x: e.x, y: e.y, x2: spot.x, y2: spot.y, life: 0.3, maxLife: 0.3, color: '#ff5f6d', width: 12 });
        e.x = spot.x; e.y = spot.y;
        if (!run.player.dead && dist(e.x, e.y, run.player.x, run.player.y) < 90) {
          run.playerSystem.hurt(e.dmg * ab.dmgMult, e, { source: '突刺' });
        }
        break;
      }
      default: break;
    }
  }

  trySummon(e, dt) {
    const run = this.run;
    const sm = e.def.summon;
    if (!sm) return;
    e.summonCd -= dt;
    if (e.summonCd > 0) return;
    let count = 0;
    for (const o of run.enemies) if (o.summoned && o.fromSummoner === e.id) count++;
    if (count >= (sm.max || 12)) { e.summonCd = 1; return; }
    e.summonCd = sm.cd;
    for (let i = 0; i < sm.count; i++) {
      const a = rnd.next() * TAU;
      const r = sm.radius || 70;
      const spawn = run.world.findOpenSpot(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, 140);
      const add = createEnemy(run, sm.type, spawn.x, spawn.y, {
        tier: e.tier, scale: enemyScaleFor(run, e.tier, 1), summoned: true,
      });
      if (!add) continue;
      add.fromSummoner = e.id;
      add.role = e.role === 'guard' ? 'guard' : 'wave';
      run.enemies.push(add);
    }
    run.effects.push({ kind: 'ring', x: e.x, y: e.y, r: sm.radius, life: 0.4, maxLife: 0.4, color: e.def.color });
  }

  wander(e, dt) {
    const run = this.run;
    e.wanderTimer = (e.wanderTimer || 0) - dt;
    if (e.wanderTimer <= 0) {
      e.wanderTimer = rnd.range(2.5, 6);
      const a = rnd.next() * TAU;
      const r = rnd.range(60, 260);
      e.wanderTarget = { x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r };
    }
    if (e.wanderTarget) {
      if (dist2(e.x, e.y, e.wanderTarget.x, e.wanderTarget.y) < 40 * 40) { e.wanderTarget = null; return; }
      this.moveToward(e, e.wanderTarget.x, e.wanderTarget.y, dt, 0.45);
    }
  }

  applyAura(e, dt) {
    const run = this.run;
    const aura = e.def.aura;
    if (!aura) return;
    e.auraPulse = (e.auraPulse || 0) + dt;
    const near = run.spatial.query(e.x, e.y, aura.radius, this._queryBuf2);
    for (const o of near) {
      if (o.kind !== 'enemy' || o === e || o.dead) continue;
      if (aura.hpRegen) {
        o.auraRegen = Math.max(o.auraRegen || 0, aura.hpRegen);
        o.hp = Math.min(o.hpMax, o.hp + aura.hpRegen * dt);
      }
      if (aura.speedMult) o.auraSpeed = Math.max(o.auraSpeed || 1, aura.speedMult);
      if (aura.armorBonus) o.auraArmor = Math.max(o.auraArmor || 0, aura.armorBonus);
    }
  }

  applyKnockback(e, dt) {
    if (Math.abs(e.knockX || 0) < 1 && Math.abs(e.knockY || 0) < 1) { e.knockX = 0; e.knockY = 0; return; }
    this.tryMove(e, e.knockX * dt, e.knockY * dt);
    const decay = Math.exp(-9 * dt);
    e.knockX *= decay; e.knockY *= decay;
  }

  /** 群体分离：同格内互相推开，避免所有怪重叠成一个点 */
  separation(dt) {
    const run = this.run;
    const buf = this._queryBuf;
    // 只对视野内的做，省性能
    const view = run.camera?.viewRect(200) || { x0: 0, y0: 0, x1: run.world.w * TILE, y1: run.world.h * TILE };
    for (const e of run.enemies) {
      if (e.dead || e.def.flying) continue;
      if (e.x < view.x0 || e.x > view.x1 || e.y < view.y0 || e.y > view.y1) continue;
      run.spatial.query(e.x, e.y, e.r * 1.6, buf);
      let px = 0, py = 0, n = 0;
      for (const o of buf) {
        if (o === e || o.kind !== 'enemy' || o.dead || o.def.flying) continue;
        const dx = e.x - o.x, dy = e.y - o.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const overlap = (e.r + o.r) * 0.82 - d;
        if (overlap > 0) {
          px += (dx / d) * overlap;
          py += (dy / d) * overlap;
          n++;
        }
      }
      if (n) {
        const push = Math.min(70 * dt * 4, 24) ;
        this.tryMove(e, px * 0.5 * push, py * 0.5 * push);
      }
    }
  }

  // =========================================================
  //  击杀
  // =========================================================

  kill(e) {
    if (e.dead) return;
    const run = this.run;
    e.dead = true;
    run.stats.kills++;
    if (e.elite) run.stats.eliteKills++;
    if (e.boss) run.stats.bossKills++;
    run.loot.onEnemyKilled(e);
    const idx = run.enemies.indexOf(e);
    if (idx >= 0) swapRemove(run.enemies, idx);
  }

  /** 玩家/塔伤害入口（供 projectile / tower 调用） */
  damage(e, amount, opts = {}) {
    if (!e || e.dead) return;
    const run = this.run;
    let dmg = amount;
    if (!opts.ignoreArmor) {
      let armor = e.armor + (e.auraArmor || 0);
      dmg = applyArmor(dmg, armor);
    }
    if (e.marks > 0) dmg *= 1 + e.marks * 0.12;
    dmg = Math.max(1, dmg);
    e.hp -= dmg;
    e.hitFlash = 1;
    e.aggro = true;
    run.stats.damageDealt += dmg;
    bus.emit(EV.DAMAGE, { x: e.x, y: e.y - e.r, amount: Math.round(dmg), crit: !!opts.crit, target: e });
    if (e.hp <= 0) this.kill(e);
    return dmg;
  }
}

// ---------------- 工具 ----------------

export function makePool(x, y, cfg) {
  return {
    kind: 'pool', x, y, r: cfg.r || 50,
    dps: cfg.dmg || cfg.dps || 6,
    life: cfg.dur || 5, maxLife: cfg.dur || 5,
    friendly: cfg.friendly !== false,
    tickCd: 0,
    color: '#8fc46a',
  };
}

function pointNearSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = clamp01(t);
  const cx = x1 + dx * t, cy = y1 + dy * t;
  return Math.hypot(px - cx, py - cy);
}
