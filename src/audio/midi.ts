import { Midi } from '@tonejs/midi';
import { Chord } from 'tonal';
import type { MidiChord, MidiSummary, Role, SoundTags } from '../../shared/types';
import { detectKey, keyName, usesFlats, FLAT_NAMES, SHARP_NAMES } from '../lib/music';
import { defaultInstrumentFor, instrumentInfo } from './instruments';
import type { InstrumentId } from '../../shared/types';

export interface NoteEv {
  /** start, in beats */
  s: number;
  /** length, in beats */
  l: number;
  n: number;
  /** 0..1 */
  v: number;
  drum: boolean;
}

export interface ParsedMidi {
  notes: NoteEv[];
  summary: MidiSummary;
  role: Role;
  instrument: InstrumentId;
}

const PREVIEW_CAP = 3000;

function prettyChord(name: string) {
  return name.replace(/^([A-G][#b]?)M(?=$|\/)/, '$1');
}

export function parseMidi(buf: ArrayBuffer): ParsedMidi {
  const midi = new Midi(buf);
  const ppq = midi.header.ppq || 480;
  const bpm = Math.round((midi.header.tempos[0]?.bpm ?? 120) * 100) / 100;
  const ts = (midi.header.timeSignatures[0]?.timeSignature as [number, number] | undefined) ?? [4, 4];
  const beatsPerBar = (ts[0] * 4) / ts[1];

  const notes: NoteEv[] = [];
  const tracks = midi.tracks
    .filter((t) => t.notes.length)
    .map((t) => {
      const drums = t.channel === 9 || t.instrument.percussion;
      for (const n of t.notes) {
        notes.push({ s: n.ticks / ppq, l: Math.max(1 / 64, n.durationTicks / ppq), n: n.midi, v: n.velocity, drum: drums });
      }
      return { name: t.name || t.instrument.name || 'Track', channel: t.channel, noteCount: t.notes.length, drums };
    });
  notes.sort((a, b) => a.s - b.s || a.n - b.n);

  const lastEnd = notes.reduce((m, n) => Math.max(m, n.s + n.l), 0);
  const bars = Math.max(1, Math.ceil(lastEnd / beatsPerBar - 1e-3));
  const beats = bars * beatsPerBar;
  const pitched = notes.filter((n) => !n.drum);
  const allDrums = notes.length > 0 && pitched.length === 0;

  // Average voices sounding while anything sounds.
  let polyphony = 0;
  if (pitched.length) {
    const evs: [number, number][] = [];
    for (const n of pitched) evs.push([n.s, 1], [n.s + n.l, -1]);
    evs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let cur = 0, last = 0, covered = 0, weighted = 0;
    for (const [t, d] of evs) {
      if (cur > 0) {
        covered += t - last;
        weighted += (t - last) * cur;
      }
      cur += d;
      last = t;
    }
    polyphony = covered ? weighted / covered : 1;
  }

  // Key from duration-weighted pitch classes.
  const pcw = new Array(12).fill(0);
  for (const n of pitched) pcw[n.n % 12] += n.l * (0.5 + n.v);
  const det = pitched.length >= 3 ? detectKey(pcw) : null;
  const flats = det ? usesFlats(det.key) : false;
  const names = flats ? FLAT_NAMES : SHARP_NAMES;

  // Chords per half bar (per bar in short meters).
  const chords: MidiChord[] = [];
  if (pitched.length && polyphony >= 1.4) {
    const seg = beatsPerBar >= 4 ? beatsPerBar / 2 : beatsPerBar;
    for (let b = 0; b < beats; b += seg) {
      const w = new Array(12).fill(0);
      let low = Infinity;
      for (const n of pitched) {
        const ov = Math.min(n.s + n.l, b + seg) - Math.max(n.s, b);
        if (ov <= 0) continue;
        w[n.n % 12] += ov * (0.5 + n.v);
        if (n.s < b + seg / 2 && n.n < low) low = n.n;
      }
      const max = Math.max(...w);
      if (max <= 0) continue;
      const pcs = w.map((x, pc) => [x, pc] as const).filter(([x]) => x >= max * 0.3).sort((a, b) => b[0] - a[0]).slice(0, 6).map(([, pc]) => pc);
      if (pcs.length < 2) continue;
      const bass = Number.isFinite(low) ? low % 12 : pcs[0];
      const ordered = [bass, ...pcs.filter((p) => p !== bass).sort((a, b) => ((a - bass + 12) % 12) - ((b - bass + 12) % 12))];
      const found = Chord.detect(ordered.map((p) => names[p]));
      if (!found.length) continue;
      const name = prettyChord(found[0]);
      const prev = chords[chords.length - 1];
      if (prev && prev.name === name && Math.abs(prev.beat + prev.beats - b) < 1e-6) prev.beats += seg;
      else chords.push({ beat: b, beats: seg, name });
    }
  }

  const pitches = pitched.map((n) => n.n).sort((a, b) => a - b);
  const medianPitch = pitches.length ? pitches[pitches.length >> 1] : 60;
  const lens = pitched.map((n) => n.l).sort((a, b) => a - b);
  const medianLen = lens.length ? lens[lens.length >> 1] : 1;
  let role: Role;
  if (allDrums) role = 'drums';
  else if (polyphony < 1.25) role = medianPitch < 52 ? 'bass' : 'lead';
  else role = medianLen >= 1.75 ? 'pad' : 'chords';
  const instrument = defaultInstrumentFor(role, medianLen < 0.4);

  const preview: number[] = [];
  for (const n of notes.slice(0, PREVIEW_CAP)) {
    preview.push(Math.round(n.s * 1000) / 1000, Math.round(n.l * 1000) / 1000, n.drum ? -n.n : n.n, Math.round(n.v * 127));
  }

  const summary: MidiSummary = {
    bpm,
    timeSig: ts,
    beats,
    bars,
    noteCount: notes.length,
    pitchMin: pitches[0] ?? 0,
    pitchMax: pitches[pitches.length - 1] ?? 0,
    polyphony: Math.round(polyphony * 100) / 100,
    tracks,
    notes: preview,
    truncated: notes.length > PREVIEW_CAP,
    chords,
    key: det ? keyName(det.key) : null,
    keyConf: det ? Math.round(det.conf * 100) / 100 : 0,
    drums: allDrums,
  };
  return { notes, summary, role, instrument };
}

/** Notes stored in the item preview, for playback without refetching small files. */
export function notesFromSummary(s: MidiSummary): NoteEv[] {
  const out: NoteEv[] = [];
  for (let i = 0; i < s.notes.length; i += 4) {
    const n = s.notes[i + 2];
    out.push({ s: s.notes[i], l: s.notes[i + 1], n: Math.abs(n), v: s.notes[i + 3] / 127, drum: n < 0 });
  }
  return out;
}

export function midiTags(summary: MidiSummary, role: Role, instrument: InstrumentId, hasTempo: boolean): SoundTags {
  const info = instrumentInfo(instrument);
  const auto = <T>(v: T, conf: number) => ({ v, conf, src: 'auto' as const });
  return {
    role: auto(role, summary.drums ? 0.95 : 0.65),
    source: auto(info.source, 0.9),
    character: auto(info.character, 0.9),
    brightness: auto(info.brightness, 0.8),
    envelope: auto(info.envelope, 0.85),
    kind: auto('loop', 0.8),
    key: auto(summary.drums ? null : summary.key, summary.keyConf),
    bpm: { v: summary.bpm, conf: hasTempo ? 0.99 : 0.4, src: hasTempo ? 'file' : 'auto' },
    root: auto(null, 0),
    extra: [],
  };
}

export function hasTempoMeta(buf: ArrayBuffer) {
  try {
    return new Midi(buf).header.tempos.length > 0;
  } catch {
    return false;
  }
}
