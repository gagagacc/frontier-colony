/**
 * 虫巢地图。
 *
 * 副本是一张完全不同的地图（一条鱼骨刺通道 + 侧室 + 最深处 Boss 房），
 * 所以不能沿用行星地图那套「整颗星球的地形缩略图」——那样玩家只会看到
 * 一片几乎全黑的地块，什么也读不出来。
 *
 * 这里画的是**示意图**：主通道一条横线，侧室挂在上下两侧，Boss 房在最右端。
 * 关键收益点（旗舰残骸、Boss）直接标出来，并标出玩家当前在哪一段。
 *
 * 探索迷雾：进过的区域才点亮（按「已经走到过的通道段 / 进过的侧室」记），
 * 但 Boss 房的位置从一开始就标出来 —— 玩家需要知道「深处在哪」，
 * 否则没有前进的目标。
 */

import { TILE } from '../core/config.js';
import { h, button } from './dom.js';

const W = 660;
const H = 300;
const PAD = 46;

/**
 * 画一份虫巢地图。
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} run
 * @param {object} opts { revealed:Set, time:number, hoverRoom }
 */
export function drawDungeonMap(ctx, run, opts = {}) {
  const d = run.dungeon;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0a0410';
  ctx.fillRect(0, 0, W, H);

  if (!d) return;
  const revealed = opts.revealed || new Set();
  const t = opts.time || 0;

  // 世界格 -> 画布坐标（横向铺满，纵向居中）
  const spanX = Math.max(1, d.boss.tx - d.entry.tx + 14);
  const sx = (W - PAD * 2) / spanX;
  const sy = sx;
  const midY = H / 2;
  const px = (tx) => PAD + (tx - d.entry.tx) * sx;
  const py = (ty) => midY + (ty - d.entry.ty) * sy;

  // ---- 巢壁底纹（整片暗紫，暗示「外面都是岩壁」）----
  ctx.fillStyle = 'rgba(60,20,40,0.45)';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,90,120,0.10)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 22) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }

  // ---- 主通道 ----
  const corridorH = Math.max(10, 5 * sy);
  ctx.fillStyle = revealed.has('corridor') ? '#5a2a3c' : '#2a1220';
  roundRect(ctx, px(d.entry.tx), midY - corridorH / 2, px(d.boss.tx) - px(d.entry.tx), corridorH, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,140,170,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // ---- 侧室 ----
  const chW = Math.max(16, 9 * sx);
  const chH = Math.max(14, 9 * sy);
  d.chambers.forEach((c, i) => {
    const cx = px(c.tx), cy = py(c.ty);
    const key = 'room' + i;
    const seen = revealed.has(key);
    // 支路
    ctx.strokeStyle = seen ? '#5a2a3c' : '#241018';
    ctx.lineWidth = Math.max(4, 2 * sy);
    ctx.beginPath();
    ctx.moveTo(cx, midY);
    ctx.lineTo(cx, cy);
    ctx.stroke();
    // 房间
    ctx.fillStyle = seen ? '#4a2230' : '#22101a';
    roundRect(ctx, cx - chW / 2, cy - chH / 2, chW, chH, 4);
    ctx.fill();
    ctx.strokeStyle = seen ? 'rgba(255,140,170,0.55)' : 'rgba(255,140,170,0.18)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (!seen) {
      ctx.fillStyle = 'rgba(200,180,220,0.5)';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('?', cx, cy + 4);
    }
  });

  // ---- 入口 ----
  ctx.fillStyle = '#6ee7a8';
  ctx.beginPath();
  ctx.arc(px(d.entry.tx), midY, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#9fe8c0';
  ctx.font = 'bold 11px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('入口', px(d.entry.tx), midY - 16);
  ctx.font = '10px system-ui';
  ctx.fillStyle = 'rgba(160,220,190,0.75)';
  ctx.fillText('按 F 撤退', px(d.entry.tx), midY + 22);

  // ---- Boss 房 ----
  const bossX = px(d.boss.tx);
  const bossW = Math.max(30, 13 * sx);
  const bossH = Math.max(26, 13 * sy);
  const bossSeen = revealed.has('boss') || !!d.cleared;
  ctx.fillStyle = d.cleared ? 'rgba(40,70,50,0.9)' : (bossSeen ? '#6a1c28' : '#3a1018');
  roundRect(ctx, bossX - bossW / 2, midY - bossH / 2, bossW, bossH, 6);
  ctx.fill();
  const pulse = 0.5 + Math.sin(t / 320) * 0.5;
  ctx.strokeStyle = d.cleared ? 'rgba(110,231,168,0.9)' : `rgba(255,80,90,${0.55 + pulse * 0.45})`;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = d.cleared ? '#6ee7a8' : '#ff8a92';
  ctx.font = 'bold 12px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(d.cleared ? '巢核已毁' : '💀 巢核', bossX, midY + 4);
  ctx.font = '10px system-ui';
  ctx.fillStyle = 'rgba(255,180,190,0.8)';
  ctx.fillText(`${d.tier} 级巢穴主`, bossX, midY + 20);

  // ---- 旗舰残骸（主要收益，直接标出来）----
  // 注意：prop.x/y 是**像素**，要先换成格再换算画布坐标，
  // 否则图标会散落在整张图上（这里踩过一次）。
  for (const prop of run.world.props.values()) {
    if (prop.type !== 'wreckCache' || prop.dead) continue;
    const wx = px(Math.floor(prop.x / TILE));
    const wy = py(Math.floor(prop.y / TILE));
    const got = revealed.has('wreck' + prop.id);
    ctx.fillStyle = got ? '#64748b' : '#c9d4e2';
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-4, -4, 8, 8);
    ctx.restore();
    if (!got) {
      ctx.strokeStyle = 'rgba(255,186,76,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(wx, wy, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ---- 玩家 ----
  const plx = px(Math.floor(run.player.x / TILE));
  const ply = py(Math.floor(run.player.y / TILE));
  ctx.fillStyle = '#ffba4c';
  ctx.beginPath();
  ctx.arc(plx, ply, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  // 玩家光晕
  ctx.strokeStyle = `rgba(255,186,76,${0.35 + pulse * 0.25})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(plx, ply, 12 + pulse * 3, 0, Math.PI * 2);
  ctx.stroke();

  // ---- 进度指示（左侧竖条）----
  const prog = Math.max(0, Math.min(1, (run.player.x - d.entry.x) / Math.max(1, d.boss.x - d.entry.x)));
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(PAD, H - 22, W - PAD * 2, 6);
  ctx.fillStyle = '#ffba4c';
  ctx.fillRect(PAD, H - 22, (W - PAD * 2) * prog, 6);
  ctx.fillStyle = 'rgba(216,230,245,0.8)';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('入口', PAD, H - 8);
  ctx.textAlign = 'right';
  ctx.fillText('巢核', W - PAD, H - 8);
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * 打开虫巢地图面板。
 * @param {object} game
 * @param {object} run
 */
export function openDungeonMap(game, run) {
  const modals = game.ui.modals;
  const d = run.dungeon;
  const canvas = h('canvas', { id: 'dungeonmap-canvas', width: W, height: H });
  const ctx = canvas.getContext('2d');

  /*
   * 探索迷雾：按「玩家走到过的位置」逐步揭开。
   * 主通道按 x 分段记录，侧室按距离记录，残骸按走近记录。
   * 不做成永久存档数据 —— 退出副本再进来就是一次新的探索，这样更符合
   * 「巢穴是活的」的设定，也省掉一份要序列化的状态。
   */
  const revealed = new Set();
  const updateReveal = () => {
    const p = run.player;
    // 通道：走过的每一段都点亮（按格记录，避免走回头路时又变黑）
    const fromTx = Math.floor(d.entry.tx);
    const toTx = Math.floor(p.x / TILE);
    for (let tx = fromTx; tx <= toTx; tx++) revealed.add('corridor:' + tx);
    if (revealed.has('corridor:' + Math.floor(d.entry.tx)) || toTx >= fromTx) revealed.add('corridor');
    // 侧室
    d.chambers.forEach((c, i) => {
      if (Math.hypot(p.x - c.x, p.y - c.y) < 420) revealed.add('room' + i);
    });
    // Boss 房
    if (Math.hypot(p.x - d.boss.x, p.y - d.boss.y) < 620) revealed.add('boss');
    // 残骸
    for (const prop of run.world.props.values()) {
      if (prop.type !== 'wreckCache') continue;
      if (Math.hypot(p.x - prop.x, p.y - prop.y) < 320) revealed.add('wreck' + prop.id);
    }
  };

  const draw = () => {
    updateReveal();
    drawDungeonMap(ctx, run, { revealed, time: performance.now() });
  };

  draw();
  const timer = setInterval(draw, 380);

  const wrecks = [...run.world.props.values()].filter(p => p.type === 'wreckCache' && !p.dead).length;
  const bossAlive = !!(d.bossEnemy && !d.bossEnemy.dead && d.bossEnemy.hp > 0);

  modals.open({
    title: `虫巢地图 · ${d.tier} 级`,
    subtitle: '鱼骨刺通道：主道一路向右通往巢核，上下两侧是被拖进来的飞船残骸。',
    body: [
      canvas,
      h('div', { class: 'map-legend' }, [
        legendItem('#6ee7a8', '入口（按 F 撤退）'),
        legendItem('#ffba4c', '你'),
        legendItem('#c9d4e2', '旗舰残骸（5% 红装）'),
        legendItem('#ff5f6d', '巢核 / 巢穴主'),
        legendItem('#4a2230', '未探索的侧室'),
      ]),
      h('div', { style: { marginTop: '12px', display: 'flex', gap: '26px', justifyContent: 'center', fontSize: '12.5px', color: '#a8bcd4' } }, [
        h('span', {}, `剩余残骸：${wrecks}`),
        h('span', {}, bossAlive ? '巢穴主：已被唤醒' : (d.cleared ? '巢穴主：已伏诛' : '巢穴主：仍在深处沉睡')),
        h('span', {}, `巢穴等级：${d.tier} / 10`),
      ]),
    ],
    wide: true,
    footer: [
      h('div', { style: { marginRight: 'auto', fontSize: '12px', color: '#8ba0bb' } },
        '提示：打不过就沿主道往回走到入口按 F 撤退，战果会保留。'),
      button('关闭', () => { modals.close(); game.paused = false; }),
    ],
    onClose: () => { clearInterval(timer); game.paused = false; },
  });
}

function legendItem(color, label) {
  return h('span', {}, [h('i', { style: { background: color } }), label]);
}
