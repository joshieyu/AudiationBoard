import type { AlbumBoardRef, AlbumPayload, BoardMeta, BoardPayload, FileRef, LinkMeta, Op } from '../../shared/types';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? `Request failed (${res.status})`), { status: res.status });
  return body as T;
}

export function createBoard(title?: string) {
  return req<{ viewId: string; editId: string; board: BoardMeta }>('/api/boards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
}

export function getBoard(token: string) {
  return req<BoardPayload>(`/api/boards/${encodeURIComponent(token)}`);
}

export function postOps(editId: string, ops: Op[], origin: string) {
  return req<{ applied: number; board: BoardMeta }>(`/api/boards/${encodeURIComponent(editId)}/ops`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ops, origin }),
    keepalive: JSON.stringify(ops).length < 60_000,
  });
}

export function uploadFile(editId: string, file: Blob & { name?: string }, onProgress?: (p: number) => void): Promise<FileRef> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/boards/${encodeURIComponent(editId)}/files`);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name ?? 'file'));
    if (file.type) xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new Error(body.error ?? `Upload failed (${xhr.status})`));
      } catch {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed — check your connection'));
    xhr.send(file);
  });
}

export function unfurl(url: string) {
  return req<LinkMeta>(`/api/unfurl?url=${encodeURIComponent(url)}`).catch(() => ({}) as LinkMeta);
}

export const packUrl = (token: string) => `/api/boards/${encodeURIComponent(token)}/pack.zip`;
export const albumPackUrl = (token: string) => `/api/albums/${encodeURIComponent(token)}/pack.zip`;

// ---- Albums ----

const jsonPost = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const createAlbum = (title?: string) => req<AlbumPayload>('/api/albums', jsonPost({ title }));
export const getAlbum = (token: string) => req<AlbumPayload>(`/api/albums/${encodeURIComponent(token)}`);
export const renameAlbumApi = (token: string, title: string) =>
  req<AlbumPayload>(`/api/albums/${encodeURIComponent(token)}`, { ...jsonPost({ title }), method: 'PATCH' });
export const addSongApi = (token: string, title?: string) =>
  req<{ song: AlbumBoardRef; album: AlbumPayload }>(`/api/albums/${encodeURIComponent(token)}/songs`, jsonPost({ title }));
export const reorderSongsApi = (token: string, songs: string[]) => req<AlbumPayload>(`/api/albums/${encodeURIComponent(token)}/order`, jsonPost({ songs }));
export const detachSongApi = (token: string, songViewId: string) =>
  req<AlbumPayload>(`/api/albums/${encodeURIComponent(token)}/songs/${encodeURIComponent(songViewId)}/detach`, jsonPost({}));
/** Turn a single into the first song of a new album. */
export const makeAlbumApi = (boardEditId: string, title: string) => req<AlbumPayload>(`/api/boards/${encodeURIComponent(boardEditId)}/album`, jsonPost({ title }));
export const downloadUrl = (f: FileRef) => `${f.url}?dl=1`;
export const absoluteUrl = (path: string) => new URL(path, location.origin).toString();
