/**
 * 全局配置与调参中心。
 * 所有影响手感/难度的数字尽量集中在这里，方便平衡。
 */

// ---------- 世界 ----------
export const TILE = 40;                 // 单格像素
export const CHUNK = 16;                // 每个地形缓存块 = 16x16 格

/**
 * 世界边长（格）。304*40 = 12160px，面积约为原来 176 格的 3 倍。
 *
 * 放大之后有一点必须注意：所有「按像素写死」的密度/距离常量都要跟着放大，
 * 否则地图大了三倍、内容数量却没变，跑图会变成大片空白。
 * 判断标准统一用下面的 MAP_SCALE —— 凡是「每个区域该有几个」的东西
 * （巢穴、遗迹、兴趣点、降落点之间的最小间距）都乘它；
 * 凡是「一个单位的感知范围」的东西（视野、守卫 leash、刷怪半径）都不乘。
 */
export const WORLD_TILES = 304;
export const WORLD_PX = WORLD_TILES * TILE;
export const MAP_SCALE = (WORLD_PX * WORLD_PX) / (7040 * 7040);   // 相对原 176 格世界

/**
 * 流场降采样倍数：一个流场格 = FLOW_CELL×FLOW_CELL 个地块。
 *
 * 流场是整图 Dijkstra，节点数随地图面积平方增长。304 格 + cell=1 时实测一次
 * 重算要 20ms 以上，每 0.45 秒一次就成了肉眼可见的卡顿；cell=2 之后节点数降到
 * 1/4，重算回到 5ms 以内，而方向场几乎没变化（贴墙滑动本来由 tryMove 逐块判定）。
 * 地图再放大时把这个数字跟着调大即可。
 */
export const FLOW_CELL = 2;

// ---------- 时间 ----------
export const TICK_RATE = 60;
export const FIXED_DT = 1 / TICK_RATE;
export const DAY_LENGTH = 240;          // 一个昼夜 = 240 秒
export const TIME_SCALE_LABEL = ['黎明', '白昼', '黄昏', '夜晚'];

// ---------- 玩家 ----------
export const PLAYER = {
  baseSpeed: 172,
  sprintMult: 1.42,
  dodgeSpeed: 560,
  dodgeTime: 0.19,
  dodgeCooldown: 0.85,
  dodgeIFrames: 0.28,
  staminaMax: 100,
  staminaRegen: 21,
  sprintCost: 17,
  dodgeCost: 22,
  pickupRadius: 26,
  magnetBase: 96,
  reviveTime: 2.5,
  /**
   * 弹药上限 / 开局弹药。
   *
   * 以前是「开局 160、装填补到 120、上限 999」—— 三个数字互不相干，
   * 玩家看到的就是「我弹药怎么是现在这个数值」。现在只有一个上限：
   * 装填永远是「补满到 ammoMax」，界面也直接显示 160 / 200。
   */
  ammoMax: 200,
  ammoStart: 160,
};

/**
 * 玩家武器数值的成长上限。
 *
 * 这三条线（范围 / 伤害 / 射速 / 弹道）现在全部由科技树提供，
 * 实验科技与装备仍然可以叠加，但总和会被这里封顶 ——
 * 「最多到初始的 300%」是设计承诺，不能靠叠 buff 突破。
 */
export const WEAPON_CAPS = {
  rangeMult: 2.0,        // 射程最多 300%
  damage: 2.0,           // 伤害最多 300%
  attackSpeed: 1.0,      // 射速最多 200%
  projectiles: 2,        // 弹道最多 3 条（1 条基础 + 2 条）
};


// ---------- 载具 ----------
export const VEHICLE = {
  /*
   * 速度：240（原 300）。
   *
   * 为什么要降：载具原本比步行快 1.7 倍，地图在体感上被压得很小 ——
   * 想去哪儿都是一脚油门的事，「跑图」这件事本身不再有分量，
   * 「攒材料申请载具」也就失去了意义。现在快 1.4 倍：
   * 值得为它攒，但开出去之前仍要算一下油和回程。
   */
  baseSpeed: 240,
  boostMult: 1.55,
  cargoBase: 24,
  fuelMax: 100,
  fuelPerSec: 0.62,
  collisionDamage: 22,       // 撞击怪物伤害（本体）
  collisionCooldown: 0.45,
  /** 最多能挂几座炮塔（驾驶员的被动可以再加，但总数不超过 2） */
  maxTurrets: 2,
  /** 悬挂式近战模块（撞角 / 电锯）的安装位数量上限 */
  maxMeleeModules: 1,
};

// ---------- 吸引阵列（怪潮核心） ----------
export const BEACON = {
  baseRadius: 900,            // 初始吸引半径（像素）
  radiusPerLevel: 300,
  baseIntensity: 0.28,        // 初始只吸引一小部分怪
  intensityPerLevel: 0.14,
  maxLevel: 12,
  waveIntervalBase: 150,      // 怪潮间隔（秒）
  waveIntervalMin: 66,
  fuelMax: 100,
  // 玩家要求：吸引物质（能量）消耗速度改成原来的一半
  fuelPerSec: 0.16,           // 运转耗能（原 0.32）
  fuelPerWave: 6,             // 每波额外消耗（原 12）
  overloadRadiusMult: 1.35,
};

// ---------- 基地 ----------
export const BASE = {
  maxHp: 2600,
  hpPerLevel: 420,
  repairRate: 34,             // 每秒修复量（需玩家在基地内）
  repairCostPerHp: 0.22,      // 每点生命消耗材料
  popDeathOnDestroy: 1.0,     // 基地被毁人口全灭
  // 玩家反馈「按 E 重建没反应」：45 秒的持续按住 + 毫无反馈，
  // 实际操作起来就像坏了。现在 12 秒，而且有进度条与每次按下的推进。
  rebuildTime: 12,            // 基地被毁后重建秒数（玩家亲自修）
  rebuildPerTap: 0.55,        // 每点一下 E 也推进这么多秒（不必一直按住）
  alarmWaveGap: 26,           // 基地被毁后，怪潮扑向玩家的间隔
};

// ---------- 巢穴 ----------
export const NEST = {
  baseHp: 900,
  hpPerTier: 400,
  spawnPerMinute: 1.5,        // 每巢每分钟产怪（受威胁度影响）
  threatPerNest: 1.0,
  rewardGold: 140,
  rewardMat: 45,
  rewardBeaconCore: 1,
  xp: 220,
};

// ---------- 经济 ----------
export const ECON = {
  startingGold: 260,
  startingMat: 90,
  goldPerKill: 1.0,
  autoCollectRadius: 240,
  levelBase: 92,              // 升到 2 级所需经验
  levelGrowth: 1.19,
  /**
   * 经验需求总倍率。
   *
   * 1 → 1.5：升级 = 一次实验科技四选一，升得太快就变成弹窗疲劳。
   * 1.5 → 2.8：还是太快。现在「实验科技」的主要来源改成**每打完一波怪潮给 1 次**
   * （见 director.endWave），升级本身只给生命与属性，不再直接送选择次数。
   * 这个倍率决定的是「升级」这条线的节奏，两条线合起来才是玩家实际感受到的速度。
   */
  xpScale: 2.8,
};

// ---------- 渲染 ----------
export const RENDER = {
  baseW: 1280,
  baseH: 720,
  maxDPR: 2,
  shadowBlur: false,
  minimapSize: 220,
  chunkCacheLimit: 220,
};

export const SAVE_KEY = 'frontier-colony-save-v1';
export const SAVE_VERSION = 1;
