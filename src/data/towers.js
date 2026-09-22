/**
 * 防御塔 / 建筑 / 基地设施。
 *
 * 设计原则：
 *   - 防御塔全部自动攻击，玩家可「手动接管」单个塔提高爆发。
 *   - 塔位有限（基地地块），逼玩家做取舍。
 *   - 工程师有 3 座别人造不出来的专属建筑。
 */

export const TOWER = {
  SENTRY: 'sentry',
  GATLING: 'gatling',
  MORTAR: 'mortar',
  RAIL: 'rail',
  TESLA: 'tesla',
  CRYO: 'cryo',
  FLAME: 'flameTower',
  SNIPER: 'sniper',
  // 工程师专属
  DRONE_PLATFORM: 'dronePlatform',
  MAGNETIC_RAIL: 'magneticRail',
  FORCE_FIELD: 'forceField',
};

/**
 * kind: bullet | shell | beam | chain | aura | support
 * dmg: 单发伤害；cd 攻击间隔；range 射程
 */
export const TOWER_DEF = {
  [TOWER.SENTRY]: {
    id: TOWER.SENTRY, name: '哨戒炮台', kind: 'bullet', tier: 1, icon: '▣',
    dmg: 13, cd: 0.62, range: 340, bulletSpeed: 900, hp: 180, armor: 4,
    cost: { gold: 90, metal: 25 }, buildTime: 3.5, color: '#9aa4b0',
    desc: '最基础的自动炮台。便宜、量大、可靠。',
    tags: [],
  },
  [TOWER.GATLING]: {
    id: TOWER.GATLING, name: '转管机炮', kind: 'bullet', tier: 2, icon: '▤',
    dmg: 7, cd: 0.11, range: 300, bulletSpeed: 950, hp: 200, armor: 5, spread: 0.07,
    cost: { gold: 190, metal: 60 }, buildTime: 6, color: '#6ee7a8', requires: 't_gatling',
    desc: '极高射速，单体持续输出最强。对成群小虫略浪费。',
    tags: [],
  },
  [TOWER.MORTAR]: {
    id: TOWER.MORTAR, name: '迫击炮位', kind: 'shell', tier: 2, icon: '◎',
    dmg: 46, cd: 2.1, range: 520, splash: 110, hp: 200, armor: 5, minRange: 130,
    cost: { gold: 220, metal: 75 }, buildTime: 7, color: '#ffba4c', requires: 't_mortar',
    desc: '曲射范围伤害，专治密集虫潮。近身打不到。',
    tags: ['splash'],
  },
  [TOWER.RAIL]: {
    id: TOWER.RAIL, name: '磁轨炮塔', kind: 'beam', tier: 3, icon: '⚡',
    dmg: 110, cd: 2.6, range: 760, pierce: 99, hp: 240, armor: 7, chargeTime: 0.5,
    cost: { gold: 420, metal: 140, crystal: 30 }, buildTime: 10, color: '#59d8ff', requires: 't_rail',
    desc: '贯穿一条线，无视 50% 护甲。放在长直通道尽头收益最高。',
    tags: ['pierce'],
  },
  [TOWER.TESLA]: {
    id: TOWER.TESLA, name: '电弧线圈', kind: 'chain', tier: 3, icon: '☈',
    dmg: 34, cd: 0.95, range: 260, chains: 4, chainFalloff: 0.8, hp: 210, armor: 6,
    cost: { gold: 380, metal: 110, crystal: 40 }, buildTime: 9, color: '#c08cff', requires: 't_tesla',
    desc: '电弧在敌人之间跳跃，虫群越密越强。',
    tags: ['chain'],
  },
  [TOWER.CRYO]: {
    id: TOWER.CRYO, name: '低温投射器', kind: 'aura', tier: 3, icon: '❄',
    dmg: 8, cd: 0.5, range: 220, slow: { amount: 0.5, dur: 2.5 }, hp: 220, armor: 6,
    cost: { gold: 300, metal: 90, coolant: 40 }, buildTime: 8, color: '#8fe0e8', requires: 't_cryo',
    desc: '范围减速并造成少量伤害。减速是塔防里最被低估的乘算收益。',
    tags: ['slow'],
  },
  [TOWER.FLAME]: {
    id: TOWER.FLAME, name: '喷焰塔', kind: 'aura', tier: 2, icon: '🔥',
    dmg: 22, cd: 0.35, range: 165, burn: { dps: 10, dur: 3 }, hp: 190, armor: 5,
    cost: { gold: 200, metal: 55, sulfur: 30 }, buildTime: 6, color: '#ff7a4c', requires: 't_flame',
    desc: '近距离持续灼烧，对甲壳类特别有效。',
    tags: ['burn'],
  },
  [TOWER.SNIPER]: {
    id: TOWER.SNIPER, name: '狙击塔', kind: 'bullet', tier: 2, icon: '⌖',
    dmg: 130, cd: 3.2, range: 900, bulletSpeed: 2000, hp: 170, armor: 4, critChance: 0.35, critMult: 2.2,
    cost: { gold: 260, metal: 80 }, buildTime: 7, color: '#ff5f6d', requires: 't_sniper',
    desc: '超远射程，专点精英和喷酸虫。',
    tags: ['single'],
  },

  // ---------------- 工程师专属 ----------------
  [TOWER.DRONE_PLATFORM]: {
    id: TOWER.DRONE_PLATFORM, name: '修理无人机平台', kind: 'support', tier: 2, icon: '✚',
    exclusive: 'engineer',
    dmg: 0, cd: 1, range: 300, hp: 260, armor: 8,
    repair: { amount: 14, radius: 300, targetAll: true }, shield: { amount: 30, cd: 8 },
    cost: { gold: 240, metal: 90, parts: 20 }, buildTime: 8, color: '#6ee7a8',
    desc: '【工程师专属】持续修复范围内所有建筑，并为它们提供临时护盾。',
    tags: ['support'],
  },
  [TOWER.MAGNETIC_RAIL]: {
    id: TOWER.MAGNETIC_RAIL, name: '磁力碾压轨', kind: 'beam', tier: 3, icon: '≡',
    exclusive: 'engineer',
    dmg: 150, cd: 3.4, range: 620, pierce: 99, ignoreArmor: true, push: 340, hp: 320, armor: 10,
    cost: { gold: 480, metal: 170, crystal: 45 }, buildTime: 12, color: '#8fe0ff',
    desc: '【工程师专属】把整条直线上的敌人推回去并造成重创 —— 能把冲进来的虫潮直接推回门口。',
    tags: ['pierce', 'push'],
  },
  [TOWER.FORCE_FIELD]: {
    id: TOWER.FORCE_FIELD, name: '力场发生器', kind: 'support', tier: 3, icon: '⬡',
    exclusive: 'engineer',
    dmg: 0, cd: 1, range: 260, hp: 400, armor: 14,
    shieldPool: { amount: 1200, regen: 22 },   // 给范围内建筑套一层共享护盾
    cost: { gold: 520, metal: 160, crystal: 60 }, buildTime: 14, color: '#c08cff',
    desc: '【工程师专属】为范围内的建筑提供共享护盾池，基地被围攻时的保命底牌。',
    tags: ['support'],
  },
};

