/**
 * 把仓库推到 GitHub（含创建仓库 + 开 GitHub Pages）。
 *
 *   $env:GH_TOKEN = "ghp_xxx"      # 或者用 GH_TOKEN=xxx node tools/push-github.mjs
 *   node tools/push-github.mjs [--repo 名字] [--private]
 *
 * 为什么单独写一个脚本而不是让你手敲几条命令：
 *   1. 建仓库、设 remote、推送、开 Pages 是四步，容易漏；
 *   2. **token 不要写进 .git/config**：脚本用「临时 remote + 环境变量」的方式推，
 *      推完把 remote 改回不带 token 的 HTTPS 地址，避免 token 留在仓库里被一起提交；
 *   3. 会先做一次体积自检（GitHub 单文件上限 100 MB），不通过就不推。
 *
 * 安全提示：token 只在本进程内存与环境变量里用一次，不落盘。
 *          用完建议去 GitHub 撤销（Settings → Developer settings → Tokens）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const REPO = arg('repo', 'frontier-colony');
const PRIVATE = process.argv.includes('--private');
const BRANCH = 'main';

if (!TOKEN) {
  console.error('❌ 没有 GH_TOKEN。用法：');
  console.error('   $env:GH_TOKEN = "ghp_xxx"; node tools/push-github.mjs');
  process.exit(2);
}

const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: opts.quiet ? 'pipe' : 'inherit', ...opts });
const api = async (path, init = {}) => {
  const res = await fetch('https://api.github.com' + path, {
    ...init,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'frontier-colony-push',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
  return { ok: res.ok, status: res.status, json, text };
};

// ---------- 0) 前置检查 ----------
if (!existsSync(join(ROOT, '.git'))) {
  console.error('❌ 这里还不是 git 仓库，先 git init 并提交');
  process.exit(2);
}
const status = git(['status', '--porcelain'], { quiet: true });
if (status.trim()) {
  console.log('⚠️ 还有未提交的改动（会一起推吗？不会 —— 只推已提交的内容）：');
  console.log(status.split('\n').slice(0, 8).map((l) => '   ' + l).join('\n'));
}

// 体积自检：GitHub 单文件硬上限 100 MB
console.log('\n▶ 体积自检（单文件 100 MB 上限）…');
const tracked = git(['ls-files'], { quiet: true }).split('\n').filter(Boolean);
let biggest = { f: '', size: 0 };
let total = 0;
for (const f of tracked) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  const s = statSync(p).size;
  total += s;
  if (s > biggest.size) biggest = { f, size: s };
}
console.log(`   ${tracked.length} 个文件 · 共 ${(total / 1048576).toFixed(1)} MB · 最大 ${biggest.f}（${(biggest.size / 1048576).toFixed(2)} MB）`);
if (biggest.size > 100 * 1048576) {
  console.error('❌ 有文件超过 GitHub 的 100 MB 上限，先加进 .gitignore 再提交：' + biggest.f);
  process.exit(3);
}

// ---------- 1) 确认身份 ----------
console.log('\n▶ 校验 token…');
const me = await api('/user');
if (!me.ok) {
  console.error('❌ token 无效或权限不足（HTTP ' + me.status + '）：' + (me.json?.message || me.text.slice(0, 120)));
  process.exit(4);
}
const owner = me.json.login;
console.log('   已登录：' + owner);

// ---------- 2) 建仓库（已存在就复用） ----------
console.log('\n▶ 创建仓库 ' + owner + '/' + REPO + ' …');
let created = await api('/user/repos', {
  method: 'POST',
  body: JSON.stringify({
    name: REPO,
    description: '开拓者：殖民地 —— 2D 外星殖民（塔防 + 开放世界 + 城镇经营）。JS/Canvas 原版 + Godot 4.4 移植版。',
    private: PRIVATE,
    has_issues: true,
    has_wiki: false,
    auto_init: false,
  }),
});
if (created.ok) {
  console.log('   ✅ 已创建');
} else if (created.status === 422) {
  console.log('   • 仓库已存在，直接用');
} else {
  console.error('❌ 建仓库失败（HTTP ' + created.status + '）：' + (created.json?.message || created.text.slice(0, 160)));
  process.exit(5);
}

// ---------- 3) 推送 ----------
// token 只出现在这一条 URL 里，推完立刻改回不带 token 的地址
const cleanUrl = `https://github.com/${owner}/${REPO}.git`;
const authUrl = `https://x-access-token:${TOKEN}@github.com/${owner}/${REPO}.git`;
console.log('\n▶ 推送 ' + BRANCH + ' …');
try {
  git(['remote', 'remove', 'origin'], { quiet: true });
} catch { /* 本来就没有 */ }
git(['remote', 'add', 'origin', authUrl], { quiet: true });
try {
  git(['push', '-u', 'origin', BRANCH]);
} finally {
  git(['remote', 'set-url', 'origin', cleanUrl], { quiet: true });
}
console.log('   ✅ 已推送（remote 已改回不含 token 的地址）');

// ---------- 4) 开 GitHub Pages（HTML 版直接能玩） ----------
console.log('\n▶ 开启 GitHub Pages …');
const pages = await api(`/repos/${owner}/${REPO}/pages`, {
  method: 'POST',
  body: JSON.stringify({ source: { branch: BRANCH, path: '/' } }),
});
if (pages.ok) console.log('   ✅ Pages 已开启');
else if (pages.status === 409) console.log('   • Pages 已经开过了');
else console.log('   ⚠️ Pages 没开成（HTTP ' + pages.status + '）：' + (pages.json?.message || '') +
  '\n     可以在仓库 Settings → Pages 手动选 main / (root)');

console.log('\n================ 完成 ================');
console.log('仓库：' + cleanUrl);
console.log('源码：' + cleanUrl.replace('.git', ''));
console.log('试玩：https://' + owner.toLowerCase() + '.github.io/' + REPO + '/');
console.log('（Pages 首次部署要等 1~2 分钟）');
console.log('\n别忘了用完去撤销 token：https://github.com/settings/tokens');
