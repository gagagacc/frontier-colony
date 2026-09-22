/**
 * 设置面板：按键绑定 / 显示 / 游戏性。
 *
 * 三个页签：
 *   按键   —— 每个动作都能改键，支持一个动作绑多个键，可单项重置或全部恢复默认
 *   显示   —— 全屏 / 窗口大小 / 界面缩放 / 帧率显示
 *   游戏   —— 伤害飘字、屏幕震动、自动收集等
 *
 * 改键的关键点：进入「按键捕获」时要把游戏输入**摘掉**（input.beginCapture），
 * 否则玩家按下的那个键会立刻触发游戏动作（比如按 B 想绑建造，结果直接开了建造面板）。
 * 捕获用的是 window 上的捕获阶段监听，所以一定比游戏自己的监听先拿到事件。
 */

import { h, button } from './dom.js';
import { notice } from '../core/events.js';
import {
  settings, BINDABLE_ACTIONS, keyLabel, keysLabel,
} from '../core/settings.js';
import {
  WINDOW_PRESETS, isDesktop, setFullscreen, applyWindowSize, getWindowState,
} from '../core/window.js';
import { MODE_DEF, MODE_LIST, GAME_MODE } from '../data/modes.js';
import { PAD_ROWS, ACTION_HELP, CORE_LOOP, FAILURE_ROWS } from '../data/help.js';

const FRONTIER = GAME_MODE.FRONTIER;
const TOWER_DEFENSE = GAME_MODE.TOWER_DEFENSE;

/**
 * @param {object} game
 * @param {object} actions
 * @param {object} opts { input, mode, onModeChange } 由 Ui 注入
 */
