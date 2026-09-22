/**
 * 手柄支持。
 *
 * 设计原则：
 *   1) 手柄不另起一套输入通道 —— 它把按键「注入」成和键盘完全相同的动作名，
 *      所以战斗、移动、建造、面板全都不用改代码。
 *   2) 面板/菜单用「空间导航」：摇杆或十字键朝哪个方向推，就聚焦到那个方向上
 *      最近的按钮；A 确认，B 返回，肩键切页签。不需要鼠标。
 *   3) 手柄与键鼠可以随时混用：动一下鼠标就切回鼠标瞄准，碰一下摇杆就切回手柄。
 *
 * 手柄映射（Xbox 布局，标准映射）：
 *   左摇杆 移动 · 右摇杆 瞄准并自动开火 · RT 开火 · LT 装填
 *   A 交互/采集/确认 · B 闪避/返回 · X 攻击 · Y 建造
 *   十字键 上一个/下一个武器 · LB/RB 只作用于面板（切页签/微调数值）
 *   Start 暂停 · Back/View 地图 · 长按 Back 呼救怪潮（拉收益）
 *   L3 切换武器 · R3 手动接管防御塔
 */

import { bus, EV, notice } from './events.js';
import { clamp } from './math.js';

/** 标准手柄按钮索引 */
const B = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9,
  L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
  GUIDE: 16,
};

/**
 * 战斗按键映射。
 * 面板打开时这些会被 UI 导航接管（见 poll 里的 context 分支）。
 *
 * toggle: true 表示「开关类」动作 —— 一次物理按压只允许触发一次，
 * 由 Input.injectAction 做去重（见那里的注释：丢帧时同一次按压会被看成两次）。
 */
const COMBAT_BUTTONS = {
  [B.RT]: { action: 'fire', mouse: true, label: '开火' },
  [B.A]: { action: 'interact', hold: true, label: '采集/交互' },
  [B.B]: { action: 'dodge', toggle: true, label: '闪避' },
  [B.X]: { action: 'attackAlt', mouse: true, label: '攻击' },
  [B.Y]: { action: 'build', toggle: true, label: '建造' },
  [B.LT]: { action: 'reload', toggle: true, label: '装填' },
  [B.RB]: { action: 'sprint', hold: true, label: '冲刺' },
  [B.LEFT]: { action: 'prevWeapon', toggle: true, label: '上一把武器' },
  [B.RIGHT]: { action: 'nextWeapon', toggle: true, label: '下一把武器' },
  [B.L3]: { action: 'swapWeapon', toggle: true, label: '切换武器' },
  [B.R3]: { action: 'takeover', toggle: true, label: '接管炮塔' },
  [B.START]: { action: 'pause', toggle: true, label: '暂停' },
  // BACK 不在这里：短按开地图 / 长按呼救，由下面的长按逻辑统一处理
};

export class GamepadManager {
  constructor(input, opts = {}) {
    this.input = input;
    this.enabled = true;
    this.index = -1;
    this.pad = null;
    this.name = '';
    this.connected = false;
    this.deadzone = opts.deadzone ?? 0.18;
    this.triggerThreshold = opts.triggerThreshold ?? 0.35;
    this.aimThreshold = 0.28;

    /** 当前状态的快照，供 Input 读取 */
    input.gamepad = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, active: false };

    this._prev = new Array(20).fill(false);
    this._backHold = 0;
    this._backHoldFired = false;
    this._navRepeat = 0;
    this._navDir = null;
    this._lastPulse = 0;

    /** UI 导航状态 */
    this.uiNav = {
      active: false,        // 是否正在用手柄逛界面（决定要不要显示焦点环）
      focus: null,          // 当前聚焦的 DOM 元素
    };

