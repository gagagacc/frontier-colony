/**
 * 主科技树 —— 玩家花【资源 + 金币】向上级殖民政府「申请」解锁。
 * 这是稳定、可预期的成长线，和随机的实验科技互补。
 *
 * 分支：防御 / 武器火力 / 经营 / 探索（外加 生物 支线，仅生物学家可用）
 * effect 的键由 systems/stats.js 的 foldEffects 统一解释。
 */

export const BRANCH = {
  DEFENSE: 'defense',
  WEAPON: 'weapon',
  ADMIN: 'admin',
  EXPLORE: 'explore',
  BIO: 'bio',
  VEHICLE: 'vehicle',
};

export const BRANCH_DEF = {
  defense: { name: '防御工程', icon: '🛡', color: '#59d8ff', desc: '防御塔、基地结构、吸引阵列。' },
  weapon:  { name: '武器火力', icon: '✦', color: '#ff9a4c', desc: '手里的枪：射程 / 伤害 / 射速 / 弹道四条线，上限写在节点说明里。' },
  admin:   { name: '殖民经营', icon: '⌂', color: '#6ee7a8', desc: '人口、生产、自动化、贸易。' },
  explore: { name: '远征探索', icon: '⛟', color: '#ffba4c', desc: '载具、背包、野外生存、地形适应。' },
  vehicle: { name: '载具工程', icon: '⚙', color: '#6ee7a8', desc: '仅驾驶员：车载炮塔、车载武器与底盘改装。' },
  bio:     { name: '异星生物', icon: '❋', color: '#c08cff', desc: '仅生物学家：基因缝合与驯化。' },
};

/**
 * cost: { gold, metal, crystal, parts, tech, research }
 * req: [前置科技 id]
 * tier: 显示用层级（从左往右第几列）
 * lane: 可选。同一分支里全都写了 lane 时，列内的行位置由 lane 决定，
 *       而不是「竖着往下堆」—— 武器火力那四条平行线靠它排成一列一行。
 */
