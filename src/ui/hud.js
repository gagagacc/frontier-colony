/**
 * HUD：血条、波次、资源、小地图、快捷栏、罗盘、方向指示。
 * 只更新数值，不重建 DOM（性能）。
 */

import { clamp, clamp01, dist, fmt, fmtTime } from '../core/math.js';
import { TILE, WEAPON_CAPS, BASE, BEACON } from '../core/config.js';
import { TILE_DEF, BIOME_DEF, PROP_DEF } from '../data/tiles.js';
import { ITEM_DEF, RARITY_DEF } from '../data/weapons.js';
import { h, clear, button, resourceChip, UiThrottle } from './dom.js';

const HOTBAR_SLOTS = 8;

/**
 * 有效射程读数。
 *
 * 玩家反馈「射程提升好像不生效」—— 机制其实是生效的（武器火力那条线每级 +40%），
 * 但界面上看不到任何变化，所以体感等于没生效。这里给一行明确读数。
 */
export function rangeText(ps, def) {
  if (!ps || !def) return '';
  const base = def.range || 0;
  if (!base) return '';
  const cur = Math.round(ps.weaponRange(def));
  const mult = ps.weaponStat ? ps.weaponStat('rangeMult') : 0;
  const pct = Math.round(mult * 100);
  return pct > 0 ? `射程 ${cur}（+${pct}%）` : `射程 ${cur}`;
}

export class Hud {
  constructor(game, actions) {
    this.game = game;
    this.actions = actions;
    this.el = {
      vitals: document.getElementById('vitals'),
      wavebar: document.getElementById('wavebar'),
      resources: document.getElementById('resources'),
      minimap: document.getElementById('minimap'),
      minimapLabel: document.getElementById('minimap-label'),
      hotbar: document.getElementById('hotbar'),
      quickActions: document.getElementById('quick-actions'),
      hint: document.getElementById('context-hint'),
      compass: document.getElementById('compass'),
    };
    this.throttle = new UiThrottle(0.1);
    this.slowThrottle = new UiThrottle(0.5);
    this.built = false;
    this.hotbarSlots = [];
    this.minimapBase = null;
    this.minimapRev = -1;
    this._minimapCtx = this.el.minimap?.getContext('2d') || null;
    this.logOpen = false;
  }

  build() {
    if (this.built) return;
    this.built = true;
    this.buildVitals();
    this.buildWavebar();
    this.buildResources();
    this.buildHotbar();
    this.buildQuickActions();
    this.buildCompass();
  }

  // ---------------- 构建 ----------------

  buildVitals() {
    const c = this.el.vitals;
    clear(c);
    this.v = {
      hp: barRow('生命', 'hp'),
      en: barRow('体力', 'en'),
      xp: barRow('经验', 'xp'),
    };
    c.appendChild(h('div', { class: 'vital-row' }, [
      h('span', { class: 'vital-label' }, '生命'),
      this.v.hp,
    ]));
    c.appendChild(h('div', { class: 'vital-row' }, [
      h('span', { class: 'vital-label' }, '体力'),
      this.v.en,
    ]));
    c.appendChild(h('div', { class: 'vital-row' }, [
      h('span', { class: 'vital-label' }, '经验'),
      this.v.xp,
    ]));
    this.v.dayLabel = h('div', { style: { fontSize: '11px', color: '#8ba0bb', marginTop: '6px', letterSpacing: '1px' } }, '');
    c.appendChild(this.v.dayLabel);
    this.v.statusRow = h('div', { style: { display: 'flex', gap: '5px', marginTop: '6px', flexWrap: 'wrap' } }, []);
    c.appendChild(this.v.statusRow);
  }

  buildWavebar() {
    const c = this.el.wavebar;
    clear(c);
    this.w = {
      title: h('div', { class: 'wave-title' }, '局势平稳'),
      sub: h('div', { class: 'wave-sub' }, ''),
      track: h('div', { class: 'threat-track' }, [h('div', { class: 'threat-fill', style: { width: '0%' } })]),
    };
    c.appendChild(this.w.title);
    c.appendChild(this.w.sub);
    c.appendChild(this.w.track);
  }

