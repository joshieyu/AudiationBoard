import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { customAlphabet } from 'nanoid';
import type { AlbumBoardRef, AlbumPayload, BoardPayload, FileRef, Op } from '../shared/types.ts';
import type { AlbumRow, BoardRow } from './db.ts';
import { openDb } from './db.ts';
import { createRooms } from './rooms.ts';
import { albumSections, singleSections, streamPack } from './pack.ts';
import { unfurl } from './unfurl.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(ROOT, 'data'));
const FILES_DIR = path.join(DATA_DIR, 'files');
const DIST_DIR = path.join(ROOT, 'dist');
const PROD = process.env.NODE_ENV === 'production';
// In dev the Vite server owns PORT; the API listens on API_PORT and Vite proxies to it.
const PORT = Number((PROD ? process.env.PORT : undefined) ?? process.env.API_PORT ?? 8787);
// Behind a reverse proxy set HOST=127.0.0.1 so the app is only reachable through it.
const HOST = process.env.HOST;
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB ?? 250) * 1024 * 1024;
// Uploads are refused once the data disk gets this low, so a shared server never fills up.
const MIN_FREE = Number(process.env.MIN_FREE_GB ?? 0) * 1024 ** 3;
// The admin page warns once free space drops below this.
const WARN_FREE = Number(process.env.WARN_FREE_GB ?? Number(process.env.MIN_FREE_GB ?? 0) + 5) * 1024 ** 3;
// Unlocks /admin. Without it the admin API doesn't exist.
const ADMIN_KEY = process.env.ADMIN_KEY ?? '';

fs.mkdirSync(FILES_DIR, { recursive: true });

const alphabet = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const viewId = customAlphabet(alphabet, 10);
const editId = customAlphabet(alphabet, 24);
const fileId = customAlphabet(alphabet, 20);

const db = openDb(DATA_DIR);
const rooms = createRooms(db, fileId);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.map': 'application/json',
  '.wav': 'audio/wav',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.webm': 'audio/webm',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

async function readJson<T>(req: http.IncomingMessage, limit = 4 * 1024 * 1024): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'Payload too large');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function requireBoard(token: string, edit: boolean) {
  const resolved = db.resolve(token);
  if (!resolved) throw new HttpError(404, 'Board not found');
  if (edit && !resolved.canEdit) throw new HttpError(403, 'This link is view-only');
  return resolved;
}

function requireAdmin(req: http.IncomingMessage) {
  if (!ADMIN_KEY) throw new HttpError(404, 'Not found');
  const given = Buffer.from(String(req.headers['x-admin-key'] ?? ''));
  const want = Buffer.from(ADMIN_KEY);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) throw new HttpError(401, 'Wrong admin key');
}

function storageStatus() {
  const disk = fs.statfsSync(DATA_DIR);
  const total = disk.blocks * disk.bsize;
  const free = disk.bavail * disk.bsize;
  const dbBytes = ['audiation.db', 'audiation.db-wal'].reduce((n, f) => {
    try {
      return n + fs.statSync(path.join(DATA_DIR, f)).size;
    } catch {
      return n;
    }
  }, 0);
  return { disk: { total, free }, dbBytes, minFree: MIN_FREE, warnFree: WARN_FREE, low: free < WARN_FREE };
}

function requireAlbum(token: string, edit: boolean) {
  const resolved = db.resolveAlbum(token);
  if (!resolved) throw new HttpError(404, 'Album not found');
  if (edit && !resolved.canEdit) throw new HttpError(403, 'This link is view-only');
  return resolved;
}

function albumRef(b: BoardRow, canEdit: boolean): AlbumBoardRef {
  return {
    viewId: b.id,
    editId: canEdit ? b.editId : undefined,
    kind: b.kind === 'overview' ? 'overview' : 'song',
    title: b.meta.title,
    key: b.meta.key,
    bpm: b.meta.bpm,
    position: b.position,
  };
}

