import type { Brightness, Character, Role, Source } from '../../shared/types';

// Icons for each axis of the visual language. 20×20 viewBox, currentColor.

const ROLE_PATHS: Record<Role, string> = {
  // a rising melodic line ending in a note head
  lead: 'M3 15l4-4 3 2.5 4.5-6M15.5 5.5a2 2 0 1 0 .01 0',
  // stacked keys
  chords: 'M4 5.5h12M4 10h12M4 14.5h12M7 5.5v9M13 5.5v9',
  // soft layered swells
  pad: 'M2.5 12c2.5-4 5-4 7.5 0s5 4 7.5 0M2.5 8c2.5-3 5-3 7.5 0s5 3 7.5 0',
  // one heavy low wave
  bass: 'M2.5 10c1.9-6 3.8-6 5.6 0s3.8 6 5.6 0 2.7-4 3.8-3',
  // drum head + stick
  drums: 'M3.5 9.5c0 1.9 2.9 3.5 6.5 3.5s6.5-1.6 6.5-3.5S13.6 6 10 6 3.5 7.6 3.5 9.5zM3.5 9.5V14c0 1.9 2.9 3.5 6.5 3.5s6.5-1.6 6.5-3.5V9.5M12 3l5 3.5',
  vocal: 'M10 2.5a2.5 2.5 0 0 0-2.5 2.5v4.5a2.5 2.5 0 0 0 5 0V5A2.5 2.5 0 0 0 10 2.5zM5 9a5 5 0 0 0 10 0M10 14v3.5',
  fx: 'M10 2.5l1.6 4.3 4.4 1.7-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.7zM15.5 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z',
  // vinyl
  mix: 'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM10 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM10 5.5a4.5 4.5 0 0 0-4.5 4.5',
  other: 'M3 10h1.5M6 7v6M9 4.5v11M12 7.5v5M15 6v8M17.5 10H17',
};

export function RoleIcon({ role, size = 16 }: { role: Role; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ROLE_PATHS[role] ?? ROLE_PATHS.other} />
    </svg>
  );
}

export function SourceIcon({ source, size = 16 }: { source: Source; size?: number }) {
  const d =
    source === 'acoustic'
      ? 'M2 10c2-5 4-5 6 0s4 5 6 0 3-4 4-3'
      : source === 'electronic'
        ? 'M2 13V7h4v6h4V7h4v6h4'
        : 'M2 10c1.5-4 3-4 4.5 0S9 13 10 13V7h4v6h4';
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function CharacterIcon({ character, size = 16 }: { character: Character; size?: number }) {
  const d =
    character === 'clean'
      ? 'M2 10c2-6 4-6 6 0s4 6 6 0 3-4 4-4'
      : character === 'driven'
        ? 'M2 10c1-4 2-5.5 3-5.5h1.5C8 4.5 8 15.5 9.5 15.5H11c1.5 0 2-11 3.5-11H16c1 0 1.5 3 2 5.5'
        : 'M2 10V4.5h5v11h5v-11h5V10M15.5 2.5l1.5 2M17.5 1.5v2.5';
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function BrightnessIcon({ brightness, size = 16 }: { brightness: Brightness; size?: number }) {
  if (brightness === 'dark')
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M16 12.5A6.5 6.5 0 1 1 7.5 4a5.2 5.2 0 0 0 8.5 8.5z" />
      </svg>
    );
  if (brightness === 'bright')
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
        <circle cx="10" cy="10" r="3.2" />
        <path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3L6 14M14 6l1.3-1.3" />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
      <circle cx="10" cy="10" r="6" />
      <path d="M10 4a6 6 0 0 1 0 12z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** The measured (or archetypal) note envelope, drawn like a tiny ADSR. */
export function EnvelopeGlyph({ shape, width = 34, height = 16 }: { shape: number[]; width?: number; height?: number }) {
  const pts = shape.length ? shape : [0, 1, 0];
  const pad = 1.5;
  const step = (width - pad * 2) / Math.max(1, pts.length - 1);
  const y = (v: number) => height - pad - Math.max(0, Math.min(1, v)) * (height - pad * 2);
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${(pad + i * step).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${(pad + (pts.length - 1) * step).toFixed(1)} ${height - pad} L${pad} ${height - pad}Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="env-glyph">
      <path d={area} fill="currentColor" opacity={0.18} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
