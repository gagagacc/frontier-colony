/**
 * 怪潮调度（Director）—— 整个游戏节奏的心脏。
 *
 * 核心循环：
 *   吸引阵列自动运转 → 按等级牵引范围内的巢穴出怪 → 怪潮成建制冲向基地
 *   → 玩家选择回家防守 / 继续在外面吃收益（但基地会掉血）
 *   → 防守成功结算经验与掉落 → 吸引阵列升级 → 拉更远的怪 → 更多收益 + 更多风险
 *
 * 关键平衡点（玩家要主动做的取舍）：
 *   - 清巢穴 = 永久降低压力，但永久少了刷怪收益。
 *   - 升吸引阵列 = 更多怪 = 更多金币经验，但基地更危险。
 */

import { BEACON, BASE } from '../core/config.js';
import { clamp, clamp01, dist, dist2 } from '../core/math.js';
import { rnd } from '../core/rng.js';
import { bus, EV, notice } from '../core/events.js';
import { NEST_ROSTER, BIOME_MONSTERS, MONSTER_DEF } from '../data/monsters.js';
import { createEnemy, enemyScaleFor } from './runState.js';

export class Director {
  constructor(run) {
    this.run = run;
    this.enabled = true;
    this.warned = false;
    this.supplyTimer = 0;
  }

  update(dt, game) {
    const run = this.run;
    this.updateBeacon(dt);
    this.updateWave(dt);
    this.updateNests(dt);
    this.updateSupply(dt);
    this.updateDayNight(dt);
    this.updateThreatSnapshot(dt);
  }

  // =========================================================
  //  吸引阵列
  // =========================================================

  updateBeacon(dt) {
    const run = this.run;
    const b = run.beacon;
    b.pulse = (b.pulse || 0) + dt;

    if (!b.online) return;
    // 虫巢副本里吸引阵列不工作：怪是按房间布置的，没有「外面的巢穴」可拉
    if (run.dungeon) return;

    // 耗能
    const st = run.playerStats;
    const power = st.get('powerOutput') * 0.06;
    const use = BEACON.fuelPerSec * (1 + st.get('beaconFuelMult')) * Math.max(0.15, 1 - power);
    b.fuel -= use * dt;
    const regen = st.get('beaconFuelRegen') || 0;
    if (regen > 0) b.fuel = Math.min(b.fuelMax, b.fuel + regen * dt);

    if (b.fuel <= 0) {
      b.fuel = 0;
      b.online = false;
      bus.emit(EV.SFX, { name: 'error' });
      /*
       * 没有吸引物质 = 虫群失去牵引。
       * 玩家要的正是这个：装置不再把怪「拉」过来，而是它们自己循着你的气味来追杀你。
       * 用 huntReason 区分「基地被打爆」和「能量耗尽」两种追杀，
       * 这样重新加满能量时只解除后者，不会把基地被毁的追杀也一起解掉。
       */
      this.startHunt('fuel');
      notice('吸引阵列停机', '核心舱的吸引物质耗尽 —— 虫群失去牵引，开始循着你的气味找过来。用【吸引核心】或【能量电池】重启它。', 'danger');
      run.addLog('核心舱吸引阵列因缺能耗尽停机');
    }
  }

  /**
   * 进入追杀模式。
   * reason: 'base'（基地被打爆）/ 'fuel'（吸引物质耗尽）
   */
  startHunt(reason) {
    const run = this.run;
    if (run.wave.huntMode) return;
    run.wave.huntMode = true;
    run.wave.huntReason = reason;
    run.wave.huntTimer = Math.min(run.wave.huntTimer || BASE.alarmWaveGap, BASE.alarmWaveGap);
    bus.emit(EV.SFX, { name: 'baseAlarm' });
  }

  stopHunt(reason) {
    const run = this.run;
    if (!run.wave.huntMode) return;
    if (reason && run.wave.huntReason !== reason) return;
    run.wave.huntMode = false;
    run.wave.huntReason = null;
  }

