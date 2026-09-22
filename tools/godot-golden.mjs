/**
 * 生成 Godot 黄金值：用**现有 JS 实现**算出一批确定性数值，写进
 * godot/tests/golden.json。Godot 侧的 `run_tests.gd` 会跑同一批用例并逐位比对。
 *
 * 为什么值得这么做：世界生成、掉落、实验科技抽取全建立在 RNG 与噪声上，
 * 只要有一位不一样，同一个种子就会生成完全不同的地图、存档也就对不上了。
 * 这是移植过程中唯一能自动发现「翻译错了一位」的手段。
 *
 * 用法：node tools/godot-golden.mjs          （重新生成黄金值）
 *       node tools/godot-verify.mjs          （生成 + 跑 Godot + 比对）
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RNG } from '../src/core/rng.js';
import { ValueNoise, CellNoise } from '../src/core/noise.js';
import { hashStr } from '../src/core/math.js';
import { WORLD_PX } from '../src/core/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'godot', 'tests');
mkdirSync(OUT, { recursive: true });

/** 浮点统一截断到 12 位小数，避免两侧打印精度差异造成假失败 */
const f = (v) => Number(Number(v).toFixed(12));

const golden = { generatedAt: new Date().toISOString(), cases: {} };

/** 值噪声 / 细胞噪声共用的采样点（必须写进 JSON，两边不能各写一份） */
const pts = [[0, 0], [1.5, -2.25], [37.2, 88.9], [-12.75, 4.5], [100.125, -100.875]];

// ---- hashStr ----
golden.cases.hashStr = ['frontier-abc', 'nest:3', '', 'a', '开拓者'].map(s => ({
  input: s, expect: hashStr(s),
}));

// ---- RNG：next / range / int / chance / pick / weighted / shuffle / gauss / fork ----
{
  const seeds = ['frontier-abc', 'dungeon-garrison', 12345];
  golden.cases.rng = seeds.map((seed) => {
    const r = new RNG(seed);
    const nexts = Array.from({ length: 8 }, () => f(r.next()));
    const ranges = Array.from({ length: 4 }, () => f(r.range(-5, 5)));
    const ints = Array.from({ length: 6 }, () => r.int(1, 10));
    const chances = Array.from({ length: 5 }, () => r.chance(0.35));
    const picks = Array.from({ length: 5 }, () => r.pick(['a', 'b', 'c', 'd']));
    const weighted = Array.from({ length: 6 }, () => r.weighted([[ 'x', 5 ], [ 'y', 1 ], [ 'z', 3 ]]));
    const weightedObj = Array.from({ length: 6 }, () => r.weighted([
      { t: 'grub', w: 30 }, { t: 'wasp', w: 10 }, { e: 'boss', w: 1 },
    ]));
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = r.shuffle(arr.slice());
    const gauss = Array.from({ length: 4 }, () => f(r.gauss(0, 1)));
    const forked = new RNG((new RNG(seed).seed ^ hashStr('chunk')) >>> 0);
    const forkVals = Array.from({ length: 4 }, () => f(forked.next()));
    return {
      // 种子的**类型**要保留：数字种子在世界生成里是常态，
      // 若统一转成字符串，Godot 侧会去哈希字符串 "12345" 而不是当数字用
      // （黄金对比第一版就踩了这个，表现为整个种子序列完全不同）
      seed, seedIsNumber: typeof seed === 'number',
      nexts, ranges, ints, chances, picks, weighted, weightedObj,
      shuffled, gauss, forkVals,
    };
  });
}

// ---- 值噪声 ----
{
  const seeds = ['frontier-abc:height', 'noise-2'];
  golden.cases.valueNoise = seeds.map((seed) => {
    const n = new ValueNoise(seed);
    return {
      seed,
      // 采样点一起写进黄金值：测试侧不能再自己写一份字面量
      // （第一版就是这样，valueNoise 与 cellNoise 用了不同的点表，
      //   结果 12 条「失败」其实是对着错误的期望值比）
      pts: pts,
      at: pts.map(([x, y]) => f(n.at(x, y))),
      fbm: pts.map(([x, y]) => f(n.fbm(x * 0.06, y * 0.06, 3))),
      ridged: pts.map(([x, y]) => f(n.ridged(x * 0.02, y * 0.02, 4))),
      warped: pts.map(([x, y]) => f(n.warped(x * 0.05, y * 0.05, 0.35, 4))),
    };
  });
}

// ---- 细胞噪声 ----
{
  const c = new CellNoise('frontier-abc:clus', 7);
  golden.cases.cellNoise = {
    seed: 'frontier-abc:clus', density: 7,
    pts: pts,
    at: pts.map(([x, y]) => {
      const [d, bx, by] = c.at(x, y);
      return [f(d), f(bx), f(by)];
    }),
  };
}

// ---- 世界生成（分阶段哈希 + 关键对象）----
{
  const { World } = await import('../src/world/world.js');

  /** 与 GDScript 侧同一套哈希：FNV-1a 依次吃 tiles / biomes */
  const hashArrays = (w) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < w.tiles.length; i++) {
      h = Math.imul(h ^ w.tiles[i], 16777619) >>> 0;
      h = Math.imul(h ^ w.biomes[i], 16777619) >>> 0;
    }
    return h >>> 0;
  };
  const hashOne = (arr) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < arr.length; i++) h = Math.imul(h ^ arr[i], 16777619) >>> 0;
    return h >>> 0;
  };

  /**
   * 分阶段取样：用子类在每个生成步骤前后取哈希。
   * 这样一旦最终哈希不一致，能立刻看出是哪一步跑偏 —— 世界生成有 8 个阶段，
   * 只比对最终结果的话排查起来是盲猜。
   */
  const buildStaged = (seed, opts) => {
    const stages = {};
    const rec = (name, w) => { stages[name] = { tiles: hashOne(w.tiles), biomes: hashOne(w.biomes), both: hashArrays(w) }; };
    class StagedWorld extends World {
      _classifyBiomes() { rec('afterLoop', this); super._classifyBiomes(); rec('afterClassify', this); }
      _floodFillMainRegion() { super._floodFillMainRegion(); rec('afterFlood', this); }
      _placeLandingSites() { super._placeLandingSites(); rec('afterLanding', this); }
      _placeNests(a, b) { super._placeNests(a, b); rec('afterNests', this); }
      _placeMajorPois(a) { super._placeMajorPois(a); rec('afterPois', this); }
      _carveStarterZone(a) { super._carveStarterZone(a); rec('afterStarter', this); }
      _applyScars() { super._applyScars(); rec('afterScars', this); }
    }
    const w = new StagedWorld(seed, opts);
    return { w, stages };
  };

  const seeds = [
    { seed: 'frontier-golden-a', opts: {} },
    { seed: 'frontier-golden-b', opts: { planetIndex: 2 } },
  ];
  golden.cases.world = seeds.map(({ seed, opts }) => {
    const { w, stages } = buildStaged(seed, opts);
    return {
      seed, opts,
      stages,
      tiles: hashOne(w.tiles),
      biomes: hashOne(w.biomes),
      variant: hashOne(w.variant),
      nests: w.nests.map(n => ({
        id: n.id, x: f(n.x), y: f(n.y), tier: n.tier, hp: n.hp, threat: f(n.threat), name: n.name,
      })),
      pois: w.pois.map(p => ({ id: p.id, kind: p.kind, x: f(p.x), y: f(p.y), name: p.name || null })),
      landing: w.landingSites.map(s => ({ tx: s.tx, ty: s.ty, tier: s.tier, danger: f(s.danger), biome: s.biome })),
      baseSite: w.baseSite ? { tx: w.baseSite.tx, ty: w.baseSite.ty } : null,
      mainRegion: w.mainRegion,
    };
  });
}

// ---- 查询 API：碰撞 / 通行速度 / 找空地 ----
{
  const { World } = await import('../src/world/world.js');
  const w = new World('frontier-golden-a', {});

  // 采样点：世界中心附近 + 基地 + 一些固定偏移（覆盖陆地/水/岩壁/边界外）
  const probePts = [];
  for (let i = 0; i < 24; i++) {
    const a = i * 1.7;
    probePts.push([Math.round(w.baseSite.x + Math.cos(a) * (i * 137)), Math.round(w.baseSite.y + Math.sin(a) * (i * 91))]);
  }
  probePts.push([0, 0], [-50, -50], [WORLD_PX + 100, WORLD_PX + 100], [w.baseSite.x, w.baseSite.y]);

  golden.cases.worldQuery = {
    seed: 'frontier-golden-a',
    pts: probePts,
    isBlocked: probePts.map(([x, y]) => w.isBlockedPx(x, y) ? 1 : 0),
    circleBlocked: probePts.map(([x, y]) => w.circleBlocked(x, y, 12) ? 1 : 0),
    circleBlocked22: probePts.map(([x, y]) => w.circleBlocked(x, y, 22) ? 1 : 0),
    speed: probePts.map(([x, y]) => f(w.speedAtPx(x, y))),
    tileAt: probePts.map(([x, y]) => w.tileAtPx(x, y)),
    biomeAt: probePts.map(([x, y]) => w.biomeAtPx(x, y)),
    lineBlocked: probePts.map(([x, y]) => w.lineBlocked(w.baseSite.x, w.baseSite.y, x, y) ? 1 : 0),
    openSpot: probePts.map(([x, y]) => {
      const s = w.findOpenSpot(x, y, 120);
      return [f(s.x), f(s.y)];
    }),
  };
}

