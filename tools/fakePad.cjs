/**
 * 假手柄脚本 —— 作为字符串注入到页面上下文里执行。
 *
 * 为什么需要它：Electron 的 contextIsolation 下 preload 有自己的 navigator，
 * 改它影响不到页面；而 Chromium 的 Navigator.prototype.getGamepads 是只读的，
 * 直接赋值会静默失败。所以测试改为直接接管 GamepadManager 的三个硬件读取方法。
 *
 * 单独放一个文件是为了避免把 JS 代码塞进模板字符串带来的转义问题。
 * 用 CommonJS 是因为 tools/gamepad.cjs 是 CJS（Electron 主进程默认）。
 */

const FAKE_PAD_SCRIPT = String.raw`
(() => {
  const gp = window.__frontier && window.__frontier.gamepad;
  if (!gp) return 'NO_GAMEPAD_MANAGER';
  if (gp.__fakeInstalled) return 'ALREADY';
  gp.__fakeInstalled = true;

  const BUTTONS = 17;
  const state = {
    axes: [0, 0, 0, 0],
    buttons: new Array(BUTTONS).fill(0).map(() => ({ pressed: false, value: 0, touched: false })),
    rumbleLog: [],
    enabled: true,
  };

  const makePad = () => ({
    id: 'Fake Pad (STANDARD GAMEPAD Vendor: 045e Product: 02fd)',
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: performance.now(),
    axes: state.axes.slice(),
    buttons: state.buttons.map(b => ({ pressed: b.pressed, value: b.value, touched: b.touched })),
    vibrationActuator: {
      playEffect(type, opts) {
        state.rumbleLog.push({ type, ...opts, at: Date.now() });
        return Promise.resolve('complete');
      },
      reset() { return Promise.resolve('complete'); },
    },
  });

  // GamepadManager 唯一的硬件入口就是这三个方法，接管它们即可。
  // 注意：原实现会把找到的手柄写回 this.pad / this.index / this.name，
  // 我们替换掉整个方法，就必须自己把这些状态同步好，否则 connected 永远是 false。
  gp._read = () => {
    if (!state.enabled) {
      gp.pad = null;
      gp.connected = false;
      gp.index = -1;
      gp.name = '';
      return null;
    }
    const pad = makePad();
    gp.pad = pad;
    gp.index = pad.index;
    gp.name = pad.id;
    gp.connected = true;
    return pad;
  };
  gp._buttonDown = (pad, i) => {
    const b = pad.buttons[i];
    return !!(b && (b.pressed || b.value > 0.5));
  };
  gp._triggerValue = (pad, i) => {
    const b = pad.buttons[i];
    return b ? (b.value != null ? b.value : (b.pressed ? 1 : 0)) : 0;
  };

  window.__fakePad = {
    BTN: { A:0, B:1, X:2, Y:3, LB:4, RB:5, LT:6, RT:7, BACK:8, START:9, L3:10, R3:11, UP:12, DOWN:13, LEFT:14, RIGHT:15 },
    setAxis(i, v) { state.axes[i] = v; },
    press(i, v) { const b = state.buttons[i]; b.pressed = true; b.value = (v === undefined ? 1 : v); b.touched = true; },
    release(i) { const b = state.buttons[i]; b.pressed = false; b.value = 0; b.touched = false; },
    releaseAll() {
      for (const b of state.buttons) { b.pressed = false; b.value = 0; b.touched = false; }
      state.axes = [0, 0, 0, 0];
    },
    disconnect() { state.enabled = false; },
    connect() { state.enabled = true; },
    /** 调试用：读一下当前轴值，确认 setAxis 有没有生效 */
    readAxes() { return state.axes.slice(); },
    readButtons() { return state.buttons.map(b => b.value); },
    rumbles() { return state.rumbleLog.length; },
    lastRumble() { return state.rumbleLog[state.rumbleLog.length - 1] || null; },
  };
  return 'OK';
})()
`;

module.exports = { FAKE_PAD_SCRIPT };
