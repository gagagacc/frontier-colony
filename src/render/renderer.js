/**
 * 渲染器：程序化 2D 俯视角画面。
 *
 * 性能策略：
 *   1) 地形按 16x16 格的分块预渲染到离屏 canvas，之后每帧只 drawImage 可见块。
 *   2) 实体按类型分层批量绘制，只画视野内的。
 *   3) 光照（昼夜）用一层叠加渐变，不逐像素计算。
 *
 * 美术：全部程序化生成 —— 几何图形 + 渐变 + 描边，
 * 保证零素材依赖也能看清「这是什么」；接入素材时替换 draw* 函数即可。
 */

import { TILE, CHUNK, RENDER, BASE } from '../core/config.js';
import { clamp01 } from '../core/math.js';
import { T, TILE_DEF, PROP_DEF, isSolidTile } from '../data/tiles.js';
import { RARITY_DEF } from '../data/weapons.js';
import { TOWN_BUILDING_DEF } from '../data/planets.js';

const CHUNK_PX = CHUNK * TILE;

/** 阴影/高光的统一色调 */
const SHADOW = 'rgba(0,0,0,0.32)';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.chunkCache = new Map();
    this.chunkOrder = [];
    this.dpr = 1;
    this.frameStats = { chunks: 0, entities: 0 };
    this.showDebug = false;
    this.time = 0;
    this.placementPreview = null;      // { type, x, y, valid }
    this.hoverInfo = null;
    this._gradCache = new Map();
    this.assets = null;                // 由 main 注入的 AssetManager（可选）
  }

  resize(w, h, dpr) {
    this.dpr = dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // =========================================================
  //  主渲染
  // =========================================================

  render(dt, alpha, game) {
    const ctx = this.ctx;
    const cam = game.camera;
    const run = game.run;
    this.time += dt;
    this.frameStats.chunks = 0;
    this.frameStats.entities = 0;

    const w = cam.viewW, h = cam.viewH;

    if (!run || !run.world) {
      ctx.fillStyle = '#04060c';
      ctx.fillRect(0, 0, w, h);
      return;
    }

    ctx.save();
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, w, h);

    cam.apply(ctx);
    const view = cam.viewRect(140);

    this.drawTerrain(ctx, run.world, view);
    this.drawBaseZone(ctx, run, view);
    this.drawNests(ctx, run, view);
    this.drawPois(ctx, run, view);
    this.drawBeacon(ctx, run, view);
    this.drawPools(ctx, run, view);
    this.drawProps(ctx, run.world, view);
    this.drawBuildings(ctx, run, view);
    this.drawPickups(ctx, run, view);
    this.drawEnemies(ctx, run, view);
    this.drawTamePets(ctx, run, view);
    this.drawVehicle(ctx, run, view);
    this.drawPlayer(ctx, run, view);
    this.drawProjectiles(ctx, run, view);
    this.drawEffects(ctx, run, view);
    this.drawPlacementPreview(ctx, game);
    this.drawWorldLabels(ctx, run, view, cam);

    ctx.restore();

    this.drawLighting(ctx, run, cam);
    this.drawVignette(ctx, w, h, run);
    this.drawCrosshair(ctx, game);
    if (this.showDebug) this.drawDebug(ctx, game);
  }

  // =========================================================
  //  地形
  // =========================================================

  drawTerrain(ctx, world, view) {
    const c0 = Math.max(0, Math.floor(view.x0 / CHUNK_PX));
    const c1 = Math.min(Math.ceil(world.w / CHUNK) - 1, Math.floor(view.x1 / CHUNK_PX));
    const r0 = Math.max(0, Math.floor(view.y0 / CHUNK_PX));
    const r1 = Math.min(Math.ceil(world.h / CHUNK) - 1, Math.floor(view.y1 / CHUNK_PX));

    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const canvas = this.getChunk(world, cx, cy);
        if (!canvas) continue;
        ctx.drawImage(canvas, cx * CHUNK_PX, cy * CHUNK_PX);
        this.frameStats.chunks++;
      }
    }
  }

  /**
   * 取一张区块图（带缓存）。
   *
   * 缓存键必须带上 `world.uid` —— 只按坐标缓存的话，进虫巢副本时
   * 副本是另一个 World 对象、坐标却完全一样，于是地表那张区块图会被当成
   * 「还是这张图」直接复用：**巢道里画的是地表地形**（玩家报的就是这个）。
   * 另外还比一次 `world` 引用，双保险。
   */
  getChunk(world, cx, cy) {
    const key = (world.uid || 0) + ':' + cx + ',' + cy;
    const cached = this.chunkCache.get(key);
    if (cached && cached.world === world && cached.rev === (world.tileRevision || 0)) return cached.canvas;
    if (cached) this.chunkCache.delete(key);

    const canvas = document.createElement('canvas');
    canvas.width = CHUNK_PX;
    canvas.height = CHUNK_PX;
    const c = canvas.getContext('2d');
    this.renderChunk(c, world, cx, cy);

    this.chunkCache.set(key, { canvas, rev: world.tileRevision || 0, world });
    this.chunkOrder.push(key);
    // LRU 淘汰
    while (this.chunkOrder.length > RENDER.chunkCacheLimit) {
      const old = this.chunkOrder.shift();
      if (old !== key) this.chunkCache.delete(old);
      else this.chunkOrder.push(old);
    }
    return canvas;
  }

  renderChunk(c, world, cx, cy) {
    const tx0 = cx * CHUNK, ty0 = cy * CHUNK;
    // 底色
    c.fillStyle = '#0a0d16';
    c.fillRect(0, 0, CHUNK_PX, CHUNK_PX);

    // drawTileDetail 需要知道地图尺寸（巢壁描边要查邻居会不会越界），
    // 挂在实例上比一路透传参数省事
    this._tileW = world.w;
    this._tileH = world.h;
    this._tileArr = world.tiles;

    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const tx = tx0 + lx, ty = ty0 + ly;
        if (tx >= world.w || ty >= world.h) continue;
        const idx = ty * world.w + tx;
        const tile = world.tiles[idx];
        const def = TILE_DEF[tile];
        if (!def) continue;
        const px = lx * TILE, py = ly * TILE;
        const v = world.variant[idx] / 255;

        if (tile === T.VOID) {
          c.fillStyle = '#04060c';
          c.fillRect(px, py, TILE, TILE);
          continue;
        }

        const base = shade(def.color, (v - 0.5) * 0.10);
        c.fillStyle = base;
        c.fillRect(px, py, TILE, TILE);

        /*
         * 有贴图就用贴图，没有就画程序化细节。
         *
         * 逻辑名约定 `terrain.<tileId>`：往 assets/manifest.json 里登记
         * "terrain.2": "tiles/grass.png" 就能把草地换成贴图，
         * 其余地块继续用程序化图形 —— 所以素材可以一块一块地接，不用一次到位。
         */
        const sheet = this.assets?.tileTexture?.(tile) || null;
        if (sheet) {
          c.drawImage(sheet, px, py, TILE, TILE);
        } else {
          this.drawTileDetail(c, tile, px, py, v, tx, ty);
        }
      }
    }

    // 块边缘暗角，做轻微分隔（很淡，防止拼缝明显）
    c.strokeStyle = 'rgba(0,0,0,0.06)';
    c.strokeRect(0.5, 0.5, CHUNK_PX - 1, CHUNK_PX - 1);
  }

  /**
   * 给「不可通行的地块」勾一圈可见的崖边。
   *
   * 玩家反馈：同样的材质看着能走，撞上去却是空气墙。
   * 原因是颜色太接近 —— 例如火山灰（#4a4340，可走）和高山（#3c4048，实心）
   * 在实机里几乎分不出来。现在只要实心地块挨着可通行地块，
   * 就在交界处画一条亮边 + 给可走的一侧压一道投影，
   * 「这里是墙」不再需要靠撞出来。
   */
  drawSolidEdge(c, tx, ty, px, py) {
    const tw = this._tileW || 0, th = this._tileH || 0, arr = this._tileArr;
    if (!arr) return;
    const walkable = (dx, dy) => {
      const nx = tx + dx, ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= tw || ny >= th) return false;
      return !isSolidTile(arr[ny * tw + nx]);
    };
    c.save();
    c.lineWidth = 2;
    c.strokeStyle = 'rgba(255,236,190,0.34)';
    c.beginPath();
    if (walkable(0, 1)) { c.moveTo(px, py + TILE); c.lineTo(px + TILE, py + TILE); }
    if (walkable(0, -1)) { c.moveTo(px, py); c.lineTo(px + TILE, py); }
    if (walkable(1, 0)) { c.moveTo(px + TILE, py); c.lineTo(px + TILE, py + TILE); }
    if (walkable(-1, 0)) { c.moveTo(px, py); c.lineTo(px, py + TILE); }
    c.stroke();
    c.restore();
  }

  drawTileDetail(c, tile, px, py, v, tx, ty) {
    const h = (n) => {
      const s = Math.sin(tx * 127.1 + ty * 311.7 + n * 74.7) * 43758.5453;
      return s - Math.floor(s);
    };
    switch (tile) {
      /*
       * 虫巢副本的巢道：横向的肌肉/甲壳纹理 + 沿走廊的红光。
       * 副本里「哪能走」必须一眼看出来 —— 玩家在一条 5 格宽的通道里跑，
       * 认错边界就是不停地撞墙。纹理方向也跟着通道走。
       */
      case T.NEST_FLOOR: {
        c.strokeStyle = `rgba(255,120,150,${0.06 + v * 0.05})`;
        c.lineWidth = 1;
        for (let i = 0; i < 2; i++) {
          const gy = py + 8 + i * 18 + h(i) * 4;
          c.beginPath();
          c.moveTo(px, gy);
          c.lineTo(px + TILE, gy + (h(i + 3) - 0.5) * 4);
          c.stroke();
        }
        // 有机的暗斑，避免整条通道是纯色
        if (h(7) > 0.72) {
          c.fillStyle = 'rgba(90,20,40,0.35)';
          c.beginPath();
          c.ellipse(px + 10 + h(8) * 20, py + 12 + h(9) * 16, 6 + h(10) * 5, 4 + h(11) * 3, 0, 0, Math.PI * 2);
          c.fill();
        }
        break;
      }
      case T.NEST_ORGAN: {
        // 巢核地面：脉动的红光，让 Boss 房一眼就认得出来
        c.strokeStyle = `rgba(255,80,110,${0.18 + v * 0.16})`;
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(px + TILE / 2, py + TILE / 2, 6 + h(1) * 6, 0, Math.PI * 2);
        c.stroke();
        c.fillStyle = 'rgba(255,60,90,0.10)';
        c.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
        break;
      }
      case T.NEST_WALL: {
        // 巢壁只在贴近通道的那一侧描边，勾出通道轮廓
        c.strokeStyle = 'rgba(255,70,100,0.20)';
        c.lineWidth = 2;
        const tw = this._tileW || 0, th = this._tileH || 0, arr = this._tileArr;
        const openAt = (dx, dy) => {
          const nx = tx + dx, ny = ty + dy;
          if (!arr || nx < 0 || ny < 0 || nx >= tw || ny >= th) return false;
          const t = arr[ny * tw + nx];
          return t === T.NEST_FLOOR || t === T.NEST_ORGAN;
        };
        c.beginPath();
        if (openAt(0, 1)) { c.moveTo(px, py + TILE); c.lineTo(px + TILE, py + TILE); }
        if (openAt(0, -1)) { c.moveTo(px, py); c.lineTo(px + TILE, py); }
        if (openAt(1, 0)) { c.moveTo(px + TILE, py); c.lineTo(px + TILE, py + TILE); }
        if (openAt(-1, 0)) { c.moveTo(px, py); c.lineTo(px, py + TILE); }
        c.stroke();
        break;
      }
      case T.GRASS: {
        c.strokeStyle = `rgba(150,200,120,${0.05 + v * 0.08})`;
        c.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
          const gx = px + 4 + h(i) * (TILE - 8);
          const gy = py + 6 + h(i + 5) * (TILE - 12);
          c.beginPath();
          c.moveTo(gx, gy + 4);
          c.lineTo(gx + (h(i + 9) - 0.5) * 3, gy - 2);
          c.stroke();
        }
        break;
      }
      case T.SAND:
      case T.REGOLITH: {
        c.fillStyle = `rgba(0,0,0,${0.03 + v * 0.04})`;
        c.beginPath();
        c.arc(px + h(1) * TILE, py + h(2) * TILE, 1 + h(3) * 1.6, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = `rgba(255,255,255,0.035)`;
        c.beginPath();
        c.arc(px + h(4) * TILE, py + h(6) * TILE, 0.8 + h(7) * 1.2, 0, Math.PI * 2);
        c.fill();
        break;
      }
      case T.ROCK:
      case T.MOUNTAIN: {
        c.fillStyle = tile === T.MOUNTAIN ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.045)';
        c.beginPath();
        c.moveTo(px + 3, py + TILE - 4);
        c.lineTo(px + TILE * 0.4, py + 5 + v * 6);
        c.lineTo(px + TILE - 4, py + TILE - 5);
        c.closePath();
        c.fill();
        c.fillStyle = 'rgba(0,0,0,0.18)';
        c.fillRect(px, py + TILE - 4, TILE, 4);
        this.drawSolidEdge(c, tx, ty, px, py);
        break;
      }
      case T.WATER: {
        c.fillStyle = `rgba(120,220,255,${0.04 + v * 0.05})`;
        const wy = py + 8 + Math.sin(this.time * 1.4 + tx * 0.4 + ty * 0.3) * 3;
        c.fillRect(px + 3, wy, TILE - 6, 2);
        c.fillStyle = 'rgba(0,0,0,0.16)';
        c.fillRect(px, py, TILE, 2);
        this.drawSolidEdge(c, tx, ty, px, py);
        break;
      }
      case T.CRYSTAL: {
        c.strokeStyle = `rgba(190,150,255,${0.16 + v * 0.14})`;
        c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(px + 6, py + TILE - 7);
        c.lineTo(px + TILE * 0.5, py + 7);
        c.lineTo(px + TILE - 6, py + TILE - 7);
        c.stroke();
        c.fillStyle = `rgba(200,170,255,0.10)`;
        c.fill();
        break;
      }
      case T.SCORCHED: {
        c.fillStyle = `rgba(255,90,40,${0.05 + v * 0.06})`;
        c.beginPath();
        c.arc(px + h(2) * TILE, py + h(3) * TILE, 2 + h(4) * 3, 0, Math.PI * 2);
        c.fill();
        break;
      }
      case T.SWAMP: {
        c.fillStyle = `rgba(140,220,120,${0.06 + v * 0.06})`;
        c.beginPath();
        c.arc(px + h(1) * TILE, py + h(2) * TILE, 3 + h(3) * 4, 0, Math.PI * 2);
        c.fill();
        break;
      }
      case T.ICE: {
        c.strokeStyle = `rgba(220,245,255,${0.10 + v * 0.08})`;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(px, py + h(1) * TILE);
        c.lineTo(px + TILE, py + h(2) * TILE);
        c.stroke();
        break;
      }
      case T.CONCRETE: {
        c.strokeStyle = 'rgba(0,0,0,0.14)';
        c.lineWidth = 1;
        c.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
        c.fillStyle = 'rgba(255,255,255,0.03)';
        c.fillRect(px + 2, py + 2, TILE - 4, 2);
        break;
      }
      case T.ROAD: {
        c.fillStyle = 'rgba(255,220,140,0.10)';
        c.fillRect(px + 4, py + TILE / 2 - 1, TILE - 8, 2);
        break;
      }
      case T.FUNGUS: {
        c.fillStyle = `rgba(220,140,240,${0.10 + v * 0.10})`;
        c.beginPath();
        c.arc(px + h(1) * TILE, py + h(2) * TILE, 2 + h(3) * 2, 0, Math.PI * 2);
        c.fill();
        break;
      }
      case T.ASH: {
        c.fillStyle = `rgba(255,140,80,${0.03 + v * 0.04})`;
        c.fillRect(px + h(1) * TILE, py + h(2) * TILE, 2, 2);
        break;
      }
      default: break;
    }
  }

  // =========================================================
  //  基地与地标
  // =========================================================

  drawBaseZone(ctx, run, view) {
    // 纯塔防模式：把阵地边界画出来。
    // 没有角色可以走动之后，玩家需要一个明确的「这就是我的地盘」，
    // 否则塔该铺多远全靠猜。
    if (run.isTowerDefense && run.bases.length) {
      const b0 = run.bases[0];
      const fr = run.modeDef?.fieldRadius || 900;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,186,76,0.30)';
      ctx.lineWidth = 3;
      ctx.setLineDash([22, 14]);
      ctx.beginPath();
      ctx.arc(b0.x, b0.y, fr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255,186,76,0.10)';
      ctx.lineWidth = 10;
      ctx.stroke();
      ctx.restore();
    }

    for (const b of run.bases) {
      if (b.x < view.x0 - 400 || b.x > view.x1 + 400) continue;
      if (b.y < view.y0 - 400 || b.y > view.y1 + 400) continue;

      ctx.save();
      // 建造范围指示
      ctx.strokeStyle = b.destroyed ? 'rgba(255,80,80,0.18)' : 'rgba(120,210,255,0.14)';
      ctx.lineWidth = 2;
      ctx.setLineDash([14, 12]);
      ctx.beginPath();
      ctx.arc(b.x, b.y, run.buildRadiusFrom ? run.buildRadiusFrom(b) : b.r + 420, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // 核心舱底座
      const pulse = 1 + Math.sin(this.time * 2) * 0.02;
      ctx.translate(b.x, b.y);

      if (b.destroyed) {
        this.drawRubble(ctx, b.r * 0.9);
        /*
         * 重建进度环。
         * 玩家反馈「按 E 重建没反应」—— 除了把 45 秒缩短，更重要的是让进度看得见：
         * 一圈从 0 画到 100% 的环 + 百分比文字，按住的时候每帧都在动。
         */
        const total = BASE.rebuildTime || 12;
        const pct = clamp01((b.repairProgress || 0) / total);
        if (pct > 0.001) {
          ctx.strokeStyle = 'rgba(0,0,0,0.45)';
          ctx.lineWidth = 8;
          ctx.beginPath();
          ctx.arc(0, 0, b.r * 1.15, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = '#6ee7a8';
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.arc(0, 0, b.r * 1.15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
          ctx.stroke();
          ctx.fillStyle = '#d8f5e6';
          ctx.font = 'bold 15px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`重建 ${Math.round(pct * 100)}%`, 0, -b.r * 1.15 - 12);
        } else {
          ctx.fillStyle = 'rgba(255,180,180,0.85)';
          ctx.font = '13px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('按住 E 重建核心舱', 0, -b.r * 1.15 - 12);
        }
        ctx.restore();
        continue;
      }

      // 光晕
      const grd = ctx.createRadialGradient(0, 0, 10, 0, 0, safeR(b.r * 1.8, 60));
      grd.addColorStop(0, 'rgba(90,200,255,0.20)');
      grd.addColorStop(1, 'rgba(90,200,255,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(0, 0, b.r * 1.8, 0, Math.PI * 2);
      ctx.fill();

      // 平台
      ctx.fillStyle = '#2a3446';
      ctx.beginPath();
      ctx.arc(0, 0, b.r * 0.85 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#5d7fa0';
      ctx.lineWidth = 3;
      ctx.stroke();

      // 核心舱本体
      ctx.fillStyle = '#3d5a78';
      ctx.beginPath();
      ctx.roundRect(-b.r * 0.45, -b.r * 0.45, b.r * 0.9, b.r * 0.9, 10);
      ctx.fill();
      ctx.strokeStyle = b.underAttack ? '#ff5f6d' : '#8fe0ff';
      ctx.lineWidth = 3;
      ctx.stroke();

      // 天线
      ctx.strokeStyle = '#8fe0ff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, -b.r * 0.45);
      ctx.lineTo(0, -b.r * 1.1);
      ctx.stroke();
      const blink = (Math.sin(this.time * 4) + 1) / 2;
      ctx.fillStyle = `rgba(255,120,80,${0.4 + blink * 0.6})`;
      ctx.beginPath();
      ctx.arc(0, -b.r * 1.1, 4.5, 0, Math.PI * 2);
      ctx.fill();

      // 舱门与标识
      ctx.fillStyle = '#8fe0ff';
      ctx.font = 'bold 11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('核心舱', 0, b.r * 0.72);

      ctx.restore();
      // 血条
      this.drawHealthBar(ctx, b.x, b.y - b.r - 22, 110, b.hp / b.maxHp, b.shield / Math.max(1, b.maxShield), '#59d8ff', b.name);
    }
  }

  drawRubble(ctx, r) {
    ctx.fillStyle = '#241f1e';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a3330';
    for (let i = 0; i < 7; i++) {
      const a = i * 1.7;
      const rr = r * (0.3 + (i % 3) * 0.2);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 8 + (i % 4) * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,90,60,0.35)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.5 + Math.sin(this.time * 3) * 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff8a6a';
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('废墟 · 按 E 重建', 0, -r - 10);
  }

  drawNests(ctx, run, view) {
    for (const nest of run.world.nests) {
      if (nest.destroyed) continue;
      if (nest.x < view.x0 - 120 || nest.x > view.x1 + 120) continue;
      if (nest.y < view.y0 - 120 || nest.y > view.y1 + 120) continue;

      ctx.save();
      ctx.translate(nest.x, nest.y);

      // 焦土圈
      const g = ctx.createRadialGradient(0, 0, 10, 0, 0, safeR(nest.r * 2.4, 60));
      g.addColorStop(0, 'rgba(180,60,50,0.22)');
      g.addColorStop(1, 'rgba(180,60,50,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, nest.r * 2.4, 0, Math.PI * 2);
      ctx.fill();

      /*
       * 巢穴 = 虫子钻出来的洞。
       *
       * 玩家要求「再细化一些，要像虫子钻出的洞一样」。画法分四层：
       *   1) 洞口外翻的土堆（不规则的环，朝外溅射）
       *   2) 向内塌陷的坡度（多层越来越暗的环）
       *   3) 洞底的黑（真正的「深」）
       *   4) 洞口边上的抓痕 / 爪印 + 呼吸的巢核
       * 每个巢用它的 id 做种子，形状各不相同但每次进游戏都一样。
       */
      const seed = hashSeed(nest.id);
      const t = this.time * 0.8;
      const ring = (rr, wobble, phase) => {
        ctx.beginPath();
        for (let i = 0; i <= 22; i++) {
          const a = (i / 22) * Math.PI * 2;
          const w = 1 + Math.sin(a * 3 + phase + seed) * wobble + Math.sin(a * 7 + seed * 2) * wobble * 0.4;
          const x = Math.cos(a) * rr * w;
          const y = Math.sin(a) * rr * w;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
      };

      // 1) 外翻的土堆：一圈碎石与翻出来的土
      ctx.fillStyle = '#4a2a22';
      ring(nest.r * 1.34, 0.11, 0);
      ctx.fill();
      ctx.fillStyle = '#3a2019';
      ring(nest.r * 1.22, 0.09, 0.7);
      ctx.fill();
      // 溅出来的土粒
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + seed * 3;
        const rr = nest.r * (1.25 + ((i * 37) % 11) / 44);
        ctx.fillStyle = i % 2 ? 'rgba(90,52,40,0.85)' : 'rgba(60,34,28,0.9)';
        ctx.beginPath();
        ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 2.5 + ((i * 17) % 5) * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // 2) 向内塌陷的坡度
      const slope = [
        { rr: 1.06, c: '#2c1712' },
        { rr: 0.84, c: '#1d0f0c' },
        { rr: 0.60, c: '#120807' },
      ];
      for (const s2 of slope) {
        ctx.fillStyle = s2.c;
        ring(nest.r * s2.rr, 0.07, s2.rr);
        ctx.fill();
      }

      // 3) 洞底：真正的黑，让「深」看起来是深的
      const hole = ctx.createRadialGradient(0, 0, 2, 0, 0, safeR(nest.r * 0.5, 20));
      hole.addColorStop(0, '#000000');
      hole.addColorStop(0.7, '#070303');
      hole.addColorStop(1, 'rgba(10,4,4,0)');
      ctx.fillStyle = hole;
      ring(nest.r * 0.5, 0.06, 1.4);
      ctx.fill();

      // 4) 洞口抓痕
      ctx.strokeStyle = 'rgba(210,120,90,0.22)';
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + seed;
        const r0 = nest.r * 0.62, r1 = nest.r * (0.92 + (i % 3) * 0.06);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        ctx.lineTo(Math.cos(a + 0.06) * r1, Math.sin(a + 0.06) * r1);
        ctx.stroke();
      }

      // 呼吸的巢核（洞口深处的红光）
      const pulse = 0.6 + Math.sin(t * 2) * 0.4;
      const core = ctx.createRadialGradient(0, 0, 1, 0, 0, safeR(nest.r * 0.42, 18));
      core.addColorStop(0, `rgba(255,120,90,${0.55 + pulse * 0.45})`);
      core.addColorStop(1, 'rgba(255,60,40,0)');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(0, 0, nest.r * 0.42, 0, Math.PI * 2);
      ctx.fill();

      // 等级标识
      ctx.fillStyle = '#ffd0c0';
      ctx.font = 'bold 12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`T${nest.tier}`, 0, -nest.r * 1.45);

      ctx.restore();

      this.drawHealthBar(ctx, nest.x, nest.y - nest.r * 1.7, 120, nest.hp / nest.maxHp, 0, '#ff5f6d', nest.name, true);
    }
  }

  drawPois(ctx, run, view) {
    for (const poi of run.world.pois) {
      if (poi.x < view.x0 - 200 || poi.x > view.x1 + 200) continue;
      if (poi.y < view.y0 - 200 || poi.y > view.y1 + 200) continue;
      ctx.save();
      ctx.translate(poi.x, poi.y);

      switch (poi.kind) {
        case 'ruin': this.drawRuin(ctx, poi); break;
        case 'crash': this.drawCrash(ctx, poi); break;
        case 'obelisk': this.drawObelisk(ctx, poi); break;
        case 'vault': this.drawVault(ctx, poi); break;
        default: break;
      }

      // 名字
      const label = poi.name || poi.kind;
      const color = poi.looted ? '#64748b' : '#8fe0ff';
      ctx.fillStyle = color;
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(label, 0, -poi.r - 8);
      if (!poi.looted) {
        const bob = Math.sin(this.time * 2.5) * 3;
        ctx.fillStyle = '#ffba4c';
        ctx.font = 'bold 12px system-ui';
        ctx.fillText('!', 0, -poi.r - 24 + bob);
      }
      ctx.restore();
    }
  }

  drawRuin(ctx, poi) {
    const r = poi.r;
    // 残破地基
    ctx.fillStyle = 'rgba(40,46,56,0.85)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5a6474';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
    // 残墙
    ctx.fillStyle = '#6a7484';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const w = 18 + (i % 3) * 8;
      ctx.save();
      ctx.rotate(a);
      ctx.fillRect(r * 0.42, -6, w, 12);
      ctx.restore();
    }
    // 中央废弃吸引阵列
    if (poi.beaconSalvage && !poi.beaconTaken) {
      const glow = 0.5 + Math.sin(this.time * 3) * 0.5;
      ctx.fillStyle = '#2a3446';
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ff9a4c';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = `rgba(255,150,80,${0.4 + glow * 0.6})`;
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,150,80,${0.15 + glow * 0.2})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 34 + glow * 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawCrash(ctx, poi) {
    const r = poi.r;
    ctx.fillStyle = '#2c3138';
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.9, r * 0.5, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8d99a8';
    ctx.beginPath();
    ctx.moveTo(-r * 0.8, 0);
    ctx.lineTo(0, -r * 0.45);
    ctx.lineTo(r * 0.7, -r * 0.1);
    ctx.lineTo(r * 0.2, r * 0.3);
    ctx.lineTo(-r * 0.6, r * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#c0ccd8';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 尾焰痕迹
    ctx.strokeStyle = 'rgba(255,140,60,0.25)';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(-r * 1.5, r * 0.6);
    ctx.lineTo(-r * 0.6, r * 0.1);
    ctx.stroke();
  }

  drawObelisk(ctx, poi) {
    const h = 54;
    const glow = 0.5 + Math.sin(this.time * 1.8) * 0.5;
    ctx.fillStyle = 'rgba(90,200,255,0.14)';
    ctx.beginPath();
    ctx.arc(0, 0, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = poi.looted ? '#40505e' : '#2b4a5e';
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.lineTo(16, 0);
    ctx.lineTo(0, h * 0.5);
    ctx.lineTo(-16, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = poi.looted ? '#5a6a78' : `rgba(120,220,255,${0.5 + glow * 0.5})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    if (!poi.looted) {
      ctx.strokeStyle = `rgba(150,235,255,${0.3 + glow * 0.4})`;
      ctx.lineWidth = 1.5;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(-12, i * 12);
        ctx.lineTo(12, i * 12);
        ctx.stroke();
      }
    }
  }

  drawVault(ctx, poi) {
    const r = poi.r;
    ctx.fillStyle = '#2a2f3a';
    ctx.beginPath();
    ctx.roundRect(-r * 0.7, -r * 0.5, r * 1.4, r, 10);
    ctx.fill();
    ctx.strokeStyle = poi.looted ? '#55606e' : '#c08cff';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = poi.looted ? '#3a4048' : '#c08cff';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0b1020';
    ctx.font = 'bold 14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('V', 0, 5);
  }

  // =========================================================
  //  吸引阵列
  // =========================================================

  drawBeacon(ctx, run, view) {
    const b = run.beacon;
    if (b.x < view.x0 - 1600 || b.x > view.x1 + 1600) return;
    if (b.y < view.y0 - 1600 || b.y > view.y1 + 1600) return;

    ctx.save();
    ctx.translate(b.x + 74, b.y - 74);

    // 影响范围（只在装置运转时显示，且很淡）
    if (b.online) {
      const pulse = 0.5 + Math.sin(this.time * 1.2) * 0.5;
      ctx.strokeStyle = `rgba(255,150,80,${0.10 + pulse * 0.06})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([20, 16]);
      ctx.beginPath();
      ctx.arc(0, 0, b.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      const g = ctx.createRadialGradient(0, 0, safeR(b.radius * 0.2, 60), 0, 0, safeR(b.radius, 300));
      g.addColorStop(0, 'rgba(255,150,80,0.05)');
      g.addColorStop(1, 'rgba(255,150,80,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, b.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 塔身
    const rr = 20;
    ctx.fillStyle = '#242c3a';
    ctx.beginPath();
    ctx.arc(0, 0, rr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = b.online ? '#ff9a4c' : '#556';
    ctx.lineWidth = 3;
    ctx.stroke();

    // 三脚架
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * rr * 1.5, Math.sin(a) * rr * 1.5);
      ctx.stroke();
    }

    // 核心
    if (b.online) {
      const pulse = 0.6 + Math.sin(this.time * 4) * 0.4;
      ctx.fillStyle = `rgba(255,170,90,${0.6 + pulse * 0.4})`;
      ctx.beginPath();
      ctx.arc(0, 0, 9 * (0.9 + pulse * 0.2), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,200,140,${0.12 + pulse * 0.12})`;
      ctx.beginPath();
      ctx.arc(0, 0, 30 + pulse * 8, 0, Math.PI * 2);
      ctx.fill();
      // 旋转扫描线
      ctx.strokeStyle = `rgba(255,180,100,0.35)`;
      ctx.lineWidth = 2;
      const a = this.time * 1.6;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * 46, Math.sin(a) * 46);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#46505e';
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 信息条
    const label = b.online
      ? `吸引阵列 Lv${b.level} · 强度 ${(b.intensity * 100).toFixed(0)}%`
      : '吸引阵列 离线';
    this.drawHealthBar(ctx, b.x + 74, b.y - 74 - 44, 120,
      b.fuel / b.fuelMax, 0, b.online ? '#ff9a4c' : '#ff5f6d', label, false, '能量');
  }

  // =========================================================
  //  障碍物
  // =========================================================

  drawProps(ctx, world, view) {
    for (const prop of world.props.values()) {
      if (prop.dead) continue;
      if (prop.x < view.x0 - 60 || prop.x > view.x1 + 60) continue;
      if (prop.y < view.y0 - 60 || prop.y > view.y1 + 60) continue;
      const def = PROP_DEF[prop.type];
      if (!def) continue;
      this.frameStats.entities++;
      ctx.save();
      const shake = prop.shake > 0 ? prop.shake : 0;
      ctx.translate(prop.x + (shake ? (Math.random() - 0.5) * 3 : 0), prop.y + (shake ? (Math.random() - 0.5) * 3 : 0));
      ctx.scale(prop.scale || 1, prop.scale || 1);
      this.drawPropShape(ctx, prop, def);
      if (prop.hitFlash > 0) {
        ctx.globalAlpha = prop.hitFlash * 0.5;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(0, 0, def.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      // 采集进度
      if (world.game?.playerSystem?.harvestTarget === prop) {
        const prog = world.game.playerSystem.harvestProgress;
        this.drawHealthBar(ctx, prop.x, prop.y - def.r - 16, 46, 1 - prog, 0, '#ffba4c', '', false);
      }
    }
  }

  drawPropShape(ctx, prop, def) {
    const r = def.r;
    const c = def.color;

    // 贴图优先（逻辑名 `prop.<type>`）：画布已平移到实体位置，直接画在原点
    const sprite = this.assets?.propTexture?.(prop.type) || null;
    if (sprite) {
      const size = r * 2.4;
      ctx.fillStyle = SHADOW;
      ctx.beginPath();
      ctx.ellipse(2, r * 0.55, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
      return;
    }

    switch (def.shape) {
      case 'tree': {
        ctx.fillStyle = SHADOW;
        ctx.beginPath();
        ctx.ellipse(3, r * 0.7, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4a3a2a';
        ctx.fillRect(-3, -r * 0.1, 6, r * 0.9);
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(0, -r * 0.45, r * 0.82, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = shade(c, 0.2);
        ctx.beginPath();
        ctx.arc(-r * 0.25, -r * 0.65, r * 0.45, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'bush': {
        ctx.fillStyle = SHADOW;
        ctx.beginPath();
        ctx.ellipse(2, r * 0.5, r * 0.9, r * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = c;
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.28 - r * 0.15, r * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = shade(c, -0.2);
        ctx.beginPath();
        ctx.arc(0, -r * 0.4, r * 0.32, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'patch': {
        ctx.fillStyle = c;
        ctx.globalAlpha = 0.85;
        for (let i = 0; i < 5; i++) {
          const a = i * 1.3;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.35, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'rock': {
        ctx.fillStyle = SHADOW;
        ctx.beginPath();
        ctx.ellipse(2, r * 0.55, r * 0.95, r * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(-r, r * 0.5);
        ctx.lineTo(-r * 0.5, -r * 0.8);
        ctx.lineTo(r * 0.3, -r);
        ctx.lineTo(r, r * 0.2);
        ctx.lineTo(r * 0.4, r * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.beginPath();
        ctx.moveTo(-r * 0.5, -r * 0.8);
        ctx.lineTo(r * 0.3, -r);
        ctx.lineTo(0, -r * 0.2);
        ctx.closePath();
        ctx.fill();
        // 矿脉亮点
        ctx.fillStyle = '#ffe08a';
        ctx.beginPath();
        ctx.arc(r * 0.2, 0, 2.5, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'crystal': {
        ctx.fillStyle = SHADOW;
        ctx.beginPath();
        ctx.ellipse(2, r * 0.6, r * 0.7, r * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 - 0.4;
          const h = r * (0.9 + (i % 2) * 0.4);
          ctx.save();
          ctx.rotate(a);
          ctx.fillStyle = i === 1 ? shade(c, 0.25) : c;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(-5, -h * 0.35);
          ctx.lineTo(0, -h);
          ctx.lineTo(5, -h * 0.35);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.arc(0, -r * 0.7, 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'scrap': {
        ctx.fillStyle = SHADOW;
        ctx.beginPath();
        ctx.ellipse(2, r * 0.5, r * 0.9, r * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = c;
        ctx.save();
        ctx.rotate(prop.variant * 2);
        ctx.fillRect(-r * 0.8, -r * 0.3, r * 1.6, r * 0.6);
        ctx.rotate(0.7);
        ctx.fillRect(-r * 0.6, -r * 0.25, r * 1.2, r * 0.5);
        ctx.restore();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-r * 0.8, -r * 0.3, r * 1.6, r * 0.6);
        break;
      }
      case 'vent': {
        ctx.fillStyle = '#4a4038';
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
        ctx.fill();
        // 喷气
        const t = (this.time * 1.5 + prop.variant * 6) % 3;
        if (t < 1) {
          ctx.fillStyle = `rgba(255,220,140,${0.3 * (1 - t)})`;
          ctx.beginPath();
          ctx.arc(0, -r * (0.6 + t * 1.5), r * (0.3 + t * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'sac': {
        const pulse = 1 + Math.sin(this.time * 3 + prop.variant * 8) * 0.06;
        ctx.fillStyle = SHADOW;
        ctx.beginPath();
        ctx.ellipse(2, r * 0.6, r * 0.8, r * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.7 * pulse, r * 0.9 * pulse, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.beginPath();
        ctx.ellipse(-r * 0.2, -r * 0.25, r * 0.2, r * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(90,30,40,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-r * 0.6, 0);
        ctx.lineTo(r * 0.6, 0);
        ctx.stroke();
        break;
      }
      case 'wreck': {
        ctx.fillStyle = SHADOW;
        ctx.beginPath();
        ctx.ellipse(3, r * 0.5, r, r * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(-r, r * 0.3);
        ctx.lineTo(-r * 0.3, -r * 0.7);
        ctx.lineTo(r * 0.8, -r * 0.3);
        ctx.lineTo(r * 0.5, r * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#3a424c';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#ff7a4c';
        ctx.beginPath();
        ctx.arc(-r * 0.2, 0, 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'obelisk': {
        const glow = 0.5 + Math.sin(this.time * 2 + prop.variant * 5) * 0.5;
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.4, 0);
        ctx.lineTo(0, r * 0.7);
        ctx.lineTo(-r * 0.4, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = `rgba(150,240,255,${0.4 + glow * 0.5})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }
      case 'crate': {
        ctx.fillStyle = SHADOW;
        ctx.beginPath();
        ctx.ellipse(2, r * 0.5, r * 0.8, r * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = c;
        ctx.fillRect(-r * 0.7, -r * 0.6, r * 1.4, r * 1.2);
        ctx.strokeStyle = '#6a5a3a';
        ctx.lineWidth = 2;
        ctx.strokeRect(-r * 0.7, -r * 0.6, r * 1.4, r * 1.2);
        ctx.beginPath();
        ctx.moveTo(-r * 0.7, 0);
        ctx.lineTo(r * 0.7, 0);
        ctx.moveTo(0, -r * 0.6);
        ctx.lineTo(0, r * 0.6);
        ctx.stroke();
        break;
      }
      default: {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
  }

  // =========================================================
  //  建筑
  // =========================================================

  drawBuildings(ctx, run, view) {
    // 先画结构（墙/农田等），再画塔
    for (const s of run.structures) {
      if (s.x < view.x0 - 80 || s.x > view.x1 + 80) continue;
      if (s.y < view.y0 - 80 || s.y > view.y1 + 80) continue;
      this.drawStructure(ctx, s);
    }
    // 坐在基座上的塔画一圈底座高亮（让「基座免间隔」这件事看得见）
    this.drawTowerPlatforms(ctx, run, view);
    for (const t of run.towers) {      if (t.x < view.x0 - 80 || t.x > view.x1 + 80) continue;
      if (t.y < view.y0 - 80 || t.y > view.y1 + 80) continue;
      this.drawTower(ctx, t, run);
    }
    // 城镇建筑
    if (run.townBuildings) {
      for (const b of run.townBuildings) {
        if (b.x < view.x0 - 80 || b.x > view.x1 + 80) continue;
        if (b.y < view.y0 - 80 || b.y > view.y1 + 80) continue;
        this.drawTownBuilding(ctx, b);
      }
    }
  }

  /**
   * 坐在【防御塔基座】上的塔画一圈底座高亮。
   *
   * 玩家明确说过基座的作用是「取消塔与塔之间的间隔」（不是给相邻塔加数值），
   * 所以这里只做可视反馈：有基座的塔底座亮一圈绿光，
   * 玩家一眼能看出「这块地是铺过基座的，可以挨着放」。
   */
  drawTowerPlatforms(ctx, run, view) {
    if (!run.towers?.length) return;
    ctx.save();
    for (const t of run.towers) {
      if (t.hp <= 0 || t.building) continue;
      if (t.x < view.x0 - 80 || t.x > view.x1 + 80) continue;
      if (t.y < view.y0 - 80 || t.y > view.y1 + 80) continue;
      if (!t.onPlatform) continue;
      const pulse = 0.5 + Math.sin(this.time * 3 + t.x * 0.01) * 0.5;
      ctx.strokeStyle = `rgba(110,231,168,${0.35 + pulse * 0.25})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 23, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawTower(ctx, t, run) {
    this.frameStats.entities++;
    ctx.save();
    ctx.translate(t.x, t.y);

    // 地基阴影
    ctx.fillStyle = SHADOW;
    ctx.beginPath();
    ctx.arc(2, 4, 20, 0, Math.PI * 2);
    ctx.fill();

    // 建造中：显示空投舱下落
    if (t.building) {
      const p = clamp01(t.buildProgress);
      const dropY = -220 * (1 - p * p);
      ctx.strokeStyle = 'rgba(140,220,255,0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.translate(0, dropY);
      ctx.fillStyle = '#5a7a94';
      ctx.beginPath();
      ctx.roundRect(-16, -22, 32, 40, 6);
      ctx.fill();
      ctx.strokeStyle = '#8fe0ff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,180,80,0.8)';
      ctx.beginPath();
      ctx.moveTo(-10, 18);
      ctx.lineTo(0, 34 + Math.random() * 8);
      ctx.lineTo(10, 18);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // 进度条
      this.drawHealthBar(ctx, t.x, t.y - 70, 60, p, 0, '#8fe0ff', '空投中');
      return;
    }

    // 基座
    ctx.fillStyle = '#38414f';
    ctx.beginPath();
    ctx.arc(0, 0, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = t.manual ? '#ffba4c' : '#6a7788';
    ctx.lineWidth = t.manual ? 3 : 2;
    ctx.stroke();

    // 坐在基座上的塔：基座指示灯
    if (t.onPlatform) {
      ctx.fillStyle = '#6ee7a8';
      ctx.beginPath();
      ctx.arc(0, 13, 2.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // 炮管 / 塔身
    ctx.save();
    ctx.rotate(t.angle);
    const def = t.def;
    ctx.fillStyle = def.color;
    switch (def.kind) {
      case 'aural':
      case 'aura': {
        ctx.beginPath();
        ctx.arc(0, 0, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.arc(0, 0, 7 + Math.sin(this.time * 5) * 1.5, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'shell': {
        ctx.fillRect(-6, -9, 26, 18);
        ctx.fillStyle = shade(def.color, -0.3);
        ctx.fillRect(14, -7, 8, 14);
        break;
      }
      case 'beam': {
        ctx.fillRect(-4, -6, 34, 12);
        ctx.fillStyle = '#fff';
        ctx.fillRect(24, -3, 12, 6);
        break;
      }
      default: {
        ctx.fillRect(-5, -6, 26, 12);
        ctx.fillStyle = shade(def.color, -0.35);
        ctx.fillRect(18, -4, 10, 8);
        break;
      }
    }
    ctx.restore();

    // 塔顶装饰
    ctx.fillStyle = shade(def.color, 0.25);
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();

    // 手动接管的瞄准指示
    if (t.manual) {
      ctx.strokeStyle = `rgba(255,186,76,${0.3 + Math.sin(this.time * 6) * 0.2})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 过载就绪
    const st = run.playerStats;
    const oc = st.mechanics.towerOvercharge;
    if (oc) {
      const p = clamp01((t.overchargeTimer || 0) / oc.every);
      ctx.strokeStyle = `rgba(255,220,120,${0.25 + p * 0.6})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 23, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
      ctx.stroke();
    }

    // 耐久环
    const hpFrac = t.hp / t.hpMax;
    if (hpFrac < 0.999) {
      ctx.strokeStyle = hpFrac > 0.5 ? '#6ee7a8' : hpFrac > 0.25 ? '#ffba4c' : '#ff5f6d';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 19, -Math.PI / 2, -Math.PI / 2 + hpFrac * Math.PI * 2);
      ctx.stroke();
    }
    if (t.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${t.hitFlash * 0.5})`;
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawStructure(ctx, s) {
    this.frameStats.entities++;
    const def = s.def;
    ctx.save();
    ctx.translate(s.x, s.y);

    if (s.building) {
      ctx.globalAlpha = 0.4 + s.buildProgress * 0.5;
    }

    ctx.fillStyle = SHADOW;
    ctx.fillRect(-s.r + 2, -s.r + 3, s.r * 2, s.r * 2);

    ctx.fillStyle = def.color;
    ctx.fillRect(-s.r, -s.r, s.r * 2, s.r * 2);
    ctx.strokeStyle = shade(def.color, -0.35);
    ctx.lineWidth = 2;
    ctx.strokeRect(-s.r, -s.r, s.r * 2, s.r * 2);

    // 图标
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.font = 'bold 16px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.icon || '▪', 0, 1);
    ctx.textBaseline = 'alphabetic';

    // 岗位人数
    if (def.jobs) {
      ctx.fillStyle = s.workers > 0 ? '#6ee7a8' : '#64748b';
      ctx.font = 'bold 10px system-ui';
      ctx.fillText(`${s.workers || 0}/${def.jobs}`, 0, s.r - 3);
    }

    // 护盾
    if (s.shield > 0) {
      ctx.strokeStyle = `rgba(192,140,255,${0.4 + (s.shield / Math.max(1, s.shieldMax)) * 0.4})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, s.r + 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    if (s.hp < s.hpMax) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(-s.r, -s.r - 8, s.r * 2, 4);
      ctx.fillStyle = '#6ee7a8';
      ctx.fillRect(-s.r, -s.r - 8, s.r * 2 * (s.hp / s.hpMax), 4);
    }
    ctx.restore();
  }

  drawTownBuilding(ctx, b) {
    const def = TOWN_BUILDING_DEF[b.type];
    if (!def) return;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.fillStyle = SHADOW;
    ctx.beginPath();
    ctx.arc(2, 4, 20, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2f3a4a';
    ctx.beginPath();
    ctx.roundRect(-20, -20, 40, 40, 6);
    ctx.fill();
    ctx.strokeStyle = '#6ee7a8';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#cfe8ff';
    ctx.font = 'bold 17px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.icon, 0, 0);
    ctx.textBaseline = 'alphabetic';

    if (def.jobs) {
      ctx.fillStyle = b.workers > 0 ? '#6ee7a8' : '#64748b';
      ctx.font = 'bold 10px system-ui';
      ctx.fillText(`${b.workers || 0}/${def.jobs}`, 0, 32);
    }
    ctx.restore();
  }

  // =========================================================
  //  载具 / 玩家 / 宠物
  // =========================================================

  drawVehicle(ctx, run, view) {
    const v = run.vehicle;
    if (v.x < view.x0 - 80 || v.x > view.x1 + 80) return;
    if (v.y < view.y0 - 80 || v.y > view.y1 + 80) return;
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(v.angle || 0);

    ctx.fillStyle = SHADOW;
    ctx.beginPath();
    ctx.ellipse(2, 5, 30, 20, 0, 0, Math.PI * 2);
    ctx.fill();

    if (v.destroyed) {
      ctx.fillStyle = '#3a3a3a';
      ctx.beginPath();
      ctx.roundRect(-26, -18, 52, 36, 8);
      ctx.fill();
      ctx.fillStyle = '#ff7a4c';
      ctx.font = 'bold 14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('✕', 0, 5);
      ctx.restore();
      return;
    }

    // 车身
    ctx.fillStyle = run.characterId === 'pilot' ? '#2e5a48' : '#3a4452';
    ctx.beginPath();
    ctx.roundRect(-26, -17, 52, 34, 7);
    ctx.fill();
    ctx.strokeStyle = '#6ee7a8';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 座舱
    ctx.fillStyle = '#8fe0ff';
    ctx.beginPath();
    ctx.roundRect(2, -11, 16, 22, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(5, -8, 5, 16);

    // 轮子
    ctx.fillStyle = '#1e242c';
    ctx.fillRect(-22, -21, 12, 6);
    ctx.fillRect(-22, 15, 12, 6);
    ctx.fillRect(10, -21, 12, 6);
    ctx.fillRect(10, 15, 12, 6);

    // 挂载武器
    for (let i = 0; i < v.mounted.length; i++) {
      if (!v.mounted[i]) continue;
      ctx.fillStyle = '#9aa4b0';
      ctx.fillRect(-6, -24 - i * 5, 20, 5);
    }

    // 便携吸引装置
    if (v.beacon) {
      const pulse = 0.5 + Math.sin(this.time * 4) * 0.5;
      ctx.fillStyle = `rgba(255,150,80,${0.5 + pulse * 0.5})`;
      ctx.beginPath();
      ctx.arc(-18, 0, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // 耐久条
    if (v.hp < v.hpMax || run.player.inVehicle) {
      this.drawHealthBar(ctx, v.x, v.y - 38, 70, v.hp / v.hpMax, 0, '#6ee7a8', v.name);
    }
  }

  drawPlayer(ctx, run, view) {
    const p = run.player;
    if (p.dead) return;
    if (p.inVehicle) return;
    ctx.save();
    ctx.translate(p.x, p.y);

    // 影子
    ctx.fillStyle = SHADOW;
    ctx.beginPath();
    ctx.ellipse(2, 6, 13, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // 无敌闪烁
    if (p.invuln > 0 && Math.floor(this.time * 12) % 2 === 0) ctx.globalAlpha = 0.45;

    const color = run.charDef.color;
    ctx.save();
    ctx.rotate(p.facing);
    // 身体
    ctx.fillStyle = '#2c3644';
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // 面朝方向的指示（背包/肩甲）
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(8, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    // 手持武器
    const w = run.playerSystem?.currentWeapon?.();
    if (w) {
      ctx.fillStyle = w.def.color || '#d0c090';
      const len = w.def.kind === 'melee' ? 20 : 16;
      ctx.fillRect(10, -3, len, 6);
      if (w.def.kind === 'melee') {
        ctx.fillStyle = '#e8e0d0';
        ctx.fillRect(10 + len - 6, -5, 7, 10);
      }
    }
    ctx.restore();

    // 角色图标
    ctx.fillStyle = color;
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(run.charDef.icon, 0, 4);

    ctx.globalAlpha = 1;

    // 状态
    if (run.time < p.frenzyUntil) {
      ctx.strokeStyle = `rgba(255,90,80,${0.4 + Math.sin(this.time * 10) * 0.3})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 19, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (p.shield > 0) {
      ctx.strokeStyle = 'rgba(89,216,255,0.6)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 17, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // 生命条
    const hpFrac = p.hp / p.hpMax;
    if (hpFrac < 0.98) {
      this.drawHealthBar(ctx, p.x, p.y - 32, 54, hpFrac, 0, hpFrac > 0.4 ? '#ff5f6d' : '#ff9a4c', '');
    }
  }

  drawTamePets(ctx, run, view) {
    for (const pet of run.tamePets) {
      if (pet.dead) continue;
      if (pet.x < view.x0 - 60 || pet.x > view.x1 + 60) continue;
      ctx.save();
      ctx.translate(pet.x, pet.y);
      ctx.fillStyle = 'rgba(110,231,168,0.2)';
      ctx.beginPath();
      ctx.arc(0, 0, pet.r + 5, 0, Math.PI * 2);
      ctx.fill();
      this.drawEnemyBody(ctx, pet, true);
      ctx.restore();
      this.drawHealthBar(ctx, pet.x, pet.y - pet.r - 12, 40, pet.hp / pet.hpMax, 0, '#6ee7a8', '');
    }
  }

  // =========================================================
  //  敌人
  // =========================================================

  drawEnemies(ctx, run, view) {
    // 预警（红色感叹号 + 冲撞走廊）画在怪**下面**，免得挡住血条与本体
    this.drawBossTelegraphs(ctx, run, view);
    for (const e of run.enemies) {
      if (e.dead) continue;
      if (e.x < view.x0 - 90 || e.x > view.x1 + 90) continue;
      if (e.y < view.y0 - 90 || e.y > view.y1 + 90) continue;
      this.frameStats.entities++;
      ctx.save();
      ctx.translate(e.x, e.y);

      // 出场缩放
      let sc = 1;
      if (e.spawnAnim > 0) sc = 1 + e.spawnAnim * 0.6;
      if (e.def.scale) sc *= e.def.scale;
      ctx.scale(sc, sc);
      if (e.spawnAnim > 0) ctx.globalAlpha = 1 - e.spawnAnim * 1.6;

      // 潜地
      if (e.burrowed) ctx.globalAlpha *= 0.35;

      this.drawEnemyBody(ctx, e, false);
      ctx.restore();

      // 状态图标
      this.drawEnemyStatus(ctx, e);
      // 血条（精英/Boss/受伤）—— 位置按「视觉半径」算，否则 Boss 的血条会飘在半空
      const frac = e.hp / e.hpMax;
      if (frac < 0.999 || e.elite || e.boss) {
        const vr = e.r * (e.def.scale || 1);
        const w = e.boss ? 76 : e.elite ? 56 : 34;
        this.drawHealthBar(ctx, e.x, e.y - vr - (e.boss ? 14 : 10), w, frac, 0,
          e.boss ? '#ff3f4f' : e.elite ? '#ff9a4c' : '#ff5f6d', '',
          e.elite, e.boss);
      }
    }
  }

  /**
   * Boss 技能预警。
   *
   * 玩家要求「红色感叹号预警后的冲撞」—— 光有感叹号还不够，
   * 得让玩家知道**往哪边躲**：所以除了头顶的红色「!」，
   * 还按锁定的角度画出一条红色冲撞走廊（越长越亮 = 越接近发动）。
   */
  drawBossTelegraphs(ctx, run, view) {
    for (const e of run.enemies) {
      if (e.dead) continue;
      const c = e.casting;
      const inView = e.x > view.x0 - 400 && e.x < view.x1 + 400
        && e.y > view.y0 - 400 && e.y < view.y1 + 400;
      if (!inView) continue;

      if (c && c.kind === 'charge') {
        const ab = c.ab || {};
        const warn = ab.warn || 1;
        const k = clamp01(1 - c.t / warn);          // 0 → 1 蓄力进度
        const len = ab.dist || 520;
        const half = ab.halfWidth || 54;
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(c.angle);
        // 走廊
        const grad = ctx.createLinearGradient(0, 0, len, 0);
        grad.addColorStop(0, `rgba(255,63,79,${0.10 + k * 0.16})`);
        grad.addColorStop(1, 'rgba(255,63,79,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, -half, len, half * 2);
        ctx.strokeStyle = `rgba(255,63,79,${0.30 + k * 0.5})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([14, 10]);
        ctx.strokeRect(0, -half, len, half * 2);
        ctx.setLineDash([]);
        ctx.restore();

        // 头顶红色感叹号（蓄力时越来越大 + 抖动）
        const bob = Math.sin(this.time * 24) * 3 * k;
        const y = e.y - e.r * (e.def.scale || 1) - 30 + bob;
        const s = 1 + k * 0.5;
        ctx.save();
        ctx.translate(e.x, y);
        ctx.scale(s, s);
        ctx.fillStyle = '#ff3f4f';
        ctx.strokeStyle = 'rgba(0,0,0,0.65)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(-6, -16, 12, 22, 4);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 12, 4.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // 冲撞尾迹
      if (e.dash) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#ff5f6d';
        ctx.beginPath();
        ctx.ellipse(e.x - e.dash.x * 30, e.y - e.dash.y * 30, e.r * 1.1, e.r * 0.8,
          Math.atan2(e.dash.y, e.dash.x), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  drawEnemyBody(ctx, e, friendly) {
    const def = e.def;
    const r = e.r;
    const col = friendly ? '#6ee7a8' : def.color;

    /*
     * 贴图优先（逻辑名 `enemy.<type>`，见 core/assets.js）。
     * 画布此时已经平移到实体位置并按 def.scale 缩放过，所以贴图直接画在原点。
     * 没有贴图就继续走下面的程序化绘制 —— 两套并存，可以一个一个换。
     */
    const sprite = this.assets?.enemyTexture?.(e.type) || null;
    if (sprite) {
      const size = r * 2.2;
      ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
      if (e.hitFlash > 0) {
        ctx.globalAlpha = e.hitFlash * 0.6;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      return;
    }

    // 影子
    ctx.fillStyle = SHADOW;
    ctx.beginPath();
    ctx.ellipse(2, r * 0.55, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.rotate(e.angle);

    switch (def.shape) {
      case 'spider': {
        ctx.strokeStyle = shade(col, -0.2);
        ctx.lineWidth = 2.5;
        for (let i = 0; i < 4; i++) {
          const a = -0.9 + i * 0.6;
          const side = i < 2 ? -1 : 1;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a) * r * 0.4, side * r * 1.15);
          ctx.lineTo(Math.cos(a) * r * 1.3, side * r * 1.0);
          ctx.stroke();
        }
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.85, r * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = shade(col, -0.35);
        ctx.beginPath();
        ctx.arc(r * 0.55, 0, r * 0.45, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'mantis': {
        ctx.strokeStyle = col;
        ctx.lineWidth = 3.4;
        // 镰刀前肢
        ctx.beginPath();
        ctx.moveTo(r * 0.3, -r * 0.4);
        ctx.lineTo(r * 1.3, -r * 0.8);
        ctx.moveTo(r * 0.3, r * 0.4);
        ctx.lineTo(r * 1.3, r * 0.8);
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.95, r * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = shade(col, 0.25);
        ctx.beginPath();
        ctx.moveTo(-r * 0.6, -r * 0.5);
        ctx.lineTo(-r * 1.3, 0);
        ctx.lineTo(-r * 0.6, r * 0.5);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'spitter': {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(0, 0, r, r * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = shade(col, -0.3);
        ctx.beginPath();
        ctx.arc(r * 0.5, 0, r * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#d8ffb0';
        ctx.beginPath();
        ctx.arc(r * 0.8, 0, r * 0.22, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'flyer': {
        const flap = Math.sin(this.time * 22 + e.wobble) * 0.5;
        ctx.fillStyle = `rgba(255,255,255,0.35)`;
        ctx.beginPath();
        ctx.ellipse(-r * 0.3, -r * 0.9, r * 0.9, r * 0.35, -0.5 + flap, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(-r * 0.3, r * 0.9, r * 0.9, r * 0.35, 0.5 - flap, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.8, r * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'shield': {
        ctx.fillStyle = shade(col, -0.25);
        ctx.beginPath();
        ctx.ellipse(0, 0, r, r * 0.9, 0, 0, Math.PI * 2);
        ctx.fill();
        // 正面甲片
        ctx.fillStyle = shade(col, 0.3);
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.95, -1.0, 1.0);
        ctx.lineTo(0, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }
      case 'worm': {
        ctx.fillStyle = col;
        for (let i = 3; i >= 0; i--) {
          const t = i / 3;
          const wob = Math.sin(this.time * 6 - i * 0.8 + e.wobble) * r * 0.35;
          ctx.beginPath();
          ctx.arc(-t * r * 1.7, wob, r * (0.75 - t * 0.22), 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'charger': {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(r * 1.1, 0);
        ctx.lineTo(-r * 0.5, -r * 0.9);
        ctx.lineTo(-r * 0.9, 0);
        ctx.lineTo(-r * 0.5, r * 0.9);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffe0a0';
        ctx.beginPath();
        ctx.moveTo(r * 1.1, 0);
        ctx.lineTo(r * 0.5, -r * 0.3);
        ctx.lineTo(r * 0.5, r * 0.3);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'brood': {
        const pulse = 1 + Math.sin(this.time * 3 + e.wobble) * 0.07;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * pulse, r * 0.8 * pulse, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,200,230,0.5)';
        for (let i = 0; i < 4; i++) {
          const a = i * 1.6 + this.time * 0.4;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.35, r * 0.2, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'priest': {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.6, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r * 0.6, 0);
        ctx.closePath();
        ctx.fill();
        const glow = 0.5 + Math.sin(this.time * 4) * 0.5;
        ctx.strokeStyle = `rgba(255,255,255,${0.3 + glow * 0.4})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }
      case 'boss':
      case 'siren': {
        const pulse = 1 + Math.sin(this.time * 2) * 0.05;
        ctx.fillStyle = col;
        ctx.beginPath();
        for (let i = 0; i <= 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          const rr = r * (0.85 + Math.sin(a * 5 + this.time * 2) * 0.14) * pulse;
          const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        // 核心眼
        const glow = 0.6 + Math.sin(this.time * 6) * 0.4;
        ctx.fillStyle = `rgba(255,240,120,${glow})`;
        ctx.beginPath();
        ctx.arc(r * 0.3, 0, r * 0.22, 0, Math.PI * 2);
        ctx.fill();
        if (def.shape === 'boss') {
          // 触须收短一点：以前伸到 r*1.5，视觉半径比碰撞半径大一半，
          // 看起来「Boss 模型巨大」，实际判定却没这么大。
          ctx.strokeStyle = col;
          ctx.lineWidth = 3;
          for (let i = 0; i < 3; i++) {
            const a = -0.6 + i * 0.6;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7);
            ctx.lineTo(Math.cos(a) * r * 1.12, Math.sin(a) * r * 1.12);
            ctx.stroke();
          }
        }
        break;
      }
      case 'grub':
      default: {
        ctx.fillStyle = col;
        for (let i = 2; i >= 0; i--) {
          ctx.beginPath();
          ctx.arc(-i * r * 0.5, Math.sin(this.time * 8 - i + e.wobble) * r * 0.16, r * (0.6 - i * 0.1), 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
    }

    // 受击白闪
    if (e.hitFlash > 0) {
      ctx.globalAlpha = e.hitFlash * 0.6;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // 精英光环
    if (e.elite && !friendly) {
      ctx.strokeStyle = `rgba(255,154,76,${0.3 + Math.sin(this.time * 3 + e.wobble) * 0.2})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 光环型怪物
    if (e.def.aura && !friendly) {
      ctx.strokeStyle = 'rgba(255,220,120,0.10)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.arc(0, 0, e.def.aura.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // 蓄力冲撞的预警
    if (e.chargeWindup > 0) {
      ctx.strokeStyle = `rgba(255,80,80,${0.5 + Math.sin(this.time * 20) * 0.3})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawEnemyStatus(ctx, e) {
    const icons = [];
    if (e.burn) icons.push({ c: '#ff7a4c', t: '🔥' });
    if (e.poison) icons.push({ c: '#9fe06a', t: '☣' });
    if (e.slow) icons.push({ c: '#8fe0e8', t: '❄' });
    if (e.marks > 0) icons.push({ c: '#7de0a0', t: '⧫' });
    if (e.stun > 0) icons.push({ c: '#ffba4c', t: '✳' });
    if (!icons.length) return;
    ctx.save();
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    for (let i = 0; i < icons.length; i++) {
      ctx.fillStyle = icons[i].c;
      ctx.fillText(icons[i].t, e.x - (icons.length - 1) * 6 + i * 12, e.y + e.r + 14);
    }
    ctx.restore();
  }

  // =========================================================
  //  投射物 / 掉落 / 特效
  // =========================================================

  drawProjectiles(ctx, run, view) {
    const cache = new Map();
    for (const pr of run.projectiles) {
      if (pr.x < view.x0 - 60 || pr.x > view.x1 + 60) continue;
      if (pr.y < view.y0 - 60 || pr.y > view.y1 + 60) continue;
      const py = pr.y - (pr.z || 0);

      // 尾迹
      if (pr.trail.length > 1) {
        ctx.strokeStyle = pr.color;
        ctx.globalAlpha = 0.28;
        ctx.lineWidth = pr.r * 1.2;
        ctx.beginPath();
        ctx.moveTo(pr.trail[0].x, pr.trail[0].y - (pr.z || 0));
        for (const tp of pr.trail) ctx.lineTo(tp.x, tp.y - (pr.z || 0));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      if (pr.gravity) {
        // 抛物线：画落点指示
        ctx.strokeStyle = `${pr.color}55`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(pr.targetX ?? pr.x, pr.targetY ?? pr.y, 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const grd = cache.get(pr.color) || (() => {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, safeR(pr.r * 2.6, 16));
        g.addColorStop(0, '#fff');
        g.addColorStop(0.35, pr.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        cache.set(pr.color, g);
        return g;
      })();

      ctx.save();
      ctx.translate(pr.x, py);
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(0, 0, pr.r * 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pr.color;
      ctx.beginPath();
      ctx.arc(0, 0, pr.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(-pr.r * 0.25, -pr.r * 0.25, pr.r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 抛物线落地的影子
      if (pr.z) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.ellipse(pr.x, pr.y, pr.r, pr.r * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawPickups(ctx, run, view) {
    for (const pk of run.pickups) {
      if (pk.x < view.x0 - 40 || pk.x > view.x1 + 40) continue;
      if (pk.y < view.y0 - 40 || pk.y > view.y1 + 40) continue;
      const bob = Math.sin(pk.bob) * 3;
      const appear = pk.spawnAnim > 0 ? 1 - pk.spawnAnim * 2 : 1;
      ctx.save();
      ctx.translate(pk.x, pk.y + bob);
      ctx.globalAlpha = clamp01(appear) * 0.85 + 0.15;

      if (pk.kind === 'equip' && pk.item) {
        const def = RARITY_DEF[pk.item.rarity] || RARITY_DEF.common;
        const glow = 0.4 + Math.sin(this.time * 4) * 0.3;
        ctx.fillStyle = `${def.color}33`;
        ctx.beginPath();
        ctx.arc(0, 0, 18 + glow * 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = def.color;
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.lineTo(8, 0);
        ctx.lineTo(0, 9);
        ctx.lineTo(-8, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else if (pk.kind === 'gold') {
        ctx.fillStyle = '#ffba4c';
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#8a5a10';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (pk.kind === 'ammo') {
        // 子弹堆：三颗小弹壳，和材料菱形区分开
        ctx.fillStyle = '#d0c090';
        ctx.strokeStyle = '#7a6a45';
        ctx.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
          const a = -Math.PI / 2 + (i - 1) * 0.5;
          ctx.save();
          ctx.translate(Math.cos(a) * 3.5, Math.sin(a) * 3.5 + 1);
          ctx.beginPath();
          ctx.ellipse(0, 0, 2.6, 4.4, a + Math.PI / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      } else if (pk.kind === 'beaconCore') {
        const glow = 0.5 + Math.sin(this.time * 5) * 0.5;
        ctx.fillStyle = `rgba(255,140,80,${0.3 + glow * 0.4})`;
        ctx.beginPath();
        ctx.arc(0, 0, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ff9a4c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const colors = {
          metal: '#9aa4b0', crystal: '#a97fe8', fiber: '#8fc46a', wood: '#b08050',
          food: '#ff8a5c', spore: '#c58fd8', sulfur: '#e0c14a', fuel: '#ff9a4c',
          water: '#6fc8ff', coolant: '#8fe0e8', chitin: '#c08060', biomass: '#7ac47a',
          dna: '#7de0a0', parts: '#d0c090', tech: '#68d8ff', research: '#b0a0ff',
        };
        ctx.fillStyle = colors[pk.kind] || '#d0c090';
        ctx.beginPath();
        ctx.moveTo(0, -5);
        ctx.lineTo(5, 0);
        ctx.lineTo(0, 5);
        ctx.lineTo(-5, 0);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawPools(ctx, run, view) {
    for (const fx of run.effects) {
      if (fx.kind !== 'pool') continue;
      if (fx.x < view.x0 - 200 || fx.x > view.x1 + 200) continue;
      const alpha = clamp01(fx.life / fx.maxLife) * 0.5;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = fx.color || '#8fc46a';
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, fx.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = alpha * 1.5;
      ctx.strokeStyle = fx.color || '#8fc46a';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, fx.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  drawEffects(ctx, run, view) {
    for (const fx of run.effects) {
      if (fx.kind === 'pool') continue;
      if (fx.x < view.x0 - 200 || fx.x > view.x1 + 200) continue;
      if (fx.y < view.y0 - 200 || fx.y > view.y1 + 200) continue;
      const t = 1 - fx.life / fx.maxLife;
      const alpha = 1 - t;
      ctx.save();
      ctx.globalAlpha = clamp01(alpha);

      switch (fx.kind) {
        case 'swing': {
          ctx.translate(fx.x, fx.y);
          ctx.rotate(fx.angle);
          ctx.strokeStyle = fx.color;
          ctx.lineWidth = 5 * alpha + 2;
          ctx.beginPath();
          ctx.arc(0, 0, fx.range * 0.75, -fx.arc / 2, fx.arc / 2);
          ctx.stroke();
          break;
        }
        case 'cone': {
          ctx.translate(fx.x, fx.y);
          ctx.rotate(fx.angle);
          const g = ctx.createRadialGradient(0, 0, 6, 0, 0, safeR(fx.range, 60));
          g.addColorStop(0, 'rgba(255,220,140,0.75)');
          g.addColorStop(0.5, 'rgba(255,120,60,0.45)');
          g.addColorStop(1, 'rgba(255,80,30,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, fx.range, -fx.arc, fx.arc);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'beam': {
          ctx.strokeStyle = fx.color;
          ctx.lineWidth = (fx.width || 4) * alpha + 1;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(fx.x, fx.y);
          ctx.lineTo(fx.x2, fx.y2);
          ctx.stroke();
          ctx.strokeStyle = '#fff';
          ctx.globalAlpha *= 0.6;
          ctx.lineWidth = (fx.width || 4) * 0.35 * alpha;
          ctx.stroke();
          break;
        }
        case 'nova': {
          const r = fx.r * (0.4 + t * 0.75);
          ctx.strokeStyle = fx.color;
          ctx.lineWidth = 5 * alpha + 1;
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha *= 0.3;
          ctx.fillStyle = fx.color;
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'ring': {
          ctx.strokeStyle = fx.color;
          ctx.lineWidth = 3 * alpha + 1;
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, fx.r * (0.3 + t * 0.8), 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'aura': {
          ctx.strokeStyle = fx.color;
          ctx.lineWidth = 2;
          ctx.globalAlpha *= 0.5;
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, fx.r, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'muzzle': {
          ctx.translate(fx.x, fx.y);
          ctx.rotate(fx.angle || 0);
          ctx.fillStyle = fx.color;
          ctx.beginPath();
          ctx.arc(0, 0, 7 * alpha + 2, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'spark': {
          ctx.fillStyle = fx.color;
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, 5 * alpha + 1, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'claw': {
          ctx.translate(fx.x, fx.y);
          ctx.rotate(fx.angle);
          ctx.strokeStyle = fx.color;
          ctx.lineWidth = 3 * alpha + 1;
          for (let i = -1; i <= 1; i++) {
            ctx.beginPath();
            ctx.moveTo(-14, i * 7);
            ctx.lineTo(10, i * 10);
            ctx.stroke();
          }
          break;
        }
        case 'telegraph': {
          ctx.translate(fx.x, fx.y);
          ctx.rotate(fx.angle);
          ctx.fillStyle = `${fx.color}44`;
          ctx.fillRect(0, -fx.width / 2, fx.len * (1 - t * 0.2), fx.width);
          ctx.strokeStyle = fx.color;
          ctx.lineWidth = 2;
          ctx.strokeRect(0, -fx.width / 2, fx.len, fx.width);
          break;
        }
        case 'drop': {
          ctx.strokeStyle = fx.color;
          ctx.lineWidth = 2;
          ctx.globalAlpha *= 0.5;
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, fx.r + t * 30, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        /* 冲撞尾迹：一连串红色残影 */
        case 'trail': {
          ctx.fillStyle = fx.color;
          ctx.globalAlpha *= 0.35;
          ctx.beginPath();
          ctx.ellipse(fx.x, fx.y, fx.r * (1.2 - t * 0.4), fx.r * (0.9 - t * 0.3), 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        /* 弹幕起手：朝玩家方向的扇形预警 */
        case 'barrageHint': {
          ctx.translate(fx.x, fx.y);
          ctx.rotate(fx.angle);
          ctx.fillStyle = `${fx.color}33`;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, 300, -0.55, 0.55);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = fx.color;
          ctx.globalAlpha *= 0.7;
          ctx.lineWidth = 2;
          ctx.stroke();
          break;
        }
        default: break;
      }
      ctx.restore();
    }
  }

  // =========================================================
  //  建造预览 / 光标 / 光照
  // =========================================================

  drawPlacementPreview(ctx, game) {
    const pv = this.placementPreview;
    if (!pv) return;
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = pv.valid ? '#6ee7a8' : '#ff5f6d';
    ctx.fillStyle = pv.valid ? 'rgba(110,231,168,0.18)' : 'rgba(255,95,109,0.18)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    const r = 22;
    ctx.beginPath();
    ctx.arc(pv.x, pv.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    // 射程预览
    if (pv.range) {
      ctx.strokeStyle = 'rgba(120,210,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pv.x, pv.y, pv.range, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawWorldLabels(ctx, run, view, cam) {
    // 重要目标的方向指示（屏幕外时）交给 UI 层，这里只画近距离标签
  }

  drawLighting(ctx, run, cam) {
    const w = cam.viewW, h = cam.viewH;
    const phase = (run.time % 240) / 240;
    // 0-0.5 白天, 0.5-0.6 黄昏, 0.6-0.95 夜晚, 0.95-1 黎明
    let darkness = 0;
    if (phase < 0.45) darkness = 0;
    else if (phase < 0.58) darkness = (phase - 0.45) / 0.13 * 0.55;
    else if (phase < 0.92) darkness = 0.55;
    else darkness = (1 - (phase - 0.92) / 0.08) * 0.55;

    // 环境减益带来的额外视觉（灰雾）
    const envIndex = run.planetIndex;
    if (darkness <= 0.001 && envIndex === 0) return;

    const p = run.player;
    const ps = cam.worldToScreen(p.x, p.y);
    const vision = 320 + run.playerStats.get('sightBonus') * 1.4;
    const nightVision = run.playerStats.get('nightVision') > 0;

    if (darkness > 0.001) {
      const g = ctx.createRadialGradient(ps.x, ps.y, safeR(vision * 0.35, 60), ps.x, ps.y, safeR(vision * 2.2, 600));
      g.addColorStop(0, `rgba(6,10,26,0)`);
      g.addColorStop(0.5, `rgba(6,10,26,${darkness * 0.72})`);
      g.addColorStop(1, `rgba(4,8,20,${darkness})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      if (nightVision) {
        ctx.fillStyle = 'rgba(90,220,255,0.045)';
        ctx.fillRect(0, 0, w, h);
      }
    }
  }

  drawVignette(ctx, w, h, run) {
    // 基地受攻击时的红色警戒边框
    const base = run.bases.find(b => !b.destroyed && b.underAttack && run.time - b.lastAttackAt < 1.2);
    const ruined = run.bases.some(b => b.destroyed);
    if (!base && !ruined) return;
    const pulse = 0.35 + Math.sin(this.time * 6) * 0.25;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(255,${ruined ? 40 : 60},${ruined ? 60 : 50},${pulse * (ruined ? 0.75 : 0.5)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  drawCrosshair(ctx, game) {
    const m = game.input.mouse;
    if (!m.inside) return;
    const w = game.camera.viewW, h = game.camera.viewH;
    // 只在接管状态下画准星
    if (!game.run?.towerSystem?.manualTower) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,186,76,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 14, 0, Math.PI * 2);
    ctx.moveTo(m.x - 20, m.y);
    ctx.lineTo(m.x - 6, m.y);
    ctx.moveTo(m.x + 6, m.y);
    ctx.lineTo(m.x + 20, m.y);
    ctx.moveTo(m.x, m.y - 20);
    ctx.lineTo(m.x, m.y - 6);
    ctx.moveTo(m.x, m.y + 6);
    ctx.lineTo(m.x, m.y + 20);
    ctx.stroke();
    ctx.restore();
  }

  drawDebug(ctx, game) {
    const cam = game.camera;
    const run = game.run;
    ctx.save();
    ctx.font = '11px monospace';
    ctx.fillStyle = '#0f0';
    const lines = [
      `FPS ${game.fps.toFixed(0)}  chunks ${this.frameStats.chunks}`,
      `enemies ${run.enemies.length}  proj ${run.projectiles.length}  pickups ${run.pickups.length}`,
      `props ${run.world.props.size}  chunks ${run.world.chunks.size}`,
      `cam ${cam.x.toFixed(0)},${cam.y.toFixed(0)} zoom ${cam.zoom.toFixed(2)}`,
      `wave ${run.wave.state} ${run.wave.timer.toFixed(0)}  nests ${run.world.nests.filter(n => !n.destroyed).length}`,
    ];
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], 12, 120 + i * 14);

    // 流场可视化
    if (this.showFlow) {
      const flow = run.world.flow;
      const view = cam.viewRect(0);
      const t0 = Math.floor(view.x0 / TILE), t1 = Math.ceil(view.x1 / TILE);
      const r0 = Math.floor(view.y0 / TILE), r1 = Math.ceil(view.y1 / TILE);
      ctx.strokeStyle = 'rgba(0,255,180,0.35)';
      ctx.lineWidth = 1;
      for (let ty = r0; ty <= r1; ty += 2) {
        for (let tx = t0; tx <= t1; tx += 2) {
          if (tx < 0 || ty < 0 || tx >= flow.w || ty >= flow.h) continue;
          const s = flow.sample(tx * TILE + TILE / 2, ty * TILE + TILE / 2);
          if (!s.ok || (!s.x && !s.y)) continue;
          const px = tx * TILE + TILE / 2, py = ty * TILE + TILE / 2;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + s.x * 14, py + s.y * 14);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // =========================================================
  //  通用绘制工具
  // =========================================================

  drawHealthBar(ctx, cx, y, width, frac, shieldFrac = 0, color = '#6ee7a8', label = '', big = false, huge = false) {
    const h = huge ? 9 : big ? 6 : 4;
    const x = cx - width / 2;
    ctx.save();
    // 底
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.beginPath();
    ctx.roundRect(x - 1, y - 1, width + 2, h + 2, 3);
    ctx.fill();
    // 血
    const f = clamp01(frac);
    if (f > 0) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y, width * f, h, 2);
      ctx.fill();
      // 高光
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x, y, width * f, 1);
    }
    // 护盾
    if (shieldFrac > 0) {
      const sf = clamp01(shieldFrac);
      ctx.fillStyle = 'rgba(140,200,255,0.85)';
      ctx.fillRect(x, y - 3, width * sf, 2);
    }
    // 标签
    if (label) {
      ctx.font = `${big ? 'bold 12px' : '11px'} system-ui`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(label, cx + 1, y - 5);
      ctx.fillStyle = '#e8f0ff';
      ctx.fillText(label, cx, y - 6);
    }
    ctx.restore();
  }
}

// ---------------- 颜色与数值工具 ----------------

/**
 * 给 canvas API 用的安全数值：非有限值直接退回 fallback。
 * 浏览器对 createRadialGradient 的非有限参数是抛异常的，
 * 一旦抛出就会打断整帧渲染 —— 宁可画小一点也不能崩。
 */
export function safeR(v, fallback = 60) {
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * 把字符串 id 折成一个稳定的 0..1 种子。
 * 巢穴外形用它做随机：同一个巢每次进游戏长得一样，
 * 但不同的巢各不相同（用 Math.random 会导致洞口每帧都在变形）。
 */
export function hashSeed(str) {
  let h = 2166136261;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
}

/** 把 #rrggbb 按 amount(-1..1) 变亮/变暗 */
export function shade(hex, amount) {
  if (!hex || hex[0] !== '#') return hex || '#888';
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const num = parseInt(h, 16);
  let r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
  if (amount > 0) {
    r = Math.round(r + (255 - r) * amount);
    g = Math.round(g + (255 - g) * amount);
    b = Math.round(b + (255 - b) * amount);
  } else {
    const k = 1 + amount;
    r = Math.round(r * k); g = Math.round(g * k); b = Math.round(b * k);
  }
  return `rgb(${r},${g},${b})`;
}