// ---- 流场寻路 ----
{
  const { World } = await import('../src/world/world.js');
  const w = new World('frontier-golden-a', {});

  /** 与 GDScript 侧同一套取样：目标 = 基地所在格 */
  const runFlow = (blockedFn, label) => {
    const blocked = blockedFn ? blockedFn : null;
    // 先把「动态阻挡集合」记下来：流场对不上时，第一件要确认的就是
    // 「两边喂进去的障碍是不是同一批」。没有这一条就只能盲猜。
    let bCount = 0;
    let bHash = 2166136261 >>> 0;
    if (blocked) {
      for (let ty = 0; ty < w.h; ty++) {
        for (let tx = 0; tx < w.w; tx++) {
          if (blocked(tx, ty)) {
            bCount++;
            bHash = Math.imul(bHash ^ (ty * w.w + tx), 16777619) >>> 0;
          }
        }
      }
    }
    w.flow.compute(w.baseSite.tx, w.baseSite.ty, w.tiles, blocked);
    const samples = [];
    for (let i = 0; i < 20; i++) {
      const a = i * 0.9;
      const r = 200 + i * 260;
      const x = w.baseSite.x + Math.cos(a) * r;
      const y = w.baseSite.y + Math.sin(a) * r;
      const s = w.flow.sample(x, y);
      samples.push({ x: Math.round(x), y: Math.round(y), dx: f(s.x), dy: f(s.y), ok: s.ok ? 1 : 0, cost: Number.isFinite(s.dist) ? s.dist : -1 });
    }
    // 格子级抽样：整张流场的方向与代价哈希（最能发现「差一格」）
    let dh = 2166136261 >>> 0;
    let ch = 2166136261 >>> 0;
    for (let i = 0; i < w.flow.dist.length; i++) {
      const dx = Math.round(w.flow.dirX[i] * 1000);
      const dy = Math.round(w.flow.dirY[i] * 1000);
      dh = Math.imul(dh ^ (dx & 0xFFFF), 16777619) >>> 0;
      dh = Math.imul(dh ^ (dy & 0xFFFF), 16777619) >>> 0;
      // 只统计**本代有效**的格子：dist 数组跨代复用（靠 stamp 标记），
      // 不过滤的话会把上一代的残留值算进去 —— 两边就会「因为历史不同」而不一致
      const valid = w.flow.stamp[i] === w.flow.generation && Number.isFinite(w.flow.dist[i]);
      const c = valid ? Math.min(0xFFFFFF, Math.round(w.flow.dist[i])) : 0xFFFFFF;
      ch = Math.imul(ch ^ (c & 0xFFFFFF), 16777619) >>> 0;
    }
    return {
      label,
      blockedCount: bCount,
      blockedHash: bHash >>> 0,
      goal: [w.flow.goal.x, w.flow.goal.y],
      maxCost: Number.isFinite(w.flow.maxCost) ? Math.round(w.flow.maxCost) : -1,
      dirHash: dh >>> 0,
      costHash: ch >>> 0,
      samples,
    };
  };

  golden.cases.flow = [
    runFlow(null, 'open'),
    // 动态障碍：在基地右侧竖一堵墙，路径必须绕过去 —— 这条能验证
    // 动态阻挡的烘焙（_bakeCost）与绕行方向都和 JS 一致
    runFlow((tx, ty) => tx === w.baseSite.tx + 20 && ty > w.baseSite.ty - 40 && ty < w.baseSite.ty + 40, 'wallBlocked'),
    // 目标被围住：验证「目标格本身是实心也要出流场」
    runFlow((tx, ty) => {
      const dx = tx - w.baseSite.tx, dy = ty - w.baseSite.ty;
      const d = Math.sqrt(dx * dx + dy * dy);
      return d > 2 && d < 4;
    }, 'goalSealed'),
  ];
}

// ---- 空间哈希 ----
{
  const { SpatialHash } = await import('../src/world/spatialHash.js');
  const hash = new SpatialHash(84);
  // 确定性实体表（不依赖世界生成，纯几何）
  const ents = [];
  for (let i = 0; i < 60; i++) {
    ents.push({
      id: i,
      x: (i * 137) % 4000 - 1000,
      y: (i * 271) % 3600 - 800,
      r: 10 + (i % 5) * 4,
      dead: i % 17 === 0,
    });
  }
  hash.build(ents, (e) => e.r);

  const queries = [];
  for (let i = 0; i < 12; i++) {
    const x = (i * 613) % 3000 - 800;
    const y = (i * 419) % 2600 - 600;
    const r = 90 + i * 25;
    const found = hash.query(x, y, r).map(e => e.id).sort((a, b) => a - b);
    const near = hash.nearest(x, y, 600, (e) => !e.dead);
    queries.push({ x, y, r, ids: found, nearest: near ? near.id : -1 });
  }
  golden.cases.spatialHash = { cell: 84, ents: ents.map(e => ({ id: e.id, x: e.x, y: e.y, r: e.r, dead: e.dead ? 1 : 0 })), queries };
}

// ---- 逐轴移动 / 贴墙滑行 ----
{
  const { World } = await import('../src/world/world.js');
  const { TILE } = await import('../src/core/config.js');
  const w = new World('frontier-golden-a', {});
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /** JS 版 enemies.tryMove 的纯几何复刻（去掉 AI 相关的眩晕副作用） */
  const tryMove = (x, y, r, dx, dy, flying = false) => {
    if (flying) {
      return {
        x: clamp(x + dx, TILE, w.w * TILE - TILE),
        y: clamp(y + dy, TILE, w.h * TILE - TILE),
        hitWallX: false, hitWallY: false,
      };
    }
    let nx = x + dx;
    const ny = y + dy;
    let hitX = false, hitY = false;
    if (!w.circleBlocked(nx, y, r * 0.8)) x = nx; else hitX = true;
    if (!w.circleBlocked(x, ny, r * 0.8)) y = ny; else hitY = true;
    return { x, y, hitWallX: hitX, hitWallY: hitY };
  };

  // 一组「故意撞墙」的移动：从几个起点朝各个方向推
  const cases = [];
  for (let i = 0; i < 12; i++) {
    const sx = Math.round(w.baseSite.x + Math.cos(i * 1.3) * (400 + i * 220));
    const sy = Math.round(w.baseSite.y + Math.sin(i * 1.3) * (400 + i * 220));
    for (let k = 0; k < 3; k++) {
      const a = i * 0.7 + k * 2.1;
      const dist = 20 + k * 14;
      const dx = Math.cos(a) * dist;
      const dy = Math.sin(a) * dist;
      const r = [10, 14, 22][k];
      const res = tryMove(sx, sy, r, dx, dy, false);
      cases.push({
        sx, sy, r, dx: f(dx), dy: f(dy),
        x: f(res.x), y: f(res.y), hx: res.hitWallX ? 1 : 0, hy: res.hitWallY ? 1 : 0,
      });
    }
  }
  // 飞行单位：只做边界钳制
  const fly = tryMove(-500, -500, 12, -900, -900, true);
  const fly2 = tryMove(999999, 999999, 12, 900, 900, true);
  golden.cases.slideMove = {
    seed: 'frontier-golden-a',
    cases,
    flying: [{ x: f(fly.x), y: f(fly.y) }, { x: f(fly2.x), y: f(fly2.y) }],
  };
}

// ---- 崖边（「看得见的崖边」）描边遮罩 ----
{
  const { World } = await import('../src/world/world.js');
  const { isSolidTile } = await import('../src/data/tiles.js');
  const w = new World('frontier-golden-a', {});

  /**
   * 与 Godot 侧 `terrain_layer.solid_edge_signature()` 同一套规则：
   * 每个实心地块看四个方向有没有可通行邻居，拼成 4 位掩码；
   * 只要有一面要描边就把 (地块序号, 掩码) 混进哈希。
   */
  const walkable = (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h) return false;
    return !isSolidTile(w.tiles[ty * w.w + tx]);
  };
  let h = 2166136261 >>> 0;
  let edges = 0;
  for (let ty = 0; ty < w.h; ty++) {
    for (let tx = 0; tx < w.w; tx++) {
      const idx = ty * w.w + tx;
      if (!isSolidTile(w.tiles[idx])) continue;
      let mask = 0;
      if (walkable(tx, ty + 1)) mask |= 1;
      if (walkable(tx, ty - 1)) mask |= 2;
      if (walkable(tx + 1, ty)) mask |= 4;
      if (walkable(tx - 1, ty)) mask |= 8;
      if (mask !== 0) {
        edges++;
        h = Math.imul(h ^ (idx * 16 + mask), 16777619) >>> 0;
      }
    }
  }
  golden.cases.solidEdges = { seed: 'frontier-golden-a', count: edges, hash: h >>> 0 };
}

// ---- 属性聚合（StatSet + foldEffects + 等级缩放）----
{
  const { StatSet, foldEffects, DEFAULT_STATS } = await import('../src/systems/stats.js');
  const { TECH_DEF } = await import('../src/data/tech.js');
  const { EXPERIMENTS } = await import('../src/data/experiments.js');
  const { CHAR_DEF } = await import('../src/data/characters.js');

  /** 与 runState 里同名的等级缩放（那份是模块私有的，这里复刻同一段逻辑） */
  const MULT_KEYS = new Set(['damage', 'attackSpeed', 'speedMult', 'goldMult', 'xpMult', 'matMult',
    'towerDamage', 'towerAttackSpeed', 'critChance', 'critMult', 'hpMax', 'armor']);
  const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const scaleMechanic = (obj, level) => {
    const out = { ...obj };
    for (const k of ['mult', 'dmg', 'dps', 'amount', 'radius', 'chains', 'regen']) {
      if (typeof out[k] === 'number') {
        const slope = (k === 'radius' || k === 'chains') ? 0.12 : 0.55;
        out[k] = out[k] * (1 + slope * (level - 1));
      }
    }
    return out;
  };
  const scaleEffect = (effect, level) => {
    if (level <= 1) return effect;
    const out = {};
    for (const k of Object.keys(effect)) {
      const v = effect[k];
      if (typeof v === 'number') out[k] = v * level;
      else if (isPlainObject(v)) out[k] = scaleMechanic(v, level);
      else out[k] = v;
    }
    return out;
  };
  void MULT_KEYS;

  // 固定一份「中期存档」的成长来源：角色基础 + 若干科技 + 若干实验科技 + 装备词缀
  const techPick = ['t_mine1', 't_mine2', 't_gunDamage1', 't_gunDamage2', 't_gunRate1',
    't_turretSlot', 't_towerDamage1', 't_beacon2', 't_carry1', 't_armor1'];
  const expPick = ['x_pio_arsenal', 'd_lastStand', 'd_vengeance', 'e_supply', 'x_scout_legs'];

  const buildEffects = () => {
    const list = [];
    list.push({ ...CHAR_DEF.engineer.base });
    for (const id of techPick) {
      const node = TECH_DEF.find(t => t.id === id);
      if (!node) continue;
      list.push(scaleEffect(node.effect, 3));
    }
    for (const id of expPick) {
      const e = EXPERIMENTS.find(x => x.id === id);
      if (!e) continue;
      list.push(scaleEffect(e.effect, 2));
    }
    // 装备词缀（走同一套 fold）—— 也写进黄金值，保证两边输入完全一样
    for (const e of extraEffects) list.push({ ...e });
    return list;
  };

  const extraEffects = [
    { armor: 8, critChance: 0.04, carryMult: 0.2 },
    { damage: 0.12, attackSpeed: 0.08, towerExplode: { radius: 60, dmg: 30 } },
    { towerExplode: { radius: 90, dmg: 45 }, hpMax: 40 },
  ];

  const effects = buildEffects();
  const folded = foldEffects(effects);
  const ss = new StatSet(CHAR_DEF.engineer.base);
  ss.add(folded.stats);
  // 再叠两个临时 buff（含同名 id 覆盖的情形）
  ss.addBuff({ damage: 0.35, speedMult: 0.2 }, 10, 'rage');
  ss.addBuff({ armor: 12 }, 5, 'shield');
  ss.addBuff({ damage: 0.5 }, 3, 'rage');      // 同名 id：旧的被替换
  ss.update(4.0);                              // 让 'shield' 过期（5 秒）

  const allStats = {};
  for (const k of Object.keys(DEFAULT_STATS)) allStats[k] = f(ss.get(k));
  // 非默认键也要出来（packDamage / phaseShield / thornAcid 等是 foldEffects 动态加的）
  for (const k of Object.keys(ss.all())) {
    if (!(k in allStats)) {
      const v = ss.all()[k];
      allStats[k] = (typeof v === 'number') ? f(v) : (isPlainObject(v) ? null : v);
    }
  }
  golden.cases.stats = {
    build: {
      techPick, expPick, extraEffects,
      charId: 'engineer', techLevel: 3, expLevel: 2,
      buffs: [
        { mods: { damage: 0.35, speedMult: 0.2 }, duration: 10, id: 'rage' },
        { mods: { armor: 12 }, duration: 5, id: 'shield' },
        { mods: { damage: 0.5 }, duration: 3, id: 'rage' },
      ],
      updateDt: 4.0,
      effectsJson: JSON.parse(JSON.stringify(folded.stats)),   // 让 Godot 侧用同一批输入
      unlocks: {
        towers: [...folded.unlocks.towers].sort(),
        structures: [...folded.unlocks.structures].sort(),
        features: [...folded.unlocks.features].sort(),
        meleeModules: [...folded.unlocks.meleeModules].sort(),
        beaconLevels: folded.unlocks.beaconLevels,
        beaconCore: folded.unlocks.beaconCore,
      },
    },
    values: allStats,
    mechanics: Object.fromEntries(Object.entries(ss.mechanics).map(([k, v]) => [k, v])),
    hasRage: ss.hasBuff('rage'),
    hasShield: ss.hasBuff('shield'),
    buffCount: ss.buffs.length,
  };
}

