// Anonymous, persistent identity for presence. No accounts.

const ADJ = ['Velvet', 'Dusty', 'Lo-fi', 'Analog', 'Neon', 'Hazy', 'Golden', 'Midnight', 'Tape', 'Vintage', 'Glassy', 'Warm', 'Wobbly', 'Lucid', 'Fuzzy', 'Silver', 'Cosmic', 'Sunday'];
const NOUN = ['Theremin', 'Rhodes', 'Mellotron', 'Moog', 'Juno', 'Kalimba', 'Wurlitzer', 'Oud', 'Harmonium', 'Clavinet', 'Vibraphone', 'Sitar', 'Marimba', 'Celesta', 'Banjo', 'Tabla', 'Cello', 'Ukulele'];
const COLORS = ['#ff6fa8', '#b28dff', '#ff7a6b', '#5fe0a8', '#ffb35c', '#ffe066', '#5cc8ff', '#c5f04f', '#ff9de2', '#7ae0ff'];

export interface Identity {
  clientId: string;
  name: string;
  color: string;
}

function rand<T>(a: T[]) {
  return a[Math.floor(Math.random() * a.length)];
}

let cached: Identity | null = null;

export function identity(): Identity {
  if (cached) return cached;
  let stored: Partial<Identity> = {};
  try {
    stored = JSON.parse(localStorage.getItem('ab:identity') ?? '{}');
  } catch {
    /* storage unavailable */
  }
  const id: Identity = {
    name: stored.name ?? `${rand(ADJ)} ${rand(NOUN)}`,
    color: stored.color ?? rand(COLORS),
    // Per-tab id so two tabs of the same person show up as two cursors.
    clientId: Math.random().toString(36).slice(2, 12),
  };
  try {
    localStorage.setItem('ab:identity', JSON.stringify({ name: id.name, color: id.color }));
  } catch {
    /* storage unavailable */
  }
  cached = id;
  return id;
}

export function setName(name: string) {
  const id = identity();
  id.name = name.trim().slice(0, 40) || id.name;
  try {
    localStorage.setItem('ab:identity', JSON.stringify({ name: id.name, color: id.color }));
  } catch {
    /* storage unavailable */
  }
}

export interface RecentBoard {
  viewId: string;
  editId?: string;
  title: string;
  openedAt: number;
  /** Albums open at /a/; everything else is a single board. */
  kind?: 'album';
  songs?: number;
}

export function recentHref(r: RecentBoard) {
  if (r.kind === 'album') return `/a/${r.editId ?? r.viewId}`;
  return r.editId ? `/e/${r.editId}` : `/b/${r.viewId}`;
}

export function recentBoards(): RecentBoard[] {
  try {
    return JSON.parse(localStorage.getItem('ab:recent') ?? '[]');
  } catch {
    return [];
  }
}

export function rememberBoard(b: RecentBoard) {
  try {
    const list = recentBoards().filter((r) => r.viewId !== b.viewId);
    const prev = recentBoards().find((r) => r.viewId === b.viewId);
    list.unshift({ ...b, editId: b.editId ?? prev?.editId });
    localStorage.setItem('ab:recent', JSON.stringify(list.slice(0, 30)));
  } catch {
    /* storage unavailable */
  }
}

export function forgetBoard(viewId: string) {
  try {
    localStorage.setItem('ab:recent', JSON.stringify(recentBoards().filter((r) => r.viewId !== viewId)));
  } catch {
    /* storage unavailable */
  }
}
