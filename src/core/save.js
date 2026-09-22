/**
 * 存档管理器。
 *
 * 两条通道：
 *   - localStorage：同步，浏览器/桌面都能用，作为缓存与后备。
 *   - Electron IPC 落盘到 userData/saves/*.json：异步，更耐用、方便玩家备份。
 *
 * 所有读取接口都设计成同步（优先走内存缓存），
 * 磁盘数据在启动时后台同步进内存缓存，UI 不必处理 Promise。
 */


import { SAVE_KEY } from './config.js';

const SLOT_LABEL = {
  auto: '自动存档',
  slot1: '存档位 1',
  slot2: '存档位 2',
  slot3: '存档位 3',
};

export class SaveManager {
  constructor() {
    this.api = globalThis.frontier?.save ?? null;   // preload 暴露的桥（异步）
    this.meta = new Map();                          // slot -> meta
    this.data = new Map();                          // slot -> 完整存档对象（内存镜像）
    this.ready = false;
    this.lastError = null;
    this._loadLocal();
    this._syncFromDisk();
  }

  _lsKey(slot) { return `${SAVE_KEY}:${slot}`; }

  /** 同步读 localStorage，把数据装进内存镜像 */
  _loadLocal() {
    for (const slot of Object.keys(SLOT_LABEL)) {
      try {
        const raw = localStorage.getItem(this._lsKey(slot));
        if (!raw) continue;
        const obj = JSON.parse(raw);
        this.data.set(slot, obj);
        this.meta.set(slot, metaOf(obj, slot));
      } catch (err) {
        console.warn('[save] localStorage 读取失败', slot, err);
      }
    }
  }

  /** 后台把磁盘上的存档同步进内存（桌面版） */
  async _syncFromDisk() {
    if (!this.api) { this.ready = true; return; }
    try {
      const list = await this.api.list();
      if (!Array.isArray(list)) throw new Error('list() 未返回数组');
      for (const item of list) {
        if (!item || !item.slot) continue;
        const obj = await this.api.read(item.slot);
        if (!obj) continue;
        // 磁盘版本更新就用磁盘的
        const local = this.data.get(item.slot);
        if (!local || (obj.savedAt || 0) >= (local.savedAt || 0)) {
          this.data.set(item.slot, obj);
          this.meta.set(item.slot, metaOf(obj, item.slot));
        }
      }
      this.ready = true;
    } catch (err) {
      // 拿不到磁盘数据不算致命：localStorage 那份还在
      this.lastError = err?.message || String(err);
      console.warn('[save] 磁盘存档同步失败，改用 localStorage：', this.lastError);
      this.ready = true;
    }
  }

  exists(slot = 'auto') {
    return this.data.has(slot) || !!this._readLocalOnly(slot);
  }

  _readLocalOnly(slot) {
    try {
      const raw = localStorage.getItem(this._lsKey(slot));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  /** 同步读取：内存镜像 -> localStorage */
  read(slot = 'auto') {
    if (this.data.has(slot)) return this.data.get(slot);
    const local = this._readLocalOnly(slot);
    if (local) {
      this.data.set(slot, local);
      this.meta.set(slot, metaOf(local, slot));
    }
    return local;
  }

  write(slot, data) {
    const payload = { ...data, slot, label: SLOT_LABEL[slot] || slot, savedAt: Date.now() };
    let ok = false;

    // 1) 内存镜像 + localStorage（同步，保证立刻可读）
    this.data.set(slot, payload);
    try {
      localStorage.setItem(this._lsKey(slot), JSON.stringify(payload));
      ok = true;
    } catch (err) {
      console.warn('[save] localStorage 写入失败（可能超出配额）', err);
    }

    // 2) 落盘（异步，不阻塞游戏）
    if (this.api) {
      try {
        const res = this.api.write(slot, payload);
        if (res && typeof res.then === 'function') {
          res.then(v => { if (!v) console.warn('[save] 落盘返回失败', slot); })
            .catch(err => console.warn('[save] 落盘失败', err));
        }
      } catch (err) {
        console.warn('[save] 落盘调用失败', err);
      }
    }

    this.meta.set(slot, metaOf(payload, slot));
    return ok || !!this.api;
  }

  remove(slot = 'auto') {
    this.data.delete(slot);
    this.meta.delete(slot);
    try { localStorage.removeItem(this._lsKey(slot)); } catch { /* ignore */ }
    if (this.api) {
      try {
        const res = this.api.remove(slot);
        if (res && typeof res.catch === 'function') res.catch(() => {});
      } catch { /* ignore */ }
    }
    return true;
  }

  /** 某个槽位的摘要信息（给菜单显示） */
  getMeta(slot = 'auto') {
    if (this.meta.has(slot)) return this.meta.get(slot);
    const raw = this.read(slot);
    if (!raw) return null;
    const m = metaOf(raw, slot);
    this.meta.set(slot, m);
    return m;
  }

  list() {
    const out = [];
    for (const slot of Object.keys(SLOT_LABEL)) {
      const m = this.getMeta(slot);
      out.push(m ? { ...m, exists: true } : { slot, label: SLOT_LABEL[slot], exists: false });
    }
    return out;
  }

  exportSlot(slot = 'auto') {
    const raw = this.read(slot);
    return raw ? JSON.stringify(raw) : null;
  }

  importSlot(slot, text) {
    try {
      const data = JSON.parse(text);
      if (!data || !data.run) throw new Error('缺少 run 数据');
      this.write(slot, data);
      return true;
    } catch (err) {
      console.error('[save] 导入失败', err);
      return false;
    }
  }
}

function metaOf(raw, slot) {
  const run = raw?.run || {};
  return {
    slot,
    label: raw?.label || SLOT_LABEL[slot] || slot,
    savedAt: raw?.savedAt || 0,
    playTime: run.playTime || 0,
    planet: run.planetIndex != null ? `第 ${run.planetIndex + 1} 星球` : '未知星球',
    planetIndex: run.planetIndex ?? 0,
    character: run.characterId || 'unknown',
    characterName: CHAR_NAMES[run.characterId] || '',
    level: run.player?.level || 1,
    day: Math.floor((run.time || 0) / 240) + 1,
    nestsCleared: run.stats?.nestsDestroyed || 0,
    claimed: !!run.planetClaimed,
  };
}

// 避免为了一个名字去 import 整个角色表（也就不会引入循环依赖）
const CHAR_NAMES = {
  engineer: '工程师', pioneer: '开拓者', pilot: '驾驶员', biologist: '生物学家',
};

export { SLOT_LABEL };
