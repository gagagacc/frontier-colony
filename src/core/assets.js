/**
 * 素材管理（可选层）。
 *
 * 设计目标：**有素材就更好看，没有素材也能玩**。
 *
 * 这个项目一直是纯程序化图形（零外部文件），但以后要接 CC0 素材包
 * （见 assets/ASSETS.md 与 ASSETS-RICH.md）。直接改成「必须有图」会让
 * 缺一个文件就整块画不出来；所以这里做成可选层：
 *
 *   - `assets/manifest.json` 描述「逻辑名 -> 文件路径」；
 *   - 文件存在就加载，画的时候优先用贴图；
 *   - 文件不存在 / 加载失败 / 在浏览器里没放素材，就**静默回退**到程序化绘制。
 *
 * 于是「接素材」这件事变成纯增量的：往 assets/ 里丢文件 + 改 manifest，
 * 不需要动任何游戏逻辑，也不会因为漏了某个文件而崩。
 *
 * 用法：
 *   const assets = new AssetManager();
 *   await assets.load();                 // 加载 manifest 里存在的文件
 *   assets.img('terrain.grass')          // -> HTMLImageElement | null
 *   assets.has('terrain.grass')          // -> boolean
 */

/**
 * manifest 的结构（assets/manifest.json）：
 * {
 *   "pack": "kenney-tower-defense",
 *   "license": "CC0",
 *   "entries": {
 *     "terrain.grass":  "tiles/grass.png",
 *     "tower.sentry":   "towers/sentry.png",
 *     "enemy.grub":     "enemies/grub.png",
 *     "ui.panel":       "ui/panel.png"
 *   }
 * }
 *
 * 逻辑名的前缀约定（和 renderer 里的 draw* 函数对应）：
 *   terrain.*  -> drawTerrain / drawTileDetail
 *   prop.*     -> drawPropShape
 *   enemy.*    -> drawEnemyBody
 *   tower.*    -> drawTower
 *   vehicle.*  -> drawVehicle
 *   ui.*       -> HUD 与面板（DOM 侧用 CSS background-image）
 *   fx.*       -> 爆炸/枪口火焰等贴图序列
 */
/**
 * 地块 ID -> 素材名。
 *
 * 命名遵循 `assets/ASSETS.md` §11.3 已经定下的约定：`tile.terrain.<名字>`。
 * 这里放一张映射表，而不是往每个 TILE_DEF 上加字段 —— 素材命名是「接入层」的事，
 * 不该渗进地形数据本身。
 */
export const TILE_ASSET_NAME = {
  0: 'void',
  1: 'regolith',
  2: 'grass',
  3: 'sand',
  4: 'ash',
  5: 'rock',
  6: 'mountain',
  7: 'water',
  8: 'shallow',
  9: 'crystal',
  10: 'fungus',
  11: 'ice',
  12: 'road',
  13: 'concrete',
  14: 'scorched',
  15: 'swamp',
  16: 'nest-wall',
  17: 'nest-floor',
  18: 'nest-organ',
};

export class AssetManager {
  constructor(basePath = 'assets/') {
    this.base = basePath;
    this.manifest = { entries: {} };
    this.images = new Map();       // 逻辑名 -> HTMLImageElement
    this.failed = new Set();       // 加载失败的名字（避免反复重试）
    this.loaded = false;
    this.pack = null;
    this.license = null;
  }

  /** 读取 manifest 并预加载所有能加载的图。任何失败都不抛错。 */
  async load() {
    if (typeof Image === 'undefined') { this.loaded = true; return this; }
    try {
      const res = await fetch(this.base + 'manifest.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.manifest = data || { entries: {} };
      this.pack = data?.pack || null;
      this.license = data?.license || null;
    } catch {
      // 没有 manifest 是最常见的情况（还没接素材），直接当空表
      this.loaded = true;
      return this;
    }

    const tasks = [];
    for (const [name, rel] of Object.entries(this.manifest.entries || {})) {
      tasks.push(this._loadOne(name, rel));
    }
    await Promise.all(tasks);
    this.loaded = true;
    if (this.images.size) {
      console.log(`[assets] 已加载 ${this.images.size} 个素材（${this.pack || '未命名'} · ${this.license || '许可未知'}）`);
    }
    return this;
  }

  _loadOne(name, rel) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { this.images.set(name, img); resolve(true); };
      img.onerror = () => { this.failed.add(name); resolve(false); };
      img.src = this.base + rel;
    });
  }

  /** 取一张贴图；没有就返回 null（调用方回退到程序化绘制） */
  img(name) {
    return this.images.get(name) || null;
  }

  has(name) {
    return this.images.has(name);
  }

  /** 试一组名字，返回第一个存在的（方便做「多套素材只接一套」的兼容） */
  first(names) {
    for (const n of names) {
      const im = this.img(n);
      if (im) return im;
    }
    return null;
  }

  /**
   * 取某类地块的贴图。
   * 主用 ASSETS.md 定的 `tile.terrain.<名字>`，同时兼容简写 `terrain.<id>`，
   * 这样按文档接素材和按直觉接素材都能生效。
   */
  tileTexture(tileId) {
    const name = TILE_ASSET_NAME[tileId];
    if (name) {
      const im = this.first([`tile.terrain.${name}`, `terrain.${name}`, `terrain.${tileId}`]);
      if (im) return im;
    }
    return this.img(`terrain.${tileId}`);
  }

  /** 取可采集物的贴图（`prop.<type>`） */
  propTexture(type) {
    return this.first([`prop.${type}`, `tile.prop.${type}`]);
  }

  /** 取怪物的贴图（`enemy.<type>` / `unit.enemy.<type>`） */
  enemyTexture(type) {
    return this.first([`enemy.${type}`, `unit.enemy.${type}`]);
  }

  /** 取防御塔的贴图（`tower.<id>`） */
  towerTexture(id) {
    return this.first([`tower.${id}`, `bld.tower.${id}`]);
  }

  /** 画一张居中的贴图（按目标像素尺寸缩放） */
  draw(ctx, name, x, y, w, h) {
    const im = this.img(name);
    if (!im) return false;
    ctx.drawImage(im, x - w / 2, y - h / 2, w, h);
    return true;
  }

  /** 画精灵图里的某一帧（横向排列） */
  drawFrame(ctx, name, frame, x, y, w, h) {
    const im = this.img(name);
    if (!im) return false;
    const count = Math.max(1, Math.round(im.width / h));
    const f = ((frame % count) + count) % count;
    ctx.drawImage(im, f * h, 0, h, h, x - w / 2, y - h / 2, w, h);
    return true;
  }

  get size() { return this.images.size; }
}
