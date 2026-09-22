/**
 * 背包 / 装备面板：武器、护甲、饰品、载具模块、背包。
 */

import { h, button } from './dom.js';
import { RARITY_DEF, WEAPON_DEF, ITEM_DEF, SLOT_DEF } from '../data/weapons.js';
import { notice } from '../core/events.js';
import { WEAPON_CAPS } from '../core/config.js';

/** 装备栏槽位名（下标 = player.equipment 的下标） */
const SLOT_NAMES = ['头盔', '胸甲', '护腿', '饰品 1', '饰品 2'];

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'relic'];
/** 背包分组顺序（按部位排时用） */
const SLOT_ORDER = ['weapon', 'helmet', 'chest', 'legs', 'trinket', 'module', 'misc'];

/**
 * 背包排序键。
 *
 * 玩家提的需求：背包一多就找不着东西。至少要能按品质（先看好东西）、
 * 按部位（找护甲/枪）、按评分（看战力）、按负重（决定扔什么）排一遍。
 */
const SORTS = [
  { id: 'rarity', name: '品质' },
  { id: 'type', name: '部位' },
  { id: 'score', name: '评分' },
  { id: 'weight', name: '负重' },
  { id: 'name', name: '名称' },
];

function sortBag(items, mode) {
  const list = [...items];
  const rank = (it) => RARITY_ORDER.indexOf(it.rarity);
  switch (mode) {
    case 'type':
      list.sort((a, b) => {
        const ka = SLOT_ORDER.indexOf(a.type === 'weapon' ? 'weapon' : (a.slot || 'misc'));
        const kb = SLOT_ORDER.indexOf(b.type === 'weapon' ? 'weapon' : (b.slot || 'misc'));
        return (ka - kb) || (rank(b) - rank(a));
      });
      break;
    case 'score':
      list.sort((a, b) => scoreItem(b) - scoreItem(a));
      break;
    case 'weight':
      list.sort((a, b) => itemWeight(b) - itemWeight(a));
      break;
    case 'name':
      list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
      break;
    default:
      list.sort((a, b) => (rank(b) - rank(a)) || (scoreItem(b) - scoreItem(a)));
  }
  return list;
}
// 评分 / 负重：列表里每一行都要用。以前漏了 import，
// 背包一旦有东西就 ReferenceError（空背包时看不出来）。
import { scoreItem, itemWeight } from '../systems/loot.js';

