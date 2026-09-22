/**
 * 流场寻路（Dijkstra / BFS 距离场）。
 *
 * 为什么不用 A*：怪潮可能同时有 300+ 单位，逐个 A* 会卡。
 * 流场只要在「目标变化」时算一次，所有单位共享，代价极低，
 * 而且天然产生「绕开岩壁、走平缓地形」的群体行为。
 *
 * ── 关于分辨率 ──
 * 流场原本是「一格一个节点」，整张图重算一次。地图放大到 304 格之后
 * 这一步实测要 20ms 以上，每 0.45 秒一次的定期重算就变成了肉眼可见的卡顿。
 * 现在流场可以按 cell 降采样：一个流场格 = cell×cell 个地块，
 * 代价取其中最差的那块（有实心就整格不可走），节点数降到 1/cell²。
 *
 * 为什么这不是「偷精度」：
 *   怪物本来就是朝着「大致方向」走的，真正的贴墙滑动由 tryMove 逐块判定，
 *   流场只负责给大方向。cell=2 时流场格边长 80px，
 *   而最窄的通道也有 3 格宽（120px），路线依然走得通。
 */

import { TILE } from '../core/config.js';
import { TILE_DEF } from '../data/tiles.js';

// 8 邻域：dx, dy, 代价倍数
const NEIGHBORS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

export class FlowField {
  /**
   * @param {number} w 世界宽度（地块）
   * @param {number} h 世界高度（地块）
   * @param {number} cell 每个流场格覆盖的地块边长（1 = 逐格）
   */
  constructor(w, h, cell = 1) {
    this.cell = Math.max(1, Math.floor(cell));
    this.w = Math.ceil(w / this.cell);
    this.h = Math.ceil(h / this.cell);
    this.tilesW = w;
    this.tilesH = h;

    const n = this.w * this.h;
    this.dist = new Float32Array(n).fill(Infinity);
    this.dirX = new Float32Array(n);
    this.dirY = new Float32Array(n);
    this.stamp = new Int32Array(n).fill(-1);
    this.generation = 0;
    this.goal = { x: -1, y: -1 };
    this._heap = [];
    this._cost = new Float32Array(n);          // 每格的通行代价，compute 时重建
    this.maxCost = Infinity;
  }

  /** 静态地形代价（越小越好走），Infinity = 不可通行 */
  terrainCost(tileId) {
    const def = TILE_DEF[tileId];
    if (!def) return Infinity;
    if (def.solid) return Infinity;
    const sp = def.speed ?? 1;
    return sp <= 0 ? Infinity : 1 / sp;
  }

  /**
   * 代价必须量化成整数。
   *
   * 为什么：斜向代价含 √2（无理数），浮点累加会产生 1e-13 级别的「更优路径」，
   * 于是节点被反复重新松弛、反复入堆 —— 堆无限膨胀、永不终止。
   * 量化到 Q 分之一像素后，比较就是精确的，Dijkstra 必然收敛。
   */
  static Q = 256;
  static NEIGHBOR_COST = NEIGHBORS.map(([, , mult]) => Math.round(TILE * mult * FlowField.Q));

  /**
   * 目标格（世界坐标，像素）→ 流场格
   * 用格中心判定，保证「站在某格中间」总是落到对应的那一格。
   */
  cellOf(wx, wy) {
    return {
      x: Math.floor(wx / (TILE * this.cell)),
      y: Math.floor(wy / (TILE * this.cell)),
    };
  }

