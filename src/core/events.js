/**
 * 极简事件总线 —— 让战斗/经济/UI 之间解耦。
 * UI 订阅事件做飘字和提示，游戏逻辑只管 emit。
 */

class Bus {
  constructor() {
    this.map = new Map();
  }

  on(type, fn) {
    let set = this.map.get(type);
    if (!set) { set = new Set(); this.map.set(type, set); }
    set.add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (payload) => { off(); fn(payload); });
    return off;
  }

  off(type, fn) {
    const set = this.map.get(type);
    if (set) { set.delete(fn); if (!set.size) this.map.delete(type); }
  }

  emit(type, payload) {
    const set = this.map.get(type);
    if (set) {
      for (const fn of Array.from(set)) {
        try { fn(payload); } catch (err) { console.error(`[bus] ${type} 处理出错`, err); }
      }
    }
    const any = this.map.get('*');
    if (any) for (const fn of Array.from(any)) { try { fn({ type, payload }); } catch { /* ignore */ } }
  }

  clear() { this.map.clear(); }
}

export const bus = new Bus();

/** 事件名常量，避免拼写错误 */
export const EV = {
  DAMAGE: 'damage',            // { x, y, amount, crit, targetType }
  KILL: 'kill',                // { enemy, byPlayer }
  LOOT: 'loot',                // { x, y, kind, amount, item }
  LEVEL_UP: 'levelUp',         // { level }
  WAVE_INCOMING: 'waveIncoming',
  WAVE_START: 'waveStart',
  WAVE_END: 'waveEnd',
  BASE_ATTACKED: 'baseAttacked',
  BASE_DESTROYED: 'baseDestroyed',
  NEST_DESTROYED: 'nestDestroyed',
  NOTICE: 'notice',            // { title, body, kind }
  TOAST: 'toast',
  XP: 'xp',
  GOLD: 'gold',
  MATERIAL: 'material',
  POPULATION: 'population',
  TECH_UNLOCKED: 'techUnlocked',
  PLANET_CLAIMED: 'planetClaimed',
  GAME_OVER: 'gameOver',
  SAVE: 'save',
  LOAD: 'load',
  SCREEN_SHAKE: 'shake',
  SFX: 'sfx',
  TOWER_BUILT: 'towerBuilt',
  TOWER_DESTROYED: 'towerDestroyed',
  STRUCTURE_DAMAGED: 'structureDamaged',
  REPAIR_DONE: 'repairDone',
  VEHICLE_ENTER: 'vehicleEnter',
  VEHICLE_EXIT: 'vehicleExit',
  DISCOVERY: 'discovery',      // { kind, label, x, y }
};

/** 便捷：发提示 */
export const notice = (title, body = '', kind = 'info') => bus.emit(EV.NOTICE, { title, body, kind });
