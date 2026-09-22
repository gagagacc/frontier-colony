/**
 * 世界尺寸基准测试。
 *
 * 目的：在真正把地图放大之前，先量出「世界边长 -> 生成耗时 / 流场耗时 / 内存」
 * 的实际曲线。流场是整张地图大小的 Dijkstra，代价随格数增长，
 * 盲目放大很容易让每 0.45 秒一次的重算变成掉帧源头。
 */

import { performance } from 'node:perf_hooks';

const SIZES = process.argv.slice(2).map(Number).filter(Boolean);
const LIST = SIZES.length ? SIZES : [176, 248, 304, 352];

const { TILE } = await import('../src/core/config.js');

for (const n of LIST) {
  // World 的边长来自 config 常量，这里直接构造一个同尺寸的 FlowField 来测代价
  const { World } = await import('../src/world/world.js');
  const { FlowField } = await import('../src/world/pathfind.js');

  // 用真实世界生成器改尺寸不现实，这里用一个「同尺寸的地形数组」近似
  const w = n, h = n;
  const tiles = new Uint8Array(w * h);
  const blocked = new Uint8Array(w * h);
  const seedRng = (i) => Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
  for (let i = 0; i < tiles.length; i++) {
    const r = seedRng(i);
    tiles[i] = r < 0.12 ? 1 : r < 0.2 ? 2 : 0;      // 约 12% 实心
  }

  const ff = new FlowField(w, h);
  const t0 = performance.now();
  ff.compute(Math.floor(w / 2), Math.floor(h / 2), tiles, (bx, by) => blocked[by * w + bx] === 1);
  const t1 = performance.now();

  // 再算一次（热态，堆已经预热）
  const t2 = performance.now();
  ff.compute(Math.floor(w / 2) + 3, Math.floor(h / 2) + 3, tiles, (bx, by) => blocked[by * w + bx] === 1);
  const t3 = performance.now();

  const bytes = (ff.dist.byteLength + ff.dirX.byteLength + ff.dirY.byteLength + ff.stamp.byteLength);
  const approxWorldBytes = w * h * 3;   // tiles + biomes + variant

  console.log(
    `${String(n).padStart(4)}格 (${(n * TILE / 1000).toFixed(1)}k px) · ` +
    `流场 首算 ${(t1 - t0).toFixed(0)}ms / 热算 ${(t3 - t2).toFixed(0)}ms · ` +
    `流场内存 ${(bytes / 1048576).toFixed(1)}MB · 地形数组 ${(approxWorldBytes / 1048576).toFixed(1)}MB · ` +
    `可达 ${Number.isFinite(ff.maxCost) ? '√' : '×'}`,
  );

  void World;
}
