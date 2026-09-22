/**
 * 怪物数据表。
 *
 * 三条产怪线（对应玩家的三方向压力）：
 *   1) 常驻守卫 —— 巢穴附近巡逻，清巢时必须打，构成「清巢成本」。
 *   2) 野战游荡者 —— 大地图上随机游荡，是野外探索的威胁与装备来源。
 *   3) 怪潮 —— 被吸引阵列牵引，成建制冲基地，构成「塔防考验」。
 *
 * 智能分级 ai: swarm(直冲) / flank(绕侧) / ranged(拉扯) / charger(蓄力冲撞)
 *             / support(光环) / summoner(召唤) / boss(多阶段)
 */

export const AI = {
  SWARM: 'swarm',
  FLANK: 'flank',
  RANGED: 'ranged',
  CHARGER: 'charger',
  SUPPORT: 'support',
  SUMMONER: 'summoner',
  BOSS: 'boss',
};

export const MONSTER = {
  GRUB: 'grub',
  CRAWLER: 'crawler',
  ACID_CRAWLER: 'acidCrawler',
  STALKER: 'stalker',
  SPITTER: 'spitter',
  FLIER: 'flier',
  SHELLBACK: 'shellback',
  BURROWER: 'burrower',
  CHARGER: 'charger',
  BROOD_MOTHER: 'broodMother',
  HIVE_PRIEST: 'hivePriest',
  // 精英（野外必刷，掉落装备）
  ELITE_STALKER: 'eliteStalker',
  ELITE_BEHEMOTH: 'eliteBehemoth',
  ELITE_HIVELORD: 'eliteHiveLord',
  // Boss（巢穴核心）
  NEST_DEVOURER: 'nestDevourer',
  VOID_SIREN: 'voidSiren',
};

/**
 * role: guard(守卫) | wild(游荡) | wave(怪潮) | elite | boss
 * hp/dmg 是「1 级基准」，实际会按 (1 + tier*0.55 + planet*0.45) 之类的公式放大。
 */