  /** 手动为核心舱的吸引阵列补充能量 */
  refuelBeacon(amount) {
    const b = this.run.beacon;
    const wasOffline = !b.online || b.fuel <= 0;
    b.fuel = Math.min(b.fuelMax, b.fuel + amount);
    if (b.fuel > 0 && !b.online) {
      b.online = true;
      notice('吸引阵列重启', '共振重新建立，远处的虫巢又开始躁动 —— 它们重新被牵引，而不是追着你跑。', 'good');
    }
    // 能量回来了，因「缺能」进入的追杀模式随之解除（基地被打爆的那种不解除）
    if (wasOffline) this.stopHunt('fuel');
  }

  // =========================================================
  //  怪潮
  // =========================================================

  updateWave(dt) {
    const run = this.run;
    const w = run.wave;

    // 虫巢副本里没有怪潮调度：节奏完全由房间与 Boss 决定
    if (run.dungeon) return;

    if (w.huntMode) { this.updateHunt(dt); return; }

    switch (w.state) {
      case 'calm': {
        w.timer -= dt;
        // 吸引阵列停机会让怪潮暂停（但基地被毁后不会）
        if (!run.beacon.online) { w.timer = Math.min(w.timer + dt, 30); break; }
        if (w.timer <= 40 && !this.warned && w.timer > 0) {
          this.warned = true;
          bus.emit(EV.WAVE_INCOMING, { seconds: Math.ceil(w.timer) });
          bus.emit(EV.SFX, { name: 'waveKlaxon' });
          notice('侦测到虫潮集结', `${Math.ceil(w.timer)} 秒后冲击基地。要回家防守，还是继续在外面吃收益？`, 'warn');
        }
        if (w.timer <= 0) this.startWave();
        break;
      }
      case 'incoming': {
        w.timer -= dt;
        if (w.timer <= 0) {
          w.state = 'active';
          bus.emit(EV.WAVE_START, { number: w.number });
        }
        break;
      }
      case 'active': {
        w.elapsed = (w.elapsed || 0) + dt;
        let alive = 0;
        for (const e of run.enemies) if (e.waveId === w.currentId && !e.dead) alive++;
        w.remaining = alive;
        this.breakStalemate(dt, alive);
        if (alive === 0) { this.endWave(true); break; }
        if (w.elapsed > (run.waveTimeout || 240)) {
          // 兜底收尾：打了这么久还没清完，剩下的虫潮撤退。
          // 没有这条的话，只要有一只远程怪/卡住的怪留在场上，
          // 波次就永远停在 active —— 下一波不来，整局卡死。
          this.scatterRemnants();
          this.endWave(false);
        }
        break;
      }
      case 'aftermath': {
        w.timer -= dt;
        if (w.timer <= 0) {
          w.state = 'calm';
          w.timer = this.nextInterval();
          this.warned = false;
        }
        break;
      }
      default: break;
    }
  }

  /**
   * 僵局处理：把卡住的怪拽回战场。
   *
   * 为什么会卡：远程怪（喷酸虫 / 嗡翅虫）会保持距离风筝，被地形或墙卡住的怪
   * 也会停在原地 —— 于是「本波的怪」永远清不干净，怪潮状态卡在 active，
   * 下一波永远不来。玩家体感就是「这波打不完了」。
   *
   * 判据很保守：进入交战 45 秒之后，连续 15 秒「本波存活数」一点没降，
   * 才认定是僵局。处理方式是把它们挪到基地边缘（而不是直接删掉），
   * 玩家还是要打，只是不用再满地图找最后一只。
   */
  breakStalemate(dt, alive) {
    const run = this.run;
    const w = run.wave;
    if (alive === 0) { w._stallTimer = 0; w._lastAlive = 0; return; }
    if ((w.elapsed || 0) < 45) return;

    if (alive < (w._lastAlive ?? alive)) {
      w._lastAlive = alive;
      w._stallTimer = 0;
      return;
    }
    w._lastAlive = alive;
    w._stallTimer = (w._stallTimer || 0) + dt;
    if (w._stallTimer < 15) return;
    w._stallTimer = 0;

    const base = run.base;
    let moved = 0;
    for (const e of run.enemies) {
      if (e.dead || e.waveId !== w.currentId) continue;
      // 已经贴在基地旁边的不动（它只是在打建筑，不是卡住）
      if (dist(e.x, e.y, base.x, base.y) < 320) continue;
      const a = rnd.next() * Math.PI * 2;
      const r = 260 + rnd.next() * 120;
      const spot = run.world.findOpenSpot(base.x + Math.cos(a) * r, base.y + Math.sin(a) * r, 120);
      run.effects.push({ kind: 'ring', x: e.x, y: e.y, r: 44, life: 0.35, maxLife: 0.35, color: '#8f5fff' });
      e.x = spot.x; e.y = spot.y;
      e.target = null;
      moved++;
    }
    if (moved) {
      notice('虫潮重新集结', `有 ${moved} 只虫子绕不开地形，已经绕到基地附近 —— 别让它们白站着。`, 'info');
      run.addLog(`僵局解除：拉回 ${moved} 只`);
    }
  }

