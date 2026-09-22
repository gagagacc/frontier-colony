/**
 * 掉落与装备生成系统。
 *
 * 设计要点（对应「杀死野外精英怪可以给自己装备提升」）：
 *   - 普通怪掉材料/金币，精英怪必掉装备，Boss 掉多件 + 吸引核心。
 *   - 装备稀有度受【幸运 / 掉落品质 / 星球等级 / 巢穴等级】共同影响。
 *   - 有【自动收集】实验科技前，掉落物需要玩家亲自去捡 —— 这是刻意的摩擦，
 *     让「科技升级后可以自动收集」变成一个真正让人爽到的解锁。
 */

import { clamp, clamp01, dist, dist2, swapRemove } from '../core/math.js';
import { rnd } from '../core/rng.js';
import { bus, EV, notice } from '../core/events.js';
import {
  RARITY_DEF, AFFIX_DEF, EQUIP_DEF, WEAPON_DEF, RED_EFFECTS,
} from '../data/weapons.js';
import { RESOURCE_DEF } from '../data/tiles.js';
import { rollMaterialDrops } from '../data/materials.js';
import { settings } from '../core/settings.js';
import { makeWeaponInstance, makeEquipInstance } from './runState.js';

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'relic'];

/** 护甲三件套的槽位 id（掉落池 / 词缀标签都要用） */
export const ARMOR_SLOTS = ['helmet', 'chest', 'legs'];
/**
 * 装备槽位 -> 背包里的第几格。
 * 顺序和 data/weapons.js 的 EQUIP_ORDER 一致：头盔 0 / 胸甲 1 / 护腿 2 / 饰品 3-4。
 */
export const EQUIP_SLOTS_FOR = {
  helmet: [0],
  chest: [1],
  legs: [2],
  trinket: [3, 4],
  module: [],
  armor: [1],        // 旧档兼容：老的「护甲」并入胸甲
};

/** 把品质压到上限以内（"紫色及以下" 这类规则用） */
function capRarity(rarity, max) {
  const order = ['common', 'uncommon', 'rare', 'epic', 'relic'];
  const a = order.indexOf(rarity);
  const b = order.indexOf(max);
  if (a < 0) return max;
  if (b < 0) return rarity;
  return order[Math.min(a, b)];
}

/** 设置里的「始终自动收集」（纯塔防模式恒为开） */
function gameplayAutoCollect() {
  try { return !!settings.gameplay.autoCollect; } catch { return false; }
}

export class LootSystem {
  constructor(run) {
    this.run = run;
    this.enabled = true;
    this.collectTimer = 0;
    this._qb = [];
  }

  update(dt, game) {
    const run = this.run;
    this.updatePickups(dt);
    this.updateAutoCollect(dt);
    this.updateEffectsZones(dt);
  }

  // =========================================================
  //  怪物死亡掉落
  // =========================================================

