/**
 * 输入系统：键盘 + 鼠标。
 * 提供「持续按住」的实时状态给移动逻辑，也提供「本帧刚按下」的边沿事件给交互。
 *
 * 按键映射不再写死在这里 —— 它来自 `core/settings.js`，
 * 玩家可以在设置面板里改，改完立刻生效（不用重启）。
 */

import { settings } from './settings.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();       // 键盘按住的动作名
    this.justPressed = new Set(); // 本帧刚按下
    this.justReleased = new Set();
    this.mouse = { x: 0, y: 0, wx: 0, wy: 0, inside: false };
    this.mouseDown = new Set();
    this.mouseJust = new Set();
    this.mouseJustReleased = new Set();
    this.wheel = 0;
    this.keys = new Set();       // 原始 code，给调试用
    this._buffered = new Map();  // action -> 按下时间（未能立即生效的按键）
    this._padActions = new Set();// 本帧手柄注入过的动作
    this._padPrev = new Set();   // 上一帧手柄注入过的动作（用来判断「这一帧松开了」）
    this._padHeld = new Set();   // 本帧手柄标记为「按住」的动作
    this._padFireAt = new Map(); // 开关类动作的上次触发时间（去重用）
    this._textBuffer = null;
    this.enabled = true;
    /**
     * 改键界面开启时置 true：此时键盘事件不再映射成动作，
     * 只用来「读一个原始 code」，否则按键会一边改键一边触发游戏动作。
     */
    this.captureMode = false;
    this._bind();
  }

  /** 改键界面用：临时接管键盘，返回一个还原函数 */
  beginCapture() {
    this.captureMode = true;
    this.releaseAll();
    return () => { this.captureMode = false; };
  }

  _bind() {
    const onKey = (e, downEvt) => {
      // 模态窗口里的输入框优先（改键界面本身也要能收键盘）
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();

      // 改键界面在监听时，这里不要吞掉按键（它要拿到原始 code）
      const capturing = this.captureMode;

      const actions = settings.actionsFor(e.code);
      // 只拦「真的绑了动作」的键：改键之后旧键要恢复正常行为（比如空格滚动）
      if (!capturing && actions.length) {
        if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      }

      if (downEvt) {
        if (!this.keys.has(e.code)) {
          this.keys.add(e.code);
          if (!capturing) {
            this.markSource('keyboard');
            for (const action of actions) { this.down.add(action); this.justPressed.add(action); }
          }
        }
      } else {
        this.keys.delete(e.code);
        if (!capturing) {
          for (const action of actions) { this.down.delete(action); this.justReleased.add(action); }
        }
      }
    };

    window.addEventListener('keydown', (e) => { if (this.enabled) onKey(e, true); }, { passive: false });
    window.addEventListener('keyup', (e) => { if (this.enabled) onKey(e, false); }, { passive: false });
    window.addEventListener('blur', () => this.releaseAll());

    const pos = (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.inside = true;
    };

    this.canvas.addEventListener('pointermove', (e) => { pos(e); this.markSource('mouse'); });
    this.canvas.addEventListener('pointerdown', (e) => {
      pos(e);
      this.markSource('mouse');
      this.canvas.setPointerCapture?.(e.pointerId);
      this.mouseDown.add(e.button);
      this.mouseJust.add(e.button);
      e.preventDefault();
    });
    this.canvas.addEventListener('pointerup', (e) => {
      this.mouseDown.delete(e.button);
      this.mouseJustReleased.add(e.button);
      try { this.canvas.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    });
    this.canvas.addEventListener('pointerleave', () => { this.mouse.inside = false; });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
  }

  releaseAll() {
    this.down.clear();
    this.keys.clear();
    this.mouseDown.clear();
    this.justPressed.clear();
    this.justReleased.clear();
    this.mouseJust.clear();
    this.mouseJustReleased.clear();
    this._buffered.clear();
    this._padActions.clear();
    this._padPrev.clear();
    this._padHeld.clear();
    this._padFireAt.clear();
  }

  /** 每帧末尾调用，清掉边沿事件（没能生效的按键会进缓冲，见 pressedBuffered） */
  endFrame() {
    const now = performance.now();

    // 手柄按键是「每帧重新注入」的：上一帧注入过、这一帧却没有再注入的，
    // 就说明已经松开了，要从 down 里删掉。
    // 之前漏了这一步，导致按过一次的键会永远留在 down 里 ——
    // 表现就是菜单里一次输入被当成「一直推着」，手感发粘。
    //
    // 两个坑都在这里：
    // 1) 必须用**上一帧**的集合 _padPrev 来判断。用本帧的 _padActions 是错的 ——
    //    它在每个 endFrame 末尾就被清空了，到「松开的那一帧」早就是空的，
    //    循环一次都不进，down 永远删不掉。
    // 2) 判断必须发生在清空 _padHeld **之前**，否则条件永远为假。
    for (const a of this._padPrev) {
      if (!this._padHeld.has(a)) this.down.delete(a);
    }
    // 本帧注入过的动作留到下一帧当「上一帧」用
    this._padPrev.clear();
    for (const a of this._padActions) this._padPrev.add(a);
    this._padActions.clear();
    this._padHeld.clear();

    // 本帧没人消费的按键先存进缓冲，给接下来几帧一次补上的机会。
    // 不这么做的话，「按下的那一瞬间条件不满足」就等于这次输入白按了 ——
    // 表现为要连按两三遍才有反应。
    for (const a of this.justPressed) this._buffered.set(a, now);
    // 顺手清理过期项，避免 Map 无限增长
    for (const [a, t] of this._buffered) {
      if (now - t > 800) this._buffered.delete(a);
    }
    this.justPressed.clear();
    this.justReleased.clear();
    this.mouseJust.clear();
    this.mouseJustReleased.clear();
    this.wheel = 0;
  }

  isDown(action) { return this.down.has(action); }
  pressed(action) { return this.justPressed.has(action); }
  released(action) { return this.justReleased.has(action); }
  mouseIsDown(btn = 0) { return this.mouseDown.has(btn); }
  mousePressed(btn = 0) { return this.mouseJust.has(btn); }
  mouseReleased(btn = 0) { return this.mouseJustReleased.has(btn); }

  /**
   * 带缓冲的边沿判定：本帧刚按下，或最近 window 毫秒内按下过且还没被消费。
   *
   * 用法：把它放在所有前置条件判断的**最后一步**，
   * 这样「条件不满足」时按键会留在缓冲里，等条件一满足立刻生效。
   * 条件满足并真的执行了动作，要调用 consumeBuffered() 把它标记为已消费。
   *
   * @param {string} action
   * @param {number} window 缓冲时长（毫秒）
   */
  pressedBuffered(action, window = 160) {
    if (this.justPressed.has(action)) return true;
    const t = this._buffered.get(action);
    if (t === undefined) return false;
    if (performance.now() - t > window) { this._buffered.delete(action); return false; }
    return true;
  }

  /** 标记某个缓冲按键已被消费（动作真的执行了） */
  consumeBuffered(action) {
    this._buffered.delete(action);
    this.justPressed.delete(action);
  }

  /** 当前有没有待处理的缓冲按键（调试用） */
  get bufferedActions() { return [...this._buffered.keys()]; }

  /** 归一化的移动向量 */
  /**
   * 归一化的移动向量。
   * 键盘走八方向；手柄左摇杆支持任意角度与力度（力度大就全速）。
   */
  moveVector() {
    let x = 0, y = 0;
    if (this.down.has('left')) x -= 1;
    if (this.down.has('right')) x += 1;
    if (this.down.has('up')) y -= 1;
    if (this.down.has('down')) y += 1;
    if (x && y) { const inv = Math.SQRT1_2; x *= inv; y *= inv; }

    const pad = this.gamepad?.move;
    if (pad && (pad.x || pad.y)) {
      // 手柄优先：有力度的模拟输入比数字键更好用
      const mag = Math.min(1, Math.hypot(pad.x, pad.y));
      if (mag > 0.02) {
        x = pad.x; y = pad.y;
        // 轻推慢走，推到底全速；同时保证不明显低于键盘速度
        const scale = 0.55 + 0.45 * Math.min(1, mag);
        const inv = mag > 1 ? 1 / mag : 1;
        x *= inv * scale; y *= inv * scale;
      }
    }
    return { x, y };
  }

  /**
   * 瞄准角度（弧度）。
   * 右摇杆推了就用它，否则用鼠标位置 —— 两种输入可以随时混用。
   * @returns {number|null} null 表示调用方可以自己决定朝向
   */
  aimAngle(fromX, fromY) {
    const aim = this.gamepad?.aim;
    if (aim && (aim.x || aim.y) && Math.hypot(aim.x, aim.y) > 0.28) {
      return Math.atan2(aim.y, aim.x);
    }
    if (this.mouse.inside) {
      const wm = this.mouseWorld;
      if (wm) return Math.atan2(wm.y - fromY, wm.x - fromX);
    }
    return null;
  }

  /** 数字键槽位（返回 0-7，未按返回 -1） */
  slotPressed() {
    for (let i = 1; i <= 8; i++) if (this.justPressed.has('slot' + i)) return i - 1;
    return -1;
  }

  // =========================================================
  //  手柄注入接口（由 GamepadManager 每帧调用）
  // =========================================================

  /**
   * 把一次手柄按键按下映射成普通动作。
   * 走和键盘完全相同的通道，所以所有系统都不用改。
   *
   * @param {string} action
   * @param {boolean} hold    这一帧是否处于「按住」状态（松开判定用）
   * @param {object} opts
   *   - toggle: true 表示这是「开关类」动作（暂停/建造/地图…），
   *     在 cooldown 毫秒内重复注入会被忽略。
   *     为什么需要：手柄只有每帧快照，一次物理按压可能横跨两帧，
   *     如果中间经历了一次 poll 但没有走 endFrame（丢帧、异常、切标签页），
   *     同一次按压就会被当成「两次按下」。对暂停这种开关来说，
   *     连按两次就是「暂停又立刻继续」——表现成「START 有时候没反应」。
   */
  injectAction(action, hold = false, opts = {}) {
    if (!action) return;
    const now = performance.now();
    if (opts.toggle) {
      const cd = opts.cooldown ?? 260;
      const last = this._padFireAt.get(action) ?? -1e9;
      if (now - last < cd) {
        // 冷却期内：仍然算「按住」（否则会被误判成松开而清掉 down）
        this._padActions.add(action);
        if (hold) this._padHeld.add(action);
        return;
      }
      this._padFireAt.set(action, now);
    }
    this._padActions.add(action);
    if (hold) this._padHeld.add(action);
    this.down.add(action);
    this.justPressed.add(action);
  }

  /** 手柄扳机当作鼠标左键（开火） */
  injectMouse(button, isDown) {
    if (isDown) {
      if (!this.mouseDown.has(button)) this.mouseJust.add(button);
      this.mouseDown.add(button);
    } else {
      if (this.mouseDown.has(button)) this.mouseJustReleased.add(button);
      this.mouseDown.delete(button);
    }
  }

  /** 覆盖本帧鼠标世界坐标（手柄瞄准时用不到，留给鼠标玩家） */
  setMouseWorld(x, y) {
    this.mouseWorld = { x, y };
  }

  /** 本帧玩家最后一次用的是哪种输入设备（用于切换 UI 提示图标） */
  get lastSource() { return this._lastSource || 'keyboard'; }
  markSource(src) { this._lastSource = src; }
}
