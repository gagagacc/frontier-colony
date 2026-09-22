/**
 * 复现 `director.nextInterval()` 的 ReferenceError。
 *
 * 现象：一波怪结束 → 26 秒善后期 → 计时归零时调用 nextInterval()，
 * 而那个方法里 **没有声明 run / base**（其他方法都有 `const run = this.run;`）。
 * 结果就是每波结束 26 秒后必然抛 ReferenceError。
 */
import { RunState } from '../src/systems/runState.js';
import { Director } from '../src/systems/director.js';

const run = new RunState({ seed: 'next-interval-probe', characterId: 'engineer', planetIndex: 0 });
const d = new Director(run);
run.director = d;

// 直接把波次推进到「善后期结束」的那一帧
run.wave.state = 'aftermath';
run.wave.timer = 0.01;

try {
  d.updateWave(0.02);
  console.log('没有报错 —— timer =', run.wave.timer, '（若为 NaN 同样是坏掉）');
} catch (err) {
  console.log('复现成功：', err.constructor.name + ':', err.message);
}