export function openSettings(game, actions, opts = {}) {
  const modals = game.ui.modals;
  const input = opts.input || game.input || null;
  let tab = opts.tab || 'keys';
  let win = null;                 // 窗口状态（异步取一次）
  let refresh = () => {};

  // 异步拿一次窗口状态，拿到后刷新界面对应的部分
  getWindowState().then((s) => { win = s; refresh(); }).catch(() => {});

  const render = () => {
    const body = [];
    body.push(h('div', { class: 'btn-row', style: { marginBottom: '14px', display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
      tabBtn('按键绑定', 'keys'),
      tabBtn('操作说明', 'help'),
      tabBtn('显示', 'display'),
      tabBtn('游戏性', 'gameplay'),
    ]));
    if (tab === 'keys') body.push(...renderKeys());
    else if (tab === 'help') body.push(...renderHelp());
    else if (tab === 'display') body.push(...renderDisplay());
    else body.push(...renderGameplay());
    return body;
  };

  const tabBtn = (label, id) => button(label,
    () => { tab = id; modals.refresh(render); },
    `btn${tab === id ? ' primary' : ''}`);

  // ---------- 操作说明页 ----------
  /**
   * 按键表**从 settings 实时读**，所以和「按键绑定」页永远一致 ——
   * 玩家改完键再翻到这页，看到的就是自己现在的键位。
   */
  const renderHelp = () => {
    const out = [];
    const keyRows = [];
    let lastGroup = null;
    for (const entry of BINDABLE_ACTIONS) {
      const desc = ACTION_HELP[entry.action];
      if (!desc) continue;
      if (entry.group !== lastGroup) {
        lastGroup = entry.group;
        keyRows.push(h('div', { class: 'section', style: { marginTop: keyRows.length ? '12px' : '0' } }, [
          h('h3', {}, entry.group),
        ]));
      }
      keyRows.push(h('div', { class: 'list-row' }, [
        h('span', { class: 'gp-key', style: { minWidth: '74px', justifyContent: 'center' } },
          keysLabel(settings.keysFor(entry.action))),
        h('div', { class: 'grow' }, [h('div', { class: 'name' }, desc)]),
      ]));
    }

    out.push(h('div', { class: 'cols' }, [
      h('div', { class: 'section' }, [
        h('h3', {}, '键盘与鼠标'),
        h('div', { class: 'desc', style: { marginBottom: '8px' } },
          '这一页的按键是从设置里实时读的；想改就切到「按键绑定」页。'),
        ...keyRows,
        h('div', { class: 'list-row', style: { marginTop: '12px' } }, [
          h('span', { class: 'gp-key', style: { minWidth: '74px', justifyContent: 'center' } }, '鼠标左键'),
          h('div', { class: 'grow' }, [h('div', { class: 'name' }, '攻击 / 开火 / 确认放置')]),
        ]),
        h('div', { class: 'list-row' }, [
          h('span', { class: 'gp-key', style: { minWidth: '74px', justifyContent: 'center' } }, 'F5 / F9'),
          h('div', { class: 'grow' }, [h('div', { class: 'name' }, '快速保存 / 快速读取')]),
        ]),
        h('div', { class: 'list-row' }, [
          h('span', { class: 'gp-key', style: { minWidth: '74px', justifyContent: 'center' } }, 'F3 / F4'),
          h('div', { class: 'grow' }, [h('div', { class: 'name' }, '调试信息 / 流场可视化')]),
        ]),
      ]),
      h('div', { class: 'section' }, [
        h('h3', {}, '手柄（Xbox 布局，插上即用）'),
        h('div', { class: 'kv', style: { gridTemplateColumns: 'auto 1fr' } },
          PAD_ROWS.flatMap(([k, v]) => [
            h('div', { class: 'k', style: { fontFamily: 'monospace', color: '#6ee7a8' } }, k),
            h('div', { class: 'v', style: { textAlign: 'left' } }, v),
          ])),
        h('div', { class: 'desc', style: { marginTop: '10px', color: '#64748b' } },
          '手柄和键鼠可以随时混用：动一下鼠标就切回鼠标瞄准，碰一下摇杆就切回手柄。支持震动反馈。'),
      ]),
    ]));

    out.push(h('div', { class: 'section', style: { marginTop: '18px' } }, [
      h('h3', {}, '两种模式'),
      h('div', { class: 'desc', style: { lineHeight: '1.9' } }, [
        h('div', {}, `❖ 开拓模式：${MODE_DEF[FRONTIER].desc}`),
        h('div', { style: { marginTop: '8px' } }, `⛨ 纯塔防模式：${MODE_DEF[TOWER_DEFENSE].desc}`),
        h('div', { style: { marginTop: '8px', color: '#ffba4c' } },
          '模式在主菜单里切换。纯塔防没有角色可以操控，材料按稀有度从怪物身上掉。'),
      ]),
    ]));

    out.push(h('div', { class: 'section', style: { marginTop: '18px' } }, [
      h('h3', {}, '核心循环'),
      h('div', { class: 'desc', style: { lineHeight: '1.9' } },
        CORE_LOOP.map((line, i) => h('div', {}, `${i + 1}. ${line}`))),
    ]));

    out.push(h('div', { class: 'section', style: { marginTop: '18px' } }, [
      h('h3', {}, '失败条件'),
      h('div', { class: 'desc', style: { lineHeight: '1.9' } }, FAILURE_ROWS.map(l => h('div', {}, l))),
    ]));
    return out;
  };

  // ---------- 按键页 ----------
  const renderKeys = () => {
    const out = [];
    out.push(h('div', { class: 'desc', style: { marginBottom: '12px' } },
      '点一下按键徽标就能改键：按下想用的键即可，Esc 取消。'
      + '一个动作可以绑多个键（点「+」追加），点徽标上的 × 删掉某一个键。'));

    let lastGroup = null;
    for (const entry of BINDABLE_ACTIONS) {
      if (entry.group !== lastGroup) {
        lastGroup = entry.group;
        out.push(h('div', { class: 'section', style: { marginTop: out.length ? '16px' : '0' } }, [
          h('h3', {}, entry.group),
        ]));
      }
      const keys = settings.keysFor(entry.action);
      const customized = settings.isCustomized(entry.action);
      out.push(h('div', { class: 'list-row', style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
        h('div', { class: 'grow' }, [
          h('div', { class: 'name' }, [
            entry.label,
            customized ? h('span', { class: 'card-tag', style: { marginLeft: '8px', color: '#ffba4c' } }, '已修改') : null,
          ]),
          entry.hint ? h('div', { class: 'meta' }, entry.hint) : null,
        ]),
        h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
          keys.map(code => h('span', {
            class: 'gp-key',
            style: { cursor: 'pointer', userSelect: 'none' },
            title: '点击删除该键',
            onclick: () => {
              if (keys.length <= 1) {
                notice('至少保留一个键', '想换键请直接点「改键」重新按一个。', 'warn');
                return;
              }
              settings.unbind(entry.action, code);
              modals.refresh(render);
            },
          }, [keyLabel(code), ' ×']))),
        button('改键', () => startCapture(entry.action, 'replace'), 'btn'),
        button('+', () => startCapture(entry.action, 'add'), 'btn'),
        customized ? button('重置', () => { settings.resetAction(entry.action); modals.refresh(render); }, 'btn') : null,
      ]));
    }

    out.push(h('div', { class: 'btn-row', style: { marginTop: '20px', display: 'flex', gap: '10px' } }, [
      button('全部恢复默认', () => {
        settings.resetAll();
        notice('已恢复默认设置', '按键与显示设置都回到出厂状态。', 'good');
        modals.refresh(render);
      }, 'btn danger'),
      button('关闭', () => modals.close(), 'btn'),
    ]));
    return out;
  };

  /** 进入改键状态：抓下一个按下的键 */
  const startCapture = (action, mode) => {
    const entry = BINDABLE_ACTIONS.find(a => a.action === action);
    const restore = input?.beginCapture ? input.beginCapture() : () => {};
    const done = (ok) => {
      window.removeEventListener('keydown', onKey, true);
      restore();
      modals.refresh(render);
      if (ok) notice('按键已更新', `${entry.label} → ${keysLabel(settings.keysFor(action))}`, 'good');
    };
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') { done(false); return; }
      const orphan = settings.wouldOrphan(action, e.code);
      if (orphan) {
        const other = BINDABLE_ACTIONS.find(a => a.action === orphan);
        notice('这个键不能占用',
          `它是「${other ? other.label : orphan}」唯一的按键。先给那个动作换个键，再回来改这里。`, 'warn');
        done(false);
        return;
      }
      const ok = settings.bind(action, e.code, mode);
      if (!ok) notice('这个键不能用', 'Esc 用来取消改键，不能绑定。', 'warn');
      done(ok);
    };
    window.addEventListener('keydown', onKey, true);
    modals.refresh(() => [
      h('div', { class: 'section' }, [
        h('h3', {}, '正在改键'),
        h('div', { class: 'desc' }, `按下要给「${entry.label}」使用的键，Esc 取消。`),
        h('div', { style: { marginTop: '14px', fontSize: '22px', color: '#ffba4c', letterSpacing: '4px' } }, '等待按键…'),
      ]),
      h('div', { class: 'btn-row', style: { marginTop: '18px' } }, [
        button('取消（Esc）', () => done(false), 'btn'),
      ]),
    ]);
  };

  // ---------- 显示页 ----------
  const renderDisplay = () => {
    const out = [];
    const full = !!win?.fullscreen;
    out.push(h('div', { class: 'section' }, [
      h('h3', {}, '窗口模式'),
      h('div', { class: 'desc' }, isDesktop()
        ? '桌面版可以直接切全屏；窗口大小会按你的屏幕自动限制，不会超出可视范围。'
        : '浏览器里全屏可用（部分浏览器需要你先点一下页面）；改窗口大小多数浏览器不允许脚本调整，请手动拖拽窗口。'),
      h('div', { class: 'btn-row', style: { marginTop: '10px', display: 'flex', gap: '10px' } }, [
        button(full ? '✓ 全屏' : '全屏', async () => {
          const r = await setFullscreen(true);
          win = await getWindowState();
          notice(r ? '已切换全屏' : '全屏失败', r ? '按 Alt+Tab 或再点窗口化返回。' : '浏览器可能拒绝了全屏请求。', r ? 'good' : 'warn');
          modals.refresh(render);
        }, `btn${full ? ' primary' : ''}`),
        button(!full ? '✓ 窗口化' : '窗口化', async () => {
          await setFullscreen(false);
          win = await getWindowState();
          modals.refresh(render);
        }, `btn${!full ? ' primary' : ''}`),
      ]),
    ]));

    out.push(h('div', { class: 'section', style: { marginTop: '18px' } }, [
      h('h3', {}, '窗口大小'),
      h('div', { class: 'desc' }, `当前：${win ? `${win.width} × ${win.height}` : '读取中…'}`),
      h('div', { class: 'grid c3', style: { marginTop: '10px' } }, WINDOW_PRESETS.map(p => {
        const active = settings.display.windowSize === p.id;
        return h('div', {
          class: `card${active ? ' selected' : ''}`,
          onclick: async () => {
            const ok = await applyWindowSize(p.id);
            if (!ok) notice('浏览器不允许改窗口', '请手动拖拽窗口边缘调整大小。', 'warn');
            win = await getWindowState();
            modals.refresh(render);
          },
        }, [
          h('h3', {}, p.label),
          h('div', { class: 'desc' }, p.desc),
        ]);
      })),
    ]));

    out.push(h('div', { class: 'section', style: { marginTop: '18px' } }, [
      h('h3', {}, '界面缩放'),
      h('div', { class: 'desc' },
        '游戏画面本身不缩放（窗口大就看到更多地图），只有 HUD、面板、字体跟着缩放。'
        + '默认「自动」按窗口面积算，觉得字太小/太大可以手动指定。'),
      h('div', { class: 'btn-row', style: { marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        [['auto', '自动（推荐）'], ['1', '100%'], ['1.15', '115%'], ['1.3', '130%'], ['1.5', '150%'], ['1.75', '175%']]
          .map(([val, label]) => button(label, () => {
            settings.setDisplay({ uiScale: val });
            modals.refresh(render);
          }, `btn${String(settings.display.uiScale) === val ? ' primary' : ''}`))),
    ]));

    out.push(h('div', { class: 'section', style: { marginTop: '18px' } }, [
      h('h3', {}, '其它'),
      h('div', { class: 'list-row' }, [
        h('div', { class: 'grow' }, [h('div', { class: 'name' }, '显示帧率 / 调试信息')]),
        button(settings.display.showFps ? '开' : '关', () => {
          settings.setDisplay({ showFps: !settings.display.showFps });
          modals.refresh(render);
        }, `btn${settings.display.showFps ? ' primary' : ''}`),
      ]),
    ]));
    return out;
  };

  // ---------- 游戏性页 ----------
  const renderGameplay = () => {
    const g = settings.gameplay;
    const rows = [
      ['damageNumbers', '伤害飘字', '关掉可以少一些视觉噪音'],
      ['screenShake', '屏幕震动', '关闭后爆炸与受击不再晃动画面'],
      ['autoCollect', '始终自动收集掉落', '省掉「亲自去捡」这一步（需要科技才好用的东西）'],
      ['lootToasts', '掉落通知', '捡到装备时弹提示'],
    ];
    const out = [h('div', { class: 'section' }, [
      h('h3', {}, '玩法选项'),
      ...rows.map(([key, label, desc]) => h('div', { class: 'list-row' }, [
        h('div', { class: 'grow' }, [
          h('div', { class: 'name' }, label),
          h('div', { class: 'meta' }, desc),
        ]),
        button(g[key] ? '开' : '关', () => {
          settings.setGameplay({ [key]: !g[key] });
          modals.refresh(render);
        }, `btn${g[key] ? ' primary' : ''}`),
      ])),
    ])];

    // 模式切换（有回调时才显示）
    if (opts.onModeChange) {
      out.push(h('div', { class: 'section', style: { marginTop: '18px' } }, [
        h('h3', {}, '游戏模式'),
        h('div', { class: 'desc' }, '切换模式会回到主菜单重新开局；当前进度不会自动保留，先存档。'),
        h('div', { class: 'grid c2', style: { marginTop: '10px' } }, MODE_LIST.map(id => {
          const def = MODE_DEF[id];
          const active = opts.mode === id;
          return h('div', {
            class: `card${active ? ' selected' : ''}`,
            onclick: () => {
              opts.onModeChange(id);
              modals.refresh(render);
            },
          }, [
            h('h3', {}, `${def.icon} ${def.name}`),
            h('div', { class: 'card-tag', style: { color: def.color } }, def.tagline),
            h('div', { class: 'desc', style: { marginTop: '6px' } }, def.desc),
          ]);
        })),
      ]));
    }

    out.push(h('div', { class: 'btn-row', style: { marginTop: '20px', display: 'flex', gap: '10px' } }, [
      button('恢复默认', () => {
        settings.setGameplay({
          damageNumbers: true, screenShake: true, autoCollect: false, lootToasts: true,
        });
        modals.refresh(render);
      }, 'btn'),
      button('关闭', () => modals.close(), 'btn'),
    ]));
    return out;
  };

  refresh = () => modals.refresh(render);

  // 已经有面板开着（比如暂停菜单）时叠一层，这样关掉设置会回到暂停菜单，
  // 而不是直接回到游戏 —— 后者会让玩家以为暂停被取消了。
  const openFn = modals.isOpen ? modals.push.bind(modals) : modals.open.bind(modals);
  openFn({
    title: '设置',
    subtitle: opts.mode ? `模式：${MODE_DEF[opts.mode]?.name || opts.mode}` : '',
    body: render(),
    wide: true,
    // 标上 kind：暂停键在设置面板上的行为和其他面板不同
    kind: 'settings',
  });
}

/** 主菜单上的模式选择器（独立入口，比藏在设置里好找） */
