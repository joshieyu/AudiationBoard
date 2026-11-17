import { ElectricPiano, Soundfont, SplendidGrandPiano } from 'smplr';
import type { Brightness, Character, Envelope, InstrumentId, Role, Source } from '../../shared/types';

export interface InstrumentInfo {
  id: InstrumentId;
  label: string;
  blurb: string;
  sampled: boolean;
  source: Source;
  character: Character;
  brightness: Brightness;
  envelope: Envelope;
}

export const INSTRUMENTS: InstrumentInfo[] = [
  { id: 'piano', label: 'Grand Piano', blurb: 'Sampled Steinway', sampled: true, source: 'acoustic', character: 'clean', brightness: 'balanced', envelope: 'pluck' },
  { id: 'epiano', label: 'Electric Piano', blurb: 'Sampled CP-80', sampled: true, source: 'acoustic', character: 'clean', brightness: 'balanced', envelope: 'pluck' },
  { id: 'strings', label: 'Strings', blurb: 'Ensemble soundfont', sampled: true, source: 'acoustic', character: 'clean', brightness: 'balanced', envelope: 'swell' },
  { id: 'mallet', label: 'Marimba', blurb: 'Soundfont mallets', sampled: true, source: 'acoustic', character: 'clean', brightness: 'balanced', envelope: 'hit' },
  { id: 'pad', label: 'Warm Pad', blurb: 'Detuned saws, slow filter', sampled: false, source: 'electronic', character: 'clean', brightness: 'dark', envelope: 'swell' },
  { id: 'pluck', label: 'Pluck', blurb: 'Snappy filter envelope', sampled: false, source: 'electronic', character: 'clean', brightness: 'bright', envelope: 'pluck' },
  { id: 'bass', label: 'Sub Bass', blurb: 'Sine + square body', sampled: false, source: 'electronic', character: 'clean', brightness: 'dark', envelope: 'sustain' },
  { id: 'lead', label: 'Saw Lead', blurb: 'Unison saws, vibrato', sampled: false, source: 'electronic', character: 'driven', brightness: 'bright', envelope: 'sustain' },
  { id: 'drums', label: 'Drum Machine', blurb: 'Synth kit, GM mapped', sampled: false, source: 'electronic', character: 'clean', brightness: 'balanced', envelope: 'hit' },
];

export const instrumentInfo = (id: InstrumentId) => INSTRUMENTS.find((i) => i.id === id) ?? INSTRUMENTS[0];

export function defaultInstrumentFor(role: Role, shortNotes: boolean): InstrumentId {
  switch (role) {
    case 'drums': return 'drums';
    case 'bass': return 'bass';
    case 'lead': return shortNotes ? 'pluck' : 'lead';
    case 'pad': return 'pad';
    default: return 'piano';
  }
}

export interface Instrument {
  ready: Promise<void>;
  /** Sampled instruments are shared between voices, so voices stop their own notes. */
  shared: boolean;
  /** velocity 0..1. Returns a function that cuts this note, when the instrument supports it. */
  noteOn(midi: number, time: number, duration: number, velocity: number): (() => void) | void;
  stopAll(): void;
  dispose(): void;
}

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);

// ---- Subtractive synth -----------------------------------------------------------

interface Patch {
  osc: { type: OscillatorType; detune: number; gain: number; octave?: number; pan?: number }[];
  filter: { freq: number; q: number; env: number; decay: number; keyTrack: number };
  amp: { a: number; d: number; s: number; r: number };
  gain: number;
  vibrato?: { rate: number; cents: number; delay: number };
}

