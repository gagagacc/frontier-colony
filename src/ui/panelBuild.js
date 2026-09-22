/**
 * 建造与空投面板：向上级申请防御塔（空投下来）、建造建筑、铺路、吸引阵列管理。
 */

import { TOWER_DEF, STRUCTURE_DEF, STRUCTURE } from '../data/towers.js';
import { BEACON, TILE } from '../core/config.js';
import { h, button } from './dom.js';
import { notice } from '../core/events.js';
import { costNodes } from './panelTech.js';
import { scaleCost } from '../systems/towers.js';

export function openBuildPanel(game, actions) {
  const run = game.run;
  const modals = game.ui.modals;
  const state = { tab: 'tower' };

  const render = () => {
    const out = [];
    // 页签（data-gp-tabs 让手柄肩键能在这几个页签间循环）
    out.push(h('div', { class: 'btn-row', dataset: { gpTabs: '1' }, style: { marginBottom: '16px' } }, [
      button('🛡 防御塔空投', () => { state.tab = 'tower'; refresh(); }, `btn${state.tab === 'tower' ? ' primary' : ''}`),
      button('🏗 建筑与工事', () => { state.tab = 'structure'; refresh(); }, `btn${state.tab === 'structure' ? ' primary' : ''}`),
      // 「吸引阵列」曾经是独立页签，现在并进核心舱（基地）那一页
      button('⊕ 基地与核心舱', () => { state.tab = 'base'; refresh(); }, `btn${state.tab === 'base' ? ' primary' : ''}`),
    ]));

    if (state.tab === 'tower') out.push(buildTowerTab(run, actions, modals, game, refresh));
    else if (state.tab === 'structure') out.push(buildStructureTab(run, actions, modals, game, refresh));
    else out.push(buildBaseTab(run, actions, modals, game, refresh));

    return out;
  };

  const refresh = () => modals.refresh(render);

  modals.open({
    title: '建造与空投',
    subtitle: '防御塔靠金币与材料向上级申请，然后空投下来。',
    body: render(),
    wide: true,
    footer: [
      h('div', { style: { marginRight: 'auto', fontSize: '12px', color: '#8ba0bb' } },
        `防御塔 ${run.towers.length}/${run.towerSystem.towerCap()} · 空投速度 +${Math.round(run.playerStats.get('airDropSpeed') * 100)}% · 建造费用 ${Math.round(run.playerStats.get('buildCostMult') * 100)}% · 空地放塔要留间隔，放在【防御塔基座】上不需要`),
      button('关闭', () => { modals.close(); game.paused = false; }),
    ],
    onClose: () => { game.paused = false; },
  });
}

