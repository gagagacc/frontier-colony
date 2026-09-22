/**
 * 城镇经营与人口系统。
 *
 * 规则（按设定）：
 *   - 人口只能待在城镇里，塔防时死守城镇。
 *   - 人口随城镇规模自然增长；规模到了一定等级，上级会派遣移民。
 *   - 人口被分配到建筑岗位，产出食物 / 金属 / 金币 / 研究。
 *   - 基地被摧毁 → 人口全灭，一切重建。
 */

import { clamp, clamp01, dist, swapRemove } from '../core/math.js';
import { bus, EV, notice } from '../core/events.js';
import { POP_TIERS, popTier, TOWN_BUILDING_DEF } from '../data/planets.js';
import { craftLevelFor, canCraftRarity, craftCost } from '../data/crafting.js';
import { RARITY_DEF } from '../data/weapons.js';
import { makeWeaponInstance, makeEquipInstance } from './runState.js';

const POP_GROWTH_INTERVAL = 6;      // 每 6 秒结算一次人口增长
const FOOD_PER_POP = 0.02;          // 每人每秒消耗食物

export class TownSystem {
  constructor(run) {
    this.run = run;
    this.enabled = true;
    this.growthTimer = POP_GROWTH_INTERVAL;
    this.prodTimer = 0;
    this.produceAccum = {};
  }

  update(dt, game) {
    const run = this.run;
    this.updatePopulation(dt);
    this.updateProduction(dt);
    this.updateTier(dt);
  }

  // =========================================================
  //  制造（军械工坊）
  // =========================================================

  /** 制造等级：由人口等级决定（城镇越大，能造的东西越好） */
  get craftLevel() {
    const idx = POP_TIERS.indexOf(popTier(this.run.population));
    return craftLevelFor(Math.max(0, idx));
  }

  get hasWorkshop() {
    return this.run.townBuildings.some(b => b.type === 'workshop');
  }

  /**
   * 制造一件装备。
   * @param {object} entry { kind:'equip'|'weapon', id, name, tier }
   * @param {string} rarity 目标品质
   * @returns {'ok'|'noWorkshop'|'rarityLocked'|'cost'|'bad'}
   */
  craft(entry, rarity) {
    const run = this.run;
    if (!entry || !entry.id) return 'bad';
    if (!this.hasWorkshop) return 'noWorkshop';
    const lv = this.craftLevel;
    if (!canCraftRarity(rarity, lv)) return 'rarityLocked';
    const cost = craftCost(entry, rarity, lv);
    if (!run.canAfford(cost)) return 'cost';
    run.pay(cost);

    const item = entry.kind === 'weapon'
      ? makeWeaponInstance(entry.id, rarity)
      : makeEquipInstance(entry.id, rarity);
    if (!item) return 'bad';
    // 制造出来的装备也吃词缀（品质决定条数），手感和掉落一致
    item.affixes = run.loot ? run.loot.rollAffixes(rarity, entry.kind === 'weapon' ? 'weapon' : (item.slot || 'armor')) : [];
    if (run.loot) run.loot.applyAffixStats(item);

    const res = run.loot ? run.loot.addItemToInventory(item) : 'bag';
    if (res === 'full') {
      run.loot.spawnPickup(run.base.x + 40, run.base.y + 40, 'equip', 1, item);
    }
    bus.emit(EV.SFX, { name: 'build' });
    run.addLog(`制造 ${item.name}（${RARITY_DEF[rarity]?.name || rarity}）`);
    return 'ok';
  }

  // =========================================================
  //  人口
  // =========================================================

  get popCap() {
    const run = this.run;
    let cap = 4 + Math.round(run.playerStats.get('popCap'));
    for (const b of run.townBuildings) {
      const def = TOWN_BUILDING_DEF[b.type];
      if (def?.popCap) cap += def.popCap;
    }
    // 基地全毁则没有住所
    if (!run.bases.some(b => !b.destroyed)) cap = Math.min(cap, 2);
    return cap;
  }

  get jobsTotal() {
    const run = this.run;
    let jobs = 0;
    for (const b of run.townBuildings) {
      const def = TOWN_BUILDING_DEF[b.type];
      if (def?.jobs) jobs += def.jobs + Math.round(run.playerStats.get('jobSlots'));
    }
    return jobs;
  }

  get idlePop() { return Math.max(0, this.run.population - this.assignedPop()); }

  assignedPop() {
    let n = 0;
    for (const b of this.run.townBuildings) n += b.workers || 0;
    return n;
  }

