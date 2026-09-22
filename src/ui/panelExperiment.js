/**
 * 实验科技流程：先选【方向】(经营 / 塔防 / 探索)，再在四张卡里【四选一】。
 * 可以用金币刷新（费用指数递增）。
 */

import { DIR, DIR_DEF, EXP_MAP, EXP_RARITY, poolFor } from '../data/experiments.js';
import { h, button } from './dom.js';
import { fmt } from '../core/math.js';
import { bus, EV } from '../core/events.js';

export function openExperimentFlow(game, actions) {
  const run = game.run;
  const modals = game.ui.modals;

  if (run.pendingChoices <= 0) {
    modals.open({
      title: '实验科技',
      subtitle: '还没有可用的实验机会。',
      body: [
        h('div', { class: 'desc' }, '实验科技的主要来源是**打退一波怪潮**（每波 +1 次）；数据方尖碑与实验室研究也会给。升级本身只提升生命与属性。'),
        h('div', { class: 'section', style: { marginTop: '16px' } }, [
          h('h3', {}, `已获得的实验科技（${run.experiments.size}）`),
          ...renderOwned(run),
        ]),
      ],
      footer: [button('关闭', () => { modals.close(); game.paused = false; })],
      onClose: () => { game.paused = false; },
    });
    return;
  }

  const showDirection = () => {
    modals.open({
      title: `实验科技 · 选择方向（剩余 ${run.pendingChoices} 次）`,
      subtitle: '三个方向固定：经营、塔防、探索。先定方向，再从四张里选一张。',
      body: buildDirections(run, (dir) => showOptions(dir)),
      footer: [
        h('div', { style: { marginRight: 'auto', color: '#8ba0bb', fontSize: '12px' } },
          '实验科技会带来机制改变或数值强化，永久保留，跨星球有效。武器射程/伤害/射速/弹道不在这里 —— 那四条线在科技树的【武器成长】里。'),
        button('稍后再选', () => { modals.close(); game.paused = false; }, 'btn'),
      ],
      onClose: () => { game.paused = false; },
    });
  };

  const showOptions = (dir) => {
    const opts = actions.chooseExperimentDir(dir);
    if (!opts || !opts.length) { showDirection(); return; }
    const render = () => {
      const cards = opts.map(id => buildExpCard(run, EXP_MAP[id], () => {
        actions.takeExperiment(id);
        if (run.pendingChoices > 0) showDirection();
        else {
          modals.close();
          game.paused = false;
        }
      }));
      const cost = run.refreshCost();
      return [
        h('div', { style: { marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '14px' } }, [
          h('span', { style: { color: DIR_DEF[dir].color, fontSize: '15px', letterSpacing: '2px' } },
            `${DIR_DEF[dir].icon} ${DIR_DEF[dir].name}方向 · 四选一`),
          h('span', { style: { color: '#8ba0bb', fontSize: '12px' } }, DIR_DEF[dir].desc),
        ]),
        h('div', { class: 'grid c4' }, cards),
        h('div', { class: 'btn-row', style: { marginTop: '18px' } }, [
          button(`🔄 刷新选项（${fmt(cost)} 金币）`, () => {
            if (actions.rerollExperiments()) { opts.length = 0; opts.push(...(run.currentOptions || [])); modals.refresh(render); }
          }, 'btn'),
          button('← 换个方向', () => showDirection(), 'btn'),
        ]),
        h('div', { style: { marginTop: '12px', fontSize: '11.5px', color: '#64748b' } },
          `已刷新 ${run.refreshCount} 次。每次刷新费用 ×1.85，谨慎使用。`),
      ];
    };
    modals.replace({
      title: `实验科技 · ${DIR_DEF[dir].name}`,
      subtitle: `剩余选择次数 ${run.pendingChoices}`,
      body: render(),
      wide: true,
      footer: [button('稍后再选', () => { modals.close(); game.paused = false; }, 'btn')],
      onClose: () => { game.paused = false; },
    });
  };

  showDirection();
}

