/**
 * 生成应用图标（程序化，零素材依赖）。
 *
 * 为什么不用素材：整个项目至今没有任何外部图片依赖，
 * 图标只是一个 256×256 的标识，用几十行代码画出来比引入一张图更省事，
 * 也和游戏里「一切都是程序化图形」的风格一致。
 *
 * 画一个「吸引装置」：深色圆底 + 琥珀色信号环 + 中央的青色核心，
 * 下方三道表示向外扩散的波。
 *
 * 用法：node tools/make-icon.mjs
 * 输出：assets/icon.png、assets/icon.ico（16/32/48/64/128/256 六种尺寸）
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'assets');

// ---------- 极简 PNG 编码 ----------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGBA 像素 -> PNG 文件内容 */
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;                       // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 画图 ----------
const S = 256;

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const k = size / S;                       // 从 256 基准缩放
  const put = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const sa = a / 255;
    // 简单的 source-over 合成
    px[i] = Math.round(px[i] * (1 - sa) + r * sa);
    px[i + 1] = Math.round(px[i + 1] * (1 - sa) + g * sa);
    px[i + 2] = Math.round(px[i + 2] * (1 - sa) + b * sa);
    px[i + 3] = Math.max(px[i + 3], Math.round(a));
  };

  const cx = size / 2, cy = size / 2;

  // 圆角方形底盘（深空蓝）
  const R = size * 0.20;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(Math.abs(x - cx) - (size / 2 - R - 1), 0);
      const dy = Math.max(Math.abs(y - cy) - (size / 2 - R - 1), 0);
      if (Math.hypot(dx, dy) <= R) {
        // 中心稍亮的径向渐变
        const t = 1 - Math.min(1, Math.hypot(x - cx, y - cy) / (size * 0.62));
        put(x, y, Math.round(8 + t * 16), Math.round(16 + t * 30), Math.round(32 + t * 46), 255);
      }
    }
  }

  // 三道向外扩散的信号波（琥珀色，越外越淡）
  for (let ring = 0; ring < 3; ring++) {
    const r0 = (size * (0.20 + ring * 0.115));
    const width = Math.max(1.2, size * 0.022);
    const alpha = 200 - ring * 52;
    for (let a = 0; a < 360; a += 0.5) {
      const rad = a * Math.PI / 180;
      for (let t = 0; t < width; t++) {
        const rr = r0 + t;
        put(Math.round(cx + Math.cos(rad) * rr), Math.round(cy + Math.sin(rad) * rr), 255, 186, 76, alpha);
      }
    }
  }

  // 中央核心（青色）+ 高光
  const coreR = size * 0.145;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > coreR) continue;
      const t = 1 - d / coreR;
      put(x, y, Math.round(40 + t * 120), Math.round(200 + t * 55), Math.round(255), 255);
    }
  }

  // 底座支架（三道短竖线，让它像个「装置」而不是圆点）
  const stemW = Math.max(1, Math.round(size * 0.018));
  for (let i = -1; i <= 1; i++) {
    const bx = Math.round(cx + i * size * 0.16);
    for (let y = Math.round(cy + size * 0.20); y < Math.round(cy + size * 0.32); y++) {
      for (let x = bx - stemW; x <= bx + stemW; x++) put(x, y, 120, 190, 255, 210);
    }
  }

  void k;
  return px;
}

// ---------- ICO 封装 ----------
function encodeICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);                // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  const blobs = [];
  entries.forEach((e, i) => {
    const b = i * 16;
    dir[b] = e.size >= 256 ? 0 : e.size;
    dir[b + 1] = e.size >= 256 ? 0 : e.size;
    dir[b + 2] = 0;                          // palette
    dir[b + 3] = 0;
    dir.writeUInt16LE(1, b + 4);             // color planes
    dir.writeUInt16LE(32, b + 6);            // bpp
    dir.writeUInt32LE(e.png.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += e.png.length;
    blobs.push(e.png);
  });

  return Buffer.concat([header, dir, ...blobs]);
}

// ---------- 输出 ----------
mkdirSync(OUT_DIR, { recursive: true });
const SIZES = [16, 32, 48, 64, 128, 256];
const entries = SIZES.map(size => ({ size, png: encodePNG(size, size, drawIcon(size)) }));

writeFileSync(join(OUT_DIR, 'icon.png'), entries[entries.length - 1].png);
writeFileSync(join(OUT_DIR, 'icon.ico'), encodeICO(entries));

console.log(`已生成 assets/icon.png (256x256) 与 assets/icon.ico（${SIZES.join('/')}）`);