  onEnemyKilled(enemy) {
    const run = this.run;
    const st = run.playerStats;
    const p = run.player;

    // 金币与经验直接结算（不用捡）
    const gold = Math.round(enemy.goldValue * (1 + st.get('goldMult')));
    run.addResource('gold', gold, { raw: true });
    run.gainXp(enemy.xpValue);
    if (gold > 0) bus.emit(EV.LOOT, { x: enemy.x, y: enemy.y, kind: 'gold', amount: gold });

    // 材料掉落进拾取物列表（需要捡）
    const matMult = (1 + st.get('matMult')) * (1 + st.get('lootQuality') * 0.5);
    for (const [kind, [lo, hi]] of Object.entries(enemy.loot || {})) {
      const amount = Math.round(run.rng.int(lo, hi) * matMult);
      if (amount <= 0) continue;
      this.spawnPickup(enemy.x, enemy.y, kind, amount);
    }

    // 「地图材料」掉落：纤维 / 木头 / 食物 / 水 / 燃料 / 冷却剂 / 数据核心……
    // 这些在开拓模式里主要靠出门采，纯塔防模式没有大世界，只能从怪身上出。
    // 所以这条线在两种模式里都开着（开拓模式算是额外补贴），稀有度决定谁能掉。
    const roleMult = enemy.boss ? 4 : enemy.elite ? 2.2 : 1;
    const extras = rollMaterialDrops({
      rng: run.rng,
      tier: Math.max(1, Math.min(5, enemy.tier || 1)),
      roleMult,
      dropMult: matMult,
    });
    for (const d of extras) {
      if (d.amount <= 0) continue;
      this.spawnPickup(enemy.x + rnd.range(-16, 16), enemy.y + rnd.range(-16, 16), d.kind, d.amount);
    }

    // 现场冶炼（实验科技）
    if (st.get('smeltOnKill')) {
      this.spawnPickup(enemy.x + rnd.range(-14, 14), enemy.y + rnd.range(-14, 14), 'metal', 1 + Math.floor(enemy.tier / 2));
      if (rnd.chance(0.3)) this.spawnPickup(enemy.x, enemy.y, 'sulfur', 1);
    }

    /*
     * 装备掉落规则（数值都写在这里，方便一眼看懂）：
     *
     *   精英怪：15% 概率掉一件「紫色及以下」的装备 —— 品质随怪潮波次上升。
     *           波次越高，掷出高品的概率越大（见 eliteRarityBonus）。
     *   Boss  ：必掉多件（紫及以下），并且额外有 10% 概率出一件**红色**。
     *   普通怪：1.2% 概率掉一件（低品）。
     *
     * 红色只从 Boss / 废弃基地 / 虫巢深处来，城镇永远造不出来 ——
     * 这是「最强装备必须靠冒险拿」这条线的三个入口。
     */
    if (enemy.boss) {
      const count = run.rng.int(3, 5);
      for (let i = 0; i < count; i++) {
        const item = this.rollEquipment({
          bonus: 1.2, tier: enemy.tier, maxRarity: 'epic',
          // Boss 的红色判定放在第一件上，避免一件 boss 掉 5 件红
          red: i === 0, redChance: 0.10,
        });
        if (item) this.spawnPickup(enemy.x + rnd.range(-20, 20), enemy.y + rnd.range(-20, 20), 'equip', 1, item);
      }
      if (st.get('relicChance') > 0 && run.rng.chance(st.get('relicChance'))) {
        const relic = this.rollEquipment({ bonus: 3, tier: enemy.tier, forceRarity: 'relic' });
        if (relic) this.spawnPickup(enemy.x, enemy.y - 24, 'equip', 1, relic);
      }
    } else if (enemy.elite) {
      if (run.rng.chance(0.15)) {
        const warpBonus = this.eliteRarityBonus();
        const item = this.rollEquipment({
          bonus: 0.5 + warpBonus, tier: enemy.tier, maxRarity: 'epic',
        });
        if (item) this.spawnPickup(enemy.x + rnd.range(-18, 18), enemy.y + rnd.range(-18, 18), 'equip', 1, item);
      }
      // 精英也可能掉吸引核心 / 遗物（实验科技）
      if (run.rng.chance(0.10 + (st.get('beaconCoreFind') || 0) * 0.15)) {
        this.spawnPickup(enemy.x, enemy.y - 16, 'beaconCore', 1);
      }
      const relicChance = st.get('relicChance');
      if (relicChance > 0 && run.rng.chance(relicChance)) {
        const relic = this.rollEquipment({ bonus: 3, tier: enemy.tier, forceRarity: 'relic' });
        if (relic) this.spawnPickup(enemy.x, enemy.y - 24, 'equip', 1, relic);
        notice('遗物出土', `你从 ${enemy.def.name} 的残骸里挖到了一件【红色】级装备。`, 'good');
      }
    } else if (run.rng.chance(0.012 + st.get('luck') * 0.03)) {
      const item = this.rollEquipment({ bonus: 0, tier: enemy.tier });
      if (item) this.spawnPickup(enemy.x, enemy.y, 'equip', 1, item);
    }

    bus.emit(EV.SFX, { name: enemy.boss ? 'explode' : 'kill' });
    if (enemy.boss) bus.emit(EV.SCREEN_SHAKE, { mag: 9, time: 0.5 });

    /*
     * 弹药掉落：怪身上也会爆出子弹。
     *
     * 为什么要有：弹药只能靠「按 R 花金属装填」补，打起来总在算子弹够不够，
     * 而虫子满身都是弹片这件事本身就很合理。现在打死怪有一定概率爆出一小堆子弹，
     * 数量 5~15 发（精英与 Boss 取上限、必掉），弹药够不够取决于你打得多不多。
     */
    const ammoDrop = this.rollAmmoDrop(enemy);
    if (ammoDrop > 0) {
      this.spawnPickup(enemy.x + rnd.range(-16, 16), enemy.y + rnd.range(-16, 16), 'ammo', ammoDrop);
    }
  }