  updatePopulation(dt) {
    const run = this.run;
    // 食物消耗
    const need = run.population * FOOD_PER_POP * (1 - clamp01(run.playerStats.get('foodEfficiency')) * 0.5);
    if (need > 0) {
      const food = run.resources.food || 0;
      if (food >= need * dt) run.resources.food = food - need * dt;
      else {
        // 断粮：人口开始流失
        run.resources.food = 0;
        run._starving = (run._starving || 0) + dt;
        if (run._starving > 20) {
          run._starving = 0;
          if (run.population > 0) {
            run.population--;
            notice('殖民地断粮', '有殖民者因饥饿离开了。补充食物（水培农场 / 采集 / 太空快递）。', 'danger');
          }
        }
        return;
      }
    }

    this.growthTimer -= dt;
    if (this.growthTimer > 0) return;
    this.growthTimer = POP_GROWTH_INTERVAL;

    const cap = this.popCap;
    if (run.population >= cap) return;
    if (!run.bases.some(b => !b.destroyed)) return;

    // 增长率：受科技、士气、食物储备影响
    let rate = 0.06 + run.playerStats.get('popGrowthMult') * 0.09;
    for (const b of run.townBuildings) {
      const def = TOWN_BUILDING_DEF[b.type];
      if (def?.morale) rate += def.morale * 0.04;
    }
    // 食物充足加成
    if ((run.resources.food || 0) > run.population * 4) rate *= 1.35;
    rate *= 1 + run.planetIndex * 0.08;

    run._popAccum = (run._popAccum || 0) + rate;
    if (run._popAccum >= 1) {
      const gain = Math.floor(run._popAccum);
      run._popAccum -= gain;
      run.population = Math.min(cap, run.population + gain);
      bus.emit(EV.POPULATION, { amount: gain, total: run.population });
      notice('移民抵达', `上级派遣了 ${gain} 名殖民者。当前人口 ${run.population}/${cap}。`, 'good');
    }
  }

  updateTier(dt) {
    const run = this.run;
    const tier = popTier(run.population);
    const idx = POP_TIERS.indexOf(tier);
    if (idx !== run.townTier) {
      const rising = idx > run.townTier;
      run.townTier = idx;
      if (rising) {
        bus.emit(EV.SFX, { name: 'unlock' });
        notice('城镇升级', `${tier.name} —— ${tier.desc}`, 'good');
        run.addLog(`城镇升为 ${tier.name}`);
        bus.emit('townTierUp', { index: idx, name: tier.name });
      }
    }
  }

  // =========================================================
  //  生产
  // =========================================================

  updateProduction(dt) {
    const run = this.run;
    const eff = 1 + run.playerStats.get('workerEfficiency');
    const rate = eff * dt;
    let anyProduced = false;

    for (const b of run.townBuildings) {
      if (!b.workers) continue;
      const def = TOWN_BUILDING_DEF[b.type];
      if (!def) continue;
      for (const [kind, per] of Object.entries(def.produce || {})) {
        const amount = per * b.workers * rate;
        this.produceAccum[kind] = (this.produceAccum[kind] || 0) + amount;
        if (this.produceAccum[kind] >= 1) {
          const whole = Math.floor(this.produceAccum[kind]);
          this.produceAccum[kind] -= whole;
          const added = run.addResource(kind, whole, { raw: true });
          if (added > 0) anyProduced = true;
        }
      }
      if (def.researchRate) {
        this.produceAccum.research = (this.produceAccum.research || 0) + def.researchRate * b.workers * rate;
        if (this.produceAccum.research >= 1) {
          const whole = Math.floor(this.produceAccum.research);
          this.produceAccum.research -= whole;
          run.resources.research = (run.resources.research || 0) + whole;
          anyProduced = true;
        }
      }
    }

    // 税收（实验科技）
    const passive = run.playerStats.get('passiveGold');
    if (passive > 0) {
      this.produceAccum.gold = (this.produceAccum.gold || 0) + passive * dt;
      if (this.produceAccum.gold >= 1) {
        const whole = Math.floor(this.produceAccum.gold);
        this.produceAccum.gold -= whole;
        run.addResource('gold', whole, { raw: true });
      }
    }
  }

  // =========================================================
  //  建造与岗位
  // =========================================================

