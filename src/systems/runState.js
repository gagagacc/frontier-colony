/**
 * 单局游戏状态（一次存档 = 一个 RunState）。
 *
 * 持有：星球、世界、玩家、基地、塔、敌人、投射物、掉落、科技、实验科技、
 *       人口城镇、波次调度、统计。所有系统都从这里取数据。
 */

import { TILE, BASE, BEACON, ECON, PLAYER as PCFG, VEHICLE as VCFG } from '../core/config.js';
import { RNG } from '../core/rng.js';
import { clamp, clamp01, dist, swapRemove } from '../core/math.js';
import { bus, EV, notice } from '../core/events.js';
import { World } from '../world/world.js';
import { StatSet, foldEffects } from './stats.js';
import { CHAR_DEF, GENE_DEF } from '../data/characters.js';
import { TECH_MAP } from '../data/tech.js';
import { EXP_MAP, poolFor } from '../data/experiments.js';
import { planetDef, TOWN_BUILDING_DEF } from '../data/planets.js';
import { WEAPON_DEF, EQUIP_DEF, reloadTimeOf } from '../data/weapons.js';
import { TOWER_DEF, STRUCTURE_DEF } from '../data/towers.js';
import { costText } from './towers.js';
import { MONSTER_DEF } from '../data/monsters.js';
import { GAME_MODE, modeDef } from '../data/modes.js';
import { carveDungeon, dungeonPlan } from '../world/dungeon.js';

let _entitySeq = 1;
export const nextId = () => _entitySeq++;

export class RunState {
  constructor(opts = {}) {
    this.rng = new RNG(opts.seed || Date.now());
    this.seedStr = String(opts.seed || Date.now());
    this.planetIndex = opts.planetIndex ?? 0;
    this.planet = planetDef(this.planetIndex);
    this.planetClaimed = false;
    this.claimedPlanets = opts.claimedPlanets || [];   // [{ index, name, since }]

    this.time = 0;
    this.playTime = 0;
    this.day = 1;

    this.characterId = opts.characterId || 'engineer';
    this.charDef = CHAR_DEF[this.characterId];

    /** 游戏模式（见 data/modes.js）：frontier | towerDefense */
    this.mode = opts.mode || GAME_MODE.FRONTIER;
    this.modeDef = modeDef(this.mode);
    this.isTowerDefense = this.mode === GAME_MODE.TOWER_DEFENSE;

    /** 虫巢副本状态（在副本里时非 null）：{ tier, nestId, cleared } */
    this.dungeon = null;

    this.world = new World(this.seedStr + ':p' + this.planetIndex, {
      planetIndex: this.planetIndex,
      name: this.planet.name,
      mode: this.mode,
      nestScale: this.modeDef.world.nestScale,
      poiScale: this.modeDef.world.poiScale,
      compact: !!this.modeDef.world.compact,
    });

    // ---------------- 资源 ----------------
    this.resources = {
      gold: this.planet.startingSupplies.gold,
      metal: this.planet.startingSupplies.metal,
      crystal: 0,
      fiber: 20,
      wood: 10,
      food: this.planet.startingSupplies.food,
      spore: 0,
      sulfur: 0,
      fuel: 40,
      water: 20,
      coolant: 0,
      chitin: 0,
      biomass: 0,
      dna: 0,
      parts: 10,
      tech: 0,
      research: 0,
      beaconCore: 1,
    };
    this.storageCap = { gold: 6000, metal: 900, crystal: 400, food: 400, parts: 200 };

    // 模式自带的额外启动资源（纯塔防开局要多给一点，因为没法出门采）
    for (const [kind, amount] of Object.entries(this.modeDef.startResources || {})) {
      this.resources[kind] = (this.resources[kind] || 0) + amount;
    }

    // ---------------- 成长 ----------------
    this.unlockedTech = new Set();          // 主科技树
    this.experiments = new Map();            // expId -> level
    this.pendingChoices = 0;                 // 待选的实验科技次数
    this.refreshCount = 0;                   // 本次四选一刷新了几次
    this.currentOptions = null;              // 当前四选一候选
    this.currentDir = null;
    this.bioPoints = 0;
    this.genes = [];                         // 已缝合基因 [{id, level}]

    // ---------------- 玩家与基地 ----------------
    this.baseSiteCenter = { x: this.world.baseSite.x, y: this.world.baseSite.y };
    this.bases = [];
    this.player = createPlayer(this);
    this.vehicle = createVehicle(this);
    this.towers = [];
    this.structures = [];
    this.beacon = createBeacon(this);

    this._initBase();

    // 虫巢副本：把世界挖成通道，基地挪到入口，玩家站在入口
    if (opts.dungeon) this._setupDungeon(opts.dungeon);

    // ---------------- 实体容器 ----------------
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.effects = [];       // 临时视觉/伤害区域（酸池、孢子云、爆炸残留）
    this.floaters = [];
    this.tamePets = [];

    // ---------------- 统计 ----------------
    this.stats = {
      kills: 0, eliteKills: 0, bossKills: 0,
      nestsDestroyed: 0, wavesSurvived: 0, wavesTotal: 0,
      goldEarned: 0, damageDealt: 0, damageTaken: 0,
      deaths: 0, baseDestroyed: 0, structuresBuilt: 0, towersBuilt: 0,
      distance: 0, propsHarvested: 0, poisLooted: 0,
      supplyDrops: 0, secondBasesBuilt: 0,
    };

    // ---------------- 城镇 ----------------
    this.population = 0;
    this.townBuildings = [];      // [{ id, type, x, y, workers }]
    this.townTier = 0;

    // ---------------- 波次 ----------------
    this.wave = {
      state: 'calm',            // calm | incoming | active | aftermath
      timer: BEACON.waveIntervalBase,
      number: 0,
      total: 0,
      remaining: 0,
      incomingAt: 0,
      composition: [],
      huntMode: false,          // 基地被毁后追杀玩家
      huntTimer: 0,
      threat: this._computeThreat(),
    };

    // 无角色模式（纯塔防）要在 wave 建好之后再收尾
    if (!this.modeDef.hasPlayer) this._setupNoPlayerMode();

    // ---------------- 系统引用（由 main.js 注入） ----------------
    this.systems = {};
    this.spatial = null;             // SpatialHash
    this.enemySystem = null;
    this.playerSystem = null;
    this.towerSystem = null;
    this.loot = null;
    this.town = null;
    this.director = null;
    this.autoRebuildQueue = [];

    this.autoCollectQueue = [];
    this.lastSupplyAt = 0;
    this.log = [];

    this.camera = null;

    /*
     * 构造末尾把属性算一次。
     *
     * 以前没有这一步，于是「角色被动」要等**第一次属性重算**才生效 ——
     * 而那通常发生在升级或解锁科技时。表现是开局那一段被动是缺的
     * （驾驶员的车更脆、生物学家的基因位少一个、工程师的建造折扣没进面板）。
     * 主循环里确实会补一次，但构造函数自己应当完备 —— 否则任何
     * 「只 new 一个 RunState 来验算」的测试测的都是残缺状态。
     */
    this.recomputeStats();
  }

  /** 关闭存档时清掉所有跨对象引用，避免内存泄漏 */
  dispose() {
    this.enemies.length = 0;
    this.projectiles.length = 0;
    this.pickups.length = 0;
    this.effects.length = 0;
    this.floaters.length = 0;
  }

  // =========================================================
  //  初始化
  // =========================================================

  _initBase() {
    const site = this.world.baseSite;
    const base = {
      id: 'base_main',
      name: '殖民地核心舱',
      x: site.x, y: site.y,
      r: 96,
      hp: BASE.maxHp, maxHp: BASE.maxHp,
      shield: 0, maxShield: 0,
      destroyed: false,
      repairProgress: 0,
      underAttack: false,
      lastAttackAt: -99,
      level: 1,
      isPrimary: true,
    };
    this.bases.push(base);
    this.base = base;
    this.world.prepareBaseArea(site.tx, site.ty);
  }

  /**
   * 纯塔防模式：没有角色。
   *
   * 做法不是「把玩家删掉」——几十处代码都在读 run.player，
   * 删掉就是满地 undefined。这里是让玩家**不存在于场上**：
   * 位置锁在基地中心、标记为 dead（所有索敌都已经会跳过 dead 的玩家），
   * 并且不允许复活。这样敌人、投射物、掉落全都不需要改。
   */
  _setupNoPlayerMode() {
    const p = this.player;
    p.x = this.base.x;
    p.y = this.base.y;
    p.lastX = p.x; p.lastY = p.y;
    p.dead = true;
    p.noRespawn = true;
    p.invuln = 0;
    p.hp = p.hpMax;
    // 载具也不该出现在阵地上
    this.vehicle.destroyed = true;
    // 怪潮直接由波次系统生成，不需要巢穴参与
    this.wave.timer = this.modeDef.wave.prepSeconds || 45;
  }

