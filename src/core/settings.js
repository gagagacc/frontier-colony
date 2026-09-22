/**
 * 全局设置：按键绑定、显示模式、游戏性选项。
 *
 * 设计原则：
 *   1) 单一数据源。输入系统、渲染、窗口全部从这里读，不各自维护一份。
 *   2) 任何一项都能「恢复默认」。玩家把键改乱了必须有一条回头路。
 *   3) 存 localStorage，和存档分开 —— 设置是「这台机器上的偏好」，
 *      不该跟着某一个存档走（换存档不该把键位也换掉）。
 *
 * 结构：
 *   keybinds: { action: [KeyboardEvent.code, ...] }   每个动作可绑多个键
 *   display:  { mode: 'window'|'fullscreen', windowSize, uiScale, vsync }
 *   gameplay: { showDamageNumbers, screenShake, autoCollectAlways, difficulty }
 */

const KEY = 'frontier-settings-v1';

/**
 * 可以改键的动作。顺序就是设置面板里的显示顺序。
 * hint 是给玩家看的一句话说明；group 用来分组。
 */
export const BINDABLE_ACTIONS = [
  // ---- 移动 ----
  { action: 'up', label: '向上移动', group: '移动', hint: '默认 W / ↑' },
  { action: 'down', label: '向下移动', group: '移动', hint: '默认 S / ↓' },
  { action: 'left', label: '向左移动', group: '移动', hint: '默认 A / ←' },
  { action: 'right', label: '向右移动', group: '移动', hint: '默认 D / →' },
  { action: 'sprint', label: '冲刺', group: '移动', hint: '按住消耗体力' },
  { action: 'dodge', label: '闪避翻滚', group: '移动', hint: '有无敌帧' },
  { action: 'vehicle', label: '上 / 下车 · 交互', group: '移动', hint: '也用于遗迹交互' },

  // ---- 战斗 ----
  { action: 'interact', label: '采集 / 维修', group: '战斗', hint: '按住生效' },
  { action: 'reload', label: '装填弹药', group: '战斗' },
  { action: 'swapWeapon', label: '切换武器', group: '战斗' },
  { action: 'takeover', label: '接管炮塔', group: '战斗', hint: '再按一次交还' },
  { action: 'heal', label: '使用医疗包', group: '战斗' },
  { action: 'collect', label: '拾取 / 自动收集', group: '战斗' },
  { action: 'ping', label: '呼叫怪潮', group: '战斗', hint: '需同时按住冲刺' },
  { action: 'slot1', label: '快捷栏 1（武器）', group: '战斗' },
  { action: 'slot2', label: '快捷栏 2（武器）', group: '战斗' },
  { action: 'slot3', label: '快捷栏 3（武器）', group: '战斗' },
  { action: 'slot4', label: '快捷栏 4（武器）', group: '战斗' },
  // 5-8：弹药与消耗品。以前只绑了 1-4，快捷栏上却画着 1-8 的数字 ——
  // 玩家按 5/6/7/8 没反应，正是因为这几个动作根本不存在。
  { action: 'slot5', label: '快捷栏 5（弹药装填）', group: '战斗' },
  { action: 'slot6', label: '快捷栏 6（医疗包）', group: '战斗' },
  { action: 'slot7', label: '快捷栏 7（兴奋剂）', group: '战斗' },
  { action: 'slot8', label: '快捷栏 8（维修套件）', group: '战斗' },

  // ---- 界面 ----
  { action: 'build', label: '建造与空投', group: '界面' },
  { action: 'tech', label: '科技树', group: '界面' },
  { action: 'town', label: '城镇经营', group: '界面' },
  { action: 'experiments', label: '实验科技', group: '界面' },
  { action: 'inventory', label: '装备与背包', group: '界面' },
  { action: 'map', label: '行星地图', group: '界面' },
  { action: 'pause', label: '暂停 / 关闭面板', group: '界面' },
  { action: 'screenshot', label: '截图', group: '界面' },
];

