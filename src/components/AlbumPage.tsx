import { useEffect, useRef, useState } from 'react';
import type { AlbumBoardRef } from '../../shared/types';
import { absoluteUrl } from '../lib/api';
import { parseKey, keyShort } from '../lib/music';
import { onAlbumChanged } from '../lib/sync';
import { replaceRoute, navigate } from '../router';
import { addSong, albumHref, boardToken, detachSong, leaveAlbum, loadAlbum, moveSong, patchBoardRef, refreshAlbum, useAlbum } from '../store/album';
import { useBoard } from '../store/board';
import { BoardPage } from './BoardPage';
import { RoleIcon } from './SoundGlyphs';
import { Icon } from './ui/Icon';
import { Popover } from './ui/Popover';
import { toast } from './ui/toast';

function SongTab({ song, index, active, editable, count }: { song: AlbumBoardRef; index: number; active: boolean; editable: boolean; count: number }) {
  const token = useAlbum((s) => s.token);
  const ref = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLSpanElement>(null);
  const [menu, setMenu] = useState(false);
  const key = parseKey(song.key);
  const meta = [key ? keyShort(key) : null, song.bpm ? `${song.bpm}` : null].filter(Boolean).join(' · ');

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [active]);

  return (
    <>
      <button ref={ref} className={`atab ${active ? 'on' : ''}`} onClick={() => navigate(albumHref(token, song.viewId))} title={song.title}>
        <span className="atab-n mono">{index + 1}</span>
        <span className="atab-title">{song.title}</span>
        {meta && <span className="atab-meta mono">{meta}</span>}
        {active && (
          <span
            ref={menuRef}
            className="atab-menu"
            role="button"
            aria-label="Song options"
            onClick={(e) => {
              e.stopPropagation();
              setMenu((m) => !m);
            }}
          >
            <Icon name="more" size={14} strokeWidth={2.4} />
          </span>
        )}
      </button>
      <Popover anchor={menuRef.current} open={menu} onClose={() => setMenu(false)} width={230}>
        <div className="menu" onClick={() => setMenu(false)}>
          {editable && (
            <button className="menu-item" onClick={() => (document.querySelector('.board-title.song') as HTMLInputElement | null)?.focus()}>
              <Icon name="pencil" size={15} /> Rename
            </button>
          )}
          {editable && (
            <button className="menu-item" disabled={index === 0} onClick={() => moveSong(song.viewId, -1)}>
              <Icon name="chevronRight" size={15} style={{ rotate: '180deg' }} /> Move earlier
            </button>
          )}
          {editable && (
            <button className="menu-item" disabled={index === count - 1} onClick={() => moveSong(song.viewId, 1)}>
              <Icon name="chevronRight" size={15} /> Move later
            </button>
          )}
          <button
            className="menu-item"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(absoluteUrl(`/b/${song.viewId}`));
                toast('Copied a view link for just this song');
              } catch {
                toast('Couldn’t copy — use Share instead', 'error');
              }
            }}
          >
            <Icon name="copy" size={15} /> Copy link to this song only
          </button>
          {editable && (
            <>
              <div className="menu-sep" />
              <button className="menu-item danger" onClick={() => detachSong(song.viewId)} title="Nothing is deleted: it becomes a single again">
                <Icon name="external" size={15} /> Move out of album
              </button>
            </>
          )}
        </div>
      </Popover>
    </>
  );
}

function AlbumTabs() {
  const data = useAlbum((s) => s.data)!;
  const token = useAlbum((s) => s.token);
  const active = useAlbum((s) => s.activeViewId);
  const editable = data.access === 'edit';
  const [adding, setAdding] = useState(false);
  return (
    <nav className="album-tabs panel" aria-label="Album songs">
      <button className={`atab overview ${active === data.overview.viewId ? 'on' : ''}`} onClick={() => navigate(albumHref(token))} title="Ideas for the whole album">
        <RoleIcon role="mix" size={15} />
        <span className="atab-title">Album</span>
      </button>
      <span className="atab-div" aria-hidden />
      <div className="atab-scroll">
        {data.songs.map((s, i) => (
          <SongTab key={s.viewId} song={s} index={i} active={active === s.viewId} editable={editable} count={data.songs.length} />
        ))}
        {data.songs.length === 0 && <span className="atab-empty">No songs yet</span>}
        {editable && (
          <button
            className="atab add"
            disabled={adding}
            onClick={async () => {
              setAdding(true);
              await addSong();
              setAdding(false);
            }}
            title="Add a song to the album"
          >
            {adding ? <span className="spinner" /> : <Icon name="plus" size={15} />}
            <span>Song</span>
          </button>
        )}
      </div>
    </nav>
  );
}

export function AlbumPage({ token, song }: { token: string; song: string | null }) {
  const status = useAlbum((s) => s.status);
  const error = useAlbum((s) => s.error);
  const data = useAlbum((s) => s.data);

  useEffect(() => {
    void loadAlbum(token);
  }, [token]);
  useEffect(() => () => leaveAlbum(), []);
  // Collaborators adding, renaming or reordering songs.
  useEffect(() => onAlbumChanged(() => void refreshAlbum()), []);
  useEffect(() => {
    const onFocus = () => void refreshAlbum();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  // The open board's title/key/tempo show on its tab.
  useEffect(
    () =>
      useBoard.subscribe((s) => {
        if (s.board && s.viewId && s.status === 'ready') patchBoardRef(s.viewId, { title: s.board.title, key: s.board.key, bpm: s.board.bpm });
      }),
    [],
  );
  useEffect(() => {
    document.body.classList.add('has-album');
    return () => document.body.classList.remove('has-album');
  }, []);

  const active = data ? (song ? data.songs.find((s) => s.viewId === song) ?? null : data.overview) : null;
  useEffect(() => {
    // A song that was moved out (or a stale link) falls back to the album page.
    if (data && song && !active) replaceRoute(albumHref(token));
  }, [data, song, active, token]);
  useEffect(() => {
    useAlbum.setState({ activeViewId: active?.viewId ?? null });
  }, [active?.viewId]);

  if (status === 'error')
    return (
      <div className="page-message">
        <div className="empty-card">
          <h2>{error === 'Album not found' ? 'This album doesn’t exist' : 'Couldn’t open the album'}</h2>
          <p>{error === 'Album not found' ? 'The link may be mistyped, or the album was never created on this server.' : error}</p>
          <a className="btn primary" href="/">
            <Icon name="home" size={16} /> Go to your boards
          </a>
        </div>
      </div>
    );

  if (!data || !active)
    return (
      <div className="board-page">
        <div className="loading-veil">
          <span className="spinner lg" />
        </div>
      </div>
    );

  return (
    <>
      <BoardPage key={boardToken(active)} token={boardToken(active)} inAlbum />
      <AlbumTabs />
    </>
  );
}
