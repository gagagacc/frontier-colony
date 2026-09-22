/**
 * Boss 房半径（格）。**唯一真值来源**：测试也从这里取，不许再手抄一遍 ——
 * 之前测试里硬编码 11/9/7，房间一放大测试就误报「柱子没了」。
 */
export function bossHalfFor(tier, regionH) {
  return Math.min(
    (tier >= 8 ? 15 : tier >= 4 ? 12 : 10),
    Math.floor((regionH - 6) / 2),
  );
}

/**
 * 虫巢副本（地下迷宫）。
 *
 * 布局是「鱼骨刺」——一条主通道从入口一直延伸到最深处的 Boss 房，
 * 两侧挂着一间间侧室：
 *
 *     入口 ══╤══════╤══════╤══════╤══► 💀 Boss 房
 *            │      │      │      │
 *          侧室   侧室   侧室   侧室
 *
 * 为什么是这个形状：
 *   - 主通道保证「玩家永远知道往哪走」，不会在迷宫里迷路转圈；
 *   - 侧室是可选收益（被拖进来的飞船残骸、稀有材料），逼玩家做「要不要拐进去」的取舍；
 *   - Boss 房在最深处，进去之前你有一整条通道的时间后悔。
 *
 * 实现方式：直接在世界的地块数组上「挖洞」，把洞外全部填成实心。
 * 这样洞穴天然是封闭的，而且完全复用现成的碰撞、寻路、渲染，
 * 不需要第二套地图表示。
 */

import { T, BIOME, PROP_DEF } from '../data/tiles.js';
import { RNG } from '../core/rng.js';
import { TILE } from '../core/config.js';

/** 巢穴等级 1~10 对应的副本规模 */
export function dungeonPlan(tier) {
  const t = Math.max(1, Math.min(10, tier));
  return {
    tier: t,
    // 侧室数量：1 级 2 间，10 级 6 间
    chambers: 2 + Math.round((t - 1) * 0.45),
    // 主通道长度（格）
    length: 54 + t * 4,
    corridorHalf: 2,          // 主通道半宽（格）-> 5 格宽
    chamberHalf: 4,           // 侧室半宽（格）-> 9 格宽
    /** 被拖进来的飞船残骸数量 */
    wrecks: 1 + Math.floor(t / 3),
    /** Boss 强度倍率 */
    bossScale: 1 + (t - 1) * 0.28,
  };
}

/**
 * 把世界挖成一条虫巢通道。
 *
 * @param {import('./world.js').World} world
 * @param {number} tier 巢穴等级 1~10
 * @returns {object} { entry, boss, chambers[], wrecks[] } 都用像素坐标
 */
