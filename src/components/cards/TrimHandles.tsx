import { useState } from 'react';
import type { Trim } from '../../../shared/types';

/**
 * Start and end handles over a waveform or piano roll. Outside the trim is shaded.
 * Values are in the clip's own unit (seconds for audio, beats for MIDI).
 */
export function TrimHandles({
  total,
  trim,
  editable,
  minLength,
  snap,
  label,
  onChange,
}: {
  total: number;
  trim: Trim | null | undefined;
  editable: boolean;
  minLength: number;
  snap?: (v: number) => number;
  label: (v: number) => string;
  onChange: (trim: Trim | null) => void;
}) {
  const [live, setLive] = useState<Trim | null>(null);
  const [active, setActive] = useState<'start' | 'end' | null>(null);
  if (!total) return null;
  const t = live ?? { start: trim?.start ?? 0, end: Math.min(trim?.end ?? total, total) };
  const trimmed = t.start > 1e-4 || t.end < total - 1e-4;
  if (!editable && !trimmed) return null;
  const pct = (v: number) => `${(v / total) * 100}%`;

  const grab = (edge: 'start' | 'end') => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const handle = e.currentTarget;
    const box = handle.parentElement!.getBoundingClientRect();
    handle.setPointerCapture(e.pointerId);
    setActive(edge);
    let next = t;
    const move = (ev: PointerEvent) => {
      let v = ((ev.clientX - box.left) / box.width) * total;
      if (snap && !ev.altKey) v = snap(v);
      v = Math.max(0, Math.min(total, v));
      next = edge === 'start' ? { start: Math.min(v, t.end - minLength), end: t.end } : { start: t.start, end: Math.max(v, t.start + minLength) };
      setLive(next);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      setActive(null);
      setLive(null);
      const whole = next.start <= 1e-4 && next.end >= total - 1e-4;
      if (next.start !== t.start || next.end !== t.end) onChange(whole ? null : { start: next.start, end: next.end });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  return (
    <div className={`trim ${trimmed ? 'is-trimmed' : ''} ${active ? 'is-active' : ''}`}>
      <div className="trim-shade" style={{ left: 0, width: pct(t.start) }} />
      <div className="trim-shade" style={{ left: pct(t.end), right: 0 }} />
      {editable &&
        (['start', 'end'] as const).map((edge) => (
          <div
            key={edge}
            className={`trim-handle ${edge}`}
            style={{ left: pct(edge === 'start' ? t.start : t.end) }}
            data-nodrag
            role="slider"
            aria-label={edge === 'start' ? 'Trim start' : 'Trim end'}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={edge === 'start' ? t.start : t.end}
            aria-valuetext={label(edge === 'start' ? t.start : t.end)}
            title={edge === 'start' ? 'Drag to trim the start' : 'Drag to trim the end'}
            onPointerDown={grab(edge)}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => {
              // Double-click a handle to put that edge back.
              e.stopPropagation();
              const reset = edge === 'start' ? { start: 0, end: t.end } : { start: t.start, end: total };
              onChange(reset.start <= 1e-4 && reset.end >= total - 1e-4 ? null : reset);
            }}
          >
            {active === edge && <span className="trim-label">{label(edge === 'start' ? t.start : t.end)}</span>}
          </div>
        ))}
    </div>
  );
}
