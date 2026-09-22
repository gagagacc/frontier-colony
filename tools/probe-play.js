/**
 * 探针：玩一段 + 把错误日志读出来。
 * 玩法覆盖：开局 → 采集 → 建造 → 怪潮 → 副本 → 基地打爆 → 追杀 → 载具。
 * 目的是复现玩家报的「现在出现的报错」。
 */
export default async function run({ evalIn, sleep, log }) {
  const s = async (n, e, wait = 200) => {
    const r = await evalIn(e);
    log(`[${n}]`, JSON.stringify(r.error ? { ERR: r.error.split('\n')[0] } : r.value));
    await sleep(wait);
    return r.value;
  };

  await s('boot', `(() => {
    const f = window.__frontier;
    if (f.game.state === 'menu') {
      [...document.querySelectorAll('#mainmenu .btn')].find(x => x.textContent.includes('开始新开荒'))?.click();
    }
    return { state: f.game.state };
  })()`, 500);
  await s('enter', `(async () => {
    const f = window.__frontier;
    if (f.game.state === 'charSelect') {
      document.querySelectorAll('.char-card')[0]?.click();
      await new Promise(r => setTimeout(r, 250));
      [...document.querySelectorAll('button')].find(x => /确定|选择降落点/.test(x.textContent))?.click();
      await new Promise(r => setTimeout(r, 600));
      [...document.querySelectorAll('button')].find(x => x.textContent.includes('降落'))?.click();
      await new Promise(r => setTimeout(r, 1500));
    }
    return { state: f.game.state, hasRun: !!f.game.run };
  })()`, 800);

  await s('play', `(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    for (const k of ['gold', 'metal', 'crystal', 'parts', 'tech', 'research', 'fiber', 'wood', 'food']) run.resources[k] = 99999;
    run.unlockedTech.add('t_turretSlot'); run.recomputeStats();
    // 建几座塔
    run.towerSystem.placeTower('sentry', run.base.x + 90, run.base.y + 40, { instant: true });
    run.towerSystem.placeTower('sentry', run.base.x + 130, run.base.y + 40, { instant: true });
    // 采集
    const p = run.player;
    const prop = [...run.world.props.values()].find(pr => !pr.dead && pr.type === 'fiberBush');
    if (prop) { p.x = prop.x + 20; p.y = prop.y; }
    f.input.keys.add('KeyE'); f.input.down.add('interact');
    await new Promise(r => setTimeout(r, 1500));
    f.input.keys.delete('KeyE'); f.input.down.delete('interact');
    return { harvested: run.stats.propsHarvested, towers: run.towers.length };
  })()`, 300);

  // 怪潮（把超时调短，别等太久）
  await s('wave', `(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    run.beacon.online = true; run.beacon.fuel = run.beacon.fuelMax;
    run.waveTimeout = 12;
    run.director.forceWave();
    await new Promise(r => setTimeout(r, 6000));
    return { state: run.wave.state, enemies: run.enemies.length, number: run.wave.number };
  })()`, 400);

  // 基地打爆 → 追杀
  await s('destroy+E', `(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    run.base.hp = 0; run.base.destroyed = true; run.base.repairProgress = 0;
    run.destroyBase(run.base);
    const p = run.player;
    p.x = run.base.x + 30; p.y = run.base.y + 30;
    f.input.keys.add('KeyE'); f.input.down.add('interact');
    const keep = setInterval(() => { f.input.keys.add('KeyE'); f.input.down.add('interact'); }, 16);
    await new Promise(r => setTimeout(r, 4000));
    clearInterval(keep);
    f.input.keys.delete('KeyE'); f.input.down.delete('interact');
    return { progress: +run.base.repairProgress.toFixed(2), destroyed: run.base.destroyed,
             hunt: run.wave.huntMode, reason: run.wave.huntReason, enemies: run.enemies.length };
  })()`, 400);

  // 副本
  await s('dungeon', `(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    const nest = run.world.nests.find(n => !n.destroyed);
    if (!nest) return { skip: true };
    run.player.x = nest.x + nest.r + 30; run.player.y = nest.y;
    run.playerSystem.enterNest(run, nest);
    await new Promise(r => setTimeout(r, 2500));
    const d = run.dungeon;
    const inner = f.game.run;
    return { tier: d && d.tier, sameRun: inner === run, innerEnemies: inner.enemies?.length ?? -1,
             tilesNearPlayer: (() => {
               const T = f.tiles?.T;
               return null;
             })() };
  })()`, 300);

  const errs = await evalIn(`(() => {
    const list = window.__frontierErrors || [];
    return { count: list.length, list: list.slice(-8).map(e => ({ at: e.at, kind: e.kind, msg: e.msg, where: e.where, stack: (e.stack||'').split('\\n').slice(0,3).join(' | ') })) };
  })()`);
  log('[ERRORS]', JSON.stringify(errs.error ? { ERR: errs.error } : errs.value, null, 1));
}
