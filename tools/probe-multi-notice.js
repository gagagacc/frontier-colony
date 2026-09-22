/** 探针：启动后 3 秒内看主菜单有没有「多开模式」提示 */
export default async function run({ evalIn, sleep, log }) {
  for (let i = 0; i < 6; i++) {
    const r = await evalIn(`(() => {
      const stack = document.getElementById('notice-stack');
      const text = stack ? stack.textContent : '(no stack)';
      return { text: text.slice(0, 200), count: stack ? stack.children.length : -1 };
    })()`);
    log(`[notice ${i}]`, JSON.stringify(r.value));
    if (/多开模式/.test(r.value?.text || '')) {
      log('[verdict]', '看到多开提示 ✓');
      return;
    }
    await sleep(500);
  }
  log('[verdict]', '没看到多开提示 ✗');
}
