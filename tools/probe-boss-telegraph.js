/**
 * 探针：把 Boss 的「红色感叹号 + 冲撞走廊」预警定格，方便截图。
 * 手法：起手之后把 Boss 眩晕住（stun 很大），预警进度就冻住了 ——
 * 渲染只管画 `e.casting`，所以画面上的警示仍然在。
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
    run.playerSystem.enterNest(nest);
    await new Promise(r => setTimeout(r, 1200));
    return { tier: f.game.run.dungeon?.tier, guards: f.game.run.dungeonGarrison };
  })()`, 800);

  await s('freeze-warn', `(() => {
    const f = window.__frontier;
    const run = f.game.run;
    const boss = run.enemySystem.spawnDungeonBoss(run.dungeon);
    const charge = boss.abilities.find(a => a.kind === 'charge');
    // 玩家站远一点、血厚一点，别在截图时被打死
    run.player.hpMax = 99999; run.player.hp = 99999;
    run.player.x = boss.x - 300; run.player.y = boss.y + 10;
    run.camera.snapTo(boss.x - 90, boss.y);
    boss.target = run.player;
    boss.abilities.forEach(a => { a.t = 9999; });      // 先不放别的技能
    run.enemySystem.bossAbility(boss, charge);          // 起手（进入预警）
    boss.stun = 9999;                                   // 冻住预警进度，方便截图
    run.enemySystem.update(1/60, { input: { mouseIsDown: () => false }, mouseWorld: { x: 0, y: 0 } });
    return {
      casting: !!boss.casting, warnLeft: +(boss.casting?.t || 0).toFixed(1),
      angleDeg: Math.round((boss.casting?.angle || 0) * 180 / Math.PI),
      boss: boss.def.name,
    };
  })()`, 700);
}
