/**
 * 地形 / 生物群系 / 障碍物 数据表。
 * 数值 id 存进存档，所以顺序不要随意改动（只在末尾追加）。
 */

// ---------- 地块类型 ----------
export const T = {
  VOID: 0,        // 世界边界外
  REGOLITH: 1,    // 风化尘土（基础地表）
  GRASS: 2,       // 苔原草毯
  SAND: 3,        // 沙丘
  ASH: 4,         // 火山灰
  ROCK: 5,        // 裸岩（不可通行）
  MOUNTAIN: 6,    // 高山（不可通行）
  WATER: 7,       // 液氨湖（不可通行）
  SHALLOW: 8,     // 浅滩（减速）
  CRYSTAL: 9,     // 晶簇地（采集加速）
  FUNGUS: 10,     // 菌毯（孢子群系）
  ICE: 11,        // 冰原
  ROAD: 12,       // 玩家铺的路（提速）
  CONCRETE: 13,   // 基地混凝土地面
  SCORCHED: 14,   // 焦土（巢穴周边）
  SWAMP: 15,      // 酸沼（减速+掉血）
  NEST_WALL: 16,  // 虫巢壁（巢穴副本里的实心岩壁）
  NEST_FLOOR: 17, // 虫巢地面（副本里的可通行地面）
  NEST_ORGAN: 18, // 虫巢器官地面（Boss 房，缓慢回血）
};

export const TILE_DEF = {
  [T.VOID]:     { name: '虚空',     solid: true,  color: '#05070d', speed: 0 },
  [T.REGOLITH]: { name: '风化尘土', solid: false, color: '#7d6a55', speed: 1.0,  buildup: 0.1 },
  [T.GRASS]:    { name: '苔原草毯', solid: false, color: '#4e7a4a', speed: 1.0,  harvest: 0.1 },
  [T.SAND]:     { name: '沙丘',     solid: false, color: '#c2a86b', speed: 0.92 },
  [T.ASH]:      { name: '火山灰',   solid: false, color: '#4a4340', speed: 0.95 },
  [T.ROCK]:     { name: '裸岩',     solid: true,  color: '#5b5f66', speed: 0,    mine: 0.5 },
  [T.MOUNTAIN]: { name: '高山',     solid: true,  color: '#3c4048', speed: 0,    mine: 1.0 },
  [T.WATER]:    { name: '液氨湖',   solid: true,  color: '#1f4f6e', speed: 0 },
  [T.SHALLOW]:  { name: '浅滩',     solid: false, color: '#2f6f8e', speed: 0.66 },
  [T.CRYSTAL]:  { name: '晶簇地',   solid: false, color: '#5a4f7a', speed: 0.95, mine: 0.6 },
  [T.FUNGUS]:   { name: '菌毯',     solid: false, color: '#6b3f6e', speed: 0.9,  harvest: 0.3 },
  [T.ICE]:      { name: '冰原',     solid: false, color: '#9fc4d8', speed: 0.86 },
  [T.ROAD]:     { name: '铺设道路', solid: false, color: '#6e6a63', speed: 1.32 },
  [T.CONCRETE]: { name: '混凝土',   solid: false, color: '#8d9199', speed: 1.2 },
  [T.SCORCHED]: { name: '焦土',     solid: false, color: '#2e2320', speed: 0.94 },
  [T.SWAMP]:    { name: '酸沼',     solid: false, color: '#3f5a2e', speed: 0.6, dot: 1.6 },
  // ---- 虫巢副本 ----
  // 对比度是刻意的：巢壁几乎全黑（像虚空/背景），巢道是明确的中间调，
  // 加上渲染层给巢道描的红边，玩家一眼能看出「哪能走、哪不能走」。
  // 第一版两者都偏暗红，实机里通道和墙几乎分不出来。
  [T.NEST_WALL]:  { name: '巢壁',   solid: true,  color: '#12060f', speed: 0, mine: 0.8 },
  [T.NEST_FLOOR]: { name: '巢道',   solid: false, color: '#5e2b3d', speed: 0.98 },
  [T.NEST_ORGAN]: { name: '巢核地面', solid: false, color: '#7d2a44', speed: 0.9, harvest: 0.2 },
};

