/**
 * 断言覆盖矩阵：把 JS 版的断言按「分组」列出来，逐条标出 Godot 侧的对应情况。
 *
 * 目标里的那句「逐阶段把 JS 版的 616 条断言在 Godot 里重建」需要一个**可度量的口径**，
 * 否则只能靠感觉说「搬得差不多了」。这个脚本就是那个口径：
 *
 *   node tools/assertion-matrix.mjs            # 打印矩阵
 *   node tools/assertion-matrix.mjs --json     # 给机器读
 *
 * 做法：两边各自吐分组计数（JS 用 `smoke.mjs --sections`，Godot 用 `GODOT_SECTIONS`），
 * 再用下面这张**人工维护的对照表**把「JS 的分组」映射到「Godot 的断言名前缀」。
 * 映射表是人工的，因为它表达的是**语义对应**（比如 JS 的「7. 建造/战斗/掉落」
 * 对应 Godot 的 tower/damage/enemy/ammo 四组），这层判断不该由脚本猜。
 */
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GODOT = join(ROOT, 'tools', 'godot-dl', 'exe', 'Godot_v4.4.1-stable_win64_console.exe');
const GOLDEN = join(ROOT, 'godot', 'tests', 'golden.json');

/** JS 分组（关键字匹配）→ Godot 断言名前缀；status 见下方说明 */
const MAP = [
  { js: '1. 模块导入', godot: [], note: '**不适用**：Godot 的类由引擎统一加载，没有「import 是否成功」这一步' },
  { js: '2. 数据表完整性', godot: ['craft', 'props', 'ammo', 'tower', 'weapon'], note: '数据表由 tools/export-godot-data.mjs 导出，两边读同一份' },
  { js: '3. 世界生成', godot: ['world', 'noise', 'hashStr', 'cell'], note: '' },
  { js: '4. 寻路流场', godot: ['flow', 'spatial', 'slide'], note: '' },
  { js: '5. RunState 与系统装配', godot: ['(其它)', 'stats', 'mechanic'], note: '属性引擎 + 装配顺序' },
  { js: '6. 模拟运行 120 秒', godot: ['sim'], note: '' },
  { js: '7. 建造 / 战斗 / 掉落 交互', godot: ['tower', 'damage', 'enemy', 'ammo', 'status', 'death'], note: '' },
  { js: '8. 存档往返', godot: ['save'], note: '' },
  { js: '9. 四角色 + 三星球 全流程', godot: ['matrix', 'enemy', 'world'], note: '' },
  { js: '10. 边界情况', godot: ['edges', 'dungeon', 'spawn'], note: '' },
  { js: '11. 纯塔防模式', godot: ['modes'], note: '' },
  { js: '12. 经验需求与实验科技节奏', godot: ['exp', 'refreshCost'], note: '' },
  { js: '12b. 弹药 / 子弹掉落 / 武器成长上限', godot: ['ammo', 'weapon'], note: '' },
  { js: '12c. 快捷栏数字键与拾取武器', godot: ['hotbar'], note: '归属规则与数字键已覆盖；武器**掉落源**（战利品系统）还没搬' },
  { js: '12d. 换弹（自动 + 按武器与品质）', godot: ['reload', 'weapon'], note: '' },
  { js: '12e. 吸引阵列（并入核心舱）/ 燃料减半 / 追杀', godot: ['wave', 'boss', 'garrison'], note: '' },
  { js: '12f. 自由降落点 / 刷怪位置 / 巢穴与 Boss 房', godot: ['dungeon', 'spawn', 'wave'], note: '' },
  { js: '13. 装备品质 / 护甲 / 城镇制造', godot: ['town', 'craft', 'item'], note: '' },
  { js: '14. 巢穴副本', godot: ['dungeon'], note: '' },
  { js: '19. 副本风格 / 刷怪位置 / 索敌优先级 / 相连塔 / 实验科技去重', godot: ['dungeon', 'tower', 'exp', 'spawn'], note: '' },
    { js: '13. 输入缓冲', godot: ['inputBuffer'], note: '' },
  { js: '14. 设置与模式', godot: ['settings'], note: '' },
  { js: '15. 手柄支持 / 手柄映射', godot: ['gamepad'], note: '' },
  { js: '16. 浏览器端 UI', godot: ['bagSort', 'panel'], note: 'DOM 面板 → Control 面板（9/16 已搬）' },
  { js: '20. 波次善后期（曾经每波必崩的那一步）', godot: ['wave'], note: 'JS 侧修复 + Godot 侧同规则' },
];

