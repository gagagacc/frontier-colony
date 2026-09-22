/**
 * 均匀网格空间哈希 —— 敌人成百上千时的邻居查询。
 * 每帧重建一次（O(n)），比维护动态索引更简单也更稳。
 */

export class SpatialHash {
  constructor(cellSize = 72) {
    this.cell = cellSize;
    this.map = new Map();
    this._stamp = 0;
  }

  clear() { this.map.clear(); }

  _key(cx, cy) { return cx * 73856093 ^ cy * 19349663; }

  insert(ent, radius = 0) {
    const c = this.cell;
    const x0 = Math.floor((ent.x - radius) / c), x1 = Math.floor((ent.x + radius) / c);
    const y0 = Math.floor((ent.y - radius) / c), y1 = Math.floor((ent.y + radius) / c);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = this._key(cx, cy);
        let bucket = this.map.get(k);
        if (!bucket) { bucket = []; this.map.set(k, bucket); }
        bucket.push(ent);
      }
    }
  }

  /** 填充所有实体 */
  build(list, radiusOf = null) {
    this.clear();
    for (const e of list) {
      if (e.dead) continue;
      this.insert(e, radiusOf ? radiusOf(e) : (e.r || 0));
    }
  }

  /**
   * 查询圆形范围内的实体。
   * 用「代次标记」去重（实体可能同时落在多个格子里），
   * 避免每次查询都新建 Set —— 这在每帧上千次查询时会变成大量垃圾。
   * @param {Array} out 可复用的输出数组；不传则新建
   */
  query(x, y, r, out = []) {
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    const stamp = ++this._stamp;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const bucket = this.map.get(this._key(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const e = bucket[i];
          if (e._qstamp === stamp) continue;
          e._qstamp = stamp;
          const dx = e.x - x, dy = e.y - y;
          const rr = r + (e.r || 0);
          if (dx * dx + dy * dy <= rr * rr) out.push(e);
        }
      }
    }
    return out;
  }

  /** 找最近的单个目标 */
  nearest(x, y, r, filter = null) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    let best = null, bestD = r * r;
    const stamp = ++this._stamp;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const bucket = this.map.get(this._key(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const e = bucket[i];
          if (e._qstamp === stamp || e.dead) continue;
          e._qstamp = stamp;
          if (filter && !filter(e)) continue;
          const dx = e.x - x, dy = e.y - y;
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = e; }
        }
      }
    }
    return best;
  }
}
