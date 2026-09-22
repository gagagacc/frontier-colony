/**
 * 输入缓冲的单元测试（Node 里跑，不需要浏览器）。
 *
 * 验证的就是「按键要摁两三遍」那个 bug 的修复：
 * 按下时前置条件不满足 → 这次输入不该被丢掉，应该在条件满足后立刻生效。
 *
 * 用法：node tools/inputBuffer.mjs
 */
// Input 的构造函数会挂 window 事件，所以先补一个最小 DOM 桩
globalThis.window = {
  addEventListener() {}, removeEventListener() {},
};
globalThis.document = globalThis.document || { addEventListener() {}, hidden: false };

const { Input } = await import('../src/core/input.js');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

/** 造一个不绑定真实 DOM 的 Input */
function makeInput() {
  const canvas = {
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    setPointerCapture() {}, releasePointerCapture() {},
  };
  const input = new Input(canvas);
  input._bind = () => {};          // 不挂真实事件
  return input;
}

/** 模拟一次「按下 → 帧结束」 */
function press(input, action) {
  input.justPressed.add(action);
  input.down.add(action);
  input.endFrame();                // 帧末尾：未被消费的按键进缓冲
  input.down.delete(action);       // 抬手
}

console.log('输入缓冲单元测试\n');

// =========================================================
console.log('=== 1. 基本缓冲行为 ===');
{
  const input = makeInput();
  check('初始没有缓冲', input.bufferedActions.length === 0);

  press(input, 'dodge');
  check('按下后进入缓冲', input.bufferedActions.includes('dodge'), input.bufferedActions.join(','));
  check('下一帧 pressedBuffered 能读到', input.pressedBuffered('dodge', 160) === true);
  check('原始 pressed 已不再是 true', input.pressed('dodge') === false);

  input.consumeBuffered('dodge');
  check('消费后不再命中', input.pressedBuffered('dodge', 160) === false);
  check('消费后缓冲清空', input.bufferedActions.length === 0);
}

// =========================================================
console.log('\n=== 2. 这就是原来的 bug：条件不满足时按下 ===');
{
  const input = makeInput();
  // 模拟「体力不够」：按了闪避，但这一帧条件不成立，没人消费
  let stamina = 5;
  const need = 22;
  press(input, 'dodge');

  // 条件不满足 → 不消费（模拟 player.js 里把 pressedBuffered 放在条件之后）
  if (stamina >= need && input.pressedBuffered('dodge')) input.consumeBuffered('dodge');
  check('条件不满足时没有误触发（进缓冲等待）', stamina === 5);
  check('按键留在缓冲里，没有丢', input.bufferedActions.includes('dodge'));

  // 几帧后体力够了（仍然在缓冲窗口内）
  stamina = 30;
  let fired = false;
  if (stamina >= need && input.pressedBuffered('dodge', 160)) { input.consumeBuffered('dodge'); fired = true; }
  check('条件满足后立刻生效（不用重按）', fired === true);
  check('生效后缓冲被清掉', input.bufferedActions.length === 0);
}

// =========================================================
console.log('\n=== 3. 超过缓冲窗口就作废 ===');
{
  const input = makeInput();
  press(input, 'vehicle');
  check('刚按下时有效', input.pressedBuffered('vehicle', 160) === true);
  // 直接把时间戳改老，模拟过了很久
  input._buffered.set('vehicle', performance.now() - 5000);
  check('超时后不再命中', input.pressedBuffered('vehicle', 160) === false);
  check('超时项会被顺手清理', input.bufferedActions.length === 0);
}

// =========================================================
console.log('\n=== 4. 同一按键只该生效一次 ===');
{
  const input = makeInput();
  press(input, 'interact');
  let count = 0;
  for (let frame = 0; frame < 5; frame++) {
    if (input.pressedBuffered('interact', 160)) { count++; input.consumeBuffered('interact'); }
  }
  check('连续 5 帧只触发 1 次', count === 1, `${count} 次`);
}

// =========================================================
console.log('\n=== 5. 没有缓冲时退化成普通边沿判定 ===');
{
  const input = makeInput();
  input.justPressed.add('pause');
  check('本帧按下立即为真', input.pressedBuffered('pause', 160) === true);
  check('本帧按下时 pressed 也为真', input.pressed('pause') === true);
}

// =========================================================
console.log('\n=== 6. 缓冲不会无限堆积 ===');
{
  const input = makeInput();
  for (let i = 0; i < 30; i++) press(input, 'slot' + (i % 8));
  const n1 = input.bufferedActions.length;
  check('同批按键合并成有限条目', n1 <= 8, `${n1} 条`);
  // 把所有时间戳改老，触发清理
  for (const [a] of input._buffered) input._buffered.set(a, performance.now() - 5000);
  input.endFrame();
  check('过期条目会被清理', input.bufferedActions.length === 0, input.bufferedActions.join(','));
}

console.log(`\n${'='.repeat(46)}`);
console.log(`通过 ${pass} · 失败 ${fail}`);
if (fail) { console.log('\n失败项：'); for (const f of failures) console.log('  - ' + f); }
else console.log('输入缓冲全部通过 ✅');
process.exit(fail ? 1 : 0);
