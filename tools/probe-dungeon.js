/**
 * 探针：真的进一次虫巢副本，在里面走、打、开地图、撤退，并收集报错。
 * （上一版探针的 enterNest 参数写错了，实际根本没进去 —— 所以副本一直是盲区。）
 */
export default async function run({ evalIn, sleep, log }) {
  const s = async (n, e, wait = 250) => {
    const r = await evalIn(e);
    log(`[${n}]`, JSON.stringify(r.error ? { ERR: r.error.split('\n')[0] } : r.value));
    await sleep(wait);
    return r.value;
  };

  await s('boot', `(() => {
    const f = window.__frontier;
    if (f.game.state === 'menu') [...document.querySelectorAll('#mainmenu .btn')].find(x => x.textContent.includes('开始新开荒'))?.click();
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
    return { state: f.game.state };
  })()`, 800);

  // 真的进副本（enterNest(nest)，不带 run）
  await s('enterNest', `(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    const nest = run.world.nests.find(n => !n.destroyed);
    if (!nest) return { noNest: true };
    run.player.x = nest.x + nest.r + 20; run.player.y = nest.y;
    const ok = run.playerSystem.enterNest(nest);
    await new Promise(r => setTimeout(r, 1200));
    return { ok, hasDungeon: !!f.game.run.dungeon, tier: f.game.run.dungeon?.tier,
             dungeonRun: f.game.run !== run, player: { x: Math.round(f.game.run.player.x), y: Math.round(f.game.run.player.y) } };
  })()`, 600);

  // 在副本里：看地形是不是巢穴风格 + 走一段 + 打一枪 + 开地图
  await s('inside', `(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    const d = run.dungeon;
    const w = run.world;
    // 统计玩家周围 40 格内的地块 id（巢壁 16 / 巢道 17 / 巢核 18 才是副本风格）
    const counts = {};
    const ptx = Math.floor(run.player.x / 40), pty = Math.floor(run.player.y / 40);
    for (let y = pty - 20; y <= pty + 20; y++) {
      for (let x = ptx - 20; x <= ptx + 20; x++) {
        if (x < 0 || y < 0 || x >= w.w || y >= w.h) continue;
        const t = w.tiles[y * w.w + x];
        counts[t] = (counts[t] || 0) + 1;
      }
    }
    // 世界有多大比例是巢壁/虚空（副本应该是「到处都是巢壁，只有一条通道」）
    let wall = 0, voidT = 0, other = 0;
    for (let i = 0; i < w.tiles.length; i += 7) {
      const t = w.tiles[i];
      if (t === 16) wall++;
      else if (t === 0) voidT++;
      else if (t !== 17 && t !== 18) other++;
    }
    // 走两步
    f.input.keys.add('KeyD'); f.input.down.add('right');
    const x0 = run.player.x;
    await new Promise(r => setTimeout(r, 1200));
    f.input.keys.delete('KeyD'); f.input.down.delete('right');
    // 开地图（副本里应该是虫巢地图）
    f.ui.actions.openMap();
    await new Promise(r => setTimeout(r, 500));
    const title = document.querySelector('#modal-root .modal-head h2')?.textContent || null;
    f.ui.modals.closeAll();
    return { tiles: counts, worldWall: wall, worldVoid: voidT, worldOther: other,
             moved: Math.round(run.player.x - x0), mapTitle: title,
             props: w.props.size, nests: w.nests.length, pois: w.pois.length };
  })()`, 400);

  // Boss 房门口
  await s('bossRoom', `(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    const d = run.dungeon;
    run.player.x = d.boss.x - 60; run.player.y = d.boss.y;
    run.player.hp = run.player.hpMax;
    await new Promise(r => setTimeout(r, 2500));
    return { bossSpawned: !!run.enemies.find(e => e.boss), enemies: run.enemies.length,
             hp: Math.round(run.player.hp) };
  })()`, 400);

  // 撤退
  await s('exit', `(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    run.player.x = run.dungeon.entry.x; run.player.y = run.dungeon.entry.y;
    await new Promise(r => setTimeout(r, 300));
    f.input.keys.add('KeyF'); f.input.down.add('vehicle');
    f.input.justPressed.add('vehicle');
    await new Promise(r => setTimeout(r, 1500));
    f.input.keys.delete('KeyF'); f.input.down.delete('vehicle');
    return { hasDungeon: !!f.game.run.dungeon, state: f.game.state };
  })()`, 600);

  const errs = await evalIn(`(() => {
    const list = window.__frontierErrors || [];
    return { count: list.length, list: list.slice(-8).map(e => ({ at: e.at, kind: e.kind, msg: e.msg, where: e.where, stack: (e.stack||'').split('\\n').slice(0,3).join(' | ') })) };
  })()`);
  log('[ERRORS]', JSON.stringify(errs.error ? { ERR: errs.error } : errs.value, null, 1));
}