  /**
   * 超时收尾：让还在场上的本波残兵撤退。
   *
   * 用「撤退」而不是「凭空消失」：给一个明显的紫环特效 + 通知，
   * 玩家能理解发生了什么（虫潮退了），而不是觉得怪被系统吃掉了。
   * 奖励按「未击退」结算，所以不会变成刷分漏洞。
   */
  scatterRemnants() {
    const run = this.run;
    const w = run.wave;
    let n = 0;
    for (const e of run.enemies) {
      if (e.dead || e.waveId !== w.currentId) continue;
      run.effects.push({ kind: 'ring', x: e.x, y: e.y, r: 50, life: 0.45, maxLife: 0.45, color: '#8f5fff' });
      e.dead = true;
      n++;
    }
    if (n) {
      notice('虫潮退去', `剩下的 ${n} 只虫子钻回地下了 —— 这一波没算击退。`, 'warn');
      run.addLog(`第 ${w.number} 波超时，${n} 只撤退`);
    }
  }

  nextInterval() {
    /*
     * ↓ 这两行原本是**漏掉的**。
     *
     * `nextInterval()` 里用了 `run` 和 `base`，但整个方法没有声明它们
     * （文件里其他每个方法开头都有 `const run = this.run;`）。
     * 后果：一波怪结束 → 26 秒善后期 → 计时归零 → 这里抛
     * `ReferenceError: run is not defined`，**每波必然复现**。
     * 因为一波要 150 秒以上，短时间试玩根本碰不到，所以藏了很久。
     * `tools/probe-nextinterval.mjs` 就是它的复现脚本，smoke 里也有断言盯着。
     */
    const run = this.run;
    const base = BEACON.waveIntervalBase;
    // 纯塔防没有巢穴可以清，间隔只跟吸引阵列等级与波次有关：
    // 越往后越紧凑，给玩家的喘息时间随难度缩短
    if (run.isTowerDefense) {
      const shrink = Math.min(0.45, run.wave.number * 0.02);
      return clamp(base * (1 - shrink), BEACON.waveIntervalMin, BEACON.waveIntervalBase);
    }
    const nests = run.world.nests.filter(n => !n.destroyed).length;
    // 巢穴越少，怪潮间隔越长（清巢的收益）
    const nestFactor = clamp01(nests / Math.max(1, run.world.nests.length));
    return clamp(base * (0.6 + nestFactor * 0.55), BEACON.waveIntervalMin, BEACON.waveIntervalBase * 1.4);
  }

