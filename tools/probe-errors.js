/** 探针：把当前运行中的游戏里的错误日志捞出来 */
export default async function run({ evalIn, log }) {
  const r = await evalIn(`(() => {
    const errs = window.__frontierErrors || [];
    return {
      count: errs.length,
      list: errs.slice(-10).map(e => ({ at: e.at, kind: e.kind, msg: e.msg, where: e.where, stack: (e.stack || '').split('\\n').slice(0, 3).join(' | ') })),
      state: window.__frontier?.game?.state,
      hasRun: !!window.__frontier?.game?.run,
    };
  })()`);
  log('[errors]', JSON.stringify(r.error ? { ERR: r.error } : r.value, null, 1));
}
