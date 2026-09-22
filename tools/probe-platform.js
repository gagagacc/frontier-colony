/** 探针：真实走一遍「铺基座 → 把塔放到基座上 → 相邻基座再放一座」 */
export default async function run({ evalIn, sleep, log }) {
  const s = async (n, e, wait = 250) => {
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

  const out = await s('platform', `(() => {
    const f = window.__frontier;
    const run = f.game.run;
    const ts = run.towerSystem;
    for (const k of ['gold', 'metal', 'crystal', 'parts']) run.resources[k] = 99999;
    run.unlockedTech.add('t_turretSlot'); run.recomputeStats();
    const bx = run.base.x, by = run.base.y;

    // 1) 空地上连放两座（第二座应该被挪开或放不下）
    const a = ts.placeTower('sentry', bx + 140, by - 140, { instant: true, free: true });
    const b = ts.placeTower('sentry', bx + 180, by - 140, { instant: true, free: true });
    const gapGround = (a && b) ? Math.round(Math.hypot(a.x - b.x, a.y - b.y)) : -1;

    // 2) 铺两块相邻基座，各放一座塔
    const s1 = ts.placeStructure('turretSlot', bx - 200, by + 160, {});
    const s2 = ts.placeStructure('turretSlot', bx - 160, by + 160, {});
    const t1 = s1 ? ts.placeTower('sentry', s1.x, s1.y, { instant: true, free: true }) : null;
    const t2 = s2 ? ts.placeTower('sentry', s2.x, s2.y, { instant: true, free: true }) : null;
    const gapPlatform = (t1 && t2) ? Math.round(Math.hypot(t1.x - t2.x, t1.y - t2.y)) : -1;
    ts.updateTowerLinks();

    return {
      gapGround, gapPlatform,
      slots: run.structures.filter(x => x.type === 'turretSlot').length,
      onPlatform: [!!t1?.onPlatform, !!t2?.onPlatform],
      towers: run.towers.length,
      /** 直接确认「塔能坐在基座那一格上」 */
      towerOnSlotTile: !!(t1 && s1 && Math.hypot(t1.x - s1.x, t1.y - s1.y) < 2),
    };
  })()`, 400);

  log('[verdict]', JSON.stringify({
    空地上的间距: out && out.gapGround,
    基座上的间距: out && out.gapPlatform,
    两座塔都在基座上: out && out.onPlatform,
    塔正好落在基座格上: out && out.towerOnSlotTile,
  }));

  const errs = await evalIn(`(() => ({ count: (window.__frontierErrors || []).length }))()`);
  log('[ERRORS]', JSON.stringify(errs.value));
}
