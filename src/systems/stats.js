/**
 * 属性聚合引擎。
 *
 * 所有成长来源（角色被动 / 主科技树 / 实验科技 / 装备 / 词缀 / 基因 / 临时 buff）
 * 都产出同一种「修正」，最后由这里统一算成最终属性。
 *
 * 规则：
 *   - 数值键：加法叠加
 *   - 对象键（机制）：取「最强」的那一份，避免数值爆炸
 *   - 开关键（autoCollect 等）：取最大值
 *   - 乘法类（damage / attackSpeed / speedMult …）也走加法，最后在派生公式里相乘
 */

/** 所有可用的数值键及其默认值 */
export const DEFAULT_STATS = {
  // 生存
  hpMax: 0,
  hpRegen: 0,
  armor: 0,
  shieldMax: 0,
  shieldRegen: 0,
  // 移动
  speedMult: 0,
  dodgeCdMult: 0,
  staminaMax: 0,
  staminaRegen: 0,
  // 输出
  damage: 0,
  attackSpeed: 0,
  /**
   * 同时发射的弹道条数（额外条数，不是总数）。
   * 由科技树「多管弹道」提供，上限 2（= 总共 3 条），见 core/config.js WEAPON_CAPS。
   */
  projectiles: 0,
  critChance: 0,
  critMult: 0,
  rangeMult: 0,
  pierce: 0,
  knockbackMult: 0,
  lifeSteal: 0,
  meleeMult: 0,
  towerDamage: 0,
  towerAttackSpeed: 0,
  towerRange: 0,
  towerCap: 0,
  towerSlotRadius: 0,
  // 对特定目标
  eliteDamage: 0,
  bossDamage: 0,
  nightDamage: 0,
  // 持续伤害
  dotMult: 0,
  poisonOnHit: 0,
  thorn: 0,
  // 经济
  goldMult: 0,
  xpMult: 0,
  matMult: 0,
  luck: 0,
  lootQuality: 0,
  passiveGold: 0,
  goldInterest: 0,
  carryMult: 0,
  cargoBonus: 0,
  storageCap: 0,
  // 建造与采集
  buildSpeed: 0,
  buildCostMult: 0,
  mineSpeed: 0,
  /** 采集每次的额外产出（科技每级 +1，见 t_mine1..4） */
  mineYield: 0,
  upgradeDiscount: 0,
  // 吸引阵列
  beaconRadiusMult: 0,
  beaconIntensityMult: 0,
  beaconFuelMult: 0,
  beaconFuelRegen: 0,
  powerOutput: 0,
  // 基地/人口
  popCap: 0,
  popGrowthMult: 0,
  workerEfficiency: 0,
  jobSlots: 0,
  repairMult: 0,
  repairCostMult: 0,
  autoRepairBase: 0,
  autoRepair: 0,
  baseHeal: 0,
  structureHpMult: 0,
  structureArmor: 0,
  airDropSpeed: 0,
  airDropAuto: 0,
  // 载具
  vehicleSpeedMult: 0,
  vehicleHpMult: 0,
  vehicleSlots: 0,
  /** 炮塔挂架数量（硬上限见 VEHICLE.maxTurrets） */
  vehicleTurretCap: 0,
  ramMult: 0,
  /** 抵抗「被精英怪别住」的比例（0~1） */
  pinResist: 0,
  fuelMult: 0,
  fuelRegen: 0,
  terrainIgnore: 0,
  vehicleWeaponDamage: 0,
  // 环境抗性
  hazardResist: 0,
  coldResist: 0,
  heatResist: 0,
  acidResist: 0,
  sporeResist: 0,
  foodEfficiency: 0,
  healPower: 0,
  regenPct: 0,
  // 视野与情报
  nightVision: 0,
  sightBonus: 0,
  revealRadius: 0,
  mapReveal: 0,
  resourceSense: 0,
  // 生物
  dnaMult: 0,
  bioPointGain: 0,
  tameSlots: 0,
  tameSpeed: 0,
  tamePower: 0,
  tameElite: 0,
  geneSlots: 0,
  genePower: 0,
  monsterFriendly: 0,
  // 贸易与后勤
  tradeDiscount: 0,
  sellBonus: 0,
  supplyDropRate: 0,
  supplyBonus: 0,
  ammoCostMult: 0,
  ammoCraft: 0,
  smeltOnKill: 0,
  autoCollect: 0,
  autoCollectRadius: 0,
  autoDeposit: 0,
  selfSufficient: 0,
  deathPenaltyImmunity: 0,
  respawnAtBase: 0,
  relicChance: 0,
  eliteSpawnMult: 0,
  salvageMult: 0,
  beaconCoreFind: 0,
  experimentRefreshDiscount: 0,
  rebuildDiscount: 0,
  ignoreSlowResist: 0,
  manualDamageMult: 0,
  beaconIntensity: 0,
  // 特殊（角色被动折算）
  rageBonus: 0,
  lowHpArmor: 0,
  killFrenzy: 0,
  killFrenzySpeed: 0,
  collisionHeal: 0,
  hiveGuard: 0,
};

