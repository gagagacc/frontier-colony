/**
 * 城镇经营面板：人口、岗位分配、建筑建造、生产总览、城镇等级。
 */

import { TOWN_BUILDING_DEF, POP_TIERS, popTier, nextPopTier } from '../data/planets.js';
import { h, button } from './dom.js';
import { notice } from '../core/events.js';
import { costNodes } from './panelTech.js';
import { craftTier, craftCost, canCraftRarity, CRAFT_ARMOR, CRAFT_WEAPONS } from '../data/crafting.js';
import { RARITY_DEF, SLOT_DEF } from '../data/weapons.js';

/** 制造出来的装备名字前缀（和掉落保持一致的语感） */
function prefixForCraft(rarity) {
  return { common: '', uncommon: '精工·', rare: '稀有·', epic: '史诗·', relic: '传奇·' }[rarity] || '';
}

export function openTownPanel(game, actions) {
  const run = game.run;
  const modals = game.ui.modals;
  const state = { craftRarity: 'common' };

  /**
   * 制造面板。
   *
   * 规则（对应设计）：
   *   - 城镇能造的最高品质是紫色，红色只能靠打。
   *   - 能造哪一档由【城镇等级（人口）】决定，需要先造一座军械工坊。
   *   - 同一件东西可以选不同品质制造，品质越高越贵。
   */
  const renderCraft = () => {
    const town = game.run.town;
    const craftLv = run.town.craftLevel;
    const tier = craftTier(craftLv);
    const hasWorkshop = run.townBuildings.some(b => b.type === 'workshop');
    const out = [];

    out.push(h('div', { class: 'desc', style: { marginBottom: '10px' } },
      `当前制造等级：${tier.name}　·　可造品质上限：${RARITY_DEF[tier.rarity].colorName}色`
      + `（${RARITY_DEF[tier.rarity].name}）　·　${tier.desc}`));

    if (!hasWorkshop) {
      out.push(h('div', { class: 'desc', style: { color: '#ffba4c' } },
        '需要先建造【军械工坊】才能制造装备 —— 在下面的「可建造」里选它。'));
      return out;
    }

    // 品质选择
    const rarities = ['common', 'uncommon', 'rare', 'epic'];
    const picked = state.craftRarity;
    out.push(h('div', { class: 'btn-row', style: { marginBottom: '10px', display: 'flex', gap: '8px' } },
      rarities.map(r => {
        const ok = canCraftRarity(r, craftLv);
        return button(`${RARITY_DEF[r].colorName}（${RARITY_DEF[r].name}）`,
          () => { if (!ok) { notice('还造不了', `需要更高的城镇等级才能制造${RARITY_DEF[r].colorName}色装备。`, 'warn'); return; } state.craftRarity = r; refresh(); },
          `btn${picked === r ? ' primary' : ''}${ok ? '' : ' locked'}`);
      })));

    const cost0 = (entry) => craftCost(entry, picked, craftLv);
    const canMake = (entry) => canCraftRarity(picked, craftLv) && run.canAfford(cost0(entry));

    const row = (entry, kindLabel) => h('div', { class: 'list-row' }, [
      h('span', { style: { fontSize: '18px', color: RARITY_DEF[picked].color } }, entry.icon || (entry.kind === 'equip' ? '🦺' : '🔫')),
      h('div', { class: 'grow' }, [
        h('div', { class: 'name', style: { color: RARITY_DEF[picked].color } }, `${prefixForCraft(picked)}${entry.name}`),
        h('div', { class: 'meta' }, `${kindLabel}${entry.tier ? ` · ${'★'.repeat(entry.tier)}` : ''}`),
      ]),
      h('div', { class: 'cost', style: { marginRight: '10px' } }, costNodes(cost0(entry), run)),
      button('制造', () => {
        const res = run.town.craft(entry, picked);
        if (res === 'ok') notice('制造完成', `${prefixForCraft(picked)}${entry.name} 已入库。`, 'good');
        else if (res === 'noWorkshop') notice('缺少工坊', '先建造【军械工坊】。', 'warn');
        else if (res === 'rarityLocked') notice('还造不了', `城镇等级不够，造不出${RARITY_DEF[picked].colorName}色装备。`, 'warn');
        else if (res === 'cost') notice('资源不足', '材料不够。', 'warn');
        else notice('失败', '制造没能完成。', 'warn');
        refresh();
      }, `btn${canMake(entry) ? ' primary' : ''}`),
    ]);

    out.push(h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 18px' } }, [
      h('div', {}, [
        h('div', { class: 'panel-title', style: { marginTop: '6px' } }, `护甲 · 头盔 / 胸甲 / 护腿（${CRAFT_ARMOR.length} 件）`),
        ...CRAFT_ARMOR.map(e => row(e, SLOT_DEF[e.slot]?.name || '护甲')),
      ]),
      h('div', {}, [
        h('div', { class: 'panel-title', style: { marginTop: '6px' } }, '武器'),
        ...CRAFT_WEAPONS.map(e => row(e, '武器')),
      ]),
    ]));
    return out;
  };

  const render = () => {
    const town = run.town;
    const cap = town.popCap;
    const tier = popTier(run.population);
    const next = nextPopTier(run.population);
    const out = [];

    // ---- 概览 ----
    out.push(h('div', { class: 'cols', style: { marginBottom: '18px' } }, [
      h('div', { class: 'panel' }, [
        h('div', { class: 'panel-title' }, '人口'),
        h('div', { style: { fontSize: '30px', fontWeight: '700', color: '#6ee7a8', letterSpacing: '2px' } },
          `${run.population} / ${cap}`),
        h('div', { style: { fontSize: '12px', color: '#8ba0bb', marginTop: '4px' } },
          `${tier.name} · ${tier.desc}`),
        next ? h('div', { style: { fontSize: '11.5px', color: '#64748b', marginTop: '6px' } },
          `距离【${next.name}】还需 ${next.pop - run.population} 人`) : null,
        h('div', { style: { fontSize: '12px', color: '#a8bcd4', marginTop: '10px' } },
          `已分配 ${town.assignedPop()} 人 · 空闲 ${town.idlePop} 人 · 岗位 ${town.jobsTotal}`),
        h('div', { class: 'btn-row', style: { marginTop: '10px' } }, [
          button('自动分配', () => { actions.autoAssignWorkers(); refresh(); }, 'btn small'),
        ]),
        h('div', { style: { fontSize: '11px', color: '#64748b', marginTop: '8px' } },
          '人口只能待在城镇里。基地被摧毁时，城镇里的人口会全部死亡。'),
      ]),
      h('div', { class: 'panel' }, [
        h('div', { class: 'panel-title' }, '每秒产出'),
        (() => {
          const prod = town.productionSummary();
          const rows = [];
          const NAMES = { food: '食物', metal: '金属', gold: '金币', water: '冷凝水', parts: '零件', research: '研究资料' };
          const COLORS = { food: '#ff8a5c', metal: '#9aa4b0', gold: '#ffba4c', water: '#6fc8ff', parts: '#d0c090', research: '#b0a0ff' };
          for (const [k, v] of Object.entries(prod)) {
            rows.push(h('div', { class: 'k' }, NAMES[k] || k), h('div', { class: 'v', style: { color: COLORS[k] || '#d8e6f5' } }, `+${v.toFixed(2)}/秒`));
          }
          const passive = run.playerStats.get('passiveGold');
          if (passive > 0) {
            rows.push(h('div', { class: 'k' }, '被动金币'), h('div', { class: 'v', style: { color: '#ffba4c' } }, `+${passive.toFixed(2)}/秒`));
          }
          if (!rows.length) rows.push(h('div', { class: 'k' }, '暂无产出'), h('div', { class: 'v' }, '先造建筑并分配人口'));
          // 消耗
          rows.push(h('div', { class: 'k' }, '食物消耗'),
            h('div', { class: 'v bad' }, `-${(run.population * 0.02).toFixed(2)}/秒`));
          return h('div', { class: 'kv' }, rows);
        })(),
      ]),
    ]));

    // ---- 已有建筑 ----
    out.push(h('div', { class: 'section' }, [
      h('h3', {}, `城镇建筑（${run.townBuildings.length}）`),
      ...(run.townBuildings.length ? run.townBuildings.map(b => {
        const def = TOWN_BUILDING_DEF[b.type];
        if (!def) return null;
        const maxJobs = (def.jobs || 0) + Math.round(run.playerStats.get('jobSlots'));
        return h('div', { class: 'list-row' }, [
          h('span', { style: { fontSize: '20px' } }, def.icon),
          h('div', { class: 'grow' }, [
            h('div', { class: 'name' }, def.name),
            h('div', { class: 'meta' },
              [def.popCap ? `人口上限 +${def.popCap}` : null,
                def.jobs ? `岗位 ${b.workers || 0}/${maxJobs}` : null,
                def.produce ? Object.entries(def.produce).map(([k, v]) => `${k} +${(v * (b.workers || 0)).toFixed(2)}/秒`).join(' ') : null,
                def.researchRate && b.workers ? `研究 +${(def.researchRate * b.workers).toFixed(2)}/秒` : null,
                def.defense ? `协防 +${def.defense * (b.workers || 0)}` : null,
              ].filter(Boolean).join(' · ')),
          ]),
          def.jobs ? h('div', { class: 'btn-row' }, [
            button('－', () => { actions.setWorkers(b.id, (b.workers || 0) - 1); refresh(); }, 'btn small'),
            button('＋', () => {
              if (!actions.setWorkers(b.id, (b.workers || 0) + 1)) notice('没有空闲人口', '先等人口增长，或减少其他建筑的岗位。', 'warn');
              refresh();
            }, 'btn small'),
          ]) : null,
          button('拆除', () => { actions.demolishBuilding(b.id); refresh(); }, 'btn small danger'),
        ]);
      }).filter(Boolean) : [h('div', { class: 'desc' }, '还没有建筑。人口需要居住区才能增长。')]),
    ]));

    // ---- 可建造 ----
    out.push(h('div', { class: 'section' }, [
      h('h3', {}, '可建造'),
      h('div', { class: 'grid c4' }, Object.values(TOWN_BUILDING_DEF).map(def => {
        const unlocked = town.isUnlocked(def.id);
        const affordable = run.canAfford(def.cost);
        return h('div', {
          class: `card${unlocked ? '' : ' locked'}`,
          onclick: () => {
            if (!unlocked) { notice('尚未解锁', `${def.name} 需要更高的城镇等级或对应科技。`, 'warn'); return; }
            actions.startPlacement('town', def.id);
            game.ui.pendingPanelReopen = () => openTownPanel(game, actions);
          },
        }, [
          h('span', { class: 'icon-badge' }, def.icon),
          h('h3', {}, def.name),
          h('div', { class: 'desc' }, def.desc),
          h('div', { class: 'cost' }, costNodes(def.cost, run)),
          unlocked ? (affordable ? h('div', { class: 'effect' }, '点击放置') : h('div', { class: 'effect', style: { color: '#ff5f6d' } }, '资源不足'))
            : h('div', { class: 'effect', style: { color: '#ff5f6d' } }, '未解锁'),
        ]);
      }),
      ),
    ]));

    // ---- 军械工坊：制造护甲与武器 ----
    // 放在「可建造」之后：没造工坊之前这一节只有一句提示，
    // 摆在前面会把真正要操作的「可建造」挤到屏幕外。
    if (run.townBuildings.some(b => b.type === 'workshop')) {
      out.push(h('div', { class: 'section' }, [
        h('h3', {}, '⚒ 军械工坊 · 制造装备'),
        renderCraft(),
      ]));
    } else {
      out.push(h('div', { class: 'section' }, [
        h('h3', {}, '⚒ 军械工坊 · 制造装备'),
        h('div', { class: 'desc' }, '建造【军械工坊】之后，就能在这里用材料制造护甲与武器。'
          + '能造的品质由城镇等级决定，最高紫色 —— 红色装备只能靠打。'),
      ]));
    }

    // ---- 城镇等级表 ----
    out.push(h('div', { class: 'section' }, [
      h('h3', {}, '城镇等级'),
      ...POP_TIERS.map(t => h('div', {
        class: `list-row${run.population >= t.pop ? ' hot' : ''}`,
      }, [
        h('div', { class: 'grow' }, [
          h('div', { class: 'name' }, `${t.name}（人口 ${t.pop}+）`),
          h('div', { class: 'meta' }, t.desc),
        ]),
        h('span', { class: 'pill' }, run.population >= t.pop ? '已达成' : `${t.pop - run.population} 人`),
      ])),
    ]));

    return out;
  };

  const refresh = () => modals.refresh(render);

  modals.open({
    title: '殖民地经营',
    subtitle: '人口、生产、建筑 —— 让殖民地自己长大。',
    body: render(),
    wide: true,
    footer: [
      h('div', { style: { marginRight: 'auto', fontSize: '12px', color: '#8ba0bb' } },
        `工人效率 +${Math.round(run.playerStats.get('workerEfficiency') * 100)}% · 人口增长 +${Math.round(run.playerStats.get('popGrowthMult') * 100)}%`),
      button('关闭', () => { modals.close(); game.paused = false; }),
    ],
    onClose: () => { game.paused = false; },
  });
}
