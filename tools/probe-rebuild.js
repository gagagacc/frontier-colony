/** 探针：E 重建到底什么情况下没反应（暂停 / 面板关闭方式 / 反馈） */
export default async function run({ evalIn, sleep, log }) {
  const s = async (n, e) => { const r = await evalIn(e); log(`[${n}]`, JSON.stringify(r.error ? { ERR: r.error.split('\n')[0] } : r.value)); await sleep(200); };

  // 先确保在游戏里
  await s('state', `(() => {
    const f = window.__frontier;
    if (f.game.state !== 'playing') {
      const b = [...document.querySelectorAll('#mainmenu .btn')].find(x => x.textContent.includes('开始新开荒'));
      b?.click();
    }
    return { state: f.game.state };
  })()`);
  await sleep(400);
  await s('enter', `(async () => {
    const f = window.__frontier;
    if (f.game.state === 'charSelect') {
      document.querySelectorAll('.char-card')[0]?.click();
      await new Promise(r => setTimeout(r, 200));
      [...document.querySelectorAll('button')].find(x => /确定|选择降落点/.test(x.textContent))?.click();
      await new Promise(r => setTimeout(r, 400));
      [...document.querySelectorAll('button')].find(x => x.textContent.includes('降落'))?.click();
      await new Promise(r => setTimeout(r, 1000));
    }
    return { state: f.game.state };
  })()`);

  // 1) 开着面板时按 E
  await s('openBuildThenE', `(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    run.base.hp = 0; run.base.destroyed = true; run.base.repairProgress = 0;
    run.resources.metal = 9999;
    run.player.x = run.base.x + 30; run.player.y = run.base.y + 30;
    f.ui.actions.openBuild();
    await new Promise(r => setTimeout(r, 300));
    const pausedWithPanel = f.game.paused;
    f.input.down.add('interact'); f.input.keys.add('KeyE');
    await new Promise(r => setTimeout(r, 1200));
    const progressWithPanel = run.base.repairProgress;
    f.input.down.delete('interact'); f.input.keys.delete('KeyE');
    return { pausedWithPanel, progressWithPanel };
  })()`);

  // 2) 用 × 关掉面板之后再按 E
  await s('closeByXThenE', `(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    document.querySelector('#modal-root .modal-close')?.click();
    await new Promise(r => setTimeout(r, 400));
    const pausedAfterClose = f.game.paused;
    run.base.repairProgress = 0;
    f.input.down.add('interact'); f.input.keys.add('KeyE');
    await new Promise(r => setTimeout(r, 1500));
    const progress = run.base.repairProgress;
    f.input.down.delete('interact'); f.input.keys.delete('KeyE');
    return { pausedAfterClose, progress, destroyed: run.base.destroyed };
  })()`);

  // 3) modals.closeAll()（截图/测试用的那种关法）之后再按 E
  await s('closeAllThenE', `(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    f.ui.actions.openBuild();
    await new Promise(r => setTimeout(r, 300));
    f.ui.modals.closeAll();
    await new Promise(r => setTimeout(r, 300));
    const pausedAfterCloseAll = f.game.paused;
    run.base.repairProgress = 0;
    f.input.down.add('interact'); f.input.keys.add('KeyE');
    await new Promise(r => setTimeout(r, 1500));
    const progress = run.base.repairProgress;
    f.input.down.delete('interact'); f.input.keys.delete('KeyE');
    f.ui.modals.closeAll(); f.game.paused = false;
    return { pausedAfterCloseAll, progress };
  })()`);

  // 4) 重建需要多久、有没有可见反馈
  await s('rebuildNumbers', `(() => {
    const f = window.__frontier;
    const run = f.game.run;
    const cfg = f.config.BASE;
    return { rebuildTime: cfg.rebuildTime, repairRate: cfg.repairRate,
             hasProgressField: 'repairProgress' in run.base,
             hudHintNear: document.getElementById('context-hint')?.textContent };
  })()`);
}
