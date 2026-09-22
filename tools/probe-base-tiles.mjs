/** 打印基地周围的地块构成：用来判断截图里那些深色方块是不是本来就该有 */
import { World } from '../src/world/world.js';

const w = new World(process.argv[2] || 'frontier-golden-a', {});
const bx = w.baseSite.tx;
const by = w.baseSite.ty;
const glyph = {
  0: ' ', 1: '.', 2: '"', 3: ',', 4: '~', 5: '#', 6: '^', 7: '=', 8: '-',
  9: '*', 10: 'f', 11: 'i', 12: 'r', 13: 'C', 14: 'x', 15: 's', 16: 'W', 17: 'o', 18: 'O',
};
console.log(`基地中心 (${bx},${by}) 周围 29x13 地块`);
console.log('图例: C=混凝土 .=风化土 x=焦土 #=裸岩 ^=高山 ==水 *=晶簇 ,=沙 ~=火山灰');
for (let ty = by - 6; ty <= by + 6; ty++) {
  let row = '';
  for (let tx = bx - 14; tx <= bx + 14; tx++) row += glyph[w.tileAt(tx, ty)] ?? '?';
  console.log(row);
}
const counts = {};
for (let ty = by - 8; ty <= by + 8; ty++) {
  for (let tx = bx - 8; tx <= bx + 8; tx++) {
    const t = w.tileAt(tx, ty);
    counts[t] = (counts[t] || 0) + 1;
  }
}
console.log('基地 17x17 内统计:', JSON.stringify(counts), '（13=混凝土 1=风化土）');
