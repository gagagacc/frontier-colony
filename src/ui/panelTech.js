/**
 * 主科技树面板：节点连接的横向科技树。
 *
 * 为什么改成这样：
 *   原来是一排排列卡片，每张卡都把所有信息（描述、费用、状态）摊在脸上。
 *   三条分支 × 十几张卡 = 一屏文字，玩家根本看不出「先点哪个、点了能到哪」——
 *   而这恰恰是科技树唯一需要表达的东西。
 *
 * 现在：只有图标 + 名字，从左往右按层级排，前置用连线画出来。
 * 鼠标悬停（或手柄聚焦）时右侧才显示详细信息。信息密度交给交互，不交给排版。
 */

import { BRANCH, BRANCH_DEF, techsByBranch, techAvailable } from '../data/tech.js';
import { h, button } from './dom.js';
import { bus, EV } from '../core/events.js';
import { RARITY_DEF } from '../data/weapons.js';

const COST_NAMES = {
  gold: '金币', metal: '金属', crystal: '晶体', parts: '零件', sulfur: '硫磺',
  coolant: '冷却剂', fiber: '纤维', food: '食物', tech: '数据核心',
  research: '研究资料', beaconCore: '吸引核心', dna: '基因样本', biomass: '生物质',
  wood: '木质', water: '冷凝水', chitin: '甲壳', spore: '孢子', fuel: '燃料',
};

const NODE_W = 116;
const NODE_H = 74;
const COL_GAP = 46;
const ROW_GAP = 18;

export function costNodes(cost, run) {
  const out = [];
  for (const [k, v] of Object.entries(cost || {})) {
    const have = run.resources[k] || 0;
    const enough = have >= v;
    out.push(h('span', {
      style: { color: enough ? '#c08cff' : '#ff5f6d', marginRight: '10px', fontSize: '12px' },
      title: enough ? '' : `当前 ${Math.floor(have)}`,
    }, `${COST_NAMES[k] || k} ${v}${enough ? '' : `（缺 ${Math.ceil(v - have)}）`}`));
  }
  return out;
}