  /** 这只怪该死出多少发子弹（0 = 不掉） */
  rollAmmoDrop(enemy) {
    const run = this.run;
    if (enemy.boss) return run.rng.int(12, 15);
    if (enemy.elite) return run.rng.int(8, 15);
    return run.rng.chance(0.55) ? run.rng.int(5, 10) : 0;
  }

  /**
   * 精英怪掉落的品质加成：随怪潮波次上升。
   * 第 1 波 +0，第 10 波 +0.45，第 20 波 +0.95（上限 +1.5）。
   * 这样「打得越深，精英掉的越好」，而不是从头到尾一个概率。
   */
  eliteRarityBonus() {
    const wave = this.run?.wave?.number || 0;
    return Math.min(1.5, wave * 0.045);
  }

  /** Boss / 巢穴专属掉落 */
  dropNestLoot(nest) {
    const run = this.run;
    const count = 4 + nest.tier;
    for (let i = 0; i < count; i++) {
      const a = rnd.next() * Math.PI * 2;
      const r = rnd.range(30, 130);
      const item = this.rollEquipment({ bonus: 1 + nest.tier * 0.3, tier: nest.tier, maxRarity: 'epic' });
      if (item) this.spawnPickup(nest.x + Math.cos(a) * r, nest.y + Math.sin(a) * r, 'equip', 1, item);
    }
    for (let i = 0; i < 3 + nest.tier; i++) {
      this.spawnPickup(nest.x + rnd.range(-90, 90), nest.y + rnd.range(-90, 90), 'beaconCore', 0, null, true);
    }
  }

  // =========================================================
  //  拾取物
  // =========================================================

  spawnPickup(x, y, kind, amount = 1, item = null, auto = false) {
    const run = this.run;
    const spot = run.world.circleBlocked(x, y, 6) ? run.world.findOpenSpot(x, y, 70) : { x, y };
    run.pickups.push({
      id: 'pk' + (run.pickups.length + 1) + '_' + Math.floor(run.time * 10),
      kind, amount, item,
      x: spot.x, y: spot.y,
      vx: rnd.range(-40, 40), vy: rnd.range(-40, 40),
      life: 9999,
      bob: rnd.next() * Math.PI * 2,
      spawnAnim: 0.3,
      forced: auto,
    });
    // 自动收集已解锁（或设置里开了「始终自动收集」）时直接进背包
    if (run.hasFeature('autoCollect') && auto) this.collectAt(run.pickups[run.pickups.length - 1]);
  }