function albumPayload(album: AlbumRow, canEdit: boolean): AlbumPayload {
  const boards = db.albumBoards(album.id);
  const overview = boards.find((b) => b.kind === 'overview');
  if (!overview) throw new HttpError(500, 'Album has no overview page');
  return {
    album: album.meta,
    access: canEdit ? 'edit' : 'view',
    viewId: album.id,
    editId: canEdit ? album.editId : undefined,
    overview: albumRef(overview, canEdit),
    songs: boards.filter((b) => b.kind === 'song').map((b) => albumRef(b, canEdit)),
  };
}

function notifyAlbum(albumId: string) {
  rooms.broadcastAlbum(db.albumBoards(albumId).map((b) => b.id));
}

function newSong(albumId: string, title: string) {
  const songs = db.albumBoards(albumId).filter((b) => b.kind === 'song');
  const position = songs.reduce((m, b) => Math.max(m, b.position), 0) + 1;
  const id = viewId();
  db.createBoard(id, editId(), title.trim().slice(0, 120) || `Song ${songs.length + 1}`, { albumId, kind: 'song', position });
  return db.board(id)!;
}

/** New album with its overview page. */
function createAlbum(title: string) {
  const album = db.createAlbum(viewId(), editId(), title.trim().slice(0, 120) || 'Untitled album');
  db.createBoard(viewId(), editId(), 'Album', { albumId: album.id, kind: 'overview', position: 0 });
  return db.album(album.id)!;
}

function cleanName(name: string) {
  return name.replace(/[\\/\u0000-\u001f]+/g, '_').slice(0, 180) || 'file';
}

async function handleUpload(req: http.IncomingMessage, res: http.ServerResponse, token: string) {
  const { board } = requireBoard(token, true);
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > MAX_UPLOAD) throw new HttpError(413, 'File too large');
  if (MIN_FREE) {
    const disk = fs.statfsSync(FILES_DIR);
    if (disk.bavail * disk.bsize - declared < MIN_FREE) throw new HttpError(507, 'The server is out of space for uploads');
  }
  const name = cleanName(decodeURIComponent(String(req.headers['x-file-name'] ?? 'file')));
  const ext = path.extname(name).toLowerCase().slice(0, 8);
  const mime = String(req.headers['content-type'] || MIME[ext] || 'application/octet-stream').slice(0, 100);
  const id = fileId();
  const dest = path.join(FILES_DIR, `${id}${ext.replace(/[^.a-z0-9]/g, '')}`);
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > MAX_UPLOAD) cb(new HttpError(413, 'File too large'));
      else cb(null, chunk);
    },
  });
  try {
    await pipeline(req, limiter, fs.createWriteStream(dest));
  } catch (err) {
    fs.rmSync(dest, { force: true });
    throw err;
  }
  db.insertFile({ id, boardId: board.id, name, mime, size, path: dest });
  const ref: FileRef = { fileId: id, url: `/files/${id}/${encodeURIComponent(name)}`, name, mime, size };
  json(res, 201, ref);
}