export function carveDungeon(world, tier) {
  const plan = dungeonPlan(tier);
  const rng = new RNG(world.seed + ':dungeon' + tier);
  const W = world.w, H = world.h;

  /*
   * 副本区域的尺寸只影响「挖多长」，不再影响「外面长什么样」。
   *
   * 曾经为了省小地图的渲染量，把区域外留成虚空（VOID）—— 结果是：
   *   - 虚空和巢壁都是接近黑的颜色，玩家分不清「这是一面墙」还是「这是地板」；
   *   - 更糟的是**地表世界的障碍物没有被清掉**，灌木、岩石、树照旧画在
   *     虚空上面（实测副本里还有 72 个地表 props），看起来就跟地表一个风格。
   * 现在：整个世界一律填成巢壁，props 全部清空。
   * 小地图只画 `dungeon.region`（`hud.drawDungeonMinimap`），渲染只画视野内的区块，
   * 所以「填满全图」既不会掉帧，也不会出现风格割裂。
   */
  const regionW = Math.min(W, 132);
  const regionH = Math.min(H, 92);
  const rx0 = Math.floor((W - regionW) / 2);
  const ry0 = Math.floor((H - regionH) / 2);

  // 1) 全图巢壁（外面也是巢壁，不是虚空）-> 在里面挖洞
  world.tiles.fill(T.NEST_WALL);
  world.biomes.fill(BIOME.SCAR);
  // 副本里不再按生物群系撒地表障碍物（见 world._spawnChunk）
  world.noProps = true;
  // 地表世界的障碍物 / 巢穴 / 遗迹一律作废：它们的坐标在副本里没有意义，
  // 留着就会画在巢壁上（「地形怎么和外面一个风格」就是这么来的）
  world.props.clear();
  world.nests.length = 0;
  world.pois.length = 0;
  world.modifiedTiles?.clear?.();
  // 地形换了一整套，区块里的障碍物计划全部作废
  world.chunks.clear();

  const midY = ry0 + Math.floor(regionH / 2);
  const startX = rx0 + 6;

  const dig = (x, y) => {
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return;
    // 不允许挖到副本区域之外
    if (x < rx0 + 1 || y < ry0 + 1 || x >= rx0 + regionW - 1 || y >= ry0 + regionH - 1) return;
    const i = y * W + x;
    world.tiles[i] = T.NEST_FLOOR;
    world.biomes[i] = BIOME.SCAR;
  };

  // 通道长度受区域宽度限制，别让 Boss 房撞到边界
  const maxLen = regionW - 30;
  const endX = Math.min(startX + Math.min(plan.length, maxLen), rx0 + regionW - 18);

  // 2) 入口大厅
  //
  // 为什么要单独挖一间：副本的「回程点」（基地核心）就放在入口，
  // 而基地会把它所在的格子标记为占用 —— 基地半径 96px 比 5 格宽的走廊
  // （200px）还宽，直接放在走廊里会把通道堵死，
  // 玩家出生在基地那一格上就**一步也走不动**（实测卡死在原地就是这么来的）。
  // 现在入口是一间 13×9 的大厅：基地靠左，玩家站在基地右边，互不重叠。
  const hallHalfW = 6;
  const hallHalfH = 4;
  const hallX = rx0 + 4;
  for (let y = midY - hallHalfH; y <= midY + hallHalfH; y++) {
    for (let x = hallX; x <= hallX + hallHalfW * 2; x++) dig(x, y);
  }
  // 大厅也铺一点巢核地面，视觉上区分「入口」与普通通道
  for (let y = midY - 2; y <= midY + 2; y++) {
    for (let x = hallX + 1; x <= hallX + 4; x++) {
      const i = y * W + x;
      if (world.tiles[i] === T.NEST_FLOOR) world.tiles[i] = T.NEST_ORGAN;
    }
  }

  // 3) 主通道（从大厅右边缘一路通到 Boss 房）
  for (let x = startX; x <= endX; x++) {
    for (let dy = -plan.corridorHalf; dy <= plan.corridorHalf; dy++) dig(x, midY + dy);
  }

  // 3) 侧室 + 连接支路（鱼骨刺）。上下交替，且夹在区域高度之内。
  const chambers = [];
  const chamberCount = plan.chambers;
  const maxUp = Math.max(plan.chamberHalf + 3, midY - (ry0 + 2));
  const maxDown = Math.max(plan.chamberHalf + 3, (ry0 + regionH - 3) - midY);
  for (let c = 0; c < chamberCount; c++) {
    const px = startX + Math.round((endX - startX) * ((c + 0.7) / (chamberCount + 0.4)));
    const up = c % 2 === 0;                       // 上下交替，像鱼骨
    const room = up ? maxUp : maxDown;
    // 支路长度要留出房间自身的半高，否则房间会压到区域边界
    const maxDist = Math.max(plan.chamberHalf + 2, room - plan.chamberHalf - 1);
    const dist = Math.min(maxDist, plan.chamberHalf + 3 + rng.int(0, 3));
    const cy = midY + (up ? -dist : dist);
    const cx = px + rng.int(-2, 2);

    // 支路
    for (let y = midY; up ? y >= cy : y <= cy; up ? y-- : y++) {
      dig(px, y);
      dig(px + 1, y);
    }
    // 侧室本体
    for (let y = cy - plan.chamberHalf; y <= cy + plan.chamberHalf; y++) {
      for (let x = cx - plan.chamberHalf; x <= cx + plan.chamberHalf; x++) dig(x, y);
    }
    chambers.push({ tx: cx, ty: cy, x: cx * TILE + TILE / 2, y: cy * TILE + TILE / 2 });
  }

  // 4) Boss 房：走廊尽头的一间大房间
  /*
   * 玩家要求「Boss 房做大一点」。
   * 原来是 11×11 格（bossHalf 5），一只大体型巢穴主加上它召的小怪就把房间塞满了，
   * 玩家没有走位空间，只能站桩对射。现在按巢穴等级放大：
   *   1~3 级 15×15，4~7 级 19×19，8~10 级 23×23（还要受区域高度限制）。
   */
  /*
   * 玩家再次要求「Boss 房再扩大一些」。
   * 上一轮是 15/19/23（bossHalf 7/9/11），打起来仍然偏挤 ——
   * 大体型巢穴主加上它召的小怪，走位空间还是不够。这一轮整体再放大一档：
   *   1~3 级 21×21，4~7 级 25×25，8~10 级 31×31（仍受区域高度限制）。
   */
  const bossHalf = bossHalfFor(plan.tier, regionH);
  const bossTx = Math.min(endX + bossHalf + 2, rx0 + regionW - bossHalf - 2);
  for (let y = midY - bossHalf; y <= midY + bossHalf; y++) {
    for (let x = endX; x <= bossTx + bossHalf; x++) dig(x, y);
  }
  // 房间中央隆起一块巢核地面（打起来有「这里是主战场」的辨识度）
  for (let y = midY - 2; y <= midY + 2; y++) {
    for (let x = bossTx - 3; x <= bossTx + 3; x++) {
      const i = y * W + x;
      if (world.tiles[i] === T.NEST_FLOOR) world.tiles[i] = T.NEST_ORGAN;
    }
  }
  // 四角的支撑柱：大房间空荡荡的话看着假，柱子也给走位一点参照
  for (const [ox, oy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const cx2 = bossTx + ox * (bossHalf - 3);
    const cy2 = midY + oy * (bossHalf - 3);
    for (let y = cy2 - 1; y <= cy2 + 1; y++) {
      for (let x = cx2 - 1; x <= cx2 + 1; x++) {
        // 只把房间内部「变回墙」，不影响挖出来的形状
        const i = y * W + x;
        if (i >= 0 && i < world.tiles.length) world.tiles[i] = T.NEST_WALL;
      }
    }
  }
  // 把**实际用的**半径一起报出来：测试直接读它，不再自己推导（推导副本会漂）
  const boss = { tx: bossTx, ty: midY, x: bossTx * TILE + TILE / 2, y: midY * TILE + TILE / 2, bossHalf };

  // 5) 入口：基地靠大厅左侧，玩家站在大厅右侧（两者不能重叠 —— 见上面的说明）
  const baseTx = hallX + 2;
  const entry = {
    tx: baseTx, ty: midY,
    x: baseTx * TILE + TILE / 2, y: midY * TILE + TILE / 2,
  };
  const playerTx = hallX + hallHalfW * 2 - 2;
  const playerStart = {
    tx: playerTx, ty: midY,
    x: playerTx * TILE + TILE / 2, y: midY * TILE + TILE / 2,
  };

  // 6) 登记副本信息，让渲染与小地图知道该用虫巢风格
  world.dungeon = {
    tier: plan.tier, plan, entry, playerStart, boss, chambers, cleared: false,
    region: { x0: rx0, y0: ry0, w: regionW, h: regionH },
  };

  return { plan, entry, playerStart, boss, chambers };
}