    this._bindEvents();
    this.scan();
  }

  // =========================================================
  //  连接管理
  // =========================================================

  _bindEvents() {
    if (typeof window === 'undefined') return;
    window.addEventListener('gamepadconnected', (e) => {
      this.scan();
      // 合成事件可能没有 e.gamepad 字段（测试里就是这么发的），必须容错
      const raw = (e && e.gamepad && e.gamepad.id) ? e.gamepad.id : this.name;
      const pretty = raw ? raw.split('（')[0].split('(')[0].trim() : '手柄';
      notice('手柄已连接', `${pretty} —— 左摇杆移动，右摇杆瞄准，RT 开火，A 采集，B 闪避，START 暂停。`, 'good');
      bus.emit(EV.SFX, { name: 'unlock' });
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.connected = false;
      this.index = -1;
      this.pad = null;
      this.input.gamepad.active = false;
      notice('手柄已断开', '已切换回键鼠操作。', 'warn');
    });
  }

  /** 找到第一个可用手柄 */
  scan() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return false;
    const list = navigator.getGamepads() || [];
    for (const g of list) {
      if (g && g.connected) {
        this.pad = g;
        this.index = g.index;
        this.name = g.id || 'Gamepad';
        this.connected = true;
        return true;
      }
    }
    this.connected = false;
    return false;
  }

  // =========================================================
  //  读取原始状态
  // =========================================================

  _read() {
    if (!navigator.getGamepads) return null;
    if (!this.pad || !this.pad.connected) {
      const list = navigator.getGamepads();
      this.pad = null;
      for (const g of list) {
        if (g && g.connected) { this.pad = g; this.index = g.index; this.name = g.id || ''; break; }
      }
      // 找到就同步状态 —— 之前漏了这一步，导致「读到了手柄但 connected 还是 false」
      if (this.pad) this.connected = true;
    }
    // 有些浏览器每次都要重新取对象
    if (this.pad) {
      const fresh = navigator.getGamepads()[this.pad.index];
      if (fresh && fresh.connected) {
        this.pad = fresh;
        this.connected = true;
      } else {
        // 之前有手柄，现在取不到了 —— 视为断开（有些环境不会发 disconnect 事件）
        this.pad = null;
        this.index = -1;
        this.name = '';
        this.connected = false;
        this.input.gamepad.active = false;
        this.input.gamepad.move.x = this.input.gamepad.move.y = 0;
        this.input.gamepad.aim.x = this.input.gamepad.aim.y = 0;
        if (this.uiNav.active) this.clearFocus();
      }
    }
    return this.pad;
  }

  _axisRaw(pad, i) {
    const v = pad.axes[i] ?? 0;
    return Number.isFinite(v) ? v : 0;
  }

  /** 死区处理：小于死区归零，之后重新归一化，避免小推就走 */
  _dz(v) {
    const d = this.deadzone;
    const a = Math.abs(v);
    if (a < d) return 0;
    return Math.sign(v) * Math.min(1, (a - d) / (1 - d));
  }

  _buttonDown(pad, i) {
    const b = pad.buttons[i];
    if (!b) return false;
    if (typeof b === 'number') return b > 0.5;
    return !!(b.pressed || b.value > 0.5);
  }

  _triggerValue(pad, i) {
    const b = pad.buttons[i];
    if (!b) return 0;
    if (typeof b === 'number') return b;
    return b.value ?? (b.pressed ? 1 : 0);
  }

  // =========================================================
  //  每帧轮询
  // =========================================================

  /**
   * @param {object} ctx { modalOpen, paused, state, pendingPlacement, actions, game }
   */
  poll(ctx = {}) {
    if (!this.enabled) return;
    const pad = this._read();
    const gp = this.input.gamepad;

    if (!pad) {
      gp.active = false;
      gp.move.x = gp.move.y = 0;
      gp.aim.x = gp.aim.y = 0;
      if (this.uiNav.active) this.clearFocus();
      return;
    }

    // ---------- 摇杆 ----------
    const mx = this._dz(this._axisRaw(pad, 0));
    const my = this._dz(this._axisRaw(pad, 1));
    const ax = this._dz(this._axisRaw(pad, 2));
    const ay = this._dz(this._axisRaw(pad, 3));
    gp.move.x = mx; gp.move.y = my;
    gp.aim.x = ax; gp.aim.y = ay;
    gp.active = true;

    if (mx || my || ax || ay) this.input.markSource('gamepad');

    // ---------- 按键边缘检测 ----------
    const now = new Array(20).fill(false);
    for (const i of Object.values(B)) now[i] = this._buttonDown(pad, i);
    // 扳机用模拟阈值 + 滞回，避免半按抖动
    const rtVal = this._triggerValue(pad, B.RT);
    const ltVal = this._triggerValue(pad, B.LT);
    now[B.RT] = rtVal > this.triggerThreshold;
    now[B.LT] = ltVal > this.triggerThreshold;

    const pressed = (i) => now[i] && !this._prev[i];
    const released = (i) => !now[i] && this._prev[i];
    const held = (i) => now[i];

    const anyPressed = now.some((v, i) => v && !this._prev[i]);
    if (anyPressed) this.input.markSource('gamepad');

    // ---------- 界面导航模式 ----------
    const inUi = this.isUiContext(ctx);
    if (inUi !== this.uiNav.active) {
      this.uiNav.active = inUi;
      this._navSig = '';
      if (inUi) this.focusFirst();
      else this.clearFocus();
    }
    if (inUi) {
      // 界面内容会异步变化：模态框先被挂上、body 才填内容，
      // 所以每帧比对一次候选集合，变了就重新安置焦点，
      // 否则焦点会留在上一层的按钮上（看起来像摇杆失灵）。
      const list = this.candidates();
      const sig = list.length + '|' + (list[0] ? list[0].textContent.slice(0, 12) : '') + '|' + (list[list.length - 1] ? list[list.length - 1].textContent.slice(0, 12) : '');
      if (sig !== this._navSig) {
        this._navSig = sig;
        const focus = this.uiNav.focus;
        if (!focus || !focus.isConnected || !list.includes(focus)) {
          this.setFocus(list.length ? list[0] : null);
        }
      }
    }

    if (inUi) {
      this._pollUi(pad, { pressed, released, held, ax, ay, mx, my, ctx });
    } else {
      this._pollCombat({ pressed, released, held, ax, ay, mx, my, ctx });
    }

    // ---------- 长按 Back 呼救怪潮（只在战斗里） ----------
    if (!inUi && held(B.BACK)) {
      this._backHold += 1 / 60;
      if (this._backHold > 0.9 && !this._backHoldFired) {
        this._backHoldFired = true;
        ctx.actions?.forceWave?.();
      }
    } else {
      if (this._backHold > 0 && this._backHold < 0.9 && !inUi) {
        // 短按：打开地图
        this.input.injectAction('map', false, { toggle: true });
      }
      this._backHold = 0;
      this._backHoldFired = false;
    }

    this._prev = now;
  }

  // =========================================================
  //  战斗映射
  // =========================================================

  _pollCombat({ pressed, released, held, ctx }) {
    const input = this.input;

    // 放置模式：B 取消，RT/A 确认落点（和鼠标左键等价）
    const placing = !!ctx.pendingPlacement;
    if (placing) {
      if (pressed(B.B)) {
        ctx.actions?.cancelPlacement?.();
        bus.emit(EV.SFX, { name: 'uiClose' });
        input.markSource('gamepad');
      }
      if (pressed(B.A) || pressed(B.RT)) {
        // 落点跟着玩家走：放在角色正前方一格
        const run = ctx.game?.run;
        const p = run?.player;
        if (p && ctx.actions?.confirmPlacement) {
          const dist = 90;
          const tx = p.x + Math.cos(p.facing) * dist;
          const ty = p.y + Math.sin(p.facing) * dist;
          ctx.actions.confirmPlacement(tx, ty);
        }
        input.markSource('gamepad');
      }
      if (pressed(B.START)) input.injectAction('pause', false, { toggle: true });
      return;
    }

    for (const [idxStr, map] of Object.entries(COMBAT_BUTTONS)) {
      const idx = Number(idxStr);
      if (map.mouse) {
        // 开火：按住持续输出
        input.injectMouse(0, held(idx));
        if (held(idx)) input.markSource('gamepad');
        continue;
      }
      if (idx === B.START) {
        if (pressed(idx)) input.injectAction('pause', false, { toggle: true });
        continue;
      }
      if (idx === B.BACK) continue;              // 交给长按逻辑
      if (map.hold) {
        // 按住类：只有真的按住才注入，并且标记为 hold
        if (held(idx)) input.injectAction(map.action, true);
      } else if (pressed(idx)) {
        input.injectAction(map.action, false, { toggle: !!map.toggle });
      }
    }

    // 十字键切武器：走和数字键一样的通道
    if (pressed(B.LEFT) || pressed(B.RIGHT)) {
      const total = ctx.game?.run?.player?.weapons?.length ?? 1;
      if (total > 1) {
        // 已经在 COMBAT_BUTTONS 里注入了，这里只是保底（老版本逻辑），
        // 所以不要再注一次，只标记输入源
        input.markSource('gamepad');
      }
    }
  }

  // =========================================================
  //  界面导航
  // =========================================================

  /**
   * 当前是否有「界面」在等着玩家操作。
   * 不只是模态框 —— 主菜单、角色选择、降落点选择也是界面，
   * 手柄在这些界面上同样要能选中和确认。
   */
  isUiContext(ctx = {}) {
    if (typeof document === 'undefined') return false;
    // 用 DOM 里是否真的有 .modal 判断，比调用方的标志位更可靠
    // （面板在「没有进行中的一局」时会被静默忽略，标志位不会变）
    if (document.querySelector('#modal-root .modal')) return true;
    const menu = document.getElementById('mainmenu');
    if (menu && !menu.classList.contains('hidden') && menu.querySelector('.btn')) return true;
    const pause = document.getElementById('pause-overlay');
    if (pause && !pause.classList.contains('hidden') && pause.querySelector('.btn')) return true;
    return !!ctx.modalOpen;
  }

  /**
   * 当前可以聚焦的元素。
   * 只扫「当前活跃的那一层」—— 否则 HUD 的快捷栏会排在模态框按钮前面，
   * 焦点会跑到背景 UI 上去，看着像没聚焦。
   */
  candidates() {
    if (typeof document === 'undefined') return [];
    const modalRoot = document.getElementById('modal-root');
    const pause = document.getElementById('pause-overlay');
    const selectors = [];
    if (modalRoot && !modalRoot.classList.contains('hidden') && modalRoot.querySelector('.btn, .card')) {
      selectors.push('#modal-root .btn', '#modal-root .card', '#modal-root .list-row');
    } else if (pause && !pause.classList.contains('hidden') && pause.querySelector('.btn')) {
      selectors.push('#pause-overlay .btn');
    } else {
      const menu = document.getElementById('mainmenu');
      if (menu && !menu.classList.contains('hidden') && menu.querySelector('.btn')) {
        selectors.push('#mainmenu .btn', '#mainmenu .char-card');
      }
      selectors.push('#hud .slot');
    }
    const list = [];
    for (const sel of selectors) list.push(...document.querySelectorAll(sel));
    return list.filter(el => {
      if (el.disabled) return false;
      if (el.classList.contains('locked')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    });
  }

  focusFirst() {
    const list = this.candidates();
    if (!list.length) { this.clearFocus(); return; }
    this.setFocus(list[0]);
  }

  setFocus(el) {
    if (this.uiNav.focus && this.uiNav.focus !== el) {
      this.uiNav.focus.classList.remove('gp-focus');
    }
    this.uiNav.focus = el;
    if (el) {
      el.classList.add('gp-focus');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  clearFocus() {
    if (this.uiNav.focus) this.uiNav.focus.classList.remove('gp-focus');
    this.uiNav.focus = null;
  }

  /**
   * 空间导航：朝指定方向找最近的候选元素。
   * 纯「元素顺序」导航在网格布局里会跳得很怪，所以按几何位置找；
   * 但纯几何在「一排两个按钮」这种布局上会找不到目标
   * （比如角色选择页：左边「返回」、右边「确定」，向下推就无解），
   * 所以几何找不到时退回到顺序导航兜底 —— 这样任何按钮都一定到得了。
   */
  move(dirX, dirY) {
    const list = this.candidates();
    if (!list.length) return;
    if (!this.uiNav.focus || !this.uiNav.focus.isConnected || !list.includes(this.uiNav.focus)) {
      this.setFocus(list[0]);
      return;
    }

    const cur = this.uiNav.focus.getBoundingClientRect();
    const cx = cur.left + cur.width / 2;
    const cy = cur.top + cur.height / 2;

    let best = null;
    let bestScore = Infinity;
    for (const el of list) {
      if (el === this.uiNav.focus) continue;
      const r = el.getBoundingClientRect();
      const ex = r.left + r.width / 2;
      const ey = r.top + r.height / 2;
      const dx = ex - cx;
      const dy = ey - cy;
      // 必须在目标方向的半平面内
      const along = dx * dirX + dy * dirY;
      if (along <= 4) continue;
      // 垂直方向的偏离作为惩罚
      const perp = Math.abs(dx * -dirY + dy * dirX);
      const dist = Math.hypot(dx, dy);
      const score = dist + perp * 2.2;
      if (score < bestScore) { bestScore = score; best = el; }
    }

    if (best) { this.setFocus(best); return; }

    // 几何上找不到：按顺序走一步（保证可达性）
    const i = list.indexOf(this.uiNav.focus);
    const forward = dirY > 0 || (dirY === 0 && dirX > 0);
    const step = forward ? 1 : -1;
    const next = list[(i + step + list.length) % list.length];
    if (next) this.setFocus(next);
  }

  _pollUi(pad, { pressed, released, held, ax, ay, mx, my, ctx }) {
    const input = this.input;

    // 确认
    if (pressed(B.A) || pressed(B.RT)) {
      const el = this.uiNav.focus;
      if (el && el.isConnected) {
        el.click();
        bus.emit(EV.SFX, { name: 'uiClick' });
      }
      input.markSource('gamepad');
    }

    // 返回
    if (pressed(B.B) || pressed(B.LT)) {
      const close = document.querySelector('#modal-root .modal-close');
      if (close) close.click();
      else if (ctx.actions) ctx.actions.togglePause();
      input.markSource('gamepad');
    }

    /*
     * 方向导航。三种输入都接受：
     *   - 左摇杆（玩家进菜单后手自然还放在左摇杆上）
     *   - 十字键
     *   - 右摇杆（战斗中它是瞄准，进菜单后当方向键也合理）
     * 之前的版本只看右摇杆，导致「推左摇杆没反应」。
     */
    const pick = (stick, negBtn, posBtn) =>
      (Math.abs(stick) > 0.6 ? Math.sign(stick) : 0)
      || (pressed(posBtn) ? 1 : 0)
      || (pressed(negBtn) ? -1 : 0);

    const nx = pick(ax, B.LEFT, B.RIGHT) || pick(mx, B.LEFT, B.RIGHT);
    const ny = pick(ay, B.UP, B.DOWN) || pick(my, B.UP, B.DOWN);
    if (nx || ny) {
      const dirX = nx, dirY = ny;
      const changed = dirX !== this._navDir?.[0] || dirY !== this._navDir?.[1];
      this._navDir = [dirX, dirY];
      if (changed || this._navRepeat <= 0) {
        this.move(dirX, dirY);
        input.markSource('gamepad');
        this._navRepeat = changed ? 16 : 7;   // 首次慢一点，之后加速
      } else {
        this._navRepeat--;
      }
    } else {
      this._navDir = null;
      this._navRepeat = 0;
    }

    // 页签切换：面板在页签行上标了 data-gp-tabs，肩键就在这些按钮间循环
    const tabDir = pressed(B.RB) ? 1 : pressed(B.LB) ? -1 : 0;
    if (tabDir) {
      const rows = [...document.querySelectorAll('#modal-root [data-gp-tabs]')];
      const tabs = rows.length
        ? [...rows[0].querySelectorAll('.btn')]
        : [...document.querySelectorAll('#modal-root .btn-row .btn')].filter(b =>
          !b.classList.contains('danger') && b.textContent.trim());
      if (tabs.length > 1) {
        const activeIdx = Math.max(0, tabs.findIndex(b => b.classList.contains('primary')));
        const next = (activeIdx + tabDir + tabs.length) % tabs.length;
        tabs[next].click();
        input.markSource('gamepad');
      }
    }

    if (pressed(B.START)) {
      if (ctx.actions) ctx.actions.togglePause();
      input.markSource('gamepad');
    }
  }

  // =========================================================
  //  震动反馈
  // =========================================================

  /**
   * @param {number} strength 0..1
   * @param {number} ms 时长
   */
  rumble(strength = 0.5, ms = 120) {
    const pad = this.pad;
    if (!pad) return;
    const now = performance.now();
    if (now - this._lastPulse < 45) return;   // 限流，别糊成一片
    this._lastPulse = now;
    const act = pad.vibrationActuator;
    if (act && typeof act.playEffect === 'function') {
      try {
        act.playEffect('dual-rumble', {
          startDelay: 0,
          duration: ms,
          weakMagnitude: clamp(strength * 0.7, 0, 1),
          strongMagnitude: clamp(strength, 0, 1),
        });
      } catch { /* 某些实现不支持，忽略 */ }
    }
  }

  get displayName() {
    if (!this.name) return '';
    return this.name.split('（')[0].split('(')[0].replace(/\s*\(.*?\)\s*/g, '').trim();
  }
}
