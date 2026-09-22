/**
 * 把 `src/data/*.js` 里的全部内容导出成 JSON —— Godot 侧直接读这些表。
 *
 * 为什么先做这一步：不管移植做到什么程度，**数据表是一定要带过去的**。
 * 而且这一步没有任何风险 —— 只是把现有（已经被 616 条断言盯着）的数据
 * 原样序列化，不改动游戏本身。
 *
 * 用法：node tools/export-godot-data.mjs
 * 产物：godot/data/*.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'godot', 'data');
mkdirSync(OUT, { recursive: true });

/** 把 Map / Set / 函数之类不可序列化的东西安全降级 */
function sanitize(value, depth = 0) {
  if (depth > 8) return null;
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === 'number' || t === 'string' || t === 'boolean') return value;
  if (t === 'function') return undefined;                 // 函数不导出，由 Godot 侧自己实现
  if (Array.isArray(value)) return value.map(v => sanitize(v, depth + 1)).filter(v => v !== undefined);
  if (value instanceof Map) {
    const o = {};
    for (const [k, v] of value) o[String(k)] = sanitize(v, depth + 1);
    return o;
  }
  if (value instanceof Set) return [...value].map(v => sanitize(v, depth + 1));
  if (t === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('_')) continue;                    // 内部字段（_cached 之类）不导出
      const s = sanitize(v, depth + 1);
      if (s !== undefined) o[k] = s;
    }
    return o;
  }
  return null;
}

/** 每个数据模块导出成同名 json；数组导出成 { items: [...] } 便于 Godot 侧统一处理 */
const MODULES = [
  ['tiles', 'tiles.js'],
  ['tech', 'tech.js'],
  ['weapons', 'weapons.js'],
  ['monsters', 'monsters.js'],
  ['towers', 'towers.js'],
  ['characters', 'characters.js'],
  ['experiments', 'experiments.js'],
  ['materials', 'materials.js'],
  ['crafting', 'crafting.js'],
  ['modes', 'modes.js'],
  ['planets', 'planets.js'],
  ['help', 'help.js'],
];

// 核心配置（PLAYER / VEHICLE / BEACON / BASE / ECON…）来自 src/core/，不在 src/data/ 下。
// 以前**没有导出它**，于是 Godot 侧只好把这些常量手抄一遍 —— 结果玩家的基础移动速度
// 被抄成了 220（真值 172），整整快了 28%，而且没人发现。
// 现在和其它表一样走同一条数据管线。
const CORE_MODULES = [
  ['config', '../core/config.js'],
  // 按键表也从这里走：原版的默认键位是**一张可改键的表**，
  // Godot 侧不该手抄一份（之前就是手抄的，于是两版按键完全不同）。
  ['binds', '../core/settings.js'],
];

const index = [];
for (const [name, file] of [...MODULES, ...CORE_MODULES]) {
  let mod;
  try {
    mod = await import(new URL(`../src/data/${file}`, import.meta.url).href);
  } catch (err) {
    console.warn(`  ⚠ 跳过 ${file}：${err.message}`);
    continue;
  }
  const out = {};
  for (const [k, v] of Object.entries(mod)) {
    if (typeof v === 'function') continue;
    const s = sanitize(v);
    if (s === undefined) continue;
    out[k] = s;
  }
  const keys = Object.keys(out);
  const counts = {};
  for (const k of keys) {
    const v = out[k];
    counts[k] = Array.isArray(v?.items) ? v.items.length : Array.isArray(v) ? v.length : typeof v === 'object' ? Object.keys(v || {}).length : 1;
  }
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(out, null, 2) + '\n', 'utf8');
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`  ✓ ${name}.json  （${keys.length} 张表 / ${total} 条）`);
  index.push({ module: name, file: `${name}.json`, tables: keys, counts });
}

// 顶层索引：Godot 侧启动时读它就知道有哪些表
writeFileSync(join(OUT, 'index.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'src/data/*.js',
  modules: index,
}, null, 2) + '\n', 'utf8');
console.log(`\n✅ 已导出到 godot/data/（${index.length} 个模块 + index.json）`);
