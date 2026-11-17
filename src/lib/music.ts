// Pitch, key and tempo helpers shared by the analysis worker and the UI.

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export type Mode = 'major' | 'minor';
export interface Key {
  root: number;
  mode: Mode;
}

// Conventional spellings: flats for flat keys, sharps elsewhere.
const MAJOR_SPELL = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_SPELL = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

export function keyName(k: Key) {
  return `${(k.mode === 'major' ? MAJOR_SPELL : MINOR_SPELL)[k.root]} ${k.mode}`;
}

export function keyShort(k: Key) {
  const name = (k.mode === 'major' ? MAJOR_SPELL : MINOR_SPELL)[k.root];
  return k.mode === 'minor' ? `${name}m` : name;
}

export function usesFlats(k: Key) {
  const name = (k.mode === 'major' ? MAJOR_SPELL : MINOR_SPELL)[k.root];
  return name.includes('b') || (k.mode === 'major' && k.root === 5) || (k.mode === 'minor' && [2, 7, 0, 5].includes(k.root));
}

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function parsePitchClass(s: string): number | null {
  const m = s.trim().match(/^([A-Ga-g])([#♯b♭]*)/);
  if (!m) return null;
  let pc = LETTER[m[1].toUpperCase()];
  for (const ch of m[2]) pc += ch === '#' || ch === '♯' ? 1 : -1;
  return ((pc % 12) + 12) % 12;
}

/** Accepts "A minor", "Am", "A min", "F# major", "Gb", "8A". */
export function parseKey(s: string | null | undefined): Key | null {
  if (!s) return null;
  const t = s.trim();
  const cam = t.match(/^(\d{1,2})\s*([ABab])$/);
  if (cam) return fromCamelot(Number(cam[1]), cam[2].toUpperCase() as 'A' | 'B');
  const m = t.match(/^([A-Ga-g][#♯b♭]?)\s*(maj(?:or)?|min(?:or)?|m|M)?$/);
  if (!m) return null;
  const root = parsePitchClass(m[1]);
  if (root === null) return null;
  const q = m[2];
  const mode: Mode = q && (q === 'm' || q.toLowerCase().startsWith('min')) ? 'minor' : 'major';
  return { root, mode };
}

export function camelot(k: Key): string {
  const majorRoot = k.mode === 'major' ? k.root : (k.root + 3) % 12;
  const n = (((majorRoot * 7) % 12) + 7) % 12 + 1;
  return `${n}${k.mode === 'major' ? 'B' : 'A'}`;
}

function fromCamelot(n: number, letter: 'A' | 'B'): Key | null {
  if (n < 1 || n > 12) return null;
  // Invert majorRoot*7 ≡ n-8 (mod 12). 7 is its own inverse mod 12.
  const majorRoot = (((n - 8) * 7) % 12 + 12) % 12;
  return letter === 'B' ? { root: majorRoot, mode: 'major' } : { root: (majorRoot + 9) % 12, mode: 'minor' };
}

export type Fit = 'perfect' | 'good' | 'clash';

/** Harmonic-mixing compatibility on the Camelot wheel. */
export function keyFit(clip: Key, board: Key): Fit {
  const a = camelot(clip);
  const b = camelot(board);
  const na = parseInt(a), nb = parseInt(b);
  const la = a.slice(-1), lb = b.slice(-1);
  if (na === nb) return 'perfect'; // same key or relative major/minor
  const d = Math.min((na - nb + 12) % 12, (nb - na + 12) % 12);
  if (d === 1 && la === lb) return 'good';
  return 'clash';
}

/** Ratio needed to bring a clip to the board tempo, folding half/double time. */
export function tempoRatio(clipBpm: number, boardBpm: number) {
  let r = clipBpm / boardBpm;
  while (r > 1.42) r /= 2;
  while (r < 0.71) r *= 2;
  return r;
}

export function tempoFit(clipBpm: number, boardBpm: number): { fit: Fit; pct: number } {
  const r = tempoRatio(clipBpm, boardBpm);
  const pct = (1 / r - 1) * 100;
  const a = Math.abs(pct);
  // Warping much past ~18% starts to sound processed.
  return { fit: a < 0.6 ? 'perfect' : a <= 18 ? 'good' : 'clash', pct };
}

export function midiToName(midi: number, flats = false) {
  const names = flats ? FLAT_NAMES : SHARP_NAMES;
  return `${names[((Math.round(midi) % 12) + 12) % 12]}${Math.floor(Math.round(midi) / 12) - 1}`;
}

export function hzToMidi(hz: number) {
  return 69 + 12 * Math.log2(hz / 440);
}

// Krumhansl-Kessler key profiles.
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(a: number[], b: number[]) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Best key for a 12-bin pitch-class profile, with a 0..1 confidence. */
export function detectKey(chroma: ArrayLike<number>): { key: Key; conf: number; r: number } | null {
  const c = Array.from(chroma);
  if (c.every((v) => v <= 0)) return null;
  const scores: { key: Key; r: number }[] = [];
  for (let root = 0; root < 12; root++) {
    const rotated = c.slice(root).concat(c.slice(0, root));
    scores.push({ key: { root, mode: 'major' }, r: pearson(rotated, KK_MAJOR) });
    scores.push({ key: { root, mode: 'minor' }, r: pearson(rotated, KK_MINOR) });
  }
  scores.sort((a, b) => b.r - a.r);
  const [best, second] = scores;
  // Relative major/minor share notes, so a narrow margin between them is expected.
  const rel = second.key.mode !== best.key.mode && camelot(second.key) === camelot(best.key);
  const margin = best.r - (rel ? (scores[2]?.r ?? second.r) : second.r);
  const conf = Math.max(0, Math.min(1, (best.r - 0.45) * 1.6 + margin * 2.5));
  return { key: best.key, conf, r: best.r };
}