function serveFile(req: http.IncomingMessage, res: http.ServerResponse, id: string, url: URL) {
  const file = db.file(id);
  if (!file || !fs.existsSync(file.path)) throw new HttpError(404, 'File not found');
  const stat = fs.statSync(file.path);
  const headers: Record<string, string | number> = {
    'Content-Type': file.mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Access-Control-Allow-Origin': '*',
  };
  if (url.searchParams.has('dl')) {
    headers['Content-Disposition'] = `attachment; filename="${file.name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file.name)}`;
  }
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(stat.size - 1, end);
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file.path, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file.path).pipe(res);
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  let filePath = path.join(DIST_DIR, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(DIST_DIR)) throw new HttpError(403, 'Forbidden');
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(filePath)) throw new HttpError(404, 'Build the client first: npm run build');
  const ext = path.extname(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const p = url.pathname;
  const method = req.method ?? 'GET';
  let m: RegExpMatchArray | null;

  try {
    if (p === '/api/health') return json(res, 200, { ok: true });

    if (p === '/api/boards' && method === 'POST') {
      const body = await readJson<{ title?: string }>(req);
      const id = viewId();
      const edit = editId();
      const meta = db.createBoard(id, edit, (body.title ?? '').trim().slice(0, 120) || 'Untitled board');
      return json(res, 201, { viewId: id, editId: edit, board: meta });
    }

    if ((m = p.match(/^\/api\/boards\/([\w-]+)$/)) && method === 'GET') {
      const { board, canEdit } = requireBoard(m[1], false);
      const album = board.albumId ? db.album(board.albumId) : null;
      const payload: BoardPayload = {
        board: board.meta,
        items: db.items(board.id),
        access: canEdit ? 'edit' : 'view',
        viewId: board.id,
        editId: canEdit ? board.editId : undefined,
        kind: board.kind,
        album: album ? { title: album.meta.title } : undefined,
      };
      return json(res, 200, payload);
    }

    // Turn a single into song 1 of a new album. Its own links keep working.
    if ((m = p.match(/^\/api\/boards\/([\w-]+)\/album$/)) && method === 'POST') {
      const { board } = requireBoard(m[1], true);
      if (board.kind !== 'single') throw new HttpError(409, 'This board is already part of an album');
      const body = await readJson<{ title?: string }>(req);
      const album = createAlbum(body.title ?? board.meta.title);
      db.setBoardAlbum(board.id, album.id, 'song', 1);
      rooms.broadcastAlbum([board.id]);
      return json(res, 201, albumPayload(album, true));
    }

    if ((m = p.match(/^\/api\/boards\/([\w-]+)\/ops$/)) && method === 'POST') {
      const { board } = requireBoard(m[1], true);
      const body = await readJson<{ ops: Op[]; origin?: string }>(req);
      if (!Array.isArray(body.ops) || body.ops.length > 500) throw new HttpError(400, 'Bad ops');
      const applied = db.applyOps(board, body.ops);
      if (applied.length) rooms.broadcastOps(board.id, applied, String(body.origin ?? ''));
      // Song titles, keys and tempos show on the album's tabs.
      if (board.albumId && applied.some((o) => o.op === 'board')) notifyAlbum(board.albumId);
      return json(res, 200, { applied: applied.length, board: board.meta });
    }

    if ((m = p.match(/^\/api\/boards\/([\w-]+)\/files$/)) && method === 'POST') {
      return await handleUpload(req, res, m[1]);
    }

    if ((m = p.match(/^\/api\/boards\/([\w-]+)\/pack\.zip$/)) && method === 'GET') {
      const { board } = requireBoard(m[1], false);
      return await streamPack(db, res, board.meta.title, singleSections(board.id, board.meta));
    }

    // ---- Albums ----

    if (p === '/api/albums' && method === 'POST') {
      const body = await readJson<{ title?: string }>(req);
      const album = createAlbum(body.title ?? '');
      newSong(album.id, 'Song 1');
      return json(res, 201, albumPayload(album, true));
    }

    if ((m = p.match(/^\/api\/albums\/([\w-]+)$/)) && method === 'GET') {
      const { album, canEdit } = requireAlbum(m[1], false);
      return json(res, 200, albumPayload(album, canEdit));
    }

    if ((m = p.match(/^\/api\/albums\/([\w-]+)$/)) && method === 'PATCH') {
      const { album } = requireAlbum(m[1], true);
      const body = await readJson<{ title?: string }>(req);
      if (typeof body.title === 'string' && body.title.trim()) db.renameAlbum(album, body.title.trim());
      notifyAlbum(album.id);
      return json(res, 200, albumPayload(album, true));
    }

    if ((m = p.match(/^\/api\/albums\/([\w-]+)\/songs$/)) && method === 'POST') {
      const { album } = requireAlbum(m[1], true);
      const body = await readJson<{ title?: string }>(req);
      const song = newSong(album.id, body.title ?? '');
      notifyAlbum(album.id);
      return json(res, 201, { song: albumRef(song, true), album: albumPayload(album, true) });
    }

    if ((m = p.match(/^\/api\/albums\/([\w-]+)\/order$/)) && method === 'POST') {
      const { album } = requireAlbum(m[1], true);
      const body = await readJson<{ songs?: string[] }>(req);
      const current = new Set(db.albumBoards(album.id).filter((b) => b.kind === 'song').map((b) => b.id));
      const order = (body.songs ?? []).filter((id) => current.has(id));
      if (order.length !== current.size) throw new HttpError(400, 'Order must list every song once');
      db.reorderSongs(album.id, order);
      notifyAlbum(album.id);
      return json(res, 200, albumPayload(album, true));
    }

    // Take a song out of the album. It becomes a single again; nothing is deleted.
    if ((m = p.match(/^\/api\/albums\/([\w-]+)\/songs\/([\w-]+)\/detach$/)) && method === 'POST') {
      const { album } = requireAlbum(m[1], true);
      const board = db.board(m[2]);
      if (!board || board.albumId !== album.id || board.kind !== 'song') throw new HttpError(404, 'Song not found in this album');
      notifyAlbum(album.id);
      db.setBoardAlbum(board.id, null, 'single', 0);
      return json(res, 200, albumPayload(album, true));
    }

    if ((m = p.match(/^\/api\/albums\/([\w-]+)\/pack\.zip$/)) && method === 'GET') {
      const { album } = requireAlbum(m[1], false);
      return await streamPack(db, res, album.meta.title, albumSections(db.albumBoards(album.id)));
    }

    // ---- Admin ----

    if (p === '/api/admin/status' && method === 'GET') {
      requireAdmin(req);
      return json(res, 200, storageStatus());
    }

    if (p === '/api/admin/storage' && method === 'GET') {
      requireAdmin(req);
      return json(res, 200, { ...storageStatus(), ...db.storageReport() });
    }

    if (p === '/api/admin/delete' && method === 'POST') {
      requireAdmin(req);
      const body = await readJson<{ boards?: string[]; albums?: string[] }>(req);
      const freed = { files: 0, bytes: 0 };
      const add = (f: { files: number; bytes: number }) => {
        freed.files += f.files;
        freed.bytes += f.bytes;
      };
      for (const id of body.albums ?? []) {
        if (db.album(id)) add(db.deleteAlbum(id));
      }
      const touched = new Set<string>();
      const boards = (body.boards ?? []).map((id) => db.board(id)).filter((b): b is BoardRow => !!b);
      if (boards.some((b) => b.kind === 'overview')) throw new HttpError(400, 'Delete the whole album to remove its album page');
      for (const b of boards) if (b.albumId) touched.add(b.albumId);
      add(db.deleteBoards(boards.map((b) => b.id)));
      for (const albumId of touched) notifyAlbum(albumId);
      return json(res, 200, { freed, ...storageStatus() });
    }

    if (p === '/api/admin/prune-unused' && method === 'POST') {
      requireAdmin(req);
      return json(res, 200, { freed: db.pruneUnused(), ...storageStatus() });
    }

    if (p === '/api/unfurl' && method === 'GET') {
      const target = url.searchParams.get('url') ?? '';
      try {
        return json(res, 200, await unfurl(target));
      } catch {
        return json(res, 200, {});
      }
    }

    if ((m = p.match(/^\/files\/([\w-]+)(?:\/.*)?$/)) && (method === 'GET' || method === 'HEAD')) {
      return serveFile(req, res, m[1], url);
    }

    if (p.startsWith('/api/')) throw new HttpError(404, 'Not found');

    if (PROD && (method === 'GET' || method === 'HEAD')) return serveStatic(req, res, p);

    throw new HttpError(404, 'Not found (in dev, open the Vite server on :5173)');
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) json(res, status, { error: err instanceof Error ? err.message : 'Server error' });
    else res.destroy();
  }
});

server.on('upgrade', (req, socket, head) => rooms.handleUpgrade(req, socket, head));

server.listen(PORT, HOST, () => {
  console.log(`Audiation Space server on http://localhost:${PORT}${PROD ? '' : '  (dev: open http://localhost:5173)'}`);
});
