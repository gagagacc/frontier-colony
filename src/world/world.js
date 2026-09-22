/**
 * 世界：地形生成 + 兴趣点 + 巢穴 + 可采集物 + 地块改写。
 *
 * 生成策略：
 *  - 用固定种子生成高程/湿度/温度/晶簇/焦痕五层噪声，确定地块与生物群系。
 *  - 全图裁成一座大岛（径向衰减），边缘是虚空，避免玩家跑出地图。
 *  - 保证一整块「主连通可行走区」，不可达的碎片直接填成岩石，省得玩家卡住。
 *  - 障碍物/可采集物按区块惰性生成（同一区块永远生成同样的东西，可复现）。
 */

import { TILE, CHUNK, WORLD_TILES, WORLD_PX, MAP_SCALE, FLOW_CELL } from '../core/config.js';
import { RNG } from '../core/rng.js';
import { ValueNoise, CellNoise } from '../core/noise.js';
import { clamp, clamp01, swapRemove, dist } from '../core/math.js';
import { T, BIOME, BIOME_DEF, TILE_DEF, PROP, PROP_DEF, isSolidTile } from '../data/tiles.js';
import { FlowField } from './pathfind.js';

const AREA = WORLD_TILES * WORLD_TILES;

/** 世界的自增序号：渲染层靠它区分「这是哪一张地图」（见 World.uid 的注释） */
let WORLD_SEQ = 0;

export class World {
  /**
   * @param {string} seed 世界种子
   * @param {object} opts { planetIndex, nestCount, name, mode, nestScale, poiScale }
   */
  constructor(seed = 'frontier', opts = {}) {
    /*
     * 每个 World 一个自增 id。
     *
     * 渲染层的区块缓存以前只用「区块坐标」当键 —— 进虫巢副本时副本是**另一个
     * World 对象**，但坐标完全一样、`tileRevision` 又都是 0，
     * 于是缓存判定为「没变」，把地表的区块图直接画在巢道里 ——
     * 玩家看到的就是「虫巢里的地图还是地面风格」。现在缓存键里带上 uid，
     * 两个世界各自缓存互不干扰（出副本回地表也是瞬间的，不用重建）。
     */
    this.uid = ++WORLD_SEQ;
    this.seed = String(seed);
    this.planetIndex = opts.planetIndex ?? 0;
    this.planetName = opts.name || '开普勒-442b';
    this.mode = opts.mode || 'frontier';
    this.nestScale = opts.nestScale ?? 1;
    this.poiScale = opts.poiScale ?? 1;
    this.compact = !!opts.compact;
    this.rng = new RNG(this.seed + ':world');

    this.w = WORLD_TILES;
    this.h = WORLD_TILES;
    this.tiles = new Uint8Array(AREA);
    this.biomes = new Uint8Array(AREA);
    this.variant = new Uint8Array(AREA);   // 视觉微变化，避免地面完全一样

    this.blocked = new Uint8Array(AREA);   // 动态占位（建筑/塔基座）

    // 活跃对象
    this.props = new Map();                // id -> prop
    this.chunks = new Map();               // "cx,cy" -> { props: [ids], spawned }
    this.harvested = new Map();            // id -> 重生剩余秒数 / -1 永久
    this.modifiedTiles = new Map();        // idx -> { t, b }

    this.pois = [];                        // 兴趣点
    this.nests = [];                       // 巢穴
    this.baseSite = null;
    this.landingSites = [];

    this.flow = new FlowField(WORLD_TILES, WORLD_TILES, FLOW_CELL);
    this._propSeq = 1;
    this._spawnQueue = [];
    this.time = 0;

    this.generate();
  }

  // =========================================================
  //  生成
  // =========================================================