  startWave() {
    const run = this.run;
    const w = run.wave;
    const b = run.beacon;

    if (!b.online) { w.state = 'calm'; w.timer = 25; return; }

    // 消耗一波燃料
    b.fuel = Math.max(0, b.fuel - BEACON.fuelPerWave);

    w.number++;
    run.stats.wavesTotal = w.number;
    w.currentId = 'wave' + w.number;
    w.state = 'incoming';
    w.timer = this.modeWave().warnSeconds;
    w.elapsed = 0;
    this.warned = false;

    if (run.isTowerDefense) { this.startWaveTowerDefense(); return; }

    // 组成：按吸引强度决定牵引到的巢穴数量
    const alive = run.world.nests.filter(n => !n.destroyed);
    const inRange = alive.filter(n => dist(n.x, n.y, b.x, b.y) <= b.radius);
    const farOnes = alive.filter(n => dist(n.x, n.y, b.x, b.y) > b.radius);

    // 超范围巢穴只有一小部分被"部分牵引"
    const contributors = [...inRange];
    for (const n of farOnes) {
      if (rnd.chance(0.22 * b.intensity)) contributors.push(n);
    }
    if (!contributors.length && alive.length) contributors.push(rnd.pick(alive));

    const intensity = b.intensity;
    const threat = contributors.reduce((s, n) => s + n.threat, 0);
    const budget = Math.round((10 + threat * 7.5) * (0.45 + intensity) * (1 + run.planetIndex * 0.16));

    // 按预算选怪
    const composition = [];
    let spent = 0;
    const pools = this.buildPool(contributors);
    while (spent < budget && composition.length < 90) {
      const type = rnd.weighted(pools);
      const def = MONSTER_DEF[type];
      if (!def) break;
      const cost = 1 + Math.floor(def.hp / 45) + (def.elite ? 6 : 0);
      composition.push({ type, nest: rnd.pick(contributors).id });
      spent += cost;
    }

    w.composition = composition;
    w.total = composition.length;
    w.remaining = composition.length;
    w.contributors = contributors.map(n => n.id);

    bus.emit(EV.WAVE_INCOMING, { seconds: Math.ceil(w.timer), number: w.number, count: composition.length });
    bus.emit(EV.SFX, { name: 'waveKlaxon' });
    const far = contributors.filter(n => !inRange.includes(n)).length;
    notice(`第 ${w.number} 波虫潮`, `牵引到 ${contributors.length} 个巢穴（其中 ${far} 个在装置范围外被部分牵引），共 ${composition.length} 只。${Math.ceil(w.timer)} 秒后抵达。`, 'danger');
    run.addLog(`第 ${w.number} 波：${composition.length} 只，来自 ${contributors.length} 个巢穴`);

    // 生成怪物（分散到各贡献巢穴附近）
    this.spawnWaveEnemies(composition, contributors);
  }

  // =========================================================
  //  纯塔防模式的波次
  // =========================================================

  modeWave() {
    return this.run.modeDef?.wave || { source: 'nests', warnSeconds: 22, prepSeconds: 0 };
  }

  /**
   * 纯塔防：怪潮从阵地外的一圈生成，一起冲向基地。
   *
   * 难度只跟「第几波 + 星球 + 吸引阵列等级」有关 —— 没有巢穴可以清，
   * 所以压力是一条单调上升的曲线，玩家唯一的应对就是把自己的塔和科技做起来。
   */
  startWaveTowerDefense() {
    const run = this.run;
    const w = run.wave;
    const b = run.beacon;
    const n = w.number;

    // 预算：随波次线性增长 + 吸引阵列等级（这就是塔防模式的「难度旋钮」）
    const budget = Math.round(
      (9 + n * 3.1) * (0.8 + b.intensity * 0.5) * (1 + run.planetIndex * 0.18),
    );
    // 池子随波次开放：前期只有小怪，后期才出精英与特殊怪
    const pool = [];
    pool.push(...NEST_ROSTER.base.map(t => ({ t, w: 30 })));
    if (n >= 3) pool.push(...NEST_ROSTER.mid.map(t => ({ t, w: 22 })));
    if (n >= 6) pool.push(...NEST_ROSTER.high.map(t => ({ t, w: 20 })));
    if (n >= 9) pool.push(...NEST_ROSTER.special.map(t => ({ t, w: 10 })));

    const composition = [];
    let spent = 0;
    while (spent < budget && composition.length < 90) {
      const type = rnd.weighted(pool);
      const def = MONSTER_DEF[type];
      if (!def) break;
      const cost = 1 + Math.floor(def.hp / 45) + (def.elite ? 6 : 0);
      composition.push({ type });
      spent += cost;
    }

    w.composition = composition;
    w.total = composition.length;
    w.remaining = composition.length;
    w.contributors = [];

    bus.emit(EV.WAVE_INCOMING, { seconds: Math.ceil(w.timer), number: n, count: composition.length });
    bus.emit(EV.SFX, { name: 'waveKlaxon' });
    notice(`第 ${n} 波虫潮`, `侦测到 ${composition.length} 只正在逼近阵地，${Math.ceil(w.timer)} 秒后接触。`, 'danger');
    run.addLog(`第 ${n} 波：${composition.length} 只（塔防模式）`);

    this.spawnFieldEnemies(composition);
  }

