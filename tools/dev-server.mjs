/**
 * 零依赖静态服务器 —— 浏览器里直接调试游戏。
 *   node tools/dev-server.mjs [port]
 * 打开 http://127.0.0.1:5173
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

/** 简单的内存缓存，避免每次刷新都重读磁盘（按 mtime 失效）。 */
const cache = new Map();

async function load(file) {
  const info = await stat(file);
  const hit = cache.get(file);
  if (hit && hit.mtime === info.mtimeMs) return hit;
  const body = await readFile(file);
  const entry = { body, mtime: info.mtimeMs, type: MIME[extname(file).toLowerCase()] || 'application/octet-stream' };
  if (entry.type.startsWith('text/') || entry.type.includes('json') || entry.type.includes('javascript')) {
    cache.set(file, entry);
  }
  return entry;
}

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    const target = join(ROOT, normalize(urlPath).replace(/^([/\\])+/, ''));
    if (!target.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const entry = await load(target);
    res.writeHead(200, {
      'Content-Type': entry.type,
      'Cache-Control': 'no-store',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    res.end(entry.body);
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'EISDIR')) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 not found: ' + req.url);
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('500 ' + (err && err.message));
    }
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dev-server] 游戏已启动: http://127.0.0.1:${PORT}`);
  console.log(`[dev-server] 根目录: ${ROOT}`);
});