export function openTechPanel(game, actions, opts = {}) {
  const run = game.run;
  const modals = game.ui.modals;
  const state = { branch: opts.branch || BRANCH.DEFENSE, focus: null };

  const refresh = () => modals.refresh(() => render());

  const render = () => {
    // 武器火力单独一页：四条线 17 个节点挤进「防御工程」会把图撑到面板外
    const branches = [BRANCH.DEFENSE, BRANCH.WEAPON, BRANCH.ADMIN, BRANCH.EXPLORE];
    if (run.characterId === 'biologist') branches.push(BRANCH.BIO);
    // 驾驶员单开一条「载具工程」（玩家要求：不要混在原本的载具科技里）
    if (run.characterId === 'pilot') branches.push(BRANCH.VEHICLE);

    const tabs = h('div', { class: 'btn-row', dataset: { gpTabs: '1' }, style: { marginBottom: '12px' } }, []);
    for (const b of branches) {
      const def = BRANCH_DEF[b];
      const list = techsByBranch(b, run.characterId);
      const done = list.filter(t => run.unlockedTech.has(t.id)).length;
      tabs.appendChild(button(`${def.icon} ${def.name} ${done}/${list.length}`,
        () => { state.branch = b; state.focus = null; refresh(); },
        `btn${state.branch === b ? ' primary' : ''}`));
    }

    const list = techsByBranch(state.branch, run.characterId);
    const tree = buildTree(list, run);
    const focused = list.find(t => t.id === state.focus) || null;

    const body = [
      tabs,
      h('div', { style: { color: '#8ba0bb', fontSize: '12px', marginBottom: '12px' } },
        `${BRANCH_DEF[state.branch].desc}　·　从左往右是研发顺序，连线表示前置。鼠标移上去看详情。`),
      /*
       * 图区：横竖都能滚。
       *
       * 加上「武器成长」四条线之后防御分支有 33 个节点，最挤的一列有 7~8 个，
       * 整张图比面板高 —— 以前 `overflowY: 'hidden'` 会把最下面一排**直接切掉**
       * （截图里「枪管延长 Ⅰ/Ⅱ/Ⅲ」正好压在边缘上，玩家看不到也点不到）。
       * 现在给一个可视高度上限 + 双向滚动，图再大也能翻到底。
       */
      h('div', { style: { display: 'flex', gap: '18px', alignItems: 'flex-start' } }, [
        h('div', { style: { flex: '1 1 auto', overflow: 'auto', maxHeight: '56vh', paddingBottom: '8px' } }, [
          renderGraph(tree, list, focused),
        ]),
        h('div', { style: { flex: '0 0 320px', maxHeight: '56vh', overflowY: 'auto' } }, [renderDetail(focused)]),
      ]),
      h('div', { class: 'section', style: { marginTop: '18px' } }, [
        h('h3', {}, '当前加成概览'),
        h('div', { class: 'kv', style: { maxWidth: '640px' } }, buildStatSummary(run)),
      ]),
    ];
    return body;
  };

  /** 把科技按 tier 分列 —— tier 就是「从左边数第几列」 */
  function buildTree(list, run) {
    const cols = new Map();
    for (const t of list) {
      const c = t.tier || 0;
      if (!cols.has(c)) cols.set(c, []);
      cols.get(c).push(t);
    }
    const tiers = [...cols.keys()].sort((a, b) => a - b);
    /*
     * 列宽自适应：列数多的时候把节点与间距收紧一点。
     * 武器火力有 6 列，按默认的 116+46 排出来比「图区宽度 - 详情栏」还宽，
     * 最后一列（击发机构 Ⅴ / 三联弹道）会被推到可视区外面 —— 只能靠横向滚动找，
     * 而玩家根本不知道右边还有东西。收紧之后六列能整整齐齐放在一屏里。
     */
    const nodeW = tiers.length >= 6 ? 104 : NODE_W;
    const colGap = tiers.length >= 6 ? 28 : COL_GAP;
    const width = tiers.length * nodeW + (tiers.length - 1) * colGap;
    const positions = new Map();

    /*
     * 有 lane 的分支（武器火力）按「一条线一行」排。
     *
     * 那四条线是平行的：射程 / 伤害 / 射速 / 弹道，每级一列。
     * 按普通的「列内竖着堆」会排成 6 列 × 4 行，宽到必须横向滚动；
     * 按 lane 收成 4 行之后，一眼就能看出「这一行是射程，走到第几格了」。
     */
    const laned = list.every(t => t.lane != null);
    if (laned) {
      const lanes = Math.max(...list.map(t => t.lane), 0) + 1;
      const height = lanes * NODE_H + (lanes - 1) * ROW_GAP;
      tiers.forEach((tier, ci) => {
        for (const t of cols.get(tier)) {
          positions.set(t.id, { x: ci * (nodeW + colGap), y: t.lane * (NODE_H + ROW_GAP) });
        }
      });
      return { tiers, width, height, positions, cols, nodeW, colGap };
    }

    const maxRows = Math.max(...tiers.map(t => cols.get(t).length), 1);
    const height = maxRows * NODE_H + (maxRows - 1) * ROW_GAP;

    tiers.forEach((tier, ci) => {
      const items = cols.get(tier);
      const totalH = items.length * NODE_H + (items.length - 1) * ROW_GAP;
      const top = (height - totalH) / 2;
      items.forEach((t, ri) => {
        positions.set(t.id, {
          x: ci * (nodeW + colGap),
          y: top + ri * (NODE_H + ROW_GAP),
        });
      });
    });
    return { tiers, width, height, positions, cols, nodeW, colGap };
  }

  function statusOf(tech) {
    const unlocked = run.unlockedTech.has(tech.id);
    const available = techAvailable(tech, run.unlockedTech);
    const affordable = run.canAfford(tech.cost);
    return { unlocked, available, affordable };
  }

  /** 用绝对定位的 div 画节点，用 SVG 画连线 */
  function renderGraph(tree, list, focused) {
    const wrap = h('div', {
      style: {
        position: 'relative',
        width: tree.width + 'px',
        height: tree.height + 'px',
        minWidth: '100%',
      },
    });

    // --- 连线 ---
    const edges = [];
    for (const t of list) {
      for (const r of (t.req || [])) {
        const a = tree.positions.get(r);
        const b = tree.positions.get(t.id);
        if (a && b) edges.push({ a, b, ok: run.unlockedTech.has(r) });
      }
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(tree.width));
    svg.setAttribute('height', String(tree.height));
    svg.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible';
    for (const e of edges) {
      const x1 = e.a.x + (tree.nodeW || NODE_W), y1 = e.a.y + NODE_H / 2;
      const x2 = e.b.x, y2 = e.b.y + NODE_H / 2;
      const mid = (x1 + x2) / 2;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', e.ok ? 'rgba(110,231,168,0.75)' : 'rgba(120,190,255,0.22)');
      path.setAttribute('stroke-width', e.ok ? '2.5' : '1.6');
      if (!e.ok) path.setAttribute('stroke-dasharray', '4 4');
      svg.appendChild(path);
    }
    wrap.appendChild(svg);

    // --- 节点 ---
    for (const tech of list) {
      const pos = tree.positions.get(tech.id);
      const st = statusOf(tech);
      const isFocus = focused && focused.id === tech.id;
      // 状态用边框与底色表达，不用文字
      const border = st.unlocked ? 'rgba(110,231,168,0.85)'
        : !st.available ? 'rgba(120,140,170,0.25)'
          : st.affordable ? 'rgba(255,186,76,0.7)' : 'rgba(255,95,109,0.55)';
      const bg = st.unlocked ? 'rgba(24,60,45,0.92)'
        : !st.available ? 'rgba(14,18,28,0.9)'
          : 'rgba(18,26,44,0.95)';

      const node = h('div', {
        class: 'tech-node',
        style: {
          position: 'absolute',
          left: pos.x + 'px',
          top: pos.y + 'px',
          width: (tree.nodeW || NODE_W) + 'px',
          height: NODE_H + 'px',
          border: `1px solid ${border}`,
          background: bg,
          borderRadius: '10px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '2px',
          cursor: st.unlocked ? 'default' : 'pointer',
          opacity: st.available || st.unlocked ? '1' : '0.55',
          boxShadow: isFocus ? '0 0 0 2px #ffba4c' : 'none',
          padding: '4px',
          textAlign: 'center',
        },
        onmouseenter: () => { state.focus = tech.id; refresh(); },
        onclick: () => {
          if (st.unlocked) return;
          if (!st.available) { bus.emit(EV.SFX, { name: 'error' }); state.focus = tech.id; refresh(); return; }
          if (actions.unlockTech(tech.id)) { state.focus = tech.id; refresh(); }
          else { state.focus = tech.id; refresh(); }
        },
      }, [
        h('div', { style: { fontSize: '22px', lineHeight: '1.1' } }, tech.icon),
        h('div', {
          style: {
            fontSize: '11px', lineHeight: '1.25', color: st.unlocked ? '#6ee7a8' : '#d8e6f5',
            maxWidth: '108px', overflow: 'hidden', textOverflow: 'ellipsis',
          },
        }, tech.name),
        st.unlocked ? h('div', { style: { fontSize: '9px', color: '#6ee7a8' } }, '已解锁') : null,
      ]);
      wrap.appendChild(node);
    }
    return wrap;
  }

  /** 右侧详情：没聚焦时显示操作提示 */
  function renderDetail(tech) {
    if (!tech) {
      return h('div', { class: 'panel', style: { padding: '14px' } }, [
        h('div', { class: 'panel-title' }, '科技详情'),
        h('div', { style: { fontSize: '12px', color: '#8ba0bb', lineHeight: '1.9' } }, [
          h('div', {}, '把鼠标移到左边的节点上，这里会显示它的完整信息。'),
          h('div', { style: { marginTop: '8px' } }, '· 金色边框 = 现在可以申请'),
          h('div', {}, '· 红色边框 = 资源不够'),
          h('div', {}, '· 灰色 = 前置科技还没解锁'),
          h('div', {}, '· 绿色 = 已经解锁'),
        ]),
      ]);
    }
    const st = statusOf(tech);
    const reqs = (tech.req || []).map(id => techsByBranch(state.branch, run.characterId).find(t => t.id === id)).filter(Boolean);
    return h('div', { class: 'panel', style: { padding: '14px' } }, [
      h('div', { class: 'panel-title' }, BRANCH_DEF[tech.branch]?.name || '科技'),
      h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px' } }, [
        h('span', { style: { fontSize: '26px' } }, tech.icon),
        h('div', {}, [
          h('div', { style: { fontSize: '15px', fontWeight: '600' } }, tech.name),
          h('div', { style: { fontSize: '11px', color: '#8ba0bb' } }, `第 ${(tech.tier || 0) + 1} 层`),
        ]),
      ]),
      h('div', { style: { fontSize: '12px', color: '#c8d8ea', lineHeight: '1.75', marginBottom: '10px' } }, tech.desc),
      h('div', { style: { fontSize: '12px', marginBottom: '8px' } },
        h('span', { style: { color: '#8ba0bb' } }, '申请费用：'), ...costNodes(tech.cost, run)),
      reqs.length ? h('div', { style: { fontSize: '11px', color: '#8ba0bb', marginBottom: '10px' } },
        `前置：${reqs.map(r => r.name).join('、')}`) : null,
      st.unlocked
        ? h('div', { style: { color: '#6ee7a8', fontSize: '13px' } }, '✔ 已解锁')
        : h('div', {}, [
          button(!st.available ? '前置科技未解锁' : !st.affordable ? '资源不足' : '申请（点击解锁）',
            () => {
              if (!st.available || !st.affordable) { bus.emit(EV.SFX, { name: 'error' }); return; }
              actions.unlockTech(tech.id);
              refresh();
            },
            `btn${st.available && st.affordable ? ' primary' : ''}`),
        ]),
    ]);
  }

  modals.open({
    title: '科技申请',
    subtitle: '以上级殖民政府的名义，把资源换成技术与授权。',
    body: render(),
    wide: true,
    footer: [
      h('div', { style: { marginRight: 'auto', color: '#8ba0bb', fontSize: '12px' } },
        '提示：防御科技提供塔与建筑，经营科技提供自动化，探索科技决定你能走多远。Esc 关闭。'),
      button('关闭', () => { modals.close(); game.paused = false; }, 'btn'),
    ],
    onClose: () => { game.paused = false; },
  });
}

