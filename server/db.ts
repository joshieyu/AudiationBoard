import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { AlbumMeta, AnyItem, BoardKind, BoardMeta, BoardPatch, ItemPatch, Op, StorageBoard, StorageReport } from '../shared/types.ts';

export interface BoardRow {
  id: string;
  editId: string;
  meta: BoardMeta;
  albumId: string | null;
  kind: BoardKind;
  position: number;
}

export interface AlbumRow {
  id: string;
  editId: string;
  meta: AlbumMeta;
}

export interface FileRow {
  id: string;
  boardId: string;
  name: string;
  mime: string;
  size: number;
  path: string;
}

const MAX_ITEM_JSON = 768 * 1024;
// A file no card points at is kept this long first: uploads land before their card does,
// and a deleted card's file is what makes undo work.
const UNUSED_GRACE_MS = 24 * 3600 * 1000;
const FILE_REF = /"fileId":"([\w-]+)"/g;

function fileRefs(json: string): string[] {
  return Array.from(json.matchAll(FILE_REF), (m) => m[1]);
}
const ITEM_TYPES = new Set(['text', 'image', 'link', 'audio', 'midi']);

export function openDb(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'audiation.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      edit_id TEXT UNIQUE NOT NULL,
      meta TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS items_board ON items(board_id);
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      edit_id TEXT UNIQUE NOT NULL,
      meta TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Boards created before albums existed are singles.
  const boardCols = new Set((db.prepare('PRAGMA table_info(boards)').all() as { name: string }[]).map((c) => c.name));
  if (!boardCols.has('album_id')) db.exec('ALTER TABLE boards ADD COLUMN album_id TEXT');
  if (!boardCols.has('kind')) db.exec("ALTER TABLE boards ADD COLUMN kind TEXT NOT NULL DEFAULT 'single'");
  if (!boardCols.has('position')) db.exec('ALTER TABLE boards ADD COLUMN position REAL NOT NULL DEFAULT 0');
  db.exec('CREATE INDEX IF NOT EXISTS boards_album ON boards(album_id)');

  const q = {
    insertBoard: db.prepare('INSERT INTO boards (id, edit_id, meta, created_at, updated_at, album_id, kind, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    boardById: db.prepare('SELECT id, edit_id, meta, album_id, kind, position FROM boards WHERE id = ?'),
    boardByEdit: db.prepare('SELECT id, edit_id, meta, album_id, kind, position FROM boards WHERE edit_id = ?'),
    boardsInAlbum: db.prepare('SELECT id, edit_id, meta, album_id, kind, position FROM boards WHERE album_id = ? ORDER BY kind = \'song\', position, created_at'),
    setBoardAlbum: db.prepare('UPDATE boards SET album_id = ?, kind = ?, position = ? WHERE id = ?'),
    setBoardPosition: db.prepare('UPDATE boards SET position = ? WHERE id = ? AND album_id = ?'),
    insertAlbum: db.prepare('INSERT INTO albums (id, edit_id, meta, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'),
    albumById: db.prepare('SELECT id, edit_id, meta FROM albums WHERE id = ?'),
    albumByEdit: db.prepare('SELECT id, edit_id, meta FROM albums WHERE edit_id = ?'),
    updateAlbum: db.prepare('UPDATE albums SET meta = ?, updated_at = ? WHERE id = ?'),
    updateBoard: db.prepare('UPDATE boards SET meta = ?, updated_at = ? WHERE id = ?'),
    touchBoard: db.prepare('UPDATE boards SET updated_at = ? WHERE id = ?'),
    itemsForBoard: db.prepare('SELECT json FROM items WHERE board_id = ?'),
    itemById: db.prepare('SELECT json FROM items WHERE id = ? AND board_id = ?'),
    upsertItem: db.prepare(`
      INSERT INTO items (id, board_id, json, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at
      WHERE items.board_id = excluded.board_id
    `),
    deleteItem: db.prepare('DELETE FROM items WHERE id = ? AND board_id = ?'),
    insertFile: db.prepare('INSERT INTO files (id, board_id, name, mime, size, path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    fileById: db.prepare('SELECT id, board_id, name, mime, size, path FROM files WHERE id = ?'),
    allBoards: db.prepare('SELECT id, edit_id, meta, album_id, kind, position, created_at, updated_at FROM boards'),
    allAlbums: db.prepare('SELECT id, edit_id, meta, created_at, updated_at FROM albums'),
    allItems: db.prepare('SELECT board_id, json FROM items'),
    allFiles: db.prepare('SELECT id, board_id, size, path, created_at FROM files'),
    deleteBoardItems: db.prepare('DELETE FROM items WHERE board_id = ?'),
    deleteBoard: db.prepare('DELETE FROM boards WHERE id = ?'),
    deleteAlbum: db.prepare('DELETE FROM albums WHERE id = ?'),
    deleteFile: db.prepare('DELETE FROM files WHERE id = ?'),
  };

  type FileInfo = { id: string; boardId: string; size: number; path: string; createdAt: number };

  function fileIndex() {
    const files = new Map<string, FileInfo>();
    for (const r of q.allFiles.all() as Record<string, unknown>[]) {
      files.set(r.id as string, { id: r.id as string, boardId: r.board_id as string, size: r.size as number, path: r.path as string, createdAt: r.created_at as number });
    }
    return files;
  }

  /** File ids each board's cards point at. A pasted card can point at another board's upload. */
  function refsByBoard() {
    const refs = new Map<string, Set<string>>();
    for (const r of q.allItems.all() as { board_id: string; json: string }[]) {
      let set = refs.get(r.board_id);
      if (!set) refs.set(r.board_id, (set = new Set()));
      for (const id of fileRefs(r.json)) set.add(id);
    }
    return refs;
  }

  /** Deletes the given files from disk and the database if no card anywhere points at them. */
  function dropUnreferenced(candidates: Iterable<FileInfo>, refs: Map<string, Set<string>>) {
    const used = new Set<string>();
    for (const set of refs.values()) for (const id of set) used.add(id);
    let files = 0;
    let bytes = 0;
    for (const f of candidates) {
      if (used.has(f.id)) continue;
      q.deleteFile.run(f.id);
      fs.rmSync(f.path, { force: true });
      files++;
      bytes += f.size;
    }
    return { files, bytes };
  }

  function toBoard(row: Record<string, unknown> | undefined): BoardRow | null {
    if (!row) return null;
    return {
      id: row.id as string,
      editId: row.edit_id as string,
      meta: JSON.parse(row.meta as string),
      albumId: (row.album_id as string | null) ?? null,
      kind: ((row.kind as BoardKind) ?? 'single') as BoardKind,
      position: (row.position as number) ?? 0,
    };
  }

  function toAlbum(row: Record<string, unknown> | undefined): AlbumRow | null {
    if (!row) return null;
    return { id: row.id as string, editId: row.edit_id as string, meta: JSON.parse(row.meta as string) };
  }

  return {
    createBoard(id: string, editId: string, title: string, album?: { albumId: string; kind: 'song' | 'overview'; position: number }): BoardMeta {
      const now = Date.now();
      const meta: BoardMeta = { id, title, key: null, bpm: null, createdAt: now, updatedAt: now };
      q.insertBoard.run(id, editId, JSON.stringify(meta), now, now, album?.albumId ?? null, album?.kind ?? 'single', album?.position ?? 0);
      return meta;
    },

    board(id: string): BoardRow | null {
      return toBoard(q.boardById.get(id) as Record<string, unknown> | undefined);
    },

    // ---- Albums ----

    createAlbum(id: string, editId: string, title: string): AlbumMeta {
      const now = Date.now();
      const meta: AlbumMeta = { id, title, createdAt: now, updatedAt: now };
      q.insertAlbum.run(id, editId, JSON.stringify(meta), now, now);
      return meta;
    },

    album(id: string): AlbumRow | null {
      return toAlbum(q.albumById.get(id) as Record<string, unknown> | undefined);
    },

    resolveAlbum(token: string): { album: AlbumRow; canEdit: boolean } | null {
      const byEdit = toAlbum(q.albumByEdit.get(token) as Record<string, unknown> | undefined);
      if (byEdit) return { album: byEdit, canEdit: true };
      const byId = toAlbum(q.albumById.get(token) as Record<string, unknown> | undefined);
      if (byId) return { album: byId, canEdit: false };
      return null;
    },

    renameAlbum(album: AlbumRow, title: string) {
      const now = Date.now();
      album.meta = { ...album.meta, title: title.slice(0, 120), updatedAt: now };
      q.updateAlbum.run(JSON.stringify(album.meta), now, album.id);
      return album.meta;
    },

    /** Overview first, then songs in order. */
    albumBoards(albumId: string): BoardRow[] {
      return (q.boardsInAlbum.all(albumId) as Record<string, unknown>[]).map((r) => toBoard(r)!);
    },

    /** Moves a board into an album (or back out to a single with albumId null). */
    setBoardAlbum(boardId: string, albumId: string | null, kind: BoardKind, position: number) {
      q.setBoardAlbum.run(albumId, kind, position, boardId);
    },

    reorderSongs(albumId: string, songIds: string[]) {
      db.exec('BEGIN');
      try {
        songIds.forEach((id, i) => q.setBoardPosition.run(i + 1, id, albumId));
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    /** Resolves either a view id or an edit id. */
    resolve(token: string): { board: BoardRow; canEdit: boolean } | null {
      const byEdit = toBoard(q.boardByEdit.get(token) as Record<string, unknown> | undefined);
      if (byEdit) return { board: byEdit, canEdit: true };
      const byId = toBoard(q.boardById.get(token) as Record<string, unknown> | undefined);
      if (byId) return { board: byId, canEdit: false };
      return null;
    },

    items(boardId: string): AnyItem[] {
      return (q.itemsForBoard.all(boardId) as { json: string }[]).map((r) => JSON.parse(r.json));
    },

    /** Applies ops in one transaction. Returns the ops that actually applied. */
    applyOps(board: BoardRow, ops: Op[]): Op[] {
      const applied: Op[] = [];
      const now = Date.now();
      db.exec('BEGIN');
      try {
        for (const op of ops) {
          if (op.op === 'add') {
            const item = sanitizeItem(op.item, now);
            if (!item) continue;
            const json = JSON.stringify(item);
            if (json.length > MAX_ITEM_JSON) continue;
            q.upsertItem.run(item.id, board.id, json, now);
            applied.push({ op: 'add', item });
          } else if (op.op === 'update') {
            const row = q.itemById.get(op.id, board.id) as { json: string } | undefined;
            if (!row) continue;
            const item = JSON.parse(row.json) as AnyItem;
            const next = mergePatch(item, op.patch, now);
            const json = JSON.stringify(next);
            if (json.length > MAX_ITEM_JSON) continue;
            q.upsertItem.run(next.id, board.id, json, now);
            applied.push(op);
          } else if (op.op === 'remove') {
            q.deleteItem.run(op.id, board.id);
            applied.push(op);
          } else if (op.op === 'board') {
            board.meta = mergeBoard(board.meta, op.patch, now);
            q.updateBoard.run(JSON.stringify(board.meta), now, board.id);
            applied.push(op);
          }
        }
        q.touchBoard.run(now, board.id);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return applied;
    },

    insertFile(f: FileRow) {
      q.insertFile.run(f.id, f.boardId, f.name, f.mime, f.size, f.path, Date.now());
    },

    // ---- Admin ----

    storageReport(): StorageReport {
      const files = fileIndex();
      const refs = refsByBoard();
      const itemCounts = new Map<string, number>();
      for (const r of q.allItems.all() as { board_id: string }[]) itemCounts.set(r.board_id, (itemCounts.get(r.board_id) ?? 0) + 1);

      const boards = (q.allBoards.all() as Record<string, unknown>[]).map((r): StorageBoard => {
        const row = toBoard(r)!;
        // A board's footprint: what its cards point at, plus its own uploads no card uses yet.
        const ids = new Set(refs.get(row.id));
        for (const f of files.values()) if (f.boardId === row.id) ids.add(f.id);
        let bytes = 0;
        let count = 0;
        for (const id of ids) {
          const f = files.get(id);
          if (!f) continue;
          bytes += f.size;
          count++;
        }
        return {
          id: row.id,
          editId: row.editId,
          title: row.meta.title,
          kind: row.kind,
          albumId: row.albumId,
          position: row.position,
          createdAt: r.created_at as number,
          updatedAt: r.updated_at as number,
          items: itemCounts.get(row.id) ?? 0,
          files: count,
          bytes,
        };
      });

      const referenced = new Set<string>();
      for (const set of refs.values()) for (const id of set) referenced.add(id);
      const cutoff = Date.now() - UNUSED_GRACE_MS;
      const unused = { files: 0, bytes: 0 };
      let fileBytes = 0;
      for (const f of files.values()) {
        fileBytes += f.size;
        if (!referenced.has(f.id) && f.createdAt < cutoff) {
          unused.files++;
          unused.bytes += f.size;
        }
      }

      const albums = (q.allAlbums.all() as Record<string, unknown>[]).map((r) => {
        const a = toAlbum(r)!;
        return { id: a.id, editId: a.editId, title: a.meta.title, createdAt: r.created_at as number, updatedAt: r.updated_at as number };
      });
      return { boards, albums, fileBytes, unused };
    },

    /** Permanently deletes boards and any of their files no other board uses. */
    deleteBoards(ids: string[]) {
      const files = fileIndex();
      const before = refsByBoard();
      const candidates = new Map<string, FileInfo>();
      for (const id of ids) {
        for (const fid of before.get(id) ?? []) {
          const f = files.get(fid);
          if (f) candidates.set(fid, f);
        }
        for (const f of files.values()) if (f.boardId === id) candidates.set(f.id, f);
      }
      db.exec('BEGIN');
      try {
        for (const id of ids) {
          q.deleteBoardItems.run(id);
          q.deleteBoard.run(id);
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return dropUnreferenced(candidates.values(), refsByBoard());
    },

    /** Deletes an album with its album page and every song. */
    deleteAlbum(albumId: string) {
      const freed = this.deleteBoards(this.albumBoards(albumId).map((b) => b.id));
      q.deleteAlbum.run(albumId);
      return freed;
    },

    /** Deletes files no card has pointed at for a day. */
    pruneUnused() {
      const cutoff = Date.now() - UNUSED_GRACE_MS;
      const old = [...fileIndex().values()].filter((f) => f.createdAt < cutoff);
      return dropUnreferenced(old, refsByBoard());
    },

    file(id: string): FileRow | null {
      const r = q.fileById.get(id) as Record<string, unknown> | undefined;
      if (!r) return null;
      return {
        id: r.id as string,
        boardId: r.board_id as string,
        name: r.name as string,
        mime: r.mime as string,
        size: r.size as number,
        path: r.path as string,
      };
    },
  };
}

export type Db = ReturnType<typeof openDb>;

function num(v: unknown, fallback: number) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function sanitizeItem(raw: AnyItem, now: number): AnyItem | null {
  if (!raw || typeof raw.id !== 'string' || raw.id.length > 64 || !ITEM_TYPES.has(raw.type)) return null;
  if (!raw.data || typeof raw.data !== 'object') return null;
  return {
    ...raw,
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    w: Math.max(40, num(raw.w, 240)),
    h: Math.max(32, num(raw.h, 160)),
    z: num(raw.z, 0),
    createdAt: num(raw.createdAt, now),
    updatedAt: now,
  } as AnyItem;
}

function mergePatch(item: AnyItem, patch: ItemPatch, now: number): AnyItem {
  const next = { ...item, updatedAt: now } as AnyItem;
  for (const k of ['x', 'y', 'w', 'h', 'z'] as const) {
    if (typeof patch[k] === 'number' && Number.isFinite(patch[k])) next[k] = patch[k]!;
  }
  if (patch.data && typeof patch.data === 'object') {
    next.data = { ...item.data, ...patch.data } as AnyItem['data'];
  }
  return next;
}

function mergeBoard(meta: BoardMeta, patch: BoardPatch, now: number): BoardMeta {
  const next = { ...meta, updatedAt: now };
  if (typeof patch.title === 'string') next.title = patch.title.slice(0, 120);
  if (patch.key === null || typeof patch.key === 'string') next.key = patch.key;
  if (patch.bpm === null || (typeof patch.bpm === 'number' && patch.bpm >= 20 && patch.bpm <= 400)) next.bpm = patch.bpm;
  return next;
}
