/**
 * 探针：把副本里的「守军 + Boss 预警冲撞」摆好，方便外部截图确认视觉效果。
 * 为了稳定抓图，会把冲撞预警时间临时拉长到 30 秒（截完再还原）。
 */
export default async function run({ evalIn, sleep, log }) {
  const s = async (n, e, wait = 400) => {
    const r = await evalIn(e);
    log(`[${n}]`, JSON.stringify(r.error ? { ERR: r.error.split('\n')[0] } : r.value));
    await sleep(wait);
    return r.value;
  };

  await s('enter', `(async () => {
    const f = window.__frontier;
    if (f.game.state === 'menu') [...document.querySelectorAll('#mainmenu .btn')].find(x => x.textContent.includes('开始新开荒'))?.click();
    await new Promise(r => setTimeout(r, 400));
    if (f.game.state === 'charSelect') {
      document.querySelectorAll('.char-card')[0]?.click();
      await new Promise(r => setTimeout(r, 250));
      [...document.querySelectorAll('button')].find(x => /确定|选择降落点/.test(x.textContent))?.click();
      await new Promise(r => setTimeout(r, 600));
      [...document.querySelectorAll('button')].find(x => x.textContent.includes('降落'))?.click();
      await new Promise(r => setTimeout(r, 1500));
    }
    return { state: f.game.state };
  })()`, 700);

  await s('enter-nest', `(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    const nest = run.world.nests.filter(n => !n.destroyed).sort((a,b) => b.tier - a.tier)[0];
    run.player.x = nest.x + nest.r + 20; run.player.y = nest.y;
    const ok = run.playerSystem.enterNest(nest);
    await new Promise(r => setTimeout(r, 1200));
    return { ok, tier: f.game.run.dungeon?.tier };
  })()`, 900);

  await s('garrison', `(() => {
    const f = window.__frontier;
    const run = f.game.run;
    const guards = run.enemies.filter(e => e.dungeonGuard);
    return {
      garrison: run.dungeonGarrison, guards: guards.length,
      types: [...new Set(guards.map(e => e.def.name))].slice(0, 6),
    };
  })()`);

  // 把玩家挪到 Boss 房，生成 Boss，并让它进入「预警冲撞」状态
  await s('boss-warn', `(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    const d = run.dungeon;
    const boss = run.enemySystem.spawnDungeonBoss(d);
    const charge = boss.abilities.find(a => a.kind === 'charge');
    charge.warn = 30;                       // 拉长预警，方便截图
    run.player.x = boss.x - 230; run.player.y = boss.y;
    run.camera.snapTo(run.player.x, run.player.y);
    boss.target = run.player;
    boss.abilities.forEach(a => { a.t = 999; });   // 先别放别的技能
    run.enemySystem.bossAbility(boss, charge);
    await new Promise(r => setTimeout(r, 300));
    return { boss: boss.def.name, casting: !!boss.casting, warnLeft: +(boss.casting?.t || 0).toFixed(1), guardsNear: run.enemies.filter(e => !e.dead).length };
  })()`, 600);
}
