import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Item } from '../../../shared/types';

export function ImageCard({ item }: { item: Item<'image'> }) {
  const [loaded, setLoaded] = useState(false);
  const [zoom, setZoom] = useState(false);
  return (
    <div className="card image-card" onDoubleClick={() => setZoom(true)}>
      {!loaded && <div className="img-skeleton" />}
      <img src={item.data.file.url} alt={item.data.caption ?? item.data.file.name} draggable={false} loading="lazy" onLoad={() => setLoaded(true)} style={{ opacity: loaded ? 1 : 0 }} />
      {zoom &&
        createPortal(
          <div className="lightbox" onClick={() => setZoom(false)} onKeyDown={(e) => e.key === 'Escape' && setZoom(false)} tabIndex={-1} ref={(el) => el?.focus()}>
            <img src={item.data.file.url} alt={item.data.file.name} />
          </div>,
          document.body,
        )}
    </div>
  );
}
