/**
 * 投射物系统：玩家/防御塔/敌人共用一个池。
 * 支持追踪、穿透、抛物线、落地效果。
 */

import { clamp } from '../core/math.js';
import { bus, EV } from '../core/events.js';
import { makePool } from './enemies.js';

export class ProjectileSystem {
  constructor(run) {
    this.run = run;
    this.enabled = true;
    this._qb = [];
    this._qb2 = [];
  }

  update(dt) {
    const run = this.run;
    const list = run.projectiles;
    for (let i = list.length - 1; i >= 0; i--) {
      const pr = list[i];
      if (pr.dead) { swapRemoveAt(list, i); continue; }
      const prevX = pr.x, prevY = pr.y;

      // 追踪
      if (pr.homing && pr.homing.target && !pr.homing.target.dead && pr.homing.target.hp > 0) {
        const t = pr.homing.target;
        const want = Math.atan2(t.y - pr.y, t.x - pr.x);
        const cur = Math.atan2(pr.vy, pr.vx);
        let diff = want - cur;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const turn = (pr.homing.turn || 1.2) * dt;
        const na = cur + clamp(diff, -turn, turn);
        const sp = pr.homing.speed || Math.hypot(pr.vx, pr.vy);
        pr.vx = Math.cos(na) * sp;
        pr.vy = Math.sin(na) * sp;
      }

      // 抛物线视觉高度
      if (pr.gravity) {
        pr.arcT = (pr.arcT || 0) + dt;
        const total = pr.maxLife || 1;
        const t = clamp(pr.arcT / total, 0, 1);
        pr.z = Math.sin(t * Math.PI) * (pr.gravity.arc || 60);
        // 落点判定：接近目标点或时间到
        if (pr.arcT >= total) { this.explode(pr); continue; }
      }

      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.life -= dt;

      // 尾迹
      if (pr.trail.length < 6) pr.trail.push({ x: pr.x, y: pr.y });
      else { pr.trail.shift(); pr.trail.push({ x: pr.x, y: pr.y }); }

      if (pr.life <= 0) {
        if (pr.gravity) this.explode(pr);
        else pr.dead = true;
        if (pr.dead) swapRemoveAt(list, i);
        continue;
      }

      // 撞地形（沿路径扫掠，防止高速穿过薄墙）
      if (!pr.gravity && this.sweepBlocked(pr, prevX, prevY)) {
        if (pr.splash) this.explode(pr);
        else {
          run.effects.push({ kind: 'spark', x: pr.x, y: pr.y, life: 0.16, maxLife: 0.16, color: pr.color });
          pr.dead = true;
        }
        if (pr.dead) swapRemoveAt(list, i);
        continue;
      }

      // 命中判定
      if (pr.friendly) this.hitEnemies(pr, i, dt, prevX, prevY);
      else this.hitPlayerSide(pr, i, dt, prevX, prevY);
    }
  }

  /**
   * 高速弹丸的隧道效应处理：一帧移动可能超过目标半径，
   * 只在终点判定会「穿过去」。这里沿移动线段分几步采样。
   */
  stepCount(pr, prevX, prevY) {
    const dx = pr.x - prevX, dy = pr.y - prevY;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(8, pr.r + 8);
    return Math.min(12, Math.max(1, Math.ceil(dist / step)));
  }

