import { useState } from 'react';
import { absoluteUrl, albumPackUrl, packUrl } from '../lib/api';
import { useAlbum } from '../store/album';
import { useBoard } from '../store/board';
import { Dialog } from './ui/Popover';
import { Icon } from './ui/Icon';
import { useUi } from './uiState';

function CopyField({ label, hint, url, tone }: { label: string; hint: string; url: string; tone: 'edit' | 'view' }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`share-field ${tone}`}>
      <div className="share-label">
        <Icon name={tone === 'edit' ? 'pencil' : 'eye'} size={15} />
        <div>
          <div className="sl-title">{label}</div>
          <div className="sl-hint">{hint}</div>
        </div>
      </div>
      <div className="share-row">
        <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label={label} />
        <button
          className="btn sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
            } catch {
              /* clipboard blocked; the field is selectable */
            }
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} size={15} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function PackLink({ href, title, hint }: { href: string; title: string; hint: string }) {
  return (
    <a className="share-pack" href={href} download>
      <Icon name="download" size={16} />
      <div>
        <div className="sl-title">{title}</div>
        <div className="sl-hint">{hint}</div>
      </div>
    </a>
  );
}

export function ShareDialog() {
  const { modal, close } = useUi();
  const viewId = useBoard((s) => s.viewId);
  const editId = useBoard((s) => s.editId);
  const token = useBoard((s) => s.token);
  const songTitle = useBoard((s) => s.board?.title);
  const album = useAlbum((s) => s.data);
  const albumToken = useAlbum((s) => s.token);
  const activeViewId = useAlbum((s) => s.activeViewId);
  const onSong = !!album && album.overview.viewId !== activeViewId;

  if (album)
    return (
      <Dialog open={modal === 'share'} onClose={close} title="Share">
        <div className="share">
          <div className="share-section">Whole album · {album.album.title}</div>
          <CopyField
            tone="view"
            label="Album view link"
            hint={`Opens the album page and all ${album.songs.length} song${album.songs.length === 1 ? '' : 's'}. Can listen, download and drag sounds out.`}
            url={absoluteUrl(`/a/${album.viewId}`)}
          />
          {album.editId && (
            <CopyField
              tone="edit"
              label="Album edit link — keep this one close"
              hint="Anyone with it can change every song, add songs and rename the album."
              url={absoluteUrl(`/a/${album.editId}`)}
            />
          )}
          <PackLink href={albumPackUrl(albumToken)} title="Download the whole album" hint="A zip with a folder per song (in order) plus the album page, each sorted by role." />

          {onSong && (
            <>
              <div className="share-section">Just this song · {songTitle}</div>
              <CopyField tone="view" label="Song view link" hint="Shows only this song. The rest of the album stays private." url={absoluteUrl(`/b/${viewId}`)} />
              {editId && <CopyField tone="edit" label="Song edit link" hint="Can change this song only." url={absoluteUrl(`/e/${editId}`)} />}
              <PackLink href={packUrl(token)} title="Download this song" hint="Just this song's sounds, MIDI and images, sorted by role." />
            </>
          )}
        </div>
      </Dialog>
    );

  return (
    <Dialog open={modal === 'share'} onClose={close} title="Share this board">
      <div className="share">
        <CopyField
          tone="view"
          label="View link"
          hint="Can listen, download and drag sounds into their DAW. Can't change anything."
          url={absoluteUrl(`/b/${viewId}`)}
        />
        {editId && (
          <CopyField
            tone="edit"
            label="Edit link — keep this one close"
            hint="Anyone with it can add, move and delete things. Changes show up live for everyone."
            url={absoluteUrl(`/e/${editId}`)}
          />
        )}
        <PackLink href={packUrl(token)} title="Download the whole board" hint="A zip of every sound, MIDI file and image, sorted into folders by role, with your notes and links." />
      </div>
    </Dialog>
  );
}
