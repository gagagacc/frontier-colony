/**
 * UI 工具层：DOM 构建、模态窗口、开关按钮、数字格式化。
 * 手写非常小的 DOM 助手，避免引入框架。
 */

import { clamp, fmt, fmtTime } from '../core/math.js';
import { bus, EV } from '../core/events.js';
import { RESOURCE_DEF } from '../data/tiles.js';
import { RARITY_DEF } from '../data/weapons.js';

/** 创建元素：h('div', {class:'x', onclick:fn}, [children | 'text']) */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k in el && typeof v === 'boolean') el[k] = v;
    else el.setAttribute(k, v);
  }
  const list = Array.isArray(children) ? children.flat(4) : [children];
  for (const c of list) {
    if (c == null || c === false || c === true) continue;
    if (typeof c === 'object' && !c.nodeType) {
      console.warn('[ui] h() 收到非节点内容，已忽略：', c);
      continue;
    }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }

export function button(label, onClick, cls = 'btn') {
  return h('button', { class: cls, onclick: (e) => { e.stopPropagation(); onClick?.(e); } }, label);
}

/**
 * 资源「名字 + 数量」。
 *
 * 玩家反馈：右上角只有色点和数字，看的不知道是什么材料。
 * 现在图标后面直接跟名字（图标保留，色盲玩家也能靠文字认）。
 */
export function resourceChip(kind, amount, dim = false) {
  const def = RESOURCE_DEF[kind] || { name: kind, color: '#ccc', icon: '◆' };
  return h('div', { class: `res-item${dim ? ' dim' : ''}`, title: `${def.name} ${fmt(amount)}` }, [
    h('span', { class: 'dot', style: { background: def.color } }),
    h('span', { class: 'res-name', style: { color: def.color } }, def.name),
    h('span', { class: 'amt', style: { color: def.color } }, fmt(amount)),
  ]);
}

/** 键值对行 */
export function kv(k, v, cls = '') {
  return [h('div', { class: 'k' }, k), h('div', { class: `v ${cls}` }, v)];
}

export function statLine(label, value) {
  return h('div', { class: 'stat-line' }, [h('span', {}, label), h('b', {}, String(value))]);
}

/** 条形进度 */
export function bar(frac, color, label, cls = '') {
  return h('div', { class: `bar ${cls}` }, [
    h('div', { class: 'bar-fill', style: { width: `${clamp(frac, 0, 1) * 100}%`, background: color } }),
    label ? h('div', { class: 'bar-text' }, label) : null,
  ]);
}

/** 稀有度标签 */
export function rarityTag(rarity) {
  const def = RARITY_DEF[rarity] || RARITY_DEF.common;
  return h('span', { class: 'card-tag', style: { color: def.color } }, def.name);
}

/**
 * 模态窗口管理器。
 * 同一时刻只显示一个主模态；支持 closeOnEsc。
 */
export class ModalManager {
  constructor(root) {
    this.root = root;
    this.stack = [];
    this.onCloseStack = [];
  }

  get isOpen() { return this.stack.length > 0; }
  get top() { return this.stack[this.stack.length - 1] || null; }

  /** 最上层是不是设置面板（暂停键要区分对待，见 actions.togglePause） */
  isTopSettings() {
    const t = this.top;
    return !!t && t.kind === 'settings';
  }

  /**
   * @param {object} opts { title, subtitle, body, footer, onClose, wide, closeOnBackdrop }
   */
  open(opts) {
    const { title, subtitle, body, footer, onClose, closeOnBackdrop = false, kind = null } = opts;
    const closeBtn = h('button', { class: 'modal-close', onclick: () => this.close() }, '×');
    const head = h('div', { class: 'modal-head' }, [
      h('div', {}, [h('h2', {}, title), subtitle ? h('div', { class: 'sub' }, subtitle) : null]),
      closeBtn,
    ]);
    const bodyEl = h('div', { class: 'modal-body' }, body || []);
    const modal = h('div', { class: 'modal', style: opts.wide ? { width: 'min(1240px, 95vw)' } : {} }, [
      head, bodyEl, footer ? h('div', { class: 'modal-foot' }, footer) : null,
    ]);
    if (closeOnBackdrop) {
      modal.addEventListener('click', (e) => e.stopPropagation());
      this.root.addEventListener('click', () => this.close(), { once: true });
    }

    const entry = { modal, onClose, bodyEl, kind };
    this.stack.push(entry);
    clear(this.root);
    this.root.appendChild(modal);
    this.root.classList.remove('hidden');
    bus.emit(EV.SFX, { name: 'uiOpen' });
    return entry;
  }

  /**
   * 在现有模态之上**叠**一层（而不是替换）。
   *
   * 用途：从暂停菜单里打开设置。替换的话关掉设置就直接回到游戏了，
   * 玩家会以为「暂停被取消了」；叠一层才能关掉设置后回到暂停菜单。
   */
  push(opts) {
    const { title, subtitle, body, footer, onClose, closeOnBackdrop = false, kind = null } = opts;
    const closeBtn = h('button', { class: 'modal-close', onclick: () => this.close() }, '×');
    const head = h('div', { class: 'modal-head' }, [
      h('div', {}, [h('h2', {}, title), subtitle ? h('div', { class: 'sub' }, subtitle) : null]),
      closeBtn,
    ]);
    const bodyEl = h('div', { class: 'modal-body' }, body || []);
    const modal = h('div', { class: 'modal', style: opts.wide ? { width: 'min(1240px, 95vw)' } : {} }, [
      head, bodyEl, footer ? h('div', { class: 'modal-foot' }, footer) : null,
    ]);
    if (closeOnBackdrop) {
      modal.addEventListener('click', (e) => e.stopPropagation());
      this.root.addEventListener('click', () => this.close(), { once: true });
    }
    const entry = { modal, onClose, bodyEl, kind };
    this.stack.push(entry);
    clear(this.root);
    this.root.appendChild(modal);
    this.root.classList.remove('hidden');
    bus.emit(EV.SFX, { name: 'uiOpen' });
    return entry;
  }