  /** 从阵地外一圈生成，分散在多个方向上 */
  spawnFieldEnemies(composition) {
    const run = this.run;
    const base = run.base;
    // 生成半径：比阵地半径再远一点，保证敌人是「从外面走进来」的
    const field = run.modeDef?.fieldRadius || 900;
    const spawnR = field + 420;
    const tier = clamp(1 + Math.floor(run.wave.number / 4), 1, 5);

    let i = 0;
    for (const item of composition) {
      // 按角度均匀铺开，分出几个「进攻方向」，看起来像成建制的冲锋
      const lanes = 4;
      const lane = i % lanes;
      const a = (lane / lanes) * Math.PI * 2 + rnd.range(-0.35, 0.35) + run.wave.number * 0.7;
      const r = spawnR + rnd.range(-90, 140);
      const spot = run.world.findOpenSpot(
        base.x + Math.cos(a) * r,
        base.y + Math.sin(a) * r,
        220,
      );
      const scale = enemyScaleFor(run, tier + run.planetIndex, 1);
      const e = createEnemy(run, item.type, spot.x, spot.y, {
        tier, scale, waveId: run.wave.currentId,
      });
      i++;
      if (!e) continue;
      e.role = 'wave';
      e.speed *= 1.08;
      run.enemies.push(e);
    }
  }

  buildPool(contributors) {
    const run = this.run;
    const pool = [];
    const maxTier = Math.max(1, ...contributors.map(n => n.tier));
    pool.push(...NEST_ROSTER.base.map(t => ({ t, w: 26 })));
    if (maxTier >= 2) pool.push(...NEST_ROSTER.mid.map(t => ({ t, w: 22 })));
    if (maxTier >= 3) pool.push(...NEST_ROSTER.high.map(t => ({ t, w: 20 })));
    if (maxTier >= 4) pool.push(...NEST_ROSTER.special.map(t => ({ t, w: 8 })));
    for (const n of contributors) {
      for (const t of (BIOME_MONSTERS[n.biome] || [])) pool.push({ t, w: 7 });
    }
    // 吸引强度高 -> 更容易出现高强度怪
    const intensity = run.beacon.intensity;
    if (intensity > 0.6) {
      pool.push(...NEST_ROSTER.special.map(t => ({ t, w: 14 })));
      pool.push(...NEST_ROSTER.high.map(t => ({ t, w: 10 })));
    }
    return pool;
  }