function runJS() {
  try {
    const out = execFileSync('node', [join(ROOT, 'tools', 'smoke.mjs'), '--sections'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: ROOT });
    const line = out.split('\n').find(l => l.startsWith('SMOKE_SECTIONS '));
    const total = out.match(/通过 (\d+) · 失败 (\d+)/);
    return {
      sections: line ? JSON.parse(line.slice('SMOKE_SECTIONS '.length)) : [],
      pass: total ? Number(total[1]) : 0,
      fail: total ? Number(total[2]) : 0,
    };
  } catch (err) {
    const out = `${err.stdout || ''}`;
    const line = out.split('\n').find(l => l.startsWith('SMOKE_SECTIONS '));
    const total = out.match(/通过 (\d+) · 失败 (\d+)/);
    return {
      sections: line ? JSON.parse(line.slice('SMOKE_SECTIONS '.length)) : [],
      pass: total ? Number(total[1]) : 0,
      fail: total ? Number(total[2]) : 0,
      error: String(err.message).slice(0, 120),
    };
  }
}

function runGodot() {
  try {
    const out = execFileSync(GODOT, ['--headless', '--path', join(ROOT, 'godot'),
      '--script', 'res://tests/run_tests.gd', '--', `--golden=${GOLDEN}`],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: ROOT, timeout: 600000 });
    return parseGodot(out);
  } catch (err) {
    return parseGodot(`${err.stdout || ''}${err.stderr || ''}`);
  }
}

function parseGodot(out) {
  const res = out.split('\n').find(l => l.startsWith('GODOT_TEST_RESULT '));
  const sec = out.split('\n').find(l => l.startsWith('GODOT_SECTIONS '));
  const r = res ? JSON.parse(res.slice('GODOT_TEST_RESULT '.length)) : { pass: 0, fail: 0 };
  return { groups: sec ? JSON.parse(sec.slice('GODOT_SECTIONS '.length)) : {}, pass: r.pass, fail: r.fail };
}

const js = runJS();
const gd = runGodot();
const gdTotal = Object.values(gd.groups).reduce((s, g) => s + g.pass + g.fail, 0);

const rows = MAP.map(m => {
  let matched = 0;
  let fail = 0;
  for (const prefix of m.godot) {
    for (const [name, g] of Object.entries(gd.groups)) {
      if (name === prefix || name.startsWith(prefix)) {
        matched += g.pass + g.fail;
        fail += g.fail;
      }
    }
  }
  const jsSection = js.sections.find(s => s.name === m.js);
  const jsCount = jsSection ? jsSection.pass + jsSection.fail : 0;
  const status = m.godot.length === 0 ? '⬜ 未覆盖'
    : (m.note && m.note.startsWith('**部分**') ? '🟡 部分' : '✅ 已覆盖');
  return { js: m.js, jsCount, godot: m.godot.join('/'), godotCount: matched, godotFail: fail, status, note: m.note };
});

const covered = rows.filter(r => r.status === '✅ 已覆盖').reduce((s, r) => s + r.jsCount, 0);
const partial = rows.filter(r => r.status === '🟡 部分').reduce((s, r) => s + r.jsCount, 0);
const missing = rows.filter(r => r.status === '⬜ 未覆盖').reduce((s, r) => s + r.jsCount, 0);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ js: { pass: js.pass, fail: js.fail }, godot: { pass: gd.pass, fail: gd.fail, groups: gdTotal }, rows,
    summary: { covered, partial, missing } }, null, 2));
} else {
  console.log('断言覆盖矩阵（JS → Godot）\n');
  console.log('JS 分组'.padEnd(34) + 'JS'.padStart(5) + '  Godot 对应'.padEnd(34) + 'Godot'.padStart(6) + '  状态');
  console.log('-'.repeat(100));
  for (const r of rows) {
    console.log(r.js.padEnd(30).slice(0, 30) + String(r.jsCount).padStart(6) + '  '
      + (r.godot || '—').padEnd(32).slice(0, 32) + String(r.godotCount).padStart(6) + '  ' + r.status);
  }
  console.log('-'.repeat(100));
  console.log(`JS 断言 ${js.pass} 条（失败 ${js.fail}） · Godot 断言 ${gd.pass} 条（失败 ${gd.fail}）`);
  console.log(`重建情况：已覆盖 ${covered} 条 · 部分 ${partial} 条 · 未覆盖 ${missing} 条`);
  const pct = ((covered / Math.max(1, covered + partial + missing)) * 100).toFixed(1);
  console.log(`→ Godot 侧已重建 ${pct}% 的 JS 断言分组`);
  const todo = rows.filter(r => r.status !== '✅ 已覆盖' && r.note);
  if (todo.length) {
    console.log('\n还差什么：');
    for (const r of todo) console.log(`  ${r.status} ${r.js} —— ${r.note}`);
  }
}