// ---- 武器数值上限 / 换弹 / 弹药整数化 ----
{
  const { StatSet } = await import('../src/systems/stats.js');
  const { WEAPON_DEF, RARITY_RELOAD, reloadTimeOf } = await import('../src/data/weapons.js');
  const { WEAPON_CAPS } = await import('../src/core/config.js');
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /** JS player.weaponStat 的纯函数复刻 */
  const weaponStat = (ss, key) => {
    const raw = ss.get(key) || 0;
    const cap = WEAPON_CAPS[key];
    return cap == null ? raw : clamp(raw, 0, cap);
  };

  // 三档成长：白板 / 中期 / 顶满（顶满用来验证上限钳制）
  const builds = [
    { name: 'fresh', stats: {} },
    { name: 'mid', stats: { damage: 0.6, attackSpeed: 0.35, rangeMult: 0.4, projectiles: 1, ammoCostMult: -0.15 } },
    { name: 'capped', stats: { damage: 5.0, attackSpeed: 4.0, rangeMult: 6.0, projectiles: 9, ammoCostMult: -0.9 } },
  ];
  const weaponIds = Object.keys(WEAPON_DEF).slice(0, 10);
  const rarities = ['common', 'rare', 'relic'];

  const cases = [];
  for (const b of builds) {
    const ss = new StatSet();
    ss.add(b.stats);
    const rows = [];
    for (const id of weaponIds) {
      const def = WEAPON_DEF[id];
      if (!def || def.kind === 'module') continue;
      rows.push({
        id,
        range: f((def.range || 0) * (1 + weaponStat(ss, 'rangeMult'))),
        dmgMult: f(1 + weaponStat(ss, 'damage')),
        cd: f((def.cd || 0.5) / (1 + weaponStat(ss, 'attackSpeed'))),
        barrels: 1 + Math.round(weaponStat(ss, 'projectiles')),
        ammoCost: f(Math.max(0, (def.ammoPerShot == null ? 1 : def.ammoPerShot) * (1 + (ss.get('ammoCostMult') || 0)))),
        reloadCommon: f(reloadTimeOf(def, 'common')),
        reloadRelic: f(reloadTimeOf(def, 'relic')),
      });
    }
    cases.push({ name: b.name, stats: b.stats, rows });
  }

  // 弹药整数化：模拟「连打 N 枪」后 ammo 与零头的变化
  const ammoSim = (() => {
    const def = { id: 'plasma', ammoPerShot: 0.15 };
    const ss = new StatSet();
    ss.add({ ammoCostMult: 0.0 });
    const p = { ammo: 160, ammo_frac: 0 };
    const trace = [];
    for (let i = 1; i <= 20; i++) {
      const cost = Math.max(0, (def.ammoPerShot == null ? 1 : def.ammoPerShot) * (1 + (ss.get('ammoCostMult') || 0)));
      p.ammo_frac = (p.ammo_frac || 0) + cost;
      while (p.ammo_frac >= 1) { p.ammo_frac -= 1; p.ammo -= 1; }
      p.ammo = Math.max(0, Math.round(p.ammo));
      trace.push([i, f(p.ammo), f(p.ammo_frac)]);
    }
    return { def, statsUsed: { ammoCostMult: 0.0 }, ammoPerShot: def.ammoPerShot, start: 160, trace, rarities: Object.entries(RARITY_RELOAD) };
  })();

  golden.cases.weapons = { cases, ammoSim };
}

// ---- 怪物缩放 / 建怪字段 / 伤害与护甲 ----
{
  const { enemyScaleFor, createEnemy } = await import('../src/systems/runState.js');
  const { MonsterSystem } = await import('../src/systems/enemies.js');
  const { MONSTER_DEF } = await import('../src/data/monsters.js');
  const { RNG } = await import('../src/core/rng.js');

  // 极简 run 替身：createEnemy 只用到 planetIndex / rng / player / base
  const mkRun = (planetIndex, seed) => ({
    planetIndex,
    rng: new RNG(seed),
    player: { x: 1000, y: 1000 },
    base: { x: 2000, y: 2000 },
  });

  // 1) 缩放公式：层数 × 星球 的一张表
  const scaleTable = [];
  for (const P of [0, 1, 3]) {
    for (const tier of [1, 2, 5, 10]) {
      const s = enemyScaleFor({ planetIndex: P }, tier, 1);
      scaleTable.push({ P, tier, hp: f(s.hp), dmg: f(s.dmg), xp: f(s.xp), gold: f(s.gold) });
    }
  }

  // 2) 建怪：固定种子下逐字段比对（hp/dmg/speed/armor/xp/gold/朝向/抖动/精英倍率）
  const monsterTypes = Object.keys(MONSTER_DEF).slice(0, 14);
  const created = [];
  for (const type of monsterTypes) {
    const def = MONSTER_DEF[type];
    for (const opts of [
      { tier: 1 },
      { tier: 4, elite: true },
      { tier: 8, scale: { hp: 2, dmg: 1.5, xp: 1.2, gold: 1.1 }, hpMult: 0.9, armorBonus: 3, speedMult: 1.2 },
    ]) {
      const run = mkRun(0, `enemy-${type}-${opts.tier}`);
      const scale = opts.scale || { hp: 1, dmg: 1, xp: 1, gold: 1 };
      const e = createEnemy(run, type, 123.5, 456.25, { tier: opts.tier, scale, ...opts });
      if (!e) continue;
      created.push({
        type, tier: opts.tier, elite: !!opts.elite,
        hp: f(e.hp), hpMax: f(e.hpMax), dmg: f(e.dmg), speed: f(e.speed), armor: f(e.armor),
        r: f(e.r), xpValue: f(e.xpValue), goldValue: f(e.goldValue),
        attackCd: f(e.attackCd), flankAngle: f(e.flankAngle), wobble: f(e.wobble),
        eliteFlag: e.elite ? 1 : 0, boss: e.boss ? 1 : 0,
        // optsElite 是**传入**的选项：精英怪种（def.elite）本身不吃 1.6 倍，
        // 只有 opts.elite 才吃 —— 测试必须喂同一个输入，否则会误判成移植错误
        optsElite: opts.elite ? 1 : 0,
        angle: f(e.angle), defHp: f(def.hp), defDmg: f(def.dmg), defSpeed: f(def.speed),
      });
      void MonsterSystem;
    }
  }

  // 3) 护甲减伤：applyArmor 是 player.js 里的模块私有函数，这里复刻同一式子
  const applyArmor = (dmg, armor) => {
    if (armor <= 0) return dmg;
    const reduction = armor / (armor + 42);
    return dmg * (1 - reduction);
  };
  const armorTable = [];
  for (const armor of [0, 1, 5, 12, 30, 60, 120]) {
    for (const dmg of [1, 10, 47.5, 300]) {
      armorTable.push({ armor, dmg: f(dmg), out: f(applyArmor(dmg, armor)) });
    }
  }

  // 4) 伤害入口：护甲 + 标记（marks 每层 +12%）+ 最低 1 点
  const damageTable = [];
  const mkTarget = (armor, marks) => ({ hp: 1000, hpMax: 1000, armor, marks, dead: false });
  for (const [armor, marks] of [[0, 0], [12, 0], [12, 3], [60, 5], [200, 0]]) {
    for (const amount of [5, 40, 500]) {
      const t = mkTarget(armor, marks);
      let dmg = amount;
      dmg = applyArmor(dmg, t.armor);
      if (t.marks > 0) dmg *= 1 + t.marks * 0.12;
      dmg = Math.max(1, dmg);
      damageTable.push({ armor, marks, amount: f(amount), out: f(dmg) });
    }
  }

  golden.cases.enemies = { scaleTable, created, armorTable, damageTable };
}

