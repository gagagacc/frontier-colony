/**
 * Steam 适配（主进程侧）。
 *
 * 设计原则：
 *   1. **没有 Steam 也要能跑**。steamworks.js 是原生模块，开发机上大概率没装、
 *      也没开 Steam 客户端。所有调用都必须能优雅降级成空操作，
 *      而不是让游戏起不来。整份文件里不允许出现「没有 Steam 就 throw」。
 *   2. **不在渲染进程加载原生模块**。steamworks.js 的官方用法要求
 *      `contextIsolation: false, nodeIntegration: true` —— 那等于把整个
 *      Node 环境交给页面脚本，代价太大。这里把 Steam 放在主进程，
 *      通过 IPC 暴露一层很窄的接口（和现有的存档桥同一套做法）。
 *   3. **成就点写在一个地方**。游戏里只调用 `steam.unlock('ach_id')`，
 *      具体怎么触发、什么时候触发由 main.js 的事件订阅决定。
 *
 * 打包注意：正式版要把 Steamworks 的 redistributable 动态库
 * （`steam_api64.dll` / `libsteam_api.so`）拷到可执行文件旁边，
 * 否则 init 会失败并回落到「无 Steam」模式。
 */

const path = require('node:path');
const fs = require('node:fs');

/** 成就定义：id 必须和 Steamworks 后台里配置的 API Name 完全一致 */
const ACHIEVEMENTS = {
  ACH_FIRST_LANDING: '降落：第一次降落到异星地表',
  ACH_FIRST_WAVE: '第一次击退虫潮',
  ACH_FIRST_TOWER: '第一次空投防御塔',
  ACH_FIRST_VEHICLE: '申请到第一台载具',
  ACH_FIRST_RED: '获得第一件红色装备',
  ACH_NEST_CLEAR: '清剿第一个虫巢',
  ACH_DUNGEON_BOSS: '击杀巢穴主',
  ACH_PLANET_CLAIMED: '占领一颗星球',
  ACH_TEN_WAVES: '单一殖民地击退 10 波虫潮',
  ACH_TOWN_CITY: '城镇发展到「拓荒城市」',
  ACH_TD_MODE: '在纯塔防模式击退 10 波',
  ACH_ALL_NESTS: '清光整颗星球的虫巢',
};

class SteamBridge {
  constructor() {
    this.available = false;
    this.client = null;
    this.appId = 0;
    this._warned = false;
    this._pending = [];
    this._unlocked = new Set();
  }

  /**
   * 尝试初始化。任何失败都只是「本次没有 Steam」，不是错误。
   * @param {number} appId Steam App ID（0 = 用 steam_appid.txt）
   */
  init(appId = 0) {
    if (this.available) return true;
    try {
      // 用 require 而不是 import：原生模块，且要在失败时被 try 包住
      // eslint-disable-next-line global-require
      const steamworks = require('steamworks.js');
      this.client = appId ? steamworks.init(appId) : steamworks.init();
      this.available = !!this.client;
      this.appId = appId;
      if (this.available) {
        // 把初始化前攒下的成就补发一遍
        for (const id of this._pending) this._activate(id);
        this._pending.length = 0;
      }
      return this.available;
    } catch (err) {
      // 常见原因：没装 steamworks.js / 没开 Steam / 缺 steam_appid.txt
      // 这些都是「开发时的正常状态」，所以只记一次 debug，不打扰玩家。
      if (!this._warned) {
        this._warned = true;
        const why = String(err && err.message || err).split('\n')[0];
        console.log(`[steam] 未初始化（游戏照常运行，成就与云存档会走本地）：${why}`);
      }
      this.available = false;
      return false;
    }
  }

  /** 打开 Steam 覆盖层（Shift+Tab 的入口），失败就忽略 */
  enableOverlay() {
    try {
      // eslint-disable-next-line global-require
      require('steamworks.js').electronEnableSteamOverlay();
    } catch { /* 没有 Steam 就没有覆盖层，正常 */ }
  }

  _activate(id) {
    if (!this._unlocked.has(id)) this._unlocked.add(id);
    try { this.client.achievement.activate(id); } catch { /* 后台没配这条成就时忽略 */ }
  }

  /** 解锁成就。没有 Steam 时记录下来，等 init 成功后补发。 */
  unlock(id) {
    if (!id) return false;
    if (!this.available) {
      if (!this._pending.includes(id)) this._pending.push(id);
      return false;
    }
    if (this._unlocked.has(id)) return true;
    this._activate(id);
    return true;
  }

  /** 上报一个「只增不减」的统计值（Steam 后台需要先配好对应的 Stat） */
  setStat(name, value) {
    if (!this.available) return false;
    try { this.client.stats.setInt(name, Math.round(value)); return true; } catch { return false; }
  }

  /** 把统计与成就一起提交给 Steam */
  store() {
    if (!this.available) return false;
    try { this.client.stats.store(); return true; } catch { return false; }
  }

  /** 玩家昵称（用于存档命名、欢迎语） */
  playerName() {
    if (!this.available) return null;
    try { return this.client.localplayer.getName(); } catch { return null; }
  }

  /** Steam ID（64 位），拿不到返回 null */
  playerId() {
    if (!this.available) return null;
    try { return String(this.client.localplayer.getSteamId().steamId64); } catch { return null; }
  }

  /**
   * 云存档目录。
   *
   * Steam 的 Auto-Cloud 是**在后台按路径配置**的，游戏侧不需要调 API：
   * 只要把存档写进 `%APPDATA%/<AppID>/` 或 Electron 的 `userData`，
   * 再在 Steamworks 后台把「Windows 路径」指到同一个地方即可。
   * 这个函数只是把路径算出来，方便打包检查和文档对照。
   */
  cloudDir(userDataPath) {
    return path.join(userDataPath, 'saves');
  }

  /** 启动时的自检信息，写进日志方便排查打包问题 */
  describe(userDataPath) {
    const dll = process.platform === 'win32' ? 'steam_api64.dll' : 'libsteam_api.so';
    const appDir = path.dirname(process.execPath);
    const hasRedist = fs.existsSync(path.join(appDir, dll))
      || fs.existsSync(path.join(appDir, 'resources', dll));
    return {
      available: this.available,
      appId: this.appId,
      player: this.playerName(),
      steamId: this.playerId(),
      redistributable: hasRedist,
      redistributableName: dll,
      cloudDir: this.cloudDir(userDataPath),
      achievements: Object.keys(ACHIEVEMENTS).length,
    };
  }
}

const steam = new SteamBridge();

module.exports = { steam, ACHIEVEMENTS };
