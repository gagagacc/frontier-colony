/** 探针：进副本后逐帧抓画面（用外部截图工具看真实渲染），并打印渲染层缓存状态 */
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
      await new Promise(r => setTimeout(r, 1600));
    }
    return { state: f.game.state };
  })()`, 800);

  // 在**地表**多走一会儿，让渲染层把地表区块缓存起来（复现玩家的路径）
  await s('walk-surface', `(async () => {
    const f = window.__frontier;
    f.input.keys.add('KeyD'); f.input.down.add('right');
    await new Promise(r => setTimeout(r, 2500));
    f.input.keys.delete('KeyD'); f.input.down.delete('right');
    return { x: Math.round(f.game.run.player.x), state: f.game.state };
  })()`, 500);

  // 进副本
  await s('enter-nest', `(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    const nest = run.world.nests.find(n => !n.destroyed);
    run.player.x = nest.x + nest.r + 20; run.player.y = nest.y;
    const ok = run.playerSystem.enterNest(nest);
    await new Promise(r => setTimeout(r, 1500));
    return { ok, hasDungeon: !!f.game.run.dungeon };
  })()`, 1200);

  // 副本里走一段（会触发生成新的区块）
  await s('walk-dungeon', `(async () => {
    const f = window.__frontier;
    f.input.keys.add('KeyD'); f.input.down.add('right');
    await new Promise(r => setTimeout(r, 2500));
    f.input.keys.delete('KeyD'); f.input.down.delete('right');
    const run = f.game.run;
    return { x: Math.round(run.player.x), y: Math.round(run.player.y) };
  })()`, 800);

  // 渲染层缓存与世界状态：这两条能直接指出「画面为什么还是地表」
  await s('render-state', `(() => {
    const f = window.__frontier;
    const run = f.game.run;
    const r = f.renderer;
    const entries = [...(r.chunkCache?.entries?.() || [])].slice(0, 6).map(([k, v]) => ({
      key: k, rev: v.rev, sameWorld: v.world === run.world,
    }));
    return {
      worldRev: run.world.tileRevision || 0,
      cachedCount: r.chunkCache?.size ?? -1,
      cacheHasWorldRef: entries.length ? 'world' in (r.chunkCache.get(entries[0].key) || {}) : null,
      entries,
      bases: run.bases.map(b => ({ x: Math.round(b.x), y: Math.round(b.y), destroyed: !!b.destroyed })),
      player: { x: Math.round(run.player.x), y: Math.round(run.player.y) },
      dungeon: !!run.dungeon,
      minimapRev: f.ui.hud.minimapRev,
    };
  })()`, 600);

  // 打开副本里的 M 地图（截图用）
  await s('open-map', `(() => {
    window.__frontier.ui.actions.openMap();
    return { title: document.querySelector('#modal-root .modal-head h2')?.textContent || null };
  })()`, 900);
}
