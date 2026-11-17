import { useRef, useState } from 'react';
import type { Item } from '../../../shared/types';
import { engine, usePlayback } from '../../audio/engine';
import { ROLES, roleVars } from '../../lib/colors';
import { updateItem } from '../../store/actions';
import { useBoard } from '../../store/board';
import { Waveform } from '../Waveform';
import { fmtTime, usePlayhead } from '../usePlayhead';
import { BpmBadge, DawHandle, KeyBadge, LayerButton, LoopButton, PlayButton, SignatureRow } from './SoundParts';
import { InlineTitle } from './InlineTitle';

const KIND_LABEL = { oneshot: 'One-shot', loop: 'Loop', phrase: 'Phrase', song: 'Song' } as const;

export function AudioCard({ item }: { item: Item<'audio'> }) {
  const d = item.data;
  const tags = d.tags;
  const role = tags?.role.v ?? 'other';
  const editable = useBoard((s) => s.access === 'edit');
  const progress = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  usePlayhead(item.id, progress, head, time);

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const st = usePlayback.getState().playing[item.id];
    const others = Object.keys(usePlayback.getState().playing).some((id) => id !== item.id);
    void engine.play(item, { layer: st ? st.layered || others : e.shiftKey && others, from: f * d.duration, loop: st?.loop });
  };

  const bars = d.analysis?.bars;
  const sub = [ROLES[role].label, tags ? KIND_LABEL[tags.kind.v] : null, bars && tags?.kind.v === 'loop' ? `${bars} bar${bars === 1 ? '' : 's'}` : null, d.recorded ? 'Memo' : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="card sound-card" style={roleVars(role) as React.CSSProperties} data-role={role}>
      <div className="sc-head">
        <PlayButton item={item} />
        <div className="sc-title">
          <InlineTitle value={d.title ?? d.file.name} editable={editable} onChange={(title) => updateItem(item.id, { data: { title } })} />
          <div className="sc-sub">
            {sub}
            <span className="sc-time">
              <span ref={time} className="now" />
              {fmtTime(d.duration)}
            </span>
          </div>
        </div>
        <DawHandle file={d.file} />
      </div>
      {d.status === 'error' ? (
        <div className="sc-error">{d.error}</div>
      ) : (
        <>
          <SignatureRow item={item} envShape={d.analysis?.envShape} />
          <div
            className="sc-wave"
            data-nodrag
            onClick={seek}
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setHover((e.clientX - r.left) / r.width);
            }}
            onPointerLeave={() => setHover(null)}
          >
            <Waveform peaks={d.peaks} style={{ role, source: tags?.source.v ?? 'hybrid', character: tags?.character.v ?? 'clean' }} progressRef={progress} />
            <div className="playhead" ref={head} />
            {hover !== null && (
              <div className="hover-line" style={{ left: `${hover * 100}%` }}>
                <span>{fmtTime(hover * d.duration)}</span>
              </div>
            )}
          </div>
        </>
      )}
      <div className="sc-foot">
        <KeyBadge tags={tags} />
        <BpmBadge tags={tags} />
        <span className="spacer" />
        {d.status !== 'error' && (
          <>
            <LoopButton item={item} canEdit={editable} onChange={(loop) => updateItem(item.id, { data: { loop } }, false)} />
            <LayerButton item={item} />
          </>
        )}
      </div>
    </div>
  );
}