export const isSolidTile = (t) => !!(TILE_DEF[t] && TILE_DEF[t].solid);
export const tileSpeed = (t) => (TILE_DEF[t] ? TILE_DEF[t].speed ?? 1 : 1);

// ---------- 生物群系 ----------
export const BIOME = {
  BASIN: 0,       // 落尘盆地（新手区）
  VERDANT: 1,     // 苔原绿洲
  DUNES: 2,       // 沙丘荒漠
  ASHLANDS: 3,    // 火山灰原
  CRYSTALFIELD: 4,// 晶簇荒原
  SPOREFEN: 5,    // 孢子沼泽
  GLACIER: 6,     // 冰川裂谷
  HIGHLAND: 7,    // 高原岩滩
  SCAR: 8,        // 巢穴焦土带（由巢穴动态改造）
};

export const BIOME_DEF = {
  [BIOME.BASIN]: {
    name: '落尘盆地', short: '盆地', tint: '#6b5b48', fog: 'rgba(120,100,70,0.05)',
    ground: [T.REGOLITH, T.REGOLITH, T.GRASS, T.SAND], hazard: 0.6, richness: 0.9, nestChance: 0.5,
    desc: '飞船残骸散落的平缓盆地，资源均衡，适合开局。',
  },
  [BIOME.VERDANT]: {
    name: '苔原绿洲', short: '绿洲', tint: '#3f6b3d', fog: 'rgba(70,140,80,0.06)',
    ground: [T.GRASS, T.GRASS, T.REGOLITH, T.SHALLOW], hazard: 0.8, richness: 1.25, nestChance: 0.9,
    desc: '孢子苔藓覆盖的湿润地带，食物与纤维极多，但虫群也爱这里。',
  },
  [BIOME.DUNES]: {
    name: '沙丘荒漠', short: '荒漠', tint: '#a08a5a', fog: 'rgba(200,170,100,0.07)',
    ground: [T.SAND, T.SAND, T.REGOLITH, T.ROCK], hazard: 1.0, richness: 0.85, nestChance: 1.0,
    desc: '昼夜温差极大，硅晶与金属矿脉裸露在地表。',
  },
  [BIOME.ASHLANDS]: {
    name: '火山灰原', short: '灰原', tint: '#3a3330', fog: 'rgba(90,70,60,0.09)',
    ground: [T.ASH, T.ASH, T.REGOLITH, T.SCORCHED], hazard: 1.45, richness: 1.1, nestChance: 1.4,
    desc: '地热活跃，硫磺与热能资源丰富，但虫巢密度最高。',
  },
  [BIOME.CRYSTALFIELD]: {
    name: '晶簇荒原', short: '晶原', tint: '#4d4468', fog: 'rgba(140,110,220,0.07)',
    ground: [T.CRYSTAL, T.CRYSTAL, T.REGOLITH, T.ROCK], hazard: 1.2, richness: 1.35, nestChance: 1.1,
    desc: '巨型晶柱折射星光，吸引阵列所需的导能晶体就产在这里。',
  },
  [BIOME.SPOREFEN]: {
    name: '孢子沼泽', short: '沼泽', tint: '#5a3560', fog: 'rgba(150,80,170,0.09)',
    ground: [T.SWAMP, T.FUNGUS, T.FUNGUS, T.WATER], hazard: 1.35, richness: 1.4, nestChance: 1.2,
    desc: '毒性孢子弥漫，生物学家在这里如鱼得水，其他人最好戴面罩。',
  },
  [BIOME.GLACIER]: {
    name: '冰川裂谷', short: '冰川', tint: '#8fb0c4', fog: 'rgba(190,230,255,0.08)',
    ground: [T.ICE, T.ICE, T.REGOLITH, T.WATER], hazard: 1.15, richness: 0.95, nestChance: 0.8,
    desc: '冻结的液氨河床，低温让载具引擎效率下降。',
  },
  [BIOME.HIGHLAND]: {
    name: '高原岩滩', short: '高原', tint: '#4a4e55', fog: 'rgba(120,130,150,0.05)',
    ground: [T.ROCK, T.REGOLITH, T.REGOLITH, T.CRYSTAL], hazard: 1.25, richness: 1.15, nestChance: 1.2,
    desc: '崎岖的岩石台地，矿藏密集，但载具通行困难。',
  },
  [BIOME.SCAR]: {
    name: '巢穴焦土', short: '焦土', tint: '#2a1f1c', fog: 'rgba(120,40,30,0.12)',
    ground: [T.SCORCHED, T.SCORCHED, T.ASH, T.ROCK], hazard: 1.9, richness: 1.3, nestChance: 2.2,
    desc: '虫巢长期侵蚀形成的焦黑地带，怪物密度极高。',
  },
};

