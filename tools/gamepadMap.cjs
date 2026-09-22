/**
 * 手柄按键映射单元测试（Electron 无头，不需要 dev-server）。
 *
 * 给 GamepadManager 接一个可控的假手柄，然后逐个按键验证
 * 「物理按键 → 注入的动作」这一层映射是否完整、是否会漏。
 *
 * 用法：npx electron tools/gamepadMap.cjs
 */
const { app } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

app.disableHardwareAcceleration();

// Input 的构造函数会挂 window 事件；主进程里没有 window，补个桩
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };

const SRC = (p) => pathToFileURL(path.join(__dirname, '..', 'src', p)).href;

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const section = (t) => console.log(`\n=== ${t} ===`);

app.whenReady().then(async () => {
  // 这一层只测「按键 → 动作」的映射，不碰 DOM/渲染，所以不给窗口
  await import(SRC('core/gamepad.js'))
    .then(async (mod) => {
      const { GamepadManager } = mod;
      const { Input } = await import(SRC('core/input.js'));

      // 造一个不挂真实事件的 Input
      const canvasStub = {
        addEventListener() {}, removeEventListener() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
        setPointerCapture() {}, releasePointerCapture() {},
      };
      const input = new Input(canvasStub);
      input._bind = () => {};

      const gp = new GamepadManager(input);

      // 假手柄状态
      const state = {
        axes: [0, 0, 0, 0],
        buttons: new Array(17).fill(0).map(() => ({ pressed: false, value: 0 })),
        enabled: true,
      };
      const makePad = () => ({
        id: 'UnitTest Pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard',
        axes: state.axes.slice(),
        buttons: state.buttons.map(b => ({ pressed: b.pressed, value: b.value, touched: b.pressed })),
        vibrationActuator: { playEffect() { return Promise.resolve('complete'); } },
      });
      gp._read = () => {
        if (!state.enabled) { gp.pad = null; gp.connected = false; return null; }
        const pad = makePad();
        gp.pad = pad; gp.index = 0; gp.name = pad.id; gp.connected = true;
        return pad;
      };

      const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
      const press = (i, v) => { state.buttons[i].pressed = true; state.buttons[i].value = (v === undefined ? 1 : v); };
      const release = (i) => { state.buttons[i].pressed = false; state.buttons[i].value = 0; };
      const releaseAll = () => state.buttons.forEach((b) => { b.pressed = false; b.value = 0; });

      /** 跑一帧：poll 然后清边沿（和 Game.tick 里的顺序一致） */
      const frame = () => {
        gp.poll({ modalOpen: false, paused: false, game: null, actions: null });
        input.endFrame();
      };
      /**
       * 按一下某个键，返回这一帧注入的动作。
       * 注意要在 endFrame() 之前取边沿 —— 之后再读就被清掉了。
       */
      const tap = (i) => {
        releaseAll();
        frame();                 // 清掉上一帧状态
        press(i);
        gp.poll({ modalOpen: false, paused: false, game: null, actions: null });
        const actions = [...input.justPressed];
        input.endFrame();
        release(i);
        frame();
        return actions;
      };
      section('1. 连接与摇杆');
      frame();
      check('连接被识别', gp.connected === true, gp.name);
      state.axes[0] = 1;
      frame();
      check('左摇杆 → move.x', Math.abs(input.gamepad.move.x - 1) < 0.02, String(input.gamepad.move.x.toFixed(2)));
      state.axes[0] = 0;
      state.axes[3] = 1;
      frame();
      check('右摇杆 → aim.y', Math.abs(input.gamepad.aim.y - 1) < 0.02, String(input.gamepad.aim.y.toFixed(2)));
      state.axes[3] = 0;
      frame();

      section('2. 战斗映射：每个按键都要注入预期动作');
      const expected = [
        [B.START, 'pause', '暂停'],
        [B.Y, 'build', '建造'],
        [B.B, 'dodge', '闪避'],
        [B.LT, 'reload', '装填'],
        [B.L3, 'swapWeapon', '切换武器'],
        [B.R3, 'takeover', '接管炮塔'],
        [B.RIGHT, 'nextWeapon', '下一把武器'],
        [B.LEFT, 'prevWeapon', '上一把武器'],
      ];
      for (const [btn, action, label] of expected) {
        const got = tap(btn);
        check(`${label} (${action})`, got.includes(action), got.length ? got.join(',') : '（没有注入任何动作）');
      }

      section('3. 按住类按键');
      releaseAll(); frame();
      press(B.A);
      gp.poll({ modalOpen: false, paused: false, game: null, actions: null });
      check('A 按住 → interact', input.isDown('interact'), [...input.down].join(','));
      input.endFrame();
      release(B.A);
      gp.poll({ modalOpen: false, paused: false, game: null, actions: null });
      input.endFrame();
      check('A 松开后 interact 解除', !input.isDown('interact'), [...input.down].join(',') || '(空)');
      press(B.RB);
      gp.poll({ modalOpen: false, paused: false, game: null, actions: null });
      check('RB 按住 → sprint', input.isDown('sprint'), [...input.down].join(','));
      input.endFrame();
      release(B.RB); frame();

      section('4. 扳机 → 开火');
      releaseAll(); frame();
      press(B.RT); frame();
      check('RT 按下 → 鼠标左键按下（开火）', input.mouseIsDown(0) === true);
      release(B.RT); frame();
      check('RT 松开 → 鼠标左键松开', input.mouseIsDown(0) === false);

      section('5. 编辑模式（放置中）行为');
      releaseAll(); frame();
      // 放置模式下 RT/A 确认、B 取消；这里只验证 B 被注入（取消由上层处理）
      const inPlace = [];
      gp.poll({ modalOpen: false, pendingPlacement: { kind: 'tower', id: 'sentry' }, game: null, actions: null });
      input.endFrame();
      releaseAll(); frame();
      press(B.B);
      gp.poll({ modalOpen: false, pendingPlacement: { kind: 'tower', id: 'sentry' }, game: null, actions: { cancelPlacement() { inPlace.push('cancel'); } } });
      input.endFrame();
      check('放置模式下 B 触发取消放置', inPlace.includes('cancel'), inPlace.join(','));
      release(B.B);
      gp.poll({ modalOpen: false, pendingPlacement: null, game: null, actions: null });
      input.endFrame();

      section('6. 断开与重连');
      state.enabled = false;
      frame();
      check('手柄消失后判定为断开', gp.connected === false);
      state.enabled = true;
      frame();
      check('重新出现能自动识别', gp.connected === true);

      console.log(`\n${'='.repeat(46)}`);
      console.log(`通过 ${pass} · 失败 ${fail}`);
      if (fail) { console.log('\n失败项：'); for (const f of failures) console.log('  - ' + f); }
      else console.log('手柄映射全部通过 ✅');
      app.exit(fail ? 1 : 0);
    })
    .catch((err) => {
      console.error('导入失败:', err);
      app.exit(2);
    });
});
