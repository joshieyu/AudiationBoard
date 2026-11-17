import { useEffect, useState } from 'react';
import type { PendingItem } from '../../store/board';
import { Icon } from '../ui/Icon';

const LISTENING = ['Finding the tempo', 'Listening for the key', 'Measuring the envelope', 'Checking for grit', 'Sorting the role'];

export function PendingCard({ p }: { p: PendingItem }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (p.stage !== 'analyzing') return;
    const t = setInterval(() => tick((n) => n + 1), 700);
    return () => clearInterval(t);
  }, [p.stage]);
  const pct = Math.round(p.progress * 100);
  const msg =
    p.stage === 'error'
      ? p.error ?? 'Upload failed'
      : p.stage === 'uploading'
        ? `Uploading · ${pct}%`
        : p.type === 'audio'
          ? LISTENING[Math.floor(Date.now() / 700) % LISTENING.length]
          : 'Finishing up';
  return (
    <div className={`frame pending ${p.stage}`} style={{ transform: `translate(${p.x}px, ${p.y}px)`, width: p.w, height: p.h }}>
      <div className="card pending-card">
        <div className="pending-icon">
          <Icon name={p.type === 'midi' ? 'piano' : p.type === 'image' ? 'image' : 'wave'} size={20} />
        </div>
        <div className="pending-name" title={p.name}>
          {p.name}
        </div>
        <div className="pending-msg">{msg}</div>
        {p.stage !== 'error' && (
          <div className="pending-bar">
            <div className={p.stage === 'analyzing' ? 'indeterminate' : ''} style={{ width: p.stage === 'analyzing' ? '100%' : `${pct}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
