/**
 * 真实世界下的流场代价基准。
 *
 * smoke.mjs 里那条「>2000 步/秒」的性能断言在地图放大后掉到了 1287，
 * 需要先定位到底是流场重算变贵了，还是别的东西。
 * 这个脚本只测流场：真实地形 + 真实 blocked，重复算 30 次取平均。
 */

import { performance } from 'node:perf_hooks';
import { WORLD_TILES, TILE, FLOW_CELL } from '../src/core/config.js';
import { World } from '../src/world/world.js';

const world = new World('bench-seed', { planetIndex: 0 });
const flow = world.flow;
const gx = Math.floor(world.baseSite.x / TILE);
const gy = Math.floor(world.baseSite.y / TILE);

// 预热
flow.compute(gx, gy, world.tiles, (bx, by) => world.blocked[by * world.w + bx] === 1);

const N = 30;
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  flow.compute(gx + (i % 3), gy + (i % 2), world.tiles, (bx, by) => world.blocked[by * world.w + bx] === 1);
}
const ms = (performance.now() - t0) / N;

let solid = 0;
for (let i = 0; i < world.tiles.length; i++) if (world.tiles[i] !== 0) solid++;

console.log(`世界 ${WORLD_TILES}x${WORLD_TILES} · 流场格 ${flow.w}x${flow.h}（cell=${FLOW_CELL}）· 非零地块 ${(solid / world.tiles.length * 100).toFixed(1)}%`);
console.log(`流场平均 ${ms.toFixed(1)}ms / 次（${N} 次）`);
console.log(`可达节点 ${Number.isFinite(flow.maxCost) ? '√' : '×'} · maxCost=${flow.maxCost}`);
