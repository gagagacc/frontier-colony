/**
 * 探针脚本：复现玩家报的两件事
 *   1) 「基地我按 E 重建没反应」
 *   2) 屏幕右上角那条「运行出错」到底是什么
 *
 * 做法：真的进一局、把基地打爆、然后按住 E 若干秒，看耐久有没有涨、
 * 以及过程中有没有异常。
 */
export default async function run({ evalIn, sleep, log }) {
  const boot = await evalIn(`(() => {
    const f = window.__frontier;
    if (!f) return { ok: false, why: 'no __frontier' };
    const btns = [...document.querySelectorAll('#mainmenu .btn')];
    const b = btns.find(x => x.textContent.includes('开始新开荒'));
    b && b.click();
    return { ok: true, state: f.game.state };
  })()`);
  log('[step1] 打开角色选择', JSON.stringify(boot.value ?? boot.error));

  await sleep(600);
  const entered = await evalIn(`(async () => {
    const f = window.__frontier;
    const cards = [...document.querySelectorAll('.char-card')];
    cards[0]?.click();
    await new Promise(r => setTimeout(r, 300));
    const btn = [...document.querySelectorAll('button')].find(b => /确定|选择降落点|开始/.test(b.textContent));
    btn?.click();
    await new Promise(r => setTimeout(r, 400));
    const land = [...document.querySelectorAll('#modal-root button, .menu-screen button')]
      .find(b => b.textContent.includes('降落'));
    land?.click();
    await new Promise(r => setTimeout(r, 900));
    return { state: f.game.state, hasRun: !!f.game.run, char: f.game.run?.characterId };
  })()`);
  log('[step2] 进游戏', JSON.stringify(entered.value ?? entered.error));

  const ruined = await evalIn(`(() => {
    const run = window.__frontier.game.run;
    if (!run) return { ok: false };
    run.base.maxHp = run.base.maxHp || 2600;
    run.base.hp = 0;
    run.base.destroyed = true;
    run.base.repairProgress = 0;
    run.resources.metal = 9999;
    return { ok: true, destroyed: run.base.destroyed, repairProgress: run.base.repairProgress,
             baseHp: run.base.hp, where: Math.round(Math.hypot(run.player.x - run.base.x, run.player.y - run.base.y)) };
  })()`);
  log('[step3] 打爆基地', JSON.stringify(ruined.value ?? ruined.error));

  // 把玩家挪到基地旁边，然后真的按住 E（走玩家那条 updateHarvest → baseInteract 路径）
  const holding = await evalIn(`(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    const p = run.player;
    p.x = run.base.x + 30; p.y = run.base.y + 30;
    f.input.keys.add('KeyE');
    f.input.down.add('interact');
    const before = run.base.repairProgress;
    await new Promise(r => setTimeout(r, 2000));
    const after = run.base.repairProgress;
    f.input.keys.delete('KeyE');
    f.input.down.delete('interact');
    return { before, after, gain: +(after - before).toFixed(3), metal: Math.round(run.resources.metal),
             destroyed: run.base.destroyed };
  })()`);
  log('[step4] 按住 E 两秒', JSON.stringify(holding.value ?? holding.error));

  const manual = await evalIn(`(() => {
    const run = window.__frontier.game.run;
    run.base.repairProgress = 0;
    const before = run.base.repairProgress;
    for (let i = 0; i < 60; i++) run.repairAtBase(run.base, 1 / 60);
    return { before, after: +run.base.repairProgress.toFixed(3) };
  })()`);
  log('[step5] 直接调 repairAtBase 60 帧', JSON.stringify(manual.value ?? manual.error));
}
