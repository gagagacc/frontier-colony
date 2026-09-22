/**
 * 摄像机：跟随目标、边界钳制、平滑、震屏、世界<->屏幕坐标换算。
 */

import { clamp, lerp } from './math.js';
import { rnd } from './rng.js';

export class Camera {
  constructor(viewW = 1280, viewH = 720) {
    this.x = 0;              // 世界坐标（视野中心）
    this.y = 0;
    this.zoom = 1;
    this.targetZoom = 1;
    this.viewW = viewW;
    this.viewH = viewH;
    this.bounds = null;      // { w, h } 世界大小（像素）
    this.shakeTime = 0;
    this.shakeMag = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.followLerp = 12;    // 越大越紧
    this.freeLook = false;   // 无目标时（大地图查看）
  }

  resize(w, h) { this.viewW = w; this.viewH = h; }

  setBounds(w, h) { this.bounds = { w, h }; }

  shake(mag, time = 0.32) {
    if (mag > this.shakeMag || this.shakeTime <= 0) {
      this.shakeMag = Math.max(this.shakeMag, mag);
    }
    this.shakeTime = Math.max(this.shakeTime, time);
  }

  /** 直接对准（切场景用） */
  snapTo(x, y) { this.x = x; this.y = y; this._clamp(); }

  follow(tx, ty, dt) {
    if (this.freeLook) return;
    const t = 1 - Math.exp(-this.followLerp * dt);
    this.x = lerp(this.x, tx, t);
    this.y = lerp(this.y, ty, t);
    this._clamp();
  }

  update(dt) {
    this.zoom = lerp(this.zoom, this.targetZoom, 1 - Math.exp(-6 * dt));
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const k = Math.max(0, this.shakeTime) * this.shakeMag;
      this.shakeX = rnd.range(-k, k);
      this.shakeY = rnd.range(-k, k);
      if (this.shakeTime <= 0) { this.shakeMag = 0; this.shakeX = 0; this.shakeY = 0; }
    } else { this.shakeX = 0; this.shakeY = 0; }
  }

  _clamp() {
    if (!this.bounds) return;
    const hw = this.viewW / 2 / this.zoom;
    const hh = this.viewH / 2 / this.zoom;
    if (this.bounds.w > hw * 2) this.x = clamp(this.x, hw, this.bounds.w - hw);
    else this.x = this.bounds.w / 2;
    if (this.bounds.h > hh * 2) this.y = clamp(this.y, hh, this.bounds.h - hh);
    else this.y = this.bounds.h / 2;
  }

  /** 应用变换到 canvas 上下文 */
  apply(ctx) {
    ctx.translate(this.viewW / 2, this.viewH / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x + this.shakeX / this.zoom, -this.y + this.shakeY / this.zoom);
  }

  worldToScreen(wx, wy) {
    return {
      x: (wx - this.x) * this.zoom + this.viewW / 2 + this.shakeX,
      y: (wy - this.y) * this.zoom + this.viewH / 2 + this.shakeY,
    };
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.viewW / 2 - this.shakeX) / this.zoom + this.x,
      y: (sy - this.viewH / 2 - this.shakeY) / this.zoom + this.y,
    };
  }

  /** 当前视野在世界坐标下的矩形（含 margin，用于剔除） */
  viewRect(margin = 96) {
    const hw = this.viewW / 2 / this.zoom + margin;
    const hh = this.viewH / 2 / this.zoom + margin;
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
  }

  get left() { return this.x - this.viewW / 2 / this.zoom; }
  get top() { return this.y - this.viewH / 2 / this.zoom; }
}