  /**
   * 进入虫巢副本：把当前世界改造成地下迷宫。
   *
   * 世界是**同一个对象**（就地改造），不是新开一张图 ——
   * 这样存档、渲染、寻路全都继续用现成的代码。
   * 基地被挪到入口当「回程点」，玩家站在基地旁边。
   */
  _setupDungeon(opts) {
    const { tier, nestId } = opts;
    const dug = carveDungeon(this.world, tier);
    /*
     * 副本局会先按「开拓模式」生成一整套地表世界（几十个巢穴 + 遗迹），
     * 然后我们再把它挖成巢道。那些巢穴/遗迹必须清掉 ——
     * 否则副本里会冒出地表世界的巢穴守卫和 Boss
     * （实测进副本后左边站着一只虚空女妖，就是这么来的）。
     */
    this.world.nests.length = 0;
    this.world.pois.length = 0;
    this.dungeon = {
      tier, nestId, plan: dug.plan,
      entry: dug.entry, playerStart: dug.playerStart, boss: dug.boss, chambers: dug.chambers,
      cleared: false,
      /** 原世界的位置（出去时用来还原） */
      returnTo: opts.returnTo || { x: dug.entry.x, y: dug.entry.y },
    };
    /*
     * 核心舱**留在外面**。
     *
     * 以前为了有个「回程点」把基地一起搬进入口大厅，玩家的原话是
     * 「不用把基地也跟我一起下来吧」—— 确实很怪：钻进虫洞的是你，不是整座殖民地。
     * 现在基地被挪到世界之外（坐标 -9999，和载具一个处理方式），
     * 副本里它不存在：不能在巢里建塔、不能修基地、指南针也不显示它。
     * 撤退改由「走回入口按 F」完成（`updateDungeonExit`，本来就已经实现了）。
     */
    for (const b of this.bases) {
      b.parkedX = b.x; b.parkedY = b.y;
      b.x = -9999; b.y = -9999;
      b.parked = true;
    }
    // 入口大厅仍然需要一个「中心点」给建造半径/地图用，但它不是基地
    this.baseSiteCenter = { x: dug.entry.x, y: dug.entry.y };
    // 吸引阵列也跟着基地留在外面：副本里它本来就不工作（director 里直接 return）
    this.beacon.x = -9999; this.beacon.y = -9999;
    const p = this.player;
    const start = dug.playerStart || dug.entry;
    p.x = start.x; p.y = start.y;
    p.lastX = p.x; p.lastY = p.y;
    /*
     * 载具留在外面。
     *
     * 副本局有自己的一份 vehicle 对象（外层的没被动过），本来不动它也不会出错，
     * 但指南针会一直指着「载具 8 米」，而那里其实什么都没有 —— 一个不会造成
     * 崩溃、却让人困惑的假目标。所以直接标记为损毁，出去时外层那份照旧。
     */
    this.vehicle.x = -9999; this.vehicle.y = -9999;
    this.vehicle.destroyed = true;

    // Boss 守在最深处的房间里
    this.dungeonBossPending = true;

    /*
     * 侧室里的收益：旗舰残骸（稀有）+ 金属堆（常见）。
     *
     * 玩家反馈「地图上的旗舰残骸太多了」。旗舰残骸是最值钱的目标
     * （5% 红装 + 一堆稀有材料），满地都是就不值钱了；现在每层最多 3 台，
     * 其余位置换成一堆堆金属废料 —— 材料照样给，但不再刷红装。
     *
     * 摆放规则：按房间轮着放，同一间房里的第 n 个按 3×3 网格错开一格，再加抖动。
     * 以前是 ch.x + (i-1)*46 —— i 一大就冲出房间，还全挤在一条线上。
     */
    const chambers = dug.chambers || [];
    const perRoom = Math.max(1, chambers.length);
    const place = (type, i, spread) => {
      const ch = chambers.length ? chambers[i % perRoom] : null;
      if (!ch) return null;
      const slot = Math.floor(i / perRoom);
      const gx = (slot % 3) - 1;
      const gy = (Math.floor(slot / 3) % 3) - 1;
      const jx = this.rng.range(-spread, spread), jy = this.rng.range(-spread, spread);
      return this.world.spawnProp(type, ch.x + gx * 92 + jx, ch.y + gy * 92 + jy);
    };
    const wreckCount = Math.min(3, dug.plan.wrecks);
    for (let i = 0; i < wreckCount; i++) place('wreckCache', i, 16);
    // 金属堆：数量随层数增长，铺在其余侧室里
    const scrapCount = 3 + Math.round(tier * 0.6);
    for (let i = 0; i < scrapCount; i++) place('metalHeap', wreckCount + i, 22);
    // Boss 房门口塞一台旗舰残骸（打 Boss 前的最后一份大礼）
    this.world.spawnProp('wreckCache', dug.boss.x - 90, dug.boss.y + 60);

    /*
     * 副本不该只有 Boss 等着你。
     *
     * 玩家要求「放一些固定数量的小怪」：数量按层数固定（不是随机的），
     * 每间侧室 1~2 只守着自己的宝物，主通道上再撒几只在巡逻。
     * 它们用 guard 逻辑（离巢 980px 内追击、超出就回原位），
     * 所以不会一路追到入口大厅把你堵死。
     */
    this.dungeonGarrison = 0;
    const perChamber = tier >= 7 ? 2 : 1;
    const corridorGuards = 2 + Math.floor(tier / 3);
    if (this.enemySystem) {
      for (const ch of chambers) {
        for (let k = 0; k < perChamber; k++) {
          const a = this.rng.next() * Math.PI * 2;
          const spot = this.world.findOpenSpot(ch.x + Math.cos(a) * 70, ch.y + Math.sin(a) * 70, 120);
          if (this.enemySystem.spawnDungeonGuard(spot.x, spot.y, tier)) this.dungeonGarrison++;
        }
      }
      for (let i = 0; i < corridorGuards; i++) {
        const tx = dug.entry.x + 320 + i * 190;
        if (tx > dug.boss.x - 120) break;
        const spot = this.world.findOpenSpot(tx, dug.entry.y + (i % 2 ? 34 : -34), 140);
        if (this.enemySystem.spawnDungeonGuard(spot.x, spot.y, tier)) this.dungeonGarrison++;
      }
    }
  }

  _computeThreat() {
    const aliveNests = this.world.nests.filter(n => !n.destroyed);
    let threat = 0;
    for (const n of aliveNests) threat += n.threat;
    // 玩家离基地越远，基地方向的压力会稍微分摊走一点
    const basePressure = threat * (0.55 + this.beacon.level * 0.09 + (this.beacon.intensity || 0));
    return { total: threat, basePressure, nests: aliveNests.length };
  }

  get threat() { return this._computeThreat(); }

  // =========================================================
  //  虫巢副本
  // =========================================================

  /**
   * 进入虫巢副本。
   *
   * 做法：**保住整个外层 RunState 对象**（它本身就是完整的存档状态），
   * 另起一个「副本局」跑到地下。这样：
   *   - 外层的一切（塔、城镇、巢穴进度、波次）原封不动；
   *   - 副本里复用全部系统，不需要第二套战斗代码；
   *   - 出来时把内层的战果（经验、金币、材料）搬回外层。
   */
  enterDungeon(nest) {
    if (this.dungeonRun) return false;      // 已经在副本里
    const tier = Math.max(1, Math.min(10, nest.tier || 1));
    const inner = new RunState({
      seed: this.seedStr + ':nest:' + nest.id,
      characterId: this.characterId,
      planetIndex: this.planetIndex,
      mode: GAME_MODE.FRONTIER,
      dungeon: {
        tier,
        nestId: nest.id,
        returnTo: { x: nest.x, y: nest.y + nest.r + 60 },
      },
    });
    inner.adoptPlayerFrom(this);
    inner.overworldRun = this;
    inner.isDungeonInner = true;
    this.dungeonRun = inner;
    bus.emit('dungeonEnter', { tier, nestId: nest.id });
    notice(`进入虫巢 · ${tier} 级`,
      tier >= 7 ? '这里的空气在震。最深处有巢穴主 —— 打不过就按 F 撤。'
        : '一条巢道通到最深处。侧室里有被拖进来的飞船残骸，值得拐进去看看。', 'warn');
    return true;
  }

  /** 从副本出来，把战果搬回外层 */
  exitDungeon(opts = {}) {
    const outer = this.overworldRun;
    if (!outer) return false;
    const cleared = !!opts.cleared;
    // 战果：金币、材料取两者较大值（内层是带着外层资源进去的）
    for (const k of Object.keys(this.resources)) {
      if ((this.resources[k] || 0) > (outer.resources[k] || 0)) outer.resources[k] = this.resources[k];
    }
    outer.gainXpFrom(this);
    if (this.player.hp < this.player.hpMax) {
      outer.player.hp = Math.max(1, Math.round(this.player.hp * 0.6));
    }
    outer.dungeonRun = null;

    const nest = outer.world.nests.find(n => n.id === this.dungeon?.nestId);
    if (nest) {
      if (cleared) {
        nest.dungeonCleared = true;
        outer.director?.destroyNest?.(nest, { silent: true });
        notice('虫巢已清剿', `${nest.name} 的核心被摧毁，这个巢穴不会再产怪了。`, 'good');
      } else {
        notice('撤退成功', '你从巢道里退了出来。巢穴还在，随时可以再来。', 'info');
      }
    }
    bus.emit('dungeonExit', { cleared });
    return true;
  }

