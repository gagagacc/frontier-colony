/**
 * 实验科技（Roguelike 层）。
 *
 * 流程：打退一波怪潮（+1 次）/ 消耗研究点 → 先选【方向】(经营 / 塔防 / 探索)
 *       → 再在该方向的池子里【四选一】→ 获得永久机制或数值。
 *
 * 注意：**武器成长的四项数值（射程 / 伤害 / 射速 / 弹道）不在这里**，
 * 它们已经搬到主科技树的「武器成长」线（见 data/tech.js 的 t_gun*），
 * 因为「想加强手里的枪」不该取决于四选一抽到什么。这一层保留的是
 * 机制、解锁、经济与防御类加成。
 *
 * - 效果随存档保留，跨星球保留。
 * - 可以用金币【刷新】四选一的选项，费用按指数递增。
 * - 每个角色有专属实验卡，只在该角色下进入随机池。
 * - 卡片有等级，可以重复抽到叠加（maxLv 限制）。
 *
 * 字段说明：
 *   dir        方向：admin | defense | explore
 *   kind       stat（纯数值）/ mechanic（机制改变）
 *   effect     由 systems/stats.js 的 foldEffects 统一解释
 *   weight     抽取权重（越大越常见）
 *   rarity     展示用稀有度
 *   exclusive  角色专属
 */

export const DIR = {
  ADMIN: 'admin',
  DEFENSE: 'defense',
  EXPLORE: 'explore',
};

export const DIR_DEF = {
  admin:   { name: '经营', icon: '⌂', color: '#6ee7a8', desc: '人口、生产、自动化、经济。让殖民地自己长大。' },
  defense: { name: '塔防', icon: '🛡', color: '#59d8ff', desc: '防御塔、基地、吸引阵列。让基地固若金汤。' },
  explore: { name: '探索', icon: '⛟', color: '#ffba4c', desc: '载具、战斗、野外生存。让你敢走更远。' },
};

export const EXP_RARITY = {
  common: { name: '常规', color: '#a8bcd4', weight: 100 },
  rare:   { name: '进阶', color: '#59d8ff', weight: 46 },
  epic:   { name: '突破', color: '#c08cff', weight: 17 },
  legend: { name: '奇迹', color: '#ffba4c', weight: 4 },
};

