/**
 * Steam 适配（渲染进程侧）。
 *
 * 职责只有两件：
 *   1. 把成就/统计的调用包装成「浏览器里也能安全调用」的形式；
 *   2. 在本地记录玩家已经拿到的成就，方便做 UI（成就列表、解锁提示）。
 *
 * 浏览器里没有 `window.frontier.steam`，所有调用变成空操作，
 * 但本地记录照旧 —— 这样在浏览器里调试时成就提示也能正常弹出。
 */

const LOCAL_KEY = 'frontier-achievements-v1';

/** 成就显示名（和 electron/steam.cjs 的 ACHIEVEMENTS 一一对应） */
export const ACHIEVEMENT_INFO = {
  ACH_FIRST_LANDING: { name: '脚踏实地', desc: '第一次降落到异星地表', icon: '🜨' },
  ACH_FIRST_WAVE: { name: '守住了', desc: '第一次击退虫潮', icon: '🛡' },
  ACH_FIRST_TOWER: { name: '空投成功', desc: '第一次空投防御塔', icon: '▣' },
  ACH_FIRST_VEHICLE: { name: '有车了', desc: '申请到第一台载具', icon: '⛟' },
  ACH_FIRST_RED: { name: '一抹猩红', desc: '获得第一件红色装备', icon: '✦' },
  ACH_NEST_CLEAR: { name: '捣毁巢穴', desc: '清剿第一个虫巢', icon: '☠' },
  ACH_DUNGEON_BOSS: { name: '深入巢穴', desc: '击杀巢穴主', icon: '💀' },
  ACH_PLANET_CLAIMED: { name: '这颗星球归我了', desc: '占领一颗星球', icon: '★' },
  ACH_TEN_WAVES: { name: '十波不倒', desc: '单一殖民地击退 10 波虫潮', icon: '⚔' },
  ACH_TOWN_CITY: { name: '拓荒城市', desc: '城镇发展到「拓荒城市」', icon: '⌂' },
  ACH_TD_MODE: { name: '钢铁防线', desc: '在纯塔防模式击退 10 波', icon: '⛨' },
  ACH_ALL_NESTS: { name: '星球净化', desc: '清光整颗星球的虫巢', icon: '✧' },
};

class SteamClient {
  constructor() {
    this.bridge = (typeof window !== 'undefined' && window.frontier?.steam) || null;
    this.available = false;
    this.player = null;
    this.unlocked = new Set(this._loadLocal());
    this._statusChecked = false;
  }

  _loadLocal() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCAL_KEY) : null;
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  _saveLocal() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LOCAL_KEY, JSON.stringify([...this.unlocked]));
      }
    } catch { /* 隐私模式下写不进去，忽略 */ }
  }

  /** 桌面版启动时问一次主进程：Steam 连上了没有 */
  async refreshStatus() {
    if (!this.bridge) { this.available = false; return null; }
    try {
      const st = await this.bridge.status();
      this.available = !!st?.available;
      this.player = st?.player || null;
      this._statusChecked = true;
      this.status = st;
      return st;
    } catch {
      this.available = false;
      return null;
    }
  }

  /**
   * 解锁成就。
   * @param {string} id 成就 API Name
   * @param {(info:object)=>void} [onNew] 首次解锁时的回调（用来弹提示）
   */
  unlock(id, onNew) {
    if (!id) return false;
    const first = !this.unlocked.has(id);
    if (first) {
      this.unlocked.add(id);
      this._saveLocal();
      if (onNew) onNew(ACHIEVEMENT_INFO[id] || { name: id, desc: '', icon: '★' });
    }
    /*
     * 每次都上报：Steam 那边自己去重，而且能补上「本地已解锁但云端没同步」。
     * 注意 `invoke` 返回的是 Promise —— 主进程没有注册这个通道时
     * （旧版 preload、测试夹具、浏览器）它会 reject，所以必须挂 catch，
     * 否则会变成一条未处理的 Promise 拒绝，污染控制台错误统计。
     */
    if (this.bridge?.unlock) {
      try { Promise.resolve(this.bridge.unlock(id)).catch(() => {}); } catch { /* 忽略 */ }
    }
    return first;
  }

  /** 只增不减的统计 */
  setStat(name, value) {
    if (!this.bridge?.setStat) return;
    try { Promise.resolve(this.bridge.setStat(name, value)).catch(() => {}); } catch { /* 忽略 */ }
  }

  /** 提交统计（存档时、退出时调用） */
  store() {
    if (!this.bridge?.store) return;
    try { Promise.resolve(this.bridge.store()).catch(() => {}); } catch { /* 忽略 */ }
  }

  get isAvailable() { return this.available; }
}

export const steamClient = new SteamClient();