// ---- 防御塔：数值 / 放置规则（含基座免间隔）----
{
  const towersMod = await import('../src/data/towers.js');
  const { TOWER_DEF: TDEF, STRUCTURE_DEF: SDEF, STRUCTURE } = towersMod;
  const { StatSet } = await import('../src/systems/stats.js');
  const { World } = await import('../src/world/world.js');
  const { TILE } = await import('../src/core/config.js');
  const { scaleCost } = await import('../src/systems/towers.js');

  const w = new World('frontier-golden-a', {});
  const bx = w.baseSite.x, by = w.baseSite.y;

  // 1) 塔的数值：三档科技水平 × 每座塔
  const towerBuilds = [
    { name: 'fresh', stats: {} },
    { name: 'mid', stats: { towerDamage: 0.8, towerAttackSpeed: 0.5, towerRange: 0.4, towerCap: 4, structureHpMult: 0.5 } },
    { name: 'capped', stats: { towerDamage: 4.0, towerAttackSpeed: 3.0, towerRange: 2.5, towerCap: 20, structureHpMult: 2.0 } },
  ];
  const towerStats = towerBuilds.map(b => {
    const ss = new StatSet();
    ss.add(b.stats);
    const rows = Object.keys(TDEF).map(id => {
      const d = TDEF[id];
      return {
        id,
        hp: f((d.hp || 200) * (1 + (ss.get('structureHpMult') || 0))),
        range: f((d.range || 200) * (1 + (ss.get('towerRange') || 0))),
        dmg: f((d.dmg || 10) * (1 + (ss.get('towerDamage') || 0))),
        dmgLv3: f((d.dmg || 10) * (1 + (ss.get('towerDamage') || 0)) * 1.5),
        cd: f((d.cd || 1) / (1 + (ss.get('towerAttackSpeed') || 0))),
        cost: scaleCost(d.cost, 1.0),
        cap: Math.round(4 + (ss.get('towerCap') || 0)),
      };
    });
    return { name: b.name, stats: b.stats, rows };
  });

  // 2) 放置规则矩阵
  const mkCtx = (opts = {}) => ({
    towers: opts.towers || [],
    structures: opts.structures || [],
    bases: [{ x: bx, y: by, r: 96, destroyed: false, buildRadius: 520 }],
  });
  const probePoints = [];
  for (let gx = -6; gx <= 6; gx++) {
    for (let gy = -6; gy <= 6; gy++) {
      probePoints.push([Math.round(bx + gx * TILE), Math.round(by + gy * TILE)]);
    }
  }
  const CAND = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2]];
  const findPlacement = (ctx, x, y, forTower = true) => {
    const minGap = 44;
    for (const [ox, oy] of CAND) {
      const tx = Math.floor((x + ox * TILE) / TILE);
      const ty = Math.floor((y + oy * TILE) / TILE);
      const px = tx * TILE + TILE / 2, py = ty * TILE + TILE / 2;
      if (w.isBlockedPx(px, py)) continue;
      const onPlatform = ctx.structures.some(s => s.type === 'turretSlot' && s.hp > 0
        && (px - s.x) ** 2 + (py - s.y) ** 2 <= 26 * 26);
      let clash = false;
      if (forTower && !onPlatform) {
        for (const t of ctx.towers) if ((px - t.x) ** 2 + (py - t.y) ** 2 < minGap * minGap) { clash = true; break; }
      }
      if (!clash) for (const s of ctx.structures) {
        if (s.type === 'turretSlot') continue;
        if (s.hp <= 0) continue;
        if ((px - s.x) ** 2 + (py - s.y) ** 2 < 40 * 40) { clash = true; break; }
      }
      if (!clash) for (const b of ctx.bases) {
        if (b.destroyed) continue;
        if ((px - b.x) ** 2 + (py - b.y) ** 2 < (b.r * 0.6) ** 2) { clash = true; break; }
      }
      if (clash) continue;
      if (!ctx.bases.some(b => !b.destroyed && Math.hypot(px - b.x, py - b.y) < b.buildRadius)) continue;
      return { x: px, y: py, onPlatform };
    }
    return null;
  };

  const placeA = probePoints.map(([x, y]) => {
    const r = findPlacement(mkCtx(), x, y);
    return r ? [f(r.x), f(r.y), r.onPlatform ? 1 : 0] : null;
  });
  const slotX = Math.round(bx + 200), slotY = Math.round(by);
  const slot = { type: 'turretSlot', x: slotX, y: slotY, hp: 200 };
  const slot2 = { type: 'turretSlot', x: slotX + TILE, y: slotY, hp: 200 };
  const t1 = { x: slotX, y: slotY, r: 18 };
  const t2 = { x: slotX + TILE, y: slotY, r: 18 };
  const placeB = {
    slot: [slotX, slotY],
    onSlot: (() => { const r = findPlacement(mkCtx({ structures: [slot], towers: [t1] }), slotX, slotY); return r ? [f(r.x), f(r.y), r.onPlatform ? 1 : 0] : null; })(),
    adjacentGround: (() => { const r = findPlacement(mkCtx({ towers: [t2] }), t2.x, t2.y); return r ? [f(r.x), f(r.y), r.onPlatform ? 1 : 0] : null; })(),
    rowOnSlots: (() => { const r = findPlacement(mkCtx({ structures: [slot, slot2], towers: [t1] }), slot2.x, slot2.y); return r ? [f(r.x), f(r.y), r.onPlatform ? 1 : 0] : null; })(),
    structures: [slot, slot2],
    towers: [t1, t2],
  };
  const placeC = (() => {
    const wall = { type: 'wall', x: bx + 120, y: by + 120, hp: 300 };
    const r = findPlacement(mkCtx({ structures: [wall] }), wall.x, wall.y);
    return { wall: [wall.x, wall.y], result: r ? [f(r.x), f(r.y), r.onPlatform ? 1 : 0] : null };
  })();

  golden.cases.towers = {
    seed: 'frontier-golden-a',
    towerStats,
    placement: { probe: probePoints, caseA: placeA, caseB: placeB, caseC: placeC },
    structureIds: Object.keys(SDEF),
    turretSlotId: STRUCTURE.TURRET_SLOT,
  };
}

// ---- 波次导演：预算 / 组成 / 刷怪点四档规则 ----
{
  const { Director } = await import('../src/systems/director.js');
  const { World } = await import('../src/world/world.js');
  const { StatSet } = await import('../src/systems/stats.js');
  const { RNG, rnd } = await import('../src/core/rng.js');
  const { BEACON } = await import('../src/core/config.js');

  // `rnd` 是全局非确定性随机（Math.random）—— 导演里用它选怪/选巢。
  // 要跨语言比对就必须把它换成确定性流：这里用一个 RNG 顶上，
  // Godot 侧同样用 Rng(同种子) 顶上，两边消耗顺序一致即可。
  const patchRnd = (seed) => {
    const r = new RNG(seed);
    const orig = {};
    for (const k of ['next', 'range', 'int', 'chance', 'pick', 'weighted', 'sign']) orig[k] = rnd[k];
    rnd.next = () => r.next();
    rnd.range = (a, b) => r.range(a, b);
    rnd.int = (a, b) => r.int(a, b);
    rnd.chance = (p) => r.chance(p);
    rnd.pick = (arr) => r.pick(arr);
    rnd.weighted = (entries) => r.weighted(entries);
    rnd.sign = () => (r.next() < 0.5 ? -1 : 1);
    return () => Object.assign(rnd, orig);
  };
  void BEACON;

  const buildRun = (seed, beaconLevel) => {
    const w = new World(seed, {});
    const stats = new StatSet();
    const run = {
      world: w, playerStats: stats, planetIndex: 0, isTowerDefense: false,
      player: { x: w.baseSite.x, y: w.baseSite.y },
      base: { x: w.baseSite.x, y: w.baseSite.y, r: 96, destroyed: false, maxHp: 1000, hp: 1000 },
      beacon: {
        x: w.baseSite.x, y: w.baseSite.y, level: beaconLevel,
        // 与 runState.beacon.refresh 同式（level 从 0 起）
        radius: 900 + beaconLevel * 300,
        intensity: Math.min(1.45, 0.28 + beaconLevel * 0.14),
        fuel: 100, fuelMax: 100, online: true, pulse: 0,
      },
      wave: { number: 0, state: 'calm', timer: 30, huntMode: false, huntReason: null, huntTimer: 0, currentId: null, total: 0, remaining: 0, composition: [], contributors: [] },
      stats: { wavesTotal: 0, kills: 0, damageDealt: 0 },
      modeDef: { wave: { source: 'nests', warnSeconds: 22 } },
      playerStats2: null,
      camera: null,
      enemies: [],
      towers: [],
      structures: [],
      bases: [],
      effects: [],
      projectiles: [],
      timers: [],
      addLog() {},
      rng: new RNG(seed + ':run'),
    };
    return run;
  };

  const cases = [];
  for (const [seed, level] of [['wave-a', 1], ['wave-a', 4], ['wave-b', 2]]) {
    const restore = patchRnd(`rnd-${seed}-${level}`);
    const run = buildRun(seed, level);
    const d = new Director(run);
    const info = d.startWave();
    cases.push({
      seed, beaconLevel: level,
      waveNumber: run.wave.number,
      budget: info ? undefined : undefined,
      count: run.wave.composition.length,
      types: run.wave.composition.map(c => c.type),
      nests: run.wave.composition.map(c => c.nest),
      contributors: run.wave.contributors.length,
      fuelAfter: f(run.beacon.fuel),
      interval: f(d.nextInterval()),
      radius: run.beacon.radius,
      intensity: f(run.beacon.intensity),
      total: run.wave.total, remaining: run.wave.remaining,
    });
    restore();
  }

  // 刷怪点四档规则：给一组「巢相对相机」的位置，看落点被怎么处理
  const spawnCases = (() => {
    const restore = patchRnd('rnd-spawn');
    const run = buildRun('wave-a', 3);
    const d = new Director(run);
    const cx = run.baseSite ? 0 : 0;
    void cx;
    const camX = run.world.baseSite.x, camY = run.world.baseSite.y;
    const view = { x0: camX - 640, y0: camY - 360, x1: camX + 640, y1: camY + 360 };
    run.camera = { x: camX, y: camY, viewRect: () => view };
    const viewR = Math.hypot(1280, 720) / 2;
    const standoff = viewR + 90 + 180;
    const mk = (dx, dy) => ({ id: 'n', x: camX + dx, y: camY + dy, r: 44, tier: 3, biome: 0, destroyed: false, threat: 2 });
    const probes = [
      { label: 'screen', nest: mk(200, 100) },          // 屏幕里
      { label: 'far', nest: mk(3000, 500) },            // 很远
      { label: 'edge', nest: mk(800, 0) },              // 屏幕外但很近
      { label: 'edgeDiag', nest: mk(500, 500) },        // 斜向边缘
      { label: 'none', nest: null },                    // 没有巢
    ];
    const out = probes.map(p => {
      const s = d.spawnPoint(p.nest);
      const distFromCam = Math.hypot(s.x - camX, s.y - camY);
      return {
        label: p.label,
        distFromCam: f(distFromCam),
        distFromNest: p.nest ? f(Math.hypot(s.x - p.nest.x, s.y - p.nest.y)) : null,
        x: f(s.x), y: f(s.y),
      };
    });
    restore();
    return { viewR: f(viewR), standoff: f(standoff), out };
  })();

  golden.cases.waves = { cases, spawnCases };
}

