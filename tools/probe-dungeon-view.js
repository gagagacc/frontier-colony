/** 探针：关掉面板并走进巢道，方便外部截图看真实画面 */
export default async function run({ evalIn, sleep, log }) {
  const r = await evalIn(`(() => {
    const f = window.__frontier;
    f.ui.modals.closeAll();
    f.game.paused = false;
    const run = f.game.run;
    if (run?.dungeon) {
      // 站到主通道中间，视野里应该有巢道 + 巢壁
      run.player.x = run.dungeon.entry.x + 420;
      run.player.y = run.dungeon.entry.y;
    }
    return { dungeon: !!run?.dungeon, x: Math.round(run?.player.x || 0), paused: f.game.paused };
  })()`);
  log('[ready]', JSON.stringify(r.value));
  await sleep(1200);
}
