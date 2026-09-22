/**
 * UI 总控：主菜单、角色选择、降落点选择、HUD、模态窗口、飘字。
 */

import { h, clear, button, ModalManager, NoticeStack, FloaterLayer, statLine } from './dom.js';
import { Hud } from './hud.js';
import { Actions } from './actions.js';
import { GamepadHint } from './gamepadHint.js';
import { openSavesPanel } from './panelSystem.js';
import { openSettings as openSettingsPanel } from './panelSettings.js';
import { CHAR_DEF, CHAR_LIST } from '../data/characters.js';
import { BIOME_DEF } from '../data/tiles.js';
import { GAME_MODE, MODE_DEF, MODE_LIST, modeDef } from '../data/modes.js';
import { dist } from '../core/math.js';
import { notice } from '../core/events.js';
import { GS } from '../core/game.js';
import { RunState } from '../systems/runState.js';
import { LANDING_TIER } from '../world/world.js';
import { TILE } from '../core/config.js';

export class Ui {
  constructor(game) {
    this.game = game;
    this.modals = new ModalManager(document.getElementById('modal-root'));
    this.notices = new NoticeStack(document.getElementById('notice-stack'));
    this.floaters = new FloaterLayer(document.getElementById('floaters'), game.camera);
    this.mainMenuEl = document.getElementById('mainmenu');
    this.pauseEl = document.getElementById('pause-overlay');
    this.actions = new Actions(game, null);
    this.hud = new Hud(game, this.actions);
    this.actions.hud = this.hud;
    /** 由 main.js 注入 GamepadManager（UI 层不直接 import，避免耦合） */
    this.gamepad = null;
    this.gpHint = new GamepadHint(null);
    this.selectedChar = 'engineer';
    /** 当前选择的游戏模式（主菜单里切换） */
    this.mode = GAME_MODE.FRONTIER;
    this.autoSaveTimer = 0;
    this.travelBanner = null;
  }

  /** main.js 装好手柄后调用 */
  attachGamepad(gamepad) {
    this.gamepad = gamepad;
    this.gpHint = new GamepadHint(gamepad);
  }

  // =========================================================
  //  主菜单
  // =========================================================

  showMainMenu() {
    const el = this.mainMenuEl;
    el.classList.remove('hidden');
    clear(el);
    this.game.setState(GS.MENU);

    const hasSave = this.game.hasSave('auto');
    const meta = this.game.loadMeta('auto');
    const mode = this.mode;
    const modeInfo = MODE_DEF[mode];

    // 模式选择直接摆在开始按钮上方：藏进设置里没人找得到
    const modeRow = h('div', { class: 'btn-row', style: { display: 'flex', gap: '10px', justifyContent: 'center', margin: '6px 0 10px' } },
      MODE_LIST.map(id => {
        const def = MODE_DEF[id];
        return button(`${def.icon} ${def.name}`, () => {
          this.mode = id;
          this.showMainMenu();
        }, `btn${id === mode ? ' primary' : ''}`);
      }));

    const btns = h('div', { class: 'menu-btns' }, [
      button(mode === GAME_MODE.TOWER_DEFENSE ? '开始塔防' : '开始新开荒', () => this.showCharSelect(), 'btn primary'),
      hasSave ? button(`继续（${meta.planet} · Lv.${meta.level} · 第 ${meta.day} 天）`, () => {
        if (this.game.load('auto')) {
          el.classList.add('hidden');
          this.game.setState(GS.PLAYING);
          this.game.paused = false;
        }
      }, 'btn') : null,
      // 存档管理 / 设置与操作说明 / 退出 —— 只有一个设置入口，不要重复摆两个
      button('存档管理', () => openSavesPanel(this.game, this.actions), 'btn'),
      button('设置与操作说明', () => this.openSettings('keys'), 'btn'),
      this.game.isDesktop ? button('退出游戏', () => this.quitGame(), 'btn danger') : null,
    ]);

    el.appendChild(h('div', { class: 'menu-inner' }, [
      h('h1', {}, '开拓者'),
      h('div', { class: 'tagline' }, 'COLONY FRONTIER · 外星殖民开荒'),
      modeRow,
      h('div', { style: { fontSize: '12px', color: modeInfo.color, marginBottom: '16px', textAlign: 'center' } },
        modeInfo.tagline),
      btns,
      h('div', { style: { marginTop: '26px', fontSize: '12px', color: '#64748b', lineHeight: '1.8' } }, [
        mode === GAME_MODE.TOWER_DEFENSE
          ? h('div', {}, '纯塔防：只有一片阵地。建塔、升科技、经营城镇，扛住一波又一波虫潮。')
          : h('div', {}, '你是被派遣到陌生星球的开荒人员。'),
        mode === GAME_MODE.TOWER_DEFENSE
          ? h('div', {}, '没有角色可以操控 —— 材料按稀有度从怪物身上掉，越稀有的越难出。')
          : h('div', {}, '吸引阵列会自动把虫巢的怪牵引过来 —— 那是你的金币与经验，也是你的死因。'),
        mode === GAME_MODE.TOWER_DEFENSE
          ? h('div', {}, '实验科技照常四选一，节奏与开拓模式完全一致。')
          : h('div', {}, '没怪的时候，带上载具出去：采资源、杀精英、捡装备、回收废弃基地。'),
      ]),
    ]));
    el.appendChild(h('div', { class: 'menu-version' }, 'v0.1.0 · 原型'));
    el.appendChild(h('div', { class: 'menu-tip' },
      '操作：WASD 移动 · 左键攻击 · E 采集 · F 上车 · B 建造 · T 科技 · G 城镇 · V 实验科技 · M 地图 · Tab 背包 · Esc 暂停（按键都可以在设置里改）'));
  }