  updatePickups(dt) {
    const run = this.run;
    const p = run.player;
    const st = p.statSet;
    const magnet = 96 + st.get('carryMult') * 0 + (run.hasFeature('autoCollect') ? st.get('autoCollectRadius') || 300 : 0);
    for (let i = run.pickups.length - 1; i >= 0; i--) {
      const pk = run.pickups[i];
      if (pk.spawnAnim > 0) pk.spawnAnim -= dt;
      pk.bob += dt * 3;
      // 惯性
      pk.x += pk.vx * dt;
      pk.y += pk.vy * dt;
      pk.vx *= Math.exp(-6 * dt);
      pk.vy *= Math.exp(-6 * dt);

      if (p.dead) continue;
      const d = dist(pk.x, pk.y, p.x, p.y);
      if (d < magnet) {
        // 吸附
        const a = Math.atan2(p.y - pk.y, p.x - pk.x);
        const speed = clamp(420 - d, 160, 420);
        pk.x += Math.cos(a) * speed * dt;
        pk.y += Math.sin(a) * speed * dt;
      }
      if (d < 30) this.collectAt(pk, i);
    }
  }

  collectAt(pk, index = -1) {
    const run = this.run;
    const p = run.player;

    switch (pk.kind) {
      case 'gold':
        run.addResource('gold', pk.amount, { raw: true });
        bus.emit(EV.LOOT, { x: pk.x, y: pk.y, kind: 'gold', amount: pk.amount });
        break;
      case 'equip': {
        const item = pk.item;
        if (!item) break;
        const res = this.addItemToInventory(item);
        // 兼容旧存档 / 未知品质：查不到就当普通，绝不让一条提示把整个掉落循环炸掉
        const rarName = RARITY_DEF[item.rarity]?.name || '普通';
        if (res === 'equipped') {
          notice('自动装备', `${item.name}（${rarName}）已装备。`, 'good');
        } else if (res === 'hotbar') {
          const slot = p.weapons.findIndex(w => w && w.uid === item.uid) + 1;
          notice('已放入快捷栏', `${item.name}（${rarName}）放进了快捷栏 ${slot || '?'} 号位 —— 按 ${slot || '1'} 切换。`, 'good');
        } else if (res === 'bag') {
          notice('获得装备', `${item.name}（${rarName}）已放入背包。按 Tab 查看。`, 'good');
        } else {
          notice('背包已满', `${item.name} 放不下了 —— 回基地整理，或升级负重。`, 'warn');
          break;   // 留在原地
        }
        bus.emit(EV.SFX, { name: 'pickup' });
        break;
      }
      case 'ammo': {
        // 子弹拾取：直接进弹仓（不占仓库），满了就留在原地
        const max = p.ammoMax || 200;
        const before = p.ammo;
        p.ammo = Math.min(max, Math.round(p.ammo + pk.amount));
        const got = p.ammo - before;
        if (got <= 0) return;
        bus.emit(EV.LOOT, { x: pk.x, y: pk.y, kind: 'ammo', amount: got, color: RESOURCE_DEF.ammo?.color });
        if (rnd.chance(0.5)) bus.emit(EV.SFX, { name: 'pickup' });
        break;
      }
      default: {
        // 材料
        const added = run.addResource(pk.kind, pk.amount);
        if (added <= 0) return;   // 仓库满了，留在原地
        const def = RESOURCE_DEF[pk.kind];
        bus.emit(EV.LOOT, { x: pk.x, y: pk.y, kind: pk.kind, amount: added, color: def?.color });
        if (rnd.chance(0.5)) bus.emit(EV.SFX, { name: 'pickup' });
        break;
      }
    }
    const idx = index >= 0 ? index : run.pickups.indexOf(pk);
    if (idx >= 0) swapRemove(run.pickups, idx);
  }

  /** 自动收集：把场上所有掉落一次性收回（对应「科技升级后可以自动收集」） */
  autoCollectField() {
    const run = this.run;
    let count = 0;
    for (let i = run.pickups.length - 1; i >= 0; i--) {
      const pk = run.pickups[i];
      // 只回收远处/战场上的，装备需要玩家自己决定要不要（背包满了会卡住）
      if (pk.kind === 'equip') {
        const res = this.addItemToInventory(pk.item);
        if (res === 'bag' || res === 'equipped' || res === 'hotbar') { swapRemove(run.pickups, i); count++; }
        continue;
      }
      this.collectAt(pk, i);
      count++;
    }
    if (count) notice('回收无人机', `自动回收了 ${count} 份战场掉落。`, 'good');
    return count;
  }