function buildTowerTab(run, actions, modals, game, refresh) {
  const avail = run.unlockedTowers();
  const all = Object.values(TOWER_DEF);
  const cap = run.towerSystem.towerCap();
  const charMult = run.charDef.passive.towerCostMult || 1;

  const grid = h('div', { class: 'grid c3' }, all.map(def => {
    const unlocked = avail.some(t => t.id === def.id);
    const exclusiveLocked = def.exclusive && def.exclusive !== run.characterId;
    const cost = scaleCost(def.cost, charMult * (1 + run.playerStats.get('buildCostMult')));
    const affordable = run.canAfford(cost);
    const atCap = run.towers.length >= cap;
    const isSupport = def.kind === 'support';

    return h('div', {
      class: `card${!unlocked || exclusiveLocked ? ' locked' : ''}`,
      onclick: () => {
        if (exclusiveLocked) { notice('角色专属', `${def.name} 只有${def.exclusive === 'engineer' ? '工程师' : def.exclusive}能建造。`, 'warn'); return; }
        if (!unlocked) { notice('尚未授权', `${def.name} 需要先在科技树里申请授权。`, 'warn'); return; }
        if (atCap) { notice('塔位已满', `当前上限 ${cap}，用科技或实验科技扩建。`, 'warn'); return; }
        // startPlacement 自己会关面板并暂停；不要再依赖 modals.close() 的顺序
        actions.startPlacement('tower', def.id);
        game.ui.pendingPanelReopen = () => openBuildPanel(game, actions);
      },
    }, [
      h('span', { class: 'icon-badge' }, def.icon),
      h('h3', {}, def.name),
      h('span', { class: 'card-tag', style: { color: def.color } }, `T${def.tier}`),
      isSupport ? h('span', { class: 'card-tag tag-admin', style: { marginLeft: '6px' } }, '支援') : null,
      def.exclusive ? h('span', { class: 'card-tag tag-special', style: { marginLeft: '6px' } }, '专属') : null,
      h('div', { class: 'desc' }, def.desc),
      isSupport ? null : h('div', { class: 'effect' },
        `伤害 ${def.dmg} · 间隔 ${def.cd}s · 射程 ${def.range}${def.splash ? ` · 溅射 ${def.splash}` : ''}${def.chains ? ` · 链 ${def.chains}` : ''}`),
      def.repair ? h('div', { class: 'effect' }, `修复 ${def.repair.amount}/秒 · 半径 ${def.repair.radius}`) : null,
      def.shieldPool ? h('div', { class: 'effect' }, `共享护盾 ${def.shieldPool.amount}（恢复 ${def.shieldPool.regen}/秒）`) : null,
      h('div', { class: 'cost' }, costNodes(cost, run)),
      !unlocked ? h('div', { class: 'effect', style: { color: '#ff5f6d' } }, '需要科技授权')
        : atCap ? h('div', { class: 'effect', style: { color: '#ff5f6d' } }, '塔位已满')
          : !affordable ? h('div', { class: 'effect', style: { color: '#ff5f6d' } }, '资源不足')
            : h('div', { class: 'effect' }, '点击申请空投'),
    ]);
  }));

  return [
    h('div', { style: { fontSize: '12.5px', color: '#a8bcd4', marginBottom: '14px', lineHeight: '1.7' } }, [
      h('div', {}, '· 防御塔全部自动索敌开火。把鼠标移到塔上按 C 可以【手动接管】，伤害 +60% 并附带范围伤害。'),
      h('div', {}, '· 空投需要时间，在虫潮里被拆掉的塔会自动重新申请（需要【空投自动化】科技）。'),
    ]),
    grid,
  ];
}

function buildStructureTab(run, actions, modals, game, refresh) {
  const unlocked = run.unlockedStructures();
  const all = Object.values(STRUCTURE_DEF);
  return [
    h('div', { class: 'grid c4' }, all.map(def => {
      const isUnlocked = unlocked.has(def.id) || def.id === STRUCTURE.TURRET_SLOT && run.unlockedTech.has('t_turretSlot');
      const cost = scaleCost(def.cost, 1 + run.playerStats.get('buildCostMult'));
      const affordable = run.canAfford(cost);
      return h('div', {
        class: `card${isUnlocked ? '' : ' locked'}`,
        onclick: () => {
          if (!isUnlocked) { notice('尚未解锁', `${def.name} 需要先解锁对应科技。`, 'warn'); return; }
          actions.startPlacement('structure', def.id);
          game.ui.pendingPanelReopen = () => openBuildPanel(game, actions);
        },
      }, [
        h('span', { class: 'icon-badge' }, def.icon),
        h('h3', {}, def.name),
        h('div', { class: 'desc' }, def.desc),
        def.hp ? h('div', { class: 'effect' }, `耐久 ${def.hp}${def.armor ? ` · 护甲 ${def.armor}` : ''}`) : null,
        def.produce ? h('div', { class: 'effect' }, Object.entries(def.produce).map(([k, v]) => `${k} +${v}/秒`).join(' · ')) : null,
        def.popCap ? h('div', { class: 'effect' }, `人口上限 +${def.popCap}`) : null,
        h('div', { class: 'cost' }, costNodes(cost, run)),
        !isUnlocked ? h('div', { class: 'effect', style: { color: '#ff5f6d' } }, '需要科技')
          : !affordable ? h('div', { class: 'effect', style: { color: '#ff5f6d' } }, '资源不足')
            : h('div', { class: 'effect' }, '点击放置'),
      ]);
    })),
  ];
}

