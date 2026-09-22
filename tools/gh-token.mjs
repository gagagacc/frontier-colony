/**
 * 读取 GitHub token（给几个推送脚本共用）。
 *
 * 顺序：
 *   1. 环境变量 `GH_TOKEN` / `GITHUB_TOKEN`（临时用、CI 用）
 *   2. `%USERPROFILE%\.dsh\github-token.txt` —— **放在用户目录下，不在仓库里**，
 *      这样每次同步修复都不用重新贴 token，也不会被误提交
 *
 * 为什么单独一个文件：三个推送脚本都要读，逻辑写三遍迟早不一致。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function readToken() {
  const env = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  if (env.trim()) return env.trim();
  const f = join(homedir(), '.dsh', 'github-token.txt');
  if (existsSync(f)) {
    const t = readFileSync(f, 'utf8').trim();
    if (t) return t;
  }
  return '';
}

export function requireToken() {
  const t = readToken();
  if (!t) {
    console.error('❌ 没有 GitHub token。二选一：');
    console.error('   1. 设环境变量：$env:GH_TOKEN = "ghp_xxx"');
    console.error('   2. 存文件：' + join(homedir(), '.dsh', 'github-token.txt'));
    process.exit(2);
  }
  return t;
}
