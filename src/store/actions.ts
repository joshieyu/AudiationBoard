import { nanoid } from 'nanoid';
import type { AnyItem, AudioData, Item, ItemPatch, LinkData, MidiData, Op, TextData } from '../../shared/types';
import { engine } from '../audio/engine';
import { fileKind } from '../audio/decode';
import { hasTempoMeta, midiTags, parseMidi } from '../audio/midi';
import { analyzeBuffer } from '../audio/workerClient';
import { uploadFile, unfurl } from '../lib/api';
import { embedFor, normalizeUrl } from '../lib/embeds';
import { toast } from '../components/ui/toast';
import { commit, maxZ, patchPending, select, setPending, useBoard, useCamera } from './board';

export const SIZES = {
  text: { w: 260, h: 180 },
  audio: { w: 340, h: 172 },
  midi: { w: 360, h: 196 },
  image: { w: 300, h: 220 },
  link: { w: 340, h: 120 },
} as const;

/** World coordinates of the centre of the visible canvas (not covered by side panels). */
export function viewportCenter() {
  const { x, y, z } = useCamera.getState();
  const el = document.querySelector('[data-canvas]') as HTMLElement | null;
  const w = el?.clientWidth ?? window.innerWidth;
  const h = el?.clientHeight ?? window.innerHeight;
  const legend = document.querySelector('.legend') as HTMLElement | null;
  const right = legend && window.innerWidth > 720 ? legend.offsetWidth + 12 : 0;
  const left = window.innerWidth > 720 && document.querySelector('.toolbar') ? 64 : 0;
  return { x: ((left + w - right) / 2 - x) / z, y: (h / 2 - y) / z };
}

function overlaps(x: number, y: number, w: number, h: number) {
  const { items, pending } = useBoard.getState();
  for (const it of [...Object.values(items), ...Object.values(pending)]) {
    if (x < it.x + it.w + 8 && x + w + 8 > it.x && y < it.y + it.h + 8 && y + h + 8 > it.y) return true;
  }
  return false;
}

/** Near `at` (centre), nudged outward until it doesn't sit on top of something. */
export function freeSpot(w: number, h: number, at = viewportCenter()) {
  const x0 = Math.round(at.x - w / 2), y0 = Math.round(at.y - h / 2);
  if (!overlaps(x0, y0, w, h)) return { x: x0, y: y0 };
  const stepX = Math.max(120, w * 0.5), stepY = Math.max(90, h * 0.5);
  for (let ring = 1; ring < 24; ring++) {
    // Prefer below and to the right, which reads as "added after".
    const candidates: [number, number][] = [];
    for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) candidates.push([dx, dy]);
    candidates.sort((a, b) => Math.hypot(a[0], a[1] * 1.2) - Math.hypot(b[0], b[1] * 1.2) || b[1] - a[1]);
    for (const [dx, dy] of candidates) {
      const x = Math.round(x0 + dx * stepX), y = Math.round(y0 + dy * stepY);
      if (!overlaps(x, y, w, h)) return { x, y };
    }
  }
  return { x: x0, y: y0 };
}

function baseItem<T extends AnyItem['type']>(type: T, x: number, y: number, w: number, h: number) {
  const now = Date.now();
  return { id: nanoid(12), type, x, y, w, h, z: maxZ() + 1, createdAt: now, updatedAt: now };
}

function stem(name: string) {
  return name.replace(/\.[a-z0-9]{2,5}$/i, '');
}

// ---- Files --------------------------------------------------------------------

export async function addFiles(files: File[], at?: { x: number; y: number }) {
  const { editId } = useBoard.getState();
  if (!editId) return;
  const usable = files.filter((f) => fileKind(f));
  const skipped = files.length - usable.length;
  if (skipped) toast(`Skipped ${skipped} file${skipped > 1 ? 's' : ''} that aren't audio, MIDI or images`);
  const center = at ?? viewportCenter();
  const n = usable.length;
  const cols = n > 3 ? Math.ceil(Math.sqrt(n)) : Math.max(1, n);
  const rows = Math.ceil(n / cols);
  const gap = 24;
  const cellW = Math.max(...usable.map((f) => SIZES[fileKind(f)!].w)) + gap;
  const cellH = Math.max(...usable.map((f) => SIZES[fileKind(f)!].h)) + gap;
  // Find room for the whole grid at once so a batch never lands on existing cards.
  const block = freeSpot(cols * cellW - gap, rows * cellH - gap, center);
  await Promise.all(
    usable.map((file, i) => {
      const kind = fileKind(file)!;
      const pos = { x: block.x + (i % cols) * cellW, y: block.y + Math.floor(i / cols) * cellH };
      if (kind === 'audio') return addAudioFile(file, pos);
      if (kind === 'midi') return addMidiFile(file, pos);
      return addImageFile(file, pos);
    }),
  );
}

