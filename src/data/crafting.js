/**
 * 城镇制造：护甲与武器。
 *
 * 设计意图（对应「城镇等级越高能造出越高级的装备」）：
 *   - 城镇是**稳定**的装备来源：花钱花材料，一定能拿到想要的那一档。
 *     野外掉落是随机的、看运气的；城镇制造是「我攒够了就能换」。
 *   - 品质上限卡在紫色（TOWN_MAX_RARITY）。红色只能去打 Boss / 废弃基地 /
 *     虫巢深处 —— 保证「最强的那一档」永远来自冒险，而不是来自挂机生产。
 *   - 制造需要【军械工坊】建筑 + 人口等级，两者都上去才能造高档货。
 */

import { RARITY, EQUIP_DEF, WEAPON_DEF, SLOT } from './weapons.js';

/** 城镇能造的最高品质 */
export const CRAFT_MAX_RARITY = RARITY.EPIC;

/**
 * 制造等级：每个等级对应一个品质档 + 人口门槛。
 * 人口门槛直接复用城镇的人口等级（POP_TIERS），玩家的直觉是
 * 「我的镇子变大了，就能造更好的东西」。
 */
export const CRAFT_TIERS = [
  {
    id: 0, name: '初级工坊', rarity: RARITY.COMMON, pop: 0,
    costMult: 1, desc: '白色装备：能用，但只是能用。',
  },
  {
    id: 1, name: '标准工坊', rarity: RARITY.UNCOMMON, pop: 6,
    costMult: 1.6, desc: '绿色装备：殖民地安定下来之后的标配。',
  },
  {
    id: 2, name: '精密工坊', rarity: RARITY.RARE, pop: 16,
    costMult: 2.6, desc: '黄色装备：需要稳定的金属与零件供应。',
  },
  {
    id: 3, name: '高级军械库', rarity: RARITY.EPIC, pop: 30,
    costMult: 4.2, desc: '紫色装备：城镇能造出的最好东西。红色只能靠打。',
  },
];

/** 制造基础费用（按品质倍率放大） */
const BASE_COST = { metal: 60, gold: 45, parts: 6 };

/** 品质 -> 费用倍率（在 CRAFT_TIERS.costMult 之上再乘一次） */
const RARITY_COST = { common: 1, uncommon: 1.5, rare: 2.4, epic: 4 };

/**
 * 可制造的护甲清单：头盔 / 胸甲 / 护腿 三条线都进工坊。
 * tier 越高越贵、越晚能造。
 */
export const CRAFT_ARMOR = Object.values(EQUIP_DEF)
  .filter(d => d.slot === SLOT.HELMET || d.slot === SLOT.CHEST || d.slot === SLOT.LEGS)
  .map(d => ({ kind: 'equip', id: d.id, tier: d.tier || 0, name: d.name, icon: d.icon, slot: d.slot }))
  .sort((a, b) => (a.tier - b.tier) || a.slot.localeCompare(b.slot));

/**
 * 可制造的武器清单。
 * 只放「工坊能产」的量产枪械与近战，角色专属武器不在其中
 * （专属武器是角色的身份象征，不应该能买）。
 */
const CRAFTABLE_WEAPON_IDS = [
  'wrench', 'blade', 'hammer', 'pistol', 'smg', 'rifle', 'shotgun', 'nailgun', 'injector',
];
export const CRAFT_WEAPONS = CRAFTABLE_WEAPON_IDS
  .map(id => WEAPON_DEF[id])
  .filter(Boolean)
  .map(d => ({ kind: 'weapon', id: d.id, name: d.name, icon: d.icon, tags: d.tags || [] }));

/** 指定制造等级的品质与门槛 */
export function craftTier(level) {
  return CRAFT_TIERS[Math.max(0, Math.min(CRAFT_TIERS.length - 1, level))] || CRAFT_TIERS[0];
}

/** 玩家的制造等级：由人口等级决定（popTier 的索引） */
export function craftLevelFor(popTierIndex) {
  return Math.max(0, Math.min(CRAFT_TIERS.length - 1, popTierIndex));
}

/**
 * 算一件东西的制造成本。
 * @param {object} entry CRAFT_ARMOR / CRAFT_WEAPONS 里的一项
 * @param {string} rarity 目标品质
 * @param {number} craftLv 当前制造等级
 */
export function craftCost(entry, rarity, craftLv) {
  const rMult = RARITY_COST[rarity] ?? 1;
  const tMult = 1 + (entry.tier || 0) * 0.35;
  const out = {};
  for (const [k, v] of Object.entries(BASE_COST)) {
    out[k] = Math.round(v * rMult * tMult);
  }
  // 高档品质还要吃稀有材料，避免「只靠金属就能刷紫装」
  if (rarity === RARITY.RARE) out.crystal = Math.round(8 * tMult);
  if (rarity === RARITY.EPIC) { out.crystal = Math.round(22 * tMult); out.parts = (out.parts || 0) + Math.round(6 * tMult); }
  void craftLv;
  return out;
}

/** 这个品质档现在能不能造（人口门槛） */
export function canCraftRarity(rarity, craftLv) {
  const idx = CRAFT_TIERS.findIndex(t => t.rarity === rarity);
  if (idx < 0) return false;              // 红色：城镇永远造不了
  return idx <= craftLv;
}
