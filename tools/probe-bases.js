/** 探针：run.bases 与 run.base 是不是同一个对象？废墟判定为什么不生效？ */
export default async function run({ evalIn, sleep, log }) {
  const r = await evalIn(`(() => {
    const f = window.__frontier;
    const run = f.game.run;
    if (!run) return { noRun: true };
    run.base.hp = 0; run.base.destroyed = true;
    const p = run.player;
    p.x = run.base.x + 30; p.y = run.base.y + 30;
    const TILE = f.config.TILE;
    return {
      basesLen: run.bases.length,
      sameObject: run.base === run.bases[0],
      baseDestroyed: run.base.destroyed,
      basesDestroyed: run.bases.map(b => !!b.destroyed),
      dist: Math.round(Math.hypot(p.x - run.base.x, p.y - run.base.y)),
      baseR: run.base.r,
      matches: run.bases.filter(b => b.destroyed && Math.hypot(p.x - b.x, p.y - b.y) < b.r + 40).length,
      playerFields: { x: Math.round(p.x), y: Math.round(p.y), dead: p.dead, inVehicle: p.inVehicle },
      gameState: f.game.state,
      paused: f.game.paused,
      // playerSystem 是不是同一份？
      psRunSame: run.playerSystem?.run === run,
      runIsCurrent: f.game.run === run,
      tile: TILE,
    };
  })()`);
  log('[bases]', JSON.stringify(r.error ? { ERR: r.error } : r.value));
}
