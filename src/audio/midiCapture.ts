import { Midi } from '@tonejs/midi';
import type { InstrumentId } from '../../shared/types';
import { engine } from './engine';
import type { Instrument } from './instruments';

/** A note as played, in seconds from the start of the take. */
export interface TakeNote {
  n: number;
  /** 0..1 */
  v: number;
  t: number;
  /** null while the key (or the sustain pedal) is still down */
  end: number | null;
}

export interface MidiDevice {
  id: string;
  name: string;
}

// Computer keys: two rows like a piano, starting at C.
const KEY_NOTES: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};

const GM_PROGRAM: Record<InstrumentId, number> = {
  piano: 0, epiano: 4, mallet: 12, strings: 48, bass: 38, lead: 81, pad: 89, pluck: 45, drums: 0,
};

export const midiSupported = () => typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;

type Listener = () => void;

/**
 * Listens to every connected MIDI input and the computer keyboard, plays what's
 * played through an instrument, and records notes between start() and stop().
 */
export class MidiCapture {
  devices: MidiDevice[] = [];
  /** Set when MIDI access was refused or isn't available. */
  deviceError: string | null = null;
  octave = 4;
  keysEnabled = true;
  /** Notes sounding right now (for the live display), keyed by pitch. */
  held = new Map<number, TakeNote>();
  /** The take so far; also filled while not recording, then cleared on start(). */
  notes: TakeNote[] = [];
  recording = false;
  /** performance.now() of beat 1 of the take. */
  t0 = 0;
  lastActivity = 0;

  private access: MIDIAccess | null = null;
  private inst: Instrument | null = null;
  private instId: InstrumentId | null = null;
  private voices = new Map<number, (() => void) | void>();
  private sustain = false;
  private sustained = new Set<number>();
  /** Computer keys held down, and the note each one started. */
  private keysDown = new Map<string, number>();
  private clickTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<Listener>();

  onChange(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  async open() {
    await engine.resume();
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.allOff);
    if (!midiSupported()) {
      this.deviceError = 'unsupported';
      this.emit();
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess();
      this.access.onstatechange = () => this.bindInputs();
      this.bindInputs();
    } catch {
      this.deviceError = 'blocked';
      this.emit();
    }
  }