/** 默认按键（每个动作可以绑多个） */
export const DEFAULT_BINDS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  dodge: ['Space'],
  vehicle: ['KeyF'],
  interact: ['KeyE'],
  reload: ['KeyR'],
  swapWeapon: ['KeyQ'],
  takeover: ['KeyC'],
  heal: ['KeyH'],
  collect: ['KeyX'],
  ping: ['KeyZ'],
  slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'], slot4: ['Digit4'],
  slot5: ['Digit5'], slot6: ['Digit6'], slot7: ['Digit7'], slot8: ['Digit8'],
  build: ['KeyB'],
  tech: ['KeyT'],
  town: ['KeyG'],
  experiments: ['KeyV'],
  inventory: ['Tab'],
  map: ['KeyM'],
  pause: ['Escape'],
  screenshot: ['KeyP'],
};

/** 默认显示设置 */
export const DEFAULT_DISPLAY = {
  mode: 'window',          // 'window' | 'fullscreen'
  windowSize: 'auto',      // 'auto' | '1280x720' | '1600x900' | '1920x1080'
  uiScale: 'auto',         // 'auto' | 数值（1 = 100%）
  showFps: false,
};

/** 默认游戏性设置 */
export const DEFAULT_GAMEPLAY = {
  damageNumbers: true,     // 伤害飘字
  screenShake: true,       // 屏幕震动
  autoCollect: false,      // 永远自动收集（跳过「亲自捡」的摩擦）
  lootToasts: true,        // 掉落通知
};

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function readStored() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;   // 坏掉的设置直接当没有，不要让游戏起不来
  }
}

class Settings {
  constructor() {
    this.binds = clone(DEFAULT_BINDS);
    this.display = clone(DEFAULT_DISPLAY);
    this.gameplay = clone(DEFAULT_GAMEPLAY);
    this.load();
  }

  load() {
    const data = readStored();
    if (!data) return;
    // 逐项合并：新版本加了动作/选项时，老设置也不会缺字段
    if (data.binds && typeof data.binds === 'object') {
      for (const [action, keys] of Object.entries(data.binds)) {
        if (!DEFAULT_BINDS[action]) continue;         // 已删除的动作，忽略
        if (!Array.isArray(keys)) continue;
        const clean = keys.filter(k => typeof k === 'string' && k);
        if (clean.length) this.binds[action] = clean;
      }
    }
    if (data.display) this.display = { ...this.display, ...data.display };
    if (data.gameplay) this.gameplay = { ...this.gameplay, ...data.gameplay };
  }