  /** 把「地块级地形」压成「流场格级代价」 */
  _bakeCost(tiles, blocked) {
    const { w, h, cell, tilesW, tilesH, _cost: cost } = this;
    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        let worst = 0;                 // 取最差的一块的代价
        let solid = false;
        const tx0 = cx * cell, ty0 = cy * cell;
        for (let dy = 0; dy < cell && !solid; dy++) {
          const ty = ty0 + dy;
          if (ty >= tilesH) { solid = true; break; }
          for (let dx = 0; dx < cell; dx++) {
            const tx = tx0 + dx;
            if (tx >= tilesW) { solid = true; break; }
            if (blocked && blocked(tx, ty)) { solid = true; break; }
            const c = this.terrainCost(tiles[ty * tilesW + tx]);
            if (!Number.isFinite(c)) { solid = true; break; }
            if (c > worst) worst = c;
          }
        }
        cost[cy * w + cx] = solid ? Infinity : worst;
      }
    }
  }

  /**
   * 以 (gx,gy) 为目标重算整张流场。gx/gy 是**地块**坐标。
   * blocked(x,y) 可额外标记动态障碍（建筑/墙），同样是地块坐标。
   */
  compute(gx, gy, tiles, blocked = null) {
    const { w, h, dist, dirX, dirY, stamp, _cost: cost } = this;
    this.generation++;
    const gen = this.generation;

    // 目标换算到流场格
    const cx = Math.floor(gx / this.cell);
    const cy = Math.floor(gy / this.cell);
    this.goal.x = cx; this.goal.y = cy;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return;

    this._bakeCost(tiles, blocked);

    const heap = this._heap;
    heap.length = 0;
    const start = cy * w + cx;
    // 目标格本身就算是实心的也要让流场成立（比如基地被墙围住的情况）
    dist[start] = 0;
    stamp[start] = gen;
    dirX[start] = 0; dirY[start] = 0;
    heapPush(heap, start, 0);

    let maxC = 0;
    let guard = 0;
    const guardLimit = w * h * 12;
    const Q = FlowField.Q;
    const NC = FlowField.NEIGHBOR_COST;

    while (heap.length) {
      if (++guard > guardLimit) {
        // 正常情况绝不会到这里；留个兜底，避免任何意外把主线程拖死
        console.warn(`[flow] 迭代超限（${guard}），强制结束`);
        break;
      }
      const node = heapPop(heap);
      const idx = node.idx;
      const d = node.d;
      if (d > dist[idx]) continue;          // 过期条目
      if (d > maxC) maxC = d;
      const x = idx % w, y = (idx - x) / w;

      for (let n = 0; n < 8; n++) {
        const dx = NEIGHBORS[n][0], dy = NEIGHBORS[n][1];
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nIdx = ny * w + nx;
        const c = cost[nIdx];
        if (!Number.isFinite(c)) continue;
        // 斜向不允许穿过两个墙角
        if (dx && dy) {
          if (!Number.isFinite(cost[y * w + nx])) continue;
          if (!Number.isFinite(cost[ny * w + x])) continue;
        }
        // 量化成整数：比较精确，Dijkstra 保证收敛。
        // 注意这里不需要按 cell 缩放：Dijkstra 只关心「哪条更短」，
        // 所有边同乘一个常数不改变最短路径，方向场完全一样。
        const step = Math.round(c * NC[n]);
        const nd = d + step;
        if (stamp[nIdx] !== gen) {
          stamp[nIdx] = gen;
          dist[nIdx] = nd;
          heapPush(heap, nIdx, nd);
        } else if (nd < dist[nIdx]) {
          dist[nIdx] = nd;
          heapPush(heap, nIdx, nd);
        }
      }
    }

    this.maxCost = maxC;

    // 第二遍：每格指向距离最小的邻居
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (stamp[idx] !== gen) { dirX[idx] = 0; dirY[idx] = 0; continue; }
        if (x === cx && y === cy) { dirX[idx] = 0; dirY[idx] = 0; continue; }
        let bd = dist[idx], bx = 0, by = 0;
        for (let n = 0; n < 8; n++) {
          const [dx, dy] = NEIGHBORS[n];
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nIdx = ny * w + nx;
          if (stamp[nIdx] !== gen) continue;
          if (dist[nIdx] < bd) { bd = dist[nIdx]; bx = dx; by = dy; }
        }
        const len = Math.hypot(bx, by) || 1;
        dirX[idx] = bx / len;
        dirY[idx] = by / len;
      }
    }
  }

  /** 世界坐标处应该往哪走 */
  sample(wx, wy) {
    const gx = Math.floor(wx / (TILE * this.cell));
    const gy = Math.floor(wy / (TILE * this.cell));
    if (gx < 0 || gy < 0 || gx >= this.w || gy >= this.h) return { x: 0, y: 0, ok: false };
    const idx = gy * this.w + gx;
    if (this.stamp[idx] !== this.generation) return { x: 0, y: 0, ok: false };
    return { x: this.dirX[idx], y: this.dirY[idx], ok: true, dist: this.dist[idx] };
  }

  /** 该点到目标的剩余路程（像素），不可达返回 Infinity */
  costAt(wx, wy) {
    const gx = Math.floor(wx / (TILE * this.cell));
    const gy = Math.floor(wy / (TILE * this.cell));
    if (gx < 0 || gy < 0 || gx >= this.w || gy >= this.h) return Infinity;
    const idx = gy * this.w + gx;
    return this.stamp[idx] === this.generation ? this.dist[idx] : Infinity;
  }

  get ready() { return this.goal.x >= 0 && this.generation > 0; }
}

// ---- 极简二叉堆 ----
function heapPush(heap, idx, d) {
  heap.push({ idx, d });
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p].d <= heap[i].d) break;
    const t = heap[p]; heap[p] = heap[i]; heap[i] = t;
    i = p;
  }
}

function heapPop(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length) {
    heap[0] = last;
    let i = 0;
    const n = heap.length;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let s = i;
      if (l < n && heap[l].d < heap[s].d) s = l;
      if (r < n && heap[r].d < heap[s].d) s = r;
      if (s === i) break;
      const t = heap[s]; heap[s] = heap[i]; heap[i] = t;
      i = s;
    }
  }
  return top;
}