/** 机制类键（对象）—— 取最强的一份 */
export const MECHANIC_KEYS = [
  'towerExplode', 'towerSlow', 'towerBurn', 'towerChain', 'towerOvercharge',
  'towerExplodeOnDeath', 'lastStand', 'vengeance', 'baseShield', 'manualSplash',
  'dodgeDamage', 'execute', 'counterWave', 'focusFire', 'buildCostMult',
];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 合并一份修正到累积器 */
function fold(acc, src) {
  if (!src) return acc;
  for (const key of Object.keys(src)) {
    const val = src[key];
    if (val == null) continue;
    if (MECHANIC_KEYS.includes(key) || isPlainObject(val)) {
      // 机制：取「更强」的一份
      const cur = acc[key];
      acc[key] = cur == null ? val : strongerMechanic(cur, val);
    } else if (typeof val === 'number') {
      acc[key] = (acc[key] || 0) + val;
    } else {
      acc[key] = val;    // 布尔/字符串：后者覆盖
    }
  }
  return acc;
}

/** 比较两个机制对象，"强"的判据按字段尝试 */
function strongerMechanic(a, b) {
  const score = (o) => {
    if (typeof o !== 'object') return 0;
    return (o.mult || 0) * 100 + (o.dmg || 0) * 10 + (o.dmgMult || 0) * 100
      + (o.amount || 0) + (o.dps || 0) * 5 + (o.chains || 0) * 20 + (o.radius || 0) * 0.2;
  };
  return score(b) > score(a) ? b : a;
}

/**
 * 属性解析器。
 * 使用方式：
 *   const stats = new StatSet();
 *   stats.add(CHAR_DEF[c].base);          // 基础
 *   stats.add(techEffects);               // 科技
 *   stats.add(equipStats);                // 装备
 *   stats.addBuff({ damage: 0.4 }, 10);   // 临时 buff
 *   stats.update(dt);
 *   stats.get('damage') -> 0.4
 */
export class StatSet {
  constructor(base = null) {
    this.base = { ...DEFAULT_STATS, ...(base || {}) };
    /*
     * 基础值同时进 flat。
     *
     * 构造函数的 `base` 参数以前只存进 `this.base`，而 `get()` 读的是 `this.flat` ——
     * 于是 `new StatSet(角色基础属性)` 出来的属性表里，角色的护甲、暴击、
     * 生命回复全是 0。这类 bug 完全静默（没有任何报错，只是数字不对），
     * 所以这里让「传进来的基础值」直接就是初始 flat，语义也更直白。
     */
    this.flat = { ...this.base };
    this.buffs = [];              // { mods, remain, id }
    this.mechanics = {};
    this._cache = null;
    this.enabled = true;
  }

  /** 加一份永久修正 */
  add(mods) {
    if (!mods) return this;
    fold(this.flat, mods);
    for (const k of MECHANIC_KEYS) if (mods[k] !== undefined) this.mechanics[k] = this.flat[k];
    this._cache = null;
    return this;
  }

  /** 移除一份修正（用于装备卸下）—— 需要传入完全相同的对象 */
  remove(mods) {
    if (!mods) return this;
    for (const key of Object.keys(mods)) {
      const val = mods[key];
      if (typeof val === 'number' && typeof this.flat[key] === 'number') {
        this.flat[key] -= val;
      }
    }
    this._cache = null;
    return this;
  }

  /** 加临时 buff */
  addBuff(mods, duration, id = null) {
    if (!mods) return;
    if (id) this.buffs = this.buffs.filter(b => b.id !== id);
    this.buffs.push({ mods, remain: duration, id });
    this._cache = null;
  }

  removeBuff(id) {
    const before = this.buffs.length;
    this.buffs = this.buffs.filter(b => b.id !== id);
    if (this.buffs.length !== before) this._cache = null;
  }

  hasBuff(id) { return this.buffs.some(b => b.id === id); }

  update(dt) {
    if (!this.buffs.length) return;
    let changed = false;
    for (const b of this.buffs) {
      b.remain -= dt;
      if (b.remain <= 0) changed = true;
    }
    if (changed) {
      this.buffs = this.buffs.filter(b => b.remain > 0);
      this._cache = null;
    }
  }