const PATCHES: Record<'pad' | 'pluck' | 'bass' | 'lead' | 'keys', Patch> = {
  pad: {
    osc: [
      { type: 'sawtooth', detune: -14, gain: 0.5, pan: -0.6 },
      { type: 'sawtooth', detune: 13, gain: 0.5, pan: 0.6 },
      { type: 'sawtooth', detune: 0, gain: 0.35, octave: 1 },
      { type: 'triangle', detune: 0, gain: 0.4, octave: -1 },
    ],
    filter: { freq: 900, q: 0.8, env: 900, decay: 2.2, keyTrack: 0.3 },
    amp: { a: 0.55, d: 1.2, s: 0.85, r: 1.6 },
    gain: 0.12,
  },
  pluck: {
    osc: [
      { type: 'sawtooth', detune: -6, gain: 0.6, pan: -0.3 },
      { type: 'square', detune: 6, gain: 0.35, pan: 0.3 },
    ],
    filter: { freq: 500, q: 5, env: 5200, decay: 0.16, keyTrack: 0.5 },
    amp: { a: 0.002, d: 0.42, s: 0, r: 0.3 },
    gain: 0.22,
  },
  bass: {
    osc: [
      { type: 'sine', detune: 0, gain: 1 },
      { type: 'square', detune: 0, gain: 0.12 },
      { type: 'sine', detune: 0, gain: 0.25, octave: 1 },
    ],
    filter: { freq: 700, q: 1.2, env: 500, decay: 0.18, keyTrack: 0.2 },
    amp: { a: 0.004, d: 0.3, s: 0.85, r: 0.09 },
    gain: 0.42,
  },
  lead: {
    osc: [
      { type: 'sawtooth', detune: -9, gain: 0.5, pan: -0.25 },
      { type: 'sawtooth', detune: 9, gain: 0.5, pan: 0.25 },
      { type: 'square', detune: 0, gain: 0.25, octave: -1 },
    ],
    filter: { freq: 2200, q: 3, env: 2600, decay: 0.32, keyTrack: 0.4 },
    amp: { a: 0.012, d: 0.25, s: 0.75, r: 0.18 },
    gain: 0.15,
    vibrato: { rate: 5.4, cents: 9, delay: 0.35 },
  },
  // Fallback when sampled instruments can't load (offline).
  keys: {
    osc: [
      { type: 'triangle', detune: 0, gain: 0.8 },
      { type: 'sine', detune: 0, gain: 0.3, octave: 1 },
    ],
    filter: { freq: 1600, q: 0.7, env: 2500, decay: 0.5, keyTrack: 0.3 },
    amp: { a: 0.004, d: 1.4, s: 0.15, r: 0.35 },
    gain: 0.28,
  },
};

interface ActiveNote {
  vca: GainNode;
  sources: AudioScheduledSourceNode[];
  end: number;
}

function createSynth(ctx: AudioContext, dest: AudioNode, patch: Patch): Instrument {
  const out = ctx.createGain();
  out.gain.value = patch.gain;
  out.connect(dest);
  const active = new Set<ActiveNote>();

  return {
    ready: Promise.resolve(),
    shared: false,
    noteOn(midi, t, dur, vel) {
      const f = mtof(midi);
      const { a, d, s, r } = patch.amp;
      const peak = 0.25 + 0.75 * vel;
      const vca = ctx.createGain();
      vca.gain.setValueAtTime(0, t);
      vca.gain.linearRampToValueAtTime(peak, t + a);
      vca.gain.setTargetAtTime(peak * s, t + a, d / 3 + 0.001);
      const off = t + Math.max(dur, a + 0.01);
      vca.gain.setTargetAtTime(0, off, r / 4 + 0.001);
      const end = off + r * 1.5 + 0.05;

      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.Q.value = patch.filter.q;
      const base = Math.min(18000, patch.filter.freq * (f / 261.6) ** patch.filter.keyTrack);
      const top = Math.min(18000, base + patch.filter.env * (0.4 + 0.6 * vel));
      flt.frequency.setValueAtTime(top, t);
      flt.frequency.setTargetAtTime(base, t + 0.002, patch.filter.decay / 3);
      flt.connect(vca).connect(out);

      const sources: AudioScheduledSourceNode[] = [];
      let lfo: OscillatorNode | null = null;
      let lfoGain: GainNode | null = null;
      if (patch.vibrato) {
        lfo = ctx.createOscillator();
        lfo.frequency.value = patch.vibrato.rate;
        lfoGain = ctx.createGain();
        lfoGain.gain.setValueAtTime(0, t);
        lfoGain.gain.linearRampToValueAtTime(patch.vibrato.cents, t + patch.vibrato.delay + 0.3);
        lfo.connect(lfoGain);
        lfo.start(t);
        lfo.stop(end);
        sources.push(lfo);
      }
      for (const o of patch.osc) {
        const osc = ctx.createOscillator();
        osc.type = o.type;
        osc.frequency.value = f * 2 ** (o.octave ?? 0);
        osc.detune.value = o.detune;
        if (lfoGain) lfoGain.connect(osc.detune);
        const g = ctx.createGain();
        g.gain.value = o.gain;
        if (o.pan) {
          const p = ctx.createStereoPanner();
          p.pan.value = o.pan;
          osc.connect(g).connect(p).connect(flt);
        } else osc.connect(g).connect(flt);
        osc.start(t);
        osc.stop(end);
        sources.push(osc);
      }
      const note: ActiveNote = { vca, sources, end };
      active.add(note);
      sources[sources.length - 1].onended = () => {
        active.delete(note);
        vca.disconnect();
      };
      // Early release, for notes played live whose length isn't known up front.
      return () => {
        const now = ctx.currentTime;
        if (now >= off) return;
        vca.gain.cancelScheduledValues(now);
        vca.gain.setTargetAtTime(0, Math.max(now, t + 0.005), r / 4 + 0.001);
        for (const src of sources) {
          try {
            src.stop(now + r * 1.5 + 0.05);
          } catch {
            /* already stopped */
          }
        }
      };
    },
    stopAll() {
      const now = ctx.currentTime;
      for (const n of active) {
        n.vca.gain.cancelScheduledValues(now);
        n.vca.gain.setTargetAtTime(0, now, 0.015);
        for (const s of n.sources) {
          try {
            s.stop(now + 0.08);
          } catch {
            /* already stopped */
          }
        }
      }
    },
    dispose() {
      this.stopAll();
      setTimeout(() => out.disconnect(), 200);
    },
  };
}

