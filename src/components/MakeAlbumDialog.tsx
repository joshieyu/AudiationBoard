import { useEffect, useState } from 'react';
import { makeAlbumApi } from '../lib/api';
import { forgetBoard, rememberBoard } from '../lib/identity';
import { navigate } from '../router';
import { albumHref } from '../store/album';
import { useBoard } from '../store/board';
import { Dialog } from './ui/Popover';
import { Icon } from './ui/Icon';
import { useUi } from './uiState';

/** Turn the open single into song 1 of a new album. */
export function MakeAlbumDialog() {
  const { modal, close } = useUi();
  const board = useBoard((s) => s.board);
  const editId = useBoard((s) => s.editId);
  const viewId = useBoard((s) => s.viewId);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = modal === 'album';

  useEffect(() => {
    if (open) {
      setTitle(board?.title ?? '');
      setError(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!editId) return;
    setBusy(true);
    setError(null);
    try {
      const album = await makeAlbumApi(editId, title.trim() || board?.title || 'Untitled album');
      forgetBoard(viewId);
      rememberBoard({ viewId: album.viewId, editId: album.editId, title: album.album.title, openedAt: Date.now(), kind: 'album', songs: album.songs.length });
      close();
      navigate(albumHref(album.editId ?? album.viewId, viewId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} title="Make it an album">
      <form
        className="make-album"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span>Album title</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Untitled album" />
        </label>
        <ul className="make-album-points">
          <li>
            <Icon name="note" size={15} />
            <span>
              <b>{board?.title || 'This board'}</b> becomes the first song, with everything on it.
            </span>
          </li>
          <li>
            <Icon name="layers" size={15} />
            <span>You get an album page for ideas that cover the whole record, and tabs to add more songs.</span>
          </li>
          <li>
            <Icon name="link" size={15} />
            <span>Links you've already shared keep working and still show just this song.</span>
          </li>
        </ul>
        {error && <p className="form-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? <span className="spinner" /> : <Icon name="layers" size={15} />} Make album
          </button>
        </div>
      </form>
    </Dialog>
  );
}