  buildResources() {
    const c = this.el.resources;
    clear(c);
    const row = h('div', { class: 'res-row' }, []);
    this.r = {};
    for (const kind of ['gold', 'metal', 'crystal', 'food', 'parts', 'research']) {
      const chip = resourceChip(kind, 0);
      this.r[kind] = chip.querySelector('.amt');
      row.appendChild(chip);
    }
    c.appendChild(row);
    this.r.beaconCore = h('div', { class: 'res-item', style: { marginTop: '5px', justifyContent: 'flex-end' } }, []);
    c.appendChild(this.r.beaconCore);
  }

  buildHotbar() {
    const c = this.el.hotbar;
    clear(c);
    this.hotbarSlots = [];
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const slot = h('div', {
        class: 'slot empty',
        onclick: () => this.actions.selectHotbar(i),
        title: '',
      }, [
        h('span', { class: 'slot-key' }, String(i + 1)),
        h('span', { class: 'slot-name' }, ''),
      ]);
      this.hotbarSlots.push({
        el: slot,
        icon: h('span', { style: { fontSize: '20px' } }, ''),
        count: h('span', { class: 'slot-count' }, ''),
        name: slot.querySelector('.slot-name'),
      });
      slot.appendChild(this.hotbarSlots[i].icon);
      slot.appendChild(this.hotbarSlots[i].count);
      c.appendChild(slot);
    }
  }

  buildQuickActions() {
    const c = this.el.quickActions;
    clear(c);
    const mk = (label, key, fn, title) => button(`${label} [${key}]`, fn, 'btn small');
    c.appendChild(h('div', { class: 'btn-row', style: { justifyContent: 'flex-end' } }, [
      mk('科技', 'T', () => this.actions.openTech(), '向上级申请科技'),
      mk('城镇', 'G', () => this.actions.openTown(), '殖民地经营'),
      mk('实验', 'V', () => this.actions.openExperiments(), '实验科技（三方向四选一）'),
      mk('地图', 'M', () => this.actions.openMap(), '大地图'),
      mk('背包', 'Tab', () => this.actions.openInventory(), '装备与背包'),
      mk('建造', 'B', () => this.actions.openBuild(), '建造与空投'),
    ]));
    this.qaBadge = h('div', { style: { marginTop: '6px', fontSize: '11px', color: '#ffba4c' } }, '');
    c.appendChild(this.qaBadge);
  }

  buildCompass() {
    const c = this.el.compass;
    clear(c);
    this.compassItems = [];
    for (let i = 0; i < 4; i++) {
      const item = h('span', {}, '');
      this.compassItems.push(item);
      c.appendChild(item);
    }
  }

  // ---------------- 每帧更新 ----------------

  render(dt, game) {
    const run = game.run;
    if (!run) return;
    // 纯塔防没有角色，生命/体力/武器栏这些位置要换成阵地信息
    const td = !!run.isTowerDefense;
    if (this._tdMode !== td) {
      this._tdMode = td;
      this._applyModeLayout(td);
    }
    this.build();

    const active = game.state === 'playing' || game.state === 'paused';
    document.getElementById('hud').style.display = active ? '' : 'none';
    if (!active) return;

    if (this.throttle.ready(dt)) this.updateFast(run, game);
    if (this.slowThrottle.ready(dt)) this.updateSlow(run, game);
  }

  /**
   * 按模式切换 HUD 布局。
   * 纯塔防：隐藏生命/体力/快捷栏/小地图这些「角色用」的部件，
   * 把顶栏留给「第几波 / 剩余敌人 / 基地耐久 / 阵地规模」。
   */
  _applyModeLayout(td) {
    const show = (id, on) => {
      const el = document.getElementById(id);
      if (el) el.style.display = on ? '' : 'none';
    };
    show('hud-bottom-center', !td);   // 快捷栏（武器）
    show('hud-bottom-left', !td);     // 小地图 + 区域扫描
    if (td) {
      // 顶栏第二行改成阵地信息
      const c = this.el.vitals;
      if (c && !this.tdInfo) {
        this.tdInfo = h('div', { style: { fontSize: '11px', color: '#8ba0bb', marginTop: '6px', lineHeight: '1.7' } }, '');
        c.appendChild(this.tdInfo);
      }
    }
  }

  updateFast(run, game) {
    const p = run.player;

    if (run.isTowerDefense) { this.updateTowerDefenseFast(run); return; }

    // 生命 / 体力 / 经验
    setBar(this.v.hp, p.hp / p.hpMax, `${Math.ceil(p.hp)} / ${p.hpMax}${p.shield > 0 ? ` (+${Math.ceil(p.shield)})` : ''}`);
    setBar(this.v.en, p.stamina / p.staminaMax, `${Math.ceil(p.stamina)}`);
    const need = run.xpNeeded(p.level);
    setBar(this.v.xp, p.xp / need, `Lv.${p.level} · ${Math.floor(p.xp)}/${need}`);

    // 昼夜
    const phase = (run.time % 240) / 240;
    const label = phase < 0.12 ? '黎明' : phase < 0.45 ? '白昼' : phase < 0.58 ? '黄昏' : phase < 0.92 ? '夜晚' : '黎明';
    const dayT = fmtTime(run.time % 240);
    this.v.dayLabel.textContent = `第 ${run.day} 天 · ${label} · ${dayT}`;

    // 资源
    for (const kind of ['gold', 'metal', 'crystal', 'food', 'parts', 'research']) {
      const el = this.r[kind];
      if (el) el.textContent = fmt(run.resources[kind] || 0);
    }
    const cores = run.resources.beaconCore || 0;
    clear(this.r.beaconCore);
    this.r.beaconCore.appendChild(h('span', { style: { fontSize: '11px', color: '#ff9a4c' } },
      `吸引核心 ${cores} · 阵列 Lv${run.beacon.level} · 吸引物质 ${Math.ceil(run.beacon.fuel)}/${run.beacon.fuelMax}${run.beacon.online ? '' : ' 【停机】'}`));

    // 状态图标
    this.updateStatuses(run, p);
    // 快捷栏
    this.updateHotbar(run, p);
  }

  /** 纯塔防的顶栏：基地耐久 / 阵地规模 / 波次进度 */
  updateTowerDefenseFast(run) {
    const base = run.base;
    setBar(this.v.hp, base.hp / base.maxHp, `${Math.ceil(base.hp)} / ${base.maxHp}`);
    const spent = run.playerStats.get('towerCap');
    this.v.dayLabel.textContent = `第 ${Math.max(1, run.wave.number)} 波 · 已击退 ${run.stats.wavesSurvived}`;

    // 资源
    for (const kind of ['gold', 'metal', 'crystal', 'food', 'parts', 'research']) {
      const el = this.r[kind];
      if (el) el.textContent = fmt(run.resources[kind] || 0);
    }
    clear(this.r.beaconCore);
    this.r.beaconCore.appendChild(h('span', { style: { fontSize: '11px', color: '#ff9a4c' } },
      `防御塔 ${run.towers.length}/${Math.round(4 + (spent || 0))} · 建筑 ${run.structures.length} · 人口 ${run.population}`));

    if (this.tdInfo) {
      const alive = run.enemies.filter(e => !e.dead).length;
      this.tdInfo.textContent = `阵地半径 ${Math.round(run.modeDef.fieldRadius || 900)}px · 场上敌人 ${alive} · 吸引阵列 Lv${run.beacon.level}`;
    }
    this.updateStatuses(run, run.player);
  }

  updateStatuses(run, p) {
    const c = this.v.statusRow;
    const st = p.statSet;
    const tags = [];
    if (run.time < p.frenzyUntil) tags.push({ t: '狂暴', c: '#ff5f6d' });
    if (st.get('nightVision') > 0 && isNight(run)) tags.push({ t: '夜视', c: '#8fe0ff' });
    if (run.player.inVehicle) tags.push({ t: '驾驶中', c: '#6ee7a8' });
    if (run.wave.huntMode) tags.push({ t: '追杀中', c: '#ff3f4f' });
    if (run.base?.destroyed) tags.push({ t: '基地已毁', c: '#ff3f4f' });
    const key = tags.map(t => t.t).join(',');
    if (key === this._statusKey) return;
    this._statusKey = key;
    clear(c);
    for (const t of tags) c.appendChild(h('span', { class: 'pill hot', style: { color: t.c, borderColor: t.c + '88' } }, t.t));
  }

  updateHotbar(run, p) {
    const items = this.hotbarItems(run, p);
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const slot = this.hotbarSlots[i];
      const data = items[i];
      if (!data) {
        if (!slot.el.classList.contains('empty')) {
          slot.el.className = 'slot empty';
          slot.icon.textContent = '';
          slot.count.textContent = '';
          slot.name.textContent = '';
        }
        continue;
      }
      slot.el.classList.remove('empty');
      const isActive = data.active;
      slot.el.className = `slot${isActive ? ' active' : ''}`;
      slot.icon.textContent = data.icon;
      slot.icon.style.color = data.color || '#d8e6f5';
      slot.count.textContent = data.count != null ? data.count : '';
      slot.name.textContent = data.name || '';
      slot.el.title = data.title || data.name || '';
    }
  }

  hotbarItems(run, p) {
    const out = [];
    /*
     * 武器成长（科技树三条线 + 弹道）在上限内取值，和 player.weaponStat 用同一套上限。
     * 快捷栏的 tooltip 是玩家最常看到的数值面板，这里要显示「离上限还有多远」。
     */
    const capped = (k) => {
      const raw = p.statSet.get(k) || 0;
      const cap = WEAPON_CAPS[k];
      return cap == null ? raw : Math.min(raw, cap);
    };
    const barrels = 1 + Math.round(capped('projectiles'));
    // 1-4：武器
    for (let i = 0; i < 4; i++) {
      const w = p.weapons[i];
      if (!w) { out.push(null); continue; }
      const rar = RARITY_DEF[w.rarity] || RARITY_DEF.common;
      const dmg = w.def.damage * (1 + capped('damage'));
      const range = w.def.range * (1 + capped('rangeMult'));
      const cd = w.def.cd / (1 + capped('attackSpeed'));
      out.push({
        icon: w.def.icon || '🗡',
        color: rar.color,
        name: w.name.length > 6 ? w.name.slice(0, 6) : w.name,
        active: p.weaponIndex === i,
        title: `${w.name}（${rar.name}）\n伤害 ${dmg.toFixed(1)} · 间隔 ${cd.toFixed(2)}s · 射程 ${Math.round(range)}`
          + `${barrels > 1 ? ` · 弹道 ${barrels} 条` : ''}\n${w.def.desc || ''}\n〔科技上限：射程 300% · 伤害 300% · 射速 200% · 弹道 3〕`,
      });
    }
    // 5：弹药
    const ammoMax = p.ammoMax || 200;
    out.push({
      icon: '▪', color: '#d0c090', count: p.ammo,
      name: '弹药', title: `通用弹药 ${p.ammo} / ${ammoMax}（按 R 装填，也可按数字键 5）`,
    });
    // 6-8：消耗品
    const quick = (run.quickItems = run.quickItems || ['medkit', 'stimpack', 'repairKit']);
    for (let i = 0; i < 3; i++) {
      const id = quick[i];
      const def = ITEM_DEF[id];
      const count = run.itemCounts?.[id] || 0;
      out.push(def ? {
        icon: def.icon, color: def.color, count: count || '',
        name: def.name, title: `${def.name} ×${count}（按数字键 ${i + 6}）\n${def.desc}`,
      } : null);
    }
    return out;
  }

  updateSlow(run, game) {
    // 波次条
    const w = run.wave;
    const threat = run.threat;
    let title = '', sub = '', cls = '';
    if (w.huntMode) {
      title = '追杀阶段 · 基地已毁';
      sub = `怪潮会持续朝你而来（${Math.ceil(w.huntTimer)} 秒后下一波）。回基地按 E 重建，才能重新吸引它们。`;
      cls = 'wave-danger';
    } else if (!run.beacon.online) {
      title = '吸引阵列离线';
      sub = `怪潮暂停。补充【吸引核心】或能量电池后重新上线（当前 ${Math.ceil(run.beacon.fuel)}/${run.beacon.fuelMax}）。`;
      cls = 'wave-warn';
    } else {
      switch (w.state) {
        case 'calm':
          title = `局势平稳 · 第 ${w.number + 1} 波倒计时`;
          sub = `${fmtTime(w.timer)} 后虫潮集结 · 威胁 ${threat.total.toFixed(1)} · 活巢 ${threat.nests}`;
          cls = w.timer < 45 ? 'wave-warn' : 'wave-calm';
          break;
        case 'incoming':
          title = `第 ${w.number} 波正在逼近！`;
          sub = `${fmtTime(w.timer)} 后抵达 · 共 ${w.total} 只，来自 ${(w.contributors || []).length} 个巢穴`;
          cls = 'wave-danger';
          break;
        case 'active':
          title = `第 ${w.number} 波 · 交战中`;
          sub = `剩余 ${w.remaining}/${w.total} 只 · 基地耐久 ${Math.ceil(run.base.hp)}/${run.base.maxHp}`;
          cls = 'wave-danger';
          break;
        case 'aftermath':
          title = `第 ${w.number} 波已击退`;
          sub = `战场清理中，${fmtTime(w.timer)} 后开始下一轮集结`;
          cls = 'wave-calm';
          break;
        default: break;
      }
    }
    this.w.title.textContent = title;
    this.w.title.className = `wave-title ${cls}`;
    this.w.sub.textContent = sub;

    // 威胁条：基地压力 / 上限
    const pressure = clamp01(threat.basePressure / 18);
    this.w.track.firstChild.style.width = `${pressure * 100}%`;

    // 提示
    this.updateHint(run, game);
    // 罗盘
    this.updateCompass(run, game);
    // 实验科技待选徽标
    const pending = run.pendingChoices;
    this.qaBadge.textContent = pending > 0 ? `★ 有 ${pending} 次实验科技待选（按 V）` : '';

    // 小地图
    this.drawMinimap(run, game);
  }

  updateHint(run, game) {
    const p = run.player;
    const el = this.el.hint;
    let text = '';
    const ps = run.playerSystem;

    // 虫巢副本：优先说「怎么出去、往哪走」
    if (run.dungeon) {
      const d = run.dungeon;
      const atEntry = dist(p.x, p.y, d.entry.x, d.entry.y) < 150;
      const atBoss = dist(p.x, p.y, d.boss.x, d.boss.y) < 620;
      if (atEntry) text = 'F 撤退回地面（战果保留）';
      else if (atBoss) text = '⚠ 前方是巢穴主的房间 —— 打不过就往左跑回入口按 F';
      else text = `深处在右边 · 侧室里有飞船残骸 · 回入口按 F 撤退（巢穴 ${d.tier} 级）`;
      if (el.textContent !== text) el.textContent = text;
      return;
    }

    if (p.dead) {
      text = `你倒下了 —— ${Math.ceil(p.respawnTimer)} 秒后救援抵达`;
    } else if (p.inVehicle) {
      text = 'F 下车 · Shift 加速 · 左键/自动炮塔开火';
    } else if (ps?.repairTarget && ps.repairTarget.target.hp < ps.repairTarget.maxHp) {
      // 维修提示必须写明按键：玩家问过「我不知道需要按什么维修防御塔」
      const r = ps.repairTarget;
      const pct = Math.round((r.target.hp / r.maxHp) * 100);
      text = `按住 E 维修 ${r.label}（耐久 ${pct}% · 消耗金属）`;
    } else if (ps?.harvestTarget) {
      // 不再报「进度百分之几」：采到的东西会从材料上方 +N 跳出来，
      // 这里只需要说明「在采什么、还剩多少耐久」。
      const t = ps.harvestTarget;
      const def = PROP_DEF[t.type] || {};
      const left = Math.max(0, Math.round((t.hp / (t.maxHp || def.hp || 1)) * 100));
      const regrow = def.respawn > 0 ? ' · 可再生' : ' · 不可再生';
      text = `正在采集：${propName(t)}（按住 E，剩余 ${left}%${regrow}）`;
    } else if (run.base?.destroyed && dist(p.x, p.y, run.base.x, run.base.y) < 200) {
      const pct = Math.round(clamp01((run.base.repairProgress || 0) / (BASE.rebuildTime || 12)) * 100);
      text = `按住 E 重建核心舱（${pct}% · 点一下也能推进 · 消耗金属）`;
    } else if (run.base && dist(p.x, p.y, run.base.x, run.base.y) < run.base.r + 60 && run.base.hp < run.base.maxHp) {
      text = '按住 E 维修核心舱';
    } else if (!run.beacon?.online && !run.base?.destroyed) {
      text = '⚠ 核心舱吸引阵列停机（缺吸引物质）—— 虫群正在追你，按 B 去充能';
    } else {
      const nearVehicle = !run.vehicle.destroyed && dist(p.x, p.y, run.vehicle.x, run.vehicle.y) < 90;
      const nearestPoi = run.world.pois.find(poi => !poi.looted && dist(p.x, p.y, poi.x, poi.y) < 150);
      // 虫巢入口：这是新加的一条重要交互，得让玩家看得见
      const nearNest = run.world.nests.find(n => !n.destroyed && !n.dungeonCleared
        && dist(p.x, p.y, n.x, n.y) < n.r + 90);
      // 载具优先（和 F 键的实际判定顺序保持一致，否则提示会骗人）
      if (nearVehicle) text = run.hasFeature('vehicle') ? 'F 上车' : 'F 查看载具（需先在科技树申请）';
      else if (nearNest) text = `F 进入虫巢 · ${nearNest.tier} 级（最深处有巢穴主）`;
      else if (nearestPoi) text = `F 搜刮 ${nearestPoi.name || '遗迹'}`;
      else text = 'E 采集 · F 上车/进巢 · B 建造 · T 科技 · G 城镇 · M 地图';
    }
    if (el.textContent !== text) el.textContent = text;
  }

  updateCompass(run, game) {
    const p = run.player;
    const targets = [];
    /*
     * 虫巢副本里指「入口」，不指地面上的东西。
     * 核心舱与巢穴都留在外面（坐标在世界之外），照着指只会得到
     * 「基地 3000m」这种骗人的方向；副本里真正该找的是回程点。
     */
    if (run.dungeon) {
      const e = run.dungeon.entry;
      targets.push({ label: '入口（F 撤退）', d: dist(p.x, p.y, e.x, e.y), color: '#6ee7a8', x: e.x, y: e.y });
      const boss = run.dungeon.boss;
      targets.push({ label: '巢穴主', d: dist(p.x, p.y, boss.x, boss.y), color: '#ff5f6d', x: boss.x, y: boss.y });
    } else {
      // 最近的巢穴
      let nearestNest = null, nd = Infinity;
      for (const n of run.world.nests) {
        if (n.destroyed) continue;
        const d = dist(p.x, p.y, n.x, n.y);
        if (d < nd) { nd = d; nearestNest = n; }
      }
      if (nearestNest) targets.push({ label: `巢穴 ${nearestNest.name}`, d: nd, color: '#ff5f6d', x: nearestNest.x, y: nearestNest.y });
      // 基地
      const base = run.bases.find(b => !b.destroyed) || run.base;
      const bd = dist(p.x, p.y, base.x, base.y);
      targets.push({ label: base.destroyed ? '基地废墟' : '基地', d: bd, color: base.destroyed ? '#ff5f6d' : '#59d8ff', x: base.x, y: base.y });
      // 载具
      if (!run.player.inVehicle && !run.vehicle.destroyed) {
        const vd = dist(p.x, p.y, run.vehicle.x, run.vehicle.y);
        if (vd > 120) targets.push({ label: '载具', d: vd, color: '#6ee7a8', x: run.vehicle.x, y: run.vehicle.y });
      }
    }

    targets.sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.compassItems.length; i++) {
      const el = this.compassItems[i];
      const t = targets[i];
      if (!t) { el.textContent = ''; continue; }
      const ang = Math.atan2(t.y - p.y, t.x - p.x);
      const dirs = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
      const idx = Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
      el.innerHTML = '';
      el.appendChild(h('span', { class: 'arrow', style: { color: t.color } }, dirs[idx]));
      el.appendChild(document.createTextNode(` ${t.label} ${fmt(t.d / 40)}m`));
    }
  }

  // ---------------- 小地图 ----------------

  /**
   * 虫巢副本的小地图：固定缩放，把副本区域铺满整块小地图。
   * 只画副本区域，不碰外面的虚空 —— 又快又能看清通道形状。
   */
  drawDungeonMinimap(ctx, run, size) {
    const d = run.dungeon;
    const world = run.world;
    const r = d.region || { x0: 0, y0: 0, w: world.w, h: world.h };

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#0a0410';
    ctx.fillRect(0, 0, size, size);

    const k = Math.min(size / r.w, size / r.h);
    const ox = (size - r.w * k) / 2;
    const oy = (size - r.h * k) / 2;
    const cell = Math.max(1, Math.ceil(k));

    // 地形：只扫副本区域（约 1.2 万格，比整图的 9 万格省得多）
    for (let ty = r.y0; ty < r.y0 + r.h; ty++) {
      for (let tx = r.x0; tx < r.x0 + r.w; tx++) {
        const tile = world.tiles[ty * world.w + tx];
        if (tile === 0) continue;                 // 虚空不画
        const def = TILE_DEF[tile];
        ctx.fillStyle = def ? def.color : '#2a1620';
        ctx.fillRect(ox + (tx - r.x0) * k, oy + (ty - r.y0) * k, cell, cell);
      }
    }

    const px = (wx) => ox + (wx / TILE - r.x0) * k;
    const py = (wy) => oy + (wy / TILE - r.y0) * k;

    // 旗舰残骸（主要收益）
    for (const prop of world.props.values()) {
      if (prop.type !== 'wreckCache' || prop.dead) continue;
      ctx.fillStyle = '#c9d4e2';
      ctx.fillRect(px(prop.x) - 2, py(prop.y) - 2, 4, 4);
    }
    // 巢核
    if (!d.cleared) {
      const pulse = 0.5 + Math.sin(this.timeSec() * 3) * 0.5;
      ctx.fillStyle = `rgba(255,70,90,${0.55 + pulse * 0.45})`;
      ctx.beginPath();
      ctx.arc(px(d.boss.x), py(d.boss.y), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // 入口
    ctx.fillStyle = '#6ee7a8';
    ctx.beginPath();
    ctx.arc(px(d.entry.x), py(d.entry.y), 3.5, 0, Math.PI * 2);
    ctx.fill();
    // 玩家
    ctx.fillStyle = '#ffba4c';
    ctx.beginPath();
    ctx.arc(px(run.player.x), py(run.player.y), 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // 边框
    ctx.strokeStyle = 'rgba(255,120,150,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, r.w * k - 1, r.h * k - 1);
  }

  buildMinimapBase(run) {
    const w = run.world.w, hgt = run.world.h;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = hgt;
    const c = canvas.getContext('2d');
    const img = c.createImageData(w, hgt);
    for (let i = 0; i < w * hgt; i++) {
      const tile = run.world.tiles[i];
      const def = TILE_DEF[tile];
      const biome = run.world.biomes[i];
      let r = 20, g = 24, b = 34;
      if (def && tile !== 0) {
        const [cr, cg, cb] = hexToRgb(def.color);
        // 群系微调色
        const bd = BIOME_DEF[biome];
        const tint = bd ? hexToRgb(bd.tint) : [128, 128, 128];
        r = clamp(cr * 0.65 + tint[0] * 0.35, 0, 255);
        g = clamp(cg * 0.65 + tint[1] * 0.35, 0, 255);
        b = clamp(cb * 0.65 + tint[2] * 0.35, 0, 255);
      }
      const o = i * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    this.minimapBase = canvas;
    this.minimapRev = run.world.tileRevision || 0;
    // 小地图底图也要记住「是哪张地图」：只比版本号的话，
    // 进副本（另一个 World、版本号同样可能是 0）会继续用地表底图
    this.minimapWorldId = run.world.uid || 0;
  }

  drawMinimap(run, game) {
    const ctx = this._minimapCtx;
    if (!ctx) return;
    const size = this.el.minimap.width;

    /*
     * 虫巢副本：小地图只画副本那一小块区域。
     *
     * 副本只占世界中间约 130×90 格，其余是虚空。按整张世界（304×304）渲染
     * 会把副本压成中间芝麻大的一点，同时白画 9 万个格子。
     * 所以副本里单独一条分支：把视口缩到副本区域上。
     */
    if (run.dungeon) { this.drawDungeonMinimap(ctx, run, size); return; }

    if (this.minimapRev !== (run.world.tileRevision || 0)
      || this.minimapWorldId !== (run.world.uid || 0)
      || !this.minimapBase) this.buildMinimapBase(run);

    const world = run.world;
    const scale = size / Math.max(world.w, world.h);

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#04060c';
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.minimapBase, 0, 0, size, size);

    const sc = (tx) => tx * TILE * scale;

    // 已发现的兴趣点
    for (const poi of run.world.pois) {
      const x = sc(poi.x / TILE), y = sc(poi.y / TILE);
      ctx.fillStyle = poi.looted ? '#556' : (poi.kind === 'ruin' ? '#ffba4c' : poi.kind === 'vault' ? '#c08cff' : '#8fe0ff');
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    // 巢穴
    for (const n of world.nests) {
      const x = sc(n.x / TILE), y = sc(n.y / TILE);
      if (n.destroyed) {
        ctx.strokeStyle = '#4a5568';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y + 3);
        ctx.moveTo(x + 3, y - 3); ctx.lineTo(x - 3, y + 3);
        ctx.stroke();
      } else {
        const pulse = 0.6 + Math.sin(this.timeSec() * 3 + n.tier) * 0.4;
        ctx.fillStyle = `rgba(255,70,70,${0.5 + pulse * 0.5})`;
        ctx.beginPath();
        ctx.arc(x, y, 2.5 + n.tier * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 基地
    for (const b of run.bases) {
      const x = sc(b.x / TILE), y = sc(b.y / TILE);
      ctx.fillStyle = b.destroyed ? '#ff5f6d' : '#59d8ff';
      ctx.fillRect(x - 3, y - 3, 6, 6);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 3, y - 3, 6, 6);
    }
    // 吸引范围
    const bx = sc(run.beacon.x / TILE), by = sc(run.beacon.y / TILE);
    ctx.strokeStyle = run.beacon.online ? 'rgba(255,150,80,0.5)' : 'rgba(120,120,120,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(bx, by, run.beacon.radius * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 敌人
    for (const e of run.enemies) {
      if (e.dead) continue;
      const d = dist(e.x, e.y, run.player.x, run.player.y);
      if (d > 1400 && !e.boss && !e.elite) continue;
      const x = sc(e.x / TILE), y = sc(e.y / TILE);
      ctx.fillStyle = e.boss ? '#ff3f4f' : e.elite ? '#ff9a4c' : 'rgba(255,120,120,0.75)';
      const s = e.boss ? 2.8 : e.elite ? 2.2 : 1.4;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
    // 载具
    if (!run.vehicle.destroyed) {
      const x = sc(run.vehicle.x / TILE), y = sc(run.vehicle.y / TILE);
      ctx.fillStyle = '#6ee7a8';
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    // 玩家
    const px = sc(run.player.x / TILE), py = sc(run.player.y / TILE);
    ctx.fillStyle = '#ffba4c';
    ctx.beginPath();
    ctx.arc(px, py, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // 朝向
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(run.player.facing) * 8, py + Math.sin(run.player.facing) * 8);
    ctx.stroke();

    // 视野框
    const cam = game.camera;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      sc(cam.left / TILE), sc(cam.top / TILE),
      (cam.viewW / cam.zoom / TILE) * scale, (cam.viewH / cam.zoom / TILE) * scale,
    );

    if (this.el.minimapLabel) {
      const t = run.threat;
      this.el.minimapLabel.textContent = `活巢 ${t.nests} · 威胁 ${t.total.toFixed(1)} · ${run.biomeName || ''}`;
    }
  }

  timeSec() { return performance.now() / 1000; }
}

// ---------------- 小工具 ----------------

function barRow(label, cls) {
  return h('div', { class: `bar ${cls}` }, [
    h('div', { class: 'bar-fill', style: { width: '50%' } }),
    h('div', { class: 'bar-text' }, ''),
  ]);
}

function setBar(barEl, frac, text) {
  const fill = barEl.firstChild;
  const label = barEl.lastChild;
  fill.style.width = `${clamp01(frac) * 100}%`;
  if (label.textContent !== text) label.textContent = text;
}

function hexToRgb(hex) {
  if (!hex || hex[0] !== '#') return [128, 128, 128];
  let hh = hex.slice(1);
  if (hh.length === 3) hh = hh.split('').map(c => c + c).join('');
  const n = parseInt(hh, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function isNight(run) {
  const phase = (run.time % 240) / 240;
  return phase > 0.58 && phase < 0.95;
}

function propName(prop) {
  return PROP_DEF[prop.type]?.name || prop.type;
}