// ---- Drum synth (General MIDI note map) ----------------------------------------

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: AudioContext) {
  if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function createDrums(ctx: AudioContext, dest: AudioNode): Instrument {
  const out = ctx.createGain();
  out.gain.value = 0.55;
  out.connect(dest);
  const live = new Set<AudioScheduledSourceNode>();
  const track = (n: AudioScheduledSourceNode) => {
    live.add(n);
    n.onended = () => live.delete(n);
  };

  const env = (t: number, peak: number, decay: number) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    g.connect(out);
    return g;
  };
  const noiseHit = (t: number, peak: number, decay: number, type: BiquadFilterType, freq: number, q = 0.7) => {
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    src.connect(f).connect(env(t, peak, decay));
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.05);
    track(src);
  };
  const tone = (t: number, peak: number, decay: number, f0: number, f1: number, sweep: number, type: OscillatorType = 'sine') => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + sweep);
    o.connect(env(t, peak, decay));
    o.start(t);
    o.stop(t + decay + 0.05);
    track(o);
  };

  const TOMS: Record<number, number> = { 41: 82, 43: 98, 45: 116, 47: 138, 48: 164, 50: 196 };
  return {
    ready: Promise.resolve(),
    shared: false,
    noteOn(n, t, _dur, vel) {
      const v = 0.35 + 0.65 * vel;
      if (n === 35 || n === 36) {
        tone(t, v, 0.5, 160, 44, 0.11);
        noiseHit(t, v * 0.3, 0.012, 'highpass', 3000);
      } else if (n === 38 || n === 40) {
        tone(t, v * 0.55, 0.12, 240, 180, 0.05, 'triangle');
        noiseHit(t, v * 0.7, 0.19, 'highpass', 1400);
      } else if (n === 37) {
        tone(t, v * 0.5, 0.05, 900, 600, 0.02, 'triangle');
      } else if (n === 39) {
        for (const off of [0, 0.011, 0.022]) noiseHit(t + off, v * 0.6, off === 0.022 ? 0.22 : 0.02, 'bandpass', 1500, 1.4);
      } else if (n === 42 || n === 44) {
        noiseHit(t, v * 0.32, 0.045, 'highpass', 7500);
      } else if (n === 46) {
        noiseHit(t, v * 0.3, 0.32, 'highpass', 7000);
      } else if (TOMS[n]) {
        tone(t, v * 0.8, 0.38, TOMS[n] * 1.6, TOMS[n], 0.14);
      } else if ([49, 52, 55, 57].includes(n)) {
        noiseHit(t, v * 0.3, 1.3, 'highpass', 4800);
      } else if ([51, 53, 59].includes(n)) {
        noiseHit(t, v * 0.18, 0.7, 'bandpass', 8500, 0.8);
        tone(t, v * 0.08, 0.6, 620, 620, 0.1, 'square');
      } else if (n === 54 || n === 69 || n === 70) {
        noiseHit(t, v * 0.25, 0.08, 'bandpass', 6000, 2);
      } else {
        tone(t, v * 0.4, 0.12, 400 + (n % 12) * 60, 300 + (n % 12) * 50, 0.05, 'triangle');
      }
    },
    stopAll() {
      const now = ctx.currentTime;
      for (const s of live) {
        try {
          s.stop(now + 0.02);
        } catch {
          /* already stopped */
        }
      }
    },
    dispose() {
      this.stopAll();
      setTimeout(() => out.disconnect(), 200);
    },
  };
}

