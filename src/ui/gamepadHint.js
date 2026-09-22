/**
 * 手柄操作提示条 + 连接状态。
 *
 * 只在真的接上手柄后出现；一旦玩家用回键鼠就自动淡出，
 * 避免给键鼠玩家增加视觉噪音。
 *
 * 提示条目要和 `core/gamepad.js` 的映射表一一对应 ——
 * 之前漏了装填/接管炮塔/地图/放置确认这些键，玩家只能去翻说明面板。
 */

import { h, clear } from './dom.js';

/**
 * 战斗中显示的操作提示。
 * `ctx` 用来做上下文变化（放置模式、站在载具旁边时提示会变）。
 */
const COMBAT_HINTS = [
  ['左摇杆', '移动'],
  ['右摇杆', '瞄准 / 自动开火'],
  ['RT', '开火'],
  ['X', '近战攻击'],
  ['A', '采集 · 交互'],
  ['B', '闪避'],
  ['LT', '装填弹药'],
  ['LB', '冲刺'],
];

/** 面板打开时的操作提示 */
const UI_HINTS = [
  ['左摇杆 / 十字键 / 右摇杆', '选择'],
  ['A / RT', '确认'],
  ['B / LT', '返回'],
  ['RB / LB', '切页签'],
  ['START', '关闭 / 暂停'],
  ['十字键 ←→', '面板里也切武器'],
];

function combatHints(ctx = {}) {
  const list = COMBAT_HINTS.slice();
  if (ctx.pendingPlacement) {
    // 放置模式下 B 是「取消放置」而不是「开建造面板」，提示必须跟着改
    list.push(['RT / A', '确认落点'], ['B', '取消放置']);
    return list;
  }
  list.push(['Y', '建造与空投']);
  if (ctx.nearVehicle) list.push(['A', '上/下车']);
  list.push(['R3', '接管炮塔'], ['十字键 ←→', '切武器'], ['VIEW', '地图 · 长按呼救'], ['START', '暂停']);
  return list;
}

export class GamepadHint {
  constructor(gamepad) {
    this.gamepad = gamepad;
    this.bar = document.getElementById('gamepad-bar');
    this.status = document.getElementById('gamepad-status');
    this.mode = null;          // 'combat' | 'ui' | null
    this.shown = false;
    this._builtFor = null;
  }

  render(dt, game) {
    const connected = this.gamepad?.connected;
    const inGame = game?.state === 'playing' || game?.state === 'paused';

    // 状态行只在主菜单/选人/暂停这类「还没进游戏或已停手」的地方显示，
    // 战斗中显示会一直占着屏幕底部，很吵。
    if (this.status) {
      const showStatus = !inGame || game?.paused;
      this.status.style.display = showStatus ? '' : 'none';
      if (showStatus) {
        const txt = connected
          ? `${this.gamepad.displayName || '手柄'} 已连接 · 左摇杆移动 / 右摇杆瞄准 / RT 开火`
          : '未检测到手柄 —— 插上手柄后会自动识别（支持 Xbox / PS / 通用手柄）';
        if (this.status.textContent !== txt) this.status.textContent = txt;
        this.status.classList.toggle('on', !!connected);
      }
    }

    if (!this.bar) return;

    // 提示条：进游戏后用一次手柄就显示；用键鼠操作时自动隐藏，不给键鼠玩家添噪音。
    const usedPad = this.gamepad?.input?.lastSource === 'gamepad';
    const uiOpen = !!document.querySelector('#modal-root .modal');
    const want = !!connected && usedPad && (inGame || uiOpen);
    if (!want) {
      if (this.shown) { this.bar.classList.remove('on'); this.shown = false; }
      return;
    }

    const ctx = this._context(game);
    const mode = uiOpen ? 'ui' : 'combat';
    // 上下文变化（比如开始放置、走到车边）也要重建，否则提示会停在旧的一套
    const sig = mode + '|' + (mode === 'combat' ? (ctx.pendingPlacement ? 'place' : ctx.nearVehicle ? 'veh' : 'free') : '');
    this.shown = true;
    this.bar.classList.add('on');
    if (this._builtFor !== sig) {
      this._builtFor = sig;
      this.build(mode, ctx);
    }
  }

  /** 收集提示条做判断需要的上下文 */
  _context(game) {
    const run = game?.run;
    const out = { pendingPlacement: false, nearVehicle: false };
    if (!run) return out;
    out.pendingPlacement = !!(game?.ui?.actions?.pendingPlacement || run.pendingPlacement);
    const v = run.vehicle;
    const p = run.player;
    if (v && !v.destroyed && p && !p.dead) {
      out.nearVehicle = Math.hypot(v.x - p.x, v.y - p.y) < 120;
    }
    return out;
  }

  build(mode, ctx = {}) {
    const hints = mode === 'ui' ? UI_HINTS : combatHints(ctx);
    clear(this.bar);
    for (const [key, label] of hints) {
      this.bar.appendChild(h('div', { class: 'gp-item' }, [
        h('span', { class: 'gp-key' }, key),
        h('span', {}, label),
      ]));
    }
  }
}
