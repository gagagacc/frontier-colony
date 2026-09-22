/**
 * 大地图：显示整颗星球的地形、巢穴、遗迹、基地、已探索区域。
 * 支持点击选点（建立第二基地）。
 */

import { TILE } from '../core/config.js';
import { TILE_DEF, BIOME_DEF } from '../data/tiles.js';
import { h, button } from './dom.js';
import { dist } from '../core/math.js';

export function openMapPanel(game, actions, opts = {}) {
  const run = game.run;
  const modals = game.ui.modals;
  const world = run.world;
  const SIZE = 660;

  const canvas = h('canvas', { id: 'worldmap-canvas', width: SIZE, height: SIZE });
  const ctx = canvas.getContext('2d');
  const scale = SIZE / Math.max(world.w, world.h);
  let hover = null;

  const draw = () => {
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = '#04060c';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // 地形
    for (let ty = 0; ty < world.h; ty++) {
      for (let tx = 0; tx < world.w; tx++) {
        const idx = ty * world.w + tx;
        const tile = world.tiles[idx];
        const def = TILE_DEF[tile];
        if (!def || tile === 0) continue;
        const biome = BIOME_DEF[world.biomes[idx]];
        ctx.fillStyle = mix(def.color, biome ? biome.tint : '#888', 0.4);
        ctx.fillRect(tx * scale, ty * scale, Math.ceil(scale), Math.ceil(scale));
      }
    }

    // 已探索区域遮罩（只显示玩家去过的地方 + 侦察范围）
    ctx.fillStyle = 'rgba(3,5,12,0.72)';
    const revealed = new Set();
    const reveal = (x, y, r) => {
      for (let ty = Math.floor((y - r) / TILE); ty <= Math.ceil((y + r) / TILE); ty++) {
        for (let tx = Math.floor((x - r) / TILE); tx <= Math.ceil((x + r) / TILE); tx++) {
          if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) continue;
          if (Math.hypot(tx - x / TILE, ty - y / TILE) > r / TILE) continue;
          revealed.add(tx + ',' + ty);
        }
      }
    };
    const revealRadius = 900 + run.playerStats.get('revealRadius');
    reveal(run.player.x, run.player.y, revealRadius);
    for (const b of run.bases) if (!b.destroyed) reveal(b.x, b.y, 700);
    if (run.playerStats.get('mapReveal') > 0) {
      for (const n of world.nests) if (n.discovered) reveal(n.x, n.y, 500);
    }

    // 用反向绘制：把未揭示区域盖黑
    const cell = Math.max(1, Math.ceil(scale));
    for (let ty = 0; ty < world.h; ty += 1) {
      for (let tx = 0; tx < world.w; tx += 1) {
        if (revealed.has(tx + ',' + ty)) continue;
        ctx.fillRect(tx * scale, ty * scale, cell, cell);
      }
    }

    // 巢穴
    for (const n of world.nests) {
      const x = n.x / TILE * scale, y = n.y / TILE * scale;
      if (n.destroyed) {
        ctx.strokeStyle = 'rgba(110,231,168,0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4);
        ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4);
        ctx.stroke();
      } else {
        const pulse = 0.55 + Math.sin(performance.now() / 300 + n.tier) * 0.45;
        ctx.fillStyle = `rgba(255,60,60,${0.55 + pulse * 0.45})`;
        ctx.beginPath();
        ctx.arc(x, y, 3 + n.tier * 1.1, 0, Math.PI * 2);
        ctx.fill();
        if (n.discovered) {
          ctx.strokeStyle = 'rgba(255,120,120,0.6)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, 7 + n.tier * 1.6, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // 兴趣点
    for (const poi of world.pois) {
      const x = poi.x / TILE * scale, y = poi.y / TILE * scale;
      const color = poi.looted ? '#556070' : poi.kind === 'ruin' ? '#ffba4c' : poi.kind === 'vault' ? '#c08cff' : poi.kind === 'obelisk' ? '#8fe0ff' : '#d0c090';
      ctx.fillStyle = color;
      if (poi.kind === 'ruin') {
        ctx.fillRect(x - 4, y - 4, 8, 8);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 4, y - 4, 8, 8);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 吸引范围
    const bx = run.beacon.x / TILE * scale, by = run.beacon.y / TILE * scale;
    ctx.strokeStyle = run.beacon.online ? 'rgba(255,150,80,0.65)' : 'rgba(120,120,120,0.4)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(bx, by, run.beacon.radius / TILE * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 基地
    for (const b of run.bases) {
      const x = b.x / TILE * scale, y = b.y / TILE * scale;
      ctx.fillStyle = b.destroyed ? '#ff5f6d' : '#59d8ff';
      ctx.beginPath();
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x + 7, y);
      ctx.lineTo(x, y + 7);
      ctx.lineTo(x - 7, y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 载具
    if (!run.vehicle.destroyed) {
      const x = run.vehicle.x / TILE * scale, y = run.vehicle.y / TILE * scale;
      ctx.fillStyle = '#6ee7a8';
      ctx.fillRect(x - 3, y - 3, 6, 6);
    }

    // 玩家
    const px = run.player.x / TILE * scale, py = run.player.y / TILE * scale;
    ctx.fillStyle = '#ffba4c';
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 选点模式
    if (opts.pickSecondBase && hover) {
      const hx = hover.x / TILE * scale, hy = hover.y / TILE * scale;
      const valid = isSecondBaseValid(run, hover.x, hover.y);
      ctx.strokeStyle = valid ? '#6ee7a8' : '#ff5f6d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hx, hy, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hx - 22, hy); ctx.lineTo(hx + 22, hy);
      ctx.moveTo(hx, hy - 22); ctx.lineTo(hx, hy + 22);
      ctx.stroke();
    }

    // 网格与坐标
    ctx.strokeStyle = 'rgba(120,190,255,0.08)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const p = (SIZE / 8) * i;
      ctx.beginPath();
      ctx.moveTo(p, 0); ctx.lineTo(p, SIZE);
      ctx.moveTo(0, p); ctx.lineTo(SIZE, p);
      ctx.stroke();
    }
  };

  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    const cx = (e.clientX - r.left) / r.width * SIZE;
    const cy = (e.clientY - r.top) / r.height * SIZE;
    hover = { x: cx / scale * TILE, y: cy / scale * TILE };
    if (opts.pickSecondBase) draw();
  });
  canvas.addEventListener('mouseleave', () => { hover = null; if (opts.pickSecondBase) draw(); });
  canvas.addEventListener('click', () => {
    if (opts.pickSecondBase && hover) {
      if (actions.buildSecondBase(hover.x, hover.y)) {
        modals.close();
        game.paused = false;
      }
    }
  });

  draw();
  // 动画刷新（脉冲）
  const timer = setInterval(draw, 420);

  const stats = world.stats;
  const legend = h('div', { class: 'map-legend' }, [
    legendItem('#59d8ff', '基地'),
    legendItem('#ff3f3f', '虫巢（活跃）'),
    legendItem('#6ee7a8', '已清除'),
    legendItem('#ffba4c', '废弃基地 / 遗迹'),
    legendItem('#c08cff', '实验 vault'),
    legendItem('#8fe0ff', '数据方尖碑'),
    legendItem('#ffba4c', '你'),
  ]);

  const info = h('div', { style: { marginTop: '14px', display: 'flex', gap: '26px', justifyContent: 'center', fontSize: '12.5px', color: '#a8bcd4' } }, [
    h('span', {}, `巢穴：${stats.clearedNests} / ${stats.totalNests} 已清除`),
    h('span', {}, `遗迹：${stats.poisDiscovered} / ${stats.poisTotal} 已发现`),
    h('span', {}, `星球：${run.planet.name}（难度 ${run.planetIndex + 1}）`),
  ]);

  modals.open({
    title: opts.pickSecondBase ? '选择第二基地位置' : '行星地图',
    subtitle: opts.pickSecondBase
      ? '点击地图上的位置建立第二基地（需要离现有基地 1400 像素以上，且离虫巢 420 像素以上）'
      : '已探索区域会逐步点亮。侦察无人机与扫描仪能揭示更多。',
    body: [canvas, legend, info],
    wide: true,
    footer: [
      h('div', { style: { marginRight: 'auto', fontSize: '12px', color: '#8ba0bb' } },
        '提示：摧毁所有虫巢即可占领这颗星球。'),
      button('关闭', () => { modals.close(); game.paused = false; }),
    ],
    onClose: () => { clearInterval(timer); game.paused = false; },
  });
}

function isSecondBaseValid(run, x, y) {
  for (const b of run.bases) if (dist(x, y, b.x, b.y) < 1400) return false;
  for (const n of run.world.nests) {
    if (n.destroyed) continue;
    if (dist(x, y, n.x, n.y) < 420) return false;
  }
  return true;
}

function legendItem(color, label) {
  return h('span', {}, [h('i', { style: { background: color } }), label]);
}

function mix(hex1, hex2, t) {
  const a = rgb(hex1), b = rgb(hex2);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}

function rgb(hex) {
  if (!hex || hex[0] !== '#') return [128, 128, 128];
  let s = hex.slice(1);
  if (s.length === 3) s = s.split('').map(c => c + c).join('');
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