  /** 把玩家成长从另一个 RunState 搬过来（进副本时用） */
  adoptPlayerFrom(src) {
    const p = this.player;
    const s = src.player;
    p.level = s.level;
    p.xp = s.xp;
    p.weapons = s.weapons;
    p.equipment = s.equipment;
    p.inventory = s.inventory;
    p.ammo = s.ammo;
    p.carryMax = s.carryMax;
    this.resources = { ...this.resources, ...src.resources };
    this.unlockedTech = new Set(src.unlockedTech);
    this.experiments = new Map(src.experiments);
    this.genes = src.genes.map(g => ({ ...g }));
    this.bioPoints = src.bioPoints;
    this.recomputeStats();
    p.hp = p.hpMax;
  }

  /** 把副本里赚到的经验搬回外层 */
  gainXpFrom(inner) {
    const p = this.player;
    const s = inner.player;
    // 副本里的升级同样不送实验科技（见 onLevelUp），
    // 但副本里真的挣到过的选择次数（数据方尖碑之类）要带回来
    this.pendingChoices += inner.pendingChoices || 0;
    if (s.level > p.level) {
      p.level = s.level;
      p.xp = s.xp;
    } else {
      p.xp += s.xp;
    }
    this.recomputeStats();
  }


  // =========================================================
  //  属性聚合
  // =========================================================

  /** 重新计算玩家最终属性（科技/实验/装备变动时调用） */
  recomputeStats() {
    const p = this.player;
    // 吸引阵列的半径/强度是从属性派生的，先刷新一次，保证开局就有有效值
    this.beacon.refresh(this);
    const st = new StatSet(this.charDef.base);
    st.add(this.charDef.passive);

    // 主科技树
    const effects = [];
    for (const id of this.unlockedTech) {
      const def = TECH_MAP[id];
      if (def) effects.push(def.effect);
    }
    // 实验科技
    for (const [id, lv] of this.experiments) {
      const def = EXP_MAP[id];
      if (!def) continue;
      effects.push(scaleEffect(def.effect, lv, def.kind));
    }
    // 基因缝合
    for (const g of this.genes) effects.push(scaleEffect(g.effect, g.level || 1, 'mechanic'));

    const { stats, unlocks } = foldEffects(effects);
    /*
     * 玩家要求：「驾驶员初始直接有载具」。
     *
     * 载具本来是「探索」分支第一个科技（t_vehicle0）解锁的，
     * 但驾驶员这个角色就是靠车吃饭的 —— 让他先研究「载具申请」才能上车很荒唐。
     * 这里直接把 vehicle 特性给他（不消耗研究点，也不影响其他角色）。
     */
    if (this.characterId === 'pilot') unlocks.features.add('vehicle');
    // 同理：把「载具申请」直接算作已解锁（该节点对驾驶员是隐藏的），
    // 否则远征分支里以它为前置的节点对驾驶员永远打不开。
    if (this.characterId === 'pilot') this.unlockedTech.add('t_vehicle0');
    st.add(stats);

    // 装备
    for (const item of p.equipment) {
      if (!item) continue;
      st.add(item.stats || {});
      if (item.redEffect?.effect) st.add(item.redEffect.effect);
    }
    // 载具模块
    for (const item of this.vehicle.modules) {
      if (!item) continue;
      st.add(item.stats || {});
    }

    p.statSet = st;
    p.unlocks = unlocks;

    // 派生：生命上限
    const hpMax = Math.round(this.charDef.base.hp + st.get('hpMax'));
    if (p.hpMax !== hpMax) {
      const gain = hpMax - (p.hpMax || 0);
      p.hpMax = hpMax;
      // 上限提升时补满新增部分，上限下降时按比例截断
      p.hp = clamp((p.hp || hpMax) + Math.max(0, gain), 1, hpMax);
      p._lastHpMax = hpMax;
    } else {
      p._lastHpMax = hpMax;
    }
    p.staminaMax = PCFG.staminaMax + st.get('staminaMax');

    // 基地护盾来自实验科技
    const shield = st.mechanics.baseShield;
    if (shield) {
      for (const b of this.bases) {
        b.maxShield = shield.amount || 0;
        b.shield = Math.min(b.shield || 0, b.maxShield);
      }
    }
    this.beacon.refresh(this);
    return st;
  }

  get playerStats() { return this.player.statSet; }

  // =========================================================
  //  科技
  // =========================================================

  canAfford(cost) {
    for (const [k, v] of Object.entries(cost || {})) {
      if (k === 'dna' || k === 'beaconCore') { if ((this.resources[k] || 0) < v) return false; continue; }
      if ((this.resources[k] || 0) < v) return false;
    }
    return true;
  }

  pay(cost) {
    if (!this.canAfford(cost)) return false;
    for (const [k, v] of Object.entries(cost || {})) {
      this.resources[k] = (this.resources[k] || 0) - v;
    }
    return true;
  }

  unlockTech(id) {
    const def = TECH_MAP[id];
    if (!def || this.unlockedTech.has(id)) return false;
    if (def.exclusive && def.exclusive !== this.characterId) return false;
    if (!this.canAfford(def.cost)) return false;
    // 前置检查
    for (const r of def.req || []) if (!this.unlockedTech.has(r)) return false;

    this.pay(def.cost);
    this.unlockedTech.add(id);

    // 吸引阵列等级直接生效
    if (def.effect.beaconLevel) {
      this.beacon.level = Math.min(BEACON.maxLevel, this.beacon.level + def.effect.beaconLevel);
    }
    // 解锁建筑/塔由 UI 读取 unlocks 判断
    this.recomputeStats();
    bus.emit(EV.TECH_UNLOCKED, { id, def });
    bus.emit(EV.SFX, { name: 'unlock' });
    this.addLog(`科技解锁：${def.name}`);
    return true;
  }

  /** 已解锁的防御塔列表 */
  unlockedTowers() {
    const set = new Set(this.player.unlocks.towers);
    return Object.values(TOWER_DEF).filter(t => {
      if (t.exclusive && t.exclusive !== this.characterId) return false;
      if (!t.requires) return true;
      return set.has(t.id);
    });
  }

  unlockedStructures() {
    const set = new Set(this.player.unlocks.structures);
    return set;
  }

  hasFeature(f) {
    // 纯塔防没有角色去捡东西，所以「自动收集」在这个模式里是白送的：
    // 不做这一步的话，塔防模式打完整场也拿不到任何材料。
    if (this.isTowerDefense && f === 'autoCollect') return true;
    return this.player.unlocks.features.has(f);
  }

  /**
   * 以基地为中心、允许建造的最大半径。
   * 开拓模式沿用原来的「基地 + 一段延伸」；纯塔防就是整片阵地 ——
   * 阵地有多大，塔就能铺多远，这是塔防模式的核心体验。
   */
  buildRadiusFrom(b) {
    if (this.isTowerDefense) return this.modeDef.fieldRadius || 900;
    return (b.r || 96) + 420 + this.playerStats.get('towerSlotRadius');
  }

  /** 载具能挂几座炮塔：科技给的挂架，硬上限是配置里的 maxTurrets */
  vehicleTurretCap() {
    const fromTech = this.playerStats.get('vehicleTurretCap') || 0;
    const base = 1 + fromTech;                    // 基础 1 个（驾驶员的被动另算）
    return Math.min(VCFG.maxTurrets, base);
  }

  // =========================================================
  //  实验科技
  // =========================================================

  /** 触发一次「三方向 → 四选一」 */
  grantExperimentChoice(count = 1) {
    this.pendingChoices += count;
    bus.emit('experimentPending', { count: this.pendingChoices });
  }

  /** 步骤 1：玩家选方向，生成 4 个候选 */
  rollOptions(dir) {
    const pool = poolFor(dir, this.characterId).filter(e => {
      const lv = this.experiments.get(e.id) || 0;
      return lv < (e.maxLv || 1);
    });
    if (!pool.length) {
      notice('该方向已无可用实验', '换一个方向试试', 'warn');
      return null;
    }
    // 加权抽 4 张，不重复
    const picked = [];
    const bag = pool.slice();
    for (let i = 0; i < 4 && bag.length; i++) {
      const entry = this.rng.weighted(bag.map(e => ({
        e, w: expWeight(e, this.experiments.get(e.id) || 0),
      })));
      if (!entry) break;
      picked.push(entry.id);
      swapRemove(bag, bag.indexOf(entry));
    }
    this.currentDir = dir;
    this.currentOptions = picked;
    this.refreshCount = 0;
    return picked;
  }

  /** 刷新当前候选（花费递增） */
  reroll() {
    if (!this.currentDir) return false;
    const cost = this.refreshCost();
    if (this.resources.gold < cost) { bus.emit(EV.SFX, { name: 'error' }); return false; }
    this.resources.gold -= cost;
    this.refreshCount++;
    const dir = this.currentDir;
    const saved = this.currentOptions;
    let tries = 0;
    do {
      this.rollOptions(dir);
      tries++;
    } while (tries < 6 && sameSet(saved, this.currentOptions));
    this.refreshCount = (saved ? this.refreshCount : 1);
    bus.emit(EV.SFX, { name: 'uiClick' });
    return true;
  }