function buildBeaconTab(run, actions, refresh) {
  const b = run.beacon;
  const cores = run.resources.beaconCore || 0;
  const upCost = { gold: 200 + b.level * 160, metal: 60 + b.level * 40, crystal: 10 + b.level * 12 };
  const needCores = 1 + Math.floor(b.level / 2);
  const maxed = b.level >= BEACON.maxLevel;
  const threat = run.threat;

  return [
    h('div', { class: 'cols' }, [
      h('div', { class: 'panel' }, [
        h('div', { class: 'panel-title' }, '核心舱 · 吸引阵列'),
        // 停机原因要说清楚：被打爆和没燃料是两件不同的事，处理方式也不同
        b.online ? null : h('div', { style: { color: '#ff5f6d', fontSize: '12.5px', marginBottom: '8px', lineHeight: '1.7' } },
          run.base?.destroyed
            ? '⚠ 核心舱已被摧毁 —— 阵列停机，虫群不再被牵引，它们直接冲你来。走到废墟旁按住 E 重建。'
            : '⚠ 吸引物质耗尽 —— 阵列停机。虫群失去牵引，正在追杀你。用吸引核心或能量电池重启它。'),
        h('div', { class: 'kv' }, [
          h('div', { class: 'k' }, '等级'), h('div', { class: 'v' }, `Lv.${b.level} / ${BEACON.maxLevel}`),
          h('div', { class: 'k' }, '运转'), h('div', { class: `v ${b.online ? 'good' : 'bad'}` }, b.online ? '在线' : '离线'),
          h('div', { class: 'k' }, '吸引物质'), h('div', { class: 'v' }, `${Math.ceil(b.fuel)} / ${b.fuelMax}`),
          h('div', { class: 'k' }, '牵引半径'), h('div', { class: 'v' }, `${Math.round(b.radius)} (${Math.round(b.radius / TILE)} 格)`),
          h('div', { class: 'k' }, '牵引强度'), h('div', { class: 'v' }, `${(b.intensity * 100).toFixed(0)}%`),
          h('div', { class: 'k' }, '吸引核心'), h('div', { class: 'v' }, `${cores}`),
        ]),
        h('div', { style: { fontSize: '11.5px', color: '#8ba0bb', marginTop: '10px', lineHeight: '1.7' } },
          '吸引阵列是核心舱的一部分，不再是一台独立设备：它自动牵引范围内的虫巢出怪。等级越高，拉到的巢穴越远、强度越高 —— 怪更多、掉落的金币与经验也更多，但基地更危险。'),
        h('div', { class: 'btn-row', style: { marginTop: '14px' } }, [
          button(maxed ? '已满级' : `升级到 Lv.${b.level + 1}`, () => { actions.upgradeBeacon(); refresh(); },
            `btn${maxed ? '' : ' primary'}`),
          button('用吸引核心充能', () => { actions.refuelBeaconFromCore(); refresh(); }, 'btn'),
        ]),
        maxed ? null : h('div', { class: 'cost', style: { marginTop: '10px' } },
          costNodes(upCost, run).concat([h('span', { style: { color: cores >= needCores ? '#c08cff' : '#ff5f6d' } }, `吸引核心 ${needCores}`)])),
      ]),
      h('div', { class: 'panel' }, [
        h('div', { class: 'panel-title' }, '当前压力'),
        h('div', { class: 'kv' }, [
          h('div', { class: 'k' }, '活着巢穴'), h('div', { class: 'v' }, `${threat.nests}`),
          h('div', { class: 'k' }, '总威胁'), h('div', { class: 'v' }, threat.total.toFixed(1)),
          h('div', { class: 'k' }, '基地压力'), h('div', { class: 'v' }, threat.basePressure.toFixed(1)),
          h('div', { class: 'k' }, '下一波'), h('div', { class: 'v' }, run.wave.state === 'calm' ? `${Math.ceil(run.wave.timer)} 秒` : run.wave.state),
        ]),
        h('div', { style: { fontSize: '11.5px', color: '#8ba0bb', marginTop: '10px', lineHeight: '1.7' } }, [
          h('div', {}, '· 每摧毁一个巢穴，这一带永久少一份出怪量 —— 压力下降，但收益也永久减少。'),
          h('div', {}, '· 这就是你要反复权衡的取舍：不清理会打更多、奖励更多；清理则推进主线、降低压力。'),
          h('div', {}, '· 吸引物质耗尽或核心舱被打爆时，怪不再被牵引，而是循着你的气味追杀你。'),
        ]),
        h('div', { class: 'btn-row', style: { marginTop: '14px' } }, [
          button('主动呼叫虫潮（拉收益）', () => { actions.forceWave(); refresh(); }, 'btn'),
        ]),
      ]),
    ]),
  ];
}