export const MONSTER_DEF = {
  [MONSTER.GRUB]: {
    name: '酸虫', role: 'wave', ai: AI.SWARM, r: 12, hp: 26, dmg: 7, speed: 92, armor: 0,
    xp: 4, gold: 4, attackRange: 22, attackCd: 0.85, sight: 900, color: '#8fbf5a', shape: 'grub',
    loot: { chitin: [0, 1], biomass: [0, 1] }, weight: 34,
  },
  [MONSTER.CRAWLER]: {
    name: '疾行虫', role: 'wave', ai: AI.SWARM, r: 13, hp: 34, dmg: 9, speed: 132, armor: 1,
    xp: 6, gold: 5, attackRange: 24, attackCd: 0.7, sight: 1000, color: '#c9b45a', shape: 'spider',
    loot: { chitin: [1, 2] }, weight: 26,
  },
  [MONSTER.ACID_CRAWLER]: {
    name: '蚀地虫', role: 'wave', ai: AI.SWARM, r: 15, hp: 46, dmg: 8, speed: 104, armor: 2,
    xp: 9, gold: 7, attackRange: 26, attackCd: 0.9, sight: 950, color: '#6fae4a', shape: 'spider',
    onDeath: { pool: { r: 40, dmg: 6, dur: 6 } },   // 死时留下酸池
    loot: { biomass: [1, 2], sulfur: [0, 1] }, weight: 16,
  },
  [MONSTER.STALKER]: {
    name: '潜猎者', role: 'wave', ai: AI.FLANK, r: 16, hp: 62, dmg: 15, speed: 148, armor: 2,
    xp: 14, gold: 11, attackRange: 28, attackCd: 0.95, sight: 1150, color: '#b5586a', shape: 'mantis',
    flank: 0.55, loot: { chitin: [1, 3], dna: [0, 1] }, weight: 13,
  },
  [MONSTER.SPITTER]: {
    name: '喷酸虫', role: 'wave', ai: AI.RANGED, r: 15, hp: 40, dmg: 11, speed: 74, armor: 1,
    xp: 12, gold: 9, attackRange: 300, attackCd: 2.1, sight: 700, color: '#7ad0a0', shape: 'spitter',
    ranged: { speed: 300, r: 8, kind: 'acid', arc: true }, keepDist: 230,
    loot: { biomass: [1, 2], sulfur: [0, 1] }, weight: 12,
  },
  [MONSTER.FLIER]: {
    name: '嗡翅虫', role: 'wave', ai: AI.RANGED, r: 12, hp: 28, dmg: 8, speed: 190, armor: 0,
    xp: 10, gold: 8, attackRange: 190, attackCd: 1.5, sight: 1200, color: '#d0a0e8', shape: 'flyer',
    flying: true, ranged: { speed: 380, r: 6, kind: 'spit' }, keepDist: 150,
    loot: { chitin: [0, 1], spore: [0, 1] }, weight: 14,
  },
  [MONSTER.SHELLBACK]: {
    name: '甲盾虫', role: 'wave', ai: AI.SWARM, r: 22, hp: 190, dmg: 18, speed: 62, armor: 12,
    xp: 26, gold: 20, attackRange: 32, attackCd: 1.5, sight: 800, color: '#7d8896', shape: 'shield',
    frontArmor: 0.6,      // 正面额外减伤，逼玩家绕后
    loot: { chitin: [2, 4], metal: [1, 2] }, weight: 7,
  },
  [MONSTER.BURROWER]: {
    name: '潜地虫', role: 'wave', ai: AI.CHARGER, r: 18, hp: 96, dmg: 22, speed: 108, armor: 3,
    xp: 22, gold: 17, attackRange: 30, attackCd: 1.2, sight: 900, color: '#9a7a4a', shape: 'worm',
    burrow: { interval: 7, time: 2.2, speedMult: 1.6 },
    loot: { chitin: [1, 3], biomass: [1, 2] }, weight: 8,
  },
  [MONSTER.CHARGER]: {
    name: '冲角虫', role: 'wave', ai: AI.CHARGER, r: 20, hp: 120, dmg: 30, speed: 96, armor: 5,
    xp: 24, gold: 19, attackRange: 34, attackCd: 1.3, sight: 1000, color: '#d07040', shape: 'charger',
    charge: { windup: 0.9, speed: 460, time: 0.85, cd: 4.5, stunOnWall: 1.4 },
    loot: { chitin: [2, 3], metal: [0, 2] }, weight: 9,
  },
  [MONSTER.BROOD_MOTHER]: {
    name: '育母', role: 'wave', ai: AI.SUMMONER, r: 30, hp: 420, dmg: 24, speed: 56, armor: 8,
    xp: 70, gold: 55, attackRange: 40, attackCd: 1.6, sight: 900, color: '#c05a80', shape: 'brood',
    summon: { type: MONSTER.GRUB, count: 4, cd: 9, radius: 70, max: 14 },
    aura: { radius: 220, hpRegen: 6, name: '孵化光环' },
    loot: { chitin: [3, 6], biomass: [2, 4], dna: [1, 3] }, weight: 3,
  },
  [MONSTER.HIVE_PRIEST]: {
    name: '虫巢祭司', role: 'wave', ai: AI.SUPPORT, r: 20, hp: 260, dmg: 16, speed: 84, armor: 6,
    xp: 52, gold: 42, attackRange: 260, attackCd: 2.0, sight: 1000, color: '#a080e0', shape: 'priest',
    ranged: { speed: 260, r: 10, kind: 'spit' },
    aura: { radius: 300, speedMult: 1.3, armorBonus: 5, name: '虫群狂热' },
    loot: { dna: [1, 3], crystal: [1, 2] }, weight: 3,
  },

  // ---------- 精英 ----------
  [MONSTER.ELITE_STALKER]: {
    name: '精英·血棘', role: 'elite', ai: AI.FLANK, r: 22, hp: 520, dmg: 38, speed: 158, armor: 8,
    xp: 180, gold: 150, attackRange: 34, attackCd: 0.85, sight: 1200, color: '#ff5f6d', shape: 'mantis',
    elite: true, scale: 1.35, flank: 0.6, ability: { kind: 'dashStrike', cd: 5, range: 320, dmgMult: 2.2 },
    loot: { dna: [2, 4], crystal: [2, 4], chitin: [4, 8] }, weight: 0,
  },
  [MONSTER.ELITE_BEHEMOTH]: {
    name: '精英·磐甲', role: 'elite', ai: AI.SWARM, r: 30, hp: 1150, dmg: 52, speed: 70, armor: 22,
    xp: 240, gold: 210, attackRange: 46, attackCd: 1.7, sight: 900, color: '#ff9a4c', shape: 'shield',
    elite: true, scale: 1.5, frontArmor: 0.55,
    ability: { kind: 'groundSlam', cd: 6, range: 120, dmgMult: 1.6, knockback: 220 },
    loot: { metal: [6, 12], chitin: [6, 10], parts: [2, 5] }, weight: 0,
  },
  [MONSTER.ELITE_HIVELORD]: {
    name: '精英·巢主', role: 'elite', ai: AI.SUMMONER, r: 28, hp: 900, dmg: 34, speed: 90, armor: 12,
    xp: 300, gold: 280, attackRange: 300, attackCd: 1.9, sight: 1100, color: '#c08cff', shape: 'priest',
    elite: true, scale: 1.4, ranged: { speed: 300, r: 11, kind: 'acid', arc: true },
    summon: { type: MONSTER.CRAWLER, count: 5, cd: 8, radius: 90, max: 12 },
    aura: { radius: 260, speedMult: 1.25, name: '巢主威压' },
    loot: { dna: [3, 6], crystal: [3, 6], beaconCore: [0, 1] }, weight: 0,
  },

  // ---------- Boss ----------
  // 体型刻意压住：Boss 是「巢穴里的大怪」，不是占满半个屏幕的东西。
  // r * scale 约为普通小怪（r 10~16）的 2 倍出头，一眼能认出来又不挡视野。
  [MONSTER.NEST_DEVOURER]: {
    name: '巢穴吞噬者', role: 'boss', ai: AI.BOSS, r: 30, hp: 4200, dmg: 62, speed: 62, armor: 18,
    xp: 1200, gold: 900, attackRange: 62, attackCd: 1.5, sight: 1400, color: '#ff3f4f', shape: 'boss',
    elite: true, boss: true, scale: 1.30,
    phases: [
      { at: 0.66, name: '孵化', add: { type: MONSTER.GRUB, count: 8 } },
      { at: 0.33, name: '狂怒', speedMult: 1.5, dmgMult: 1.35 },
    ],
    ability: { kind: 'acidNova', cd: 7.5, range: 260, dmgMult: 1.4 },
    aura: { radius: 340, hpRegen: 18, name: '巢核共鸣' },
    loot: { beaconCore: [2, 3], dna: [5, 10], crystal: [6, 12], gold: [500, 900] }, weight: 0,
  },
  [MONSTER.VOID_SIREN]: {
    name: '虚空女妖', role: 'boss', ai: AI.BOSS, r: 27, hp: 3600, dmg: 54, speed: 110, armor: 10,
    xp: 1400, gold: 1050, attackRange: 340, attackCd: 1.4, sight: 1500, color: '#8f5fff', shape: 'siren',
    elite: true, boss: true, scale: 1.28, flying: true,
    ranged: { speed: 340, r: 12, kind: 'void', arc: false },
    phases: [
      { at: 0.6, name: '裂空', teleport: true, cdMult: 0.7 },
      { at: 0.3, name: '尖啸', summon: { type: MONSTER.FLIER, count: 10 } },
    ],
    ability: { kind: 'voidLance', cd: 5.5, range: 420, dmgMult: 1.8 },
    loot: { beaconCore: [2, 4], crystal: [8, 14], dna: [6, 12], gold: [600, 1100] }, weight: 0,
  },
};