  updateAutoCollect(dt) {
    const run = this.run;
    // 自动收集有两个来源：科技解锁的，和设置里玩家手动打开的「始终自动收集」
    if (!run.hasFeature('autoCollect') && !gameplayAutoCollect()) return;
    this.collectTimer -= dt;
    if (this.collectTimer > 0) return;
    this.collectTimer = 4;
    const radius = Math.max(run.playerStats.get('autoCollectRadius') || 300, gameplayAutoCollect() ? 900 : 0);
    const p = run.player;
    // 纯塔防没有角色，也就没有「走过去捡」这回事：整片阵地都算收集范围
    const r2 = run.isTowerDefense ? Infinity : radius * radius;
    for (let i = run.pickups.length - 1; i >= 0; i--) {
      const pk = run.pickups[i];
      if (pk.kind === 'equip') continue;
      if (dist2(pk.x, pk.y, p.x, p.y) > r2) continue;
      this.collectAt(pk, i);
    }
  }

  /** 地面效果区域（酸池 / 孢子云） */
  updateEffectsZones(dt) {
    const run = this.run;
    for (let i = run.effects.length - 1; i >= 0; i--) {
      const fx = run.effects[i];
      fx.life -= dt;
      if (fx.life <= 0) { swapRemove(run.effects, i); continue; }
      if (fx.kind !== 'pool') continue;
      fx.tickCd -= dt;
      if (fx.tickCd > 0) continue;
      fx.tickCd = 0.5;
      const dmg = (fx.dps || 6) * 0.5;
      if (fx.friendly) {
        // 玩家的酸池伤害敌人
        const near = run.spatial.query(fx.x, fx.y, fx.r, this._qb);
        for (const e of near) {
          if (e.kind !== 'enemy' || e.dead) continue;
          run.enemySystem.damage(e, dmg, { source: 'pool' });
          if (fx.armorDebuff) e.armor = Math.max(0, e.armor - fx.armorDebuff * 0.1);
        }
      } else {
        if (!run.player.dead && dist(run.player.x, run.player.y, fx.x, fx.y) < fx.r + run.player.r) {
          const resist = run.playerStats.get('acidResist');
          run.playerSystem.hurt(dmg * (1 - clamp01(resist)), null, { silent: true, environmental: true, source: '酸池' });
        }
      }
    }
  }

  // =========================================================
  //  装备生成
  // =========================================================

