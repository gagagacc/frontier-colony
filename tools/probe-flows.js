/** 探针：还没覆盖到的路径 —— 改键、游戏结束、存档/读档、开拓下一颗星球 */
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
  })()`, 700);

  // 1) 改键：进入等待按键状态，模拟按下一个键，再恢复默认
  await s('rebind', `(async () => {
    const f = window.__frontier;
    f.ui.openSettings('keys');
    await new Promise(r => setTimeout(r, 300));
    const btn = [...document.querySelectorAll('#modal-root button')].find(b => /申请|改键|W|\\//.test(b.textContent));
    btn?.click();
    await new Promise(r => setTimeout(r, 200));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    const bound = f.settings.keysFor('up').includes('KeyJ');
    f.settings.resetAction('up');
    f.ui.modals.closeAll();
    f.game.paused = false;
    return { bound, after: f.settings.keysFor('up').join(',') };
  })()`, 400);

  // 2) 存档 / 读档
  await s('save-load', `(async () => {
    const f = window.__frontier;
    const ok = f.game.save('probe');
    await new Promise(r => setTimeout(r, 400));
    const loaded = f.game.load('probe');
    await new Promise(r => setTimeout(r, 600));
    return { ok, loaded, state: f.game.state, hasRun: !!f.game.run };
  })()`, 500);

  // 3) 游戏结束
  await s('gameover', `(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    run.playerSystem.die('probe');
    await new Promise(r => setTimeout(r, 800));
    const els = document.querySelectorAll('#modal-root button').length;
    f.ui.modals.closeAll();
    return { state: f.game.state, buttons: els };
  })()`, 400);

  // 4) 开拓下一颗星球（跨星流程：新建 RunState + 重置塔科技）
  await s('travel', `(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    if (!run) return { skip: true };
    run.unlockedTech.add('t_deepSpace');
    run.recomputeStats();
    const ok = f.ui.actions.travelToNextPlanet();
    await new Promise(r => setTimeout(r, 2500));
    return { ok, planet: f.game.run?.planetIndex, state: f.game.state, towers: f.game.run?.towers.length };
  })()`, 800);

  const errs = await evalIn(`(() => {
    const list = window.__frontierErrors || [];
    return { count: list.length, list: list.slice(-8).map(e => ({ at: e.at, kind: e.kind, msg: e.msg, where: e.where, stack: (e.stack||'').split('\\n').slice(0,3).join(' | ') })) };
  })()`);
  log('[ERRORS]', JSON.stringify(errs.error ? { ERR: errs.error } : errs.value, null, 1));
}