function buildDirections(run, onPick) {
  const out = [];
  for (const dir of [DIR.ADMIN, DIR.DEFENSE, DIR.EXPLORE]) {
    const def = DIR_DEF[dir];
    const pool = poolFor(dir, run.characterId);
    const available = pool.filter(e => (run.experiments.get(e.id) || 0) < (e.maxLv || 1));
    const exhausted = available.length === 0;
    out.push(h('div', {
      class: `exp-direction ${dir}${exhausted ? ' disabled' : ''}`,
      onclick: () => { if (!exhausted) { bus.emit(EV.SFX, { name: 'uiClick' }); onPick(dir); } },
    }, [
      h('span', { class: 'dir-icon' }, def.icon),
      h('div', { style: { flex: '1' } }, [
        h('h3', {}, `${def.name}${exhausted ? '（已抽完）' : ''}`),
        h('p', {}, def.desc),
        h('p', { style: { color: '#64748b', marginTop: '4px' } },
          `可选 ${available.length} / ${pool.length} 张 · 已获得 ${pool.length - available.length} 张`),
      ]),
      h('span', { style: { fontSize: '20px', opacity: 0.6 } }, '→'),
    ]));
  }
  return out;
}

function buildExpCard(run, exp, onPick) {
  if (!exp) return h('div', { class: 'card locked' }, '（空）');
  const lv = run.experiments.get(exp.id) || 0;
  const rar = EXP_RARITY[exp.rarity] || EXP_RARITY.common;
  const isNew = lv === 0;
  return h('div', {
    class: 'card',
    onclick: () => { bus.emit(EV.SFX, { name: 'uiClick' }); onPick(); },
  }, [
    h('span', { class: 'lvl' }, lv > 0 ? `Lv.${lv} → ${lv + 1}` : '新'),
    h('span', { class: 'card-tag', style: { color: rar.color } }, rar.name),
    h('span', { class: 'card-tag tag-special', style: { marginLeft: '6px' } }, exp.kind === 'mechanic' ? '机制' : '数值'),
    h('h3', { style: { marginTop: '8px' } }, exp.name),
    h('div', { class: 'desc' }, exp.desc),
    h('div', { class: 'effect' }, effectSummary(exp, lv)),
    exp.exclusive ? h('div', { class: 'flavor' }, `角色专属 · ${exp.exclusive}`) : null,
  ]);
}

function effectSummary(exp, currentLv) {
  const parts = [];
  for (const [k, v] of Object.entries(exp.effect || {})) {
    if (typeof v === 'number') {
      const label = STAT_LABEL[k] || k;
      if (k === 'hpMax' || k === 'beaconLevel' || k === 'popCap' || k === 'towerCap' || k === 'geneSlots' || k === 'tameSlots' || k === 'jobSlots') {
        parts.push(`${label} +${Math.round(v)}`);
      } else if (Math.abs(v) < 1 && v !== 0) {
        parts.push(`${label} ${v > 0 ? '+' : ''}${Math.round(v * 100)}%`);
      } else {
        parts.push(`${label} +${v}`);
      }
    } else if (v && typeof v === 'object') {
      const label = MECH_LABEL[k] || k;
      parts.push(`${label}（${describeMechanic(k, v)}）`);
    } else {
      parts.push(`${STAT_LABEL[k] || k}`);
    }
  }
  if (currentLv > 0) parts.push(`（当前 Lv.${currentLv} 已生效，再取可叠加）`);
  return parts.join(' · ');
}

function describeMechanic(k, v) {
  switch (k) {
    case 'towerExplode': return `半径 ${Math.round(v.radius)}，${Math.round((v.mult || 0) * 100)}% 伤害`;
    case 'towerSlow': return `减速 ${Math.round(v.amount * 100)}%，${v.dur}s`;
    case 'towerBurn': return `${v.dps}/秒，${v.dur}s`;
    case 'towerChain': return `跳跃 ${v.chains} 次`;
    case 'towerOvercharge': return `每 ${v.every}s 一发 ${v.mult}× 伤害`;
    case 'towerExplodeOnDeath': return `半径 ${v.radius}，${v.dmg} 伤害`;
    case 'lastStand': return `低于 ${Math.round(v.hpThreshold * 100)}% 时 +${Math.round(v.towerDamage * 100)}%`;
    case 'vengeance': return `每损失一塔 +${Math.round((v.towerDamage || 0) * 100)}%`;
    case 'baseShield': return `${v.amount} 护盾，${v.regen}/秒 恢复`;
    case 'manualSplash': return `半径 ${v.radius}`;
    case 'dodgeDamage': return `${Math.round(v.mult * 100)}% 伤害，半径 ${v.radius}`;
    case 'execute': return `低于 ${Math.round(v.threshold * 100)}% 直接处决`;
    case 'counterWave': return `半径 ${v.radius}，${Math.round(v.mult * 100)}% 反伤`;
    case 'pool': return `半径 ${v.r}，${v.dmg}/秒`;
    default: return '';
  }
}