// ---------- 障碍物 / 可采集物 ----------
export const PROP = {
  // 植被
  FIBER_BUSH: 'fiberBush',
  SPORE_TREE: 'sporeTree',
  GLOW_MOSS: 'glowMoss',
  // 矿物
  SCRAP_PILE: 'scrapPile',
  IRON_NODE: 'ironNode',
  CRYSTAL_NODE: 'crystalNode',
  SULFUR_VENT: 'sulfurVent',
  ICE_CORE: 'iceCore',
  // 特殊
  EGG_SAC: 'eggSac',
  WRECK: 'wreck',
  METAL_HEAP: 'metalHeap',
  DATA_OBELISK: 'dataObelisk',
  CACHE: 'cache',
  WRECK_CACHE: 'wreckCache',
};

/**
 * yield: { 资源key: [min,max] }
 * hard: 生命值（需要打几下）
 * tool: 需要的工具标签（null = 手采）
 */
export const PROP_DEF = {
  fiberBush:   { name: '纤维灌木', hp: 18,  r: 13, color: '#6f9a55', shape: 'bush',  tool: null,      yield: { fiber: [2, 4], food: [0, 1] }, respawn: 95, biome: [BIOME.VERDANT, BIOME.BASIN, BIOME.SPOREFEN] },
  sporeTree:   { name: '孢子树',   hp: 32,  r: 20, color: '#7a4f8a', shape: 'tree',  tool: 'axe',     yield: { wood: [3, 6], spore: [1, 2] }, respawn: 150, biome: [BIOME.SPOREFEN, BIOME.VERDANT] },
  glowMoss:    { name: '荧光苔',   hp: 12,  r: 12, color: '#5fd6b0', shape: 'patch', tool: null,      yield: { food: [1, 2], fiber: [1, 1] }, respawn: 70, biome: [BIOME.VERDANT, BIOME.SPOREFEN, BIOME.CRYSTALFIELD] },
  scrapPile:   { name: '残骸堆',   hp: 34,  r: 16, color: '#8a7f6a', shape: 'scrap', tool: 'pick',    yield: { metal: [2, 5], parts: [1, 2] }, respawn: 0, biome: [BIOME.BASIN, BIOME.DUNES, BIOME.HIGHLAND] },
  ironNode:    { name: '铁矿脉',   hp: 55,  r: 17, color: '#7d8896', shape: 'rock',  tool: 'pick',    yield: { metal: [4, 7] }, respawn: 0, biome: [BIOME.HIGHLAND, BIOME.DUNES, BIOME.ASHLANDS, BIOME.BASIN] },
  crystalNode: { name: '导能晶簇', hp: 70,  r: 18, color: '#a97fe8', shape: 'crystal', tool: 'pick',  yield: { crystal: [2, 4], metal: [0, 2] }, respawn: 0, biome: [BIOME.CRYSTALFIELD, BIOME.HIGHLAND] },
  sulfurVent:  { name: '硫磺喷气孔', hp: 40, r: 16, color: '#c9a24a', shape: 'vent', tool: 'pick',   yield: { sulfur: [3, 5], fuel: [1, 2] }, respawn: 60, biome: [BIOME.ASHLANDS, BIOME.DUNES] },
  iceCore:     { name: '冰芯',     hp: 46,  r: 16, color: '#a8d8ec', shape: 'crystal', tool: 'pick',  yield: { water: [3, 6], coolant: [1, 2] }, respawn: 110, biome: [BIOME.GLACIER] },
  eggSac:      { name: '虫卵囊',   hp: 60,  r: 19, color: '#b45a6a', shape: 'sac',   tool: null,      yield: { chitin: [2, 4], biomass: [2, 3], dna: [0, 1] }, respawn: 0, biome: [BIOME.SCAR, BIOME.ASHLANDS, BIOME.SPOREFEN] },
  wreck:       { name: '飞船残骸', hp: 90,  r: 24, color: '#9aa4b0', shape: 'wreck', tool: 'pick',    yield: { metal: [4, 9], parts: [2, 4], tech: [0, 2] }, respawn: 0, biome: [BIOME.BASIN, BIOME.DUNES, BIOME.HIGHLAND] },
  /*
   * 金属堆：被拆空 / 只值材料的残骸。
   *
   * 玩家反馈「地图上的（旗舰）残骸太多了」—— 以前残骸类只有一种，
   * 于是满地都是「飞船残骸」。现在世界生成时会把其中一部分换成金属堆：
   * 纯材料产出（金属/零件，偶尔一块晶体），不掉装备，
   * 让「值得拐进去的残骸」重新变成少数。
   */
  metalHeap:   { name: '金属堆',   hp: 74,  r: 21, color: '#b0a48c', shape: 'scrap', tool: 'pick',
    yield: { metal: [6, 12], parts: [2, 5], crystal: [0, 1] }, respawn: 0, biome: [BIOME.BASIN, BIOME.DUNES, BIOME.HIGHLAND, BIOME.SCAR, BIOME.ASHLANDS] },
  dataObelisk: { name: '数据方尖碑', hp: 120, r: 22, color: '#68d8ff', shape: 'obelisk', tool: null,   yield: { research: [2, 4], tech: [1, 2] }, respawn: 0, biome: null },
  cache:       { name: '补给箱',   hp: 25,  r: 15, color: '#c9a86a', shape: 'crate', tool: null,      yield: { gold: [40, 90], parts: [1, 3] }, respawn: 0, biome: null },
  // ---- 虫巢副本里的高价值目标 ----
  wreckCache:  { name: '旗舰残骸', hp: 150, r: 26, color: '#b9c4d2', shape: 'wreck',
    tool: 'pick', yield: { metal: [10, 20], parts: [6, 12], crystal: [4, 9], tech: [1, 3] }, respawn: 0,
    gearChance: 0.05, gearRarity: 'relic',
    desc: '被拖进虫巢的高级飞船残骸。5% 概率开出一件红色装备，还有一堆稀有材料。' },
};

