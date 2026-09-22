/** 探针：确认多开时这一份用的是独立存档目录，并且主菜单弹了提示 */
export default async function run({ evalIn, log }) {
  const r = await evalIn(`(async () => {
    const f = window.__frontier;
    const info = await (window.frontier?.info?.() ?? Promise.resolve(null));
    // 存档：写一个槽位，看落在哪个目录
    const wrote = f.game.save('multi-probe');
    const list = await (window.frontier?.save?.list?.() ?? Promise.resolve([]));
    const notices = [...document.querySelectorAll('#notice-stack, .notice')].map(n => n.textContent).join(' | ');
    return {
      extraInstance: info?.extraInstance,
      shareSaves: info?.shareSaves,
      userData: info?.userData,
      wrote, slots: list.map(s => s.slot).slice(0, 5),
      multiNotice: /多开模式/.test(notices),
      noticeText: notices.slice(0, 200),
    };
  })()`);
  log('[multi]', JSON.stringify(r.error ? { ERR: r.error } : r.value, null, 1));
}