  refreshCost() {
    const discount = this.playerStats.get('tradeDiscount') * 0.3
      + this.playerStats.get('experimentRefreshDiscount')
      + (this.unlockedTech.has('t_lab') ? 0.25 : 0);
    return Math.max(15, Math.round(45 * Math.pow(1.85, this.refreshCount) * (1 - clamp01(discount))));
  }

  /** 步骤 2：确认选择 */
  takeExperiment(id) {
    const def = EXP_MAP[id];
    if (!def) return false;
    if (this.pendingChoices <= 0) return false;
    const lv = (this.experiments.get(id) || 0) + 1;
    this.experiments.set(id, lv);
    this.pendingChoices = Math.max(0, this.pendingChoices - 1);
    this.currentOptions = null;
    this.currentDir = null;
    this.recomputeStats();
    bus.emit(EV.SFX, { name: 'levelup' });
    notice('实验科技', `${def.name} Lv.${lv} —— ${def.desc}`, 'good');
    this.addLog(`实验科技：${def.name} Lv.${lv}`);
    return true;
  }

  experimentLevel(id) { return this.experiments.get(id) || 0; }

  // =========================================================
  //  经验与等级
  // =========================================================

  xpNeeded(level) {
    // 实验科技给得太快，玩家十几分钟就能吃满一轮 —— 这里把需求整体抬高，
    // 让「升级 → 四选一」重新变成一个需要争取的事件。
    return Math.round(ECON.levelBase * ECON.xpScale * Math.pow(ECON.levelGrowth, level - 1));
  }

  gainXp(amount) {
    const p = this.player;
    const mult = 1 + p.statSet.get('xpMult');
    const gain = Math.max(0, amount * mult);
    p.xp += gain;
    bus.emit(EV.XP, { amount: gain, x: p.x, y: p.y });
    let leveled = 0;
    while (p.xp >= this.xpNeeded(p.level)) {
      p.xp -= this.xpNeeded(p.level);
      p.level++;
      leveled++;
    }
    if (leveled) this.onLevelUp(leveled);
    return leveled;
  }

  onLevelUp(count) {
    const p = this.player;
    /*
     * 升级**不再**直接送实验科技选择。
     *
     * 以前是「升一级 = 一次四选一」，于是工程师一场下来能攒出二十多次选择
     * （截图里那个「获得 25 次实验科技选择」就是这个）。现在实验科技的主要来源
     * 是「每打完一波怪潮给 1 次」（director.endWave），升级给的是生命与属性。
     */
    p.hp = Math.min(p.hpMax, p.hp + p.hpMax * 0.15 * count);
    bus.emit(EV.LEVEL_UP, { level: p.level, count });
    bus.emit(EV.SFX, { name: 'levelup' });
    notice('升级！', `${this.charDef.name} 达到 ${p.level} 级，生命上限与回复提升。实验科技靠打退怪潮获得（每波 1 次）。`, 'good');
  }

  // =========================================================
  //  资源
  // =========================================================

  addResource(kind, amount, opts = {}) {
    if (!amount) return 0;
    const p = this.player;
    let mult = 1;
    if (!opts.raw) {
      if (kind === 'gold') mult = 1 + p.statSet.get('goldMult');
      else if (kind === 'metal' || kind === 'crystal' || kind === 'parts') mult = 1 + p.statSet.get('matMult');
    }
    const gain = amount * mult;
    const cap = this.storageCap[kind];
    const before = this.resources[kind] || 0;
    let next = before + gain;
    if (cap != null && !opts.ignoreCap) next = Math.min(cap, next);
    this.resources[kind] = next;
    const delta = next - before;
    if (delta > 0 && kind === 'gold') this.stats.goldEarned += delta;
    return delta;
  }

  spend(kind, amount) {
    if ((this.resources[kind] || 0) < amount) return false;
    this.resources[kind] -= amount;
    return true;
  }

  // =========================================================
  //  基地
  // =========================================================

  addBase(x, y, isPrimary = false) {
    const spot = this.world.findOpenSpot(x, y, 140);
    const base = {
      id: 'base_' + nextId(),
      name: isPrimary ? '殖民地核心舱' : '第二基地',
      x: spot.x, y: spot.y,
      r: 96,
      hp: BASE.maxHp * 0.8, maxHp: BASE.maxHp * 0.8,
      shield: 0, maxShield: this.playerStats.mechanics.baseShield?.amount || 0,
      destroyed: false, repairProgress: 0, underAttack: false, lastAttackAt: -99,
      level: 1, isPrimary: false,
    };
    this.bases.push(base);
    if (!isPrimary) {
      this.world.secondaryBases = this.bases.filter(b => !b.isPrimary).map(b => ({ x: b.x, y: b.y, tx: Math.floor(b.x / TILE), ty: Math.floor(b.y / TILE) }));
      this.world.prepareBaseArea(Math.floor(base.x / TILE), Math.floor(base.y / TILE));
      this.stats.secondBasesBuilt++;
      notice('第二基地建立', '你可以在这里独立建造与防守，共享人口与科技。', 'good');
    }
    return base;
  }

  /** 玩家背包里能用来自动修理的材料量 */
  repairMaterials() { return this.resources.metal; }

  damageBase(base, amount, source = null) {
    if (base.destroyed) return;
    // 先扣护盾
    if (base.shield > 0) {
      const absorbed = Math.min(base.shield, amount);
      base.shield -= absorbed;
      amount -= absorbed;
      if (amount <= 0) return;
    }
    base.hp -= amount;
    base.underAttack = true;
    base.lastAttackAt = this.time;
    if (base.hp <= 0) {
      base.hp = 0;
      this.destroyBase(base);
    }
  }

  destroyBase(base) {
    if (base.destroyed) return;
    base.destroyed = true;
    base.hp = 0;
    this.stats.baseDestroyed++;
    // 人口全灭
    const lost = this.population;
    this.population = 0;
    for (const b of this.townBuildings) b.workers = 0;
    // 范围内建筑受损
    for (const s of this.structures) {
      if (dist(s.x, s.y, base.x, base.y) < base.r * 3) s.hp = Math.max(1, s.hp * 0.25);
    }
    for (const t of this.towers) {
      if (dist(t.x, t.y, base.x, base.y) < base.r * 3) t.hp = Math.max(1, t.hp * 0.25);
    }
    this.beacon.online = false;
    /*
     * 基地被打爆 = 核心舱没了 = 不再吸引。
     * 玩家要的正是这个：怪不再被牵引，而是直接冲你而来（追杀模式）。
     */
    this.director?.startHunt?.('base');
    this.wave.huntMode = true;
    this.wave.huntReason = 'base';
    this.wave.huntTimer = BASE.alarmWaveGap;

    bus.emit(EV.BASE_DESTROYED, { base, lost });
    bus.emit(EV.SFX, { name: 'baseAlarm' });
    notice('基地被摧毁！', `${base.name} 陷落，${lost} 名殖民者死亡。吸引阵列离线 —— 现在所有怪潮都会冲你而来。`, 'danger');
    this.addLog(`基地陷落，损失人口 ${lost}`);
  }

  /** 基地是否处于「已毁待重建」状态 */
  get baseRuined() { return this.bases.some(b => b.destroyed); }

  /**
   * 玩家站在旁边按住 E，维修一座受损的防御塔 / 建筑。
   *
   * 为什么要有这一条：以前「修塔」只能靠【维修套件】（道具）或【自动维修坞】（科技），
   * 玩家在语音里问的就是「我不知道需要按什么维修防御塔」。
   * 现在和修基地一样：站过去按住 E，按金属消耗逐点回耐久，速度吃维修类科技。
   */
  repairStructureAt(target, dt) {
    if (!target) return false;
    const maxHp = target.maxHp || target.def?.hp || 0;
    if (!(maxHp > 0) || target.hp >= maxHp) return false;
    const p = this.player;
    const rate = 30 * (1 + p.statSet.get('repairMult'));
    const costPerHp = 0.28 * (1 + p.statSet.get('repairCostMult')) * (1 + p.statSet.get('buildCostMult'));
    const heal = Math.min(rate * dt, maxHp - target.hp);
    const cost = heal * costPerHp;
    if (this.resources.metal < cost) return false;
    this.resources.metal -= cost;
    target.hp = Math.min(maxHp, target.hp + heal);
    target.repairFlash = 1;      // 渲染层用来画一圈绿光，让「正在修」看得见
    return true;
  }