  /** 替换当前模态内容（用于实验科技选方向→选卡） */
  replace(opts) {
    const top = this.top;
    if (top) this.stack.pop();
    return this.open(opts);
  }

  /** 刷新当前模态的 body（重建内容） */
  refresh(builder) {
    const top = this.top;
    if (!top) return;
    clear(top.bodyEl);
    const content = builder();
    if (!content) return;
    const list = Array.isArray(content) ? content.flat(4) : [content];
    for (const c of list) {
      if (c == null || typeof c !== 'object' || !c.nodeType) {
        if (c != null && c !== false) {
          console.warn('[ui] refresh 收到非节点内容，已忽略：', c);
        }
        continue;
      }
      top.bodyEl.appendChild(c);
    }
  }

  close() {
    const entry = this.stack.pop();
    if (entry?.onClose) entry.onClose();
    if (this.stack.length) {
      // 回到上一层：重新渲染
      const prev = this.top;
      clear(this.root);
      this.root.appendChild(prev.modal);
    } else {
      clear(this.root);
      this.root.classList.add('hidden');
      bus.emit(EV.SFX, { name: 'uiClose' });
    }
  }

  closeAll() {
    while (this.stack.length) {
      const e = this.stack.pop();
      e?.onClose?.();
    }
    clear(this.root);
    this.root.classList.add('hidden');
  }
}

/** 右上角浮动通知 */
export class NoticeStack {
  constructor(el) {
    this.el = el;
    this.items = [];
    bus.on(EV.NOTICE, (n) => this.push(n));
  }

  push({ title, body, kind = 'info' }) {
    const node = h('div', { class: `notice ${kind}` }, [
      title ? h('div', { class: 'notice-title' }, title) : null,
      body ? h('div', {}, body) : null,
    ]);
    this.el.appendChild(node);
    const lifetime = body && body.length > 60 ? 7200 : 5200;
    const timer = setTimeout(() => {
      node.classList.add('fade');
      setTimeout(() => node.remove(), 450);
    }, lifetime);
    // 最多 5 条
    while (this.el.children.length > 5) {
      const first = this.el.firstChild;
      clearTimeout(timer);
      first.remove();
    }
  }
}

/** 世界内飘字 */
export class FloaterLayer {
  constructor(el, camera) {
    this.el = el;
    this.camera = camera;
    this.pool = [];
    this.active = [];
    bus.on(EV.DAMAGE, (d) => this.spawnDamage(d));
    bus.on(EV.LOOT, (d) => this.spawnLoot(d));
    bus.on(EV.XP, (d) => this.spawnText(d.x, d.y, `+${fmt(d.amount)}`, 'xp'));
  }

  spawnDamage({ x, y, amount, crit, player, element, small }) {
    if (amount < 1) return;
    const cls = player ? 'dmg' : crit ? 'crit' : 'dmg';
    const text = player ? `-${fmt(amount)}` : `${fmt(amount)}`;
    this.spawnText(x, y, text, cls, { color: player ? '#ff8a8a' : element === 'fire' ? '#ff9a4c' : element === 'poison' ? '#a6e06a' : crit ? '#ff9a4c' : '#ffe08a', size: crit ? 17 : small ? 10 : 13 });
  }

  spawnLoot({ x, y, kind, amount, color }) {
    const def = RESOURCE_DEF[kind];
    const col = color || def?.color || '#ffba4c';
    const cls = kind === 'gold' ? 'gold' : kind === 'xp' ? 'xp' : 'mat';
    this.spawnText(x, y, `+${fmt(amount)}`, cls, { color: col });
  }

  spawnText(x, y, text, cls, opts = {}) {
    const node = document.createElement('div');
    node.className = `floater ${cls}`;
    node.textContent = text;
    if (opts.color) node.style.color = opts.color;
    if (opts.size) node.style.fontSize = opts.size + 'px';
    this.el.appendChild(node);
    this.active.push({ node, x, y, jitterX: (Math.random() - 0.5) * 22, born: performance.now() });
    if (this.active.length > 90) {
      const old = this.active.shift();
      old.node.remove();
    }
  }

  update() {
    const cam = this.camera;
    // 切场景/重建存档的瞬间相机可能还没挂上，这里静默跳过而不是每帧报错
    if (!cam || typeof cam.worldToScreen !== 'function') return;
    const now = performance.now();
    for (let i = this.active.length - 1; i >= 0; i--) {
      const f = this.active[i];
      const age = (now - f.born) / 950;
      if (age >= 1) { f.node.remove(); this.active.splice(i, 1); continue; }
      const s = cam.worldToScreen(f.x + f.jitterX, f.y);
      f.node.style.left = s.x + 'px';
      f.node.style.top = s.y + 'px';
    }
  }

  clear() {
    for (const f of this.active) f.node.remove();
    this.active.length = 0;
  }
}

/** 一个可复用的「刷新」调度器，避免每帧重建 DOM */
export class UiThrottle {
  constructor(interval = 0.12) {
    this.interval = interval;
    this.t = 0;
  }
  ready(dt) {
    this.t -= dt;
    if (this.t > 0) return false;
    this.t = this.interval;
    return true;
  }
  force() { this.t = 0; }
}

export { fmt, fmtTime, clamp };
export const pct = (v) => `${Math.round(v * 100)}%`;
