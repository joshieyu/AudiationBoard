import { useState } from 'react';
import type { Item } from '../../../shared/types';
import { PROVIDER_LABEL } from '../../lib/embeds';
import { Icon } from '../ui/Icon';

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const PROVIDER_DOT: Record<string, string> = {
  youtube: '#ff3b30',
  spotify: '#1ed760',
  soundcloud: '#ff5500',
  apple: '#fa2d48',
  vimeo: '#1ab7ea',
  bandcamp: '#1da0c3',
};

export function LinkCard({ item }: { item: Item<'link'> }) {
  const { url, embed, meta } = item.data;
  const [active, setActive] = useState(false);
  const title = meta?.title ?? (embed ? `${PROVIDER_LABEL[embed.provider]} ${embed.kind ?? ''}`.trim() : host(url));

  const header = (
    <div className="link-head">
      <span className="provider-dot" style={{ background: embed ? PROVIDER_DOT[embed.provider] : 'var(--text-3)' }} />
      <span className="link-title" title={title}>
        {title}
      </span>
      <a className="icon-btn sm" href={url} target="_blank" rel="noopener noreferrer" data-nodrag title="Open in a new tab" onClick={(e) => e.stopPropagation()}>
        <Icon name="external" size={14} />
      </a>
    </div>
  );

  if (embed && (embed.provider === 'youtube' || embed.provider === 'vimeo')) {
    return (
      <div className="card link-card video">
        {header}
        <div className="video-box">
          {active ? (
            <iframe src={embed.src} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
          ) : (
            <button className="video-facade" data-nodrag onClick={(e) => { e.stopPropagation(); setActive(true); }} aria-label={`Play ${title}`}>
              {embed.thumb && <img src={embed.thumb} alt="" draggable={false} loading="lazy" />}
              <span className="big-play">
                <Icon name="play" size={22} />
              </span>
            </button>
          )}
        </div>
      </div>
    );
  }

  if (embed) {
    // The player already shows the title, so the header just names the source.
    // Players pick their layout from their exact height (Spotify drops to its
    // compact view below 152px), so the iframe keeps its native height and the
    // header absorbs any slack in the card.
    return (
      <div className="card link-card player">
        <div className="link-head">
          <span className="provider-dot" style={{ background: PROVIDER_DOT[embed.provider] }} />
          <span className="link-title provider" title={title}>
            {PROVIDER_LABEL[embed.provider]}
            {embed.kind && <span className="dim"> · {embed.kind}</span>}
          </span>
          <a className="icon-btn sm" href={url} target="_blank" rel="noopener noreferrer" data-nodrag title="Open in a new tab" onClick={(e) => e.stopPropagation()}>
            <Icon name="external" size={14} />
          </a>
        </div>
        <div className="player-well">
          <iframe src={embed.src} title={title} style={{ height: embed.height }} allow="autoplay; encrypted-media; clipboard-write; fullscreen; picture-in-picture" loading="lazy" />
        </div>
      </div>
    );
  }

  return (
    <div className="card link-card rich">
      {meta?.image && (
        <div className="link-img">
          <img src={meta.image} alt="" draggable={false} loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
        </div>
      )}
      <div className="link-body">
        <div className="link-site">
          <img className="favicon" alt="" src={`https://www.google.com/s2/favicons?domain=${host(url)}&sz=32`} draggable={false} />
          {meta?.siteName ?? host(url)}
        </div>
        <a className="link-name" href={url} target="_blank" rel="noopener noreferrer" data-nodrag onClick={(e) => e.stopPropagation()}>
          {title}
        </a>
        {meta?.description && <p className="link-desc">{meta.description}</p>}
      </div>
    </div>
  );
}
