/**
 * 值噪声 + 分形叠加 + 细胞噪声（都基于可复现的整数哈希）。
 * 用途：地形高程、湿度、生物群系划分、巢穴分布、矿区成簇。
 */

import { lerp, hashStr } from './math.js';

function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** 可复现的 2D 值噪声，输出 [0,1] */
export class ValueNoise {
  constructor(seed = 1) {
    this.seed = typeof seed === 'string' ? hashStr(seed) : (seed >>> 0) || 1;
  }

  at(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = fade(xf), v = fade(yf);
    const s = this.seed;
    const a = hash2(xi, yi, s);
    const b = hash2(xi + 1, yi, s);
    const c = hash2(xi, yi + 1, s);
    const d = hash2(xi + 1, yi + 1, s);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }

  /** 分形叠加，输出约 [0,1] */
  fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.at(x * freq + i * 37.7, y * freq - i * 19.3);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** 脊状噪声：适合做山脉/峡谷 */
  ridged(x, y, octaves = 4) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.at(x * freq + i * 11.1, y * freq + i * 7.7) * 2 - 1);
      sum += amp * n * n;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  /** 域扭曲：让地形看起来更有机 */
  warped(x, y, strength = 0.35, octaves = 4) {
    const wx = this.fbm(x * 0.5 + 5.2, y * 0.5 + 1.3, 3) - 0.5;
    const wy = this.fbm(x * 0.5 - 3.1, y * 0.5 + 9.7, 3) - 0.5;
    return this.fbm(x + wx * strength * 10, y + wy * strength * 10, octaves);
  }
}

/** 细胞噪声：返回最近特征点距离，用于成簇分布（矿区、巢穴） */
export class CellNoise {
  constructor(seed = 1, density = 8) {
    this.seed = typeof seed === 'string' ? hashStr(seed) : (seed >>> 0) || 1;
    this.density = density;
    this._cache = new Map();
  }

  _points(cx, cy) {
    const key = cx * 100003 + cy;
    let pts = this._cache.get(key);
    if (pts) return pts;
    const r = mulberry32((this.seed ^ (cx * 73856093) ^ (cy * 19349663)) >>> 0);
    pts = [];
    const count = 1 + Math.floor(r() * 2);
    for (let i = 0; i < count; i++) pts.push([cx + r(), cy + r()]);
    this._cache.set(key, pts);
    return pts;
  }

  /** 返回 [最近距离(归一化到0..1), 特征点世界坐标 x, y] */
  at(x, y) {
    const gx = x / this.density, gy = y / this.density;
    const cx = Math.floor(gx), cy = Math.floor(gy);
    let best = 1e9, bx = 0, by = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        for (const [px, py] of this._points(cx + ox, cy + oy)) {
          const dx = px - gx, dy = py - gy;
          const d = dx * dx + dy * dy;
          if (d < best) { best = d; bx = px * this.density; by = py * this.density; }
        }
      }
    }
    return [Math.min(1, Math.sqrt(best)), bx, by];
  }
}
