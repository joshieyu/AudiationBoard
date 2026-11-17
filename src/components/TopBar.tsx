import { useRef, useState } from 'react';
import { albumPackUrl, packUrl } from '../lib/api';
import { identity, setName } from '../lib/identity';
import { sendHello } from '../lib/sync';
import { toggleTheme, useTheme } from '../lib/theme';
import { setBoardMeta } from '../store/actions';
import { useBoard } from '../store/board';
import { renameAlbum, useAlbum } from '../store/album';
import { Icon } from './ui/Icon';
import { Popover } from './ui/Popover';
import { useUi } from './uiState';

function SaveState() {
  const saving = useBoard((s) => s.saving);
  if (saving === 'idle') return <span className="save-state ok">Saved</span>;
  if (saving === 'saving') return <span className="save-state">Saving…</span>;
  return <span className="save-state err">Offline — retrying</span>;
}

function Presence() {
  const peers = useBoard((s) => s.peers);
  const me = identity();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setLocalName] = useState(me.name);
  const shown = peers.slice(0, 4);
  return (
    <>
      <button ref={ref} className="presence" onClick={() => setOpen((o) => !o)} title={peers.length ? `${peers.length + 1} here now` : 'Just you'}>
        <span className="avatar me" style={{ background: me.color }}>
          {me.name[0]}
        </span>
        {shown.map((p) => (
          <span key={p.id} className="avatar" style={{ background: p.color }} title={`${p.name}${p.canEdit ? '' : ' (viewing)'}`}>
            {p.name[0]}
          </span>
        ))}
        {peers.length > shown.length && <span className="avatar more">+{peers.length - shown.length}</span>}
      </button>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} width={260}>
        <div className="menu">
          <div className="menu-title">You appear as</div>
          <form
            className="name-form"
            onSubmit={(e) => {
              e.preventDefault();
              setName(name);
              sendHello();
              setOpen(false);
            }}
          >
            <span className="avatar me" style={{ background: me.color }}>
              {name[0] ?? '?'}
            </span>
            <input value={name} onChange={(e) => setLocalName(e.target.value)} maxLength={40} aria-label="Your display name" />
          </form>
          {peers.length > 0 && <div className="menu-title">Here now</div>}
          {peers.map((p) => (
            <div key={p.id} className="menu-item static">
              <span className="avatar sm" style={{ background: p.color }}>
                {p.name[0]}
              </span>
              {p.name}
              <span className="mi-sub right">{p.canEdit ? 'editing' : 'viewing'}</span>
            </div>
          ))}
        </div>
      </Popover>
    </>
  );
}

function EditableTitle({ value, editable, onCommit, label, className = '' }: { value: string; editable: boolean; onCommit: (v: string) => void; label: string; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (!editable)
    return (
      <h1 className={`board-title static ${className}`} title={value}>
        {value}
      </h1>
    );
  const shown = draft ?? value;
  return (
    <input
      className={`board-title ${className}`}
      value={shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft.trim() && draft !== value) onCommit(draft.trim());
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
        e.stopPropagation();
      }}
      aria-label={label}
      size={Math.max(6, Math.min(28, shown.length + 1))}
    />
  );
}

export function TopBar() {
  const board = useBoard((s) => s.board);
  const editable = useBoard((s) => s.access === 'edit');
  const token = useBoard((s) => s.token);
  const theme = useTheme((s) => s.theme);
  const open = useUi((s) => s.open);
  const kind = useBoard((s) => s.kind);
  const albumTitle = useBoard((s) => s.albumTitle);
  const album = useAlbum((s) => s.data);
  const albumToken = useAlbum((s) => s.token);
  const activeViewId = useAlbum((s) => s.activeViewId);
  const isOverview = !!album && album.overview.viewId === activeViewId;

  return (
    <header className="topbar">
      <div className="tb-left panel">
        <a className="logo" href="/" title="Audiation Space · all boards" aria-label="Audiation Space home">
          <span className="logo-mark" aria-hidden>
            <i />
            <i />
            <i />
            <i />
          </span>
        </a>
        {album ? (
          <>
            <EditableTitle className="album" value={album.album.title} editable={album.access === 'edit'} onCommit={(t) => void renameAlbum(t)} label="Album title" />
            {isOverview ? (
              <span className="crumb-tag">Album page</span>
            ) : (
              <>
                <span className="crumb-sep" aria-hidden>
                  /
                </span>
                <EditableTitle className="song" value={board?.title ?? ''} editable={editable} onCommit={(t) => setBoardMeta({ title: t })} label="Song title" />
              </>
            )}
          </>
        ) : (
          <>
            <EditableTitle value={board?.title ?? ''} editable={editable} onCommit={(t) => setBoardMeta({ title: t })} label="Board title" />
            {albumTitle && kind !== 'single' && (
              <span className="crumb-tag hide-sm" title="Opened with this song's own link, so the album's other songs aren't shown">
                from {albumTitle}
              </span>
            )}
          </>
        )}
        {editable ? <SaveState /> : <span className="view-badge"><Icon name="eye" size={13} /> View only</span>}
        {!album && editable && kind === 'single' && (
          <button className="btn ghost sm make-album-btn" onClick={() => open('album')} title="Turn this into an album: this board becomes song 1">
            <Icon name="layers" size={15} />
            <span className="hide-sm">Make album</span>
          </button>
        )}
      </div>
      <div className="tb-right panel">
        <Presence />
        <button className="icon-btn" onClick={toggleTheme} title={theme === 'dark' ? 'Light mode' : 'Dark mode'} aria-label="Toggle theme">
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
        </button>
        <a
          className="btn ghost sm hide-sm"
          href={album ? albumPackUrl(albumToken) : packUrl(token)}
          download
          title={album ? 'The whole album in a zip: a folder per song, sorted by role' : 'Every sound, MIDI file and image in a zip, sorted into folders by role'}
        >
          <Icon name="download" size={15} /> Pack
        </a>
        <button className="btn primary sm" onClick={() => open('share')}>
          <Icon name="share" size={15} /> Share
        </button>
      </div>
    </header>
  );
}
