/**
 * 游戏模式。
 *
 * 两种模式共用同一套系统（怪潮、塔、科技、城镇、实验科技），
 * 区别只在「开局怎么建世界」「玩家在不在场上」「怪从哪里来」：
 *
 *   frontier（开拓模式）：完整的大世界。有角色、有载具、有采集、有几十个虫巢，
 *                        玩家要出门跑图、回家防守。默认模式。
 *   towerDefense（纯塔防）：一小片基地。没有角色操控，只有建造、科技、城镇，
 *                        怪潮按波次从场外涌向基地。适合只想玩塔防的人。
 *
 * 为什么不做成两套代码：那样所有平衡改动都要写两遍。
 * 这里用「模式开关 + 少量分支」实现，模式和数值都集中在 MODE_DEF 里。
 */

export const GAME_MODE = {
  FRONTIER: 'frontier',
  TOWER_DEFENSE: 'towerDefense',
};

export const MODE_LIST = [GAME_MODE.FRONTIER, GAME_MODE.TOWER_DEFENSE];

export const MODE_DEF = {
  [GAME_MODE.FRONTIER]: {
    id: GAME_MODE.FRONTIER,
    name: '开拓模式',
    short: '开拓',
    icon: '❖',
    color: '#59d8ff',
    tagline: '完整的大世界：落地 → 采集 → 防守 → 清巢 → 占领星球',
    desc: '你操控一名殖民者，在整颗星球上跑图采集、开车探索、回家防守。'
        + '虫巢有几十个，清了就永久少一份收益 —— 收益与压力的取舍是这个模式的核心。',
    bullets: [
      '有角色操控、载具、采集与探索',
      '虫巢会持续产怪，吸引阵列把它们拉向基地',
      '清光所有虫巢可以占领星球，然后开拓下一颗',
    ],
    // 世界
    world: { nestScale: 1, poiScale: 1, landingSites: 4 },
    // 角色
    hasPlayer: true,
    // 怪潮：按吸引阵列的牵引强度从巢穴抽怪
    wave: { source: 'nests', warnSeconds: 22, prepSeconds: 0 },
    // 结算
    endCondition: 'baseDestroyed',
    startResources: {},
  },

  [GAME_MODE.TOWER_DEFENSE]: {
    id: GAME_MODE.TOWER_DEFENSE,
    name: '纯塔防模式',
    short: '塔防',
    icon: '⛨',
    color: '#ffba4c',
    tagline: '只有一片阵地：建塔 → 升级 → 扛住一波又一波',
    desc: '没有角色、没有跑图、没有采集。你只有一座基地、一片阵地和不断涌来的虫潮。'
        + '科技、实验科技、城镇经营全部保留；原本要去地图上采的材料，'
        + '现在按稀有度从怪物身上掉。',
    bullets: [
      '没有角色操控，也没有载具与大世界采集',
      '怪潮按波次从阵地外涌来，逐波变强',
      '材料全部来自击杀掉落（越稀有越难掉）',
      '实验科技照常四选一，节奏与开拓模式一致',
    ],
    // 世界：只有基地那片地
    world: { nestScale: 0, poiScale: 0, landingSites: 1, compact: true },
    hasPlayer: false,
    wave: { source: 'director', warnSeconds: 18, prepSeconds: 45 },
    endCondition: 'baseDestroyed',
    startResources: { gold: 520, metal: 260, wood: 60, fiber: 60, parts: 30 },
    /** 阵地半径（像素）：基础视野内的一圈，塔必须建在这里面 */
    fieldRadius: 900,
  },
};

export function modeDef(mode) {
  return MODE_DEF[mode] || MODE_DEF[GAME_MODE.FRONTIER];
}

export function isTowerDefense(mode) {
  return mode === GAME_MODE.TOWER_DEFENSE;
}