  /**
   * 决定一只怪「从哪儿出来」。
   *
   * 规则（玩家反复反馈「虫子像凭空冒出来」之后定下来的）：
   *   1. **巢就在屏幕里** → 从巢口刷。玩家看得见虫子从洞里爬出来，这是想要的效果。
   *   2. 巢在屏幕外、而且离玩家足够远 → 也从巢里刷（它们自己走过来，过程可见）。
   *   3. 巢在屏幕外、但离玩家太近（就在屏幕边上）→ 沿「玩家 → 巢」方向推到
   *      **屏幕外再留一段缓冲**的位置。这是关键：直接在屏幕边刷，
   *      玩家就会看到虫子在基地旁边凭空出现。
   *   4. 没有巢（追杀潮 / 野外怪）→ 屏幕外沿随机方向。
   */
  spawnPoint(prefer, opts = {}) {
    const run = this.run;
    const view = run.camera?.viewRect(0) || null;
    const anchor = opts.anchor || run.camera || run.player;
    const margin = opts.margin ?? 90;
    const viewR = view ? Math.hypot(view.x1 - view.x0, view.y1 - view.y0) * 0.5 : 700;
    const standoff = viewR + margin + (opts.standoff ?? 180);

    const at = (cx, cy) => run.world.findOpenSpot(cx, cy, opts.openRadius ?? 240);
    const nestSpot = (nest) => {
      const a = rnd.next() * Math.PI * 2;
      const r = rnd.range(nest.r * 1.5, nest.r * 4);
      return at(nest.x + Math.cos(a) * r, nest.y + Math.sin(a) * r);
    };

    if (prefer) {
      const visible = view
        && prefer.x > view.x0 && prefer.x < view.x1
        && prefer.y > view.y0 && prefer.y < view.y1;
      if (visible) return nestSpot(prefer);                       // 1) 看得见巢：从洞里出来
      const d = Math.hypot(prefer.x - anchor.x, prefer.y - anchor.y);
      if (d >= standoff) return nestSpot(prefer);                 // 2) 巢够远：从巢里走出来
      const ang = Math.atan2(prefer.y - anchor.y, prefer.x - anchor.x);
      return at(anchor.x + Math.cos(ang) * standoff,              // 3) 巢太近：推到屏幕外
        anchor.y + Math.sin(ang) * standoff);
    }

    // 4) 没有巢：屏幕外沿随机方向
    const ang = rnd.next() * Math.PI * 2;
    return at(anchor.x + Math.cos(ang) * standoff, anchor.y + Math.sin(ang) * standoff);
  }

  spawnWaveEnemies(composition, contributors) {
    const run = this.run;
    for (const item of composition) {
      const nest = run.world.nests.find(n => n.id === item.nest) || rnd.pick(contributors);
      if (!nest) continue;
      // 从虫巢里刷：这条是「刷怪从虫巢刷怪」的直接实现
      const spot = this.spawnPoint(nest);
      const tier = nest.tier;
      const scale = enemyScaleFor(run, tier + run.planetIndex, 1);
      const e = createEnemy(run, item.type, spot.x, spot.y, {
        tier, scale, fromNest: nest.id, waveId: run.wave.currentId,
      });
      if (!e) continue;
      e.role = 'wave';
      // 怪潮单位移动略快，保证能在合理时间内到达
      e.speed *= 1.1;
      run.enemies.push(e);
    }
  }

  endWave(cleared) {
    const run = this.run;
    const w = run.wave;
    w.state = 'aftermath';
    w.timer = 26;
    if (cleared) {
      run.stats.wavesSurvived++;
      /*
       * 实验科技：打退一波给 1 次选择。
       *
       * 为什么放在这里而不是升级：升级曾经顺带送一次四选一，
       * 结果一场下来能攒二十多次（实验科技从「成长事件」变成弹窗疲劳）。
       * 现在是「一波怪潮 ≈ 一次实验科技」，和玩家实际经历的节奏对齐。
       */
      run.grantExperimentChoice(1);
      // 结算奖励：波次奖金
      const bonusGold = Math.round((40 + w.number * 12) * (1 + run.beacon.intensity));
      const bonusResearch = 1 + Math.floor(w.number / 3);
      run.addResource('gold', bonusGold);
      run.resources.research = (run.resources.research || 0) + bonusResearch;

      // 银行利息（实验科技）
      const interest = run.playerStats.get('goldInterest');
      if (interest > 0) {
        const gain = Math.round(run.resources.gold * interest);
        run.resources.gold += gain;
        if (gain > 0) notice('殖民地银行结算', `利息 +${gain} 金币。`, 'good');
      }

      bus.emit(EV.WAVE_END, { number: w.number, bonusGold });
      notice(`第 ${w.number} 波已击退`, `基地守住了。结算 +${bonusGold} 金币、+${bonusResearch} 研究资料、+1 次实验科技选择（按 V 使用）。${run.hasFeature('autoCollect') ? '回收无人机已自动收集战场掉落。' : '去战场把经验和掉落捡回来。'}`, 'good');
      run.addLog(`第 ${w.number} 波击退`);

      // 自动收集
      if (run.hasFeature('autoCollect')) run.loot.autoCollectField();
    } else {
      notice(`第 ${w.number} 波超时`, '虫潮退去了，但基地挨了不少打。', 'warn');
    }
    // 清掉残余的本波怪（避免无限残留）
    for (const e of run.enemies) {
      if (e.waveId === w.currentId && !e.dead && e.hp < e.hpMax * 0.15) e.hp = 0;
    }
    // 清空复仇加成
    for (const t of run.towers) { t.vengeanceBonus = 0; t.vengeanceRate = 0; }
  }