  /** 玩家附近（range 内）最该修的那个目标：优先血最少的 */
  nearestRepairable(x, y, range = 76) {
    let best = null, bestScore = Infinity;
    const consider = (t, label) => {
      const maxHp = t.maxHp || t.def?.hp || 0;
      if (!(maxHp > 0) || t.destroyed || t.hp >= maxHp) return;
      const d = dist(x, y, t.x, t.y);
      if (d > range) return;
      const score = d + (t.hp / maxHp) * 40;      // 越近、越破的优先
      if (score < bestScore) { bestScore = score; best = { target: t, label, d, maxHp }; }
    };
    for (const t of this.towers) consider(t, t.def?.name || '防御塔');
    for (const s of this.structures) consider(s, s.def?.name || '工事');
    for (const b of this.townBuildings) consider(b, TOWN_BUILDING_DEF[b.type]?.name || '建筑');
    return best;
  }

  /**
   * 开始换弹。
   *
   * 两条触发路径共用这里：
   *   - 打空了自动换（玩家不用记 R 键，这是玩家明确要的）
   *   - 手动按 R（可以提前换，打完这波再说）
   * 换弹时间 = 武器基准 × 品质折扣（见 weapons.reloadTimeOf）。
   */
  beginReload(auto = false) {
    const p = this.player;
    const ammoMax = p.ammoMax || PCFG.ammoMax;
    if (p.reloading > 0) return false;
    if (p.ammo >= ammoMax) {
      if (!auto) notice('弹药充足', `弹药已经满了（${p.ammo}/${ammoMax}）。`, 'info');
      return false;
    }
    const w = p.weapons[p.weaponIndex];
    const def = w?.def;
    const time = reloadTimeOf(def, w?.rarity);
    const st = p.statSet;
    const need = ammoMax - p.ammo;
    const costMult = 1 + (st.get('ammoCostMult') || 0);
    const cost = { metal: Math.ceil(need * 0.12 * costMult), sulfur: Math.ceil(need * 0.05 * costMult) };

    // 有「弹药合成」实验：现场用材料造，瞬间补满
    if (st.get('ammoCraft')) {
      if (!this.canAfford(cost)) {
        if (!auto) notice('材料不足', `装填需要 ${costText(cost)}`, 'warn');
        return false;
      }
      this.pay(cost);
      p.ammo = ammoMax;
      p._ammoFrac = 0;
      p.reloadPending = false;
      notice('现场合成弹药', `消耗 ${costText(cost)}，弹药补满（${ammoMax}）。`, 'good');
      bus.emit(EV.SFX, { name: 'build' });
      return true;
    }

    if (!this.spend('metal', cost.metal)) {
      notice('金属不足', `换弹需要金属 ${cost.metal} —— 打怪也会掉子弹，先把这一波清完。`, 'warn');
      return false;
    }
    p.reloading = time;
    p.reloadTotal = time;
    p.reloadPending = true;
    p.reloadAuto = !!auto;
    if (!auto) notice('换弹中', `${time.toFixed(2)} 秒后补满到 ${ammoMax} 发。`, 'info');
    return true;
  }

  /** 玩家在基地附近时手动维修（含重建） */
  repairAtBase(base, dt) {
    if (!base) return;
    // 优先修废墟：基地被毁时一定先重建，再谈修耐久
    if (!base.destroyed) {
      const ruined = this.bases.find(b => b.destroyed && dist(b.x, b.y, base.x, base.y) < 260);
      if (ruined) { this._rebuildStep(ruined, dt); return; }
    }
    const p = this.player;
    const rate = BASE.repairRate * (1 + p.statSet.get('repairMult'));
    const costMult = BASE.repairCostPerHp * (1 + p.statSet.get('repairCostMult')) * (1 + p.statSet.get('buildCostMult'));

    if (base.destroyed) {
      this._rebuildStep(base, dt);
      return;
    }
    if (base.hp >= base.maxHp) return;
    const heal = rate * dt;
    const cost = heal * costMult;
    if (this.resources.metal < cost) return;
    this.resources.metal -= cost;
    base.hp = Math.min(base.maxHp, base.hp + heal);
  }

  /** 重建废墟的一步 */
  _rebuildStep(base, dt) {
    const p = this.player;
    const speed = 1 + p.statSet.get('buildSpeed');
    const costMult = BASE.repairCostPerHp * (1 + p.statSet.get('buildCostMult'));
    const cost = 12 * Math.max(0.2, costMult) * dt * speed;
    if (this.resources.metal < cost) return false;
    this.resources.metal -= cost;
    // 按住 E 逐帧推进；另外每次「点一下」也直接给一小块进度
    // （玩家反馈：点着没反应，而按住 45 秒又太像坏了）
    base.repairProgress += dt * speed;
    if (base.repairProgress >= BASE.rebuildTime) {
      base.destroyed = false;
      base.repairProgress = 0;
      base.hp = base.maxHp * 0.3;
      this.beacon.online = true;
      this.director?.stopHunt?.('base');
      this.wave.huntMode = false;
      this.wave.huntReason = null;
      this._syncBlockedTiles();
      this.enemySystem?.invalidateFlow();
      bus.emit(EV.REPAIR_DONE, { base });
      notice('基地重建完成', '核心舱恢复运转，吸引阵列重新上线 —— 虫群又被牵引回来了。', 'good');
    }
    return true;
  }

  /**
   * 「点一下 E」也推进重建。
   * 玩家不会一直按住不放；一次按下给一小块进度，手感立刻有反馈。
   */
  tapRebuild(base) {
    if (!base || !base.destroyed) return false;
    const costMult = BASE.repairCostPerHp * (1 + this.player.statSet.get('buildCostMult'));
    const cost = (BASE.rebuildPerTap || 0.5) * 6 * Math.max(0.2, costMult);
    if (this.resources.metal < cost) return false;
    this.resources.metal -= cost;
    base.repairProgress += (BASE.rebuildPerTap || 0.5);
    if (base.repairProgress >= BASE.rebuildTime) this._rebuildStep(base, 0.0001);
    return true;
  }

  // =========================================================
  //  日志
  // =========================================================

  addLog(text) {
    this.log.push({ t: this.time, text });
    if (this.log.length > 120) this.log.shift();
  }

  // =========================================================
  //  存档
  // =========================================================

  serialize() {
    const p = this.player;
    return {
      seedStr: this.seedStr,
      planetIndex: this.planetIndex,
      planetClaimed: this.planetClaimed,
      claimedPlanets: this.claimedPlanets,
      time: this.time, playTime: this.playTime, day: this.day,
      characterId: this.characterId,
      mode: this.mode,
      resources: this.resources,
      storageCap: this.storageCap,
      unlockedTech: Array.from(this.unlockedTech),
      experiments: Array.from(this.experiments.entries()),
      pendingChoices: this.pendingChoices,
      bioPoints: this.bioPoints,
      genes: this.genes.map(g => ({ id: g.id, level: g.level || 1 })),
      world: this.world.serialize(),
      player: p.serialize(),
      vehicle: this.vehicle.serialize(),
      bases: this.bases.map(b => ({
        id: b.id, name: b.name, x: b.x, y: b.y,
        // r 一定要存！漏了它，读档后 base.r 是 undefined，
        // `dist < b.r + 40` 就是 NaN 比较 → 永远 false →
        // 「按 E 重建 / 维修核心舱」完全没反应（玩家就是这么报的）。
        r: b.r,
        hp: b.hp, maxHp: b.maxHp,
        shield: b.shield, maxShield: b.maxShield,
        destroyed: b.destroyed, repairProgress: b.repairProgress, level: b.level, isPrimary: b.isPrimary,
      })),
      towers: this.towers.map(t => t.serialize()),
      structures: this.structures.map(s => s.serialize()),
      beacon: this.beacon.serialize(),
      population: this.population,
      townBuildings: this.townBuildings,
      townTier: this.townTier,
      wave: {
        state: this.wave.state, timer: this.wave.timer, number: this.wave.number,
        huntMode: this.wave.huntMode, lastSupplyAt: this.lastSupplyAt,
      },
      stats: this.stats,
      log: this.log.slice(-40),
      tamePets: this.tamePets.map(t => t.serialize?.() ?? null).filter(Boolean),
    };
  }