  sweepBlocked(pr, prevX, prevY) {
    const run = this.run;
    const n = this.stepCount(pr, prevX, prevY);
    if (n <= 1) return run.world.isBlockedPx(pr.x, pr.y);
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      const px = prevX + (pr.x - prevX) * t;
      const py = prevY + (pr.y - prevY) * t;
      if (run.world.isBlockedPx(px, py)) return true;
    }
    return false;
  }

  hitEnemies(pr, index, dt, prevX = pr.x, prevY = pr.y) {
    const run = this.run;
    // 沿路径采样命中，避免高速弹丸穿过敌人
    const n = this.stepCount(pr, prevX, prevY);
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      const px = prevX + (pr.x - prevX) * t;
      const py = prevY + (pr.y - prevY) * t;
      const near = run.spatial.query(px, py, pr.r + 20, this._qb);
      for (const e of near) {
        if (e.kind !== 'enemy' || e.dead) continue;
        if (pr.hitSet.has(e.id)) continue;
        pr.hitSet.add(e.id);

        run.enemySystem.damage(e, pr.damage, {
          source: pr.source || 'projectile',
          knockback: pr.knockback,
          ignoreArmor: pr.ignoreArmor,
          x: px, y: py,
        });
        this.applyEffect(e, pr);

        if (pr.splash) { this.explode(pr); return; }
        if (pr.pierce > 0) { pr.pierce--; continue; }
        pr.dead = true;
        run.effects.push({ kind: 'spark', x: px, y: py, life: 0.14, maxLife: 0.14, color: pr.color });
        swapRemoveAt(run.projectiles, index);
        return;
      }
    }
  }

  hitPlayerSide(pr, index, dt, prevX = pr.x, prevY = pr.y) {
    const run = this.run;
    const p = run.player;
    const n = this.stepCount(pr, prevX, prevY);
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      const px = prevX + (pr.x - prevX) * t;
      const py = prevY + (pr.y - prevY) * t;
      // 打玩家
      if (!p.dead && dist2(px, py, p.x, p.y) < (pr.r + p.r) * (pr.r + p.r)) {
        run.playerSystem.hurt(pr.damage, pr.owner, { source: '远程攻击' });
        if (pr.splash || pr.effect?.pool) this.explode(pr);
        else { pr.dead = true; swapRemoveAt(run.projectiles, index); }
        return;
      }
      // 打车
      const v = run.vehicle;
      if (p.inVehicle && dist2(px, py, v.x, v.y) < (pr.r + v.r) * (pr.r + v.r)) {
        this.damageVehicle(v, pr.damage);
        pr.dead = true; swapRemoveAt(run.projectiles, index);
        return;
      }
      // 打建筑
      for (const b of [...run.towers, ...run.structures]) {
        if (b.hp <= 0) continue;
        const rr = (b.r || 20) + pr.r;
        if (dist2(px, py, b.x, b.y) < rr * rr) {
          if (pr.splash) { this.explode(pr); return; }
          run.enemySystem.damageBuilding(b, pr.damage);
          pr.dead = true; swapRemoveAt(run.projectiles, index);
          return;
        }
      }
    }
  }

  damageVehicle(v, amount) {
    const run = this.run;
    v.hp -= amount;
    run.playerSystem.hurt(amount * 0.25, null, { source: '载具受损' });
    if (v.hp <= 0) {
      v.hp = 0;
      v.destroyed = true;
      if (run.player.inVehicle) {
        run.player.inVehicle = false;
        const spot = run.world.findOpenSpot(v.x, v.y, 90);
        run.player.x = spot.x; run.player.y = spot.y;
      }
      bus.emit(EV.SFX, { name: 'explode' });
      bus.emit(EV.SCREEN_SHAKE, { mag: 10, time: 0.6 });
      bus.emit(EV.NOTICE, { title: '载具损毁', body: '载具被打爆了。回基地用金属修复它，或者靠两条腿跑。', kind: 'danger' });
    }
  }

  applyEffect(e, pr) {
    const eff = pr.effect;
    if (!eff) return;
    const st = this.run.playerStats;
    if (eff.slow) {
      const amount = eff.slow.amount;
      if (e.slow) {
        e.slow.amount = Math.max(e.slow.amount, amount);
        e.slow.remain = Math.max(e.slow.remain, eff.slow.dur);
        e.slow.stacks = Math.min(eff.slow.max || 3, (e.slow.stacks || 1) + 1);
      } else {
        e.slow = { amount, remain: eff.slow.dur, stacks: 1, max: eff.slow.max || 3 };
      }
    }
    if (eff.mark) {
      e.marks = Math.min(eff.mark.max || 5, (e.marks || 0) + 1);
      e.markTimer = eff.mark.dur || 8;
    }
    if (eff.burn) {
      const dps = eff.burn.dps * (1 + st.get('dotMult'));
      e.burn = { dps, remain: eff.burn.dur, stacks: Math.min(eff.burn.max || 3, (e.burn?.stacks || 0) + 1), max: eff.burn.max || 3 };
    }
    if (eff.poison) {
      const dps = eff.poison.dps * (1 + st.get('dotMult'));
      e.poison = { dps, remain: eff.poison.dur, stacks: Math.min(eff.poison.max || 5, (e.poison?.stacks || 0) + 1), max: eff.poison.max || 5 };
    }
  }

  explode(pr) {
    const run = this.run;
    pr.dead = true;
    const idx = run.projectiles.indexOf(pr);
    if (idx >= 0) swapRemoveAt(run.projectiles, idx);

    const splash = pr.splash;
    run.effects.push({
      kind: 'nova', x: pr.x, y: pr.y,
      r: splash?.radius || 90,
      life: 0.36, maxLife: 0.36,
      color: pr.color || '#ffba4c',
    });
    bus.emit(EV.SFX, { name: 'explode', volume: 0.7 });
    bus.emit(EV.SCREEN_SHAKE, { mag: 4, time: 0.2 });

    if (splash && pr.friendly) {
      const near = run.spatial.query(pr.x, pr.y, splash.radius, this._qb2);
      for (const e of near) {
        if (e.kind !== 'enemy' || e.dead) continue;
        run.enemySystem.damage(e, pr.damage * (splash.mult || 0.6), { source: 'splash', x: pr.x, y: pr.y });
      }
    }
    if (pr.onLand?.cloud) {
      const c = pr.onLand.cloud;
      run.effects.push({
        kind: 'pool', x: pr.x, y: pr.y, r: c.radius,
        dps: c.dps, life: c.dur, maxLife: c.dur,
        friendly: true, tickCd: 0, color: '#c58fd8', armorDebuff: c.armorDebuff,
      });
    }
    if (pr.effect?.pool) {
      run.effects.push(makePool(pr.x, pr.y, pr.effect.pool));
    }
  }
}

function dist2(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
}

function swapRemoveAt(arr, i) {
  const last = arr.length - 1;
  if (i !== last) arr[i] = arr[last];
  arr.pop();
}
