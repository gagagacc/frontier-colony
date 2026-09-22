/**
 * 把一个**目录**当成 GitHub 仓库推上去（走 REST API，不依赖 git 网络）。
 *
 *   $env:GH_TOKEN = "ghp_xxx"
 *   node tools/push-dir-to-github.mjs --dir godot-repo --repo frontier-colony-godot
 *        [--desc "简介"] [--release v1.0.0 --asset dist-godot]
 *
 * 为什么单独一个脚本：
 *   - `push-github-api.mjs` 推的是「当前 git 仓库里已跟踪的文件」，
 *     而这次要推的是一个**还没成为 git 仓库的目录**（整理出来的独立项目）；
 *   - 顺便支持**建 Release 并上传附件** —— 玩家要的是「下载下来玩」，
 *     exe 走 Releases 比塞进仓库干净得多（仓库也不该背 95 MB 二进制）。
 *
 * 步骤：建仓库 → （空仓库先 Contents API 初始化）→ 逐文件上传 blob →
 *       建树 → 建提交 → 更新 ref → 可选：建 Release + 上传附件。
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireToken } from './gh-token.mjs';
import { createReadStream } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = requireToken();
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const DIR = join(ROOT, arg('dir', ''));
const REPO = arg('repo', '');
const DESC = arg('desc', '');
const BRANCH = 'main';
const RELEASE = arg('release', '');
const ASSET_DIR = arg('asset', '');
if (!TOKEN) { console.error('❌ 需要 GH_TOKEN'); process.exit(2); }
if (!DIR || !existsSync(DIR)) { console.error('❌ --dir 目录不存在：' + DIR); process.exit(2); }
if (!REPO) { console.error('❌ 需要 --repo 仓库名'); process.exit(2); }

const gh = async (path, init = {}, host = 'api.github.com') => {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`https://${host}${path}`, {
        ...init,
        headers: {
          Authorization: 'Bearer ' + TOKEN,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'frontier-push',
          ...(init.headers || {}),
        },
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
      if (res.status >= 500 && i < 2) { await new Promise(r => setTimeout(r, 1000 * (i + 1))); continue; }
      return { ok: res.ok, status: res.status, json, text };
    } catch (e) {
      if (i === 2) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
};

// ---------- 收集文件（跳过重东西） ----------
const SKIP_DIRS = new Set(['.godot', 'node_modules', '.git', 'exe']);
const SKIP_EXT = new Set(['.exe', '.tpz', '.zip', '.log', '.bak', '.pdb']);
const files = [];
(function walk(d) {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(p);
    } else {
      const ext = name.slice(name.lastIndexOf('.'));
      if (SKIP_EXT.has(ext)) continue;
      files.push({ abs: p, rel: relative(DIR, p).replace(/\\/g, '/'), size: st.size });
    }
  }
})(DIR);
const total = files.reduce((a, f) => a + f.size, 0);

// ---------- 身份与仓库 ----------
const me = await gh('/user');
if (!me.ok) { console.error('❌ token 无效：' + (me.json?.message || me.status)); process.exit(4); }
const owner = me.json.login;
console.log(`▶ ${owner}/${REPO} · ${files.length} 个文件 · ${(total / 1048576).toFixed(1)} MB`);

console.log('▶ 创建仓库…');
let created = await gh('/user/repos', {
  method: 'POST',
  body: JSON.stringify({ name: REPO, description: DESC || undefined, private: false, has_issues: true, auto_init: false }),
});
if (created.ok) console.log('   ✅ 已创建');
else if (created.status === 422) console.log('   • 已存在，复用');
else { console.error('❌ 建仓库失败：' + (created.json?.message || created.status)); process.exit(5); }

// ---------- 空仓库要先初始化 ----------
{
  const head = await gh(`/repos/${owner}/${REPO}/git/ref/heads/${BRANCH}`);
  if (!head.ok) {
    console.log('▶ 空仓库：先用 Contents API 建初始提交…');
    const boot = await gh(`/repos/${owner}/${REPO}/contents/.gitignore`, {
      method: 'PUT',
      body: JSON.stringify({ message: 'chore: 初始化仓库', content: Buffer.from('# 占位\n', 'utf8').toString('base64') }),
    });
    if (!boot.ok) { console.error('❌ 初始化失败：' + (boot.json?.message || boot.status)); process.exit(3); }
    console.log('   ✅ 初始提交 ' + boot.json.commit.sha.slice(0, 7));
  }
}

// ---------- 上传 ----------
console.log('\n▶ 上传文件…');
const entries = [];
let done = 0; let bytes = 0;
for (const f of files) {
  const buf = readFileSync(f.abs);
  bytes += buf.length;
  const r = await gh(`/repos/${owner}/${REPO}/git/blobs`, {
    method: 'POST', body: JSON.stringify({ content: buf.toString('base64'), encoding: 'base64' }),
  });
  if (!r.ok) { console.error(`❌ ${f.rel} 上传失败（HTTP ${r.status}）：${r.json?.message || r.text.slice(0, 100)}`); process.exit(5); }
  entries.push({ path: f.rel, mode: '100644', type: 'blob', sha: r.json.sha });
  done++;
  if (done % 50 === 0 || done === files.length) console.log(`   ${done}/${files.length}（${(bytes / 1048576).toFixed(1)} MB）`);
}

console.log('\n▶ 建树 / 提交 / 更新分支…');
const tree = await gh(`/repos/${owner}/${REPO}/git/trees`, { method: 'POST', body: JSON.stringify({ tree: entries }) });
if (!tree.ok) { console.error('❌ 建树失败：' + (tree.json?.message || tree.status)); process.exit(6); }
const cur = await gh(`/repos/${owner}/${REPO}/git/ref/heads/${BRANCH}`);
const parents = cur.ok && cur.json?.object?.sha ? [cur.json.object.sha] : [];
const commit = await gh(`/repos/${owner}/${REPO}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({
    message: 'feat: 开拓者：殖民地 · Godot 4.4 版\n\n从 JS/Canvas 原版完整移植：全部系统 + 全部 UI。\n与 JS 版跨语言黄金对比逐位一致（5964 条断言 + 120 秒长时模拟）。',
    tree: tree.json.sha,
    parents,
    author: { name: 'Colony Frontier Dev', email: 'dev@colonyfrontier.local', date: new Date().toISOString() },
  }),
});
if (!commit.ok) { console.error('❌ 建提交失败：' + (commit.json?.message || commit.status)); process.exit(7); }
const ref = cur.ok
  ? await gh(`/repos/${owner}/${REPO}/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.json.sha, force: true }) })
  : await gh(`/repos/${owner}/${REPO}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: 'refs/heads/' + BRANCH, sha: commit.json.sha }) });
if (!ref.ok) { console.error('❌ 更新分支失败：' + (ref.json?.message || ref.status)); process.exit(8); }
console.log('   ✅ ' + BRANCH + ' → ' + commit.json.sha.slice(0, 10));

// ---------- Release + 附件 ----------
if (RELEASE && ASSET_DIR) {
  const abs = join(ROOT, ASSET_DIR);
  console.log('\n▶ 建 Release ' + RELEASE + ' 并上传附件…');
  let rel = await gh(`/repos/${owner}/${REPO}/releases/tags/${RELEASE}`);
  if (!rel.ok) {
    rel = await gh(`/repos/${owner}/${REPO}/releases`, {
      method: 'POST',
      body: JSON.stringify({
        tag_name: RELEASE,
        target_commitish: BRANCH,
        name: '开拓者：殖民地 · Godot 版 ' + RELEASE,
        body: [
          '解压后双击 `开拓者-殖民地.exe` 即可玩（绿色版，无需安装、无需 Godot）。',
          '',
          '- 自带中文字体与全部素材，离线可玩',
          '- 存档在 `%APPDATA%\\Godot\\app_userdata\\` 下',
        ].join('\n'),
        draft: false,
        prerelease: false,
      }),
    });
  }
  if (!rel.ok) { console.error('⚠️ Release 建失败：' + (rel.json?.message || rel.status)); }
  else {
    console.log('   ✅ Release ' + RELEASE);
    for (const name of readdirSync(abs)) {
      const p = join(abs, name);
      if (!statSync(p).isFile()) continue;
      const up = await fetch(`https://uploads.github.com/repos/${owner}/${REPO}/releases/${rel.json.id}/assets?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + TOKEN,
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(statSync(p).size),
          'User-Agent': 'frontier-push',
        },
        body: createReadStream(p),
        duplex: 'half',
      });
      const j = await up.json().catch(() => null);
      if (up.ok) console.log(`   ✅ 附件 ${name}（${(statSync(p).size / 1048576).toFixed(1)} MB）`);
      else console.error(`   ❌ 附件 ${name} 失败（HTTP ${up.status}）：${j?.message || ''}`);
    }
  }
}

console.log('\n================ 完成 ================');
console.log('仓库：https://github.com/' + owner + '/' + REPO);
if (RELEASE) console.log('下载：https://github.com/' + owner + '/' + REPO + '/releases/tag/' + RELEASE);