export function openInventoryPanel(game, actions) {
  const run = game.run;
  const modals = game.ui.modals;
  const p = run.player;
  const state = { sort: 'rarity' };      // 背包排序键

  const render = () => {
    const out = [];
    out.push(h('div', { class: 'cols' }, [
      // 左：装备
      h('div', {}, [
        h('div', { class: 'section' }, [
          h('h3', {}, `武器（${p.weapons.length}/4）`),
          ...p.weapons.map((w, i) => w ? weaponRow(w, i === p.weaponIndex, () => {
            p.weaponIndex = i; run.recomputeStats(); refresh();
          }, () => { actions.dropWeapon(i); refresh(); }) : null).filter(Boolean),
          !p.weapons.length ? h('div', { class: 'desc' }, '没有武器！') : null,
        ]),
        h('div', { class: 'section' }, [
          h('h3', {}, '护甲与饰品'),
          ...p.equipment.map((item, i) => equipSlot(item, i, () => { actions.unequipItem(i); refresh(); })).filter(Boolean),
        ]),        h('div', { class: 'section' }, [
          h('h3', {}, '生存状态'),
          h('div', { class: 'kv' }, [
            h('div', { class: 'k' }, '生命'), h('div', { class: 'v' }, `${Math.ceil(p.hp)} / ${p.hpMax}`),
            h('div', { class: 'k' }, '护甲'), h('div', { class: 'v' }, `${Math.round(p.statSet.get('armor'))}`),
            h('div', { class: 'k' }, '伤害加成'), h('div', { class: 'v good' }, `+${Math.round(p.statSet.get('damage') * 100)}%`),
            h('div', { class: 'k' }, '攻速加成'), h('div', { class: 'v good' }, `+${Math.round(p.statSet.get('attackSpeed') * 100)}%`),
            h('div', { class: 'k' }, '暴击'), h('div', { class: 'v good' }, `${Math.round((0.04 + p.statSet.get('critChance')) * 100)}% / ${(1.5 + p.statSet.get('critMult')).toFixed(2)}×`),
            h('div', { class: 'k' }, '吸血'), h('div', { class: 'v good' }, `${(p.statSet.get('lifeSteal') * 100).toFixed(1)}%`),
            h('div', { class: 'k' }, '负重'), h('div', { class: 'v' }, `${Math.round(p.carryUsed)} / ${Math.round(p.carryMax)}`),
            h('div', { class: 'k' }, '弹药'), h('div', { class: 'v' }, `${Math.round(p.ammo)} / ${p.ammoMax || 200}`),
          ]),
        ]),
        h('div', { class: 'section' }, [
          h('h3', {}, '武器成长（科技树 · 武器成长线）'),
          h('div', { class: 'kv' }, [
            h('div', { class: 'k' }, '射程'), h('div', { class: 'v good' }, weaponGrowthText(p, 'rangeMult', '×')),
            h('div', { class: 'k' }, '伤害'), h('div', { class: 'v good' }, weaponGrowthText(p, 'damage', '×')),
            h('div', { class: 'k' }, '射速'), h('div', { class: 'v good' }, weaponGrowthText(p, 'attackSpeed', '×')),
            h('div', { class: 'k' }, '弹道'), h('div', { class: 'v good' },
              `${1 + Math.round(cappedStat(p, 'projectiles'))} / 3 条`),
          ]),
          h('div', { style: { fontSize: '11.5px', color: '#8ba0bb', marginTop: '8px', lineHeight: '1.7' } },
            '四条线在科技树的【武器成长】里逐级申请：射程最多 300%、伤害最多 300%、射速最多 200%、弹道最多 3 条。'
            + '装备词缀与实验科技也能叠加，但总和不会超过这些上限。'),
        ]),
      ]),
      // 右：背包 + 载具 + 消耗品
      h('div', {}, [
        h('div', { class: 'section' }, [
          h('h3', {}, `背包（${p.inventory.length} 件 · ${Math.round(p.carryUsed)}/${Math.round(p.carryMax)}）`),
          h('div', { class: 'btn-row', style: { marginBottom: '10px' } }, [
            // ---- 排序键 ----
            h('span', { style: { alignSelf: 'center', color: '#8ba0bb', fontSize: '12px' } }, '排序：'),
            ...SORTS.map(s2 => button(
              `${s2.id === state.sort ? '✓ ' : ''}${s2.name}`,
              () => { state.sort = s2.id; refresh(); },
              `btn small${s2.id === state.sort ? ' primary' : ''}`)),
            button('一键出售所有普通品', () => {
              let gold = 0, n = 0;
              for (const item of [...p.inventory]) {
                if (item.rarity === 'common') { gold += actions.sellItem(item.uid); n++; }
              }
              notice('批量出售', `卖掉 ${n} 件普通装备，获得 ${gold} 金币。`, 'good');
              refresh();
            }, 'btn small'),
          ]),
          ...(p.inventory.length ? sortBag(p.inventory, state.sort).map(it => bagRow(it, actions, refresh)).filter(Boolean)
            : [h('div', { class: 'desc' }, '背包是空的。野外精英怪会掉落装备。')]),
        ]),
        h('div', { class: 'section' }, [
          h('h3', {}, `载具（${run.vehicle.name}）`),
          h('div', { class: 'kv', style: { marginBottom: '10px' } }, [
            h('div', { class: 'k' }, '耐久'), h('div', { class: 'v' }, `${Math.ceil(run.vehicle.hp)} / ${Math.ceil(run.vehicle.hpMax)}${run.vehicle.destroyed ? ' 【已损毁】' : ''}`),
            h('div', { class: 'k' }, '燃料'), h('div', { class: 'v' }, `${Math.ceil(run.vehicle.fuel)} / ${run.vehicle.fuelMax}`),
            h('div', { class: 'k' }, '速度'), h('div', { class: 'v' }, `${Math.round(300 * (1 + p.statSet.get('vehicleSpeedMult')))}`),
            h('div', { class: 'k' }, '挂载槽'), h('div', { class: 'v' }, `${run.vehicle.mounted.filter(Boolean).length} / ${1 + Math.round(p.statSet.get('vehicleSlots'))}`),
          ]),
          h('div', { class: 'btn-row', style: { marginBottom: '10px' } }, [
            button('维修载具', () => { actions.repairVehicle(); refresh(); }, 'btn small'),
            button(run.vehicle.beacon ? '拆除便携吸引装置' : '安装便携吸引装置', () => {
              actions.installPortableBeacon(); refresh();
            }, 'btn small'),
          ]),
          h('div', { class: 'panel-title', style: { marginTop: '10px' } }, '车载武器'),
          ...(run.vehicle.mounted.map((w, i) => w
            ? weaponRow(w, false, null, () => { actions.unmountVehicleWeapon(i); refresh(); }, `槽位 ${i + 1}`)
            : h('div', { class: 'list-row' }, [
              h('div', { class: 'grow' }, `槽位 ${i + 1}：空`),
              h('span', { class: 'meta' }, i < 1 + Math.round(p.statSet.get('vehicleSlots')) ? '可用' : '未解锁'),
            ]))),
          h('div', { class: 'panel-title', style: { marginTop: '10px' } }, '载具模块'),
          ...(run.vehicle.modules.map((m, i) => equipSlot(m, i, () => { actions.unequipVehicleModule(i); refresh(); }, 'module'))),
        ]),
        h('div', { class: 'section' }, [
          h('h3', {}, '消耗品'),
          ...Object.values(ITEM_DEF).map(def => {
            const count = run.itemCounts?.[def.id] || 0;
            return h('div', { class: 'list-row' }, [
              h('span', { style: { fontSize: '18px', color: def.color } }, def.icon),
              h('div', { class: 'grow' }, [
                h('div', { class: 'name' }, `${def.name} ×${count}`),
                h('div', { class: 'meta' }, def.desc),
              ]),
              def.use && !def.use.deploy ? button('使用', () => { actions.useItem(def.id); refresh(); }, 'btn small') : null,
            ]);
          }),
        ]),
      ]),
    ]));
    return out;
  };

  const refresh = () => modals.refresh(render);

  modals.open({
    title: '装备与背包',
    subtitle: '精英怪掉落装备 —— 越级探索的回报全在这里。',
    body: render(),
    wide: true,
    footer: [
      h('div', { style: { marginRight: 'auto', fontSize: '12px', color: '#8ba0bb' } },
        `幸运 ${(p.statSet.get('luck') * 100).toFixed(0)}% · 掉落品质 +${Math.round(p.statSet.get('lootQuality') * 100)}%`),
      button('关闭', () => { modals.close(); game.paused = false; }),
    ],
    onClose: () => { game.paused = false; },
  });
}