  /** 从存档数据恢复（保持对象引用） */
  restore(data) {
    this.rng = new RNG(data.seedStr + ':restore:' + Math.floor(data.time || 0));
    this.seedStr = data.seedStr ?? this.seedStr;
    this.planetClaimed = !!data.planetClaimed;
    this.claimedPlanets = data.claimedPlanets || [];
    this.time = data.time || 0;
    this.playTime = data.playTime || 0;
    this.day = data.day || 1;

    // 模式必须在世界/玩家恢复之前定好：后面很多分支都看它
    if (data.mode) {
      this.mode = data.mode;
      this.modeDef = modeDef(this.mode);
      this.isTowerDefense = this.mode === GAME_MODE.TOWER_DEFENSE;
      this.world.mode = this.mode;
    }

    if (data.resources) this.resources = { ...this.resources, ...data.resources };
    if (data.storageCap) this.storageCap = { ...this.storageCap, ...data.storageCap };

    this.unlockedTech = new Set(data.unlockedTech || []);
    this.experiments = new Map(data.experiments || []);
    this.pendingChoices = data.pendingChoices || 0;
    this.bioPoints = data.bioPoints || 0;
    this.genes = (data.genes || []).map(g => {
      const src = GENE_BY_ID[g.id];
      return src ? { ...src, level: g.level || 1 } : null;
    }).filter(Boolean);

    this.world.restore(data.world || {});
    this.baseSiteCenter = { x: this.world.baseSite.x, y: this.world.baseSite.y };

    this.player.restore(data.player || {});
    // 无角色模式：player.restore 会把 dead 恢复成默认的 false，
    // 这里必须重新压回去，否则读档后「死掉的玩家」会复活在基地里
    if (!this.modeDef.hasPlayer) {
      this.player.dead = true;
      this.player.noRespawn = true;
      this.player.x = this.base?.x ?? this.player.x;
      this.player.y = this.base?.y ?? this.player.y;
      this.vehicle.destroyed = true;
    }
    this.vehicle.restore(data.vehicle || {});
    this.population = data.population || 0;
    this.townBuildings = data.townBuildings || [];
    this.townTier = data.townTier || 0;

    // 基地
    // 旧存档里没有 r（那时候没存），统一补一个默认值 ——
    // 否则读档后核心舱的交互半径是 NaN，按 E 什么都不会发生。
    this.bases = (data.bases || []).map(b => ({ ...b, r: b.r || 96 }));
    this.base = this.bases.find(b => b.isPrimary) || this.bases[0];

    // 吸引阵列
    this.beacon.restore(data.beacon || {});

    // 防御塔与建筑
    this.towers = [];
    for (const t of data.towers || []) {
      const tower = createTower(this, t.type, t.x, t.y, { instant: true, level: t.level });
      if (!tower) continue;
      Object.assign(tower, { hp: t.hp, id: t.id, kills: t.kills || 0, manual: false, cd: 0 });
      this.towers.push(tower);
    }
    this.structures = [];
    for (const s of data.structures || []) {
      const st = createStructure(this, s.type, s.x, s.y, { instant: true });
      if (!st) continue;
      Object.assign(st, { hp: s.hp, id: s.id, workers: s.workers || 0 });
      this.structures.push(st);
    }
    this._syncBlockedTiles();

    if (data.wave) {
      Object.assign(this.wave, data.wave);
      this.wave.composition = [];
      this.wave.remaining = 0;
    }
    this.lastSupplyAt = data.lastSupplyAt || 0;
    if (data.stats) this.stats = { ...this.stats, ...data.stats };
    this.log = data.log || [];

    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.effects = [];
    this.floaters = [];
    this.tamePets = [];

    this.recomputeStats();
    this.player.hp = clamp(this.player.hp, 1, this.player.hpMax);
  }

  /**
   * 摧毁一座塔或建筑。处理实验科技带来的死亡效果与自动重建。
   */
  destroyBuilding(b) {
    if (!b || b.dead) return;
    b.dead = true;
    b.hp = 0;
    const st = this.playerStats;

    if (b.kind === 'tower') {
      const i = this.towers.indexOf(b);
      if (i >= 0) swapRemove(this.towers, i);
      bus.emit(EV.TOWER_DESTROYED, { tower: b });
      bus.emit(EV.SFX, { name: 'explode' });
      // 自爆协议
      const boom = st.mechanics.towerExplodeOnDeath;
      if (boom) {
        this.effects.push({ kind: 'nova', x: b.x, y: b.y, r: boom.radius, life: 0.5, maxLife: 0.5, color: '#ff9a4c' });
        for (const e of this.spatial.query(b.x, b.y, boom.radius)) {
          if (e.kind !== 'enemy' || e.dead) continue;
          this.enemySystem.damage(e, boom.dmg, { source: 'towerExplode' });
        }
        bus.emit(EV.SCREEN_SHAKE, { mag: 6, time: 0.35 });
      }
      // 复仇协议：其余塔获得永久加成（塔的属性，不是玩家武器那套）
      const veng = st.mechanics.vengeance;
      if (veng) {
        for (const t of this.towers) {
          t.vengeanceBonus = (t.vengeanceBonus || 0) + (veng.towerDamage || 0);
          t.vengeanceRate = (t.vengeanceRate || 0) + (veng.towerAttackSpeed || 0);
        }
      }
      // 自动重建
      if (this.hasFeature('airDropAuto')) {
        this.autoRebuildQueue.push({ type: b.type, x: b.x, y: b.y, at: this.time + 6 });
      }
    } else {
      const i = this.structures.indexOf(b);
      if (i >= 0) swapRemove(this.structures, i);
      bus.emit(EV.STRUCTURE_DAMAGED, { structure: b, destroyed: true });
      bus.emit(EV.SFX, { name: 'explode', volume: 0.5 });
    }
    this._syncBlockedTiles();
    this.enemySystem?.invalidateFlow();
  }

  /** 建筑占位同步到寻路网格 */
  _syncBlockedTiles() {
    const { blocked, w, h } = this.world;
    blocked.fill(0);
    for (const s of this.structures) {
      if (!s.blocks) continue;
      const tx = Math.floor(s.x / TILE), ty = Math.floor(s.y / TILE);
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      blocked[ty * w + tx] = 1;
    }
    // 基地核心也占位（避免敌人和建筑重叠）
    for (const b of this.bases) {
      if (b.destroyed) continue;
      const tx = Math.floor(b.x / TILE), ty = Math.floor(b.y / TILE);
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      blocked[ty * w + tx] = 1;
    }
  }
}

// =========================================================
//  工厂函数
// =========================================================

function expWeight(exp, level) {
  const rarityW = { common: 100, rare: 46, epic: 17, legend: 4 }[exp.rarity] ?? 50;
  return (rarityW * (exp.weight / 100)) / (1 + level * 0.85);
}

