/**
 * 星球数据。
 *
 * 玩家清光一颗星球上所有巢穴 → 占领 → 可以选择继续经营，或者开拓下一颗星球。
 * 开拓新星球时：
 *   - 玩家保留【所有升级、装备、实验科技、主科技树】
 *   - 防御塔科技点【重置】（需要在新环境重新申请空投授权）
 *   - 旧星球转入【自动生产】，通过太空快递定期给玩家送物资
 */

export const PLANET_NAMES = [
  '开普勒-442b', '格利泽-581g', '比邻星-b', '特拉比斯特-1e', 'HD-40307g',
  '罗斯-128b', '鲸鱼座-tau-f', '开普勒-186f', '卢坦-b', '蒂加登-b',
  '沃尔夫-1061c', '格利泽-667C-c',
];

export const PLANET_SUFFIX = ['荒原', '冻土', '熔岩', '孢子洋', '晶海', '黑沙', '风暴', '静默'];

/**
 * 星球难度曲线：每颗星球的巢穴更多、怪更强、地形更极端，
 * 但资源产出与特殊掉落也更好。
 */
export function planetDef(index) {
  const i = Math.max(0, index);
  return {
    index: i,
    name: PLANET_NAMES[i % PLANET_NAMES.length] + (i >= PLANET_NAMES.length ? `-${Math.floor(i / PLANET_NAMES.length) + 1}` : ''),
    suffix: PLANET_SUFFIX[i % PLANET_SUFFIX.length],
    nestCount: Math.round(11 + i * 4),
    nestHpMult: 1 + i * 0.45,
    monsterScale: 1 + i * 0.38,
    resourceMult: 1 + i * 0.22,
    // 新环境惩罚：落地时玩家会被削弱，需要靠科技/实验科技抵消
    environment: {
      name: ENV_NAMES[i % ENV_NAMES.length],
      // 每秒环境影响
      playerDebuff: {
        speedMult: -Math.min(0.22, i * 0.03),
        hpRegen: -Math.min(1.2, i * 0.18),
        hazardPerSec: Math.min(2.2, i * 0.25),
      },
      desc: ENV_DESC[i % ENV_DESC.length],
    },
    // 新星球需要重新申请防御塔授权（回到初始 2 座）
    resetTowerTech: i > 0,
    startingSupplies: {
      gold: 260 + Math.round(i * 0.35 * 260),
      metal: 90 + i * 30,
      food: 40 + i * 12,
    },
    // 旧星球太空快递
    supply: {
      interval: Math.max(90, 200 - i * 14),      // 秒
      amount: {
        gold: 60 + i * 22,
        metal: 30 + i * 14,
        food: 18 + i * 6,
        crystal: i > 0 ? 8 + i * 4 : 0,
      },
    },
  };
}

const ENV_NAMES = ['稀薄大气', '强辐射带', '低温尘暴', '高重力', '酸性降雨', '电离风暴', '永夜', '地磁紊乱'];
const ENV_DESC = [
  '氧气含量低，奔跑时消耗更多体力，伤口愈合缓慢。',
  '恒星耀斑频繁，暴露在外会持续受到辐射伤害。',
  '气温常年零下，载具引擎效率下降，需要频繁取暖。',
  '重力是母星的 1.4 倍，移动更费力，但坠落伤害更低。',
  '酸雨腐蚀护甲，外出时间越长损耗越大。',
  '大气电离导致电子设备不稳定，吸引阵列能耗上升。',
  '这颗星球的白天只有两小时，其余时间都是黑夜。',
  '磁场异常让罗盘失灵，小地图精度下降。',
];

/** 定居点建筑（城镇经营层） */
export const TOWN_BUILDING = {
  HAB: 'hab',
  FARM: 'farm',
  MINE: 'mine',
  FOUNDRY: 'foundry',
  CLINIC: 'clinic',
  SCHOOL: 'school',
  MARKET: 'market',
  BARRACKS: 'barracks',
  LAB: 'lab',
  POWER: 'power',
  WATER: 'water',
  ENTERTAIN: 'entertain',
  WORKSHOP: 'workshop',
};