  generate() {
    const rng = this.rng;
    const nElev = new ValueNoise(this.seed + ':elev');
    const nRidge = new ValueNoise(this.seed + ':ridge');
    const nMoist = new ValueNoise(this.seed + ':moist');
    const nTemp = new ValueNoise(this.seed + ':temp');
    const nCryst = new ValueNoise(this.seed + ':cryst');
    const nDetail = new ValueNoise(this.seed + ':detail');
    const nScar = new CellNoise(this.seed + ':scarfield', 26);

    const P = this.planetIndex;
    // 星球越往后：地形越极端（温差更大、水体更少、可开采更多）
    const tempBias = clamp(P * 0.09, 0, 0.4);
    const moistBias = -clamp(P * 0.05, 0, 0.25);
    const crystalBias = clamp(P * 0.05, 0, 0.28);

    const cx = this.w / 2, cy = this.h / 2;
    const maxR = this.w * 0.52;

    const scale = 0.021;

    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const idx = y * this.w + x;

        // 径向衰减 -> 岛形
        const dx = (x - cx) / maxR, dy = (y - cy) / maxR;
        const radial = Math.sqrt(dx * dx + dy * dy);
        const falloff = clamp01(1 - Math.pow(radial, 2.6));

        const e = nElev.fbm(x * scale, y * scale, 5) * 0.72 + 0.28 * (1 - radial);
        const elev = clamp01(e * 0.72 + falloff * 0.34);
        const ridge = nRidge.ridged(x * scale * 1.7 + 40, y * scale * 1.7 - 25, 4);
        const moist = clamp01(nMoist.warped(x * scale * 1.25 + 3, y * scale * 1.25 - 7, 0.5, 4) + moistBias);
        const temp = clamp01(nTemp.fbm(x * scale * 0.9 - 11, y * scale * 0.9 + 19, 3) + tempBias);
        const cryst = nCryst.fbm(x * scale * 2.2 + 61, y * scale * 2.2 + 7, 2) + crystalBias;

        let t;
        if (elev < 0.245) t = T.VOID;
        else if (elev < 0.30) t = T.WATER;
        else if (elev < 0.335) t = T.SHALLOW;
        else if (elev > 0.815 || (ridge > 0.80 && elev > 0.70)) t = T.MOUNTAIN;
        else if (ridge > 0.665 && elev > 0.585) t = T.ROCK;
        else {
          // 生物群系判定：温度 + 湿度 + 晶簇
          let b;
          if (cryst > 1.02) b = BIOME.CRYSTALFIELD;
          else if (temp < 0.315) b = BIOME.GLACIER;
          else if (temp > 0.70 && moist < 0.42) b = (ridge > 0.55 ? BIOME.ASHLANDS : BIOME.DUNES);
          else if (moist > 0.655) b = BIOME.SPOREFEN;
          else if (moist > 0.50) b = BIOME.VERDANT;
          else if (ridge > 0.58 || elev > 0.66) b = BIOME.HIGHLAND;
          else b = BIOME.BASIN;

          const def = BIOME_DEF[b];
          const g = def.ground;
          const pick = nDetail.at(x * 0.11 + 5, y * 0.11 - 3);
          t = g[Math.min(g.length - 1, Math.floor(pick * g.length))];
          this.biomes[idx] = b;
        }

        this.tiles[idx] = t;
        this.variant[idx] = Math.floor(nDetail.at(x * 0.37, y * 0.37) * 255);
      }
    }

    this._classifyBiomes();
    this._floodFillMainRegion();
    this._placeLandingSites();
    this._placeNests(nScar, rng);
    this._placeMajorPois(rng);
    this._carveStarterZone(rng);
    this._applyScars();
  }

  /** 把非地面地块也归入邻近生物群系，方便渲染与逻辑查询 */
  _classifyBiomes() {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const idx = y * this.w + x;
        if (this.biomes[idx]) continue;
        let found = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
          const b = this.biomes[ny * this.w + nx];
          if (b) { found = b; break; }
        }
        this.biomes[idx] = found || BIOME.HIGHLAND;
      }
    }
  }

  /**
   * 洪水填充找最大连通区，把零散小岛填成岩石。
   * 这一步很重要：否则玩家会看到一堆永远走不到的小陆地。
   */
  _floodFillMainRegion() {
    const { w, h, tiles } = this;
    const label = new Int32Array(AREA).fill(-1);
    const sizes = [];
    const queue = new Int32Array(AREA);
    let region = 0;

    for (let i = 0; i < AREA; i++) {
      if (label[i] !== -1 || isSolidTile(tiles[i])) continue;
      let head = 0, tail = 0;
      queue[tail++] = i;
      label[i] = region;
      let count = 0;
      while (head < tail) {
        const cur = queue[head++];
        count++;
        const x = cur % w, y = (cur - x) / w;
        for (let n = 0; n < 4; n++) {
          const nx = x + (n === 0 ? 1 : n === 1 ? -1 : 0);
          const ny = y + (n === 2 ? 1 : n === 3 ? -1 : 0);
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (label[ni] !== -1 || isSolidTile(tiles[ni])) continue;
          label[ni] = region;
          queue[tail++] = ni;
        }
      }
      sizes.push(count);
      region++;
    }

    if (!sizes.length) return;
    let best = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;

    for (let i = 0; i < AREA; i++) {
      if (label[i] !== -1 && label[i] !== best) {
        // 不可达的碎片一律填成裸岩 —— 视觉上是露出海面的礁石，
        // 也彻底断了玩家/怪物误入死路的可能。
        this.tiles[i] = T.ROCK;
      }
    }
    this.mainRegion = best;
  }

  // =========================================================
  //  兴趣点 / 降落点 / 巢穴
  // =========================================================

  /**
   * 生成 4 个候选降落点，并做成明确的【三级难度】：
   *   一级（最简单）：附近没有巢穴，地形也最温和 —— 保底一定有一个
   *   二级：远处有巢穴，安全但资源一般
   *   三级：巢穴就在附近，资源最好但要立刻面对压力
   *
   * 排序依据是「危险度」，一级永远排第一（也是默认选中的那个），
   * 这样新玩家永远有一个稳的开局选择。
   */
  _placeLandingSites() {
    const candidates = [];
    const rng = new RNG(this.seed + ':landing');
    const cx = this.w / 2, cy = this.h / 2;

    // 纯塔防模式只有一片阵地：直接给地图中心一块干净地方，不做三级选择
    if (this.mode === 'towerDefense') {
      const tx = Math.floor(cx), ty = Math.floor(cy);
      const px = tx * TILE + TILE / 2, py = ty * TILE + TILE / 2;
      const b = this.biomes[ty * this.w + tx];
      const def = BIOME_DEF[b] || BIOME_DEF[0];
      this.landingSites = [{
        tx, ty, x: px, y: py,
        biome: b, biomeName: def.name,
        hazard: def.hazard, richness: def.richness,
        variety: this._biomeVarietyAround(tx, ty),
        openSpace: this._openRatioAround(tx, ty),
        nestNear: 0, nestFar: 0, danger: 0,
        tier: 1,
        tierName: LANDING_TIER[1].name,
        tierDesc: '纯塔防阵地：所有怪潮都冲着这里来。',
        tierColor: LANDING_TIER[1].color,
      }];
      return;
    }

    for (let attempt = 0; attempt < 1200 && candidates.length < 48; attempt++) {
      const a = rng.next() * Math.PI * 2;
      const r = rng.range(0.12, 0.62);
      const tx = Math.floor(cx + Math.cos(a) * r * this.w);
      const ty = Math.floor(cy + Math.sin(a) * r * this.h);
      if (tx < 8 || ty < 8 || tx >= this.w - 8 || ty >= this.h - 8) continue;

      // 需要一个 7x7 的干净空地
      if (!this._isClearBox(tx, ty, 3)) continue;
      if (this._nestCountNear(tx * TILE, ty * TILE, 0) > 0) continue;

      const b = this.biomes[ty * this.w + tx];
      const def = BIOME_DEF[b];
      const px = tx * TILE + TILE / 2;
      const py = ty * TILE + TILE / 2;

      // 危险度：近处巢穴权重最高，其次地形危险度，远处巢穴只算一点
      const near = this._nestThreatNear(px, py, TILE * 38);
      const far = this._nestThreatNear(px, py, TILE * 75) - near;
      const danger = near * 1.0 + far * 0.25 + def.hazard * 0.6;

      candidates.push({
        tx, ty, x: px, y: py,
        biome: b, biomeName: def.name,
        hazard: def.hazard,
        richness: def.richness,
        variety: this._biomeVarietyAround(tx, ty),
        openSpace: this._openRatioAround(tx, ty),
        nestNear: this._nestCountNear(px, py, TILE * 38),
        nestFar: this._nestCountNear(px, py, TILE * 75) - this._nestCountNear(px, py, TILE * 38),
        danger,
      });
    }

    if (!candidates.length) { this.landingSites = []; return; }

    // 危险度从低到高排，再挑 4 个彼此拉开的，保证选择真的不同
    candidates.sort((a, b) => a.danger - b.danger);
    const picked = [];
    for (const c of candidates) {
      if (picked.length >= 4) break;
      let ok = true;
      for (const p of picked) {
        if (dist(c.x, c.y, p.x, p.y) < WORLD_PX * 0.22) { ok = false; break; }
      }
      if (ok) picked.push(c);
    }
    while (picked.length < 4 && candidates.length) {
      const c = candidates.shift();
      if (!picked.includes(c)) picked.push(c);
    }

    // 强制分成三级：危险度最低的那个必定是一级
    picked.sort((a, b) => a.danger - b.danger);
    picked.forEach((c, i) => {
      c.tier = i === 0 ? 1 : i === 1 ? 2 : 3;
      c.tierName = LANDING_TIER[c.tier].name;
      c.tierDesc = LANDING_TIER[c.tier].desc;
      c.tierColor = LANDING_TIER[c.tier].color;
    });

    this.landingSites = picked;
  }

  /**
   * 评估玩家在地图上**自由点选**的降落地。
   *
   * 以前只能从 4 个系统选好的点里挑一个；玩家要求「初始降落点改为可以在
   * 地图上自由选择」。约束还是要有（总不能让核心舱落进湖里），
   * 所以这里返回 { ok, why, site }，UI 直接把 why 显示出来。
   */
  evaluateLandingSite(tx0, ty0) {
    const tx = Math.round(tx0), ty = Math.round(ty0);
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return { ok: false, why: '无效的位置' };
    if (tx < 8 || ty < 8 || tx >= this.w - 8 || ty >= this.h - 8) {
      return { ok: false, why: '太靠近世界边界了' };
    }
    if (!this._isClearBox(tx, ty, 3)) {
      return { ok: false, why: '这里放不下核心舱（水域 / 岩壁 / 障碍物挡着）' };
    }
    const px = tx * TILE + TILE / 2, py = ty * TILE + TILE / 2;
    const onNest = this.nests.some(n => !n.destroyed && dist(n.x, n.y, px, py) < TILE * 10);
    if (onNest) return { ok: false, why: '落点压在虫巢上 —— 换个地方' };

    const b = this.biomes[ty * this.w + tx];
    const def = BIOME_DEF[b] || BIOME_DEF[0];
    const near = this._nestThreatNear(px, py, TILE * 38);
    const far = this._nestThreatNear(px, py, TILE * 75) - near;
    return {
      ok: true,
      site: {
        tx, ty, x: px, y: py,
        biome: b, biomeName: def.name,
        hazard: def.hazard,
        richness: def.richness,
        variety: this._biomeVarietyAround(tx, ty),
        openSpace: this._openRatioAround(tx, ty),
        nestNear: this._nestCountNear(px, py, TILE * 38),
        nestFar: this._nestCountNear(px, py, TILE * 75) - this._nestCountNear(px, py, TILE * 38),
        danger: near * 1.0 + far * 0.25 + def.hazard * 0.6,
        custom: true,
      },
    };
  }

  /** 某点周围巢穴的「威胁权重」总和（等级越高越危险） */
  _nestThreatNear(x, y, radius) {
    let sum = 0;
    for (const nest of this.nests) {
      if (nest.destroyed) continue;
      if (dist(x, y, nest.x, nest.y) <= radius) sum += nest.threat;
    }
    return sum;
  }

  _isClearBox(tx, ty, rad) {
    for (let y = ty - rad; y <= ty + rad; y++) {
      for (let x = tx - rad; x <= tx + rad; x++) {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
        if (isSolidTile(this.tiles[y * this.w + x])) return false;
      }
    }
    return true;
  }

  _openRatioAround(tx, ty) {
    let open = 0, total = 0;
    const R = 14;
    for (let y = ty - R; y <= ty + R; y += 2) {
      for (let x = tx - R; x <= tx + R; x += 2) {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        total++;
        if (!isSolidTile(this.tiles[y * this.w + x])) open++;
      }
    }
    return total ? open / total : 0;
  }

  _biomeVarietyAround(tx, ty) {
    const set = new Set();
    const R = 16;
    for (let y = ty - R; y <= ty + R; y += 3) {
      for (let x = tx - R; x <= tx + R; x += 3) {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        set.add(this.biomes[y * this.w + x]);
      }
    }
    return clamp01((set.size - 1) / 4);
  }

  /** 巢穴：目标区域内的蓝噪声采样，彼此至少隔开 */
  _placeNests(scarField, rng) {
    const P = this.planetIndex;
    // 纯塔防模式没有虫巢：怪潮由波次系统从阵地外生成
    if (this.mode === 'towerDefense') { this.nests.length = 0; return; }
    // 数量按地图面积缩放：地图大了而巢穴不变的话，扩大地图就只是多了空地
    const target = Math.round((11 + P * 4 + rng.int(0, 3)) * MAP_SCALE * (this.nestScale ?? 1));
    const minGap = TILE * (P === 0 ? 21 : 18);
    const placed = [];
    let guard = 0;

    while (placed.length < target && guard < 20000) {
      guard++;
      const x = rng.range(TILE * 6, WORLD_PX - TILE * 6);
      const y = rng.range(TILE * 6, WORLD_PX - TILE * 6);
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (isSolidTile(this.tiles[ty * this.w + tx])) continue;
      if (!this._isClearBox(tx, ty, 2)) continue;

      let tooClose = false;
      for (const p of placed) if (dist(x, y, p.x, p.y) < minGap) { tooClose = true; break; }
      if (tooClose) continue;

      const b = this.biomes[ty * this.w + tx];
      const def = BIOME_DEF[b];
      // 巢穴偏好高危险度区域：拒绝采样
      if (rng.next() > clamp01(def.nestChance / 2.2)) continue;

      placed.push({ x, y, tx, ty, biome: b, hazard: def.hazard });
    }

    // 转为正式巢穴对象
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i];
      const tier = this._nestTierFor(p);
      const hp = Math.round((900 + tier * 420) * (1 + P * 0.45));
      this.nests.push({
        id: 'nest_' + i,
        x: p.x, y: p.y, r: 44,
        tier,
        hp, maxHp: hp,
        biome: p.biome,
        destroyed: false,
        spawnTimer: rng.range(4, 26),
        spawnRate: 0.85 + tier * 0.30 + P * 0.16,   // 每分钟产怪基数
        threat: 1 + tier * 0.55 + P * 0.28,
        guardCount: 4 + tier * 3,                  // 常驻守卫上限的基数
        bossSpawned: false,                        // 每个巢穴固定一只 Boss，只生成一次
        discovered: false,
        /** 巢穴副本是否已经打过（毁掉的巢穴不可再进入） */
        dungeonCleared: false,
        name: NEST_NAMES[i % NEST_NAMES.length] + '-' + String(i + 1).padStart(2, '0'),
      });
    }
  }

  /**
   * 巢穴等级 1~10。
   *
   * 为什么从 4 档扩到 10 档：4 档的时候「远处的高等级巢穴」几十分钟就摸到顶了，
   * 之后整张地图的巢穴在玩家眼里没有区别。10 档把「越远越危险、越危险越值钱」
   * 这条曲线拉长，也让巢穴副本（Boss 强度按等级走）有了 10 级台阶。
   */
  _nestTierFor(p) {
    const d = dist(p.x, p.y, WORLD_PX / 2, WORLD_PX / 2) / (WORLD_PX / 2);
    const score = d * 0.72 + (p.hazard - 0.6) * 0.38;
    // 0.30 -> 1 级 ... 0.95 -> 10 级
    return clamp(Math.round(1 + (score - 0.30) / 0.075), 1, 10);
  }

  _nestCountNear(x, y, radius) {
    let n = 0;
    for (const nest of this.nests) {
      if (nest.destroyed) continue;
      if (radius <= 0 || dist(x, y, nest.x, nest.y) <= radius) n++;
    }
    return n;
  }

  /** 废弃基地 / 坠毁旗舰 / 数据方尖碑 等大地标 */
  _placeMajorPois(rng) {
    const P = this.planetIndex;
    // 纯塔防模式没有探索，也就不需要这些地标
    if (this.mode === 'towerDefense') { this.pois.length = 0; return; }
    // 遗迹与地标同样按面积缩放 —— 探索收益全靠它们撑
    const ruins = Math.round((4 + rng.int(0, 3) + P) * MAP_SCALE * (this.poiScale ?? 1));
    const minGap = TILE * 15;

    const tryPlace = (kind, count, minDistFromNest, extra = {}) => {
      let placedN = 0, guard = 0;
      while (placedN < count && guard < 12000) {
        guard++;
        const x = rng.range(TILE * 8, WORLD_PX - TILE * 8);
        const y = rng.range(TILE * 8, WORLD_PX - TILE * 8);
        const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
        if (!this._isClearBox(tx, ty, 3)) continue;
        if (this._nestCountNear(x, y, minDistFromNest) > 0) continue;
        let clash = false;
        for (const p of this.pois) if (dist(x, y, p.x, p.y) < minGap) { clash = true; break; }
        if (clash) continue;

        const poi = {
          id: 'poi_' + this.pois.length,
          kind, x, y, tx, ty,
          r: extra.r || 60,
          discovered: false,
          looted: false,
          biome: this.biomes[ty * this.w + tx],
          ...extra,
        };
        // 废弃基地自带一台可回收的吸引阵列
        if (kind === 'ruin') {
          poi.beaconSalvage = true;
          poi.beaconTaken = false;
          poi.name = RUIN_NAMES[this.pois.filter(p => p.kind === 'ruin').length % RUIN_NAMES.length];
          poi.pop = rng.int(0, 2);
        } else if (kind === 'obelisk') {
          poi.name = '数据方尖碑';
        } else if (kind === 'crash') {
          poi.name = '坠毁旗舰';
        } else if (kind === 'vault') {
          poi.name = '实验 vault';
        }
        this.pois.push(poi);
        placedN++;
      }
    };

    tryPlace('ruin', ruins, TILE * 18, { r: 96 });
    tryPlace('crash', 1 + (P > 0 ? 1 : 0) + Math.round(MAP_SCALE - 1), TILE * 14, { r: 120 });
    tryPlace('obelisk', Math.round((2 + rng.int(0, 2)) * MAP_SCALE), TILE * 12, { r: 40 });
    tryPlace('vault', Math.round(Math.max(1, 3 - P) * MAP_SCALE), TILE * 26, { r: 70 });
  }

  /**
   * 玩家实际落地区域：铺混凝土地面、清空障碍、保证 40x40 格安全区。
   * 同时把这里记成 baseSite。
   */
  _carveStarterZone(rng) {
    const site = this.landingSites[0];
    if (!site) return;
    this.baseSite = { x: site.x, y: site.y, tx: site.tx, ty: site.ty, radius: 0 };
    this.prepareBaseArea(site.tx, site.ty);
    // 纯塔防：整片阵地都要是干净可建的地面。
    // 要求是「只有一片地」——那就得真的把这片地整平，不能只平基地周围那一圈：
    // 阵地里若留着山体/湖泊，玩家会遇到「这里为什么不能建塔」的哑谜。
    if (this.mode === 'towerDefense') this.carveArena(site.tx, site.ty);
  }

  /**
   * 把以 (tx,ty) 为中心、半径 R 格的一整片区域整平成可建造地面。
   * 用于纯塔防的阵地：混凝土内圈 + 风化土外圈，全部可通行。
   */
  carveArena(tx, ty, R = 24) {
    for (let y = ty - R; y <= ty + R; y++) {
      for (let x = tx - R; x <= tx + R; x++) {
        if (x < 2 || y < 2 || x >= this.w - 2 || y >= this.h - 2) continue;
        const d = Math.hypot(x - tx, y - ty);
        if (d > R) continue;
        const idx = y * this.w + x;
        // 内圈混凝土（基地广场），中圈风化土（可建造），外圈保持原来的地表质感
        if (d <= 7) { this.tiles[idx] = T.CONCRETE; this.biomes[idx] = BIOME.BASIN; }
        else if (d <= 11) { this.tiles[idx] = T.REGOLITH; this.biomes[idx] = BIOME.BASIN; }
        else if (isSolidTile(this.tiles[idx])) this.tiles[idx] = T.REGOLITH;
        this._clearPropsInChunkAt(x, y);
      }
    }
  }

  /** 把 (tx,ty) 周围铺成基地：主基地与第二基地共用 */
  prepareBaseArea(tx, ty) {
    const R = 13;   // 13 格半径 ≈ 520 像素
    for (let y = ty - R; y <= ty + R; y++) {
      for (let x = tx - R; x <= tx + R; x++) {
        if (x < 1 || y < 1 || x >= this.w - 1 || y >= this.h - 1) continue;
        const d = Math.hypot(x - tx, y - ty);
        if (d > R) continue;
        const idx = y * this.w + x;
        /*
         * 内圈的实心地形要**铲掉**，不能跳过。
         *
         * 以前的写法是「实心就 continue」，结果落点如果刚好在山地边上，
         * 阵地里会留下几块搬不走的岩石/高山 —— 塔建不上去、怪也绕着走，
         * 而且玩家完全看不懂为什么这块地不能用。
         * 现在：内圈（d <= 8）一律铲平；外圈保留地形纹理，只是不长障碍物。
         */
        if (d <= 8) {
          this.tiles[idx] = d <= 6.5 ? T.CONCRETE : T.REGOLITH;
          this.biomes[idx] = BIOME.BASIN;
        } else if (isSolidTile(this.tiles[idx])) {
          continue;
        } else if (d <= 9 && this.tiles[idx] !== T.CONCRETE) {
          this.tiles[idx] = T.REGOLITH;
        }
        // 清掉这个区块的障碍物计划
        this._clearPropsInChunkAt(x, y);
      }
    }
    return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
  }

  /** 巢穴周边焦土化 + 记录影响范围 */
  _applyScars() {
    for (const nest of this.nests) {
      const tr = nest.tier * 3 + 6;
      const tx = Math.floor(nest.x / TILE), ty = Math.floor(nest.y / TILE);
      for (let y = ty - tr; y <= ty + tr; y++) {
        for (let x = tx - tr; x <= tx + tr; x++) {
          if (x < 1 || y < 1 || x >= this.w - 1 || y >= this.h - 1) continue;
          const d = Math.hypot(x - tx, y - ty);
          if (d > tr) continue;
          const idx = y * this.w + x;
          if (isSolidTile(this.tiles[idx])) continue;
          const p = 1 - d / tr;
          const r = new RNG(this.seed + ':scar:' + idx).next();
          if (r < p * 0.85) {
            this.tiles[idx] = T.SCORCHED;
            this.biomes[idx] = BIOME.SCAR;
          } else if (r < p * 0.95) {
            this.tiles[idx] = T.ASH;
            this.biomes[idx] = BIOME.ASHLANDS;
          }
        }
      }
      nest.scarRadius = tr * TILE;
    }
  }

  // =========================================================
  //  查询 API
  // =========================================================

  tileAtPx(wx, wy) {
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return T.VOID;
    return this.tiles[ty * this.w + tx];
  }

  tileAt(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return T.VOID;
    return this.tiles[ty * this.w + tx];
  }

  biomeAtPx(wx, wy) {
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return BIOME.HIGHLAND;
    return this.biomes[ty * this.w + tx];
  }

  speedAtPx(wx, wy) {
    const def = TILE_DEF[this.tileAtPx(wx, wy)];
    return def ? (def.speed ?? 1) : 1;
  }

  /** 圆形是否撞到不可通行地形 */
  circleBlocked(wx, wy, r) {
    if (this.isBlockedPx(wx, wy)) return true;
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      if (this.isBlockedPx(wx + Math.cos(a) * r, wy + Math.sin(a) * r)) return true;
    }
    return false;
  }

  isBlockedPx(wx, wy) {
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return true;
    const idx = ty * this.w + tx;
    return isSolidTile(this.tiles[idx]) || !!this.blocked[idx];
  }

  /** 沿直线是否有阻挡（子弹/视线） */
  lineBlocked(x0, y0, x1, y1) {
    const steps = Math.ceil(dist(x0, y0, x1, y1) / (TILE * 0.5));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.isBlockedPx(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return true;
    }
    return false;
  }

  /** 在世界里找一个离 (x,y) 最近的空地中心 */
  findOpenSpot(x, y, r = 60, maxTries = 40) {
    if (!this.circleBlocked(x, y, 12)) return { x, y };
    for (let i = 1; i <= maxTries; i++) {
      const a = i * 2.399963;             // 黄金角，均匀铺开
      const rad = r * Math.sqrt(i / maxTries);
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (!this.circleBlocked(px, py, 12)) return { x: px, y: py };
    }
    return { x, y };
  }

  // =========================================================
  //  地块改写
  // =========================================================

  setTile(tx, ty, type) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    const idx = ty * this.w + tx;
    if (this.tiles[idx] === type) return false;
    this.tiles[idx] = type;
    this.modifiedTiles.set(idx, { t: type, b: this.biomes[idx] });
    this._invalidateChunkAt(tx, ty);
    return true;
  }

  setBiome(tx, ty, biome) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    const idx = ty * this.w + tx;
    if (this.biomes[idx] === biome) return false;
    this.biomes[idx] = biome;
    this.modifiedTiles.set(idx, { t: this.tiles[idx], b: biome });
    return true;
  }

  setBlocked(tx, ty, on) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return;
    this.blocked[ty * this.w + tx] = on ? 1 : 0;
  }

  /** 在 (wx,wy) 周围铺一圈路 */
  paveCircle(wx, wy, radiusTiles, tileType = T.ROAD) {
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    let n = 0;
    for (let y = ty - radiusTiles; y <= ty + radiusTiles; y++) {
      for (let x = tx - radiusTiles; x <= tx + radiusTiles; x++) {
        if (Math.hypot(x - tx, y - ty) > radiusTiles) continue;
        if (this.tileAt(x, y) === T.VOID || this.tileAt(x, y) === T.WATER) continue;
        if (this.setTile(x, y, tileType)) n++;
      }
    }
    return n;
  }

  // =========================================================
  //  障碍物 / 可采集物
  // =========================================================

  chunkKey(cx, cy) { return cx + ',' + cy; }

  _invalidateChunkAt(tx, ty) {
    // 地形缓存由渲染层按「地块版本号」失效，这里只需要让世界知道有人改过图
    this.tileRevision = (this.tileRevision || 0) + 1;
  }

  /**
   * 清掉某一格上已生成的障碍物，并标记该格所在的「投放点」不再长东西。
   *
   * 注意：suppressed 只用来跳过这一个投放点，绝不能让整个区块永久不再生成 ——
   * 一个 16x16 的区块有 64 个投放点，基地只会占掉其中少数几个。
   */
  _clearPropsInChunkAt(tx, ty) {
    const edge = this._suppress || (this._suppress = new Set());
    edge.add(tx + ',' + ty);
    const key = this.chunkKey(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    for (const id of Array.from(chunk.props)) {
      const prop = this.props.get(id);
      if (!prop) { swapRemove(chunk.props, chunk.props.indexOf(id)); continue; }
      if (Math.floor(prop.x / TILE) === tx && Math.floor(prop.y / TILE) === ty) this.removeProp(id);
    }
  }

  /** 保证活跃对象所在的区块都已生成 */
  ensureChunksAround(x, y, radiusPx) {
    const maxCx = Math.ceil(this.w / CHUNK) - 1;
    const maxCy = Math.ceil(this.h / CHUNK) - 1;
    const c0 = clamp(Math.floor((x - radiusPx) / (CHUNK * TILE)), 0, maxCx);
    const c1 = clamp(Math.floor((x + radiusPx) / (CHUNK * TILE)), 0, maxCx);
    const r0 = clamp(Math.floor((y - radiusPx) / (CHUNK * TILE)), 0, maxCy);
    const r1 = clamp(Math.floor((y + radiusPx) / (CHUNK * TILE)), 0, maxCy);
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const key = this.chunkKey(cx, cy);
        if (this.chunks.has(key)) continue;
        this._spawnChunk(cx, cy);
      }
    }
  }

  _spawnChunk(cx, cy) {
    // 越界区块直接不生成：否则会白白占满 chunks 表，还会让障碍物判定全部落空
    if (cx < 0 || cy < 0 || cx * CHUNK >= this.w || cy * CHUNK >= this.h) return null;
    const key = this.chunkKey(cx, cy);
    const chunk = { key, cx, cy, props: [] };
    this.chunks.set(key, chunk);

    /*
     * 虫巢副本里**不长地表障碍物**。
     *
     * 副本会把整张图改成巢壁/巢道（见 dungeon.carveDungeon），
     * 但区块是随玩家移动惰性生成的：重新生成时会按生物群系撒一地
     * 飞船残骸、虫卵囊之类的 props —— 结果巢道里铺满了地表风格的白色残骸，
     * 玩家的原话就是「虫巢里的地形怎么和外面一个风格」。
     * 副本自己的 props（旗舰残骸）由 _setupDungeon 显式摆。
     */
    if (this.noProps) return chunk;

    const rng = new RNG(this.seed + ':chunk:' + cx + ':' + cy);
    const dens = new ValueNoise(this.seed + ':dens');
    const clus = new CellNoise(this.seed + ':clus', 7);

    // 每 2 格一个投放点，用噪声+细胞噪声决定有没有东西
    for (let ly = 0; ly < CHUNK; ly += 2) {
      for (let lx = 0; lx < CHUNK; lx += 2) {
        const tx = cx * CHUNK + lx + rng.int(0, 1);
        const ty = cy * CHUNK + ly + rng.int(0, 1);
        if (tx < 2 || ty < 2 || tx >= this.w - 2 || ty >= this.h - 2) continue;
        // 被基地铺平过的格子不再生长
        if (this._suppress && this._suppress.has(tx + ',' + ty)) continue;
        const idx = ty * this.w + tx;
        const tile = this.tiles[idx];
        if (isSolidTile(tile)) continue;
        if (this.blocked[idx]) continue;
        // 基地范围里不长东西
        if (this._nearAnyBase(tx * TILE, ty * TILE, 560)) continue;
        // 巢穴正中心留出空地
        if (this._nestCountNear(tx * TILE, ty * TILE, 130) > 0) continue;

        const biome = this.biomes[idx];
        const def = BIOME_DEF[biome];
        const density = clamp01(def.richness * 0.30 * (0.45 + dens.fbm(tx * 0.06, ty * 0.06, 3)));
        const [clusterD] = clus.at(tx, ty);
        const clusterBoost = clusterD < 0.30 ? 1.9 : 1.0;   // 矿脉成簇
        if (rng.next() > density * clusterBoost) continue;

        const type = this._pickPropType(biome, tile, rng);
        if (!type) continue;
        const prop = this._makeProp(type, tx * TILE + TILE / 2 + rng.range(-9, 9), ty * TILE + TILE / 2 + rng.range(-9, 9), rng);
        if (!prop) continue;
        prop.chunk = key;
        chunk.props.push(prop.id);
        this.props.set(prop.id, prop);
      }
    }
  }

  _nearAnyBase(x, y, r) {
    if (this.baseSite && dist(x, y, this.baseSite.x, this.baseSite.y) < r) return true;
    for (const s of this.secondaryBases || []) if (dist(x, y, s.x, s.y) < r) return true;
    return false;
  }

  _pickPropType(biome, tile, rng) {
    // 先掷稀有物（固定消耗随机数，方便复现与调参）
    const rareRoll = rng.next();
    const uniqRoll = rng.next();
    const specialRoll = rng.next();

    const pool = [];
    for (const [key, def] of Object.entries(PROP_DEF)) {
      // 稀有物与「只该出现在副本里」的东西单独处理，不参与常规池。
      // WRECK_CACHE（旗舰残骸）以前漏了这一条：它的 biome 是 undefined，
      // 于是被当成常规物撒满地表 —— 玩家看到的「地图上旗舰残骸太多」就是它，
      // 而且每个都带 5% 红装，地表等于可以刷红装。
      if (key === PROP.CACHE || key === PROP.DATA_OBELISK || key === PROP.EGG_SAC) continue;
      if (key === PROP.WRECK_CACHE) continue;
      if (def.biome && !def.biome.includes(biome)) continue;
      let w = 1;
      if (def.tool === 'pick' && (tile === T.ROCK || tile === T.CRYSTAL || tile === T.ASH)) w = 2.4;
      if (def.tool === null && (tile === T.GRASS || tile === T.FUNGUS)) w = 1.8;
      pool.push([key, w]);
    }
    // 巢穴焦土/火山灰才有虫卵囊
    if (biome === BIOME.SCAR || biome === BIOME.ASHLANDS) pool.push([PROP.EGG_SAC, 0.9]);
    if (!pool.length) pool.push([PROP.WRECK, 1]);

    // 常规物先选出结果
    const picked = rng.weighted(pool);
    // 再按稀有度替换（越稀有的判定越靠前）
    if (uniqRoll < 0.004) return PROP.DATA_OBELISK;
    if (rareRoll < 0.018) return PROP.CACHE;
    const key = typeof picked === 'string' ? picked : picked.key;
    /*
     * 残骸类里有一半其实是「金属堆」：被拆空的那种。
     * 玩家反馈满地都是飞船残骸 —— 换掉一半之后，残骸本身重新变得值得留意，
     * 而金属堆继续稳定供材料。用同一个随机数序列（第三个 roll）决定，
     * 不额外消耗随机数，旧种子的地形不会因此错位太多。
     */
    if ((key === PROP.WRECK || key === PROP.WRECK_CACHE) && specialRoll < 0.5) return PROP.METAL_HEAP;
    return key;
  }

  /**
   * 在指定位置手动放一个可采集物（副本里的旗舰残骸之类）。
   * @param {string} type PROP_DEF 的 key
   * @param {number} x 像素
   * @param {number} y 像素
   * @param {object} [rng] 可选随机源（不传就用世界自己的）
   */
  spawnProp(type, x, y, rng = this.rng) {
    if (!PROP_DEF[type]) return null;
    const spot = this.circleBlocked(x, y, 14) ? this.findOpenSpot(x, y, 220) : { x, y };
    const prop = this._makeProp(type, spot.x, spot.y, rng);
    if (!prop) return null;
    this.props.set(prop.id, prop);
    const chunk = this.chunks.get(prop.chunk);
    if (chunk) chunk.props.push(prop.id);
    return prop;
  }

  _makeProp(type, x, y, rng) {
    const def = PROP_DEF[type];
    if (!def) return null;
    const id = 'p' + (this._propSeq++);
    const chunk = this._getOrCreateChunk(x, y);
    return {
      id, type, x, y,
      r: def.r,
      hp: def.hp, maxHp: def.hp,
      shake: 0,
      hitFlash: 0,
      variant: rng.next(),
      scale: rng.range(0.88, 1.14),
      dead: false,
      chunk: chunk.key,
    };
  }

  _getOrCreateChunk(x, y) {
    const key = this.chunkKey(Math.floor(x / (CHUNK * TILE)), Math.floor(y / (CHUNK * TILE)));
    let chunk = this.chunks.get(key);
    if (!chunk) {
      const [ccx, ccy] = key.split(',').map(Number);
      chunk = { key, cx: ccx, cy: ccy, props: [], suppressed: false };
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  removeProp(id) {
    const p = this.props.get(id);
    if (!p) return;
    p.dead = true;
    const chunk = this.chunks.get(p.chunk);
    if (chunk) {
      const i = chunk.props.indexOf(id);
      if (i >= 0) swapRemove(chunk.props, i);
    }
    this.props.delete(id);
  }

  /** 采集完成 —— 记录重生或永久消失 */
  onPropHarvested(prop) {
    const def = PROP_DEF[prop.type];
    if (def && def.respawn > 0) {
      this.harvested.set(prop.id, { t: def.respawn, type: prop.type, x: prop.x, y: prop.y });
    } else {
      this.harvested.set(prop.id, null);   // 永久消失
    }
    this.removeProp(prop.id);
  }

  // =========================================================
  //  每帧更新
  // =========================================================

  update(dt, game) {
    this.time += dt;

    // 惰性生成区块
    const focus = game?.camera ? { x: game.camera.x, y: game.camera.y } : null;
    if (focus) this.ensureChunksAround(focus.x, focus.y, 1150);

    // 采集物重生计时
    if (this.harvested.size) {
      for (const [id, rec] of this.harvested) {
        if (!rec) continue;
        rec.t -= dt;
        if (rec.t <= 0) {
          this.harvested.delete(id);
          this._respawnProp(id, rec);
        }
      }
    }

    // 受击反馈衰减
    for (const p of this.props.values()) {
      if (p.shake > 0) p.shake = Math.max(0, p.shake - dt * 5);
      if (p.hitFlash > 0) p.hitFlash = Math.max(0, p.hitFlash - dt * 4);
    }

    this._unloadDistantChunks(focus);
  }

  updateIdle(dt) { /* 菜单状态无需生成 */ }

  /** 远离视线的区块回收，避免长时间探索后内存无限增长 */
  _unloadDistantChunks(focus) {
    if (!focus || this.chunks.size < 60) return;
    const R = 1500;
    const R2 = R * R;
    for (const [key, chunk] of this.chunks) {
      if (!chunk.props.length) continue;
      let anyNear = false;
      for (const id of chunk.props) {
        const p = this.props.get(id);
        if (!p) continue;
        const dx = p.x - focus.x, dy = p.y - focus.y;
        if (dx * dx + dy * dy < R2) { anyNear = true; break; }
      }
      if (anyNear) continue;
      for (const id of chunk.props) {
        const p = this.props.get(id);
        if (p) p.dead = true;
        this.props.delete(id);
      }
      chunk.props.length = 0;
      this.chunks.delete(key);
    }
  }

  _respawnProp(id, rec) {
    const x = rec.x, y = rec.y;
    const idx = Math.floor(y / TILE) * this.w + Math.floor(x / TILE);
    if (idx < 0 || idx >= AREA) return;
    if (isSolidTile(this.tiles[idx]) || this.blocked[idx]) return;
    if (this._nearAnyBase(x, y, 560)) return;
    const rng = new RNG(this.seed + ':respawn:' + id);
    const prop = this._makeProp(
      PROP_DEF[rec.type] ? rec.type : this._pickPropType(this.biomes[idx], this.tiles[idx], rng),
      x, y, rng,
    );
    if (!prop) return;
    prop.id = id;                 // 复用同一 id，避免 harvested 表无限膨胀
    const chunk = this._getOrCreateChunk(x, y);
    prop.chunk = chunk.key;
    chunk.props.push(id);
    this.props.set(id, prop);
  }

  // =========================================================
  //  存档
  // =========================================================

  serialize() {
    const props = [];
    for (const p of this.props.values()) props.push([p.id, p.type, Math.round(p.x), Math.round(p.y), p.hp, p.variant, p.chunk]);
    return {
      seed: this.seed,
      planetIndex: this.planetIndex,
      planetName: this.planetName,
      propSeq: this._propSeq,
      tiles: bytesToB64(this.tiles),
      biomes: bytesToB64(this.biomes),
      variant: bytesToB64(this.variant),
      modified: Array.from(this.modifiedTiles.entries()),
      harvested: Array.from(this.harvested.entries()).map(([k, v]) => [k, v ? [Math.round(v.t), v.type, Math.round(v.x), Math.round(v.y)] : null]),
      nests: this.nests.map(n => ({
        id: n.id, hp: Math.round(n.hp), destroyed: n.destroyed, discovered: n.discovered,
        spawnTimer: n.spawnTimer, bossSpawned: n.bossSpawned, dungeonCleared: !!n.dungeonCleared,
      })),
      pois: this.pois.map(p => ({
        id: p.id, discovered: p.discovered, looted: p.looted, beaconTaken: p.beaconTaken,
      })),
      baseSite: this.baseSite,
      secondaryBases: this.secondaryBases || [],
      landingSites: this.landingSites,
      props,
    };
  }

  /** 就地重建：保留本对象的引用，所有系统都不用换指针 */
  restore(data) {
    this.seed = data.seed ?? this.seed;
    this.planetIndex = data.planetIndex ?? this.planetIndex;
    this.planetName = data.planetName ?? this.planetName;
    this._propSeq = data.propSeq ?? 1;

    const t = b64ToBytes(data.tiles);
    if (t && t.length === this.tiles.length) this.tiles = t;
    const b = b64ToBytes(data.biomes);
    if (b && b.length === this.biomes.length) this.biomes = b;
    const v = b64ToBytes(data.variant);
    if (v && v.length === this.variant.length) this.variant = v;

    this.modifiedTiles = new Map((data.modified || []).map(([k, val]) => [Number(k), val]));
    this.harvested = new Map((data.harvested || []).map(([k, val]) => [
      k,
      val ? { t: val[0], type: val[1], x: val[2], y: val[3] } : null,
    ]));
    for (const n of data.nests || []) {
      const nest = this.nests.find(x => x.id === n.id);
      if (!nest) continue;
      nest.hp = n.hp; nest.destroyed = n.destroyed; nest.discovered = n.discovered;
      if (typeof n.spawnTimer === 'number') nest.spawnTimer = n.spawnTimer;
      if (typeof n.bossSpawned === 'boolean') nest.bossSpawned = n.bossSpawned;
      if (typeof n.dungeonCleared === 'boolean') nest.dungeonCleared = n.dungeonCleared;
    }
    for (const p of data.pois || []) {
      const poi = this.pois.find(x => x.id === p.id);
      if (!poi) continue;
      poi.discovered = p.discovered; poi.looted = p.looted;
      if (p.beaconTaken != null) poi.beaconTaken = p.beaconTaken;
    }
    this.baseSite = data.baseSite || this.baseSite;
    this.secondaryBases = data.secondaryBases || [];
    if (data.landingSites?.length) this.landingSites = data.landingSites;

    // 重建障碍物
    this.props.clear();
    this.chunks.clear();
    for (const [id, type, x, y, hp, variant, chunkKey] of data.props || []) {
      const def = PROP_DEF[type];
      if (!def) continue;
      const chunk = this._getOrCreateChunk(x, y);
      const prop = {
        id, type, x, y, r: def.r, hp, maxHp: def.hp,
        shake: 0, hitFlash: 0, variant: variant ?? 0.5, scale: 1, dead: false,
        chunk: chunkKey || chunk.key,
      };
      this.props.set(id, prop);
      chunk.props.push(id);
    }
  }

  /** 统计信息，给 UI 用 */
  get stats() {
    const alive = this.nests.filter(n => !n.destroyed).length;
    return {
      totalNests: this.nests.length,
      aliveNests: alive,
      clearedNests: this.nests.length - alive,
      ruins: this.pois.filter(p => p.kind === 'ruin').length,
      poisDiscovered: this.pois.filter(p => p.discovered).length,
      poisTotal: this.pois.length,
    };
  }
}

// ---------- 名字池 ----------
const NEST_NAMES = ['赤针', '蚀骨', '涌潮', '裂石', '灰瘴', '雷喙', '霜髓', '熔核', '暗孢', '锈爪', '虚鸣', '棘冠', '烛瞳', '渊喉'];
const RUIN_NAMES = ['希望号前哨', '铁砧三号', '远星观测站', '拓荒者营地', '曙光补给点', '沉默哨塔', '灰烬站', '猎户前哨'];

/**
 * 降落点难度分级。
 * 一级保底存在（附近没有巢穴），让新玩家永远有一个稳的开局选择。
 */
const LANDING_TIER = {
  1: { name: '一级 · 安全区', color: '#6ee7a8', desc: '附近没有虫巢，地形温和。适合稳扎稳打铺开家底。' },
  2: { name: '二级 · 边界区', color: '#8fe0ff', desc: '远处有虫巢活动。资源尚可，需要尽快把塔立起来。' },
  3: { name: '三级 · 前沿区', color: '#ffba4c', desc: '虫巢就在附近。资源最丰厚，但落地就会有压力。' },
};

export { LANDING_TIER };

// ---------- base64 编解码（存档用） ----------
function bytesToB64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(s);
}

function b64ToBytes(b64) {
  if (!b64) return null;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