  placeBuilding(type, x, y) {
    const run = this.run;
    const def = TOWN_BUILDING_DEF[type];
    if (!def) return null;
    // 必须解锁（城镇等级或科技）
    if (!this.isUnlocked(type)) {
      notice('尚未解锁', `${def.name} 需要更高的城镇等级或对应科技。`, 'warn');
      return null;
    }
    if (!run.canAfford(def.cost)) {
      notice('资源不足', `建造 ${def.name} 需要更多资源。`, 'warn');
      return null;
    }
    const spot = run.world.findOpenSpot(x, y, 200);
    // 必须在基地附近（纯塔防模式的范围是整片阵地）
    const near = run.bases.some(b => !b.destroyed && dist(spot.x, spot.y, b.x, b.y) < run.buildRadiusFrom(b));
    if (!near) {
      notice('离基地太远', '城镇建筑必须建在基地范围内（人口不会离开城镇）。', 'warn');
      return null;
    }
    run.pay(def.cost);
    const b = {
      id: 'tb' + (run.townBuildings.length + 1) + '_' + Math.floor(run.time),
      type, x: spot.x, y: spot.y, workers: 0,
      hp: 300, maxHp: 300,
    };
    run.townBuildings.push(b);
    bus.emit(EV.SFX, { name: 'build' });
    notice('建筑落成', `${def.name} 已投入使用。${def.jobs ? `提供 ${def.jobs} 个岗位。` : ''}`, 'good');
    // 自动派人
    this.autoAssign();
    return b;
  }

  isUnlocked(type) {
    const run = this.run;
    /*
     * 判断依据是「**已经达到过**的城镇等级里有没有解锁它」，而不是只看当前这一档。
     *
     * 原来的写法只看当前档的 unlock 列表，于是「定居点解锁工坊」这条规则
     * 在城镇升到拓荒城市之后就失效了 —— 工坊突然变成造不了。
     * 解锁应该是累积的：达到了就不会再失去。
     */
    for (const t of POP_TIERS) {
      if (run.population < t.pop) break;
      if (t.unlock.includes(type)) return true;
    }
    // 部分建筑靠科技解锁
    const techUnlocks = { farm: 't_farm', clinic: 't_clinic', lab: 't_lab', market: 't_trade' };
    const techId = techUnlocks[type];
    if (techId && run.unlockedTech.has(techId)) return true;
    // 最初级建筑永远可建
    return ['hab', 'water'].includes(type);
  }

  /** 把空闲人口自动分配到岗位 */
  autoAssign() {
    const run = this.run;
    let idle = this.idlePop;
    if (idle <= 0) return;
    for (const b of run.townBuildings) {
      const def = TOWN_BUILDING_DEF[b.type];
      if (!def?.jobs) continue;
      const max = def.jobs + Math.round(run.playerStats.get('jobSlots'));
      while ((b.workers || 0) < max && idle > 0) {
        b.workers = (b.workers || 0) + 1;
        idle--;
      }
      if (idle <= 0) break;
    }
  }

  setWorkers(buildingId, count) {
    const run = this.run;
    const b = run.townBuildings.find(x => x.id === buildingId);
    if (!b) return false;
    const def = TOWN_BUILDING_DEF[b.type];
    const max = (def?.jobs || 0) + Math.round(run.playerStats.get('jobSlots'));
    const target = clamp(count, 0, max);
    const delta = target - (b.workers || 0);
    if (delta > 0 && this.idlePop < delta) return false;
    b.workers = target;
    return true;
  }

  demolish(buildingId) {
    const run = this.run;
    const i = run.townBuildings.findIndex(x => x.id === buildingId);
    if (i < 0) return false;
    const b = run.townBuildings[i];
    const def = TOWN_BUILDING_DEF[b.type];
    // 返还一半
    for (const [k, v] of Object.entries(def?.cost || {})) {
      run.addResource(k, Math.floor(v * 0.5), { raw: true });
    }
    swapRemove(run.townBuildings, i);
    notice('已拆除', `${def?.name || '建筑'} 已拆除，返还一半材料。`, 'info');
    return true;
  }

  /** 城镇给基地提供的协防火力（民兵营） */
  defensePower() {
    const run = this.run;
    let power = 0;
    for (const b of run.townBuildings) {
      const def = TOWN_BUILDING_DEF[b.type];
      if (def?.defense) power += def.defense * (b.workers || 0);
    }
    return power;
  }

  /** 供 UI 展示的产出总览 */
  productionSummary() {
    const run = this.run;
    const out = {};
    for (const b of run.townBuildings) {
      const def = TOWN_BUILDING_DEF[b.type];
      if (!def || !b.workers) continue;
      for (const [k, v] of Object.entries(def.produce || {})) {
        out[k] = (out[k] || 0) + v * b.workers;
      }
      if (def.researchRate) out.research = (out.research || 0) + def.researchRate * b.workers;
    }
    return out;
  }
}