function buildStatSummary(run) {
  const st = run.playerStats;
  const rows = [];
  const add = (k, v, fmtFn = (x) => x) => { if (Math.abs(v) > 0.0001) rows.push(h('div', { class: 'k' }, k), h('div', { class: 'v' }, fmtFn(v))); };

  add('伤害加成', st.get('damage'), (v) => `+${Math.round(v * 100)}%`);
  add('攻速加成', st.get('attackSpeed'), (v) => `+${Math.round(v * 100)}%`);
  add('暴击率', st.get('critChance'), (v) => `+${Math.round(v * 100)}%`);
  add('生命上限', st.get('hpMax'), (v) => `+${Math.round(v)}`);
  add('护甲', st.get('armor'), (v) => `+${Math.round(v)}`);
  add('移速', st.get('speedMult'), (v) => `+${Math.round(v * 100)}%`);
  add('防御塔伤害', st.get('towerDamage'), (v) => `+${Math.round(v * 100)}%`);
  add('防御塔攻速', st.get('towerAttackSpeed'), (v) => `+${Math.round(v * 100)}%`);
  add('防御塔上限', st.get('towerCap'), (v) => `+${Math.round(v)}`);
  add('金币获取', st.get('goldMult'), (v) => `+${Math.round(v * 100)}%`);
  add('材料获取', st.get('matMult'), (v) => `+${Math.round(v * 100)}%`);
  add('采集产出', st.get('mineYield'), (v) => `每次 +${Math.round(v)}`);
  add('经验获取', st.get('xpMult'), (v) => `+${Math.round(v * 100)}%`);
  add('载具速度', st.get('vehicleSpeedMult'), (v) => `+${Math.round(v * 100)}%`);
  add('炮塔挂架', st.get('vehicleTurretCap'), (v) => `+${Math.round(v)}`);
  add('吸引半径', st.get('beaconRadiusMult'), (v) => `+${Math.round(v * 100)}%`);
  add('人口上限', st.get('popCap'), (v) => `+${Math.round(v)}`);
  add('工人效率', st.get('workerEfficiency'), (v) => `+${Math.round(v * 100)}%`);

  void RARITY_DEF;
  if (!rows.length) return [h('div', { class: 'k' }, '暂无加成'), h('div', { class: 'v' }, '——')];
  return rows;
}
