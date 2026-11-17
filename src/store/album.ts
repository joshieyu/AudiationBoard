import { create } from 'zustand';
import type { AlbumBoardRef, AlbumPayload } from '../../shared/types';
import { addSongApi, detachSongApi, getAlbum, renameAlbumApi, reorderSongsApi } from '../lib/api';
import { rememberBoard } from '../lib/identity';
import { navigate } from '../router';
import { toast } from '../components/ui/toast';

interface AlbumState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  /** The token in the URL (album edit or view id). */
  token: string;
  data: AlbumPayload | null;
  /** View id of the board showing in the album right now. */
  activeViewId: string | null;
}

export const useAlbum = create<AlbumState>(() => ({ status: 'idle', token: '', data: null, activeViewId: null }));

/** The token to open a board of this album with: edit when we have it. */
export const boardToken = (ref: AlbumBoardRef) => ref.editId ?? ref.viewId;

export function albumHref(token: string, songViewId?: string | null) {
  return songViewId ? `/a/${token}/${songViewId}` : `/a/${token}`;
}

function remember(p: AlbumPayload) {
  rememberBoard({ viewId: p.viewId, editId: p.editId, title: p.album.title, openedAt: Date.now(), kind: 'album', songs: p.songs.length });
}

export async function loadAlbum(token: string) {
  if (useAlbum.getState().token !== token) useAlbum.setState({ status: 'loading', token, data: null, error: undefined });
  try {
    const data = await getAlbum(token);
    useAlbum.setState({ status: 'ready', data });
    remember(data);
  } catch (err) {
    useAlbum.setState({ status: 'error', error: (err as Error).message });
  }
}

export async function refreshAlbum() {
  const { token, status } = useAlbum.getState();
  if (!token || status !== 'ready') return;
  try {
    useAlbum.setState({ data: await getAlbum(token) });
  } catch {
    /* keep what we have */
  }
}

export function leaveAlbum() {
  useAlbum.setState({ status: 'idle', token: '', data: null, activeViewId: null });
}

/** Keep tab labels in step with the open board's title/key/tempo without a refetch. */
export function patchBoardRef(viewId: string, patch: Partial<Pick<AlbumBoardRef, 'title' | 'key' | 'bpm'>>) {
  const data = useAlbum.getState().data;
  if (!data) return;
  const up = (r: AlbumBoardRef) => (r.viewId === viewId ? { ...r, ...patch } : r);
  const next = { ...data, overview: up(data.overview), songs: data.songs.map(up) };
  if (JSON.stringify(next) !== JSON.stringify(data)) useAlbum.setState({ data: next });
}

export async function addSong() {
  const { token } = useAlbum.getState();
  try {
    const { song, album } = await addSongApi(token);
    useAlbum.setState({ data: album });
    remember(album);
    navigate(albumHref(token, song.viewId));
    return song;
  } catch (err) {
    toast((err as Error).message, 'error');
    return null;
  }
}

export async function renameAlbum(title: string) {
  const { token, data } = useAlbum.getState();
  if (!data || !title.trim() || title === data.album.title) return;
  useAlbum.setState({ data: { ...data, album: { ...data.album, title } } });
  try {
    const next = await renameAlbumApi(token, title);
    useAlbum.setState({ data: next });
    remember(next);
  } catch (err) {
    toast((err as Error).message, 'error');
    void refreshAlbum();
  }
}

export async function moveSong(viewId: string, delta: -1 | 1) {
  const { token, data } = useAlbum.getState();
  if (!data) return;
  const ids = data.songs.map((s) => s.viewId);
  const i = ids.indexOf(viewId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  // Optimistic: reorder the tabs now.
  const byId = new Map(data.songs.map((s) => [s.viewId, s]));
  useAlbum.setState({ data: { ...data, songs: ids.map((id) => byId.get(id)!) } });
  try {
    useAlbum.setState({ data: await reorderSongsApi(token, ids) });
  } catch (err) {
    toast((err as Error).message, 'error');
    void refreshAlbum();
  }
}

export async function detachSong(viewId: string) {
  const { token, activeViewId } = useAlbum.getState();
  try {
    const data = await detachSongApi(token, viewId);
    useAlbum.setState({ data });
    remember(data);
    if (activeViewId === viewId) navigate(albumHref(token));
    toast('Moved out of the album. It’s a single again and its own links still work.', 'info', 4200);
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}
