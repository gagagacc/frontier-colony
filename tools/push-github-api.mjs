/**
 * 走 **GitHub API** 把当前提交推上去（git push 连不上 github.com:443 时的备用通道）。
 *
 *   $env:GH_TOKEN = "ghp_xxx"; node tools/push-github-api.mjs [--repo 名字]
 *
 * ## 为什么需要它
 *
 * 这台机器实测：`api.github.com` **通**（仓库都能建），但 `github.com:443`
 * **连不上**（`Failed to connect ... after 21108 ms`）。所以 `git push` 永远失败，
 * 而 REST API 一路畅通 —— 那就用 API 传。
 *
 * ## 做法（Git Data API，不走 git 协议）
 *
 *   1. 对每个文件 `POST /git/blobs`（base64，二进制安全）；
 *   2. `POST /git/trees` 建一棵树，路径 = 仓库里的相对路径；
 *   3. `POST /git/commits` 建提交（带上提交信息与作者）；
 *   4. `POST /repos/:o/:r/git/refs` 建 `refs/heads/main`（已存在则 PATCH 更新）。
 *
 * 好处是**不需要 git 网络**，只用到 api.github.com；代价是每个文件一次请求，
 * 390 个文件大约两三分钟。以后网络通了 `git push` 也能用（remote 已经配好）。
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const REPO = arg('repo', 'frontier-colony');
const BRANCH = 'main';
if (!TOKEN) { console.error('❌ 没有 GH_TOKEN'); process.exit(2); }

const gh = async (path, init = {}) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://api.github.com' + path, {
        ...init,
        headers: {
          Authorization: 'Bearer ' + TOKEN,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'frontier-colony-api-push',
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
      if (res.status >= 500 && attempt < 2) { await new Promise(r => setTimeout(r, 800 * (attempt + 1))); continue; }
      return { ok: res.ok, status: res.status, json, text };
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }
};

// ---------- 取身份与本地提交信息 ----------
const me = await gh('/user');
if (!me.ok) { console.error('❌ token 无效：' + (me.json?.message || me.status)); process.exit(4); }
const owner = me.json.login;
const git = (a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const files = git(['ls-files']).split('\n').filter(Boolean);
const subject = git(['log', '-1', '--pretty=%s']);
const message = git(['log', '-1', '--pretty=%B']);
const authorName = git(['log', '-1', '--pretty=%an']);
const authorEmail = git(['log', '-1', '--pretty=%ae']);
console.log(`▶ ${owner}/${REPO} · ${files.length} 个文件 · 提交「${subject}」`);

// ---------- ⓪ 空仓库要先「打开」 ----------
//
// GitHub 的 Git Data API（/git/blobs）在**完全没有提交**的仓库上会返回
// 409 "Git Repository is empty" —— 因为它连一个 ref 都没有，blob 无处可挂。
// 所以先用 Contents API 落一个文件（它会自动建出 main 分支与首个提交），
// 之后 blob / tree / commit 就都能用了。
{
  const head = await gh(`/repos/${owner}/${REPO}/git/ref/heads/${BRANCH}`);
  if (!head.ok) {
    console.log('▶ 空仓库：先用 Contents API 建一个初始提交…');
    const boot = await gh(`/repos/${owner}/${REPO}/contents/.gitignore`, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'chore: 初始化仓库',
        content: Buffer.from('# 占位，真正的 .gitignore 在下一个提交里覆盖\n', 'utf8').toString('base64'),
      }),
    });
    if (!boot.ok) {
      console.error('❌ 初始化失败（HTTP ' + boot.status + '）：' + (boot.json?.message || boot.text.slice(0, 140)));
      process.exit(3);
    }
    console.log('   ✅ 初始提交已建立（' + boot.json.commit.sha.slice(0, 7) + '）');
  }
}

// ---------- ① 逐个上传 blob ----------
console.log('\n▶ 上传文件（每 25 个报一次进度）…');
const entries = [];
let done = 0;
let bytes = 0;
for (const f of files) {
  const abs = join(ROOT, f);
  if (!existsSync(abs)) { console.log('   ⚠️ 跳过不存在的文件：' + f); continue; }
  const buf = readFileSync(abs);
  bytes += buf.length;
  const r = await gh(`/repos/${owner}/${REPO}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: buf.toString('base64'), encoding: 'base64' }),
  });
  if (!r.ok) { console.error(`❌ 上传失败 ${f}（HTTP ${r.status}）：${r.json?.message || r.text.slice(0, 120)}`); process.exit(5); }
  entries.push({ path: f.replace(/\\/g, '/'), mode: '100644', type: 'blob', sha: r.json.sha });
  done++;
  if (done % 25 === 0 || done === files.length) console.log(`   ${done}/${files.length}（${(bytes / 1048576).toFixed(1)} MB）`);
}

// ---------- ② 建树 ----------
console.log('\n▶ 建树…');
const tree = await gh(`/repos/${owner}/${REPO}/git/trees`, {
  method: 'POST',
  body: JSON.stringify({ tree: entries }),
});
if (!tree.ok) { console.error('❌ 建树失败：' + (tree.json?.message || tree.status)); process.exit(6); }
console.log('   ✅ tree ' + tree.json.sha.slice(0, 10));

// ---------- ③ 建提交 ----------
console.log('\n▶ 建提交…');
// 如果远端已有 main，就把它当父提交（保留历史，不覆盖）
const cur = await gh(`/repos/${owner}/${REPO}/git/ref/heads/${BRANCH}`);
const parents = cur.ok && cur.json?.object?.sha ? [cur.json.object.sha] : [];
const commit = await gh(`/repos/${owner}/${REPO}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({
    message,
    tree: tree.json.sha,
    parents,
    author: { name: authorName, email: authorEmail, date: new Date().toISOString() },
  }),
});
if (!commit.ok) { console.error('❌ 建提交失败：' + (commit.json?.message || commit.status)); process.exit(7); }
console.log('   ✅ commit ' + commit.json.sha.slice(0, 10) + (parents.length ? '（父提交 ' + parents[0].slice(0, 7) + '）' : '（首个提交）'));

// ---------- ④ 更新 ref ----------
console.log('\n▶ 更新 refs/heads/' + BRANCH + ' …');
const ref = cur.ok
  ? await gh(`/repos/${owner}/${REPO}/git/refs/heads/${BRANCH}`, {
      method: 'PATCH', body: JSON.stringify({ sha: commit.json.sha, force: true }),
    })
  : await gh(`/repos/${owner}/${REPO}/git/refs`, {
      method: 'POST', body: JSON.stringify({ ref: 'refs/heads/' + BRANCH, sha: commit.json.sha }),
    });
if (!ref.ok) { console.error('❌ 更新分支失败：' + (ref.json?.message || ref.status)); process.exit(8); }
console.log('   ✅ ' + BRANCH + ' → ' + commit.json.sha.slice(0, 10));

console.log('\n================ 完成 ================');
console.log('仓库：https://github.com/' + owner + '/' + REPO);
console.log('试玩：https://' + owner.toLowerCase() + '.github.io/' + REPO + '/');
console.log('\n注意：本地 .git 与远端是通过 API 同步的，不是同一次提交历史 ——');
console.log('      网络通了以后第一次 git push 可能需要 --force（或先 git fetch 再看）。');
