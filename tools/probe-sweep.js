/**
 * 探针脚本：把玩家会做的事尽量跑一遍，逼出运行时错误。
 * 覆盖：每个面板的每个页签与每个按钮、放置模式、E/F/数字键/空格/冲刺、
 *       怪潮、载具、副本、设置改键、存档。
 */
export default async function run({ evalIn, sleep, log }) {
  const step = async (name, expr) => {
    const r = await evalIn(expr);
    const v = r.error ? { ERR: r.error.split('\n')[0] } : r.value;
    log(`[${name}]`, JSON.stringify(v));
    await sleep(180);
    return v;
  };

  // 开局
  await step('mainmenu', `(() => {
    const b = [...document.querySelectorAll('#mainmenu .btn')].find(x => x.textContent.includes('开始新开荒'));
    b?.click(); return { clicked: !!b };
  })()`);
  await sleep(500);
  await step('charselect', `(() => {
    document.querySelectorAll('.char-card')[0]?.click();
    const b = [...document.querySelectorAll('button')].find(x => /确定|选择降落点/.test(x.textContent));
    b?.click(); return { ok: true };
  })()`);
  await sleep(500);
  await step('landing', `(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('降落'));
    b?.click(); return { ok: true };
  })()`);
  await sleep(1200);

  await step('playing', `(() => {
    const f = window.__frontier;
    return { state: f.game.state, run: !!f.game.run, char: f.game.run?.characterId };
  })()`);

  // 给足资源，方便把面板里的按钮都点一遍
  await step('resources', `(() => {
    const run = window.__frontier.game.run;
    for (const k of ['gold', 'metal', 'crystal', 'parts', 'tech', 'research', 'fiber', 'wood', 'food', 'sulfur', 'coolant', 'dna', 'biomass', 'chitin', 'fuel', 'water', 'spore']) run.resources[k] = 99999;
    run.resources.beaconCore = 20;
    run.population = 60;
    for (const id of run.unlockedTech.size ? [] : ['t_turretSlot', 't_habitat', 't_vehicle0', 't_mine1']) run.unlockedTech.add(id);
    run.recomputeStats();
    const w = run.loot.rollEquipment({ bonus: 2, tier: 3 });
    if (w) run.loot.addItemToInventory(w);
    const e2 = run.loot.rollEquipment({ bonus: 2, tier: 3 });
    if (e2) run.loot.addItemToInventory(e2);
    return { tech: run.unlockedTech.size, weapons: run.player.weapons.length, bag: run.player.inventory.length };
  })()`);

  const panels = ['openBuild', 'openTown', 'openTech', 'openInventory', 'openMap', 'openPlanets', 'openExperiments', 'openSaves', 'openPause'];
  for (const p of panels) {
    await step(`panel:${p}`, `(() => {
      const f = window.__frontier;
      f.game.run.pendingChoices = 2;
      try { f.ui.actions.${p}(); } catch (e) { return { ERR: e.message }; }
      return { title: document.querySelector('#modal-root .modal-head h2')?.textContent || null,
               buttons: document.querySelectorAll('#modal-root button').length };
    })()`);
    // 逐个点按钮（跳过关闭 / 返回主菜单这类会把游戏关掉的）
    await step(`click:${p}`, `(() => {
      const btns = [...document.querySelectorAll('#modal-root button')]
        .filter(b => !/关闭|返回主菜单|退出|删除|清空|降落|确定前往|开拓下一颗/.test(b.textContent));
      let clicked = 0;
      for (const b of btns.slice(0, 14)) {
        try { b.click(); clicked++; } catch (e) { return { ERR: e.message, at: b.textContent }; }
      }
      return { clicked, title: document.querySelector('#modal-root .modal-head h2')?.textContent || null };
    })()`);
    // 点完之后可能进了放置模式，按 Esc/B 收尾
    await step(`cleanup:${p}`, `(() => {
      const f = window.__frontier;
      try { f.ui.actions.cancelPlacement?.(); } catch (e) { return { ERR: e.message }; }
      try { f.ui.modals.closeAll(); } catch (e) { return { ERR: e.message }; }
      f.game.paused = false;
      return { paused: f.game.paused, placing: !!f.ui.actions.pendingPlacement };
    })()`);
  }

  // 设置面板的四个页签
  await step('settings:tabs', `(() => {
    const f = window.__frontier;
    f.ui.openSettings();
    const names = ['按键绑定', '操作说明', '显示', '游戏性'];
    const out = [];
    for (const n of names) {
      const b = [...document.querySelectorAll('#modal-root button')].find(x => x.textContent.includes(n));
      if (b) { b.click(); out.push(n); }
    }
    return { tabs: out, title: document.querySelector('#modal-root .modal-head h2')?.textContent };
  })()`);
  await step('settings:close', `(() => { window.__frontier.ui.modals.closeAll(); window.__frontier.game.paused = false; return { ok: true }; })()`);

  // 键盘：数字键 1-8、E、F、空格、G/T/B/M/V/Tab
  await step('keys', `(async () => {
    const f = window.__frontier;
    const send = (code, key) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
      setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true })), 90);
    };
    const seq = ['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','KeyE','KeyF','Space','ShiftLeft','KeyX','KeyR','KeyC','KeyQ','KeyZ','KeyM','KeyT','KeyB','KeyG','KeyV','Tab','Escape'];
    for (const c of seq) { send(c, c); await new Promise(r => setTimeout(r, 130)); }
    f.ui.modals.closeAll?.(); f.game.paused = false;
    return { done: seq.length, state: f.game.state };
  })()`);

  // 基地被打爆 → 按住 E 重建
  await step('ruin+E', `(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    run.base.hp = 0; run.base.destroyed = true; run.base.repairProgress = 0;
    run.player.x = run.base.x + 30; run.player.y = run.base.y + 30;
    f.input.keys.add('KeyE'); f.input.down.add('interact');
    await new Promise(r => setTimeout(r, 2500));
    f.input.keys.delete('KeyE'); f.input.down.delete('interact');
    return { progress: +run.base.repairProgress.toFixed(2), destroyed: run.base.destroyed };
  })()`);

  // 打一座塔残 → 按住 E 修
  await step('tower+E', `(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    run.unlockedTech.add('t_turretSlot'); run.recomputeStats();
    run.resources.gold = 99999; run.resources.metal = 99999;
    const t = run.towerSystem.placeTower('sentry', run.base.x + 140, run.base.y + 60, { instant: true });
    if (!t) return { ok: false, why: 'no tower' };
    t.hp = (t.maxHp || t.def.hp) * 0.3;
    const before = t.hp;
    run.player.x = t.x + 20; run.player.y = t.y;
    f.input.keys.add('KeyE'); f.input.down.add('interact');
    await new Promise(r => setTimeout(r, 2000));
    f.input.keys.delete('KeyE'); f.input.down.delete('interact');
    return { gain: Math.round(t.hp - before), repairTarget: !!run.playerSystem.repairTarget };
  })()`);

  // 怪潮
  await step('wave', `(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    run.beacon.online = true; run.beacon.fuel = run.beacon.fuelMax;
    run.waveTimeout = 8;
    run.director.forceWave();
    await new Promise(r => setTimeout(r, 4000));
    return { state: run.wave.state, number: run.wave.number, enemies: run.enemies.length };
  })()`);

  // 载具 + 副本
  await step('vehicle', `(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    run.unlockedTech.add('t_vehicle0'); run.recomputeStats();
    const ok = run.playerSystem.enterVehicle();
    await new Promise(r => setTimeout(r, 400));
    const moving = { x: run.vehicle.x, y: run.vehicle.y };
    f.input.keys.add('KeyW'); f.input.down.add('up');
    await new Promise(r => setTimeout(r, 700));
    f.input.keys.delete('KeyW'); f.input.down.delete('up');
    const moved = Math.round(Math.hypot(run.vehicle.x - moving.x, run.vehicle.y - moving.y));
    run.playerSystem.exitVehicle?.();
    return { entered: !!ok, moved };
  })()`);

  await step('dungeon', `(async () => {
    const f = window.__frontier;
    const run = f.game.run;
    const nest = run.world.nests.find(n => !n.destroyed);
    if (!nest) return { ok: false };
    run.player.x = nest.x + nest.r + 40; run.player.y = nest.y;
    const entered = run.playerSystem.enterNest(run, nest);
    await new Promise(r => setTimeout(r, 800));
    const d = run.dungeon;
    // 副本里走两步、开地图、再撤退
    f.input.keys.add('KeyD'); f.input.down.add('right');
    await new Promise(r => setTimeout(r, 600));
    f.input.keys.delete('KeyD'); f.input.down.delete('right');
    f.ui.actions.openMap();
    await new Promise(r => setTimeout(r, 400));
    f.ui.modals.closeAll();
    const exited = run.playerSystem.exitDungeon?.();
    await new Promise(r => setTimeout(r, 600));
    return { entered: !!entered, tier: d?.tier, exited: !!exited, nested: !!run.dungeon };
  })()`);

  await step('final', `(() => {
    const f = window.__frontier;
    return { state: f.game.state, level: f.game.run?.player?.level, hp: Math.round(f.game.run?.player?.hp) };
  })()`);
}