export const EXPERIMENTS = [
  // =====================================================================
  //  经营 admin
  // =====================================================================
  { id: 'a_ration', dir: DIR.ADMIN, name: '配给优化', kind: 'stat', rarity: 'common', maxLv: 5, weight: 100,
    effect: { foodEfficiency: 0.15, hpRegen: 0.25 },
    desc: '殖民地配给更合理。食物效果 +15%，生命回复 +0.25/秒。' },
  { id: 'a_toolbox', dir: DIR.ADMIN, name: '标准工具箱', kind: 'stat', rarity: 'common', maxLv: 5, weight: 100,
    effect: { buildSpeed: 0.25, mineSpeed: 0.2 },
    desc: '建造速度 +25%，采集速度 +20%。' },
  { id: 'a_ledger', dir: DIR.ADMIN, name: '殖民地账簿', kind: 'stat', rarity: 'common', maxLv: 5, weight: 95,
    effect: { goldMult: 0.15, matMult: 0.15 },
    desc: '金币与材料获取 +15%。' },
  { id: 'a_storage', dir: DIR.ADMIN, name: '立体仓储', kind: 'stat', rarity: 'common', maxLv: 4, weight: 85,
    effect: { storageCap: 250, carryMult: 0.2 },
    desc: '资源上限 +250，背包 +20%。' },
  { id: 'a_nursery', dir: DIR.ADMIN, name: '育婴舱', kind: 'stat', rarity: 'rare', maxLv: 4, weight: 62,
    effect: { popGrowthMult: 0.45, popCap: 3 },
    desc: '人口增长 +45%，人口上限 +3。' },
  { id: 'a_drone', dir: DIR.ADMIN, name: '回收无人机', kind: 'mechanic', rarity: 'rare', maxLv: 1, weight: 58,
    effect: { autoCollect: 1, autoCollectRadius: 420 },
    desc: '战斗结束后，经验与掉落物由无人机自动回收 —— 你不用再跑回去捡。' },
  { id: 'a_conveyor', dir: DIR.ADMIN, name: '自动传送带', kind: 'mechanic', rarity: 'epic', maxLv: 1, weight: 20,
    effect: { autoCollect: 1, autoCollectRadius: 1500, autoDeposit: 1 },
    desc: '全图范围的自动回收，并直接存入仓库（连基地都不用回）。' },
  { id: 'a_shift', dir: DIR.ADMIN, name: '三班倒制度', kind: 'stat', rarity: 'rare', maxLv: 4, weight: 60,
    effect: { workerEfficiency: 0.35, jobSlots: 1 },
    desc: '工人效率 +35%，每个建筑多 1 个岗位。' },
  { id: 'a_engineerCorps', dir: DIR.ADMIN, name: '工程兵编制', kind: 'mechanic', rarity: 'epic', maxLv: 1, weight: 22,
    effect: { autoRepairBase: 10, repairCostMult: -0.35 },
    desc: '基地范围内建筑自动修复，且维修几乎不耗材料。' },
  { id: 'a_market', dir: DIR.ADMIN, name: '黑市渠道', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 52,
    effect: { tradeDiscount: 0.15, sellBonus: 0.2 },
    desc: '解锁资源互换，汇率优惠 15%，出售收益 +20%。' },
  { id: 'a_taxOffice', dir: DIR.ADMIN, name: '税收署', kind: 'stat', rarity: 'rare', maxLv: 4, weight: 55,
    effect: { passiveGold: 0.7 },
    desc: '每秒自动产生 0.7 金币（离线也结算一部分）。' },
  { id: 'a_expedition', dir: DIR.ADMIN, name: '远征后勤', kind: 'stat', rarity: 'rare', maxLv: 4, weight: 56,
    effect: { xpMult: 0.2, lootQuality: 0.2 },
    desc: '经验 +20%，掉落品质 +20%。' },
  { id: 'a_smelter', dir: DIR.ADMIN, name: '现场冶炼炉', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 50,
    effect: { smeltOnKill: 1 },
    desc: '击杀怪物时直接从尸体提炼金属与硫磺。' },
  { id: 'a_blueprint', dir: DIR.ADMIN, name: '蓝图复用', kind: 'stat', rarity: 'rare', maxLv: 3, weight: 54,
    effect: { buildCostMult: -0.15 },
    desc: '所有建造费用 -15%。' },
  { id: 'a_org', dir: DIR.ADMIN, name: '组织架构学', kind: 'stat', rarity: 'epic', maxLv: 3, weight: 18,
    effect: { popGrowthMult: 0.6, workerEfficiency: 0.4, popCap: 6 },
    desc: '人口增长 +60%、工人效率 +40%、人口上限 +6。' },
  { id: 'a_bank', dir: DIR.ADMIN, name: '殖民地银行', kind: 'mechanic', rarity: 'epic', maxLv: 1, weight: 16,
    effect: { goldInterest: 0.02 },
    desc: '每波怪潮结束后，按当前金币的 2% 结算利息。钱生钱。' },
  { id: 'a_vault', dir: DIR.ADMIN, name: '深层地窖', kind: 'mechanic', rarity: 'epic', maxLv: 1, weight: 15,
    effect: { deathPenaltyImmunity: 1, respawnAtBase: 1 },
    desc: '死亡不再损失携带的资源，并且直接在基地复活。' },
  { id: 'a_geneBank', dir: DIR.ADMIN, name: '基因样本库', kind: 'stat', rarity: 'rare', maxLv: 4, weight: 48,
    effect: { dnaMult: 0.5, bioPointGain: 0.4 },
    desc: '基因样本 +50%，生物科技点获取 +40%。' },
  { id: 'a_beaconGrid', dir: DIR.ADMIN, name: '能源网格', kind: 'stat', rarity: 'rare', maxLv: 4, weight: 52,
    effect: { beaconFuelMult: -0.22, powerOutput: 0.5 },
    desc: '吸引阵列能耗 -22%，发电机输出 +50%。' },
  { id: 'a_legend', dir: DIR.ADMIN, name: '奇迹 · 自给自足', kind: 'mechanic', rarity: 'legend', maxLv: 1, weight: 4,
    effect: { selfSufficient: 1, passiveGold: 2, autoRepairBase: 8, popGrowthMult: 0.5 },
    desc: '奇迹：殖民地进入完全自给状态 —— 每秒 2 金币、建筑自动修复、人口快速增长。你可以长期在外探索。' },

  // =====================================================================
  //  塔防 defense
  // =====================================================================
  { id: 'd_caliber', dir: DIR.DEFENSE, name: '口径加大', kind: 'stat', rarity: 'common', maxLv: 5, weight: 100,
    effect: { towerDamage: 0.16 },
    desc: '所有防御塔伤害 +16%。' },
  { id: 'd_cooling', dir: DIR.DEFENSE, name: '循环冷却', kind: 'stat', rarity: 'common', maxLv: 5, weight: 100,
    effect: { towerAttackSpeed: 0.14 },
    desc: '所有防御塔攻速 +14%。' },
  { id: 'd_range', dir: DIR.DEFENSE, name: '瞄准阵列', kind: 'stat', rarity: 'common', maxLv: 4, weight: 92,
    effect: { towerRange: 0.15 },
    desc: '所有防御塔射程 +15%。' },
  { id: 'd_armor', dir: DIR.DEFENSE, name: '复合装甲', kind: 'stat', rarity: 'common', maxLv: 5, weight: 96,
    effect: { structureHpMult: 0.3, structureArmor: 4 },
    desc: '所有建筑耐久 +30%，护甲 +4。' },
  { id: 'd_cap', dir: DIR.DEFENSE, name: '扩建审批', kind: 'stat', rarity: 'rare', maxLv: 5, weight: 66,
    effect: { towerCap: 3, towerSlotRadius: 60 },
    desc: '防御塔上限 +3，可建造范围扩大。' },
  { id: 'd_explosive', dir: DIR.DEFENSE, name: '爆裂弹头', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 56,
    effect: { towerExplode: { radius: 90, mult: 0.45 } },
    desc: '所有防御塔的攻击附带小范围爆炸（45% 伤害）。' },
  { id: 'd_freeze', dir: DIR.DEFENSE, name: '低温弹链', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 54,
    effect: { towerSlow: { amount: 0.3, dur: 2 }, ignoreSlowResist: 1 },
    desc: '所有防御塔攻击使敌人减速 30%（可叠加来源）。' },
  { id: 'd_incendiary', dir: DIR.DEFENSE, name: '燃烧弹', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 52,
    effect: { towerBurn: { dps: 12, dur: 4 } },
    desc: '防御塔命中使敌人灼烧，4 秒内持续掉血。' },
  { id: 'd_chainAmmo', dir: DIR.DEFENSE, name: '连锁弹药', kind: 'mechanic', rarity: 'epic', maxLv: 2, weight: 20,
    effect: { towerChain: { chains: 3, falloff: 0.7 } },
    desc: '防御塔的攻击会向附近 3 个敌人跳跃传导。' },
  { id: 'd_overcharge', dir: DIR.DEFENSE, name: '过载电容', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 50,
    effect: { towerOvercharge: { every: 8, mult: 3 } },
    desc: '每座塔每 8 秒打出一发 3 倍伤害的过载弹。' },
  { id: 'd_focus', dir: DIR.DEFENSE, name: '集火协议', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 52,
    effect: { focusFire: 0.05 },
    desc: '所有防御塔集火同一目标时，每个额外攻击者 +5% 伤害。虫潮越猛收益越高。' },
  { id: 'd_manual', dir: DIR.DEFENSE, name: '手动接管强化', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 54,
    effect: { manualDamageMult: 0.6, manualSplash: { radius: 110, mult: 0.35 } },
    desc: '你亲手接管的防御塔伤害 +60% 并附带范围伤害。塔防也可以很爽。' },
  { id: 'd_beacon', dir: DIR.DEFENSE, name: '吸引调谐', kind: 'stat', rarity: 'rare', maxLv: 4, weight: 58,
    effect: { beaconRadiusMult: 0.2, beaconIntensityMult: 0.08 },
    desc: '吸引半径 +20%，牵引强度 +8%。拉更多怪 = 更多收益。' },
  { id: 'd_fuel', dir: DIR.DEFENSE, name: '燃料再生', kind: 'stat', rarity: 'rare', maxLv: 4, weight: 60,
    effect: { beaconFuelMult: -0.25, beaconFuelRegen: 0.4 },
    desc: '吸引阵列能耗 -25%，并自动缓慢回能。' },
  { id: 'd_repair', dir: DIR.DEFENSE, name: '战时抢修', kind: 'stat', rarity: 'rare', maxLv: 4, weight: 58,
    effect: { repairMult: 0.6, repairCostMult: -0.25 },
    desc: '维修速度 +60%，材料消耗 -25%。' },
  { id: 'd_airdrop', dir: DIR.DEFENSE, name: '快速空投', kind: 'stat', rarity: 'rare', maxLv: 4, weight: 56,
    effect: { airDropSpeed: -0.4, buildSpeed: 0.4 },
    desc: '防御塔空投与建造速度 +40%。' },
  { id: 'd_lastStand', dir: DIR.DEFENSE, name: '背水一战', kind: 'mechanic', rarity: 'epic', maxLv: 2, weight: 22,
    effect: { lastStand: { hpThreshold: 0.4, towerDamage: 0.5, towerAttackSpeed: 0.5 } },
    desc: '基地耐久低于 40% 时，所有防御塔伤害与攻速 +50%。' },
  { id: 'd_vengeance', dir: DIR.DEFENSE, name: '复仇协议', kind: 'mechanic', rarity: 'epic', maxLv: 2, weight: 20,
    effect: { vengeance: { duration: 20, towerDamage: 0.15, towerAttackSpeed: 0.15 } },
    desc: '每座防御塔被摧毁，其余所有塔永久获得 +15% 伤害与攻速（每波重置）。' },
  { id: 'd_rebuild', dir: DIR.DEFENSE, name: '自动重建', kind: 'mechanic', rarity: 'epic', maxLv: 1, weight: 18,
    effect: { airDropAuto: 1, rebuildDiscount: 0.4 },
    desc: '被摧毁的防御塔会自动重新空投，费用 -40%。' },
  { id: 'd_shieldGen', dir: DIR.DEFENSE, name: '护盾发生器', kind: 'mechanic', rarity: 'epic', maxLv: 2, weight: 17,
    effect: { baseShield: { amount: 800, regen: 20 } },
    desc: '基地获得一层会自行恢复的护盾，先于耐久被消耗。' },
  { id: 'd_legend', dir: DIR.DEFENSE, name: '奇迹 · 钢铁要塞', kind: 'mechanic', rarity: 'legend', maxLv: 1, weight: 4,
    effect: { towerDamage: 0.35, towerAttackSpeed: 0.3, structureHpMult: 0.8, towerCap: 6, towerExplode: { radius: 120, mult: 0.5 } },
    desc: '奇迹：伤害 +35%、攻速 +30%、建筑耐久 +80%、塔上限 +6，且全部攻击带爆炸。基地成为真正的要塞。' },

  // =====================================================================
  //  探索 explore
  // =====================================================================
  { id: 'e_boots', dir: DIR.EXPLORE, name: '轻量外骨骼', kind: 'stat', rarity: 'common', maxLv: 5, weight: 100,
    effect: { speedMult: 0.07 },
    desc: '移动速度 +7%。' },
  { id: 'e_plating', dir: DIR.EXPLORE, name: '个人装甲', kind: 'stat', rarity: 'common', maxLv: 5, weight: 100,
    effect: { hpMax: 22, armor: 3 },
    desc: '生命上限 +22，护甲 +3。' },
  { id: 'e_scope', dir: DIR.EXPLORE, name: '战术目镜', kind: 'stat', rarity: 'common', maxLv: 5, weight: 96,
    effect: { critChance: 0.04, critMult: 0.12 },
    desc: '暴击率 +4%，暴击伤害 +12%。' },
  { id: 'e_medkit', dir: DIR.EXPLORE, name: '野战医疗', kind: 'stat', rarity: 'common', maxLv: 5, weight: 96,
    effect: { hpRegen: 0.6, healPower: 0.25 },
    desc: '生命回复 +0.6/秒，治疗效果 +25%。' },
  { id: 'e_ammo', dir: DIR.EXPLORE, name: '弹药合成', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 60,
    effect: { ammoCraft: 1, ammoCostMult: -0.4 },
    desc: '可在野外用手头材料现场合成弹药，弹药消耗 -40%。' },
  { id: 'e_engine', dir: DIR.EXPLORE, name: '引擎调校', kind: 'stat', rarity: 'rare', maxLv: 5, weight: 62,
    effect: { vehicleSpeedMult: 0.18 },
    desc: '载具速度 +18%。' },
  { id: 'e_hull', dir: DIR.EXPLORE, name: '载具装甲', kind: 'stat', rarity: 'rare', maxLv: 4, weight: 58,
    effect: { vehicleHpMult: 0.5, ramMult: 0.4 },
    desc: '载具耐久 +50%，撞击伤害 +40%。' },
  { id: 'e_harvest', dir: DIR.EXPLORE, name: '高效采集', kind: 'stat', rarity: 'rare', maxLv: 4, weight: 60,
    effect: { mineSpeed: 0.4, matMult: 0.2 },
    desc: '采集速度 +40%，材料获取 +20%。' },
  { id: 'e_luck', dir: DIR.EXPLORE, name: '拾荒者的直觉', kind: 'stat', rarity: 'rare', maxLv: 4, weight: 58,
    effect: { luck: 0.12, lootQuality: 0.25 },
    desc: '幸运 +12%，掉落品质 +25%。' },
  { id: 'e_scanner', dir: DIR.EXPLORE, name: '深层扫描', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 54,
    effect: { revealRadius: 500, resourceSense: 1 },
    desc: '小地图自动标出附近的资源富集点与巢穴。' },
  { id: 'e_beaconPort', dir: DIR.EXPLORE, name: '便携吸引装置', kind: 'mechanic', rarity: 'epic', maxLv: 1, weight: 20,
    effect: { portableBeacon: 1 },
    desc: '载具上可挂一台便携吸引装置 —— 你可以主动决定怪潮往哪冲。' },
  { id: 'e_hunter', dir: DIR.EXPLORE, name: '猎杀本能', kind: 'stat', rarity: 'rare', maxLv: 4, weight: 56,
    effect: { eliteDamage: 0.25, bossDamage: 0.2 },
    desc: '对精英怪伤害 +25%，对 Boss 伤害 +20%。' },
  { id: 'e_lifesteal', dir: DIR.EXPLORE, name: '生命汲取', kind: 'mechanic', rarity: 'epic', maxLv: 3, weight: 22,
    effect: { lifeSteal: 0.04 },
    desc: '造成伤害的 4% 转化为生命。' },
  { id: 'e_thorns', dir: DIR.EXPLORE, name: '应激反射', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 52,
    effect: { thorn: 14, counterWave: { radius: 120, mult: 0.6 } },
    desc: '受到近战伤害时向周围释放冲击波反击。' },
  { id: 'e_night', dir: DIR.EXPLORE, name: '夜行者', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 50,
    effect: { nightVision: 1, nightDamage: 0.3, sightBonus: 200 },
    desc: '夜间视野满格，且夜间伤害 +30%。夜晚变成你的主场。' },
  { id: 'e_thermal', dir: DIR.EXPLORE, name: '环境适应服', kind: 'stat', rarity: 'rare', maxLv: 4, weight: 54,
    effect: { hazardResist: 0.4, coldResist: 0.3, heatResist: 0.3, acidResist: 0.3 },
    desc: '地形伤害与环境惩罚 -40%。' },
  { id: 'e_dash', dir: DIR.EXPLORE, name: '瞬闪模块', kind: 'mechanic', rarity: 'epic', maxLv: 3, weight: 20,
    effect: { dodgeCdMult: -0.3, dodgeDamage: { mult: 1.5, radius: 90 } },
    desc: '闪避冷却 -30%，且闪避穿过的敌人受到 150% 伤害。' },
  { id: 'e_quantum', dir: DIR.EXPLORE, name: '量子背包', kind: 'mechanic', rarity: 'epic', maxLv: 1, weight: 16,
    effect: { carryMult: 2, autoDeposit: 1 },
    desc: '背包容量翻倍，且采集物直接进仓库（不用带回家）。' },
  { id: 'e_relic', dir: DIR.EXPLORE, name: '遗物共鸣', kind: 'mechanic', rarity: 'epic', maxLv: 2, weight: 15,
    effect: { relicChance: 0.12, lootQuality: 0.3 },
    desc: '精英怪有 12% 几率掉落【遗物】级装备。' },
  { id: 'e_supply', dir: DIR.EXPLORE, name: '深空补给线', kind: 'stat', rarity: 'epic', maxLv: 3, weight: 18,
    effect: { supplyDropRate: 0.5 },
    desc: '太空快递的频率 +50%，且每份物资更多。' },
  { id: 'e_legend', dir: DIR.EXPLORE, name: '奇迹 · 独行拓荒者', kind: 'mechanic', rarity: 'legend', maxLv: 1, weight: 4,
    // 不加伤害/攻速了：那两样现在归科技树的【武器火力】线，
    // 实验科技再发一份就是同一件事有两个来源（玩家指出过这个重叠）
    effect: { speedMult: 0.2, lifeSteal: 0.06, xpMult: 0.3, autoCollect: 1, autoCollectRadius: 900, carryMult: 0.5 },
    desc: '奇迹：移速 +20%、吸血 6%、经验 +30%、背包 +50%，并自带大范围自动回收。一个人就是一支远征队。' },

  // =====================================================================
  //  角色专属
  // =====================================================================
  // ---- 工程师 ----
  { id: 'x_eng_ram', dir: DIR.DEFENSE, name: '工程兵准则', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 70, exclusive: 'engineer',
    effect: { repairMult: 0.8, buildSpeed: 0.5, buildCostMult: -0.1 },
    desc: '【工程师】维修 +80%、建造 +50%、建造费 -10%。' },
  { id: 'x_eng_boom', dir: DIR.DEFENSE, name: '自爆协议', kind: 'mechanic', rarity: 'epic', maxLv: 2, weight: 34, exclusive: 'engineer',
    effect: { towerExplodeOnDeath: { radius: 150, dmg: 220 } },
    desc: '【工程师】防御塔被摧毁时自爆，对周围造成 220 伤害 —— 死的塔也要带走几只虫。' },
  { id: 'x_eng_twin', dir: DIR.DEFENSE, name: '双联装塔架', kind: 'mechanic', rarity: 'epic', maxLv: 2, weight: 30, exclusive: 'engineer',
    effect: { towerExtraShot: 1, towerDamage: -0.1 },
    desc: '【工程师】防御塔额外射出一发（伤害 -10% 作为代价）。火力密度翻倍。' },
  { id: 'x_eng_foundry', dir: DIR.ADMIN, name: '前线铸造厂', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 68, exclusive: 'engineer',
    effect: { smeltOnKill: 1, matMult: 0.3 },
    desc: '【工程师】击杀怪物直接提炼金属，材料 +30%。' },
  { id: 'x_eng_blueprint', dir: DIR.ADMIN, name: '完美蓝图', kind: 'mechanic', rarity: 'epic', maxLv: 1, weight: 32, exclusive: 'engineer',
    effect: { towerCap: 8, structureHpMult: 0.4 },
    desc: '【工程师】防御塔上限 +8，建筑耐久 +40%。' },
  // ---- 开拓者 ----
  { id: 'x_pio_rage', dir: DIR.EXPLORE, name: '战意沸腾', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 70, exclusive: 'pioneer',
    effect: { rageBonus: 0.3, lowHpArmor: 10 },
    desc: '【开拓者】血量越低伤害越高（每级 +30% 上限），残血时额外 +10 护甲。' },
  { id: 'x_pio_exec', dir: DIR.EXPLORE, name: '处决', kind: 'mechanic', rarity: 'epic', maxLv: 2, weight: 34, exclusive: 'pioneer',
    effect: { execute: { threshold: 0.16, heal: 12 } },
    desc: '【开拓者】对生命低于 16% 的敌人直接处决，并回复 12 点生命。' },
  { id: 'x_pio_wall', dir: DIR.EXPLORE, name: '破壁冲锋', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 66, exclusive: 'pioneer',
    effect: { dodgeDamage: { mult: 2, radius: 110 }, dodgeCdMult: -0.2 },
    desc: '【开拓者】闪避撞击造成 200% 伤害并击退，冷却 -20%。' },
  { id: 'x_pio_arsenal', dir: DIR.EXPLORE, name: '重武器库', kind: 'mechanic', rarity: 'epic', maxLv: 2, weight: 30, exclusive: 'pioneer',
    // 伤害 / 攻速 / 射程 / 弹道这四样已经搬到科技树的「武器成长」线，
    // 实验科技不再发这些数值 —— 这里改成弹药与穿透，保持卡片本身有用。
    effect: { ammoCostMult: -0.5, pierce: 1 },
    desc: '【开拓者】弹药消耗 -50%，子弹穿透 +1。' },
  { id: 'x_pio_medal', dir: DIR.ADMIN, name: '战功勋章', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 64, exclusive: 'pioneer',
    effect: { goldMult: 0.35, xpMult: 0.25, eliteDamage: 0.15 },
    desc: '【开拓者】金币 +35%、经验 +25%、对精英伤害 +15%。' },
  // ---- 驾驶员 ----
  { id: 'x_pil_gun', dir: DIR.EXPLORE, name: '武器挂架', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 70, exclusive: 'pilot',
    effect: { vehicleSlots: 1, vehicleWeaponDamage: 0.25 },
    desc: '【驾驶员】载具挂载槽 +1，车载武器伤害 +25%。' },
  { id: 'x_pil_turret', dir: DIR.DEFENSE, name: '载具即炮台', kind: 'mechanic', rarity: 'epic', maxLv: 2, weight: 34, exclusive: 'pilot',
    effect: { vehicleAsTurret: 1, vehicleWeaponDamage: 0.3 },
    desc: '【驾驶员】把载具停在基地里时，车载武器会像防御塔一样自动守卫基地。' },
  { id: 'x_pil_ram', dir: DIR.EXPLORE, name: '碾压者', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 68, exclusive: 'pilot',
    effect: { ramMult: 1.4, vehicleHpMult: 0.4, collisionHeal: 4 },
    desc: '【驾驶员】撞击伤害 +140%，每次撞死怪物回复 4 点载具耐久。' },
  { id: 'x_pil_convoy', dir: DIR.ADMIN, name: '运输车队', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 62, exclusive: 'pilot',
    effect: { cargoBonus: 40, matMult: 0.35, vehicleSpeedMult: 0.1 },
    desc: '【驾驶员】载重 +40，材料获取 +35%。' },
  { id: 'x_pil_beacon', dir: DIR.DEFENSE, name: '移动灯塔', kind: 'mechanic', rarity: 'epic', maxLv: 2, weight: 30, exclusive: 'pilot',
    effect: { portableBeacon: 1, beaconIntensity: 0.3 },
    desc: '【驾驶员】载具自带强化版便携吸引装置，牵引强度 +30%。' },
  // ---- 生物学家 ----
  { id: 'x_bio_swarm', dir: DIR.EXPLORE, name: '共生虫群', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 70, exclusive: 'biologist',
    effect: { tameSlots: 2, tamePower: 0.25 },
    desc: '【生物学家】驯化上限 +2，驯化单位属性 +25%。' },
  { id: 'x_bio_acid', dir: DIR.EXPLORE, name: '强酸体液', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 68, exclusive: 'biologist',
    effect: { poisonOnHit: 8, dotMult: 0.5 },
    desc: '【生物学家】攻击附带中毒，持续伤害 +50%。' },
  { id: 'x_bio_regen', dir: DIR.ADMIN, name: '组织再生', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 66, exclusive: 'biologist',
    effect: { regenPct: 0.008, healPower: 0.4 },
    desc: '【生物学家】每秒回复最大生命的 0.8%，治疗效果 +40%。' },
  { id: 'x_bio_harvest', dir: DIR.ADMIN, name: '生物质精炼', kind: 'mechanic', rarity: 'rare', maxLv: 3, weight: 64, exclusive: 'biologist',
    effect: { dnaMult: 0.8, bioPointGain: 0.8, matMult: 0.2 },
    desc: '【生物学家】基因样本 +80%，生物科技点 +80%。' },
  { id: 'x_bio_control', dir: DIR.DEFENSE, name: '虫群支配', kind: 'mechanic', rarity: 'epic', maxLv: 2, weight: 32, exclusive: 'biologist',
    effect: { tameElite: 1, hiveGuard: 1, monsterFriendly: 1 },
    desc: '【生物学家】可驯化精英怪，并让巢穴守卫暂时为你而战。' },
];

export const EXP_MAP = Object.fromEntries(EXPERIMENTS.map(e => [e.id, e]));

/** 取某个方向的候选池（已过滤角色专属） */
export function poolFor(dir, characterId) {
  return EXPERIMENTS.filter(e =>
    e.dir === dir && (!e.exclusive || e.exclusive === characterId));
}

/** 加权抽取时考虑已持有的等级（越高级越难再抽到） */
export function weightOf(exp, level) {
  const base = (EXP_RARITY[exp.rarity]?.weight ?? 50) * (exp.weight / 100);
  const lvFade = 1 / (1 + level * 0.85);
  return base * lvFade;
}

/** 刷新费用：指数递增 */
export function refreshCost(refreshCount, discount = 0) {
  const base = 45 * Math.pow(1.85, refreshCount);
  return Math.max(20, Math.round(base * (1 - discount)));
}