export async function addAudioFile(file: File, pos: { x: number; y: number }, opts: { recorded?: boolean } = {}) {
  const editId = useBoard.getState().editId!;
  const { w, h } = SIZES.audio;
  const tmp = nanoid(12);
  setPending({ id: tmp, type: 'audio', x: pos.x, y: pos.y, w, h, name: file.name, progress: 0, stage: 'uploading' });
  const upload = uploadFile(editId, file, (p) => patchPending(tmp, { progress: p }));
  const analysis = (async () => {
    const buf = await engine.decodeFile(file);
    const res = await analyzeBuffer(buf, file.name);
    return { buf, res };
  })();
  try {
    const ref = await upload;
    patchPending(tmp, { stage: 'analyzing', progress: 1 });
    let data: AudioData;
    try {
      const { buf, res } = await analysis;
      engine.primeBuffer(ref.url, buf);
      data = {
        file: ref,
        title: stem(file.name),
        duration: buf.duration,
        sampleRate: buf.sampleRate,
        channels: buf.numberOfChannels,
        peaks: res.peaks,
        analysis: res.analysis,
        tags: res.tags,
        status: 'ready',
        loop: res.tags.kind.v === 'loop',
        recorded: opts.recorded,
      };
    } catch (err) {
      console.warn('Analysis failed', err);
      data = {
        file: ref,
        title: stem(file.name),
        duration: 0,
        sampleRate: 0,
        channels: 0,
        status: 'error',
        error: "This browser can't decode this file, but it's saved and downloadable.",
      };
    }
    const item = { ...baseItem('audio', pos.x, pos.y, w, h), data } as Item<'audio'>;
    setPending(null, tmp);
    commit([{ op: 'add', item }]);
    return item;
  } catch (err) {
    patchPending(tmp, { stage: 'error', error: (err as Error).message });
    setTimeout(() => setPending(null, tmp), 6000);
    return null;
  }
}

export async function addMidiFile(file: File, pos: { x: number; y: number }) {
  const editId = useBoard.getState().editId!;
  const { w, h } = SIZES.midi;
  const tmp = nanoid(12);
  setPending({ id: tmp, type: 'midi', x: pos.x, y: pos.y, w, h, name: file.name, progress: 0, stage: 'uploading' });
  try {
    const buf = await file.arrayBuffer();
    const parsed = parseMidi(buf);
    const ref = await uploadFile(editId, file, (p) => patchPending(tmp, { progress: p }));
    const data: MidiData = {
      file: ref,
      title: stem(file.name),
      summary: parsed.summary,
      instrument: parsed.instrument,
      tags: midiTags(parsed.summary, parsed.role, parsed.instrument, hasTempoMeta(buf)),
      status: 'ready',
      loop: true,
    };
    const item = { ...baseItem('midi', pos.x, pos.y, w, h), data } as Item<'midi'>;
    setPending(null, tmp);
    commit([{ op: 'add', item }]);
    return item;
  } catch (err) {
    patchPending(tmp, { stage: 'error', error: (err as Error).message || "Couldn't read that MIDI file" });
    setTimeout(() => setPending(null, tmp), 6000);
    return null;
  }
}

async function imageSize(file: File): Promise<{ w: number; h: number }> {
  try {
    const bmp = await createImageBitmap(file);
    const s = { w: bmp.width, h: bmp.height };
    bmp.close();
    return s;
  } catch {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 4, h: img.naturalHeight || 3 });
      img.onerror = () => resolve({ w: 4, h: 3 });
      img.src = URL.createObjectURL(file);
    });
  }
}

