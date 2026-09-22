/**
 * 清理未使用的 import 绑定。
 *
 * 做法：在「原文」上定位 import 语句范围（用清洗后的文本判断语句边界，
 * 但结论映射回原文行号），只改花括号里的名字列表，模块路径原样保留。
 *
 * 用法：node tools/cleanimports.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DRY = process.argv.includes('--dry');

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (extname(full) === '.js') acc.push(full);
  }
  return acc;
}

/** 把注释/字符串换成空格（保留长度与换行），仅用于判断语句边界 */
function blankNoise(s) {
  let out = '', i = 0, block = false;
  while (i < s.length) {
    const c = s[i], c2 = s[i + 1];
    if (block) { if (c === '*' && c2 === '/') { block = false; out += '  '; i += 2; } else { out += c === '\n' ? '\n' : ' '; i++; } continue; }
    if (c === '/' && c2 === '/') { while (i < s.length && s[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && c2 === '*') { block = true; out += '  '; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += ' '; i++;
      while (i < s.length) {
        if (s[i] === '\\') { out += '  '; i += 2; continue; }
        if (s[i] === q) { out += ' '; i++; break; }
        out += s[i] === '\n' ? '\n' : ' '; i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** 把注释换成空格，但保留字符串内容（用于「这个名字在正文里出现过吗」的最终确认） */
function blankCommentsKeepStrings(s) {
  let out = '', i = 0, block = false;
  while (i < s.length) {
    const c = s[i], c2 = s[i + 1];
    if (block) { if (c === '*' && c2 === '/') { block = false; out += '  '; i += 2; } else { out += c === '\n' ? '\n' : ' '; i++; } continue; }
    if (c === '/' && c2 === '/') { while (i < s.length && s[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && c2 === '*') { block = true; out += '  '; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      while (i < s.length) {
        if (s[i] === '\\') { out += s[i] + (s[i + 1] || ''); i += 2; continue; }
        out += s[i];
        if (s[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

let changedFiles = 0, removedTotal = 0;

for (const file of walk(join(ROOT, 'src'))) {
  const raw = readFileSync(file, 'utf8');
  const rawLines = raw.split('\n');
  const cleanLines = blankNoise(raw).split('\n');

  // 1) 找 import 语句区间。
  //    起始判定用「挖空后」的文本（避免注释里的 import 干扰），
  //    结束判定必须用「原文」—— 因为模块路径是字符串，挖空后就没了结尾引号。
  const stmts = [];
  let start = -1;
  for (let i = 0; i < cleanLines.length; i++) {
    const l = cleanLines[i];
    if (start < 0) {
      if (/^\s*import\b/.test(l) && !/^\s*import\s+['"]/.test(l)) start = i;
      else continue;
    }
    const tRaw = rawLines[i].replace(/\s+$/, '');
    if (/['"]\s*;?$/.test(tRaw) || /;\s*$/.test(tRaw) || /\}\s*$/.test(tRaw) || i - start > 20) {
      stmts.push([start, i]);
      start = -1;
    }
  }
  if (!stmts.length) continue;

  const importLineSet = new Set();
  for (const [a, b] of stmts) for (let k = a; k <= b; k++) importLineSet.add(k);

  // 2) 正文用于判断某个名字有没有被真正「用」到。
  //    必须先把注释与字符串挖空 —— 否则 'NEST_ROSTER is not defined' 这种
  //    出现在提示文案里的名字会被误判成"已使用"（或反过来）。
  //    注意：import 行要「置空」而不是「删除」，否则行号会错位，
  //    导致 importLineSet 里的下标指向错误的行。
  const cleanRaw = blankNoise(raw).split('\n');
  const body = cleanRaw.map((l, i) => (importLineSet.has(i) ? '' : l)).join('\n');
  const isUsed = (name) => new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(body);

  // 最终确认：在「只挖掉注释、保留字符串」的原文里再查一次。
  // 两次都判定为「未使用」才敢删 —— 宁可留一个没用的 import，也不能删掉正在用的。
  const rawNoComments = blankCommentsKeepStrings(raw).split('\n')
    .map((l, i) => (importLineSet.has(i) ? '' : l)).join('\n');
  const isDefinitelyUnused = (name) =>
    !isUsed(name) && !new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(rawNoComments);

  // 调试：--why=名字 时打印该名字在正文里的命中行，方便排查误判
  const whyArg = process.argv.find(a => a.startsWith('--why='));
  if (whyArg) {
    const target = whyArg.slice(6);
    if (raw.includes(target)) {
      const hits = body.split('\n')
        .map((l, i) => [i + 1, l])
        .filter(([, l]) => new RegExp(`(^|[^\\w$.])${target}(?![\\w$])`).test(l));
      console.log(`\n=== ${relative(ROOT, file)}  ${target}: isUsed=${isUsed(target)} 命中 ${hits.length} 行`);
      for (const [ln, l] of hits.slice(0, 5)) console.log(`    L${ln}: ${JSON.stringify(l.slice(0, 100))}`);
      console.log(`    importLines=[${[...importLineSet].join(',')}]`);
      for (const [a, b] of stmts) {
        console.log(`    语句 L${a + 1}..L${b + 1}:`);
        for (let k = a; k <= Math.min(b, a + 6); k++) {
          console.log(`       raw   L${k + 1}: ${JSON.stringify(rawLines[k])}`);
          console.log(`       clean L${k + 1}: ${JSON.stringify(cleanLines[k])}`);
        }
      }
    }
  }

  const edits = [];   // { startLine, endLine, newLines }
  const removedInFile = [];

  for (const [a, b] of stmts) {
    const stmtRaw = rawLines.slice(a, b + 1).join('\n');
    // 用「from '路径'」定位：括号内容必须只包含标识符、逗号与空白，
    // 否则说明定位错了（比如误吞了后面的语句），直接跳过。
    const m = stmtRaw.match(/^([\s\S]*?)\bfrom\b\s*(['"][^'"]+['"])/);
    if (!m) continue;
    const clause = m[1];
    const braceStart = clause.indexOf('{');
    const braceEnd = clause.lastIndexOf('}');
    if (braceStart < 0 || braceEnd < 0 || braceEnd < braceStart) continue;

    const braceBody = clause.slice(braceStart + 1, braceEnd);
    if (!/^[\sA-Za-z0-9_$,\n\r]*$/.test(braceBody)) continue;   // 不是纯粹的标识符列表，跳过

    const parts = braceBody.split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.every(p => /^[A-Za-z_$][\w$]*(\s+as\s+[A-Za-z_$][\w$]*)?$/.test(p))) continue;

    const keep = [];
    for (const part of parts) {
      const asM = part.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
      const local = asM ? asM[1] : part;
      if (isDefinitelyUnused(local)) removedInFile.push(local);
      else keep.push(part);
    }
    if (keep.length === parts.length) continue;

    const before = stmtRaw.slice(0, braceStart);
    const after = stmtRaw.slice(stmtRaw.lastIndexOf('}') + 1);
    let newStmt;
    if (keep.length) {
      const multiline = clause.includes('\n');
      if (multiline) {
        const baseIndent = (rawLines[a].match(/^\s*/) || [''])[0];
        const inner = baseIndent + '  ';
        const rows = [];
        for (let i = 0; i < keep.length; i += 4) rows.push(inner + keep.slice(i, i + 4).join(', ') + ',');
        newStmt = `${before}{\n${rows.join('\n')}\n${baseIndent}}${after}`;
      } else {
        newStmt = `${before}{ ${keep.join(', ')} }${after}`;
      }
    } else {
      // 花括号里全没了：还有默认导入就保留，否则整条删掉
      const head = before.replace(/^\s*import\s*/, '').trim().replace(/,$/, '');
      if (head) newStmt = `${before.replace(/\{\s*$/, '')}${after}`.replace(/,\s*from/, ' from');
      else newStmt = null;
    }
    edits.push({ a, b, newStmt });
  }

  if (!edits.length) continue;

  if (DRY) {
    removedTotal += removedInFile.length;
    console.log(`  ${relative(ROOT, file).replace(/\\/g, '/')}: 可移除 ${removedInFile.join(', ')}`);
    continue;
  }

  // 3) 从后往前应用编辑（保持行号有效）
  const out = rawLines.slice();
  for (const e of edits.slice().sort((x, y) => y.a - x.a)) {
    const count = e.b - e.a + 1;
    if (e.newStmt === null) out.splice(e.a, count);
    else out.splice(e.a, count, ...e.newStmt.split('\n'));
  }
  writeFileSync(file, out.join('\n'), 'utf8');
  changedFiles++;
  removedTotal += removedInFile.length;
}

console.log(DRY
  ? `\n[dry-run] 共可移除 ${removedTotal} 个未使用的导入绑定`
  : `\n已清理 ${changedFiles} 个文件，移除 ${removedTotal} 个未使用的导入绑定`);