  close() {
    this.stopClick();
    this.allOff();
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.allOff);
    if (this.access) {
      for (const input of this.access.inputs.values()) input.onmidimessage = null;
      this.access.onstatechange = null;
    }
    this.inst?.stopAll();
    this.listeners.clear();
  }

  setInstrument(id: InstrumentId) {
    if (id === this.instId) return;
    this.allOff();
    this.inst?.stopAll();
    this.instId = id;
    this.inst = engine.liveInstrument(id);
  }

  private bindInputs() {
    if (!this.access) return;
    this.devices = [];
    for (const input of this.access.inputs.values()) {
      if (input.state !== 'connected') continue;
      input.onmidimessage = this.onMessage;
      this.devices.push({ id: input.id, name: input.name || 'MIDI input' });
    }
    this.emit();
  }

  private onMessage = (e: MIDIMessageEvent) => {
    const d = e.data;
    if (!d || d.length < 2) return;
    const type = d[0] & 0xf0;
    // Event timestamps share performance.now()'s clock and are more precise than "now".
    const at = e.timeStamp || performance.now();
    if (type === 0x90 && d[2] > 0) this.noteOn(d[1], d[2] / 127, at);
    else if (type === 0x80 || (type === 0x90 && d[2] === 0)) this.noteOff(d[1], at);
    else if (type === 0xb0 && d[1] === 64) this.setSustain(d[2] >= 64, at);
    else if (type === 0xb0 && (d[1] === 123 || d[1] === 120)) this.allOff();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.keysEnabled || e.metaKey || e.ctrlKey || e.altKey) return;
    // Only fields you type into keep the keys. A focused dropdown or toggle (say, right
    // after picking a sound) still plays, and preventDefault stops it changing the choice.
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    if (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'range'].includes(el.type)) return;
    if (e.code === 'KeyZ' || e.code === 'KeyX') {
      e.preventDefault();
      if (!e.repeat) {
        this.octave = Math.max(1, Math.min(7, this.octave + (e.code === 'KeyX' ? 1 : -1)));
        this.emit();
      }
      return;
    }
    const off = KEY_NOTES[e.code];
    if (off === undefined) return;
    e.preventDefault();
    if (e.repeat || this.keysDown.has(e.code)) return;
    const n = (this.octave + 1) * 12 + off;
    this.keysDown.set(e.code, n);
    this.noteOn(n, 0.75, performance.now());
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const n = this.keysDown.get(e.code);
    if (n === undefined) return;
    this.keysDown.delete(e.code);
    this.noteOff(n, performance.now());
  };

  private noteOn(n: number, v: number, at: number) {
    // Striking a held or sustained key again ends its previous note.
    if (this.held.has(n)) this.release(n, at);
    const note: TakeNote = { n, v, t: (at - this.t0) / 1000, end: null };
    this.held.set(n, note);
    this.sustained.delete(n);
    this.notes.push(note);
    // Between takes the notes only feed the display.
    if (!this.recording && this.notes.length > 400) this.notes.splice(0, this.notes.length - 400);
    this.lastActivity = performance.now();
    if (this.inst) {
      const ctx = engine.ctx;
      this.voices.get(n)?.();
      this.voices.set(n, this.inst.noteOn(n, ctx.currentTime, 30, v));
    }
    this.emit();
  }

  private noteOff(n: number, at: number) {
    if (this.sustain) {
      if (this.held.has(n)) this.sustained.add(n);
      return;
    }
    this.release(n, at);
  }

  private release(n: number, at: number) {
    const note = this.held.get(n);
    if (!note) return;
    note.end = (at - this.t0) / 1000;
    this.held.delete(n);
    this.voices.get(n)?.();
    this.voices.delete(n);
    this.emit();
  }

  private setSustain(on: boolean, at: number) {
    this.sustain = on;
    if (!on) {
      for (const n of this.sustained) this.release(n, at);
      this.sustained.clear();
    }
  }

  private allOff = () => {
    const now = performance.now();
    this.sustain = false;
    this.sustained.clear();
    this.keysDown.clear();
    for (const n of [...this.held.keys()]) this.release(n, now);
  };

  /** Starts a take. With a click, beat 1 lands after a one-bar count-in. Returns the count-in in ms. */
  start(opts: { bpm: number; click: boolean; countIn: boolean }) {
    const spb = 60 / opts.bpm;
    const ctx = engine.ctx;
    const lead = opts.click && opts.countIn ? 4 * spb : 0;
    const latency = (ctx.outputLatency || ctx.baseLatency || 0) * 1000;
    const ctxStart = ctx.currentTime + 0.1;
    this.t0 = performance.now() + 100 + lead * 1000 + latency;
    // Keep notes still held so a chord struck just before beat 1 isn't lost.
    this.notes = [...this.held.values()];
    this.recording = true;
    if (opts.click) this.startClick(ctxStart, spb);
    this.emit();
    return lead * 1000 + 100;
  }

  /** Ends the take and returns its notes, sorted, with held notes closed. */
  stop(): TakeNote[] {
    this.stopClick();
    const now = performance.now();
    this.recording = false;
    const end = (now - this.t0) / 1000;
    const take = this.notes.map((n) => ({ ...n, end: n.end ?? end })).filter((n) => n.end > n.t);
    this.notes = [];
    this.emit();
    return take.sort((a, b) => a.t - b.t || a.n - b.n);
  }

  private startClick(at: number, spb: number) {
    const ctx = engine.ctx;
    let next = at;
    let beat = 0;
    const tick = () => {
      while (next < ctx.currentTime + 0.15) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = beat % 4 === 0 ? 1760 : 1320;
        g.gain.setValueAtTime(0.22, next);
        g.gain.exponentialRampToValueAtTime(0.001, next + 0.05);
        o.connect(g).connect(ctx.destination);
        o.start(next);
        o.stop(next + 0.06);
        next += spb;
        beat++;
      }
    };
    tick();
    this.clickTimer = setInterval(tick, 25);
  }

  private stopClick() {
    if (this.clickTimer) clearInterval(this.clickTimer);
    this.clickTimer = null;
  }
}

/**
 * Turns a take into a Standard MIDI File. With `grid` (in beats) note starts and ends
 * snap to it. Without a click the take starts at its first note.
 */
export function takeToMidi(take: TakeNote[], opts: { bpm: number; instrument: InstrumentId; name: string; grid: number | null; fromFirstNote: boolean }) {
  const spb = 60 / opts.bpm;
  const midi = new Midi();
  midi.header.setTempo(opts.bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] });
  midi.header.name = opts.name;
  const ppq = midi.header.ppq;
  const track = midi.addTrack();
  track.name = opts.name;
  if (opts.instrument === 'drums') track.channel = 9;
  else track.instrument.number = GM_PROGRAM[opts.instrument];

  // Notes struck a hair before beat 1 belong on it.
  const early = 0.25 * spb;
  let notes = take.filter((n) => n.t >= -early).map((n) => ({ ...n, t: Math.max(0, n.t) }));
  if (opts.fromFirstNote && notes.length) {
    const first = notes[0].t;
    notes = notes.map((n) => ({ ...n, t: n.t - first, end: n.end! - first }));
  }
  for (const n of notes) {
    let s = n.t / spb;
    // A quick tap still gets a 1/32 note, so it shows up and sounds.
    let e = Math.max(n.end! / spb, s + 0.125);
    if (opts.grid) {
      const g = opts.grid;
      s = Math.round(s / g) * g;
      e = Math.max(s + g, Math.round(e / g) * g);
    }
    track.addNote({
      midi: n.n,
      ticks: Math.round(s * ppq),
      durationTicks: Math.max(1, Math.round((e - s) * ppq)),
      velocity: n.v,
    });
  }
  return { bytes: new Uint8Array(midi.toArray()), count: notes.length };
}
