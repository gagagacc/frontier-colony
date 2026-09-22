/**
 * 主循环 / 游戏状态机 / 存档。
 *
 * 状态：MENU -> CHAR_SELECT -> LANDING -> PLAYING  (+ PAUSED / GAMEOVER)
 * 采用固定步长逻辑更新 + 可变步长渲染，保证战斗中手感稳定。
 */

import { FIXED_DT, RENDER, SAVE_VERSION } from './config.js';
import { bus, EV, notice } from './events.js';
import { clamp } from './math.js';

export const GS = {
  MENU: 'menu',
  CHAR_SELECT: 'charSelect',
  LANDING: 'landing',
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAMEOVER: 'gameOver',
  VICTORY: 'victory',
};

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = GS.MENU;
    this.prevState = GS.MENU;
    this.accumulator = 0;
    this.lastTime = 0;
    this.running = false;
    this.frame = 0;
    this.fps = 60;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this.timeScale = 1;
    /** @type {import('../world/world.js').World|null} */
    this.world = null;
    /** @type {import('../systems/gameState.js').RunState|null} */
    this.run = null;
    this.systems = [];       // 需要在 PLAYING 状态下更新的系统
    this.renderer = null;
    this.input = null;
    this.camera = null;
    this.audio = null;
    this.ui = null;
    this.saveManager = null;
    this.paused = false;
    this._rafId = 0;
  }

  setup({ input, camera, renderer, audio, ui, saveManager }) {
    this.input = input;
    this.camera = camera;
    this.renderer = renderer;
    this.audio = audio;
    this.ui = ui;
    this.saveManager = saveManager;
  }

  setState(next) {
    if (this.state === next) return;
    this.prevState = this.state;
    this.state = next;
    bus.emit('stateChange', { from: this.prevState, to: next });
  }

  /** 逻辑是否应该推进 */
  get simActive() {
    return this.state === GS.PLAYING && !this.paused;
  }

  /**
   * 是不是桌面版（Electron）。
   * 用来决定要不要显示「退出游戏」这类只对桌面有意义的入口 ——
   * 浏览器里 window.close() 关不掉用户自己打开的标签页。
   */
  get isDesktop() {
    return typeof window !== 'undefined' && !!window.frontier?.isDesktop;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = (now) => {
      this._rafId = requestAnimationFrame(loop);
      this.tick(now);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._rafId);
  }

  tick(now) {
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.25) dt = 0.25;               // 切窗口回来别一次性补算
    if (dt < 0) dt = 0;

    // FPS 统计
    this._fpsAcc += dt; this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      this.fps = this._fpsFrames / this._fpsAcc;
      this._fpsAcc = 0; this._fpsFrames = 0;
    }

    this.frame++;
    const scaled = dt * this.timeScale;

    // 每帧固定钩子：与「是否有进行中的一局」无关。
    // 手柄轮询、鼠标世界坐标、相机缓动都必须在这里跑 ——
    // 之前它们挂在 update() 里，导致主菜单/角色选择等状态下手柄完全没反应。
    this.beforeFrame?.(dt, this);

    if (this.simActive) {
      this.accumulator += scaled;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < 5) {
        this.update(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }
      if (steps >= 5) this.accumulator = 0;  // 防止死亡螺旋
    } else {
      this.accumulator = 0;
      this.updateIdle(dt);
    }

    this.afterFrame?.(dt, this);
    this.render(dt, this.simActive ? this.accumulator / FIXED_DT : 0);
    this.input.endFrame();
  }

  /** 固定步长逻辑更新 */
  update(dt) {
    const run = this.run;
    if (!run) return;
    run.time += dt;
    run.playTime += dt;
    for (const sys of this.systems) {
      if (sys.enabled === false) continue;
      sys.update?.(dt, this);
    }
    if (this.world) this.world.update(dt, this);
  }

  /** 暂停/菜单时仍要跑的东西（相机缓动、环境动画） */
  updateIdle(dt) {
    this.camera?.update(dt);
    this.world?.updateIdle?.(dt, this);
  }

  render(dt, alpha) {
    this.renderer?.render(dt, alpha, this);
    this.ui?.render?.(dt, this);
  }

  // ---------------- 存档 ----------------

  /** 序列化当前进度 */
  serialize() {
    if (!this.run) return null;
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      run: this.run.serialize(),
    };
  }

  save(slot = 'auto') {
    const data = this.serialize();
    if (!data) return false;
    const ok = this.saveManager.write(slot, data);
    if (ok) bus.emit(EV.SAVE, { slot });
    return ok;
  }

  hasSave(slot = 'auto') { return this.saveManager.exists(slot); }

  loadMeta(slot = 'auto') { return this.saveManager.getMeta(slot); }

  /** 读档：由 main.js 注入实际的 RunState 重建函数 */
  load(slot = 'auto') {
    const data = this.saveManager.read(slot);
    if (!data) { notice('读档失败', '存档不存在或已损坏', 'danger'); return false; }
    if (data.version !== SAVE_VERSION) {
      notice('存档版本不符', `存档 v${data.version}，当前 v${SAVE_VERSION}`, 'warn');
      return false;
    }
    try {
      this._rebuild?.(data.run);
      bus.emit(EV.LOAD, { slot });
      return true;
    } catch (err) {
      console.error('[load] 重建失败', err);
      notice('读档失败', String(err && err.message || err), 'danger');
      return false;
    }
  }

  deleteSave(slot = 'auto') { return this.saveManager.remove(slot); }

  static screenToCanvas(canvas, clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }
}

/**
 * 画面缩放基准。
 *
 * 为什么需要：这份 UI 全部是按 1280×720 的像素尺寸画的（字体 11px、
 * 面板宽 320px…）。窗口一大，所有东西看起来都越来越小；
 * 4K 全屏时 HUD 会小到看不清。所以按「窗口相对基准尺寸的比例」整体缩放 UI，
 * 但**画面（canvas 的世界渲染）本身不缩放** —— 大窗口看到更多的地图是好事，
 * 需求里说的「游戏显示内容做适配」指的正是「UI 跟着窗口走，视野自然变大」。
 */
export const UI_BASE_W = 1280;
export const UI_BASE_H = 720;

/** 由窗口尺寸算出的 UI 缩放系数（1 = 基准大小的窗口） */
export function computeUiScale(w, h, override) {
  if (override && override !== 'auto') {
    const n = Number(override);
    if (Number.isFinite(n) && n > 0) return n;
  }
  // 用面积比例开方，纵横比变化时不会一边飞一边缩
  const ratio = Math.sqrt((w * h) / (UI_BASE_W * UI_BASE_H));
  // 1280×720 上下浮动时不动，明显更大/更小才缩放；上下限避免极端窗口把 UI 拉烂
  return clamp(Math.round(ratio * 20) / 20, 0.85, 1.9);
}

/** 画布尺寸自适应（含 DPR） */
export function resizeCanvas(canvas, camera, uiScale = 1) {
  const dpr = Math.min(window.devicePixelRatio || 1, RENDER.maxDPR);
  const w = Math.max(320, window.innerWidth);
  const h = Math.max(240, window.innerHeight);
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  camera?.resize(w, h);
  // 字号基准：hud.js / renderer.js 里的固定 px 会乘这个系数
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.style.fontSize = (16 * uiScale) + 'px';
    document.documentElement.style.setProperty('--ui-scale', String(uiScale));
  }
  return { dpr, w, h, uiScale };
}

export { clamp };
