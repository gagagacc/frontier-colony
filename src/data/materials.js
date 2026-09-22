/**
 * 材料稀有度 / 怪物掉落权重。
 *
 * 存在的理由：纯塔防模式里没有大世界可以采集，但建塔、修墙、经营城镇
 * 到处都要纤维、木头、食物、冷凝水这些东西。所以必须有一条替代供给线 ——
 * 「按稀有度从怪物身上掉」。
 *
 * 设计要点：
 *   1) 稀有度决定「谁能掉」：1 级小怪不会掉晶体，5 级怪才碰得到数据核心。
 *   2) 常见材料按「每次必掉一点」的节奏给，否则塔防前期会被木头卡死；
 *      稀有材料是概率掉落，是长期目标。
 *   3) 越强的怪（精英/Boss/高等级）掉得越多、越可能碰到稀有档。
 */

/** 材料档位。数字越大越稀有。 */
export const MATERIAL_TIERS = [
  {
    id: 1,
    name: '常见',
    color: '#8ba0bb',
    /** 出现在这个档位的最低怪物等级 */
    minTier: 1,
    /** 每次击杀的掉落概率 */
    chance: 0.42,
    /** 掉落数量区间（会乘怪物的 tier 缩放） */
    range: [1, 2],
    items: ['fiber', 'wood', 'food'],
  },
  {
    id: 2,
    name: '普通',
    color: '#8fc46a',
    minTier: 1,
    chance: 0.26,
    range: [1, 3],
    items: ['water', 'chitin', 'biomass', 'sulfur'],
  },
  {
    id: 3,
    name: '少见',
    color: '#59d8ff',
    minTier: 2,
    chance: 0.16,
    range: [1, 2],
    items: ['metal', 'crystal', 'parts', 'fuel'],
  },
  {
    id: 4,
    name: '稀有',
    color: '#c08cff',
    minTier: 3,
    chance: 0.09,
    range: [1, 2],
    items: ['coolant', 'spore'],
  },
  {
    id: 5,
    name: '珍稀',
    color: '#ffba4c',
    minTier: 4,
    chance: 0.055,
    range: [1, 1],
    items: ['research', 'dna'],
  },
  {
    id: 6,
    name: '极稀有',
    color: '#ff5f6d',
    minTier: 5,
    chance: 0.035,
    range: [1, 1],
    items: ['tech', 'beaconCore'],
  },
];

/** 快速查某材料属于哪一档 */
const ITEM_TIER = (() => {
  const m = new Map();
  for (const t of MATERIAL_TIERS) for (const item of t.items) m.set(item, t);
  return m;
})();

export function materialTierOf(kind) {
  return ITEM_TIER.get(kind) || null;
}

/** 这个怪物等级能掉的材料档位 */
export function tiersForEnemyTier(tier) {
  return MATERIAL_TIERS.filter(t => t.minTier <= tier);
}

/**
 * 掷一次材料掉落。
 *
 * @param {object} opts
 *   - rng         随机数发生器
 *   - tier        怪物等级（1..5），决定能碰到哪些档位
 *   - roleMult    按角色加权：精英 2.2 / Boss 4 / 普通 1
 *   - dropMult    玩家的掉落品质加成
 *   - allow       可选，白名单（比如只允许某些材料）
 * @returns {Array<{kind:string, amount:number, tier:number}>}
 */
export function rollMaterialDrops({ rng, tier = 1, roleMult = 1, dropMult = 1, allow = null }) {
  const out = [];
  if (!rng) return out;
  const pools = tiersForEnemyTier(tier);

  for (const t of pools) {
    const items = allow ? t.items.filter(i => allow.includes(i)) : t.items;
    if (!items.length) continue;
    // 越强的怪，掷中概率越高；但始终留一点「小怪也可能掉好东西」的惊喜
    const p = Math.min(0.92, t.chance * roleMult * dropMult);
    if (!rng.chance(p)) continue;
    const kind = rng.pick(items);
    const [lo, hi] = t.range;
    // 数量随怪物等级略微放大（tier 5 的怪掉 2~3 倍）
    const scale = 1 + (tier - 1) * 0.35;
    const amount = Math.max(1, Math.round(rng.int(lo, hi) * scale * Math.min(2.5, roleMult)));
    out.push({ kind, amount, tier: t.id });
  }
  return out;
}
