import type { CSSProperties } from 'react';

// 24×24 stroke icons. Kept as path data so the bundle stays small.
const PATHS = {
  play: 'M8 5.5v13l10.5-6.5z',
  pause: 'M8 5h3v14H8zM13 5h3v14h-3z',
  stop: 'M7 7h10v10H7z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  text: 'M5 6h14M12 6v13M9 19h6',
  note: 'M5 4h14v11l-5 5H5zM14 20v-5h5',
  image: 'M4 5h16v14H4zM4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 18M15.5 9.5a1.5 1.5 0 1 0 0-.01',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  audio: 'M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0',
  midi: 'M3 6h18v12H3zM8 6v7M13 6v7M18 6v7M6 13h4M11 13h4M16 13h4',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  share: 'M12 15V3M7.5 7.5L12 3l4.5 4.5M5 12v7.5h14V12',
  download: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  more: 'M5.5 12h.01M12 12h.01M18.5 12h.01',
  loop: 'M17 2.5l3 3-3 3M20 5.5H8a4 4 0 0 0-4 4v1M7 21.5l-3-3 3-3M4 18.5h12a4 4 0 0 0 4-4v-1',
  layers: 'M12 3l9 5-9 5-9-5zM3 12.5l9 5 9-5M3 17l9 5 9-5',
  zoomIn: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8M10.5 7.5v6M7.5 10.5h6',
  zoomOut: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8M7.5 10.5h6',
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  metronome: 'M9 3h6l4 18H5zM12 17l5-9M7.5 14h9',
  trash: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5',
  copy: 'M9 9h11v11H9zM15 9V4H4v11h5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.5h.01',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2.3 2.3.7-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z',
  key: 'M8 12h12M17 12v3.5M20 12v2.5M8 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  tap: 'M9 11V5.5a2 2 0 0 1 4 0V11M13 9.5a2 2 0 0 1 4 0V12M17 11a2 2 0 0 1 4 0v3.5c0 4-2.5 6.5-6.5 6.5h-1c-2.5 0-4-1-5.5-3l-3-4.5a1.8 1.8 0 0 1 3-2L9 13',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  pencil: 'M15.5 4.5l4 4L8 20H4v-4zM13 7l4 4',
  home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5',
  filter: 'M4 5h16l-6 7.5V19l-4 1.5v-8z',
  dice: 'M5 5h14v14H5zM9 9h.01M15 15h.01M15 9h.01M9 15h.01M12 12h.01',
  record: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  wave: 'M2 12c2.5 0 2.5-6 5-6s2.5 12 5 12 2.5-12 5-12 2.5 6 5 6',
  piano: 'M4 4h16v16H4zM8.5 4v9M12 4v9M15.5 4v9M8.5 13v7M15.5 13v7M12 13v7',
} as const;

export type IconName = keyof typeof PATHS;

const FILLED = new Set<IconName>(['play', 'pause', 'stop', 'record']);

export function Icon({ name, size = 18, style, className, strokeWidth = 1.75 }: { name: IconName; size?: number; style?: CSSProperties; className?: string; strokeWidth?: number }) {
  const filled = FILLED.has(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      style={style}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
