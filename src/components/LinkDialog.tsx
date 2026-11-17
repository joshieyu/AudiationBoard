import { useState } from 'react';
import { addLink } from '../store/actions';
import { embedFor, normalizeUrl, PROVIDER_LABEL } from '../lib/embeds';
import { Dialog } from './ui/Popover';
import { useUi } from './uiState';

export function LinkDialog() {
  const { modal, close } = useUi();
  const [value, setValue] = useState('');
  const url = normalizeUrl(value);
  const embed = url ? embedFor(url) : null;
  const submit = () => {
    if (!url) return;
    void addLink(url);
    setValue('');
    close();
  };
  return (
    <Dialog open={modal === 'link'} onClose={close} title="Add a link">
      <form
        className="link-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          autoFocus
          placeholder="Paste a YouTube, Spotify, SoundCloud, Apple Music or any web link"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Link URL"
        />
        <p className="link-preview">
          {embed ? (
            <>Plays inline as a {PROVIDER_LABEL[embed.provider]} player.</>
          ) : url ? (
            <>Shows as a preview card with the page's title and image.</>
          ) : (
            <>Tip: you can also just paste a link anywhere on the board.</>
          )}
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={!url}>
            Add to board
          </button>
        </div>
      </form>
    </Dialog>
  );
}