  /**
   * 退出游戏。
   *
   * 为什么需要这个方法：这个游戏之前**没有任何退出的地方** ——
   * 菜单栏被 `autoHideMenuBar` 藏起来了，Alt 唤出才能看到「退出」，
   * 玩家在界面上找不到出口。桌面上直接关窗口也行，但没有人会去猜这个。
   */
  quitGame() {
    if (!this.game.isDesktop) return;
    if (this.game.run && !confirm('退出游戏？未保存的进度会丢失。')) return;
    // 先存一次自动档，退出不该比崩溃更亏
    try { this.actions.save('auto'); } catch { /* 存不了也照退 */ }
    setTimeout(() => window.close(), 60);
  }

  /** 打开设置面板（主菜单与暂停菜单都能进）。已经有面板开着时会叠一层。 */
  openSettings(tab = 'keys') {
    openSettingsPanel(this.game, this.actions, {
      input: this.game.input,
      tab,
      mode: this.run?.mode || this.mode,
      onModeChange: (id) => {
        // 局内不允许换模式（换模式等于换一整套世界与规则），只提醒
        if (this.game.run) {
          notice('局内不能切换模式', '先保存并返回主菜单，再在主菜单里选择模式。', 'warn');
          return;
        }
        this.mode = id;
        notice('模式已切换', `${MODE_DEF[id].name} —— 返回主菜单后开始新的一局。`, 'info');
      },
    });
  }

  // =========================================================
  //  角色选择
  // =========================================================

  showCharSelect() {
    const el = this.mainMenuEl;
    el.classList.remove('hidden');
    clear(el);
    this.game.setState(GS.CHAR_SELECT);

    const grid = h('div', { class: 'char-grid' }, CHAR_LIST.map(id => {
      const def = CHAR_DEF[id];
      return h('div', {
        class: `card char-card${this.selectedChar === id ? ' selected' : ''}`,
        onclick: (e) => {
          this.selectedChar = id;
          // 重新渲染选中态
          for (const child of grid.children) child.classList.remove('selected');
          e.currentTarget.classList.add('selected');
        },
      }, [
        h('div', { class: 'avatar', style: { background: `linear-gradient(160deg, ${def.color}33, #0b1020)`, color: def.color } }, def.icon),
        h('h3', {}, def.name),
        h('div', { class: 'card-tag', style: { color: def.color } }, def.title),
        h('div', { class: 'desc', style: { marginTop: '8px' } }, def.desc),
        h('div', { class: 'effect', style: { marginTop: '10px' } }, def.perks.map(p => `· ${p}`).join('\n')),
        h('div', { class: 'flavor' }, def.tagline),
        h('div', { style: { marginTop: '10px' } }, [
          statLine('生命', def.base.hp),
          statLine('伤害', `×${def.base.damage}`),
          statLine('移速', `×${def.base.speed}`),
          statLine('护甲', def.base.armor),
          statLine('暴击', `${Math.round(def.base.critChance * 100)}%`),
        ]),
        h('div', { style: { marginTop: '10px', fontSize: '11px', color: '#64748b' } }, `开局提示：${def.tip}`),
      ]);
    }));

    el.appendChild(h('div', { class: 'menu-inner', style: { maxWidth: '1180px' } }, [
      h('h1', { style: { fontSize: '34px', letterSpacing: '8px' } }, '选择你的身份'),
      h('div', { class: 'tagline', style: { marginBottom: '24px' } }, '不同角色有专属武器、建筑与实验科技池'),
      grid,
      h('div', { class: 'menu-btns', style: { flexDirection: 'row', width: 'auto', justifyContent: 'center', marginTop: '24px', gap: '14px' } }, [
        button('← 返回', () => this.showMainMenu(), 'btn'),
        button(this.mode === GAME_MODE.TOWER_DEFENSE ? '▶ 确定并开始塔防' : '▶ 确定并选择降落点',
          () => this.showLandingSelect(), 'btn primary'),
      ]),
    ]));
  }