  /** 取最终属性（含 buff） */
  get(key) {
    if (!this._cache) {
      const total = { ...this.flat };
      for (const b of this.buffs) fold(total, b.mods);
      this._cache = total;
    }
    return this._cache[key] ?? 0;
  }

  /** 全部最终属性快照 */
  all() {
    if (!this._cache) this.get('__warm');
    return this._cache;
  }

  /** 清掉所有临时 buff（切换星球/读档时用） */
  clearBuffs() {
    this.buffs.length = 0;
    this._cache = null;
  }

  reset() {
    this.flat = { ...DEFAULT_STATS };
    this.mechanics = {};
    this.buffs.length = 0;
    this._cache = null;
  }
}

/**
 * 把一堆效果对象折算成属性修正。
 * 支持 { unlockTower: 'rail' } 这类「解锁」型 key（会被收集到 unlocks 里而不是属性里）。
 */
export function foldEffects(effectsList) {
  const stats = {};
  const unlocks = {
    towers: new Set(),
    structures: new Set(),
    features: new Set(),
    meleeModules: new Set(),
    town: new Set(),
    vehicleWeapons: new Set(),   // 车载武器解锁（仅驾驶员科技树提供）
    bioPoints: 0,
    beaconLevels: 0,
    beaconCore: 0,
  };
  for (const eff of effectsList) {
    if (!eff) continue;
    for (const key of Object.keys(eff)) {
      const val = eff[key];
      if (key === 'unlockTower') { unlocks.towers.add(val); continue; }
      if (key === 'unlockStructure' || key === 'unlockStructure2') { unlocks.structures.add(val); continue; }
      // 城镇建筑解锁（玩家要求：城镇那些需要解锁的东西挂到科技树上）
      if (key === 'unlockTown') { unlocks.town.add(val); continue; }
      if (key === 'beaconLevel') { unlocks.beaconLevels += val; continue; }
      if (key === 'beaconCore') { unlocks.beaconCore += val; continue; }
      if (key === 'secondBase') { unlocks.features.add('secondBase'); continue; }
      if (key === 'nextPlanet') { unlocks.features.add('nextPlanet'); continue; }
      if (key === 'portableBeacon') { unlocks.features.add('portableBeacon'); continue; }
      if (key === 'autoCollect') { unlocks.features.add('autoCollect'); continue; }
      if (key === 'airDropAuto') { unlocks.features.add('airDropAuto'); continue; }
      if (key === 'vehicleUnlock') { unlocks.features.add('vehicle'); continue; }
      // 载具悬挂近战模块（撞角 / 电锯）：可以叠加，取最强的那一档
      if (key === 'vehicleMelee') { unlocks.meleeModules.add(val); continue; }
      // 车载武器解锁（驾驶员专属）：进 unlocks.vehicleWeapons，装车时校验
      if (key === 'vehicleWeaponUnlock') { unlocks.vehicleWeapons.add(val); continue; }
      if (key === 'vehicleTurretCap') { stats.vehicleTurretCap = Math.max(stats.vehicleTurretCap || 0, val); continue; }
      if (key === 'planetAdapt') { unlocks.features.add('planetAdapt'); continue; }
      if (key === 'tameEnabled') { unlocks.features.add('tame'); continue; }
      if (key === 'geneTree') { unlocks.features.add('gene'); continue; }
      if (key === 'vehicleBeacon') { unlocks.features.add('portableBeacon'); continue; }
      if (key === 'vehicleAsTurret') { unlocks.features.add('vehicleAsTurret'); continue; }
      if (key === 'hiveGuard') { stats.hiveGuard = (stats.hiveGuard || 0) + val; continue; }
      if (key === 'exclusiveBuildings') { unlocks.features.add('exclusiveBuildings'); continue; }
      if (key === 'exclusiveWeapons') { unlocks.features.add('exclusiveWeapons'); continue; }
      if (key === 'ejectOnDestroy') { unlocks.features.add('ejectOnDestroy'); continue; }
      if (key === 'stealth') { unlocks.features.add('stealth'); continue; }
      if (key === 'burrow') { unlocks.features.add('burrow'); continue; }
      if (key === 'packDamage') { stats.packDamage = (stats.packDamage || 0) + val; continue; }
      if (key === 'phaseShield') { stats.phaseShield = (stats.phaseShield || 0) + val; continue; }
      if (key === 'thornAcid') { stats.thornAcid = (stats.thornAcid || 0) + val; continue; }
      if (key === 'armor' || typeof val === 'number' || isPlainObject(val)) {
        if (isPlainObject(val)) {
          stats[key] = stats[key] ? strongerMechanic(stats[key], val) : val;
        } else if (typeof val === 'number') {
          stats[key] = (stats[key] || 0) + val;
        }
      }
    }
  }
  return { stats, unlocks };
}