// 采集物 -> 掉落资源的展示信息
export const RESOURCE_DEF = {
  gold:    { name: '金币',   color: '#ffba4c', icon: '◈' },
  metal:   { name: '金属',   color: '#9aa4b0', icon: '▤' },
  crystal: { name: '晶体',   color: '#a97fe8', icon: '◆' },
  fiber:   { name: '纤维',   color: '#8fc46a', icon: '❋' },
  wood:    { name: '木质',   color: '#b08050', icon: '▮' },
  food:    { name: '食物',   color: '#ff8a5c', icon: '❁' },
  spore:   { name: '孢子',   color: '#c58fd8', icon: '✿' },
  sulfur:  { name: '硫磺',   color: '#e0c14a', icon: '⬢' },
  fuel:    { name: '燃料',   color: '#ff9a4c', icon: '⛽' },
  water:   { name: '冷凝水', color: '#6fc8ff', icon: '◌' },
  coolant: { name: '冷却剂', color: '#8fe0e8', icon: '❄' },
  chitin:  { name: '甲壳',   color: '#c08060', icon: '⬟' },
  biomass: { name: '生物质', color: '#7ac47a', icon: '❂' },
  dna:     { name: '基因样本', color: '#7de0a0', icon: '⧫' },
  parts:   { name: '零件',   color: '#d0c090', icon: '⚙' },
  tech:    { name: '数据核心', color: '#68d8ff', icon: '✦' },
  research:{ name: '研究资料', color: '#b0a0ff', icon: '✎' },
  beaconCore: { name: '吸引核心', color: '#ff7a4c', icon: '◎' },
  // 不是仓库材料：怪物掉落的子弹直接进弹仓（见 loot.collectAt 的 ammo 分支）
  ammo:    { name: '弹药',   color: '#d0c090', icon: '▪' },
};