  // =========================================================
  //  降落点选择
  // =========================================================

  showLandingSelect() {
    const el = this.mainMenuEl;

    // 纯塔防只有一片阵地，没有「选降落点」这件事 —— 直接开局，
    // 少一个没有内容的选择页比多一个更礼貌。
    if (this.mode === GAME_MODE.TOWER_DEFENSE) {
      const seed = 'td-' + Math.random().toString(36).slice(2, 9);
      const run = new RunState({
        seed, characterId: this.selectedChar, planetIndex: 0, mode: this.mode,
      });
      this.startRun(run, {});
      return;
    }

    el.classList.remove('hidden');
    clear(el);
    this.game.setState(GS.LANDING);

    // 先建一个临时 RunState 来生成世界
    const seed = 'frontier-' + Math.random().toString(36).slice(2, 9);
    const tmp = new RunState({ seed, characterId: this.selectedChar, planetIndex: 0, mode: this.mode });
    this._pendingRun = tmp;
    this._pendingSeed = seed;

    const sites = tmp.world.landingSites;
    const MAP_PX = Math.max(430, Math.min(760, Math.round((window.innerHeight || 720) - 250)));
    const canvas = h('canvas', { width: MAP_PX, height: MAP_PX, style: { borderRadius: '10px', background: '#04060c', display: 'block', margin: '0 auto', cursor: 'crosshair', maxWidth: '100%' } });
    const ctx = canvas.getContext('2d');
    const world = tmp.world;
    const scale = MAP_PX / Math.max(world.w, world.h);

    // 画地形缩略图
    const img = ctx.createImageData(world.w, world.h);
    for (let i = 0; i < world.w * world.h; i++) {
      const tile = world.tiles[i];
      if (!tile) { img.data[i * 4 + 3] = 255; continue; }
      const def = TILE_COLORS[tile] || [80, 90, 100];
      const o = i * 4;
      img.data[o] = def[0]; img.data[o + 1] = def[1]; img.data[o + 2] = def[2]; img.data[o + 3] = 255;
    }
    const off = document.createElement('canvas');
    off.width = world.w; off.height = world.h;
    off.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, MAP_PX, MAP_PX);