/** 每个巢穴按等级 + 群系挑选「驻防组合」 */
export const NEST_ROSTER = {
  base: [MONSTER.GRUB, MONSTER.CRAWLER, MONSTER.SPITTER],
  mid: [MONSTER.CRAWLER, MONSTER.STALKER, MONSTER.SHELLBACK, MONSTER.FLIER, MONSTER.ACID_CRAWLER],
  high: [MONSTER.STALKER, MONSTER.SHELLBACK, MONSTER.CHARGER, MONSTER.BURROWER, MONSTER.SPITTER, MONSTER.FLIER],
  special: [MONSTER.BROOD_MOTHER, MONSTER.HIVE_PRIEST],
};

/** 每个群系倾向的怪物类型（野战游荡者） */
export const BIOME_MONSTERS = {
  0: [MONSTER.GRUB, MONSTER.CRAWLER, MONSTER.SPITTER],
  1: [MONSTER.CRAWLER, MONSTER.STALKER, MONSTER.BROOD_MOTHER, MONSTER.ACID_CRAWLER],
  2: [MONSTER.CRAWLER, MONSTER.CHARGER, MONSTER.SPITTER, MONSTER.BURROWER],
  3: [MONSTER.CHARGER, MONSTER.ACID_CRAWLER, MONSTER.HIVE_PRIEST, MONSTER.SHELLBACK],
  4: [MONSTER.FLIER, MONSTER.HIVE_PRIEST, MONSTER.STALKER, MONSTER.SHELLBACK],
  5: [MONSTER.SPITTER, MONSTER.BROOD_MOTHER, MONSTER.ACID_CRAWLER, MONSTER.BURROWER],
  6: [MONSTER.SHELLBACK, MONSTER.CHARGER, MONSTER.FLIER, MONSTER.STALKER],
  7: [MONSTER.SHELLBACK, MONSTER.BURROWER, MONSTER.HIVE_PRIEST, MONSTER.CHARGER],
  8: [MONSTER.STALKER, MONSTER.CHARGER, MONSTER.BROOD_MOTHER, MONSTER.SHELLBACK, MONSTER.HIVE_PRIEST],
};

/** 威胁度 -> 怪物强度缩放 */
export function monsterScale(tier, planetIndex, threatMult = 1) {
  const t = 1 + (tier - 1) * 0.42 + planetIndex * 0.38;
  return {
    hp: t * threatMult,
    dmg: (1 + (tier - 1) * 0.28 + planetIndex * 0.30) * threatMult,
    xp: 1 + (tier - 1) * 0.5 + planetIndex * 0.45,
    gold: 1 + (tier - 1) * 0.55 + planetIndex * 0.5,
  };
}
