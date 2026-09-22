/**
 * 系统类面板：暂停菜单、存档、帮助、游戏结束。
 */

import { h, button } from './dom.js';
import { fmt, fmtTime } from '../core/math.js';
import { SLOT_LABEL } from '../core/save.js';
import { GAME_MODE, MODE_DEF } from '../data/modes.js';
import { notice } from '../core/events.js';

export function openPauseMenu(game, actions) {
  const modals = game.ui.modals;
  const run = game.run;
  modals.open({
    title: '已暂停',
    subtitle: run ? `第 ${run.day} 天 · ${run.planet.name} · ${fmtTime(run.playTime)}` : '',
    body: [
      h('div', { class: 'menu-btns', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } }, [
        button('继续游戏', () => { modals.close(); game.paused = false; }, 'btn primary'),
        button('保存进度', () => { actions.save('auto'); }, 'btn'),
        button('存档管理', () => { modals.close(); actions.openSaves(); }, 'btn'),
        // 「操作说明」已经并进设置面板的一个页签，这里只留一个入口
        button('设置与操作', () => { game.ui?.openSettings?.('keys'); }, 'btn'),
        // 出错时能直接把堆栈交给别人看（玩家截图往往看不清行号）
        button(`错误日志（${(window.__frontierErrors || []).length}）`, () => { openErrorLog(game); }, 'btn'),
        button('返回主菜单', () => {
          if (confirm('返回主菜单？未保存的进度会丢失。')) {
            actions.backToMenu();
          }
        }, 'btn danger'),
        // 桌面版还要能直接退出程序（浏览器里没有这一项）
        game.isDesktop ? button('退出游戏', () => { game.ui?.quitGame?.(); }, 'btn danger') : null,
      ]),
      run ? h('div', { class: 'section', style: { marginTop: '20px' } }, [
        h('h3', {}, '本局统计'),
        h('div', { class: 'kv' }, [
          h('div', { class: 'k' }, '角色'), h('div', { class: 'v' }, `${run.charDef.name} Lv.${run.player.level}`),
          h('div', { class: 'k' }, '存活波次'), h('div', { class: 'v' }, `${run.stats.wavesSurvived} / ${run.stats.wavesTotal}`),
          h('div', { class: 'k' }, '击杀'), h('div', { class: 'v' }, `${run.stats.kills}（精英 ${run.stats.eliteKills} · Boss ${run.stats.bossKills}）`),
          h('div', { class: 'k' }, '巢穴'), h('div', { class: 'v' }, `${run.stats.nestsDestroyed} / ${run.world.nests.length}`),
          h('div', { class: 'k' }, '行走距离'), h('div', { class: 'v' }, `${fmt(run.stats.distance / 40)} 格`),
          h('div', { class: 'k' }, '造成伤害'), h('div', { class: 'v' }, fmt(run.stats.damageDealt)),
          h('div', { class: 'k' }, '累计金币'), h('div', { class: 'v' }, fmt(run.stats.goldEarned)),
          h('div', { class: 'k' }, '实验科技'), h('div', { class: 'v' }, `${run.experiments.size} 项`),
        ]),
      ]) : null,
    ],
    wide: false,
    onClose: () => { game.paused = false; },
  });
}

/**
 * 错误日志面板。
 *
 * 目的只有一个：玩家遇到报错时，能一眼看到「哪个文件第几行」，
 * 并且能一键复制给我。截图看不清行号这件事已经浪费过一整轮排查。
 */
export function openErrorLog(game) {
  const modals = game.ui.modals;
  const list = (window.__frontierErrors || []).slice().reverse();
  const body = [];
  body.push(h('div', { class: 'desc', style: { marginBottom: '12px' } },
    '这里是本次运行中捕获到的错误（最近的在前）。也可以在控制台（F12）输入 __frontierErrors 查看原始数据。'));
  if (!list.length) {
    body.push(h('div', { class: 'desc', style: { color: '#6ee7a8' } }, '本次运行没有捕获到错误 ✅'));
  }
  for (const e of list.slice(0, 12)) {
    body.push(h('div', { class: 'section', style: { marginBottom: '10px' } }, [
      h('div', { style: { color: '#ff8a8a', fontWeight: '700' } }, `${e.at} · ${e.kind} · ${e.msg}`),
      h('div', { style: { color: '#ffba4c', fontSize: '12px' } }, e.where || '(没有定位到源码位置)'),
      e.stack ? h('pre', {
        style: { fontSize: '11px', color: '#8ba0bb', whiteSpace: 'pre-wrap', margin: '6px 0 0', lineHeight: '1.5' },
      }, e.stack) : null,
    ]));
  }
  const copyText = () => {
    const text = list.map(e => `[${e.at}] ${e.kind} ${e.msg} @ ${e.where}\n${e.stack}`).join('\n\n');
    try {
      navigator.clipboard?.writeText(text);
      notice('已复制', '错误日志已复制到剪贴板。', 'good');
    } catch {
      notice('复制失败', '请手动选中上面的文字。', 'warn');
    }
  };
  modals.open({
    title: '错误日志',
    subtitle: `${list.length} 条`,
    body,
    footer: [
      button('复制全部', copyText, 'btn'),
      button('清空', () => { window.__frontierErrors = []; modals.refresh(() => []); modals.close(); }, 'btn'),
      button('关闭', () => modals.close(), 'btn primary'),
    ],
    wide: true,
  });
}

