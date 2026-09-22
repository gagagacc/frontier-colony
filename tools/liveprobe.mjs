/**
 * 实时探针：连到「用 --remote-debugging-port 启动的游戏」上，
 * 收集控制台错误，并能在真实运行的页面里执行代码。
 *
 * 为什么需要它：无头测试跑的是它自己的 BrowserWindow，
 * 玩家在自己那台机器上遇到的错误（比如某个只在「基地被打爆后按 E」才触发的
 * ReferenceError）不在无头用例的路径上，而我又看不到玩家的控制台。
 *
 * 用法：
 *   1) 用调试端口启动游戏：
 *      electron . --remote-debugging-port=9333
 *   2) node tools/liveprobe.mjs            # 只抓错误，10 秒
 *      node tools/liveprobe.mjs --script tools/probe-xxx.js   # 顺便执行一段页面脚本
 */
const PORT = Number(process.env.CDP_PORT || 9333);
const DURATION = Number(process.env.PROBE_MS || 10000);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

const argv = process.argv.slice(2);
const scriptPath = argv.includes('--script') ? argv[argv.indexOf('--script') + 1] : null;

const list = await targets().catch((e) => {
  console.error('连不上调试端口：', e.message);
  process.exit(2);
});
const page = list.find(t => t.type === 'page');
if (!page) { console.error('没有 page 目标'); process.exit(2); }
console.log('[probe] 目标:', page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const errors = [];
const logs = [];

function send(method, params = {}) {
  const msgId = ++id;
  return new Promise((resolve) => {
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}

ws.addEventListener('message', (ev) => {
  let m;
  try { m = JSON.parse(ev.data); } catch { return; }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    const text = d.exception?.description || d.text || '未知异常';
    errors.push(text.split('\n').slice(0, 4).join(' | '));
    console.log('[异常]', text.split('\n')[0], '@', d.url || '', d.lineNumber);
  } else if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map(a => a.value ?? a.description ?? a.type).join(' ');
    logs.push(`[${m.params.type}] ${text}`);
    if (m.params.type === 'error' || m.params.type === 'warning') {
      console.log(`[console:${m.params.type}]`, text);
      if (m.params.type === 'error') errors.push(text);
    }
  } else if (m.method === 'Log.entryAdded') {
    const e = m.params.entry;
    if (e.level === 'error') { errors.push(e.text); console.log('[log:error]', e.text, e.url || ''); }
  }
});

const evalIn = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) {
    const t = r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text;
    return { error: t };
  }
  return { value: r.result?.result?.value };
};

ws.addEventListener('open', async () => {
  await send('Runtime.enable');
  await send('Log.enable');

  if (scriptPath) {
    const { readFileSync } = await import('node:fs');
    const { pathToFileURL } = await import('node:url');
    const mod = await import(pathToFileURL(scriptPath).href);
    const steps = typeof mod.default === 'function' ? mod.default : null;
    if (steps) {
      console.log('[probe] 执行页面脚本:', scriptPath);
      await steps({ evalIn, sleep, log: console.log });
    }
  }

  await sleep(DURATION);
  console.log('\n[probe] 结束 — 错误', errors.length, '条');
  for (const e of errors.slice(0, 20)) console.log('  -', e);
  ws.close();
  process.exit(errors.length ? 1 : 0);
});