    // 巢穴
    for (const n of world.nests) {
      const x = n.x / TILE * scale, y = n.y / TILE * scale;
      ctx.fillStyle = 'rgba(255,60,60,0.9)';
      ctx.beginPath();
      ctx.arc(x, y, 2.5 + n.tier * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // 遗迹
    for (const p of world.pois) {
      ctx.fillStyle = p.kind === 'ruin' ? '#ffba4c' : p.kind === 'vault' ? '#c08cff' : '#8fe0ff';
      ctx.fillRect(p.x / TILE * scale - 2, p.y / TILE * scale - 2, 4, 4);
    }
    // 降落点
    /*
     * 玩家要求：初始降落点可以在地图上**自由选择**。
     * 这里保留 4 个系统推荐点（一级点必定是最安全的那块），
     * 但它们现在只是「推荐」—— 真正决定落点的是玩家在地图上点的那一下。
     */
    const picked = { site: sites[0] || null, result: sites[0] ? { ok: true, site: sites[0] } : null, hover: null };

    const drawMarkers = () => {
      // 重画一遍底图（缩略图 + 巢穴 + 遗迹），再叠标记
      ctx.clearRect(0, 0, MAP_PX, MAP_PX);
      ctx.drawImage(off, 0, 0, MAP_PX, MAP_PX);
      for (const n of world.nests) {
        const x = n.x / TILE * scale, y = n.y / TILE * scale;
        ctx.fillStyle = n.destroyed ? 'rgba(120,120,120,0.6)' : 'rgba(255,60,60,0.9)';
        ctx.beginPath();
        ctx.arc(x, y, 2.5 + n.tier * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const p of world.pois) {
        ctx.fillStyle = p.kind === 'ruin' ? '#ffba4c' : p.kind === 'vault' ? '#c08cff' : '#8fe0ff';
        ctx.fillRect(p.x / TILE * scale - 2, p.y / TILE * scale - 2, 4, 4);
      }
      // 推荐点：小圈 + 序号
      sites.forEach((site, i) => {
        const x = site.x / TILE * scale, y = site.y / TILE * scale;
        ctx.strokeStyle = 'rgba(110,231,168,0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(110,231,168,0.75)';
        ctx.font = 'bold 11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(String(i + 1), x, y + 4);
      });
      // 鼠标悬停处的落点预览
      const hv = picked.hover;
      if (hv) {
        const x = hv.tx * scale, y = hv.ty * scale;
        const res = world.evaluateLandingSite(hv.tx, hv.ty);
        ctx.strokeStyle = res.ok ? 'rgba(110,231,168,0.8)' : 'rgba(255,95,109,0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 11, 0, Math.PI * 2);
        ctx.stroke();
      }
      // 当前选中的落点
      const cur = picked.site;
      if (cur) {
        const x = cur.x / TILE * scale, y = cur.y / TILE * scale;
        ctx.strokeStyle = '#ffba4c';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.stroke();
        // 十字
        ctx.beginPath();
        ctx.moveTo(x - 19, y); ctx.lineTo(x - 6, y);
        ctx.moveTo(x + 6, y); ctx.lineTo(x + 19, y);
        ctx.moveTo(x, y - 19); ctx.lineTo(x, y - 6);
        ctx.moveTo(x, y + 6); ctx.lineTo(x, y + 19);
        ctx.stroke();
      }
    };

    const info = h('div', { class: 'kv', style: { marginTop: '10px', maxWidth: '760px', marginLeft: 'auto', marginRight: 'auto' } }, []);
    const status = h('div', { style: { fontSize: '12.5px', minHeight: '20px', marginTop: '8px', textAlign: 'center' } }, '');

    const refreshInfo = () => {
      clear(info);
      const s = picked.site;
      const res = picked.result || {};
      if (!s) {
        clear(status);
        status.appendChild(h('span', { style: { color: '#ff5f6d' } }, '还没有选落点 —— 在地图上点一下'));
        return;
      }
      const biome = BIOME_DEF[s.biome];
      const danger = res.ok === false ? 'bad' : (s.nestNear > 0 ? 'bad' : 'good');
      const dangerText = res.ok === false ? '不可降落'
        : s.nestNear >= 3 ? '危险' : s.nestNear >= 1 ? '警戒' : '安全';
      for (const [k, v, cls] of [
        ['坐标', `${s.tx}, ${s.ty}`, ''],
        ['生物群系', biome ? biome.name : '未知', ''],
        ['危险度', dangerText, danger],
        ['1000 内虫巢', `${s.nestNear}`, s.nestNear ? 'bad' : 'good'],
        ['资源丰度', `×${(s.richness ?? 1).toFixed(2)}`, 'good'],
        ['地形危险', `×${(s.hazard ?? 1).toFixed(2)}`, ''],
        ['开阔度', `${Math.round((s.openSpace ?? 0) * 100)}%`, ''],
      ]) {
        info.appendChild(h('div', { class: 'k' }, k));
        info.appendChild(h('div', { class: `v ${cls}` }, String(v)));
      }
      clear(status);
      if (res.ok === false) status.appendChild(h('span', { style: { color: '#ff5f6d' } }, `✕ ${res.why}`));
      else status.appendChild(h('span', { style: { color: '#6ee7a8' } }, '✓ 可以在这里降落（点「降落」确认）'));
    };

    const canvasToTile = (ev) => {
      const r = canvas.getBoundingClientRect();
      const cx2 = (ev.clientX - r.left) / r.width * MAP_PX;
      const cy2 = (ev.clientY - r.top) / r.height * MAP_PX;
      return { tx: cx2 / scale, ty: cy2 / scale };
    };

    canvas.style.cursor = 'crosshair';
    canvas.addEventListener('mousemove', (ev) => {
      picked.hover = canvasToTile(ev);
      drawMarkers();
    });
    canvas.addEventListener('mouseleave', () => { picked.hover = null; drawMarkers(); });
    canvas.addEventListener('click', (ev) => {
      const { tx, ty } = canvasToTile(ev);
      const res = world.evaluateLandingSite(tx, ty);
      picked.result = res;
      if (res.ok) picked.site = res.site;
      drawMarkers();
      refreshInfo();
    });

    // 推荐点快选
    const picks = h('div', { class: 'btn-row', style: { justifyContent: 'center', marginTop: '10px', flexWrap: 'wrap' } },
      sites.map((site, i) => {
        const tierDef = LANDING_TIER[site.tier] || LANDING_TIER[1];
        return button(`${i + 1}. ${BIOME_DEF[site.biome]?.name || '未知'} · ${tierDef.name}`,
          () => {
            picked.site = site;
            picked.result = { ok: true, site };
            drawMarkers();
            refreshInfo();
          }, 'btn small');
      }));

    drawMarkers();
    refreshInfo();

    el.appendChild(h('div', { class: 'menu-inner', style: { maxWidth: '1080px' } }, [
      h('h1', { style: { fontSize: '30px', letterSpacing: '7px' } }, '选择降落点'),
      h('div', { class: 'tagline', style: { marginBottom: '14px' } },
        `${CHAR_DEF[this.selectedChar].name} · 第一颗星球 ${tmp.planet.name} · 种子 ${seed}`),
      h('div', { style: { fontSize: '12.5px', color: '#ffba4c', marginBottom: '10px', textAlign: 'center' } },
        '在地图上任意点一下就能把核心舱降在那里（绿圈 = 可用，红圈 = 不行）；右边 1-4 号是系统推荐点。'),
      // 地图 + 右侧信息栏：地图做大之后不能再竖着堆，否则页面会滚到看不见地图
      h('div', { style: { display: 'flex', gap: '18px', alignItems: 'flex-start', justifyContent: 'center', flexWrap: 'wrap' } }, [
        h('div', {}, [
          canvas,
          h('div', { style: { fontSize: '12px', color: '#8ba0bb', marginTop: '8px', maxWidth: MAP_PX + 'px' } },
            '红点 = 虫巢（越远越安全，但高等级巢穴奖励也更好）；黄方块 = 废弃基地（可回收吸引阵列）；紫方块 = 实验 vault。'),
        ]),
        h('div', { style: { flex: '0 1 360px', minWidth: '300px' } }, [
          info,
          status,
          picks,
        ]),
      ]),
      h('div', { class: 'menu-btns', style: { flexDirection: 'row', width: 'auto', justifyContent: 'center', marginTop: '16px', gap: '14px' } }, [
        button('← 重选角色', () => this.showCharSelect(), 'btn'),
        button('▶ 降落', () => {
          const site = picked.site || sites[0];
          if (!site) { notice('无法降落', '没有可用的降落点，换一局试试。', 'warn'); return; }
          this.startRun(tmp, { landingSite: site });
        }, 'btn primary'),
      ]),
    ]));
  }

  // =========================================================
  //  开局
  // =========================================================

  /** 把 RunState 接上所有系统并进入游戏 */
  startRun(run, opts = {}) {
    this.mainMenuEl.classList.add('hidden');
    this.modals.closeAll();
    this.game.paused = false;
    this.floaters.clear();
    this.travelBanner = opts.fromTravel ? 6 : 0;

    if (opts.landingSite) {
      // 调整基地位置到玩家选的降落点
      this.relocateBase(run, opts.landingSite);
    }

    this.game.run = run;
    this.game.installRun(run);
    this.game.setState(GS.PLAYING);

    if (opts.fromTravel) {
      notice('降落完成', `${run.planet.name} · ${run.planet.environment.name}。${run.planet.environment.desc}`, 'good');
      notice('防御塔科技已重置', '新星球需要重新向上级申请空投授权。你的等级、装备、实验科技与主科技树都保留了。', 'warn');
    } else if (run.isTowerDefense) {
      notice('阵地已部署', '纯塔防模式：没有角色可以操控。用 B 建造防御塔，T 研究科技，G 经营城镇。', 'good');
      notice('材料来自击杀', '这里没法出门采集 —— 金属、纤维、晶体等材料按稀有度从怪物身上掉。', 'info');
      notice('第一波即将到来', '先用开局资源把基地周围铺几座塔，再考虑升级科技。', 'warn');
    } else {
      notice('着陆成功', '殖民地核心舱已部署。先按 E 采集资源，按 B 建造塔位地基，撑过第一波虫潮。', 'good');
      notice('核心提示', '核心舱自带吸引阵列，会自动牵引虫巢的怪 —— 那是金币与经验的来源。等级越高，怪越多、奖励越好，基地也越危险。', 'info');
    }
  }

  /** 把基地搬到玩家选的降落点 */
  relocateBase(run, site) {
    const world = run.world;
    const old = world.baseSite;
    world.prepareBaseArea(site.tx, site.ty);
    world.baseSite = { x: site.x, y: site.y, tx: site.tx, ty: site.ty, radius: 0 };
    world.baseSiteCenter = { x: site.x, y: site.y };
    // 挪基地
    for (const b of run.bases) { b.x = site.x; b.y = site.y; }
    run.baseSiteCenter = { x: site.x, y: site.y };
    run.beacon.x = site.x;
    run.beacon.y = site.y;
    const p = run.player;
    p.x = site.x + TILE * 4; p.y = site.y;
    p.lastX = p.x; p.lastY = p.y;
    const v = run.vehicle;
    v.x = site.x + TILE * 7; v.y = site.y + TILE * 3;
    // 清理旧位置的占位物
    world._clearPropsInChunkAt(old.tx, old.ty);
    world._syncBlockedTiles?.();
  }

  // =========================================================
  //  每帧
  // =========================================================

  render(dt, game) {
    this.floaters.update();
    this.gpHint.render(dt, game);
    this.hud.render(dt, game);

    // HUD 与模态框只在「有进行中的一局」时显示。
    // 主菜单/角色选择/降落页要留干净画面，否则 #hud .slot 会和主菜单按钮
    // 抢手柄焦点，看着像摇杆没反应。
    const inGame = game.state === GS.PLAYING || game.state === GS.PAUSED;
    const hudEl = document.getElementById('hud');
    if (hudEl) hudEl.style.display = inGame ? '' : 'none';
    const compass = document.getElementById('compass');
    if (compass) compass.style.display = inGame ? '' : 'none';
    this.floaters.el.style.display = inGame ? '' : 'none';

    if (this.travelBanner > 0) {
      this.travelBanner -= dt;
    }

    // 自动存档
    if (game.state === GS.PLAYING && !game.paused && game.run) {
      this.autoSaveTimer += dt;
      if (this.autoSaveTimer > 180) {
        this.autoSaveTimer = 0;
        game.save('auto');
        notice('自动存档', '进度已保存。', 'info');
      }
    }
  }

  /** 给 HUD 的快捷入口：打开地图选第二基地 */
  get pendingPanelReopen() { return this._reopen || null; }
  set pendingPanelReopen(fn) { this._reopen = fn; }
}

// 地形颜色表（用于降落点小地图）
const TILE_COLORS = {
  1: [125, 106, 85], 2: [78, 122, 74], 3: [194, 168, 107], 4: [74, 67, 64],
  5: [91, 95, 102], 6: [60, 64, 72], 7: [31, 79, 110], 8: [47, 111, 142],
  9: [90, 79, 122], 10: [107, 63, 110], 11: [159, 196, 216], 12: [110, 106, 99],
  13: [141, 145, 153], 14: [46, 35, 32], 15: [63, 90, 46],
};