export function openSavesPanel(game, actions) {  const modals = game.ui.modals;
  const mgr = game.saveManager;

  const render = () => {
    const list = mgr.list();
    const out = [];
    out.push(h('div', { class: 'desc', style: { marginBottom: '14px' } },
      '浏览器存档保存在 localStorage；桌面版同时落盘到 userData/saves 目录，方便手动备份。'));
    for (const slot of list) {
      const meta = mgr.getMeta(slot.slot);
      out.push(h('div', { class: 'list-row' }, [
        h('div', { class: 'grow' }, [
          h('div', { class: 'name' }, SLOT_LABEL[slot.slot] || slot.slot),
          h('div', { class: 'meta' }, meta
            ? `${meta.planet} · ${meta.characterName || meta.character} Lv.${meta.level} · 第 ${meta.day} 天 · 第 ${meta.planetIndex + 1} 星球 · 巢穴 ${meta.nestsCleared} · ${new Date(meta.savedAt).toLocaleString('zh-CN')}`
            : '（空）'),
        ]),
        meta ? button('读取', () => {
          if (game.load(slot.slot)) {
            modals.close();
            game.paused = false;
            game.setState('playing');
          }
        }, 'btn small') : null,
        game.run ? button('保存到此', () => { actions.save(slot.slot); modals.refresh(render); }, 'btn small') : null,
        meta ? button('删除', () => {
          if (confirm('确定删除这个存档？')) { actions.deleteSave(slot.slot); modals.refresh(render); }
        }, 'btn small danger') : null,
      ]));
    }
    return out;
  };

  modals.open({
    title: '存档管理',
    subtitle: '自动存档每 3 分钟写一次。',
    body: render(),
    footer: [
      h('div', { style: { marginRight: 'auto', fontSize: '12px', color: '#8ba0bb' } },
        '建议关键节点前手动存一次（比如打 Boss 巢穴之前）。'),
      button('关闭', () => { modals.close(); if (game.state === 'playing') game.paused = false; else game.ui.showMainMenu(); }),
    ],
    onClose: () => { if (game.state === 'playing') game.paused = false; },
  });
}

export function openGameOver(game, actions, reason) {
  const modals = game.ui.modals;
  const run = game.run;
  const reasons = {
    baseLost: { title: '殖民地陷落', body: '基地已是废墟，而你也倒下了。这颗星球重新归于虫群。' },
    default: { title: '任务失败', body: '开拓计划中止。' },
  };
  const r = reasons[reason] || reasons.default;

  modals.open({
    title: r.title,
    subtitle: run ? `${run.planet.name} · 第 ${run.day} 天 · 存活 ${fmtTime(run.playTime)}` : '',
    body: [
      h('div', { style: { fontSize: '15px', lineHeight: '1.9', marginBottom: '18px' } }, r.body),
      run ? h('div', { class: 'kv' }, [
        h('div', { class: 'k' }, '角色'), h('div', { class: 'v' }, `${run.charDef.name} Lv.${run.player.level}`),
        h('div', { class: 'k' }, '击退波次'), h('div', { class: 'v' }, `${run.stats.wavesSurvived}`),
        h('div', { class: 'k' }, '击杀总数'), h('div', { class: 'v' }, `${run.stats.kills}`),
        h('div', { class: 'k' }, '摧毁巢穴'), h('div', { class: 'v' }, `${run.stats.nestsDestroyed}`),
        h('div', { class: 'k' }, '实验科技'), h('div', { class: 'v' }, `${run.experiments.size} 项`),
        h('div', { class: 'k' }, '累计金币'), h('div', { class: 'v' }, fmt(run.stats.goldEarned)),
      ]) : null,
      h('div', { class: 'desc', style: { marginTop: '18px' } },
        '实验科技与角色属性会保存在存档里 —— 你可以带更强的配置重来。'),
    ],
    footer: [
      button('读取存档', () => { modals.close(); actions.openSaves(); }, 'btn'),
      button('返回主菜单', () => { modals.close(); actions.backToMenu(); }, 'btn primary'),
    ],
    onClose: () => { },
  });
}