export const TECH_DEF = [
  // ================= 防御 =================
  {
    id: 't_turretSlot', branch: BRANCH.DEFENSE, tier: 0, name: '塔位地基铺设', icon: '▣',
    cost: { gold: 80, metal: 30 }, req: [],
    effect: { unlockStructure: 'turretSlot', towerCap: 2 },
    desc: '解锁【防御塔基座】与空投申请流程。防御塔上限 +2。'
        + '空地上的塔彼此要留间隔；铺了基座之后，塔可以一座挨一座摆成火力阵列。',
  },
  {
    id: 't_beacon1', branch: BRANCH.DEFENSE, tier: 0, name: '吸引阵列 · 一级调频', icon: '◎',
    cost: { gold: 120, metal: 40 }, req: [],
    effect: { beaconLevel: 1 },
    desc: '吸引阵列升到 1 级：吸引半径 +300，牵引强度 +14%。怪更多，但掉落的金币与经验也更多。',
  },
  {
    id: 't_repair1', branch: BRANCH.DEFENSE, tier: 1, name: '快速维修流程', icon: '⚙',
    cost: { gold: 140, metal: 50 }, req: ['t_turretSlot'],
    effect: { repairMult: 0.5, repairCostMult: -0.2 },
    desc: '维修速度 +50%，维修材料消耗 -20%。走到受损的塔旁边按住 E 就是修它。',
  },
  {
    id: 't_gatling', branch: BRANCH.DEFENSE, tier: 1, name: '转管机炮授权', icon: '▤',
    cost: { gold: 200, metal: 70, parts: 10 }, req: ['t_turretSlot'],
    effect: { unlockTower: 'gatling' },
    desc: '解锁【转管机炮】空投申请。',
  },
  {
    id: 't_wall1', branch: BRANCH.DEFENSE, tier: 1, name: '合金围墙', icon: '▬',
    cost: { gold: 110, metal: 60 }, req: [],
    effect: { unlockStructure: 'wall', unlockStructure2: 'gate', structureHpMult: 0.25 },
    desc: '解锁围墙与闸门，所有建筑耐久 +25%。',
  },
  {
    id: 't_mortar', branch: BRANCH.DEFENSE, tier: 2, name: '迫击炮位授权', icon: '◎',
    cost: { gold: 260, metal: 90, parts: 16 }, req: ['t_gatling'],
    effect: { unlockTower: 'mortar' },
    desc: '解锁【迫击炮位】。范围伤害，专治虫潮。',
  },
  {
    id: 't_sniper', branch: BRANCH.DEFENSE, tier: 2, name: '狙击塔授权', icon: '⌖',
    cost: { gold: 280, metal: 85, parts: 18 }, req: ['t_gatling'],
    effect: { unlockTower: 'sniper' },
    desc: '解锁【狙击塔】。超远射程点杀精英。',
  },
  {
    id: 't_flame', branch: BRANCH.DEFENSE, tier: 2, name: '喷焰塔授权', icon: '🔥',
    cost: { gold: 240, metal: 70, sulfur: 40 }, req: ['t_wall1'],
    effect: { unlockTower: 'flameTower' },
    desc: '解锁【喷焰塔】。近距持续灼烧。',
  },
  {
    id: 't_beacon2', branch: BRANCH.DEFENSE, tier: 2, name: '吸引阵列 · 二级调频', icon: '◎',
    cost: { gold: 320, metal: 100, crystal: 20 }, req: ['t_beacon1'],
    effect: { beaconLevel: 1, beaconFuelMult: -0.15 },
    desc: '吸引阵列再升 1 级，燃料消耗 -15%。',
  },
  {
    id: 't_cryo', branch: BRANCH.DEFENSE, tier: 3, name: '低温投射器授权', icon: '❄',
    cost: { gold: 360, metal: 110, coolant: 50 }, req: ['t_mortar'],
    effect: { unlockTower: 'cryo' },
    desc: '解锁【低温投射器】。范围减速。',
  },
  {
    id: 't_tesla', branch: BRANCH.DEFENSE, tier: 3, name: '电弧线圈授权', icon: '☈',
    cost: { gold: 420, metal: 120, crystal: 45 }, req: ['t_cryo'],
    effect: { unlockTower: 'tesla' },
    desc: '解锁【电弧线圈】。链式闪电。',
  },
  {
    id: 't_rail', branch: BRANCH.DEFENSE, tier: 4, name: '磁轨炮塔授权', icon: '⚡',
    cost: { gold: 520, metal: 180, crystal: 60, parts: 30 }, req: ['t_tesla'],
    effect: { unlockTower: 'rail' },
    desc: '解锁【磁轨炮塔】。穿透一线。',
  },
  {
    id: 't_landing', branch: BRANCH.DEFENSE, tier: 3, name: '空投引导坪', icon: '⛬',
    cost: { gold: 400, metal: 150, parts: 26 }, req: ['t_mortar'],
    effect: { unlockStructure: 'landingPad', airDropSpeed: -0.35 },
    desc: '解锁【空投引导坪】，防御塔空投时间 -35%。',
  },
  {
    id: 't_repair', branch: BRANCH.DEFENSE, tier: 3, name: '自动维修坞', icon: '⚙',
    cost: { gold: 380, metal: 130, parts: 24 }, req: ['t_repair1'],
    effect: { unlockStructure: 'repairBay' },
    desc: '解锁【自动维修坞】。基地内建筑自动回耐久。',
  },
  {
    id: 't_beacon3', branch: BRANCH.DEFENSE, tier: 4, name: '吸引阵列 · 共振核心', icon: '◎',
    cost: { gold: 600, metal: 200, crystal: 80, beaconCore: 2 }, req: ['t_beacon2'],
    effect: { beaconLevel: 2, beaconIntensityMult: 0.1 },
    desc: '吸引阵列连升 2 级，牵引强度额外 +10%。收益与风险同时拉满。',
  },
  {
    id: 't_towerOverclock', branch: BRANCH.DEFENSE, tier: 4, name: '防御塔超频', icon: '≋',
    cost: { gold: 560, metal: 160, crystal: 70 }, req: ['t_rail'],
    effect: { towerDamage: 0.2, towerAttackSpeed: 0.15, towerCap: 4 },
    desc: '所有防御塔伤害 +20%、攻速 +15%，上限 +4。',
  },
  /*
   * 玩家要求「防御工程里再加一些塔位」。
   * 原来这一支只有 1 个塔位地基 + 超频那一点点上限，中期就不够摆了。
   * 现在补成一条**塔位扩建**线（独立于塔种授权），再补两座还没进树的塔。
   */
  {
    id: 't_towerCap1', branch: BRANCH.DEFENSE, tier: 1, name: '塔位扩建 · Ⅰ', icon: '▦',
    cost: { gold: 160, metal: 70 }, req: ['t_turretSlot'],
    effect: { towerCap: 3 },
    desc: '可同时存在的防御塔 +3。塔位是硬上限，先铺地基再谈火力。',
  },
  /*
   * 玩家要求「城镇里那么多需要解锁的都加到科技里」。
   * 城镇的 13 种建筑原来只靠人口/档位解锁，看不到"还要做什么"；
   * 现在把中后期那几种挂到后勤管理分支上 —— 想建就先研究，路径一目了然。
   */
  {
    id: 't_townLab', branch: BRANCH.ADMIN, tier: 2, name: '研究所审批', icon: '⌬',
    cost: { gold: 240, metal: 110, parts: 10 }, req: [],
    effect: { unlockTown: 'lab' },
    desc: '解锁城镇建筑【研究所】。',
  },
  {
    id: 't_townClinic', branch: BRANCH.ADMIN, tier: 2, name: '医疗中心审批', icon: '✚',
    cost: { gold: 220, metal: 100 }, req: [],
    effect: { unlockTown: 'clinic' },
    desc: '解锁城镇建筑【医疗中心】。',
  },
  {
    id: 't_townSchool', branch: BRANCH.ADMIN, tier: 3, name: '培训学校审批', icon: '✎',
    cost: { gold: 320, metal: 140, parts: 12 }, req: ['t_townClinic'],
    effect: { unlockTown: 'school' },
    desc: '解锁城镇建筑【培训学校】。',
  },
  {
    id: 't_townMarket', branch: BRANCH.ADMIN, tier: 3, name: '贸易市场审批', icon: '⇄',
    cost: { gold: 380, metal: 160 }, req: [],
    effect: { unlockTown: 'market', goldMult: 0.15 },
    desc: '解锁城镇建筑【贸易市场】，金币收益 +15%。',
  },
  {
    id: 't_townBarracks', branch: BRANCH.ADMIN, tier: 4, name: '民兵营审批', icon: '⚔',
    cost: { gold: 460, metal: 200, parts: 20 }, req: ['t_townSchool'],
    effect: { unlockTown: 'barracks' },
    desc: '解锁城镇建筑【民兵营】。',
  },
  {
    id: 't_townPower', branch: BRANCH.ADMIN, tier: 4, name: '发电站审批', icon: '⌁',
    cost: { gold: 520, metal: 240, crystal: 40 }, req: ['t_townLab'],
    effect: { unlockTown: 'power' },
    desc: '解锁城镇建筑【发电站】。',
  },
  {
    id: 't_townWater', branch: BRANCH.ADMIN, tier: 5, name: '水处理厂审批', icon: '◌',
    cost: { gold: 560, metal: 260, crystal: 45 }, req: ['t_townPower'],
    effect: { unlockTown: 'water' },
    desc: '解锁城镇建筑【水处理厂】。',
  },
  {
    id: 't_townFun', branch: BRANCH.ADMIN, tier: 5, name: '娱乐中心审批', icon: '♬',
    cost: { gold: 600, metal: 240, parts: 30 }, req: ['t_townMarket'],
    effect: { unlockTown: 'entertain', popGrowthMult: 0.2 },
    desc: '解锁城镇建筑【娱乐中心】，人口增长 +20%。',
  },
  {
    id: 't_townWorkshop', branch: BRANCH.ADMIN, tier: 6, name: '军械工坊审批', icon: '⚒',
    cost: { gold: 820, metal: 380, crystal: 80, parts: 40 }, req: ['t_townBarracks', 't_townPower'],
    effect: { unlockTown: 'workshop' },
    desc: '解锁城镇建筑【军械工坊】—— 造装备的前提。',
  },
  {
    id: 't_towerCap2', branch: BRANCH.DEFENSE, tier: 2, name: '塔位扩建 · Ⅱ', icon: '▦',
    cost: { gold: 280, metal: 120, parts: 12 }, req: ['t_towerCap1'],
    effect: { towerCap: 4 },
    desc: '可同时存在的防御塔再 +4。',
  },
  {
    id: 't_towerCap3', branch: BRANCH.DEFENSE, tier: 3, name: '塔位扩建 · Ⅲ', icon: '▦',
    cost: { gold: 460, metal: 200, crystal: 30 }, req: ['t_towerCap2'],
    effect: { towerCap: 5 },
    desc: '可同时存在的防御塔再 +5。配合自动维修，能撑起一条完整的防线。',
  },
  {
    id: 't_towerCap4', branch: BRANCH.DEFENSE, tier: 5, name: '塔位扩建 · Ⅳ', icon: '▦',
    cost: { gold: 780, metal: 340, crystal: 70 }, req: ['t_towerCap3', 't_towerOverclock'],
    effect: { towerCap: 6, towerDamage: 0.1 },
    desc: '可同时存在的防御塔再 +6，并附带塔伤害 +10%。',
  },
  {
    id: 't_towerCapFound', branch: BRANCH.DEFENSE, tier: 2, name: '复合塔位地基', icon: '▣',
    cost: { gold: 210, metal: 90 }, req: ['t_turretSlot'],
    effect: { unlockStructure: 'turretSlot', towerCap: 2, structureHpMult: 0.2 },
    desc: '再解锁一批塔位地基，地基耐久 +20%。',
  },
  {
    id: 't_slotPush', branch: BRANCH.DEFENSE, tier: 4, name: '前沿塔位', icon: '⇥',
    cost: { gold: 400, metal: 160, parts: 20 }, req: ['t_towerCap2'],
    effect: { towerCap: 3, towerRange: 0.15 },
    desc: '塔位 +3，且所有塔射程 +15%。',
  },

  // ================= 经营 =================
  {
    id: 't_habitat', branch: BRANCH.ADMIN, tier: 0, name: '居住舱建造', icon: '⌂',
    cost: { gold: 90, metal: 40 }, req: [],
    effect: { unlockStructure: 'habitat', popCap: 4 },
    desc: '解锁【居住舱】。人口上限 +4，人口会自动增长。',
  },
  {
    id: 't_autoCollect', branch: BRANCH.ADMIN, tier: 1, name: '自动拾取协议', icon: '⌖',
    cost: { gold: 220, metal: 60, tech: 2 }, req: ['t_habitat'],
    effect: { autoCollect: 1, autoCollectRadius: 300 },
    desc: '战斗结束后经验与掉落物由殖民地的回收无人机自动收集，不用再一个个捡。',
  },
  {
    id: 't_farm', branch: BRANCH.ADMIN, tier: 1, name: '水培农场', icon: '❋',
    cost: { gold: 130, metal: 50, fiber: 40 }, req: ['t_habitat'],
    effect: { unlockStructure: 'farm' },
    desc: '解锁【水培农场】，人口驻守可产食物。',
  },
  {
    id: 't_storage', branch: BRANCH.ADMIN, tier: 1, name: '仓储舱', icon: '▥',
    cost: { gold: 110, metal: 45 }, req: [],
    effect: { unlockStructure: 'storage', storageCap: 300 },
    desc: '解锁仓储舱，资源上限 +300。',
  },
  {
    id: 't_generator', branch: BRANCH.ADMIN, tier: 2, name: '地热发电机', icon: '⚡',
    cost: { gold: 260, metal: 90, parts: 18 }, req: ['t_farm'],
    effect: { unlockStructure: 'generator', beaconFuelMult: -0.3 },
    desc: '解锁【地热发电机】，吸引阵列能耗 -30%。',
  },
  {
    id: 't_clinic', branch: BRANCH.ADMIN, tier: 2, name: '医疗站', icon: '✚',
    cost: { gold: 200, metal: 70, parts: 14 }, req: ['t_farm'],
    effect: { unlockStructure: 'clinic', baseHeal: 1.4 },
    desc: '解锁【医疗站】。基地范围内持续治疗。',
  },
  {
    id: 't_popGrowth', branch: BRANCH.ADMIN, tier: 2, name: '移民招募计划', icon: '⇈',
    cost: { gold: 300, metal: 80, food: 60 }, req: ['t_habitat'],
    effect: { popGrowthMult: 0.6, popCap: 6, workerEfficiency: 0.2 },
    desc: '人口增长速度 +60%，上限 +6，工人效率 +20%。',
  },
  {
    id: 't_trade', branch: BRANCH.ADMIN, tier: 3, name: '贸易站', icon: '⇄',
    cost: { gold: 340, metal: 100, parts: 20 }, req: ['t_storage'],
    effect: { unlockStructure: 'tradePost', tradeDiscount: 0.12 },
    desc: '解锁【贸易站】，可把多余材料换成缺的，汇率优惠 12%。',
  },
  {
    id: 't_workshop', branch: BRANCH.ADMIN, tier: 3, name: '工坊', icon: '⚒',
    cost: { gold: 380, metal: 120, parts: 26 }, req: ['t_trade'],
    effect: { unlockStructure: 'workshop', upgradeDiscount: 0.15 },
    desc: '解锁【工坊】，装备强化费用 -15%，可改造武器。',
  },
  {
    id: 't_lab', branch: BRANCH.ADMIN, tier: 3, name: '实验舱', icon: '✦',
    cost: { gold: 460, metal: 140, crystal: 50, research: 4 }, req: ['t_trade'],
    effect: { unlockStructure: 'lab', experimentRefreshDiscount: 0.25 },
    desc: '解锁【实验舱】：实验科技刷新费用 -25%，同时提升每次刷新的选项质量。',
  },
  {
    id: 't_autoRepair', branch: BRANCH.ADMIN, tier: 4, name: '全自动维护', icon: '⟳',
    cost: { gold: 520, metal: 160, parts: 34 }, req: ['t_workshop'],
    effect: { autoRepairBase: 6, repairCostMult: -0.25 },
    desc: '基地建筑每秒自动恢复 6 点耐久，维修材料再省 25%。',
  },
  {
    id: 't_autoTurret', branch: BRANCH.ADMIN, tier: 4, name: '空投自动化', icon: '⛬',
    cost: { gold: 600, metal: 200, parts: 40, tech: 4 }, req: ['t_autoRepair', 't_landing'],
    effect: { airDropAuto: 1, airDropSpeed: -0.4 },
    desc: '被摧毁的防御塔会自动重新空投（消耗资源），空投速度再 -40%。',
  },
  {
    id: 't_secondBase', branch: BRANCH.ADMIN, tier: 5, name: '第二基地授权', icon: '⌂⌂',
    cost: { gold: 900, metal: 300, parts: 60, tech: 6 }, req: ['t_autoTurret', 't_beacon2'],
    effect: { secondBase: 1, towerCap: 6 },
    desc: '上级批准建立【第二基地】。你可以在大地图上另选一处筑城，两座基地共享人口与科技。',
  },

  // ================= 武器成长（射程 / 伤害 / 射速 / 弹道） =================
  /*
   * 这四条线原来散落在「实验科技」的随机卡里 —— 想加强武器只能等四选一抽到。
   * 现在它们是稳定的科技树节点：花资源就能一级一级往上推，上限写在明面上：
   *
   *   射程 最多 300%（rangeMult +200%，5 级 × 40%）
   *   伤害 最多 300%（damage    +200%，5 级 × 40%）
   *   射速 最多 200%（attackSpeed +100%，5 级 × 20%）
   *   弹道 最多 3 条（projectiles +2，2 级 × 1）
   *
   * 上限由 core/config.js 的 WEAPON_CAPS 在读属性时强制执行 ——
   * 科技、实验科技、装备词缀、红色装备效果全都叠到同一个键上，
   * 只靠「这里不超标」是守不住的。
   *
   * 这四条线单独占一个分支页（BRANCH.WEAPON）：17 个节点塞进「防御工程」
   * 会把整张图撑到面板外面去，而这一页正好是玩家最常来看的。
   */
  {
    id: 't_gunRange1', branch: BRANCH.WEAPON, tier: 1, lane: 0, name: '枪管延长 · Ⅰ', icon: '⌐',
    cost: { gold: 130, metal: 40 }, req: ['t_turretSlot'],
    effect: { rangeMult: 0.4 },
    desc: '武器射程 +40%（上限 300%）。打得远 = 挨得少。',
  },
  {
    id: 't_gunRange2', branch: BRANCH.WEAPON, tier: 2, lane: 0, name: '枪管延长 · Ⅱ', icon: '⌐',
    cost: { gold: 220, metal: 70, parts: 10 }, req: ['t_gunRange1'],
    effect: { rangeMult: 0.4 },
    desc: '武器射程再 +40%（累计 +80%）。',
  },
  {
    id: 't_gunRange3', branch: BRANCH.WEAPON, tier: 3, lane: 0, name: '枪管延长 · Ⅲ', icon: '⌐',
    cost: { gold: 360, metal: 110, parts: 20 }, req: ['t_gunRange2'],
    effect: { rangeMult: 0.4 },
    desc: '武器射程再 +40%（累计 +120%）。',
  },
  {
    id: 't_gunRange4', branch: BRANCH.WEAPON, tier: 4, lane: 0, name: '枪管延长 · Ⅳ', icon: '⌐',
    cost: { gold: 540, metal: 170, parts: 32 }, req: ['t_gunRange3'],
    effect: { rangeMult: 0.4 },
    desc: '武器射程再 +40%（累计 +160%）。',
  },
  {
    id: 't_gunRange5', branch: BRANCH.WEAPON, tier: 5, lane: 0, name: '枪管延长 · Ⅴ（满）', icon: '⌐',
    cost: { gold: 780, metal: 240, parts: 48, tech: 3 }, req: ['t_gunRange4'],
    effect: { rangeMult: 0.4 },
    desc: '武器射程再 +40%',
  },
  {
    id: 't_gunDmg1', branch: BRANCH.WEAPON, tier: 1, lane: 1, name: '弹药改良 · Ⅰ', icon: '✦',
    cost: { gold: 140, metal: 45 }, req: ['t_turretSlot'],
    effect: { damage: 0.4 },
    desc: '武器伤害 +40%（上限 300%）。',
  },
  {
    id: 't_gunDmg2', branch: BRANCH.WEAPON, tier: 2, lane: 1, name: '弹药改良 · Ⅱ', icon: '✦',
    cost: { gold: 240, metal: 80, parts: 12 }, req: ['t_gunDmg1'],
    effect: { damage: 0.4 },
    desc: '武器伤害再 +40%（累计 +80%）。',
  },
  {
    id: 't_gunDmg3', branch: BRANCH.WEAPON, tier: 3, lane: 1, name: '弹药改良 · Ⅲ', icon: '✦',
    cost: { gold: 380, metal: 120, parts: 22 }, req: ['t_gunDmg2'],
    effect: { damage: 0.4 },
    desc: '武器伤害再 +40%（累计 +120%）。',
  },
  {
    id: 't_gunDmg4', branch: BRANCH.WEAPON, tier: 4, lane: 1, name: '弹药改良 · Ⅳ', icon: '✦',
    cost: { gold: 560, metal: 180, parts: 34 }, req: ['t_gunDmg3'],
    effect: { damage: 0.4 },
    desc: '武器伤害再 +40%（累计 +160%）。',
  },
  {
    id: 't_gunDmg5', branch: BRANCH.WEAPON, tier: 5, lane: 1, name: '弹药改良 · Ⅴ（满）', icon: '✦',
    cost: { gold: 820, metal: 260, parts: 52, tech: 4 }, req: ['t_gunDmg4'],
    effect: { damage: 0.4 },
    desc: '武器伤害再 +40%',
  },
  {
    id: 't_gunRate1', branch: BRANCH.WEAPON, tier: 2, lane: 2, name: '击发机构 · Ⅰ', icon: '⚡',
    cost: { gold: 200, metal: 65, parts: 10 }, req: ['t_gatling'],
    effect: { attackSpeed: 0.2 },
    desc: '武器射速 +20%（上限 200%）。',
  },
  {
    id: 't_gunRate2', branch: BRANCH.WEAPON, tier: 3, lane: 2, name: '击发机构 · Ⅱ', icon: '⚡',
    cost: { gold: 330, metal: 105, parts: 20 }, req: ['t_gunRate1'],
    effect: { attackSpeed: 0.2 },
    desc: '武器射速再 +20%（累计 +40%）。',
  },
  {
    id: 't_gunRate3', branch: BRANCH.WEAPON, tier: 4, lane: 2, name: '击发机构 · Ⅲ', icon: '⚡',
    cost: { gold: 500, metal: 160, parts: 30 }, req: ['t_gunRate2'],
    effect: { attackSpeed: 0.2 },
    desc: '武器射速再 +20%（累计 +60%）。',
  },
  {
    id: 't_gunRate4', branch: BRANCH.WEAPON, tier: 5, lane: 2, name: '击发机构 · Ⅳ', icon: '⚡',
    cost: { gold: 700, metal: 220, parts: 42 }, req: ['t_gunRate3'],
    effect: { attackSpeed: 0.2 },
    desc: '武器射速再 +20%（累计 +80%）。',
  },
  {
    id: 't_gunRate5', branch: BRANCH.WEAPON, tier: 6, lane: 2, name: '击发机构 · Ⅴ（满）', icon: '⚡',
    cost: { gold: 950, metal: 290, parts: 58, tech: 5 }, req: ['t_gunRate4'],
    effect: { attackSpeed: 0.2 },
    desc: '武器射速再 +20%',
  },
  {
    id: 't_gunBarrel1', branch: BRANCH.WEAPON, tier: 4, lane: 3, name: '多管弹道 · 双联', icon: '⋔',
    cost: { gold: 620, metal: 210, parts: 40, tech: 2 }, req: ['t_gunDmg2', 't_gunRate2'],
    effect: { projectiles: 1 },
    desc: '同时射出 2 条弹道，每条独立结算伤害与穿透（弹药按弹道条数消耗）。',
  },
  {
    id: 't_gunBarrel2', branch: BRANCH.WEAPON, tier: 6, lane: 3, name: '多管弹道 · 三联（满）', icon: '⋔',
    cost: { gold: 1100, metal: 340, parts: 70, tech: 6 }, req: ['t_gunBarrel1', 't_gunRate3'],
    effect: { projectiles: 1 },
    desc: '同时射出 3 条弹道',
  },

  // ================= 探索 =================
  {
    /*
     * 载具的第一道门。
     *
     * 开局只能步行 —— 这不是限制，是节奏设计：
     * 前 10 分钟你能走到的就是基地周边那一圈资源，采完就该攒材料申请载具；
     * 载具到手之后，更远、更值钱、也更危险的资源点才真正进入你的活动半径。
     * 这条线让「攒一波资源」变成一个有明确目标的阶段，而不是无限刷。
     */
    id: 't_vehicle0', branch: BRANCH.EXPLORE, hideFor: ['pilot'], tier: 0, name: '载具申请 · 拓荒运输车', icon: '⛟',
    cost: { gold: 180, metal: 70, parts: 12 }, req: [],
    effect: { vehicleUnlock: 1 },
    desc: '向殖民政府申请第一台载具。在此之前你只能步行，活动范围就是基地周边。'
        + '载具让你能够到更远的资源点 —— 但也要算好油量和回程。',
  },
  {
    id: 't_vehicle1', branch: BRANCH.VEHICLE, exclusive: 'pilot', tier: 1, name: '载具改装 · 引擎', icon: '⚙',
    cost: { gold: 220, metal: 80, parts: 8 }, req: ['t_vehicle0'],
    effect: { vehicleSpeedMult: 0.18 },
    desc: '载具速度 +18%。引擎是载具升级里最直接的一档，但仍然追不上「想去哪就去哪」。',
  },
  {
    id: 't_vehicleRam', branch: BRANCH.VEHICLE, exclusive: 'pilot', tier: 1, name: '悬挂 · 破障撞角', icon: '◤',
    cost: { gold: 200, metal: 90, parts: 10 }, req: ['t_vehicle0'],
    effect: { vehicleMelee: 'plow', ramMult: 0.35 },
    desc: '车头加装【破障撞角】：撞击伤害 +35%，撞开普通虫群更轻松（精英怪依然能别住你）。',
  },
  {
    id: 't_vehicleSaw', branch: BRANCH.VEHICLE, exclusive: 'pilot', tier: 2, name: '悬挂 · 旋切电锯', icon: '⚔',
    cost: { gold: 300, metal: 110, parts: 18 }, req: ['t_vehicleRam'],
    effect: { vehicleMelee: 'saw', ramMult: 0.6 },
    desc: '车侧加装【旋切电锯】：撞击伤害再 +60%，且撞击时附带持续流血。',
  },
  {
    id: 't_vehicleTurret', branch: BRANCH.VEHICLE, exclusive: 'pilot', tier: 2, name: '载具炮塔挂架', icon: '▤',
    cost: { gold: 320, metal: 120, parts: 20 }, req: ['t_vehicle1'],
    effect: { vehicleSlots: 2, vehicleTurretCap: 2 },
    desc: '车顶加装 2 个炮塔挂架：边开车边自动开火。',
  },
  /*
   * 玩家要求：「把驾驶员才能加装的炮塔和载具武器专属给驾驶员」。
   * 原来只有「炮塔挂架」这一个节点，挂上去之后没东西可装 —— 这里补三件车载武器。
   */
  {
    id: 't_vehicleGun', branch: BRANCH.VEHICLE, tier: 2, name: '车载机枪', icon: '⁍', exclusive: 'pilot',
    cost: { gold: 260, metal: 110, parts: 12 }, req: ['t_vehicleTurret'],
    effect: { vehicleWeaponUnlock: 'vehicleGun', vehicleWeaponDamage: 0.15 },
    desc: '可在载具上安装【车载机枪】。',
  },
  {
    id: 't_vehicleRocket', branch: BRANCH.VEHICLE, tier: 3, name: '车载火箭巢', icon: '⁝', exclusive: 'pilot',
    cost: { gold: 420, metal: 190, sulfur: 40 }, req: ['t_vehicleGun'],
    effect: { vehicleWeaponUnlock: 'vehicleRocket', vehicleWeaponDamage: 0.2 },
    desc: '可在载具上安装【车载火箭巢】（溅射）。',
  },
  {
    id: 't_vehicleArc', branch: BRANCH.VEHICLE, tier: 4, name: '车载电弧', icon: '☈', exclusive: 'pilot',
    cost: { gold: 560, metal: 240, crystal: 50 }, req: ['t_vehicleRocket'],
    effect: { vehicleWeaponUnlock: 'vehicleArc', vehicleWeaponDamage: 0.25 },
    desc: '可在载具上安装【车载电弧】（连锁）。',
  },
  {
    id: 't_vehicleSlot3', branch: BRANCH.VEHICLE, tier: 3, name: '第三炮塔挂架', icon: '⁚', exclusive: 'pilot',
    cost: { gold: 480, metal: 200, parts: 24 }, req: ['t_vehicleTurret'],
    effect: { vehicleTurretCap: 1, vehicleSlots: 1 },
    desc: '车载炮塔上限 +1。',
  },
  {
    id: 't_vehicleBeacon2', branch: BRANCH.VEHICLE, tier: 4, name: '车载吸引阵列', icon: '◎', exclusive: 'pilot',
    cost: { gold: 620, metal: 240, crystal: 60 }, req: ['t_vehicleSlot3'],
    effect: { vehicleBeacon: 1, beaconRadiusMult: 0.15 },
    desc: '载具可携带便携吸引装置，阵列半径 +15%。',
  },
  {
    id: 't_mine1', branch: BRANCH.EXPLORE, tier: 1, name: '采掘镐 · 强化刃口', icon: '⛏',
    cost: { gold: 140, metal: 50 }, req: [],
    effect: { mineYield: 1 },
    desc: '采集每次产出 +1（变为 +2）。纯粹是效率提升，不改变能采到什么。',
  },
  {
    id: 't_mine2', branch: BRANCH.EXPLORE, tier: 2, name: '采掘镐 · 动力驱动', icon: '⛏',
    cost: { gold: 260, metal: 90, parts: 14 }, req: ['t_mine1'],
    effect: { mineYield: 1, mineSpeed: 0.35 },
    desc: '采集每次产出再 +1（+3），采集速度 +35%。',
  },
  {
    id: 't_mine3', branch: BRANCH.EXPLORE, tier: 3, name: '采掘镐 · 谐振钻头', icon: '⛏',
    cost: { gold: 420, metal: 150, crystal: 40 }, req: ['t_mine2'],
    effect: { mineYield: 1, mineSpeed: 0.4 },
    desc: '采集每次产出再 +1（+4），采集速度再 +40%。',
  },
  {
    id: 't_mine4', branch: BRANCH.EXPLORE, tier: 4, name: '采掘镐 · 相位采掘器', icon: '⛏',
    cost: { gold: 620, metal: 210, crystal: 70, tech: 4 }, req: ['t_mine3'],
    effect: { mineYield: 1, mineSpeed: 0.5 },
    desc: '采集每次产出再 +1（+5），采集速度再 +50%。到这一步，一圈资源能顶以前五圈。',
  },
  {
    id: 't_cargo', branch: BRANCH.EXPLORE, tier: 1, name: '加装货舱', icon: '▥',
    cost: { gold: 150, metal: 60 }, req: ['t_vehicle0'],
    effect: { carryMult: 0.5, cargoBonus: 20 },
    desc: '背包容量 +50%，载具载重 +20。',
  },
  {
    id: 't_survival', branch: BRANCH.EXPLORE, tier: 1, name: '野外生存手册', icon: '❋',
    cost: { gold: 130, metal: 35, food: 40 }, req: [],
    effect: { hpRegen: 0.8, hazardResist: 0.3, foodEfficiency: 0.3 },
    desc: '生命回复 +0.8/秒，地形伤害减免 30%。',
  },
  {
    id: 't_lantern', branch: BRANCH.EXPLORE, tier: 2, name: '夜视模块', icon: '☀',
    cost: { gold: 220, metal: 70, crystal: 20 }, req: ['t_survival'],
    effect: { nightVision: 1, sightBonus: 160 },
    desc: '夜间视野大幅提升，怪物索敌距离外你还能看清它们。',
  },
  {
    id: 't_vehicle2', branch: BRANCH.VEHICLE, exclusive: 'pilot', tier: 3, name: '载具改装 · 装甲与武器', icon: '🛡',
    cost: { gold: 380, metal: 140, parts: 26 }, req: ['t_vehicleTurret'],
    effect: { vehicleHpMult: 0.8, pinResist: 0.4 },
    desc: '载具耐久 +80%；加装防别架，被精英怪别住的时间 -40%。',
  },
  {
    id: 't_beaconPortable', branch: BRANCH.EXPLORE, tier: 2, name: '便携吸引装置', icon: '◎',
    cost: { gold: 280, metal: 90, crystal: 30 }, req: ['t_vehicle1'],
    effect: { portableBeacon: 1 },
    desc: '载具可携带便携吸引装置：在野外主动把怪潮引到你选定的位置。',
  },
  {
    id: 't_drone', branch: BRANCH.EXPLORE, tier: 3, name: '侦察无人机', icon: '⌖',
    cost: { gold: 340, metal: 100, tech: 3 }, req: ['t_lantern'],
    effect: { revealRadius: 700, mapReveal: 1 },
    desc: '自动标记周围 700 像素的巢穴、遗迹与资源点。',
  },
  {
    id: 't_vehicle3', branch: BRANCH.VEHICLE, exclusive: 'pilot', tier: 4, name: '载具改装 · 悬浮底盘', icon: '≋',
    cost: { gold: 520, metal: 180, crystal: 50 }, req: ['t_vehicle2'],
    effect: { vehicleSpeedMult: 0.3, terrainIgnore: 1 },
    desc: '载具无视地形减速（酸沼、浅滩、冰原都能全速通过），速度再 +30%。',
  },
  {
    id: 't_eliteHunter', branch: BRANCH.EXPLORE, tier: 3, name: '精英猎杀令', icon: '☠',
    cost: { gold: 380, metal: 90, research: 3 }, req: ['t_drone'],
    effect: { eliteSpawnMult: 0.5, lootQuality: 0.4, goldMult: 0.2 },
    desc: '野外精英怪刷新率 +50%，掉落品质 +40%，金币 +20%。',
  },
  {
    id: 't_ruinSalvage', branch: BRANCH.EXPLORE, tier: 4, name: '废墟回收规程', icon: '♻',
    cost: { gold: 440, metal: 130, parts: 30 }, req: ['t_vehicle3'],
    effect: { salvageMult: 0.8, beaconCoreFind: 1 },
    desc: '废弃基地回收产出 +80%，并且必定找到吸引阵列元件。',
  },
  {
    id: 't_planetAdapt', branch: BRANCH.EXPLORE, tier: 5, name: '异星环境适应', icon: '🜨',
    cost: { gold: 700, metal: 220, crystal: 70, research: 6 }, req: ['t_ruinSalvage'],
    effect: { hazardResist: 0.6, planetAdapt: 1, xpMult: 0.25 },
    desc: '大幅降低新星球的环境惩罚，落地即可全速发展。跨星保留。',
  },
  {
    id: 't_deepSpace', branch: BRANCH.EXPLORE, tier: 5, name: '深空航线图', icon: '✧',
    cost: { gold: 1000, metal: 260, crystal: 90, beaconCore: 3 }, req: ['t_planetAdapt'],
    effect: { nextPlanet: 1, supplyBonus: 0.5 },
    desc: '解锁下一颗星球的开拓权限，并让旧星球的太空快递支援量 +50%。',
  },

  // ================= 生物（生物学家专属） =================
  {
    id: 'b_gene1', branch: BRANCH.BIO, tier: 0, name: '基因采样', icon: '⧫', exclusive: 'biologist',
    cost: { gold: 100, dna: 4 }, req: [],
    effect: { geneSlots: 1, dnaMult: 0.4 },
    desc: '解锁 1 个基因缝合槽，基因样本获取 +40%。',
  },
  {
    id: 'b_gene2', branch: BRANCH.BIO, tier: 1, name: '缝合手术', icon: '⧫', exclusive: 'biologist',
    cost: { gold: 220, dna: 10 }, req: ['b_gene1'],
    effect: { geneSlots: 1, genePower: 0.3 },
    desc: '再解锁 1 个缝合槽，基因效果强度 +30%。',
  },
  {
    id: 'b_tame1', branch: BRANCH.BIO, tier: 1, name: '驯化信息素', icon: '❋', exclusive: 'biologist',
    cost: { gold: 200, biomass: 40, dna: 8 }, req: ['b_gene1'],
    effect: { tameSlots: 3, tameSpeed: 0.5 },
    desc: '解锁驯化：把血量低于 25% 的怪物变成你的战斗单位，上限 2 只。',
  },
  {
    id: 'b_toxin', branch: BRANCH.BIO, tier: 2, name: '毒素提纯', icon: '☣', exclusive: 'biologist',
    cost: { gold: 280, sulfur: 60, dna: 12 }, req: ['b_gene2'],
    effect: { dotMult: 0.6, poisonOnHit: 5 },
    desc: '所有持续伤害 +60%，攻击附带中毒。',
  },
  {
    id: 'b_hive', branch: BRANCH.BIO, tier: 3, name: '虫巢共鸣', icon: '☈', exclusive: 'biologist',
    cost: { gold: 420, dna: 20, crystal: 40 }, req: ['b_tame1', 'b_toxin'],
    effect: { tameSlots: 4, tamePower: 0.6, monsterFriendly: 1 },
    desc: '驯化上限 +2，驯化单位属性 +60%；部分野生虫群不再主动攻击你。',
  },
  {
    id: 'b_elite', branch: BRANCH.BIO, tier: 4, name: '精英样本重构', icon: '☠', exclusive: 'biologist',
    cost: { gold: 600, dna: 35, beaconCore: 1 }, req: ['b_hive'],
    effect: { tameElite: 1, geneSlots: 2 },
    desc: '可以驯化精英怪（保留其特殊能力），基因槽位 +2。',
  },
  /*
   * 玩家要求：「生物学家的科技树再丰富一些」「驯服上限再多一些」。
   * 原来生物分支只有 6 个节点，而且驯服上限只在 b_tame1 / b_hive 里各给 2，
   * 中期就招满了。这里补成一条完整的驯化线 + 基因线，并把上限拉开。
   */
  {
    id: 'b_tame2', branch: BRANCH.BIO, tier: 2, name: '群体信息素', icon: '❋', exclusive: 'biologist',
    cost: { gold: 340, dna: 12, food: 40 }, req: ['b_tame1'],
    effect: { tameSlots: 3, tameSpeed: 0.4 },
    desc: '驯化上限 +3，驯化速度 +40%。',
  },
  {
    id: 'b_tame3', branch: BRANCH.BIO, tier: 3, name: '巢群荷尔蒙', icon: '❋', exclusive: 'biologist',
    cost: { gold: 520, dna: 22, crystal: 30 }, req: ['b_tame2'],
    effect: { tameSlots: 4, tamePower: 0.3 },
    desc: '驯化上限 +4，驯化单位强度 +30%。',
  },
  {
    id: 'b_tame4', branch: BRANCH.BIO, tier: 5, name: '共生契约', icon: '❋', exclusive: 'biologist',
    cost: { gold: 880, dna: 40, crystal: 60 }, req: ['b_tame3', 'b_elite'],
    effect: { tameSlots: 6, tameElite: 1, tamePower: 0.4 },
    desc: '驯化上限 +6，可驯化精英单位。',
  },
  {
    id: 'b_gene3', branch: BRANCH.BIO, tier: 3, name: '基因剪接', icon: '⌬', exclusive: 'biologist',
    cost: { gold: 460, dna: 26, parts: 20 }, req: ['b_gene2'],
    effect: { geneSlots: 2, genePower: 0.35 },
    desc: '基因位 +2，基因效果 +35%。',
  },
  {
    id: 'b_gene4', branch: BRANCH.BIO, tier: 5, name: '表达重编程', icon: '⌬', exclusive: 'biologist',
    cost: { gold: 760, dna: 44, crystal: 50 }, req: ['b_gene3'],
    effect: { geneSlots: 3, genePower: 0.5, dnaMult: 0.6 },
    desc: '基因位 +3，基因效果 +50%，基因样本获取 +60%。',
  },
  {
    id: 'b_toxin2', branch: BRANCH.BIO, tier: 4, name: '神经毒素', icon: '☣', exclusive: 'biologist',
    cost: { gold: 620, dna: 30, sulfur: 40 }, req: ['b_toxin'],
    effect: { dotMult: 0.8, poisonOnHit: 8, thornAcid: 1 },
    desc: '持续伤害 +80%，攻击附带 8 点毒素，并解锁酸刺反伤。',
  },
  {
    id: 'b_swarm', branch: BRANCH.BIO, tier: 4, name: '虫群号令', icon: '❋', exclusive: 'biologist',
    cost: { gold: 700, dna: 34, food: 80 }, req: ['b_tame3'],
    effect: { tameSlots: 2, tameSpeed: 0.6, monsterFriendly: 1 },
    desc: '驯化上限 +2，驯化速度 +60%，中立虫群不再主动攻击你。',
  },
];

export const TECH_MAP = Object.fromEntries(TECH_DEF.map(t => [t.id, t]));

/** 按分支分组，方便 UI */
export function techsByBranch(branch, characterId) {
  return TECH_DEF.filter(t => t.branch === branch
    && (!t.exclusive || t.exclusive === characterId)
    // hideFor：这个角色不需要看到的节点（例如驾驶员不需要「载具申请」——他开局就有车）
    && !(t.hideFor || []).includes(characterId));
}

/** 检查前置是否满足 */
export function techAvailable(def, unlocked) {
  return (def.req || []).every(r => unlocked.has(r));
}