  save() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(KEY, JSON.stringify({
        v: 1, binds: this.binds, display: this.display, gameplay: this.gameplay,
      }));
    } catch { /* 隐私模式之类写不进去，忽略即可 */ }
  }

  // ---------- 按键 ----------

  /** 某个动作绑定的所有键 */
  keysFor(action) { return this.binds[action] || []; }

  /** 这个键码绑到了哪个动作（没绑返回 null） */
  actionFor(code) {
    for (const [action, keys] of Object.entries(this.binds)) {
      if (keys.includes(code)) return action;
    }
    return null;
  }

  /** 所有绑定了这个键码的动作（理论上只有一个，但留出多绑的余地） */
  actionsFor(code) {
    const out = [];
    for (const [action, keys] of Object.entries(this.binds)) {
      if (keys.includes(code)) out.push(action);
    }
    return out;
  }

  /**
   * 把某个键从其他动作上摘掉，保证一个键只归一个动作。
   *
   * 关键点：摘掉之后**不允许**把某个动作变成「一个键都没有」——
   * 那等于把这个动作从游戏里删掉了，而且玩家看不出来。
   * 老版本这里会「悄悄回退成默认键」，结果是改 A 的键会莫名其妙地把 B 改回去，
   * 更难理解。现在改成：改键前先检查，会掏空别的动作就整件事拒绝。
   */
  _detach(code, exceptAction) {
    for (const [action, keys] of Object.entries(this.binds)) {
      if (action === exceptAction) continue;
      const i = keys.indexOf(code);
      if (i >= 0) keys.splice(i, 1);
    }
  }

  /**
   * 这次改键会不会把别的动作掏空？
   * @returns {string|null} 被掏空的动作名
   */
  wouldOrphan(action, code) {
    for (const [other, keys] of Object.entries(this.binds)) {
      if (other === action) continue;
      if (keys.length === 1 && keys[0] === code) return other;
    }
    return null;
  }

  /**
   * 改键。
   * @param {string} action
   * @param {string} code KeyboardEvent.code
   * @param {'replace'|'add'} mode replace = 替换主键（默认），add = 追加一个备用键
   * @returns {boolean} 是否成功（被拒绝时 UI 应该给出提示）
   */
  bind(action, code, mode = 'replace') {
    if (!DEFAULT_BINDS[action] || !code) return false;
    // Esc 是「取消改键」的通用键，不允许被占用（否则没法退出改键界面）
    if (code === 'Escape') return false;
    // 这个键是别的动作的最后一根救命稻草 -> 拒绝，让玩家先给那个动作换个键
    if (this.wouldOrphan(action, code)) return false;

    this._detach(code, action);
    const keys = this.binds[action] || [];
    if (mode === 'add') {
      if (!keys.includes(code)) keys.push(code);
    } else {
      // 替换主键，保留备用键
      const rest = keys.slice(1).filter(k => k !== code);
      this.binds[action] = [code, ...rest];
    }
    this.save();
    this.emit();
    return true;
  }

  /** 解绑某个键。解绑到空会自动回退到默认键 —— 动作不能变得不可触发。 */
  unbind(action, code) {
    const keys = this.binds[action];
    if (!keys) return;
    const i = keys.indexOf(code);
    if (i >= 0) keys.splice(i, 1);
    if (!keys.length) this.binds[action] = clone(DEFAULT_BINDS[action] || []);
    this.save();
    this.emit();
  }

  /** 重置某一个动作 */
  resetAction(action) {
    if (!DEFAULT_BINDS[action]) return;
    this.binds[action] = clone(DEFAULT_BINDS[action]);
    this.save();
    this.emit();
  }

  /**
   * 全部恢复默认。
   *
   * 注意这里**不能用 this.binds 当默认值**：
   * this.binds 是 load() 之后的结果，里面可能装着「上一次运行留下的自定义键」。
   * 用它当默认，就等于把玩家的改动又「重置」回了玩家自己的改动 ——
   * 表现是「点了恢复默认，键位没变」。默认值永远只有一个来源：DEFAULT_BINDS。
   */
  resetAll() {
    this.binds = clone(DEFAULT_BINDS);
    this.display = clone(DEFAULT_DISPLAY);
    this.gameplay = clone(DEFAULT_GAMEPLAY);
    this.save();
    this.emit();
  }

  /** 有没有被改过（设置面板上用来显示「已修改」） */
  isCustomized(action) {
    const a = this.binds[action] || [];
    const b = DEFAULT_BINDS[action] || [];
    return a.length !== b.length || a.some((k, i) => k !== b[i]);
  }

  get anyCustomized() {
    return BINDABLE_ACTIONS.some(a => this.isCustomized(a.action));
  }

  // ---------- 显示 / 游戏性 ----------

  setDisplay(patch) {
    this.display = { ...this.display, ...patch };
    this.save();
    this.emit();
  }

  setGameplay(patch) {
    this.gameplay = { ...this.gameplay, ...patch };
    this.save();
    this.emit();
  }

  // ---------- 变更通知 ----------

  onChange(fn) {
    this._listeners = this._listeners || [];
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter(f => f !== fn);
    };
  }

  emit() {
    for (const fn of this._listeners || []) {
      try { fn(this); } catch { /* 监听方出错不该影响设置本身 */ }
    }
  }
}

/** 全局唯一实例 */
export const settings = new Settings();

// ---------- 按键显示名 ----------

const CODE_LABELS = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Space: '空格', Escape: 'Esc', Tab: 'Tab', Enter: '回车', Backspace: '退格',
  ShiftLeft: '左Shift', ShiftRight: '右Shift', ControlLeft: '左Ctrl', ControlRight: '右Ctrl',
  AltLeft: '左Alt', AltRight: '右Alt', CapsLock: 'CapsLock',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
  NumpadAdd: '小键盘+', NumpadSubtract: '小键盘-', NumpadEnter: '小键盘回车',
};

/** KeyboardEvent.code -> 玩家看得懂的名字 */
export function keyLabel(code) {
  if (!code) return '—';
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return '小键盘' + code.slice(6);
  return code;
}

/** 把一组键码显示成 "W / ↑" */
export function keysLabel(codes) {
  if (!codes || !codes.length) return '未绑定';
  return codes.map(keyLabel).join(' / ');
}

/** 生成「按住 Ctrl + 点击」这种组合描述里用得到的主键 */
export function primaryKey(action) {
  return (settings.keysFor(action)[0]) || null;
}
