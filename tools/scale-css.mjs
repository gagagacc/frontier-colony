/**
 * 把 style.css 里的固定像素尺寸改写成「跟着窗口缩放」的形式。
 *
 * 为什么要有这个脚本而不是手改：
 *   样式表里有 40 多处 font-size、30 多处 padding，逐个手改既容易漏又容易改错。
 *   这个脚本是幂等的 —— 已经是 u(N) 的不会再被包一层，可以反复运行。
 *
 * 规则（只动「尺寸」类属性，不动位置类）：
 *   font-size / padding* / gap / border-radius / width / height / min-* / max-*
 *   里的 px 数值 -> u(N)，最终展开成 calc(Npx * var(--ui-scale, 1))
 *
 * 位置类（top/left/right/bottom/inset/margin/transform/line-height）保持不动：
 *   它们要么贴着屏幕边缘，要么是刻意对齐的间距，缩放反而会错位。
 *
 * 用法：node tools/scale-css.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'src', 'ui', 'style.css');

const SCALED_PROPS = [
  'font-size', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'gap', 'row-gap', 'column-gap', 'border-radius',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
];

const PROP_RE = new RegExp(`^([ \\t]*)(${SCALED_PROPS.join('|')})(\\s*:\\s*)(.+?)(;?)$`);
const U_RE = /u\((-?\d+(?:\.\d+)?)\)/g;

/** 已经是 u(...) 的跳过；其余把纯 px 数值包进 u() */
function wrapValues(value) {
  if (value.includes('u(')) return value;
  if (!/\d+px/.test(value)) return value;
  return value.replace(/(-?\d+(?:\.\d+)?)px/g, (m, n) => `u(${n})`);
}

function toCalc(text) {
  return text.replace(U_RE, (m, n) => `calc(${n}px * var(--ui-scale, 1))`);
}

const src = readFileSync(FILE, 'utf8');
// 先把已有的 calc(...) 还原成 u(...)，这样脚本可以反复跑
let text = src
  .replace(/calc\((-?\d+(?:\.\d+)?)px \* var\(--ui-scale, 1\)\)/g, (m, n) => `u(${n})`)
  .replace(/:root \{ --ui-scale: 1; \}\r?\n?/g, '');

const lines = text.split(/\r?\n/);
let changed = 0;

const out = lines.map((line) => {
  const m = PROP_RE.exec(line);
  if (!m) return line;
  const [, indent, prop, sep, value, semi] = m;
  if (/^(auto|none|inherit|initial|unset)$/.test(value.trim())) return line;
  const next = wrapValues(value);
  if (next === value) return line;
  changed++;
  return `${indent}${prop}${sep}${next}${semi}`;
});

text = toCalc(out.join('\n'));
text = `:root { --ui-scale: 1; }\n${text}`;

writeFileSync(FILE, text, 'utf8');
console.log(`style.css: 改写了 ${changed} 行尺寸（u(N) -> calc(Npx * var(--ui-scale))）`);
