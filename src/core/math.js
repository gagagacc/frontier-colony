/** 数学与几何工具 */

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const remap = (v, a, b, c, d) => lerp(c, d, clamp01(invLerp(a, b, v)));

export const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
};
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const len = (x, y) => Math.hypot(x, y);
export const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);

/** 把角度归一到 (-PI, PI] */
export function normAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a <= -Math.PI) a += TAU;
  return a;
}

/** 朝目标角度平滑旋转，限制每帧最大角速度 */
export function turnToward(cur, target, maxStep) {
  const d = normAngle(target - cur);
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}

export function approach(cur, target, step) {
  if (cur < target) return Math.min(cur + step, target);
  if (cur > target) return Math.max(cur - step, target);
  return target;
}

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);

/** 圆-圆碰撞 */
export const circlesHit = (ax, ay, ar, bx, by, br) => dist2(ax, ay, bx, by) <= (ar + br) * (ar + br);

/** 点是否在扇形攻击范围内（用于近战判断） */
export function inCone(ox, oy, facing, halfAngle, range, tx, ty, tr = 0) {
  const d = dist(ox, oy, tx, ty) - tr;
  if (d > range) return false;
  if (d <= 0) return true;
  return Math.abs(normAngle(angleTo(ox, oy, tx, ty) - facing)) <= halfAngle;
}

/** 把世界坐标吸附到网格中心 */
export const snap = (v, size) => Math.floor(v / size) * size + size / 2;

/** 蛇形/螺旋遍历网格的辅助：按距离排序的格点 */
export function gridCellsInRadius(cx, cy, r) {
  const out = [];
  const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r);
  const y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (dist2(cx, cy, x, y) <= r * r) out.push([x, y]);
    }
  }
  out.sort((a, b) => dist2(cx, cy, a[0], a[1]) - dist2(cx, cy, b[0], b[1]));
  return out;
}

/** 数值格式化：1234 -> 1.2k */
export function fmt(n, digits = 1) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(digits) + 'B';
  if (abs >= 1e6) return (v / 1e6).toFixed(digits) + 'M';
  if (abs >= 1e4) return (v / 1e3).toFixed(digits) + 'k';
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(digits);
}

/** 秒 -> mm:ss */
export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export const signed = (v) => (v >= 0 ? '+' : '');
export const pct = (v, digits = 0) => `${(v * 100).toFixed(digits)}%`;

/** 从数组中移除元素（交换删除，不保序，O(1)） */
export function swapRemove(arr, index) {
  const last = arr.length - 1;
  if (index < 0 || index > last) return;
  if (index !== last) arr[index] = arr[last];
  arr.pop();
}

export function swapRemoveItem(arr, item) {
  const i = arr.indexOf(item);
  if (i >= 0) swapRemove(arr, i);
  return i >= 0;
}

/** 稳定的字符串哈希 -> uint32 */
export function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
