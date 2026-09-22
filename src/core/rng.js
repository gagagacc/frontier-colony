/**
 * 确定性随机数发生器 (mulberry32)
 * 世界生成、掉落、实验科技抽取都走这里 —— 同一个种子必然得到同一张地图。
 */

import { hashStr } from './math.js';

/**
 * 把各种「带权重的条目」归一化成 [value, weight] 二元组。
 * 支持：
 *   [a, b, c]                    等权
 *   [[v, w], ...]                二元组
 *   [{ w: 3, ...obj }, ...]      对象自带 w/weight，value 就是对象本身
 *   [{ e: value, w: n }, ...]    对象带 e/value/v 字段，value 取该字段
 *   { key: weight, ... }         普通对象按 key 加权
 */
function normalizeWeighted(entries) {
  const list = [];
  if (Array.isArray(entries)) {
    for (const e of entries) {
      if (e == null) continue;
      if (Array.isArray(e)) { list.push([e[0], e[1] ?? 0]); continue; }
      if (typeof e === 'object') {
        const w = e.w ?? e.weight ?? e.chance ?? 1;
        // 约定字段优先，否则 value 就是对象本身。
        // 注意 `t`：`{ t: 'grub', w: 30 }` 是「怪物类型 + 权重」的简写形式
        // （director / enemies 里大量在用）。少了这一条，weighted 会把整个
        // 包装对象返回出去，调用方拿去查表就成了 undefined —— 表现为
        // 「波次一只怪都生不出来」，而且不报错，非常难查。
        const v = (e.e !== undefined) ? e.e
          : (e.value !== undefined && (e.weight !== undefined || e.w !== undefined)) ? e.value
            : (e.v !== undefined && (e.weight !== undefined || e.w !== undefined)) ? e.v
              : (e.t !== undefined && (e.weight !== undefined || e.w !== undefined)) ? e.t
                : e;
        list.push([v, w]);
        continue;
      }
      list.push([e, 1]);
    }
  } else if (entries && typeof entries === 'object') {
    for (const k of Object.keys(entries)) list.push([k, entries[k]]);
  }
  return list;
}

export class RNG {
  constructor(seed = 1) {
    this.seed = typeof seed === 'string' ? hashStr(seed) : (seed >>> 0) || 1;
    this._s = this.seed;
  }

  /** [0,1) */
  next() {
    this._s = (this._s + 0x6d2b79f5) >>> 0;
    let t = this._s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min,max) 浮点 */
  range(min, max) { return min + this.next() * (max - min); }

  /** [min,max] 整数 */
  int(min, max) { return Math.floor(this.range(min, max + 1)); }

  /** 概率命中 */
  chance(p) { return this.next() < p; }

  /** 数组随机取一 */
  pick(arr) {
    if (!arr || !arr.length) return undefined;
    return arr[Math.floor(this.next() * arr.length)];
  }

  /**
   * 权重抽取。entries 可为：
   *   [{ w: 3, ... }, ...]          —— 对象自带 w 字段（返回对象本身）
   *   [{ e: value, w: 3 }, ...]     —— 对象带 e 字段（返回 e）
   *   [[value, weight], ...]        —— 二元组
   *   { key: weight, ... }          —— 对象
   */
  weighted(entries) {
    const list = normalizeWeighted(entries);
    let total = 0;
    for (const [, w] of list) total += Math.max(0, w);
    if (!list.length) return undefined;
    if (total <= 0) return list[0][0];
    let r = this.next() * total;
    for (const [v, w] of list) {
      r -= Math.max(0, w);
      if (r <= 0) return v;
    }
    return list[list.length - 1][0];
  }

  /** 原地洗牌 */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** 不重复抽 n 个 */
  sample(arr, n) {
    const copy = arr.slice();
    this.shuffle(copy);
    return copy.slice(0, Math.max(0, Math.min(n, copy.length)));
  }

  /** 正态分布（Box-Muller 的近似，够用） */
  gauss(mean = 0, sd = 1) {
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** 派生一个子 RNG（互不干扰的独立流） */
  fork(salt = '') {
    return new RNG((this.seed ^ hashStr(String(salt))) >>> 0);
  }

  get state() { return this._s; }
  set state(v) { this._s = v >>> 0; }
}

/** 全局非确定性随机（特效抖动等，不进存档） */
export const rnd = {
  next: Math.random,
  range: (a, b) => a + Math.random() * (b - a),
  int: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
  chance: (p) => Math.random() < p,
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
  sign: () => (Math.random() < 0.5 ? -1 : 1),
  /** 与 RNG.weighted 同接口，方便临时/非存档场景直接调用 */
  weighted(entries) {
    const list = normalizeWeighted(entries);
    if (!list.length) return undefined;
    let total = 0;
    for (const [, w] of list) total += Math.max(0, w);
    if (total <= 0) return list[0][0];
    let r = Math.random() * total;
    for (const [v, w] of list) {
      r -= Math.max(0, w);
      if (r <= 0) return v;
    }
    return list[list.length - 1][0];
  },
};