function scaleEffect(effect, level, kind) {
  if (level <= 1) return effect;
  const out = {};
  for (const k of Object.keys(effect)) {
    const v = effect[k];
    if (typeof v === 'number') {
      // 数值型：按等级线性叠加；概率型（<1 且是比率）用递减叠加
      if (v > 0 && v < 1 && !MULT_KEYS.has(k)) out[k] = v * level;
      else if (v > 0 && v < 1) out[k] = v * level;
      else out[k] = v * level;
    } else if (v && typeof v === 'object') {
      out[k] = scaleMechanic(v, level);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const MULT_KEYS = new Set(['damage', 'attackSpeed', 'speedMult', 'goldMult', 'xpMult', 'matMult',
  'towerDamage', 'towerAttackSpeed', 'critChance', 'critMult', 'hpMax', 'armor']);

function scaleMechanic(obj, level) {
  const out = { ...obj };
  for (const k of ['mult', 'dmg', 'dps', 'amount', 'radius', 'chains', 'regen']) {
    if (typeof out[k] === 'number') {
      // 范围/连锁按较小的斜率成长，避免机制爆炸
      const slope = (k === 'radius' || k === 'chains') ? 0.12 : 0.55;
      out[k] = out[k] * (1 + slope * (level - 1));
    }
  }
  return out;
}

function sameSet(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const s = new Set(a);
  return b.every(x => s.has(x));
}

const GENE_BY_ID = Object.fromEntries(GENE_DEF.map(g => [g.id, g]));

// ---------------- 玩家 ----------------

export function createPlayer(run) {
  const def = CHAR_DEF[run.characterId];
  const site = run.world.baseSite;
  const p = {
    id: nextId(),
    charId: run.characterId,
    name: def.name,
    x: site.x + TILE * 4,
    y: site.y,
    r: 15,
    facing: 0,
    hp: def.base.hp,
    hpMax: def.base.hp,
    _lastHpMax: def.base.hp,
    xp: 0,
    level: 1,
    stamina: PCFG.staminaMax,
    staminaMax: PCFG.staminaMax,
    dodgeTimer: 0,
    dodgeCd: 0,
    invuln: 0,
    dead: false,
    respawnTimer: 0,
    inVehicle: false,
    // 战斗
    weapons: [],
    weaponIndex: 0,
    attackCd: 0,
    ammo: PCFG.ammoStart,
    ammoMax: PCFG.ammoMax,
    _ammoFrac: 0,          // 不足 1 发的零头（等离子 0.15/发），保证弹药永远是整数
    reloading: 0,
    reloadPending: false,  // 这次装填结束后要不要补满（区分「按 R 装填」与「空仓干等」）
    // 背包与装备
    inventory: [],
    equipment: [null, null, null, null, null],   // 头盔 / 胸甲 / 护腿 / 饰品 / 饰品
    carryUsed: 0,
    carryMax: 90,
    // 状态
    statuses: new Map(),   // name -> { remain, ... }
    statSet: new StatSet(def.base),
    unlocks: { towers: new Set(), structures: new Set(), features: new Set(), meleeModules: new Set() },
    lastDamageAt: -99,
    killsSinceFrenzy: 0,
    frenzyUntil: 0,
    // 统计
    distanceWalked: 0,
    lastX: site.x + TILE * 4,
    lastY: site.y,
  };
  /*
   * 玩家要求：「驾驶员初始直接有载具」。
   *
   * 注意这里要在**创建时**就给，不能只写在 recomputeStats 里 ——
   * 构造流程并不会调 recomputeStats，只有第一次属性重算之后驾驶员才拿得到车。
   * 两处都写：创建时立刻生效，重算时也不会被覆盖掉。
   */
  if (run.characterId === 'pilot') p.unlocks.features.add('vehicle');
  // 初始武器
  const starter = WEAPON_DEF[def.startWeapon];
  if (starter) p.weapons.push(makeWeaponInstance(starter.id, 'common'));

  // 初始护甲：开局就穿一件白色简易护甲（胸甲槽 = 1）。
  // 「角色装备护甲」这条线要从第一分钟就成立，否则玩家根本不知道有护甲这回事。
  const starterArmor = makeEquipInstance('fieldJacket', 'common');
  if (starterArmor) p.equipment[1] = starterArmor;

  // ---------------- 存档 ----------------
  p.serialize = function serializePlayer() {
    return {
      x: Math.round(this.x), y: Math.round(this.y),
      facing: this.facing,
      hp: Math.round(this.hp), xp: Math.round(this.xp), level: this.level,
      stamina: Math.round(this.stamina),
      ammo: Math.round(this.ammo),
      weaponIndex: this.weaponIndex,
      weapons: this.weapons.map(serializeItem),
      equipment: this.equipment.map(serializeItem),
      inventory: this.inventory.map(serializeItem),
      carryMax: this.carryMax,
      carryUsed: this.carryUsed,
      distanceWalked: this.distanceWalked,
      frenzyUntil: this.frenzyUntil || 0,
    };
  };

  p.restore = function restorePlayer(d) {
    if (!d) return;
    this.x = d.x ?? this.x;
    this.y = d.y ?? this.y;
    this.lastX = this.x; this.lastY = this.y;
    this.facing = d.facing ?? 0;
    this.hp = d.hp ?? this.hp;
    this.xp = d.xp ?? 0;
    this.level = d.level ?? 1;
    this.stamina = d.stamina ?? PCFG.staminaMax;
    this.ammo = Math.round(d.ammo ?? PCFG.ammoStart);
    this.weaponIndex = d.weaponIndex ?? 0;
    if (Array.isArray(d.weapons) && d.weapons.length) this.weapons = d.weapons.map(deserializeItem).filter(Boolean);
    if (Array.isArray(d.equipment)) {
      /*
       * 槽位从 4 格扩到 5 格（头盔/胸甲/护腿 + 两个饰品）。
       * 旧存档是 [护甲, 饰品1, 饰品2, 备用]，直接按新下标读会把饰品穿到腿上 ——
       * 4 格及以下一律按旧布局迁移。
       */
      const old = d.equipment.length <= 4;
      this.equipment = [null, null, null, null, null];
      d.equipment.forEach((it, i) => {
        const item = deserializeItem(it);
        if (!item) return;
        if (old) {
          const legacy = [null, 1, 3, 4][i];    // 旧 0(护甲)->1(胸甲)，1/2 -> 3/4(饰品)
          if (legacy != null) this.equipment[legacy] = item;
        } else if (i < 5) {
          this.equipment[i] = item;
        }
      });
    }
    if (Array.isArray(d.inventory)) this.inventory = d.inventory.map(deserializeItem).filter(Boolean);
    this.carryMax = d.carryMax ?? this.carryMax;
    this.carryUsed = d.carryUsed ?? 0;
    this.distanceWalked = d.distanceWalked ?? 0;
    this.frenzyUntil = d.frenzyUntil ?? 0;
    this.dead = false;
    this.inVehicle = false;
    this.dodgeTimer = 0;
    this.dodgeCd = 0;
    this.invuln = 2;
    this.statuses.clear();
  };

  return p;
}

// ---------------- 物品序列化 ----------------

export function serializeItem(it) {
  if (!it) return null;
  return {
    uid: it.uid,
    type: it.type,
    weaponId: it.weaponId,
    equipId: it.equipId,
    name: it.name,
    baseName: it.baseName,
    slot: it.slot,
    rarity: it.rarity,
    affixes: it.affixes,
    redEffect: it.redEffect || null,
    stats: it.stats,
    desc: it.desc,
    icon: it.icon,
  };
}

export function deserializeItem(d) {
  if (!d) return null;
  // 旧存档里的 legendary 已并入红色档；不迁移的话它在 RARITY_ORDER 里查不到，
  // 会被算成 0 分装备（评分/负重全乱），而且前缀查表也拿不到名字。
  const rarity = d.rarity === 'legendary' ? 'relic' : (d.rarity || 'common');
  if (d.type === 'weapon') {
    const def = WEAPON_DEF[d.weaponId];
    if (!def) return null;
    return {
      uid: d.uid, type: 'weapon', weaponId: d.weaponId, name: d.name || def.name,
      rarity, affixes: d.affixes || [], redEffect: d.redEffect || null,
      stats: d.stats || {}, def,
    };
  }
  const base = d.equipId ? EQUIP_DEF[d.equipId] : null;
  return {
    uid: d.uid, type: 'equip', equipId: d.equipId,
    name: d.name || base?.name || '装备',
    baseName: d.baseName || base?.name,
    slot: d.slot || base?.slot,
    rarity,
    affixes: d.affixes || [],
    redEffect: d.redEffect || null,
    stats: d.stats || { ...(base?.stats || {}) },
    desc: d.desc || base?.desc,
    icon: d.icon || base?.icon || '💠',
  };
}

export function makeWeaponInstance(weaponId, rarity = 'common', affixes = null) {
  const def = WEAPON_DEF[weaponId];
  if (!def) return null;
  return {
    uid: 'w' + nextId(),
    type: 'weapon',
    weaponId,
    name: def.name,
    rarity,
    affixes: affixes || [],
    redEffect: null,          // 红色品质的特殊效果，由 loot 生成时填
    stats: {},
    def,
  };
}

/**
 * 造一件护甲 / 饰品实例。
 * 红色品质会额外带一条特殊效果（redEffect）。
 */
export function makeEquipInstance(equipId, rarity = 'common', affixes = null) {
  const def = EQUIP_DEF[equipId];
  if (!def) return null;
  return {
    uid: 'e' + nextId(),
    type: 'equip',
    equipId,
    name: def.name,
    baseName: def.name,
    slot: def.slot,
    rarity,
    affixes: affixes || [],
    redEffect: null,
    stats: { ...(def.stats || {}) },
    desc: def.desc,
    icon: def.icon || '💠',
  };
}

// ---------------- 载具悬挂近战模块 ----------------

/**
 * 车头 / 车侧能装的近战模块。
 *
 * 设计意图：给「撞击」这条线一点成长空间，但**不**把它做成第二条武器系统。
 * 模块只加撞击伤害（和一点附加效果），不吃攻速、不吃弹药，
 * 所以它永远是「顺路碾过去」的补充，而不是替代塔或枪。
 * 上限 1 个（见 VEHICLE.maxMeleeModules）：装撞角还是装电锯是个取舍。
 */
export const VEHICLE_MELEE = {
  plow: {
    id: 'plow', kind: 'plow', name: '破障撞角', icon: '◤',
    damage: 14, desc: '撞击伤害 +14，把普通虫群整片推开。',
  },
  saw: {
    id: 'saw', kind: 'saw', name: '旋切电锯', icon: '⚔',
    damage: 30, bleed: { dps: 8, dur: 3 }, desc: '撞击伤害 +30，并让被撞到的怪持续流血 3 秒。',
  },
};

// ---------------- 载具 ----------------

export function createVehicle(run) {
  const site = run.world.baseSite;
  const def = CHAR_DEF[run.characterId];
  const pilot = run.characterId === 'pilot';
  const baseHp = 400 * (def.passive.vehicleHpMult || 1);
  const v = {
    id: nextId(),
    name: pilot ? '游隼-7 侦察车' : '拓荒运输车',
    x: site.x + TILE * 7,
    y: site.y + TILE * 3,
    r: 24,
    hp: baseHp,
    hpMax: baseHp,
    fuel: VCFG.fuelMax,
    fuelMax: VCFG.fuelMax,
    speed: VCFG.baseSpeed,
    angle: -Math.PI / 2,
    moving: false,
    occupied: false,
    mounted: [],           // 车载武器实例（最多 VEHICLE.maxTurrets 个）
    meleeModule: null,     // 悬挂近战模块（撞角 / 电锯），影响撞击伤害
    modules: [null, null, null],
    cargo: {},
    cargoUsed: 0,
    ramCd: 0,
    pinned: 0,             // 被精英怪别住的剩余时间
    pinnedBy: null,
    beacon: null,          // 便携吸引装置
    destroyed: false,
  };

  v.serialize = function serializeVehicle() {
    return {
      name: this.name,
      x: Math.round(this.x), y: Math.round(this.y),
      angle: this.angle,
      hp: Math.round(this.hp), hpMax: Math.round(this.hpMax),
      fuel: Math.round(this.fuel), fuelMax: this.fuelMax,
      mounted: this.mounted.map(serializeItem),
      meleeModule: this.meleeModule || null,
      modules: this.modules.map(serializeItem),
      beacon: this.beacon ? { radius: this.beacon.radius, intensity: this.beacon.intensity } : null,
      destroyed: this.destroyed,
    };
  };

  v.restore = function restoreVehicle(d) {
    if (!d) return;
    this.name = d.name || this.name;
    const spot = run.world.findOpenSpot(d.x ?? this.x, d.y ?? this.y, 160);
    this.x = spot.x; this.y = spot.y;
    this.angle = d.angle ?? this.angle;
    this.hpMax = d.hpMax ?? this.hpMax;
    this.hp = d.hp ?? this.hpMax;
    this.fuelMax = d.fuelMax ?? this.fuelMax;
    this.fuel = d.fuel ?? this.fuelMax;
    this.destroyed = !!d.destroyed;
    if (Array.isArray(d.mounted)) this.mounted = d.mounted.map(deserializeItem).filter(Boolean);
    this.meleeModule = d.meleeModule || null;
    if (Array.isArray(d.modules)) {
      this.modules = [null, null, null];
      d.modules.forEach((m, i) => { if (i < 3) this.modules[i] = deserializeItem(m); });
    }
    this.beacon = d.beacon ? { radius: d.beacon.radius || 700, intensity: d.beacon.intensity || 0.35 } : null;
    this.moving = false;
    this.ramCd = 0;
    this.pinned = 0;
    this.pinnedBy = null;
  };

  return v;
}

// ---------------- 吸引阵列 ----------------

export function createBeacon(run) {
  const site = run.world.baseSite;
  return {
    x: site.x, y: site.y,
    level: 0,
    fuel: BEACON.fuelMax,
    fuelMax: BEACON.fuelMax,
    online: true,
    radius: BEACON.baseRadius,
    intensity: BEACON.baseIntensity,
    pulse: 0,
    serialize() {
      // x/y 也要存：吸引阵列现在长在核心舱上，读档后必须知道它在哪，
      // 否则 startWave 里的 `dist(nest, b) <= b.radius` 全是 NaN 比较 →
      // 「范围内的巢穴」一个都选不出来，整波怪只剩一个巢贡献。
      return { x: this.x, y: this.y, level: this.level, fuel: this.fuel, fuelMax: this.fuelMax, online: this.online };
    },
    restore(d) {
      if (Number.isFinite(d.x) && Number.isFinite(d.y)) { this.x = d.x; this.y = d.y; }
      this.level = d.level ?? 0;
      this.fuel = d.fuel ?? BEACON.fuelMax;
      this.fuelMax = d.fuelMax ?? BEACON.fuelMax;
      this.online = d.online !== false;
    },
    /** 重新计算半径与强度 */
    refresh(run) {
      const st = run.playerStats;
      this.radius = (BEACON.baseRadius + this.level * BEACON.radiusPerLevel)
        * (1 + st.get('beaconRadiusMult'));
      this.intensity = Math.min(1.45, (BEACON.baseIntensity + this.level * BEACON.intensityPerLevel)
        * (1 + st.get('beaconIntensityMult') + st.get('beaconIntensity')));
      this.fuelMax = BEACON.fuelMax + this.level * 12;
    },
    get rangeTiles() { return this.radius; },
  };
}

// ---------------- 防御塔 ----------------

export function createTower(run, type, x, y, opts = {}) {
  const def = TOWER_DEF[type];
  if (!def) return null;
  const hpMult = 1 + run.playerStats.get('structureHpMult');
  const st = run.playerStats;
  return {
    id: nextId(),
    kind: 'tower',
    type,
    def,
    x, y,
    r: 18,
    angle: -Math.PI / 2,
    level: opts.level || 1,
    hp: (def.hp || 200) * hpMult,
    hpMax: (def.hp || 200) * hpMult,
    armor: def.armor || 4,
    cd: opts.instant ? 0 : (def.buildTime || 3),
    building: !opts.instant,
    buildProgress: opts.instant ? 1 : 0,
    target: null,
    charge: 0,
    overchargeTimer: 0,
    manual: false,
    kills: 0,
    damageDealt: 0,
    // 实验科技带来的额外效果（在开火时读取，保证中途升级也生效）
    serialize() {
      return { id: this.id, type: this.type, x: this.x, y: this.y, hp: this.hp, level: this.level, kills: this.kills };
    },
    get range() { return this.def.range * (1 + run.playerStats.get('towerRange')); },
    get damage() {
      return this.def.dmg * (1 + run.playerStats.get('towerDamage')) * (1 + (this.level - 1) * 0.25);
    },
    get attackCd() {
      const speed = 1 + run.playerStats.get('towerAttackSpeed');
      return this.def.cd / speed;
    },
  };
}

// ---------------- 建筑 ----------------

export function createStructure(run, type, x, y, opts = {}) {
  const def = STRUCTURE_DEF[type];
  if (!def) return null;
  const hpMult = 1 + run.playerStats.get('structureHpMult');
  return {
    id: nextId(),
    kind: 'structure',
    type,
    def,
    x, y,
    r: (def.size || 1) > 1 ? 30 : 18,
    size: def.size || 1,
    hp: def.hp * hpMult,
    hpMax: def.hp * hpMult,
    armor: (def.armor || 6) + run.playerStats.get('structureArmor'),
    building: !opts.instant,
    buildProgress: opts.instant ? 1 : 0,
    workers: 0,
    blocks: !!def.blocks,
    shield: 0,
    shieldMax: 0,
    cd: 0,
    serialize() {
      return { id: this.id, type: this.type, x: this.x, y: this.y, hp: this.hp, workers: this.workers };
    },
  };
}

// ---------------- 敌人 ----------------

export function createEnemy(run, type, x, y, opts = {}) {
  const def = MONSTER_DEF[type];
  if (!def) return null;
  const tier = opts.tier ?? 1;
  const scale = opts.scale || { hp: 1, dmg: 1, xp: 1, gold: 1 };
  const eliteMult = opts.elite ? 1.6 : 1;
  const hp = def.hp * scale.hp * eliteMult * (opts.hpMult || 1);
  return {
    id: nextId(),
    kind: 'enemy',
    type,
    def,
    x, y,
    r: def.r * (def.scale || 1),
    hp: opts.hp ?? hp,
    hpMax: opts.hp ?? hp,
    dmg: def.dmg * scale.dmg * (opts.dmgMult || 1),
    speed: def.speed * (opts.speedMult || 1),
    armor: def.armor + (opts.armorBonus || 0),
    // 出生朝向：副本里根据核心舱算没意义（它在世界之外），朝玩家那边就行
    angle: run.dungeon
      ? Math.atan2(run.player.y - y, run.player.x - x)
      : Math.atan2(run.base.y - y, run.base.x - x),
    vx: 0, vy: 0,
    attackCd: run.rng.range(0, 0.6),
    target: null,
    targetPlayer: false,
    state: 'seek',
    stateTimer: 0,
    stun: 0,
    slow: null,
    burn: null,
    poison: null,
    marks: 0,
    markTimer: 0,
    tier,
    elite: !!def.elite || !!opts.elite,
    boss: !!opts.boss,
    fromNest: opts.fromNest || null,
    waveId: opts.waveId || null,
    xpValue: def.xp * scale.xp * (def.elite ? 2.2 : 1),
    goldValue: def.gold * scale.gold * (def.elite ? 2.5 : 1),
    loot: def.loot || {},
    dead: false,
    summoned: opts.summoned || false,
    summonCd: def.summon ? def.summon.cd * 0.5 : 0,
    abilityCd: def.ability ? def.ability.cd : 0,
    phaseIndex: 0,
    flankAngle: run.rng.range(-1, 1) * (def.flank || 0.4),
    wobble: run.rng.range(0, Math.PI * 2),
    hitFlash: 0,
    scale,
    spawnAnim: 0.45,
    aggro: false,
    level: tier,
  };
}

/** 根据威胁度与星球算一份缩放 */
export function enemyScaleFor(run, tier, extra = 1) {
  const P = run.planetIndex;
  const t = 1 + (tier - 1) * 0.42 + P * 0.38;
  return {
    hp: t * extra,
    dmg: (1 + (tier - 1) * 0.28 + P * 0.30) * extra,
    xp: 1 + (tier - 1) * 0.5 + P * 0.45,
    gold: 1 + (tier - 1) * 0.55 + P * 0.5,
  };
}

// ---------------- 投射物 ----------------

export function createProjectile(opts) {
  return {
    id: nextId(),
    kind: 'projectile',
    x: opts.x, y: opts.y,
    vx: opts.vx || 0, vy: opts.vy || 0,
    r: opts.r || 5,
    life: opts.life ?? 1.6,
    maxLife: opts.life ?? 1.6,
    damage: opts.damage || 10,
    friendly: opts.friendly !== false,   // true = 玩家/塔发射
    color: opts.color || '#ffe08a',
    pierce: opts.pierce || 0,
    hitSet: new Set(),
    splash: opts.splash || null,
    homing: opts.homing || null,
    target: opts.target || null,
    trail: [],
    effect: opts.effect || null,          // slow/burn/poison
    owner: opts.owner || null,
    gravity: opts.gravity || null,        // 抛物线
    targetX: opts.targetX ?? null,
    targetY: opts.targetY ?? null,
    dead: false,
  };
}