// ---------------- 行构建 ----------------

function weaponRow(w, active, onSelect, onDrop, label = '') {
  if (!w) return null;
  const rar = RARITY_DEF[w.rarity] || RARITY_DEF.common;
  const def = w.def || WEAPON_DEF[w.weaponId];
  return h('div', {
    class: `list-row${active ? ' hot' : ''}`,
    onclick: onSelect || undefined,
  }, [
    h('span', { style: { fontSize: '18px', color: rar.color } }, def?.icon || '🗡'),
    h('div', { class: 'grow' }, [
      h('div', { class: 'name', style: { color: rar.color } }, `${label ? label + ' · ' : ''}${w.name}${active ? ' 【使用中】' : ''}`),
      h('div', { class: 'meta' },
        `${def?.kind === 'melee' ? '近战' : def?.kind === 'beam' ? '光束' : def?.kind === 'lob' ? '抛射' : def?.kind === 'cone' ? '喷射' : def?.kind === 'chain' ? '链式' : '枪械'} · 伤害 ${def?.damage} · 间隔 ${def?.cd}s · 射程 ${def?.range}`),
      w.affixes?.length ? h('div', { class: 'meta', style: { color: '#ffba4c' } },
        w.affixes.map(a => `${a.name} +${formatAffix(a)}`).join(' · ')) : null,
    ]),
    onDrop ? button('卸下', onDrop, 'btn small') : null,
    active ? h('span', { class: 'pill good' }, '装备中') : null,
  ]);
}

function equipSlot(item, i, onUnequip, forcedType = null) {
  // 槽位名跟着 EQUIP_ORDER 走：0 头盔 / 1 胸甲 / 2 护腿 / 3-4 饰品
  const slotName = forcedType === 'module' ? `模块 ${i + 1}` : (SLOT_NAMES[i] || `饰品 ${i}`);
  if (!item) {
    return h('div', { class: 'list-row' }, [
      h('div', { class: 'grow', style: { color: '#8ba0bb' } }, `${slotName}：空（捡到对应部位的装备会自动穿上）`),
    ]);
  }
  const rar = RARITY_DEF[item.rarity] || RARITY_DEF.common;
  return h('div', { class: 'list-row' }, [
    h('span', { style: { fontSize: '18px', color: rar.color } }, item.icon || '💠'),
    h('div', { class: 'grow' }, [
      h('div', { class: 'name', style: { color: rar.color } }, `${slotName} · ${item.name}`),
      h('div', { class: 'meta' }, statsText(item.stats)),
      item.affixes?.length ? h('div', { class: 'meta', style: { color: '#ffba4c' } },
        item.affixes.map(a => `${a.name} +${formatAffix(a)}`).join(' · ')) : null,
    ]),
    button('卸下', onUnequip, 'btn small'),
  ]);
}