/** 核心舱的吸引阵列（原「吸引阵列」独立页签，现在并进「基地」页） */
function buildBeaconSection(run, actions, refresh) {
  return buildBeaconTab(run, actions, refresh);
}

function buildBaseTab(run, actions, modals, game, refresh) {
  const out = [];
  const hasSecond = run.hasFeature('secondBase');
  const secondBases = run.bases.filter(b => !b.isPrimary);

  /*
   * 吸引阵列并进核心舱。
   *
   * 玩家要求「把吸引阵列合并到核心舱」：它不再是野外一台独立设备，
   * 而是核心舱自带的一套阵列 —— 基地被打爆 = 阵列停机（不再吸引），
   * 吸引物质耗尽 = 虫群失去牵引、转而追杀你。
   * 所以它的状态与升级就放在「基地」这一页，和核心舱一起看。
   */
  out.push(buildBeaconSection(run, actions, refresh));

  out.push(h('div', { class: 'panel', style: { marginBottom: '16px' } }, [
    h('div', { class: 'panel-title' }, '基地概览'),
    ...run.bases.map(b => h('div', { class: 'list-row' }, [
      h('div', { class: 'grow' }, [
        h('div', { class: 'name' }, `${b.name}${b.destroyed ? ' 【已毁】' : ''}`),
        h('div', { class: 'meta' },
          `耐久 ${Math.ceil(b.hp)}/${b.maxHp}${b.maxShield ? ` · 护盾 ${Math.ceil(b.shield)}/${b.maxShield}` : ''} · 位置 ${Math.round(b.x)}, ${Math.round(b.y)}`),
      ]),
      b.destroyed ? h('span', { class: 'pill hot' }, '走到旁边按住 E 重建') : h('span', { class: 'pill good' }, '运转中'),
    ])),
  ]));

  out.push(h('div', { class: 'panel' }, [
    h('div', { class: 'panel-title' }, '第二基地'),
    !hasSecond
      ? h('div', { class: 'desc' }, [
        h('div', {}, '需要先研发【第二基地授权】科技（经营分支，T5）。'),
        h('div', { style: { marginTop: '6px', color: '#64748b' } },
          '第二基地共享人口与科技，可以独立建造与防守。建立后你必须同时守住两处 —— 但收益上限也翻倍。'),
      ])
      : h('div', {}, [
        h('div', { class: 'desc' }, `已建立 ${secondBases.length} / 2 座分基地。`),
        h('div', { class: 'btn-row', style: { marginTop: '10px' } }, [
          button('在大地图上选点建立', () => {
            if (secondBases.length >= 2) { notice('已达上限', '最多两座分基地。', 'warn'); return; }
            modals.close();
            game.paused = true;
            notice('选点模式', '在大地图上点击想建立第二基地的位置。', 'info');
            game.ui.openMapForSecondBase = true;
            import('./panelMap.js').then(m => m.openMapPanel(game, actions, { pickSecondBase: true }));
          }, 'btn primary'),
        ]),
        h('div', { class: 'cost', style: { marginTop: '8px' } }, costNodes({ gold: 800, metal: 300, parts: 50 }, run)),
      ]),
  ]));

  return out;
}
