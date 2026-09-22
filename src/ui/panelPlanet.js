/**
 * 星球面板：占领结算、继续经营、开拓下一颗星球。
 * 也负责展示旧星球的太空快递收益。
 */

import { planetDef } from '../data/planets.js';
import { h, button } from './dom.js';

const ENV_ICONS = ['🜁', '☢', '❄', '⇊', '☣', '⚡', '☾', '⌖'];

export function openPlanetPanel(game, actions, opts = {}) {
  const run = game.run;
  const modals = game.ui.modals;
  const mode = opts.mode || 'overview';
  const nextIndex = opts.nextIndex ?? run.planetIndex + 1;
  const nextDef = opts.def || planetDef(nextIndex);

  const render = () => {
    const out = [];
    const stats = run.world.stats;

    // 当前星球
    out.push(h('div', { class: 'panel', style: { marginBottom: '16px' } }, [
      h('div', { class: 'panel-title' }, '当前星球'),
      h('div', { style: { fontSize: '20px', letterSpacing: '3px', color: '#8fe0ff', marginBottom: '8px' } },
        run.planet.name),
      h('div', { class: 'kv' }, [
        h('div', { class: 'k' }, '环境'), h('div', { class: 'v' }, run.planet.environment.name),
        h('div', { class: 'k' }, '难度层级'), h('div', { class: 'v' }, `${run.planetIndex + 1}`),
        h('div', { class: 'k' }, '虫巢'), h('div', { class: 'v' }, `${stats.clearedNests} / ${stats.totalNests} 已清除`),
        h('div', { class: 'k' }, '占领状态'), h('div', { class: `v ${run.planetClaimed ? 'good' : 'bad'}` }, run.planetClaimed ? '已占领' : '未占领'),
        h('div', { class: 'k' }, '人口'), h('div', { class: 'v' }, `${run.population}`),
      ]),
      h('div', { class: 'desc', style: { marginTop: '10px' } }, run.planet.environment.desc),
    ]));

    if (!run.planetClaimed) {
      out.push(h('div', { class: 'panel', style: { marginBottom: '16px', borderColor: 'rgba(255,186,76,0.4)' } }, [
        h('div', { class: 'panel-title' }, '占领条件'),
        h('div', { class: 'desc' }, `清除这颗星球上所有 ${stats.totalNests} 个虫巢后即可占领。还剩 ${stats.aliveNests} 个。`),
        h('div', { style: { marginTop: '8px', fontSize: '12px', color: '#8ba0bb' } },
          '提示：巢穴 Boss 会掉落吸引核心；清巢会永久降低这一带的出怪量与收益 —— 但这是推进主线的唯一方式。'),
      ]));
      return out;
    }

    // 已占领
    out.push(h('div', { class: 'panel', style: { marginBottom: '16px' } }, [
      h('div', { class: 'panel-title' }, '占领收益'),
      h('div', { class: 'desc' }, '这颗星球已经纳入殖民地版图，会通过太空快递定期支援物资。你可以继续经营，也可以开拓下一颗星球。'),
      h('div', { class: 'kv', style: { marginTop: '10px' } }, [
        h('div', { class: 'k' }, '快递间隔'), h('div', { class: 'v' }, `每 ${Math.round(run.planet.supply.interval / (1 + run.playerStats.get('supplyDropRate')))} 秒`),
        ...Object.entries(run.planet.supply.amount).map(([k, v]) =>
          h('div', { class: 'k' }, `每次 ${k}`), h('div', { class: 'v' }, `+${Math.round(v * (1 + run.playerStats.get('supplyBonus')) * (1 + run.playerStats.get('supplyDropRate')))}`)),
      ]),
    ]));

    // 已开拓星球列表
    if (run.claimedPlanets.length) {
      out.push(h('div', { class: 'section' }, [
        h('h3', {}, `已开拓星球（${run.claimedPlanets.length}）`),
        ...run.claimedPlanets.map(p => h('div', { class: 'list-row' }, [
          h('span', { style: { fontSize: '18px' } }, '🜨'),
          h('div', { class: 'grow' }, [
            h('div', { class: 'name' }, p.name),
            h('div', { class: 'meta' }, `难度 ${p.index + 1} · 已转入自动生产，持续提供太空快递`),
          ]),
          h('span', { class: 'pill good' }, '生产中'),
        ])),
      ]));
    }

    // 下一颗星球
    const locked = !run.hasFeature('nextPlanet') && run.unlockedTech.has('t_deepSpace') === false;
    out.push(h('div', { class: 'section' }, [
      h('h3', {}, '开拓新星球'),
      h('div', { class: 'panel', style: { borderColor: mode === 'confirm' ? 'rgba(255,186,76,0.5)' : undefined } }, [
        h('div', { style: { fontSize: '18px', letterSpacing: '2px', color: '#ffba4c', marginBottom: '8px' } },
          `${nextDef.name} · ${nextDef.suffix}`),
        h('div', { class: 'kv' }, [
          h('div', { class: 'k' }, '环境'), h('div', { class: 'v' }, nextDef.environment.name),
          h('div', { class: 'k' }, '虫巢数量'), h('div', { class: 'v' }, `约 ${nextDef.nestCount} 个`),
          h('div', { class: 'k' }, '怪物强度'), h('div', { class: 'v' }, `×${(1 + nextIndex * 0.38).toFixed(2)}`),
          h('div', { class: 'k' }, '资源产出'), h('div', { class: 'v' }, `×${nextDef.resourceMult.toFixed(2)}`),
          h('div', { class: 'k' }, '塔科技'), h('div', { class: 'v bad' }, '重置（需重新申请授权）'),
          h('div', { class: 'k' }, '角色/装备/实验科技'), h('div', { class: 'v good' }, '全部保留'),
          h('div', { class: 'k' }, '旧星球'), h('div', { class: 'v good' }, '转入自动生产 + 太空快递'),
        ]),
        h('div', { class: 'desc', style: { marginTop: '10px', lineHeight: '1.8' } }, [
          h('div', {}, `环境惩罚：${nextDef.environment.desc}`),
          h('div', { style: { marginTop: '6px' } },
            '新星球需要重新适应环境 —— 所有防御塔科技点重置，但你在旧星球积累的等级、装备、实验科技与主科技树都会保留，前期重复度会低很多。'),
        ]),
        mode === 'confirm' ? h('div', { class: 'btn-row', style: { marginTop: '16px' } }, [
          button('🚀 确认启程', () => {
            const next = actions.doTravelToPlanet(nextIndex);
            if (!next) return;
            modals.close();
            game.paused = false;
            game.ui.startRun(next, { fromTravel: true });
          }, 'btn primary'),
          button('再想想', () => { modals.close(); game.paused = false; }, 'btn'),
        ]) : h('div', { class: 'btn-row', style: { marginTop: '16px' } }, [
          button('开拓这颗星球', () => { actions.travelToNextPlanet(); }, 'btn primary'),
        ]),
      ]),
    ]));

    return out;
  };

  const refresh = () => modals.refresh(render);

  modals.open({
    title: '星球与远征',
    subtitle: run.planetClaimed ? '这颗星球已经属于你了。' : '清光虫巢，这颗星球就是你的。',
    body: render(),
    wide: true,
    footer: [
      h('div', { style: { marginRight: 'auto', fontSize: '12px', color: '#8ba0bb' } },
        `已开拓 ${run.claimedPlanets.length + (run.planetClaimed ? 0 : 1)} 颗星球`),
      button('关闭', () => { modals.close(); game.paused = false; }),
    ],
    onClose: () => { game.paused = false; },
  });
}