/** 建筑（非攻击性） */
export const STRUCTURE = {
  WALL: 'wall',
  GATE: 'gate',
  STORAGE: 'storage',
  WORKSHOP: 'workshop',
  FARM: 'farm',
  GENERATOR: 'generator',
  HABITAT: 'habitat',
  CLINIC: 'clinic',
  LAB: 'lab',
  TRADE_POST: 'tradePost',
  LANDING_PAD: 'landingPad',
  REPAIR_BAY: 'repairBay',
  TURRET_SLOT: 'turretSlot',
};

export const STRUCTURE_DEF = {
  [STRUCTURE.WALL]: {
    id: STRUCTURE.WALL, name: '合金围墙', icon: '▬', hp: 600, armor: 12, size: 1,
    cost: { metal: 18 }, buildTime: 1.4, color: '#8a8f98', blocks: true, repairable: true,
    desc: '挡路的。便宜、能修、能把虫潮引到你要的方向。',
  },
  [STRUCTURE.GATE]: {
    id: STRUCTURE.GATE, name: '基地闸门', icon: '▭', hp: 900, armor: 16, size: 1,
    cost: { metal: 40, parts: 4 }, buildTime: 3, color: '#c0a060', blocks: false, repairable: true,
    desc: '允许友方通过，敌人需要打破它才能进。',
  },
  [STRUCTURE.STORAGE]: {
    id: STRUCTURE.STORAGE, name: '仓储舱', icon: '▥', hp: 400, size: 1,
    cost: { metal: 35 }, buildTime: 2.5, color: '#b08050', storage: 200,
    desc: '提升资源上限 200。',
  },
  [STRUCTURE.WORKSHOP]: {
    id: STRUCTURE.WORKSHOP, name: '工坊', icon: '⚒', hp: 500, size: 1,
    cost: { metal: 60, parts: 10 }, buildTime: 5, color: '#9aa4b0', requires: 't_workshop',
    desc: '解锁装备强化与武器改造。',
  },
  [STRUCTURE.FARM]: {
    id: STRUCTURE.FARM, name: '水培农场', icon: '❋', hp: 300, size: 1,
    cost: { metal: 40, fiber: 30 }, buildTime: 4, color: '#6f9a55', requires: 't_farm',
    produce: { food: 0.28 }, jobs: 1,
    desc: '产出食物。有人口驻守时产量翻倍。',
  },
  [STRUCTURE.GENERATOR]: {
    id: STRUCTURE.GENERATOR, name: '地热发电机', icon: '⚡', hp: 450, size: 1,
    cost: { metal: 80, parts: 14 }, buildTime: 6, color: '#ffba4c', requires: 't_generator',
    produce: { power: 1.2 }, jobs: 1,
    desc: '为吸引阵列和防御塔供能，降低燃料消耗。',
  },
  [STRUCTURE.HABITAT]: {
    id: STRUCTURE.HABITAT, name: '居住舱', icon: '⌂', hp: 380, size: 1,
    cost: { metal: 55, parts: 8 }, buildTime: 4.5, color: '#59d8ff',
    popCap: 4, desc: '人口上限 +4。人口会自动增长到这里。',
  },
  [STRUCTURE.CLINIC]: {
    id: STRUCTURE.CLINIC, name: '医疗站', icon: '✚', hp: 350, size: 1,
    cost: { metal: 60, parts: 10 }, buildTime: 5, color: '#ff8a8a', requires: 't_clinic',
    healAura: { radius: 260, hps: 1.6 }, jobs: 1,
    desc: '在基地范围内缓慢治疗玩家与友方。',
  },
  [STRUCTURE.LAB]: {
    id: STRUCTURE.LAB, name: '实验舱', icon: '✦', hp: 420, size: 1,
    cost: { metal: 90, crystal: 40, parts: 16 }, buildTime: 8, color: '#c08cff', requires: 't_lab',
    researchRate: 1, desc: '解锁【实验科技】三方向四选一，并提升刷新折扣。',
  },
  [STRUCTURE.TRADE_POST]: {
    id: STRUCTURE.TRADE_POST, name: '贸易站', icon: '⇄', hp: 400, size: 1,
    cost: { metal: 70, gold: 120 }, buildTime: 6, color: '#ffba4c', requires: 't_trade',
    desc: '与上级殖民地做资源兑换，把多余材料换成缺的。',
  },
  [STRUCTURE.LANDING_PAD]: {
    id: STRUCTURE.LANDING_PAD, name: '空投引导坪', icon: '⛬', hp: 500, size: 2,
    cost: { metal: 140, parts: 24, gold: 200 }, buildTime: 12, color: '#8fe0ff', requires: 't_landing',
    desc: '申请防御塔空投的必要设施。等级越高，空投越快、可申请的塔越强。',
  },
  [STRUCTURE.REPAIR_BAY]: {
    id: STRUCTURE.REPAIR_BAY, name: '自动维修坞', icon: '⚙', hp: 460, size: 1,
    cost: { metal: 110, parts: 20 }, buildTime: 9, color: '#6ee7a8', requires: 't_repair',
    autoRepair: { rate: 18, radius: 320 }, jobs: 1,
    desc: '自动修复基地范围内受损建筑。有人口驻守时效率翻倍。',
  },
  [STRUCTURE.TURRET_SLOT]: {
    id: STRUCTURE.TURRET_SLOT, name: '防御塔基座', icon: '▣', hp: 200, size: 1,
    cost: { metal: 24 }, buildTime: 1.2, color: '#6a7280', repairable: true,
    desc: '铺一块塔位地基。放在空地上的塔彼此要留间隔；放在基座上的塔不需要间隔，可以一座挨一座摆成火力阵列。',
  },
};

/** 基地核心（自带，不可拆） */
export const BASE_CORE = {
  name: '殖民地核心舱',
  icon: '⌂',
  desc: '吸引阵列与人口都在这里。核心舱被摧毁 = 殖民地陷落。',
};
