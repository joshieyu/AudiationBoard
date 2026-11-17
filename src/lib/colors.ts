import type { Brightness, Character, Envelope, Role, Source } from '../../shared/types';

// The visual language: hue = role, waveform style = source, edge treatment = character,
// lightness per column = brightness, glyph = envelope.

export interface RoleMeta {
  label: string;
  plural: string;
  hue: number;
  chroma: number;
  blurb: string;
}

export const ROLES: Record<Role, RoleMeta> = {
  lead: { label: 'Lead', plural: 'Leads', hue: 350, chroma: 0.17, blurb: 'Melodies, hooks, toplines' },
  chords: { label: 'Chords', plural: 'Chords & keys', hue: 158, chroma: 0.15, blurb: 'Keys, guitars, stabs, comping' },
  pad: { label: 'Pad', plural: 'Pads', hue: 295, chroma: 0.15, blurb: 'Sustained beds, atmospheres' },
  bass: { label: 'Bass', plural: 'Bass', hue: 25, chroma: 0.18, blurb: 'Basslines, subs, 808s' },
  drums: { label: 'Drums', plural: 'Drums', hue: 68, chroma: 0.15, blurb: 'Kits, loops, percussion' },
  vocal: { label: 'Vocal', plural: 'Vocals', hue: 98, chroma: 0.15, blurb: 'Voices, memos, chops' },
  fx: { label: 'FX', plural: 'FX & textures', hue: 220, chroma: 0.12, blurb: 'Risers, impacts, noise' },
  mix: { label: 'Reference', plural: 'References', hue: 262, chroma: 0.035, blurb: 'Full mixes, demos, refs' },
  other: { label: 'Sound', plural: 'Other', hue: 260, chroma: 0.015, blurb: 'Unclassified' },
};

export const ROLE_ORDER: Role[] = ['lead', 'chords', 'pad', 'bass', 'drums', 'vocal', 'fx', 'mix', 'other'];

export const SOURCES: Record<Source, { label: string; blurb: string }> = {
  acoustic: { label: 'Acoustic', blurb: 'Recorded, organic — drawn as a smooth curve' },
  electronic: { label: 'Electronic', blurb: 'Synth or machine — drawn as stepped digital bars' },
  hybrid: { label: 'Hybrid', blurb: 'A bit of both — rounded bars' },
};

export const CHARACTERS: Record<Character, { label: string; blurb: string }> = {
  clean: { label: 'Clean', blurb: 'Crisp outline' },
  driven: { label: 'Driven', blurb: 'Warm grit — softened, glowing edge' },
  distorted: { label: 'Distorted', blurb: 'Clipped flat tops and a hot edge' },
};

export const BRIGHTNESS: Record<Brightness, { label: string; blurb: string }> = {
  dark: { label: 'Dark', blurb: 'Low centroid for its role' },
  balanced: { label: 'Balanced', blurb: 'Typical for its role' },
  bright: { label: 'Bright', blurb: 'Lots of top end for its role' },
};

export const ENVELOPES: Record<Envelope, { label: string; blurb: string; shape: number[] }> = {
  hit: { label: 'Hit', blurb: 'Instant attack, very short', shape: [0, 1, 0.35, 0.1, 0.02, 0, 0, 0, 0, 0, 0, 0] },
  pluck: { label: 'Pluck', blurb: 'Fast attack, decays away', shape: [0, 1, 0.75, 0.55, 0.42, 0.32, 0.24, 0.18, 0.12, 0.08, 0.04, 0] },
  sustain: { label: 'Sustain', blurb: 'Fast attack, holds', shape: [0, 1, 0.88, 0.82, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.5, 0] },
  swell: { label: 'Swell', blurb: 'Slow attack, blooms in', shape: [0, 0.12, 0.3, 0.52, 0.72, 0.86, 0.95, 1, 1, 0.98, 0.7, 0] },
};

export type Theme = 'dark' | 'light';

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

// OKLCH -> sRGB (CSS Color 4 reference math).
export function oklchToRgb(L: number, C: number, H: number): [number, number, number] {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const enc = (x: number) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(0, x), 1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, v)) * 255);
  };
  return [enc(r), enc(g), enc(bb)];
}

/** Role colour at a given lightness (0..1). */
export function roleRgb(role: Role, lightness: number, chromaScale = 1): [number, number, number] {
  const m = ROLES[role] ?? ROLES.other;
  return oklchToRgb(lightness, m.chroma * chromaScale, m.hue);
}

export function roleCss(role: Role, theme: Theme = currentTheme()) {
  const m = ROLES[role] ?? ROLES.other;
  const L = theme === 'dark' ? 0.76 : 0.6;
  return `oklch(${L} ${m.chroma} ${m.hue})`;
}

/** CSS custom properties for a card of this role. */
export function roleVars(role: Role): Record<string, string> {
  const m = ROLES[role] ?? ROLES.other;
  return {
    '--role-h': String(m.hue),
    '--role-c': String(m.chroma),
  };
}