  // =========================================================
  //  追杀模式（基地被毁后）
  // =========================================================

  updateHunt(dt) {
    const run = this.run;
    const w = run.wave;
    w.huntTimer -= dt;
    if (w.huntTimer > 0) return;
    w.huntTimer = BASE.alarmWaveGap;

    // 所有活着的巢穴朝玩家泼一波怪
    const nests = run.world.nests.filter(n => !n.destroyed);
    if (!nests.length) return;
    const p = run.player;
    const count = 6 + Math.floor(run.planetIndex * 2) + Math.floor(run.beacon.level * 0.8);
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      /*
       * 追杀潮：怪种与强度按某个巢穴来（等级决定强度），
       * 但**生成点不给巢** —— 直接从屏幕外沿刷，它们正在循着你的气味过来。
       * 注意 nest 还是要取的：它决定 tier / 来源标记。
       */
      const nest = rnd.pick(nests);
      const spot = this.spawnPoint(null, { anchor: p, openRadius: 200 });
      const scale = enemyScaleFor(run, nest.tier + run.planetIndex, 1.05);
      const type = rnd.weighted([
        ...NEST_ROSTER.base.map(t => ({ t, w: 18 })),
        ...NEST_ROSTER.mid.map(t => ({ t, w: 20 })),
        ...NEST_ROSTER.high.map(t => ({ t, w: 16 })),
      ]);
      const e = createEnemy(run, type, spot.x, spot.y, {
        tier: nest.tier, scale, fromNest: nest.id, waveId: 'hunt' + Math.floor(run.time),
      });
      if (!e) continue;
      e.role = 'hunter';
      e.speed *= 1.15;
      run.enemies.push(e);
      spawned++;
    }
    if (spawned) {
      bus.emit(EV.SFX, { name: 'alarm' });
      notice('追杀潮', `${spawned} 只虫群正在朝你扑来 —— 基地没了，你就是唯一的信号源。`, 'danger');
    }
  }

  // =========================================================
  //  巢穴
  // =========================================================

  updateNests(dt) {
    const run = this.run;
    // 巢穴自我修复（长期不打会缓慢回血，逼玩家一次打下来）
    for (const nest of run.world.nests) {
      if (nest.destroyed) continue;
      if (nest.hp < nest.maxHp) {
        const lastHit = nest.lastHitAt ?? -999;
        if (run.time - lastHit > 25) {
          nest.hp = Math.min(nest.maxHp, nest.hp + nest.maxHp * 0.012 * dt);
        }
      }
      // 被发现
      if (!nest.discovered && dist2(nest.x, nest.y, run.player.x, run.player.y) < 900 * 900) {
        nest.discovered = true;
        bus.emit(EV.DISCOVERY, { kind: 'nest', label: nest.name, x: nest.x, y: nest.y });
        notice('发现虫巢', `${nest.name}（${nest.tier} 级）—— 摧毁它可以永久降低这一带的出怪量。`, 'warn');
      }
    }
  }

  // =========================================================
  //  太空快递（旧星球支援）
  // =========================================================

  updateSupply(dt) {
    const run = this.run;
    if (!run.claimedPlanets.length) return;
    this.supplyTimer -= dt;
    if (this.supplyTimer > 0) return;
    this.supplyTimer = run.planet.supply.interval;

    const rate = 1 + run.playerStats.get('supplyDropRate');
    const bonus = 1 + run.playerStats.get('supplyBonus');
    const got = [];
    for (const [k, v] of Object.entries(run.planet.supply.amount)) {
      const amount = Math.round(v * rate * bonus);
      if (amount <= 0) continue;
      run.addResource(k, amount, { ignoreCap: false });
      got.push(`${k} ${amount}`);
    }
    run.stats.supplyDrops++;
    notice('太空快递抵达', `来自已开拓星球的定期支援：${got.join('、')}`, 'good');
    bus.emit(EV.SFX, { name: 'unlock' });
  }

  // =========================================================
  //  昼夜
  // =========================================================

  updateDayNight(dt) {
    const run = this.run;
    const day = Math.floor(run.time / 240) + 1;
    if (day !== run.day) {
      run.day = day;
      notice(`第 ${day} 天`, '殖民地又撑过了一个昼夜循环。', 'info');
    }
  }

  updateThreatSnapshot(dt) {
    const run = this.run;
    run._threatTimer = (run._threatTimer || 0) - dt;
    if (run._threatTimer > 0) return;
    run._threatTimer = 1.5;
    run.wave.threat = run.threat;
  }

  // =========================================================
  //  玩家行动入口
  // =========================================================

  /** 玩家摧毁了一个巢穴 */
  destroyNest(nest) {
    const run = this.run;
    if (nest.destroyed) return;
    nest.destroyed = true;
    nest.hp = 0;
    run.stats.nestsDestroyed++;
    run.enemySystem?.invalidateFlow?.();

    // 奖励
    const mult = 1 + run.playerStats.get('matMult');
    run.addResource('gold', Math.round(nest.tier * 90 + 60));
    run.addResource('metal', Math.round((30 + nest.tier * 18) * mult));
    run.addResource('crystal', Math.round(nest.tier * 9 * mult));
    if (rnd.chance(0.55 + nest.tier * 0.1)) {
      run.resources.beaconCore = (run.resources.beaconCore || 0) + 1;
    }
    run.gainXp(nest.tier * 160 + 90);
    run.loot.dropNestLoot(nest);

    bus.emit(EV.NEST_DESTROYED, { nest });
    bus.emit(EV.SFX, { name: 'nestBreak' });
    bus.emit(EV.SCREEN_SHAKE, { mag: 12, time: 0.8 });

    const left = run.world.nests.filter(n => !n.destroyed).length;
    notice('虫巢已摧毁', `${nest.name} 被彻底清除了。这一带的出怪量永久减少。剩余巢穴：${left}`, 'good');
    run.addLog(`摧毁巢穴 ${nest.name}（剩余 ${left}）`);

    if (left === 0) this.onAllNestsCleared();
  }

  onAllNestsCleared() {
    const run = this.run;
    run.planetClaimed = true;
    if (!run.claimedPlanets.some(p => p.index === run.planetIndex)) {
      run.claimedPlanets.push({ index: run.planetIndex, name: run.planet.name, since: run.time });
    }
    run.beacon.online = false;
    bus.emit(EV.PLANET_CLAIMED, { planet: run.planet });
    bus.emit(EV.SFX, { name: 'levelup' });
    notice('星球已占领！', '所有虫巢都被清除，这颗星球正式纳入殖民地版图。吸引阵列已停机 —— 不会再有怪潮。你可以选择继续经营，或者开拓下一颗星球。', 'good');
    run.addLog(`占领星球 ${run.planet.name}`);
  }

  /** 手动触发一次怪潮（老玩家追收益用） */
  forceWave() {
    const run = this.run;
    if (run.wave.state !== 'calm') {
      notice('暂时无法召集', '当前已经有虫潮在进行中。', 'warn');
      return false;
    }
    run.wave.timer = Math.min(run.wave.timer, 8);
    notice('主动呼叫虫潮', '你把吸引阵列的输出拉满 —— 8 秒后怪潮来袭。', 'warn');
    return true;
  }
}