export const TOWN_BUILDING_DEF = {
  [TOWN_BUILDING.HAB]:      { id: 'hab', name: '居住区', icon: '⌂', popCap: 6, cost: { metal: 60, gold: 40 }, jobs: 0, desc: '人口上限 +6。人口是殖民地一切产出的源头。' },
  [TOWN_BUILDING.FARM]:     { id: 'farm', name: '农业区', icon: '❋', popCap: 0, cost: { metal: 50, gold: 30 }, jobs: 3, produce: { food: 0.5 }, desc: '每名工人每秒产 0.5 食物。' },
  [TOWN_BUILDING.MINE]:     { id: 'mine', name: '采掘场', icon: '⛏', popCap: 0, cost: { metal: 80, gold: 55 }, jobs: 3, produce: { metal: 0.4 }, desc: '每名工人每秒产 0.4 金属。' },
  [TOWN_BUILDING.FOUNDRY]:  { id: 'foundry', name: '冶炼厂', icon: '⚒', popCap: 0, cost: { metal: 110, gold: 80 }, jobs: 3, produce: { metal: 0.3, parts: 0.05 }, desc: '把矿石变成零件。' },
  [TOWN_BUILDING.CLINIC]:   { id: 'clinic', name: '医疗中心', icon: '✚', popCap: 0, cost: { metal: 90, gold: 70 }, jobs: 2, heal: 2.2, desc: '提升基地范围内的治疗速度，并降低人口死亡率。' },
  [TOWN_BUILDING.SCHOOL]:   { id: 'school', name: '培训学校', icon: '✎', popCap: 0, cost: { metal: 100, gold: 90 }, jobs: 2, researchRate: 0.6, desc: '每秒产 0.6 研究资料，用于实验科技。' },
  [TOWN_BUILDING.MARKET]:   { id: 'market', name: '贸易市场', icon: '⇄', popCap: 0, cost: { metal: 80, gold: 100 }, jobs: 2, produce: { gold: 0.5 }, desc: '每名工人每秒产 0.5 金币。' },
  [TOWN_BUILDING.BARRACKS]: { id: 'barracks', name: '民兵营', icon: '⚔', popCap: 0, cost: { metal: 120, gold: 90 }, jobs: 3, defense: 12, desc: '怪潮时人口会拿起武器协防（每名工人 +12 基地攻击力）。' },
  [TOWN_BUILDING.LAB]:       { id: 'lab', name: '研究所', icon: '✦', popCap: 0, cost: { metal: 140, gold: 120, crystal: 40 }, jobs: 3, researchRate: 1.2, desc: '大幅提升研究产出，并提高实验科技选项质量。' },
  [TOWN_BUILDING.POWER]:     { id: 'power', name: '发电站', icon: '⚡', popCap: 0, cost: { metal: 130, gold: 100 }, jobs: 2, power: 3, desc: '为吸引阵列供能，降低燃料消耗。' },
  [TOWN_BUILDING.WATER]:     { id: 'water', name: '水处理厂', icon: '◌', popCap: 0, cost: { metal: 90, gold: 60 }, jobs: 2, produce: { water: 0.6 }, desc: '产冷凝水，也提升人口健康度。' },
  [TOWN_BUILDING.ENTERTAIN]: { id: 'entertain', name: '娱乐中心', icon: '♫', popCap: 0, cost: { metal: 90, gold: 110 }, jobs: 2, morale: 0.3, desc: '提升士气：人口增长 +30%，工人效率 +15%。' },
  [TOWN_BUILDING.WORKSHOP]:  { id: 'workshop', name: '军械工坊', icon: '⚒', popCap: 0, cost: { metal: 120, gold: 90, parts: 14 }, jobs: 2, craft: true, desc: '制造护甲与武器。能造什么品质由城镇等级决定，最高紫色 —— 红色只能靠打。' },
};

/** 人口等级：人口越多，上级越愿意派遣更多移民 */
export const POP_TIERS = [
  { pop: 0,   name: '前哨站',   desc: '只有你一个人。', unlock: [] },
  { pop: 6,   name: '定居点',   desc: '上级开始派遣第一批移民。', unlock: ['farm', 'hab', 'workshop'] },
  { pop: 16,  name: '殖民镇',   desc: '形成稳定的生产循环。', unlock: ['mine', 'clinic'] },
  { pop: 30,  name: '拓荒城市', desc: '上级把这里当成区域中心。', unlock: ['foundry', 'market', 'school'] },
  { pop: 50,  name: '殖民都会', desc: '工业与研究能力完整。', unlock: ['lab', 'barracks', 'power'] },
  { pop: 80,  name: '星区首府', desc: '足以支撑跨星系远征。', unlock: ['entertain', 'water'] },
];

export function popTier(pop) {
  let tier = POP_TIERS[0];
  for (const t of POP_TIERS) if (pop >= t.pop) tier = t;
  return tier;
}

export function nextPopTier(pop) {
  for (const t of POP_TIERS) if (pop < t.pop) return t;
  return null;
}