  /**
   * 掷一件装备。
   * @param {object} opts
   *   - bonus       额外幸运（Boss / 高级来源用）
   *   - tier        来源等级
   *   - forceRarity 直接指定品质
   *   - maxRarity   品质上限（例如「紫色及以下」）
   *   - red         是否允许出红色（只有明确写了「红装掉落」的渠道才传 true）
   */
  rollEquipment(opts = {}) {
    const run = this.run;
    const st = run.playerStats;
    const luck = st.get('luck') + (opts.bonus || 0) * 0.25 + (st.get('lootQuality') || 0);
    const tierBonus = (opts.tier || 1) * 0.06;

    // 稀有度权重（只在前四档里掷；红色永远是「额外判定」，见下）
    // 注意键名必须用 `e`（value 字段）：RNG.weighted 只认 e/value/v/t，
    // 写成 { r, w } 时它会把整个包装对象当成结果返回，
    // 于是 rarity 变成一个对象 —— 查 RARITY_DEF 得 undefined，
    // 拾取时读 .name 直接抛异常（而且测试里只判真假，看不出来）。
    const weights = RARITY_ORDER.slice(0, 4).map((r, i) => ({
      e: r,
      w: RARITY_DEF[r].weight * Math.pow(1 + luck * 0.5 + tierBonus, i),
    }));
    let rarity = opts.forceRarity || run.rng.weighted(weights) || 'common';
    // 兜底：任何不认识的品质一律降为白色，绝不让它流到 UI 里
    if (typeof rarity !== 'string' || !RARITY_DEF[rarity]) rarity = 'common';
    if (opts.maxRarity) rarity = capRarity(rarity, opts.maxRarity);
    if (typeof rarity !== 'string' || !RARITY_DEF[rarity]) rarity = 'common';
    // 红色：概率极低，但一旦出就是「必带特殊效果」的那一档
    if (opts.red && run.rng.chance(opts.redChance ?? 0.03)) rarity = 'relic';

    const isWeapon = run.rng.chance(0.55);
    if (isWeapon) {
      const pool = Object.values(WEAPON_DEF).filter(w => {
        if (w.mounted) return false;
        if (w.exclusive && w.exclusive !== run.characterId) return false;
        if (w.tags?.includes('starter') && run.rng.chance(0.5)) return false;
        return true;
      });
      if (!pool.length) return null;
      const def = run.rng.pick(pool);
      const item = makeWeaponInstance(def.id, rarity, this.rollAffixes(rarity, 'weapon'));
      this.applyAffixStats(item);
      item.name = prefixFor(rarity) + def.name;
      this.applyRedEffect(item);
      return item;
    }

    const pool = Object.values(EQUIP_DEF).filter(d => !d.slot || ARMOR_SLOTS.includes(d.slot) || d.slot === 'trinket');
    const def = run.rng.pick(pool);
    const item = makeEquipInstance(def.id, rarity, this.rollAffixes(rarity, def.slot));
    item.name = prefixFor(rarity) + def.name;
    this.applyAffixStats(item);
    this.applyRedEffect(item);
    return item;
  }

  /**
   * 给红色品质装备挂上一条特殊效果。
   * 红色装备的定义就是「必带一条改变玩法的效果」，所以这里不做概率判定。
   */
  applyRedEffect(item) {
    if (!item || item.rarity !== 'relic' || item.redEffect) return item;
    const run = this.run;
    const pool = RED_EFFECTS.filter(e => !this._usedRedIds?.has(e.id) || RED_EFFECTS.length <= 3);
    const pick = run.rng.pick(pool.length ? pool : RED_EFFECTS);
    if (!pick) return item;
    item.redEffect = { id: pick.id, name: pick.name, desc: pick.desc, effect: { ...pick.effect } };
    item.desc = `${item.desc ? item.desc + ' ' : ''}【${pick.name}】${pick.desc}`;
    item.icon = item.icon || '✦';
    notice('红色装备', `${item.name} —— ${pick.name}：${pick.desc}`, 'good');
    return item;
  }

  rollAffixes(rarity, tag) {
    const count = RARITY_DEF[rarity]?.affixes ?? 0;
    if (!count) return [];
    const run = this.run;
    const pool = AFFIX_DEF.filter(a => !a.tags || a.tags.includes(tag) || (tag === 'weapon' && !a.tags));
    const out = [];
    const used = new Set();
    for (let i = 0; i < count && pool.length; i++) {
      const a = run.rng.pick(pool.filter(x => !used.has(x.id)));
      if (!a) break;
      used.add(a.id);
      const rarityMult = 1 + (RARITY_ORDER.indexOf(rarity)) * 0.22;
      let value = run.rng.range(a.value[0], a.value[1]) * rarityMult;
      if (a.int) value = Math.max(1, Math.round(value));
      out.push({ id: a.id, name: a.name, stat: a.stat, value });
    }
    return out;
  }

  applyAffixStats(item) {
    if (!item.stats) item.stats = {};
    for (const af of item.affixes || []) {
      item.stats[af.stat] = (item.stats[af.stat] || 0) + af.value;
    }
  }

  // =========================================================
  //  背包
  // =========================================================

