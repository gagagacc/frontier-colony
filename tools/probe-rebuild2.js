/** 探针：为什么按 E 重建没反应（把判定链路上的每个开关都打出来） */
export default async function run({ evalIn, sleep, log }) {
  const s = async (n, e) => { const r = await evalIn(e); log(`[${n}]`, JSON.stringify(r.error ? { ERR: r.error.split('\n')[0] } : r.value)); await sleep(200); };

  await s('enter', `(async () => {
    const f = window.__frontier;
    if (f.game.state !== 'playing') {
      [...document.querySelectorAll('#mainmenu .btn')].find(x => x.textContent.includes('开始新开荒'))?.click();
      await new Promise(r => setTimeout(r, 400));
      document.querySelectorAll('.char-card')[0]?.click();
      await new Promise(r => setTimeout(r, 250));
      [...document.querySelectorAll('button')].find(x => /确定|选择降落点/.test(x.textContent))?.click();
      await new Promise(r => setTimeout(r, 500));
      [...document.querySelectorAll('button')].find(x => x.textContent.includes('降落'))?.click();
      await new Promise(r => setTimeout(r, 1200));
    }
    return { state: f.game.state, paused: f.game.paused };
  })()`);

  await s('diag', `(() => {
    const f = window.__frontier;
    const run = f.game.run;
    const p = run.player;
    run.base.hp = 0; run.base.destroyed = true; run.base.repairProgress = 0;
    run.resources.metal = 9999;
    p.x = run.base.x + 30; p.y = run.base.y + 30;
    const ps = run.playerSystem;
    return {
      paused: f.game.paused,
      dungeon: !!run.dungeon,
      placing: !!f.ui.actions.pendingPlacement,
      baseDestroyed: run.base.destroyed,
      distToBase: Math.round(Math.hypot(p.x - run.base.x, p.y - run.base.y)),
      baseR: run.base.r,
      // 附近有没有「更该修」的东西抢走 E
      repairable: !!run.nearestRepairable(p.x, p.y, 80),
      towers: run.towers.length, structures: run.structures.length, town: run.townBuildings.length,
      /** updateHarvest 在「按住」时才跑 */
      holdingBefore: f.input.isDown('interact'),
    };
  })()`);

  await s('holdE', `(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    f.input.keys.add('KeyE');
    f.input.down.add('interact');
    // 每帧强制保持按住（游戏的 endFrame 会清理按键集合）
    const keep = setInterval(() => { f.input.keys.add('KeyE'); f.input.down.add('interact'); }, 16);
    await new Promise(r => setTimeout(r, 2500));
    clearInterval(keep);
    f.input.keys.delete('KeyE'); f.input.down.delete('interact');
    return {
      progress: +run.base.repairProgress.toFixed(2),
      paused: f.game.paused,
      repairing: !!run.playerSystem.repairTarget,
      harvesting: !!run.playerSystem.harvestTarget,
      harvestTargetType: run.playerSystem.harvestTarget?.type || null,
    };
  })()`);

  await s('manualTap', `(() => {
    const run = window.__frontier.game.run;
    run.base.repairProgress = 0;
    const ok = run.tapRebuild(run.base);
    return { ok, progress: +run.base.repairProgress.toFixed(2), destroyed: run.base.destroyed };
  })()`);
}