// ---- 虫巢副本：规划 / 挖掘结果 / 房间与通道 ----
{
  const { dungeonPlan, carveDungeon } = await import('../src/world/dungeon.js');
  const { World } = await import('../src/world/world.js');
  const { T } = await import('../src/data/tiles.js');
  const hashOne = (arr) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < arr.length; i++) h = Math.imul(h ^ arr[i], 16777619) >>> 0;
    return h >>> 0;
  };
  const cases = [];
  for (const tier of [1, 3, 6, 10]) {
    const plan = dungeonPlan(tier);
    const w = new World('dungeon-golden', {});
    const dug = carveDungeon(w, tier);
    const counts = { wall: 0, floor: 0, organ: 0, other: 0 };
    for (let i = 0; i < w.tiles.length; i++) {
      const t = w.tiles[i];
      if (t === T.NEST_WALL) counts.wall++;
      else if (t === T.NEST_FLOOR) counts.floor++;
      else if (t === T.NEST_ORGAN) counts.organ++;
      else counts.other++;
    }
    const corridor = [];
    const midY = w.dungeon.region.y0 + Math.floor(w.dungeon.region.h / 2);
    for (let x = dug.entry.tx; x <= dug.boss.tx; x += 5) {
      const t = w.tileAt(x, midY);
      corridor.push(t === T.NEST_FLOOR || t === T.NEST_ORGAN ? 1 : 0);
    }
    cases.push({
      tier,
      plan: { chambers: plan.chambers, length: plan.length, wrecks: plan.wrecks, bossScale: f(plan.bossScale) },
      tilesHash: hashOne(w.tiles),
      counts: { wall: counts.wall, floor: counts.floor, organ: counts.organ, other: counts.other },
      entry: [dug.entry.tx, dug.entry.ty],
      playerStart: [dug.playerStart.tx, dug.playerStart.ty],
      boss: [dug.boss.tx, dug.boss.ty],
      // ⚠️ 必须读**实现**（dug.boss.bossHalf），不要再自己推一遍 ——
      // 这里原来硬编码 11/9/7，实现把 Boss 房放大之后 golden 还停在旧值，
      // 结果 Godot 侧照着旧半径算柱子位置，四个角全对不上（断言全红）。
      bossHalf: dug.boss.bossHalf,
      chambers: dug.chambers.map(c => [c.tx, c.ty]),
      region: w.dungeon.region,
      corridor,
      propsCleared: w.props.size === 0 ? 1 : 0,
      nestsCleared: w.nests.length === 0 ? 1 : 0,
      noProps: w.noProps ? 1 : 0,
    });
  }
  golden.cases.dungeon = { cases };
}
// ---- 科技树 / 实验科技 / 装备 ----
{
  const { RunState } = await import('../src/systems/runState.js');
  const { TECH_DEF, TECH_MAP } = await import('../src/data/tech.js');
  const { EXPERIMENTS, poolFor, DIR, EXP_MAP } = await import('../src/data/experiments.js');
  const { scoreItem, itemWeight } = await import('../src/systems/loot.js');
  const { RNG } = await import('../src/core/rng.js');
  const { TOWER_DEF } = await import('../src/data/towers.js');

  // 1) 科技解锁：给定资源与初始已解锁集合，逐个问「能不能解锁」+ 解锁后的状态
  const mkRun = () => {
    const run = new RunState({ seed: 'tech-golden', characterId: 'engineer', planetIndex: 0 });
    run.resources.gold = 5000; run.resources.metal = 2000; run.resources.crystal = 800;
    run.resources.parts = 500; run.resources.tech = 200; run.resources.research = 200;
    run.unlockedTech.clear();
    return run;
  };
  const unlockCases = [];
  {
    const run = mkRun();
    // 先解锁一条链的前置，再看后续能不能开
    const order = ['t_turretSlot', 't_mine1', 't_gunDamage1', 't_gunRate1', 't_lab', 't_deepSpace'];
    for (const id of order) {
      const can = run.unlockTech(id);
      unlockCases.push({
        id,
        can: can ? 1 : 0,
        unlocked: run.unlockedTech.has(id) ? 1 : 0,
        beaconLevel: run.beacon.level,
        gold: Math.round(run.resources.gold),
        statDamage: f(run.playerStats.get('damage')),
        statTowerCap: f(run.playerStats.get('towerCap')),
        unlockedStructures: [...run.player.unlocks.structures].sort(),
      });
    }
    // 重复解锁同一个应当失败
    unlockCases.push({ id: 't_mine1', can: run.unlockTech('t_mine1') ? 1 : 0, unlocked: 1, repeat: 1 });
  }

  // 2) 实验科技：同一种子下抽 4 张候选（验证权重公式 + 抽取顺序）
  const rollCases = [];
  for (const [dirName, dirVal] of [['admin', DIR.ADMIN], ['defense', DIR.DEFENSE], ['explore', DIR.EXPLORE]]) {
    for (const ownedCount of [0, 2]) {
      const rng = new RNG(`exp-${dirName}-${ownedCount}`);
      // 造一个「已持有若干张」的状态：取该方向前 N 张各 2 级
      const owned = {};
      const pool = EXPERIMENTS.filter(e => e.dir === dirVal);
      for (let i = 0; i < ownedCount && i < pool.length; i++) owned[pool[i].id] = 2;
      // 复刻 runState.rollOptions 的抽取过程
      const bag = EXPERIMENTS.filter(e => e.dir === dirVal && (!e.exclusive || e.exclusive === 'engineer'))
        .filter(e => (owned[e.id] || 0) < (e.maxLv || 1));
      const picked = [];
      for (let i = 0; i < 4 && bag.length; i++) {
        const entry = rng.weighted(bag.map(e => {
          const rarityW = { common: 100, rare: 46, epic: 17, legend: 4 }[e.rarity] ?? 50;
          return { e, w: (rarityW * (e.weight / 100)) / (1 + (owned[e.id] || 0) * 0.85) };
        }));
        if (!entry) break;
        picked.push(entry.id);
        bag.splice(bag.indexOf(entry), 1);
      }
      rollCases.push({
        dir: dirName, dirVal, ownedCount, picked,
        weights: pool.slice(0, 3).map(e => ({
          id: e.id,
          w0: f((( { common: 100, rare: 46, epic: 17, legend: 4 }[e.rarity] ?? 50) * (e.weight / 100)) / 1),
          w2: f((( { common: 100, rare: 46, epic: 17, legend: 4 }[e.rarity] ?? 50) * (e.weight / 100)) / (1 + 2 * 0.85)),
        })),
      });
    }
  }
  // 刷新费用曲线
  const refreshCosts = [];
  for (let i = 0; i < 6; i++) {
    refreshCosts.push({ count: i, cost: Math.max(20, Math.round(45 * Math.pow(1.85, i) * 1)) });
  }

  // 3) 装备评分与重量
  const items = [
    { type: 'weapon', rarity: 'common', weaponId: 'pistol' },
    { type: 'weapon', rarity: 'relic', weaponId: 'railgun' },
    { type: 'armor', rarity: 'rare', stats: { armor: 12, hpMax: 40 } },
    { type: 'armor', rarity: 'epic', stats: { damage: 0.15, attackSpeed: 0.1, carryMult: 0.2 } },
  ];
  const itemCases = items.map(it => ({ item: it, score: f(scoreItem(it)), weight: f(itemWeight(it)) }));

  // 4) 已解锁塔列表
  const towerCases = [];
  for (const unlocks of [{ towers: [] }, { towers: ['rail'] }, { towers: ['rail', 'mortar'] }]) {
    const set = new Set(unlocks.towers);
    const list = Object.values(TOWER_DEF).filter(t => {
      if (t.exclusive && t.exclusive !== 'engineer') return false;
      if (!t.requires) return true;
      return set.has(t.id);
    }).map(t => t.id).sort();
    towerCases.push({ unlocks, list });
  }
  void TECH_DEF; void TECH_MAP; void poolFor; void EXP_MAP;

  golden.cases.progression = { unlockCases, rollCases, refreshCosts, itemCases, towerCases };
}
// ---- Boss 技能组 / 状态效果 / 副本守军 ----
{
  const { StatusMath, BossAbilities } = (() => ({
    StatusMath: null, BossAbilities: null,
  }));
  void StatusMath; void BossAbilities;
  const { RNG } = await import('../src/core/rng.js');

  // 1) 技能组参数（与 spawnDungeonBoss 一致）
  const abilityCases = [];
  for (const tier of [1, 4, 8, 10]) {
    const t = tier;
    const abilities = [
      { kind: 'charge', cd: 11 - Math.min(3, t * 0.2), warn: 1.1, dist: 520, halfWidth: 54, dmgMult: 2.2, dashSpeed: 980 },
      { kind: 'barrage', cd: 8.5, count: 7 + Math.floor(t / 2), spread: 1.15, speed: 330, dmgMult: 0.45, waves: 2, waveGap: 0.3 },
      { kind: 'summonAdds', cd: 16, count: Math.min(6, 2 + Math.floor(t / 3)) },
    ];
    const rng = new RNG(`boss-ab-${tier}`);
    const seeded = abilities.map(ab => ({ ...ab, t: rng.range(2.0, ab.cd * 0.55) }));
    abilityCases.push({
      tier,
      abilities: seeded.map(a => ({ ...a, t: f(a.t), cd: f(a.cd) })),
    });
  }

  // 2) Boss 缩放（0.85 + (tier-1)*0.08 再乘层数补偿）
  const bossScaleCases = [];
  for (const P of [0, 2]) {
    for (const tier of [1, 5, 10]) {
      const base = { hp: 1 + (tier - 1) * 0.42 + P * 0.38, dmg: 1 + (tier - 1) * 0.28 + P * 0.30 };
      const extra = 0.85 + (tier - 1) * 0.08;
      const hp = base.hp * extra * (1 + (tier - 1) * 0.22);
      const dmg = base.dmg * extra * (1 + (tier - 1) * 0.12);
      bossScaleCases.push({ P, tier, hp: f(hp), dmg: f(dmg) });
    }
  }

  // 3) 冲撞推进（固定步长，逐帧比对位置与撞击）
  const dashCase = (() => {
    const world = { circleBlocked: () => false, speedAtPx: () => 1 };
    const e = { x: 1000, y: 1000, r: 40, dmg: 100, stun: 0, dash: { x: 1, y: 0, remain: 520, speed: 980, halfWidth: 54, dmg: 220, hit: {} } };
    const player = { x: 1200, y: 1000, take_damage() {} };
    const trace = [];
    let hitPlayerAt = -1;
    for (let i = 0; i < 60; i++) {
      const dt = 1 / 60;
      const d = e.dash;
      if (!d) break;
      const step = Math.min(d.speed * dt, d.remain);
      const nx = e.x + d.x * step;
      const ny = e.y + d.y * step;
      if (world.circleBlocked(nx, ny, e.r * 0.8)) { e.dash = null; e.stun = Math.max(e.stun, 0.5); break; }
      e.x = nx; e.y = ny; d.remain -= step;
      if (hitPlayerAt < 0 && Math.hypot(e.x - player.x, e.y - player.y) < e.r + 13 + 6) hitPlayerAt = i;
      if (d.remain <= 0.5) e.dash = null;
      trace.push([i, f(e.x), f(e.y), f(d.remain)]);
    }
    return { trace, hitPlayerAt, endX: f(e.x), endY: f(e.y) };
  })();

  // 4) 弹幕分波：波数、每波弹数、角度展开
  const barrageCase = (() => {
    const e = { x: 0, y: 0, r: 40, dmg: 100 };
    const ab = { kind: 'barrage', count: 9, spread: 1.15, speed: 330, dmgMult: 0.45, waves: 2, waveGap: 0.3 };
    e.barrage = { base: 0, left: 2, gap: 0.3, timer: 0, count: 9, spread: 1.15, speed: 330, dmgMult: 0.45 };
    const waves = [];
    for (let i = 0; i < 40; i++) {
      const dt = 1 / 60;
      const b = e.barrage;
      if (!b) break;
      b.timer -= dt;
      if (b.timer > 0) continue;
      b.timer = b.gap;
      b.left -= 1;
      const shots = [];
      for (let k = 0; k < b.count; k++) {
        const a = b.base + (k - (b.count - 1) / 2) * (b.spread / b.count) * 2;
        shots.push(f(a));
      }
      waves.push(shots);
      if (b.left <= 0) e.barrage = null;
    }
    return waves;
  })();

  // 5) 状态效果：燃烧/中毒/减速/标记 的逐帧伤害与过期
  const statusCase = (() => {
    const e = { hp: 1000, dead: false, burn: { dps: 12, remain: 2.0, stacks: 2 }, poison: { dps: 5, remain: 1.5, stacks: 1 }, slow: { amount: 0.4, remain: 1.0, stacks: 1 }, marks: 2, markTimer: 3.0 };
    const trace = [];
    for (let i = 0; i < 180; i++) {
      const dt = 1 / 60;
      for (const key of ['burn', 'poison']) {
        const st = e[key];
        if (!st) continue;
        st.remain -= dt;
        e.hp -= st.dps * (st.stacks || 1) * dt;
        if (st.remain <= 0) e[key] = null;
      }
      if (e.slow) { e.slow.remain -= dt; if (e.slow.remain <= 0) e.slow = null; }
      if (e.marks > 0) { e.markTimer -= dt; if (e.markTimer <= 0) e.marks = 0; }
      if (i % 30 === 0 || i === 179) {
        trace.push([i, f(e.hp), e.burn ? 1 : 0, e.poison ? 1 : 0, e.slow ? 1 : 0, e.marks]);
      }
    }
    return { trace, endHp: f(e.hp) };
  })();

  // 6) 副本守军数量（侧室 1~2 只 + 通道 2 + tier/3 只）
  const garrisonCases = [];
  for (const tier of [1, 5, 10]) {
    const chambers = 2 + Math.round((tier - 1) * 0.45);
    const perChamber = tier >= 7 ? 2 : 1;
    const corridor = 2 + Math.floor(tier / 3);
    garrisonCases.push({ tier, chambers, perChamber, corridor, expected: chambers * perChamber + corridor });
  }

  golden.cases.combat = { abilityCases, bossScaleCases, dashCase, barrageCase, statusCase, garrisonCases };
}
// ---- 死亡与复活 ----
{
  const { RunState } = await import('../src/systems/runState.js');
  const cases = [];
  for (const [gold, immunity, baseDestroyed] of [[260, 0, false], [1000, 0, false], [400, 1, false], [260, 0, true]]) {
    // RunState 本身不带 playerSystem（那是 installRun 时装配的），
    // 所以这里只复刻 die() 的结算公式，不去调真实方法
    const run = new RunState({ seed: 'death-golden', characterId: 'engineer', planetIndex: 0 });
    run.resources.gold = gold;
    const before = run.resources.gold;
    let gameOver = false;
    // 直接复刻 die() 的结算（避免依赖事件总线）
    const lost = immunity ? 0 : Math.floor(before * 0.15);
    const after = before - lost;
    if (baseDestroyed) gameOver = true;
    cases.push({
      gold, immunity, baseDestroyed,
      goldAfter: after, lost,
      respawnTimer: baseDestroyed ? 999 : 2.5,
      respawnHpFraction: 0.6,
      invuln: 3,
      gameOver: gameOver ? 1 : 0,
    });
  }
  golden.cases.death = { cases };
}
// ---- 背包排序（UI 里唯一有真实逻辑的部分）----
{
  const { scoreItem, itemWeight } = await import('../src/systems/loot.js');
  const { RARITY_ORDER } = await import('../src/data/weapons.js');
  const SLOT_ORDER = ['weapon', 'helmet', 'chest', 'legs', 'trinket', 'misc'];
  const rank = (it) => RARITY_ORDER.indexOf(it.rarity);
  const sortBag = (items, mode) => {
    const list = [...items];
    switch (mode) {
      case 'type':
        list.sort((a, b) => {
          const ka = SLOT_ORDER.indexOf(a.type === 'weapon' ? 'weapon' : (a.slot || 'misc'));
          const kb = SLOT_ORDER.indexOf(b.type === 'weapon' ? 'weapon' : (b.slot || 'misc'));
          return (ka - kb) || (rank(b) - rank(a));
        });
        break;
      case 'score': list.sort((a, b) => scoreItem(b) - scoreItem(a)); break;
      case 'weight': list.sort((a, b) => itemWeight(b) - itemWeight(a)); break;
      default: list.sort((a, b) => (rank(b) - rank(a)) || (scoreItem(b) - scoreItem(a)));
    }
    return list.map(i => i.id);
  };
  // 一批有重复品质/部位的物品（用来验证「稳定排序」这一点）
  const bag = [];
  const slots = ['helmet', 'chest', 'legs', 'trinket'];
  const rarities = ['common', 'rare', 'common', 'epic', 'rare', 'relic', 'common'];
  for (let i = 0; i < 14; i++) {
    const isWeapon = i % 5 === 0;
    bag.push({
      id: `it${i}`,
      type: isWeapon ? 'weapon' : 'armor',
      slot: isWeapon ? undefined : slots[i % slots.length],
      rarity: rarities[i % rarities.length],
      stats: { armor: (i % 4) * 3, damage: (i % 3) * 0.05, hpMax: (i % 5) * 8 },
      name: `物品${i}`,
    });
  }
  golden.cases.bagSort = {
    bag,
    modes: ['rarity', 'type', 'score', 'weight'].map(m => ({ mode: m, order: sortBag(bag, m) })),
  };
}
// ---- 可采集物：区块惰性生成 / 类型分布 / 采集产出 ----
{
  const { World } = await import('../src/world/world.js');
  const { PROP_DEF } = await import('../src/data/tiles.js');
  const w = new World('props-golden', { nestScale: 0.3, poiScale: 0.3 });

  // 生成一片区块，统计类型分布（验证 _pickPropType 的池与稀有度）
  for (let cx = 0; cx < 8; cx++) {
    for (let cy = 0; cy < 8; cy++) w.ensureChunksAround(3000 + cx * 200, 3000 + cy * 200, 400);
  }
  const counts = {};
  for (const p of w.props.values()) counts[p.type] = (counts[p.type] || 0) + 1;
  const sortedTypes = Object.keys(counts).sort();

  // 精确复刻一个区块的全部 prop（逐字段），验证随机数消耗顺序
  const w2 = new World('props-golden', { nestScale: 0.3, poiScale: 0.3 });
  w2.ensureChunksAround(3000, 3000, 400);
  const chunkList = [...w2.chunks.keys()].sort().slice(0, 6);
  const chunkProps = [];
  for (const key of chunkList) {
    const ch = w2.chunks.get(key);
    const rows = ch.props.map(id => w2.props.get(id)).filter(Boolean).map(p => ({
      id: p.id, type: p.type, x: f(p.x), y: f(p.y), r: f(p.r), hp: f(p.hp),
      variant: f(p.variant), scale: f(p.scale),
    }));
    chunkProps.push({ key, rows });
  }

  // 采集：dps 与分块（工具匹配 / 不匹配）
  const harvest = [];
  for (const type of ['fiberBush', 'ironNode', 'sporeTree', 'crystalNode']) {
    const def = PROP_DEF[type];
    const want = def.tool;
    for (const [tag, mineSpeed] of [['pick', 0], ['pick', 0.5], ['axe', 0], [null, 0.25]]) {
      let dps = 26 * (1 + mineSpeed);
      if (want) dps *= (tag === want ? 1.8 : 0.55);
      let total = 0;
      for (const [, [lo, hi]] of Object.entries(def.yield || {})) total += (lo + hi) / 2;
      harvest.push({
        type, tag, mineSpeed, dps: f(dps),
        chips: Math.max(2, Math.round(total / 4)),
        respawn: def.respawn,
        hp: def.hp,
      });
    }
  }

  golden.cases.props = {
    counts,
    sortedTypes,
    chunkProps,
    harvest,
    totalProps: w.props.size,
  };
}
// ---- 载具 ----
{
  const { VEHICLE } = await import('../src/core/config.js');
  const { StatSet } = await import('../src/systems/stats.js');
  const cases = [];
  for (const [name, mods] of [
    ['stock', {}],
    ['tuned', { vehicleSpeedMult: 0.25, vehicleHpMult: 0.5, fuelMult: -0.3, cargoBonus: 8, ramMult: 0.5, vehicleTurretCap: 1, fuelRegen: 0.4, terrainIgnore: 1 }],
  ]) {
    const ss = new StatSet();
    ss.add(mods);
    const speed = VEHICLE.baseSpeed * (1 + (ss.get('vehicleSpeedMult') || 0));
    const boost = speed * VEHICLE.boostMult;
    const hp = 420 * (1 + (ss.get('vehicleHpMult') || 0));
    const cargo = VEHICLE.cargoBase + (ss.get('cargoBonus') || 0);
    const fuelMult = 1 + (ss.get('fuelMult') || 0);
    const turretCap = Math.min(VEHICLE.maxTurrets, 2 + Math.round(ss.get('vehicleTurretCap') || 0));
    // 燃料消耗：地形 1.0 / 0.6 两档
    const fuelUse = (terrain) => {
      let mult = fuelMult;
      if (!(ss.get('terrainIgnore') > 0)) mult *= 1 / Math.max(0.5, terrain);
      return VEHICLE.fuelPerSec * mult;
    };
    cases.push({
      name, mods,
      speed: f(speed), boost: f(boost), hp: f(hp), cargo: f(cargo),
      turretCap,
      ram: f(VEHICLE.collisionDamage * (1 + (ss.get('ramMult') || 0))),
      ramCooldown: VEHICLE.collisionCooldown,
      fuelPerSecTerrain1: f(fuelUse(1.0)),
      fuelPerSecTerrain06: f(fuelUse(0.6)),
      maxTurrets: VEHICLE.maxTurrets,
      maxMeleeModules: VEHICLE.maxMeleeModules,
      fuelMax: VEHICLE.fuelMax,
    });
  }
  // 燃料耗尽：从满油按每秒消耗跑多久
  const drain = [];
  {
    const perSec = VEHICLE.fuelPerSec;
    let fuel = VEHICLE.fuelMax;
    let t = 0;
    for (let i = 0; i < 400 && fuel > 0; i++) { fuel -= perSec * 0.5; t += 0.5; }
    drain.push({ perSec: f(perSec), seconds: f(t), endFuel: f(Math.max(0, fuel)) });
  }
  golden.cases.vehicle = { cases, drain };
}
// ---- 城镇：人口增长 / 档位 / 解锁累积 / 生产 ----
{
  const { POP_TIERS, TOWN_BUILDING_DEF } = await import('../src/data/planets.js');
  const { StatSet } = await import('../src/systems/stats.js');

  // 每个档位的门槛与解锁（逐项）
  const tiers = POP_TIERS.map(t => ({ pop: t.pop, name: t.name, unlock: t.unlock }));

  // 解锁累积：把人口抬到某档，看哪些建筑可建
  const unlockedCases = [];
  const tickUnlocks = { farm: 't_farm', clinic: 't_clinic', lab: 't_lab', market: 't_trade' };
  for (const [pop, techs] of [[0, []], [6, []], [16, []], [30, []], [80, []], [16, ['t_lab']]]) {
    const canBuild = {};
    for (const type of Object.keys(TOWN_BUILDING_DEF)) {
      let ok = false;
      for (const t of POP_TIERS) {
        if (pop < t.pop) break;
        if (t.unlock.includes(type)) { ok = true; break; }
      }
      if (!ok && tickUnlocks[type] && techs.includes(tickUnlocks[type])) ok = true;
      if (!ok && ['hab', 'water'].includes(type)) ok = true;
      canBuild[type] = ok ? 1 : 0;
    }
    unlockedCases.push({ pop, techs, canBuild });
  }

  // 人口增长：**直接驱动真实的 TownSystem.updatePopulation**。
  //
  // ⚠️ 这里原本是我手写复刻的循环，结果和 town.js 的真实实现不一致
  //（真实实现断粮时会 `return`，我手写的那版没有）—— 黄金值于是记录了一个
  // 「游戏里根本不会发生」的行为。教训同前：**脚手架必须调用实现本身**。
  const { TownSystem } = await import('../src/systems/town.js');
  const growthCases = [];
  for (const [buildings, food, planetIndex] of [
    [['hab'], 0, 0],
    [['hab'], 200, 0],
    [['hab', 'hab', 'entertain'], 400, 1],
  ]) {
    const ss = new StatSet();
    const run = {
      playerStats: ss,
      population: 0,
      resources: { food },
      planetIndex,
      bases: [{ x: 0, y: 0, destroyed: false }],
      townBuildings: buildings.map((t, i) => ({ id: 'tb' + i, type: t, x: 0, y: 0, workers: 0, hp: 300, maxHp: 300 })),
      _starving: 0,
      _popAccum: 0,
      addLog() {},
    };
    const sys = new TownSystem(run);
    const popCap = sys.popCap;   // 直接读真实的 getter（它含 4 点基础容量与基地保护）
    const trace = [];
    for (let i = 0; i < 600; i++) {
      sys.updatePopulation(1.0);
      if ((i + 1) % 120 === 0) trace.push([i + 1, run.population, f(run.resources.food)]);
    }
    growthCases.push({
      buildings, food, planetIndex, popCap, trace,
      endPop: run.population, endFood: f(run.resources.food),
      starving: f(run._starving || 0),
    });
  }

  // 生产：每名工人每秒
  const prodCases = [];
  for (const [type, workers, eff] of [['farm', 3, 0], ['farm', 3, 0.5], ['water', 2, 0], ['mine', 4, 0.25]]) {
    const def = TOWN_BUILDING_DEF[type];
    if (!def) continue;
    const out = {};
    for (const [k, v] of Object.entries(def.produce || {})) out[k] = f(v * workers * (1 + eff));
    prodCases.push({ type, workers, eff, out });
  }

  golden.cases.town = { tiers, unlockedCases, growthCases, prodCases };
}
// ---- 制造（交易/装备产出）----
{
  const { CRAFT_TIERS, CRAFT_WEAPONS, CRAFT_ARMOR, craftCost, canCraftRarity, craftTier, craftLevelFor } = await import('../src/data/crafting.js');
  const tiers = CRAFT_TIERS.map(t => ({ id: t.id, name: t.name, rarity: t.rarity, pop: t.pop, costMult: t.costMult }));
  // 每个制造等级下能造什么品质
  const rarityCases = [];
  for (const lv of [0, 1, 2, 3, 4]) {
    const can = {};
    for (const r of ['common', 'uncommon', 'rare', 'epic', 'relic']) can[r] = canCraftRarity(r, lv) ? 1 : 0;
    rarityCases.push({ lv, can, tierRarity: craftTier(lv).rarity, tierName: craftTier(lv).name });
  }
  // 造价：若干件物品 × 品质
  const costCases = [];
  const picks = [CRAFT_WEAPONS[0], CRAFT_WEAPONS[CRAFT_WEAPONS.length - 1], CRAFT_ARMOR[0], CRAFT_ARMOR[CRAFT_ARMOR.length - 1]].filter(Boolean);
  for (const entry of picks) {
    for (const r of ['common', 'uncommon', 'rare', 'epic']) {
      costCases.push({ id: entry.id, tier: entry.tier || 0, rarity: r, cost: craftCost(entry, r, 3) });
    }
  }
  // 城镇档位 → 制造等级
  const levelCases = [];
  for (let i = 0; i < 6; i++) levelCases.push({ popTierIndex: i, craftLv: craftLevelFor(i) });
  golden.cases.crafting = {
    tiers, rarityCases, costCases, levelCases,
    weaponCount: CRAFT_WEAPONS.length, armorCount: CRAFT_ARMOR.length,
  };
}
// ---- 手柄映射与阈值 ----
{
  // 与 gamepad.js 的两张表逐项对照（按钮索引 / 动作名 / 开关类 / 按住类 / 鼠标类）
  const combat = [
    { button: 7, action: 'fire', mouse: true, toggle: false, hold: false, label: '开火' },
    { button: 0, action: 'interact', mouse: false, toggle: false, hold: true, label: '采集/交互' },
    { button: 1, action: 'dodge', mouse: false, toggle: true, hold: false, label: '闪避' },
    { button: 2, action: 'attackAlt', mouse: true, toggle: false, hold: false, label: '攻击' },
    { button: 3, action: 'build', mouse: false, toggle: true, hold: false, label: '建造' },
    { button: 6, action: 'reload', mouse: false, toggle: true, hold: false, label: '装填' },
    { button: 5, action: 'sprint', mouse: false, toggle: false, hold: true, label: '冲刺' },
    { button: 14, action: 'prevWeapon', mouse: false, toggle: true, hold: false, label: '上一把武器' },
    { button: 15, action: 'nextWeapon', mouse: false, toggle: true, hold: false, label: '下一把武器' },
    { button: 10, action: 'swapWeapon', mouse: false, toggle: true, hold: false, label: '切换武器' },
    { button: 11, action: 'takeover', mouse: false, toggle: true, hold: false, label: '接管炮塔' },
    { button: 9, action: 'pause', mouse: false, toggle: true, hold: false, label: '暂停' },
  ];
  const ui = [
    { button: 0, action: 'uiAccept' }, { button: 1, action: 'uiBack' },
    { button: 4, action: 'uiTabPrev' }, { button: 5, action: 'uiTabNext' },
    { button: 12, action: 'uiUp' }, { button: 13, action: 'uiDown' },
    { button: 14, action: 'uiLeft' }, { button: 15, action: 'uiRight' },
  ];
  // 死区：与 JS 同式（死区内归零，之后按 (mag-dead)/(1-dead) 归一）
  const dead = 0.18;
  const dz = (x, y) => {
    const mag = Math.hypot(x, y);
    if (mag < dead) return [0, 0];
    const scale = ((mag - dead) / (1 - dead)) / mag;
    return [f(x * scale), f(y * scale)];
  };
  const deadzoneCases = [];
  for (const [x, y] of [[0, 0], [0.1, 0], [0.17, 0.05], [0.5, 0], [0, -0.5], [0.8, 0.6], [1, 1]]) {
    deadzoneCases.push({ x, y, out: dz(x, y) });
  }
  golden.cases.gamepad = {
    combat, ui,
    deadzone: dead, triggerThreshold: 0.35, aimThreshold: 0.28, backLongPress: 0.6,
    deadzoneCases,
  };
}
// ---- 模式系统（开拓 / 纯塔防）----
{
  const { MODE_DEF, MODE_LIST } = await import('../src/data/modes.js');
  const modes = MODE_LIST.map(id => {
    const d = MODE_DEF[id];
    return {
      id,
      name: d.name, short: d.short, hasPlayer: d.hasPlayer ? 1 : 0,
      nestScale: d.world.nestScale, poiScale: d.world.poiScale,
      compact: d.world.compact ? 1 : 0, landingSites: d.world.landingSites,
      waveSource: d.wave.source, warnSeconds: d.wave.warnSeconds, prepSeconds: d.wave.prepSeconds,
      endCondition: d.endCondition, fieldRadius: d.fieldRadius,
      startResources: d.startResources,
    };
  });
  // 建造半径：塔防 = 阵地半径；开拓 = 基地 520
  const buildRadius = [
    { mode: 'frontier', base: 520, radius: 520 },
    { mode: 'towerDefense', base: 520, radius: MODE_DEF.towerDefense.fieldRadius },
  ];
  // 波次间隔：两种模式各自的公式
  const intervalCases = [];
  for (const [mode, wave, nestsAlive, nestsTotal] of [
    ['frontier', 3, 40, 40], ['frontier', 3, 10, 40], ['frontier', 3, 0, 40],
    ['towerDefense', 1, 0, 0], ['towerDefense', 10, 0, 0], ['towerDefense', 30, 0, 0],
  ]) {
    const base = 150, min = 66;
    let v;
    if (mode === 'towerDefense') {
      const shrink = Math.min(0.45, wave * 0.02);
      v = Math.max(min, Math.min(base, base * (1 - shrink)));
    } else {
      const nestFactor = Math.max(0, Math.min(1, nestsAlive / Math.max(1, nestsTotal)));
      v = Math.max(min, Math.min(base * 1.4, base * (0.6 + nestFactor * 0.55)));
    }
    intervalCases.push({ mode, wave, nestsAlive, nestsTotal, interval: f(v) });
  }
  // autoCollect：塔防模式白送
  const featureCases = [
    { mode: 'frontier', unlocks: [], feature: 'autoCollect', has: 0 },
    { mode: 'frontier', unlocks: ['autoCollect'], feature: 'autoCollect', has: 1 },
    { mode: 'towerDefense', unlocks: [], feature: 'autoCollect', has: 1 },
    { mode: 'towerDefense', unlocks: [], feature: 'turretTakeover', has: 0 },
  ];
  golden.cases.modes = { modes, buildRadius, intervalCases, featureCases };
}
// ---- 四角色 × 三星球矩阵 ----
{
  const { CHAR_DEF, CHAR_LIST } = await import('../src/data/characters.js');
  const { World } = await import('../src/world/world.js');
  const cases = [];
  for (const cid of CHAR_LIST) {
    const def = CHAR_DEF[cid];
    for (const planet of [0, 1, 2]) {
      const w = new World(`matrix-${cid}-${planet}`, { planetIndex: planet, nestScale: 0.4, poiScale: 0.4 });
      // 该角色在某星球上的关键值
      cases.push({
        char: cid, name: def.name, planet,
        hp: def.base.hp, damage: def.base.damage, armor: def.base.armor,
        towerCostMult: def.passive.towerCostMult ?? 1,
        towerCapBonus: def.passive.towerCapBonus ?? 0,
        meleeMult: def.passive.meleeMult ?? 1,
        vehicleSlots: def.passive.vehicleSlots ?? 1,
        geneSlots: def.passive.geneSlots ?? 0,
        nests: w.nests.length,
        pois: w.pois.length,
        // 世界哈希（同种子不同星球必须不同）
        tilesHash: (() => { let h = 2166136261 >>> 0; for (let i = 0; i < w.tiles.length; i += 7) h = Math.imul(h ^ w.tiles[i], 16777619) >>> 0; return h >>> 0; })(),
        // 该星球第 3 层怪的缩放
        scaleHp: f(1 + (3 - 1) * 0.42 + planet * 0.38),
        scaleDmg: f(1 + (3 - 1) * 0.28 + planet * 0.30),
      });
    }
  }
  golden.cases.matrix = { cases, charCount: CHAR_LIST.length };
}
// ---- 手感回归：移动/冲刺/闪避的逐帧轨迹 ----
{
  const { PLAYER } = await import('../src/core/config.js');
  const { StatSet } = await import('../src/systems/stats.js');
  // 与 player.js 的 updateMove 同式（速度 = base × (1+speedMult) × 冲刺 × 狂暴 × 负重 × 地形）
  const speedFor = (stats, sprinting, terrain, frenzy, carryUsed, carryMax) => {
    let speed = PLAYER.baseSpeed * (1 + stats.get('speedMult'));
    if (sprinting) speed *= PLAYER.sprintMult;
    if (frenzy) speed *= 1 + stats.get('killFrenzySpeed');
    const load = carryUsed / Math.max(1, carryMax);
    if (load > 0.9) speed *= Math.max(0.55, Math.min(1, 1 - (load - 0.9) * 1.2));
    return speed * terrain;
  };
  const cases = [];
  for (const [name, mods, sprinting, terrain, frenzy, carry] of [
    ['walk', {}, false, 1.0, false, 0],
    ['sprint', {}, true, 1.0, false, 0],
    ['terrain0.7', {}, false, 0.7, false, 0],
    ['loaded', {}, false, 1.0, false, 23.5],
    ['frenzy+speed', { speedMult: 0.2, killFrenzySpeed: 0.25 }, true, 1.0, true, 0],
  ]) {
    const ss = new StatSet(); ss.add(mods);
    const v = speedFor(ss, sprinting, terrain, frenzy, carry, 24);
    // 逐帧轨迹：沿 +x 走 60 帧
    const trail = [];
    let x = 0, stamina = PLAYER.staminaMax;
    for (let i = 0; i < 60; i++) {
      const dt = 1 / 60;
      const wantSprint = sprinting && stamina > 1;
      stamina = wantSprint ? Math.max(0, stamina - PLAYER.sprintCost * dt)
        : Math.min(PLAYER.staminaMax, stamina + PLAYER.staminaRegen * dt);
      x += v * dt;
      if (i % 15 === 14) trail.push([i + 1, f(x), f(stamina)]);
    }
    cases.push({ name, speed: f(v), trail });
  }
  // 闪避：560 速度、0.19 秒 → 位移应该是 560×0.19；冷却 0.85、无敌帧 0.28
  const dodgeTrail = [];
  {
    let t = 0, moved = 0, remain = PLAYER.dodgeTime;
    const dt = 1 / 60;
    for (let i = 0; i < 12; i++) {
      const step = Math.min(dt, remain);
      moved += PLAYER.dodgeSpeed * step;
      remain = Math.max(0, remain - dt);
      t += dt;
      if (i % 3 === 2) dodgeTrail.push([i + 1, f(moved), f(remain)]);
    }
  }
  golden.cases.feel = {
    cfg: { baseSpeed: PLAYER.baseSpeed, sprintMult: PLAYER.sprintMult, dodgeSpeed: PLAYER.dodgeSpeed,
      dodgeTime: PLAYER.dodgeTime, dodgeCooldown: PLAYER.dodgeCooldown, dodgeIFrames: PLAYER.dodgeIFrames,
      staminaMax: PLAYER.staminaMax, staminaRegen: PLAYER.staminaRegen, sprintCost: PLAYER.sprintCost,
      dodgeCost: PLAYER.dodgeCost },
    cases,
    dodgeDistance: f(PLAYER.dodgeSpeed * PLAYER.dodgeTime),
    dodgeTrail,
  };
}
// ---- 射击几何（手感回归第二刀）----
{
  const { WEAPON_DEF } = await import('../src/data/weapons.js');
  const { StatSet } = await import('../src/systems/stats.js');
  const shots = [];
  // 三种武器 × 三种弹道条数：比对「射击计划」的结构（散布取 0，把随机性拿掉）
  for (const wid of ['pistol', 'smg', 'shotgun']) {
    const def = WEAPON_DEF[wid];
    if (!def) continue;
    for (const projectiles of [0, 1, 2]) {
      const ss = new StatSet();
      ss.add({ projectiles });
      const barrels = Math.min(3, 1 + Math.round(ss.get('projectiles')));
      const step = barrels > 1 ? 0.075 : 0;
      const offsets = [];
      for (let b = 0; b < barrels; b++) offsets.push(f((b - (barrels - 1) / 2) * step));
      const pellets = def.pellets || 1;
      const speed = def.speed || 800;
      const dmgMult = Math.min(1 + 2.0, 1 + ss.get('damage'));
      const range = (def.range || 0) * Math.min(1 + 2.0, 1 + ss.get('rangeMult'));
      shots.push({
        weapon: wid, projectiles, barrels, offsets, pellets,
        spread: def.spread || 0,
        muzzle: 18,
        r: def.subtype === 'gun' ? 4 : 6,
        life: f((range / speed) * 1.15),
        pierce: (def.pierce || 0) + Math.round(ss.get('pierce')),
        ammoPerShot: Math.max(1, Math.round((def.ammoPerShot || 1))) * barrels,
        count: barrels * pellets,
        dmgMult: f(dmgMult),
      });
    }
  }
  golden.cases.gunplay = { shots, barrelStep: 0.075, muzzleDist: 18, lifeFactor: 1.15, maxBarrels: 3 };
}
// ---- 相机跟随 / 震屏 / 边界钳制（手感回归第三刀）----
{
  const LERP = 12, ZOOM_LERP = 6, SHAKE_TIME = 0.32;
  // ① 跟随：从 (0,0) 追 (1000,600)，记录逐帧位置（指数收敛）
  const followTrail = [];
  {
    let x = 0, y = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) {
      const t = 1 - Math.exp(-LERP * dt);
      x = x + (1000 - x) * t;
      y = y + (600 - y) * t;
      if ((i + 1) % 15 === 0) followTrail.push([i + 1, f(x), f(y)]);
    }
  }
  // ② 震屏：mag=10、time=0.32 → 每帧 k = max(0, remain)*mag
  const shakeTrail = [];
  {
    let remain = SHAKE_TIME, mag = 10;
    const dt = 1 / 60;
    for (let i = 0; i < 24; i++) {
      remain -= dt;
      const k = Math.max(0, remain) * mag;
      if ((i + 1) % 6 === 0) shakeTrail.push([i + 1, f(k), remain > 0 ? 1 : 0]);
      if (remain <= 0) { mag = 0; break; }
    }
  }
  // ③ 边界钳制：世界 4000×3000，视野 1280×720
  const clampCases = [];
  for (const [x, y] of [[0, 0], [2000, 1500], [4000, 3000], [-500, -500]]) {
    const hw = 1280 / 2, hh = 720 / 2;
    const cx = 4000 <= hw * 2 ? 2000 : Math.max(hw, Math.min(4000 - hw, x));
    const cy = 3000 <= hh * 2 ? 1500 : Math.max(hh, Math.min(3000 - hh, y));
    clampCases.push({ in: [x, y], out: [f(cx), f(cy)] });
  }
  golden.cases.camera = {
    followLerp: LERP, zoomLerp: ZOOM_LERP, shakeTime: SHAKE_TIME,
    followTrail, shakeTrail, clampCases,
    bounds: [4000, 3000], view: [1280, 720],
  };
}
// ---- 维修 / 重建（手感回归第五刀）----
{
  const { BASE } = await import('../src/core/config.js');
  const { StatSet } = await import('../src/systems/stats.js');
  // ① 维修：速率 30/s、花费 0.28/点（再乘两个倍率）
  const repairCases = [];
  for (const [dt, hp, maxHp, metal, mods] of [
    [1 / 60, 100, 300, 1000, {}],
    [0.5, 100, 300, 1000, {}],
    [1.0, 100, 300, 1000, { repairMult: 0.5 }],
    [1.0, 100, 300, 0.001, {}],
    [1.0, 299.9, 300, 1000, {}],
    [1.0, 300, 300, 1000, {}],
  ]) {
    const ss = new StatSet(); ss.add(mods);
    const rate = 30 * (1 + ss.get('repairMult'));
    const cph = 0.28 * (1 + ss.get('repairCostMult')) * (1 + ss.get('buildCostMult'));
    const heal = Math.min(rate * dt, maxHp - hp);
    const cost = heal * cph;
    const ok = metal >= cost && hp < maxHp;
    const hpAfter = ok ? Math.min(maxHp, hp + heal) : hp;
    repairCases.push({ dt: f(dt), hp, maxHp, metal, mods, heal: f(heal), cost: f(cost),
      ok: ok ? 1 : 0, hpAfter: f(hpAfter), metalAfter: f(ok ? metal - cost : metal) });
  }
  // ② 该修哪个：score = 距离 + 血量比×40
  const targets = [
    { id: 'nearFull', x: 20, y: 0, hp: 90, maxHp: 100 },
    { id: 'nearBroken', x: 30, y: 0, hp: 10, maxHp: 100 },
    { id: 'farBroken', x: 60, y: 0, hp: 1, maxHp: 100 },
    { id: 'outOfRange', x: 200, y: 0, hp: 5, maxHp: 100 },
    { id: 'full', x: 10, y: 0, hp: 100, maxHp: 100 },
  ];
  const scores = targets.map(t => ({ id: t.id, score: f(Math.hypot(t.x, t.y) + (t.hp / t.maxHp) * 40) }));
  // ③ 基地重建：每次点击 +0.55，随时间 +dt/12
  const rebuildTrail = [];
  {
    let progress = 0, taps = 0;
    for (let i = 0; i < 20; i++) {
      const tapped = i % 4 === 0;
      if (tapped) taps++;
      progress += (1 / 60) / BASE.rebuildTime + (tapped ? BASE.rebuildPerTap : 0);
      rebuildTrail.push([i + 1, f(Math.min(1, progress)), taps]);
      if (progress >= 1) break;
    }
  }
  golden.cases.repair = {
    repairCases, scores, rebuildTrail,
    baseRebuildTime: BASE.rebuildTime, baseRebuildPerTap: BASE.rebuildPerTap,
    baseRepairRate: BASE.repairRate, baseRepairCostPerHp: BASE.repairCostPerHp,
    baseMaxHp: BASE.maxHp, baseHpPerLevel: BASE.hpPerLevel,
  };
}
writeFileSync(join(OUT, 'golden.json'), JSON.stringify(golden, null, 2) + '\n', 'utf8');
const n = Object.values(golden.cases).reduce((a, v) => a + (Array.isArray(v) ? v.length : 1), 0);
console.log(`✅ 黄金值已写入 godot/tests/golden.json（${Object.keys(golden.cases).length} 组 / ${n} 用例）`);