  /**
   * 返回 'equipped' | 'hotbar' | 'bag' | 'full'
   *
   * 武器的归属规则（玩家明确要求）：
   *   快捷栏还有空位 → 直接放进去（不自动切换，也不比数值）
   *   四个位置都满了 → 进背包
   * 以前是「比当前武器强 15% 就自动替换」，玩家捡到一把新枪却发现手上那把
   * 被换掉了，或者明明有空位却进了背包 —— 现在只按「有没有位置」决定。
   */
  addItemToInventory(item) {
    const run = this.run;
    const p = run.player;
    if (item.type === 'weapon') {
      const maxSlots = 4;
      if (p.weapons.length < maxSlots) {
        p.weapons.push(item);
        if (p.weapons.length === 1) p.weaponIndex = 0;
        run.recomputeStats();
        return 'hotbar';
      }
      return this.pushToBag(item) ? 'bag' : 'full';
    }
    // 护甲（头盔 / 胸甲 / 护腿）与饰品：空槽自动穿，否则进背包
    if (item.slot) {
      const slotsFor = EQUIP_SLOTS_FOR[item.slot] || [];
      if (item.slot === 'module') return this.pushToBag(item) ? 'bag' : 'full';
      for (const s of slotsFor) {
        if (!p.equipment[s]) {
          p.equipment[s] = item;
          run.recomputeStats();
          return 'equipped';
        }
      }
      // 比身上的好就替换
      for (const s of slotsFor) {
        if (scoreItem(item) > scoreItem(p.equipment[s]) * 1.15) {
          const old = p.equipment[s];
          p.equipment[s] = item;
          if (old && !this.pushToBag(old)) {
            p.equipment[s] = old;
            return 'full';
          }
          run.recomputeStats();
          return 'equipped';
        }
      }
    }
    return this.pushToBag(item) ? 'bag' : 'full';
  }

  pushToBag(item) {
    const run = this.run;
    const p = run.player;
    const weight = itemWeight(item);
    if (p.carryUsed + weight > p.carryMax) return false;
    p.inventory.push(item);
    p.carryUsed += weight;
    return true;
  }

  removeFromBag(uid) {
    const run = this.run;
    const p = run.player;
    const i = p.inventory.findIndex(x => x.uid === uid);
    if (i < 0) return null;
    const item = p.inventory[i];
    swapRemove(p.inventory, i);
    p.carryUsed = Math.max(0, p.carryUsed - itemWeight(item));
    return item;
  }

  /** 出售一件背包装备 */
  sellItem(uid) {
    const run = this.run;
    const item = this.removeFromBag(uid);
    if (!item) return 0;
    const base = 20 + RARITY_ORDER.indexOf(item.rarity) * 45;
    const gain = Math.round(base * (1 + run.playerStats.get('sellBonus')) * (1 + run.playerStats.get('goldMult')));
    run.addResource('gold', gain, { raw: true });
    return gain;
  }
}

// ---------------- 工具 ----------------

export function itemWeight(item) {
  if (!item) return 0;
  const r = RARITY_ORDER.indexOf(item.rarity) + 1;
  return item.type === 'weapon' ? 6 + r : 4 + r;
}

/** 粗略的战力评分，用于自动装备判断 */
export function scoreItem(item) {
  if (!item) return 0;
  const r = (RARITY_ORDER.indexOf(item.rarity) + 1) * 12;
  let s = r;
  if (item.type === 'weapon') {
    const def = item.def || WEAPON_DEF[item.weaponId];
    if (def) s += (def.damage / Math.max(0.08, def.cd)) * 0.9 + (def.range || 0) * 0.02;
  }
  for (const [k, v] of Object.entries(item.stats || {})) {
    if (typeof v !== 'number') continue;
    if (k === 'damage' || k === 'attackSpeed') s += v * 90;
    else if (k === 'hpMax') s += v * 0.5;
    else if (k === 'armor') s += v * 1.4;
    else s += Math.abs(v) * 12;
  }
  return s;
}

function prefixFor(rarity) {
  switch (rarity) {
    case 'uncommon': return '改良·';
    case 'rare': return '军用·';
    case 'epic': return '实验型·';
    case 'legendary': return '传说·';
    case 'relic': return '遗物·';
    default: return '';
  }
}

export { RARITY_ORDER, prefixFor };