// ---- Sampled instruments (smplr) -----------------------------------------------------

interface SmplrLike {
  start(e: { note: number; time?: number; duration?: number; velocity?: number }): unknown;
  stop(): void;
  ready?: Promise<unknown>;
  load?: Promise<unknown>;
  dispose?(): void;
}

export interface NoteSet {
  notes: number[];
  velocityRange: [number, number];
}

function createSampled(ctx: AudioContext, dest: AudioNode, id: 'piano' | 'epiano' | 'strings' | 'mallet', need?: NoteSet): Instrument {
  const out = ctx.createGain();
  out.gain.value = id === 'piano' ? 0.9 : 0.8;
  out.connect(dest);
  // Only fetch the samples this clip uses; a full grand is 200+ files.
  const notesToLoad = need ? { notes: need.notes, velocityRange: need.velocityRange, fallback: 'nearest' as const } : undefined;
  let inst: SmplrLike;
  if (id === 'piano') inst = SplendidGrandPiano(ctx, { destination: out, decayTime: 0.6, notesToLoad }) as unknown as SmplrLike;
  else if (id === 'epiano') inst = ElectricPiano(ctx, { instrument: 'CP80', destination: out, notesToLoad }) as unknown as SmplrLike;
  else inst = Soundfont(ctx, { instrument: id === 'strings' ? 'string_ensemble_1' : 'marimba', destination: out, notesToLoad }) as unknown as SmplrLike;

  let fallback: Instrument | null = null;
  const loaded = (inst.ready ?? inst.load ?? Promise.resolve()) as Promise<unknown>;
  const failed = loaded.then(
    () => undefined,
    () => {
      console.warn(`Sampled ${id} unavailable, using a synth instead`);
      fallback = createSynth(ctx, dest, PATCHES.keys);
    },
  );
  // Offline or very slow: give up waiting and use the synth so playback still starts.
  const ready = Promise.race([
    failed,
    new Promise<void>((resolve) =>
      setTimeout(() => {
        if (!fallback) fallback = createSynth(ctx, dest, PATCHES.keys);
        resolve();
      }, 15000),
    ),
  ]);

  return {
    ready,
    shared: true,
    noteOn(midi, t, dur, vel) {
      if (fallback) return fallback.noteOn(midi, t, dur, vel);
      const stop = inst.start({ note: midi, time: t, duration: dur, velocity: Math.round(20 + vel * 107) });
      return typeof stop === 'function' ? () => (stop as () => void)() : undefined;
    },
    stopAll() {
      fallback?.stopAll();
      try {
        inst.stop();
      } catch {
        /* not started */
      }
    },
    dispose() {
      this.stopAll();
      setTimeout(() => {
        inst.dispose?.();
        out.disconnect();
      }, 300);
    },
  };
}

const sampledCache = new Map<string, Instrument>();

/**
 * Synths are created per voice (cheap, independently stoppable). Sampled instruments
 * load a lot of audio, so instances are shared per instrument + note set and connect
 * to `sharedDest`.
 */
export function getInstrument(ctx: AudioContext, id: InstrumentId, voiceDest: AudioNode, sharedDest: AudioNode, need?: NoteSet): Instrument {
  switch (id) {
    case 'drums': return createDrums(ctx, voiceDest);
    case 'pad':
    case 'pluck':
    case 'bass':
    case 'lead': return createSynth(ctx, voiceDest, PATCHES[id]);
    default: {
      const key = need ? `${id}:${need.notes.join(',')}:${need.velocityRange.join('-')}` : id;
      let inst = sampledCache.get(key);
      if (!inst) sampledCache.set(key, (inst = createSampled(ctx, sharedDest, id, need)));
      return inst;
    }
  }
}