const STAT_LABEL = {
  damage: '伤害', attackSpeed: '攻速', critChance: '暴击率', critMult: '暴击伤害',
  hpMax: '生命上限', armor: '护甲', hpRegen: '生命回复', speedMult: '移速',
  dodgeCdMult: '闪避冷却', luck: '幸运', carryMult: '负重', goldMult: '金币获取',
  xpMult: '经验获取', matMult: '材料获取', buildSpeed: '建造速度', thorn: '反伤',
  acidResist: '酸抗', vehicleSpeedMult: '载具速度', vehicleHpMult: '载具耐久',
  beaconRadiusMult: '吸引半径', beaconIntensityMult: '吸引强度', beaconFuelMult: '装置能耗',
  beaconFuelRegen: '装置回能', towerDamage: '塔伤害', towerAttackSpeed: '塔攻速',
  towerRange: '塔射程', towerCap: '塔上限', towerSlotRadius: '建造范围',
  structureHpMult: '建筑耐久', structureArmor: '建筑护甲', repairMult: '维修速度',
  repairCostMult: '维修消耗', airDropSpeed: '空投速度', popCap: '人口上限',
  popGrowthMult: '人口增长', workerEfficiency: '工人效率', jobSlots: '岗位数',
  storageCap: '仓储上限', buildCostMult: '建造费用', mineSpeed: '采集速度',
  autoCollect: '自动收集', autoCollectRadius: '回收范围', autoRepairBase: '基地自动维修',
  passiveGold: '被动金币', goldInterest: '金币利息', tradeDiscount: '贸易优惠',
  sellBonus: '出售收益', smeltOnKill: '击杀冶炼', foodEfficiency: '食物效率',
  lootQuality: '掉落品质', eliteDamage: '对精英伤害', bossDamage: '对Boss伤害',
  lifeSteal: '吸血', dotMult: '持续伤害', poisonOnHit: '攻击中毒', hazardResist: '环境抗性',
  regenPct: '百分比回复', healPower: '治疗强度', nightDamage: '夜间伤害',
  eliteSpawnMult: '精英刷新', relicChance: '遗物几率', supplyDropRate: '快递频率',
  dnaMult: '基因样本', bioPointGain: '生物科技点', tameSlots: '驯化上限',
  tameSpeed: '驯化速度', tamePower: '驯化强度', tameElite: '驯化精英', geneSlots: '基因槽',
  genePower: '基因强度', monsterFriendly: '虫群亲和', vehicleSlots: '载具挂载',
  vehicleWeaponDamage: '车载武器', ramMult: '撞击伤害', fuelMult: '油耗',
  fuelRegen: '燃料回复', cargoBonus: '载重', ammoCostMult: '弹药消耗',
  ammoCraft: '弹药合成', revealRadius: '侦察范围', resourceSense: '资源感知',
  nightVision: '夜视', sightBonus: '视野', portableBeacon: '便携吸引装置',
  hiveGuard: '巢穴守卫', rageBonus: '残血增伤', lowHpArmor: '残血护甲',
  collisionHeal: '撞击回复', workerEfficiency2: '工人效率',
};

const MECH_LABEL = {
  towerExplode: '塔攻击爆炸', towerSlow: '塔攻击减速', towerBurn: '塔攻击燃烧',
  towerChain: '塔攻击连锁', towerOvercharge: '过载电容', towerExplodeOnDeath: '塔自爆',
  lastStand: '背水一战', vengeance: '复仇协议', baseShield: '基地护盾',
  manualSplash: '手动接管溅射', dodgeDamage: '闪避撞击伤害', execute: '处决',
  counterWave: '受击冲击波', focusFire: '集火协议', pool: '地面酸池',
};

function renderOwned(run) {
  if (!run.experiments.size) return [h('div', { class: 'desc' }, '（还没有获得任何实验科技）')];
  const out = [];
  for (const [id, lv] of run.experiments) {
    const def = EXP_MAP[id];
    if (!def) continue;
    const rar = EXP_RARITY[def.rarity] || EXP_RARITY.common;
    out.push(h('div', { class: 'list-row' }, [
      h('span', { style: { color: rar.color, fontSize: '16px' } }, DIR_DEF[def.dir]?.icon || '★'),
      h('div', { class: 'grow' }, [
        h('div', { class: 'name', style: { color: rar.color } }, `${def.name} Lv.${lv}/${def.maxLv}`),
        h('div', { class: 'meta' }, def.desc),
      ]),
    ]));
  }
  return out;
}