export async function addImageFile(file: File, pos: { x: number; y: number }) {
  const editId = useBoard.getState().editId!;
  const nat = await imageSize(file);
  const aspect = nat.w / nat.h || 4 / 3;
  const w = aspect >= 1 ? 320 : Math.round(260 * Math.max(0.6, aspect));
  const h = Math.round(w / aspect);
  const tmp = nanoid(12);
  setPending({ id: tmp, type: 'image', x: pos.x, y: pos.y, w, h, name: file.name, progress: 0, stage: 'uploading' });
  try {
    const ref = await uploadFile(editId, file, (p) => patchPending(tmp, { progress: p }));
    const item = { ...baseItem('image', pos.x, pos.y, w, h), data: { file: ref, aspect } } as Item<'image'>;
    setPending(null, tmp);
    commit([{ op: 'add', item }]);
  } catch (err) {
    patchPending(tmp, { stage: 'error', error: (err as Error).message });
    setTimeout(() => setPending(null, tmp), 6000);
  }
}

// ---- Text & links -----------------------------------------------------------------

export function addText(md = '', at?: { x: number; y: number }, edit = true) {
  const { w, h } = SIZES.text;
  const pos = at ? { x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2) } : freeSpot(w, h);
  const data: TextData = { md, color: 'default' };
  const item = { ...baseItem('text', pos.x, pos.y, w, h), data } as Item<'text'>;
  commit([{ op: 'add', item }]);
  select([item.id]);
  if (edit) useBoard.setState({ editingId: item.id });
  return item;
}

function linkSize(embed: LinkData['embed']) {
  if (!embed) return { w: 340, h: 112 };
  if (embed.provider === 'youtube' || embed.provider === 'vimeo') return { w: 384, h: Math.round(384 * (9 / 16)) + 44 };
  return { w: 360, h: embed.height + 40 };
}

export async function addLink(raw: string, at?: { x: number; y: number }) {
  const url = normalizeUrl(raw);
  if (!url) {
    toast("That doesn't look like a link");
    return;
  }
  const embed = embedFor(url);
  const { w, h } = linkSize(embed);
  const pos = at ? { x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2) } : freeSpot(w, h);
  const item = { ...baseItem('link', pos.x, pos.y, w, h), data: { url, embed } } as Item<'link'>;
  commit([{ op: 'add', item }]);
  select([item.id]);
  const meta = await unfurl(url);
  if (!useBoard.getState().items[item.id]) return;
  const patch: ItemPatch = { data: { meta } };
  // Rich previews deserve room for the image.
  if (!embed && meta.image) patch.h = 268;
  commit([{ op: 'update', id: item.id, patch }], { history: false });
}

// ---- Editing --------------------------------------------------------------------

export function updateItem(id: string, patch: ItemPatch, history = true) {
  commit([{ op: 'update', id, patch }], { history });
}

export function removeItems(ids: string[]) {
  const ops: Op[] = ids.filter((id) => useBoard.getState().items[id]).map((id) => ({ op: 'remove', id }));
  for (const id of ids) engine.stop(id);
  commit(ops);
}

export function duplicateItems(ids: string[]) {
  const { items } = useBoard.getState();
  let z = maxZ();
  const ops: Op[] = [];
  const fresh: string[] = [];
  for (const id of ids) {
    const it = items[id];
    if (!it) continue;
    const copy = { ...structuredClone(it), id: nanoid(12), x: it.x + 28, y: it.y + 28, z: ++z, createdAt: Date.now() } as AnyItem;
    ops.push({ op: 'add', item: copy });
    fresh.push(copy.id);
  }
  commit(ops);
  select(fresh);
}

export function bringToFront(ids: string[]) {
  const { items } = useBoard.getState();
  let z = maxZ();
  const top = ids.filter((id) => items[id]).sort((a, b) => items[a].z - items[b].z);
  if (top.every((id) => items[id].z === z) && top.length === 1) return;
  commit(top.map((id) => ({ op: 'update', id, patch: { z: ++z } })), { history: false });
}

export function setBoardMeta(patch: { title?: string; key?: string | null; bpm?: number | null }) {
  commit([{ op: 'board', patch }]);
  if (patch.bpm !== undefined) engine.setBoardTempo(patch.bpm);
}

/** Pasted / dropped text: a URL becomes a link card, anything else a note. */
export function addFromText(text: string, at?: { x: number; y: number }) {
  const t = text.trim();
  if (!t) return;
  const single = !/\s/.test(t);
  if (single && normalizeUrl(t) && /^(https?:\/\/|www\.)/i.test(t)) void addLink(t, at);
  else addText(t, at, false);
}