function bagRow(item, actions, refresh) {  if (!item) return null;
  const rar = RARITY_DEF[item.rarity] || RARITY_DEF.common;
  const isModule = item.slot === 'module';
  return h('div', { class: 'list-row' }, [
    h('span', { style: { fontSize: '18px', color: rar.color } }, item.icon || '🗡'),
    h('div', { class: 'grow' }, [
      h('div', { class: 'name', style: { color: rar.color } }, item.name),
      h('div', { class: 'meta' },
        item.type === 'weapon'
          ? `武器 · ${(item.def || WEAPON_DEF[item.weaponId])?.damage} 伤害 · 评分 ${Math.round(scoreItem(item))} · 重 ${itemWeight(item)}`
          : `${SLOT_DEF[item.slot]?.name || '装备'} · 评分 ${Math.round(scoreItem(item))} · 重 ${itemWeight(item)}`),
      item.affixes?.length ? h('div', { class: 'meta', style: { color: '#ffba4c' } },
        item.affixes.map(a => `${a.name} +${formatAffix(a)}`).join(' · ')) : null,
      item.stats && Object.keys(item.stats).length ? h('div', { class: 'meta' }, statsText(item.stats)) : null,
    ]),
    button('装备', () => { actions.equipItem(item.uid); refresh(); }, 'btn small'),
    button('出售', () => { actions.sellItem(item.uid); refresh(); }, 'btn small'),
  ]);
}

function statsText(stats) {
  if (!stats) return '';
  const parts = [];
  for (const [k, v] of Object.entries(stats)) {
    if (typeof v !== 'number') continue;
    const label = STAT_NAMES[k] || k;
    if (['hpMax', 'armor', 'thorn', 'pierce'].includes(k)) parts.push(`${label} +${Math.round(v)}`);
    else parts.push(`${label} ${v > 0 ? '+' : ''}${Math.round(v * 100)}%`);
  }
  return parts.join(' · ');
}

/** 取一项武器成长属性，按 WEAPON_CAPS 封顶（和 player.weaponStat 一致） */
function cappedStat(p, key) {
  const raw = p.statSet.get(key) || 0;
  const cap = WEAPON_CAPS[key];
  return cap == null ? raw : Math.min(raw, cap);
}

/**
 * 「射程 1.80× / 3.00×」这种写法。
 * 上限一起显示，玩家才知道自己离封顶还有多远 ——
 * 「最多到初始的 300%」如果只有节点说明里提一句，实际玩起来是看不见的。
 */
function weaponGrowthText(p, key) {
  const v = cappedStat(p, key);
  const cap = WEAPON_CAPS[key] || 0;
  const pct = Math.round(v * 100);
  const capPct = Math.round(cap * 100);
  const full = v >= cap - 1e-9;
  return `+${pct}% / 上限 +${capPct}%${full ? '（已满）' : ''}`;
}

function formatAffix(a) {
  const int = ['hpMax', 'armor', 'thorn', 'pierce'].includes(a.stat);
  return int ? String(Math.round(a.value)) : `${Math.round(a.value * 100)}%`;
}

const STAT_NAMES = {
  hpMax: '生命上限', armor: '护甲', hpRegen: '生命回复', shieldMax: '护盾上限',
  damage: '伤害', attackSpeed: '攻速', critChance: '暴击率', critMult: '暴击伤害',
  rangeMult: '射程', pierce: '穿透', knockbackMult: '击退', lifeSteal: '吸血',
  speedMult: '移速', dodgeCdMult: '闪避冷却', luck: '幸运', carryMult: '负重',
  goldMult: '金币获取', xpMult: '经验获取', matMult: '材料获取', buildSpeed: '建造速度',
  thorn: '反伤', acidResist: '酸抗', vehicleSpeedMult: '载具速度', vehicleHpMult: '载具耐久',
  beaconRadiusMult: '吸引半径', towerDamage: '塔伤害', towerAttackSpeed: '塔攻速',
  mineSpeed: '采集速度', heatResist: '耐热', coldResist: '耐寒', sporeResist: '抗孢子',
  healPower: '治疗强度', dnaMult: '基因样本', tameSpeed: '驯化速度', fuelMult: '油耗',
  vehicleSlots: '载具挂槽', ramMult: '撞击伤害', cargoBonus: '载重', autoRepair: '自动修复',
};
