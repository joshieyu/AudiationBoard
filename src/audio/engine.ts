import { create } from 'zustand';
import type { InstrumentId, Item, SoundTags, Trim } from '../../shared/types';
import { tempoRatio } from '../lib/music';
import { decodeAudio } from './decode';
import { getInstrument, type Instrument } from './instruments';
import { notesFromSummary, parseMidi, type NoteEv } from './midi';
import { stretchBuffer } from './workerClient';

export type StretchMode = 'warp' | 'varispeed';
type Playable = Item<'audio'> | Item<'midi'>;

interface PlaybackState {
  playing: Record<string, { layered: boolean; loop: boolean }>;
  loading: Record<string, true>;
  sync: boolean;
  stretch: StretchMode;
  volume: number;
  boardBpm: number | null;
}

const prefs = (() => {
  try {
    return JSON.parse(localStorage.getItem('ab:playback') ?? '{}') as Partial<PlaybackState>;
  } catch {
    return {};
  }
})();

export const usePlayback = create<PlaybackState>(() => ({
  playing: {},
  loading: {},
  sync: prefs.sync ?? true,
  stretch: prefs.stretch ?? 'warp',
  volume: prefs.volume ?? 0.85,
  boardBpm: null,
}));

function savePrefs() {
  const { sync, stretch, volume } = usePlayback.getState();
  try {
    localStorage.setItem('ab:playback', JSON.stringify({ sync, stretch, volume }));
  } catch {
    /* storage unavailable */
  }
}

interface Voice {
  id: string;
  item: Playable;
  /** Context time at which the clip was at native position `pos0`. */
  t0: number;
  pos0: number;
  /** Native clip seconds per real second. */
  speed: number;
  loop: boolean;
  loopLen: number;
  /** Length of what plays: the trimmed region, or the whole clip. */
  duration: number;
  /** Where that region starts in the clip, and the clip's full length (seconds). */
  offset: number;
  total: number;
  layered: boolean;
  gain: GainNode;
  stop(): void;
  setLoop?(loop: boolean): void;
}

const MAX_CACHE_BYTES = 450 * 1024 * 1024;
const LOOKAHEAD = 0.15;

/** Usable tempo for syncing: confident enough, and not a one-shot. */
/** The part of a clip that plays, clamped to the clip and at least `min` long. */
export function trimRegion(trim: Trim | null | undefined, total: number, min: number) {
  if (!trim) return { start: 0, end: total, trimmed: false };
  const start = Math.max(0, Math.min(trim.start, total - min));
  const end = Math.max(start + min, Math.min(trim.end, total));
  return { start, end, trimmed: start > 1e-4 || end < total - 1e-4 };
}

/** A clip position (seek, resume) as a position inside the region, if one was given. */
function regionFrom(from: number | undefined, start: number, length: number) {
  if (from === undefined) return undefined;
  const rel = from - start;
  return rel >= 0 && rel < length ? rel : 0;
}

export function clipTempo(tags: SoundTags | undefined): number | null {
  if (!tags?.bpm.v || tags.kind.v === 'oneshot') return null;
  if (tags.bpm.src === 'auto' && tags.bpm.conf < 0.4) return null;
  return tags.bpm.v;
}

class AudioEngine {
  private _ctx: AudioContext | null = null;
  private master!: GainNode;
  private midiBus!: GainNode;
  private analyser!: AnalyserNode;
  private meterBuf = new Float32Array(1024);
  private buffers = new Map<string, { p: Promise<AudioBuffer>; bytes: number; used: number }>();
  private stretched = new Map<string, Promise<AudioBuffer>>();
  private midiCache = new Map<string, Promise<NoteEv[]>>();
  private voices = new Map<string, Voice>();
  private session: { t0: number } | null = null;
  private generation = new Map<string, number>();

  get ctx(): AudioContext {
    if (!this._ctx) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this._ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = usePlayback.getState().volume;
      // Safety limiter for when several layers stack up.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.master.connect(limiter).connect(this.analyser).connect(ctx.destination);

      // Instruments get a little room so MIDI previews don't sound bone dry.
      this.midiBus = ctx.createGain();
      this.midiBus.connect(this.master);
      const send = ctx.createGain();
      send.gain.value = 0.22;
      const verb = ctx.createConvolver();
      verb.buffer = makeImpulse(ctx, 2.4);
      this.midiBus.connect(send).connect(verb).connect(this.master);
    }
    return this._ctx;
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  /** An instrument for playing live (MIDI recording), on the same bus as MIDI cards. */
  liveInstrument(id: InstrumentId): Instrument {
    const ctx = this.ctx;
    // Sampled instruments load only the playable middle of the range at a few velocities.
    const notes = Array.from({ length: 61 }, (_, i) => 36 + i);
    return getInstrument(ctx, id, this.midiBus, this.midiBus, { notes, velocityRange: [36, 112] });
  }

  // ---- Loading ----------------------------------------------------------------------

  getBuffer(url: string): Promise<AudioBuffer> {
    const hit = this.buffers.get(url);
    if (hit) {
      hit.used = performance.now();
      return hit.p;
    }
    const entry = { p: null as unknown as Promise<AudioBuffer>, bytes: 0, used: performance.now() };
    entry.p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Couldn't load audio (${r.status})`);
        return r.arrayBuffer();
      })
      .then((data) => decodeAudio(this.ctx, data))
      .then((buf) => {
        entry.bytes = buf.length * buf.numberOfChannels * 4;
        this.evict();
        return buf;
      });
    entry.p.catch(() => this.buffers.delete(url));
    this.buffers.set(url, entry);
    return entry.p;
  }

  /** Seed the cache with a buffer we already decoded (e.g. right after upload). */
  primeBuffer(url: string, buf: AudioBuffer) {
    this.buffers.set(url, { p: Promise.resolve(buf), bytes: buf.length * buf.numberOfChannels * 4, used: performance.now() });
    this.evict();
  }

  async decodeFile(file: Blob): Promise<AudioBuffer> {
    return decodeAudio(this.ctx, await file.arrayBuffer());
  }

  private evict() {
    let total = 0;
    for (const e of this.buffers.values()) total += e.bytes;
    if (total <= MAX_CACHE_BYTES) return;
    const playingUrls = new Set([...this.voices.values()].map((v) => v.item.data.file.url));
    const lru = [...this.buffers.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [url, e] of lru) {
      if (total <= MAX_CACHE_BYTES) break;
      if (playingUrls.has(url)) continue;
      this.buffers.delete(url);
      for (const k of this.stretched.keys()) if (k.startsWith(url + '|')) this.stretched.delete(k);
      total -= e.bytes;
    }
  }

  private getStretched(url: string, buf: AudioBuffer, factor: number, circular: boolean) {
    const key = `${url}|${factor.toFixed(4)}|${circular ? 1 : 0}`;
    let p = this.stretched.get(key);
    if (!p) {
      p = stretchBuffer(buf, factor, circular).then((chs) => {
        const out = this.ctx.createBuffer(chs.length, chs[0].length, buf.sampleRate);
        chs.forEach((c, i) => out.copyToChannel(c as Float32Array<ArrayBuffer>, i));
        return out;
      });
      p.catch(() => this.stretched.delete(key));
      this.stretched.set(key, p);
    }
    return p;
  }

  private getMidiNotes(item: Item<'midi'>): Promise<NoteEv[]> {
    const s = item.data.summary;
    if (s && !s.truncated) return Promise.resolve(notesFromSummary(s));
    const url = item.data.file.url;
    let p = this.midiCache.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => r.arrayBuffer())
        .then((b) => parseMidi(b).notes);
      p.catch(() => this.midiCache.delete(url));
      this.midiCache.set(url, p);
    }
    return p;
  }

  // ---- Transport ----------------------------------------------------------------------

  isPlaying(id: string) {
    return this.voices.has(id);
  }

  /** Native clip position in seconds, for playheads. */
  position(id: string): { pos: number; duration: number; loopLen: number } | null {
    const v = this.voices.get(id);
    if (!v || !this._ctx) return null;
    let pos = v.pos0 + Math.max(0, this.ctx.currentTime - v.t0) * v.speed;
    if (v.loop && v.loopLen > 0) pos %= v.loopLen;
    // Positions outside the engine are clip positions, so a trimmed clip's playhead sits in its region.
    return { pos: v.offset + Math.min(pos, v.duration), duration: v.total, loopLen: v.loopLen };
  }

  private tempoFactor(item: Playable): number {
    const { sync, boardBpm } = usePlayback.getState();
    if (!sync || !boardBpm) return 1;
    const bpm = item.type === 'midi' ? item.data.summary?.bpm ?? null : clipTempo(item.data.tags);
    if (!bpm) return 1;
    const r = tempoRatio(bpm, boardBpm);
    return Math.abs(r - 1) < 0.002 ? 1 : r;
  }

  async play(item: Playable, opts: { layer?: boolean; from?: number; loop?: boolean } = {}) {
    await this.resume();
    const id = item.id;
    const gen = (this.generation.get(id) ?? 0) + 1;
    this.generation.set(id, gen);
    const existing = this.voices.get(id);
    const layer = opts.layer ?? false;
    if (!layer) {
      for (const v of [...this.voices.values()]) if (v.id !== id) this.stopVoice(v);
      this.session = null;
    }
    if (existing) this.stopVoice(existing);

    this.setLoading(id, true);
    try {
      const voice = item.type === 'audio' ? await this.startAudio(item, layer, opts, gen) : await this.startMidi(item, layer, opts, gen);
      if (!voice) return;
      this.voices.set(id, voice);
      this.syncState();
    } finally {
      if (this.generation.get(id) === gen) this.setLoading(id, false);
    }
  }

  /** Where a new voice should start so it sits on the shared bar grid. */
  private startPos(when: number, speed: number, loopLen: number, duration: number, layer: boolean, from?: number) {
    if (from !== undefined) {
      if (!layer || !this.session) this.session = { t0: when - from / speed };
      return from;
    }
    if (layer && this.session) {
      const elapsed = (when - this.session.t0) * speed;
      if (loopLen > 0) return elapsed % loopLen;
      return elapsed < duration ? elapsed : 0;
    }
    this.session = { t0: when };
    return 0;
  }

  private async startAudio(item: Item<'audio'>, layer: boolean, opts: { from?: number; loop?: boolean }, gen: number): Promise<Voice | null> {
    const url = item.data.file.url;
    const buf = await this.getBuffer(url);
    const r = this.tempoFactor(item);
    const { stretch } = usePlayback.getState();
    const total = buf.duration;
    const region = trimRegion(item.data.trim, total, 0.02);
    const duration = region.end - region.start;
    const tags = item.data.tags;
    const bars = item.data.analysis?.bars;
    const bpm = clipTempo(tags);
    let loopLen = duration;
    // Untrimmed loops snap to their exact bar length; a trim is taken as set.
    if (!region.trimmed && bars && bpm) {
      const exact = (bars * 240) / bpm;
      if (Math.abs(exact - duration) / duration < 0.03) loopLen = Math.min(exact, duration);
    }
    const loop = opts.loop ?? (layer ? true : item.data.loop ?? tags?.kind.v === 'loop');
    const warp = r !== 1 && stretch === 'warp';
    const playBuf = warp ? await this.getStretched(url, buf, r, loop && tags?.kind.v === 'loop') : buf;
    if (this.generation.get(item.id) !== gen) return null;

    const ctx = this.ctx;
    const speed = 1 / r;
    const when = ctx.currentTime + 0.03;
    const pos = this.startPos(when, speed, loop ? loopLen : 0, duration, layer, regionFrom(opts.from, region.start, duration));
    // Buffer-time scale: stretched buffers are r× longer; varispeed uses playbackRate.
    const bScale = warp ? r : 1;
    const src = ctx.createBufferSource();
    src.buffer = playBuf;
    if (!warp && r !== 1) src.playbackRate.value = speed;
    src.loop = loop;
    src.loopStart = region.start * bScale;
    src.loopEnd = Math.min(playBuf.duration, (region.start + loopLen) * bScale);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(1, when + 0.006);
    src.connect(gain).connect(this.master);
    const startAt = Math.min((region.start + pos) * bScale, playBuf.duration - 0.001);
    // Without looping, stop at the trim's end.
    if (loop) src.start(when, startAt);
    else src.start(when, startAt, Math.max(0.001, (duration - pos) * bScale));

    const voice: Voice = {
      id: item.id,
      item,
      t0: when,
      pos0: pos,
      speed,
      loop,
      loopLen,
      duration,
      offset: region.start,
      total,
      layered: layer,
      gain,
      stop: () => {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.012);
        try {
          src.stop(now + 0.015);
        } catch {
          /* not started */
        }
        src.onended = null;
      },
      setLoop: (l) => {
        src.loop = l;
      },
    };
    src.onended = () => {
      if (this.voices.get(item.id) === voice) {
        this.voices.delete(item.id);
        if (!this.voices.size) this.session = null;
        this.syncState();
      }
    };
    return voice;
  }

  private async startMidi(item: Item<'midi'>, layer: boolean, opts: { from?: number; loop?: boolean }, gen: number): Promise<Voice | null> {
    const summary = item.data.summary;
    if (!summary) return null;
    const allNotes = await this.getMidiNotes(item);
    // A trim keeps the notes that start inside it, shifted to its start and cut at its end.
    const beats = trimRegion(item.data.trim, summary.beats, 0.25);
    const regionBeats = beats.end - beats.start;
    const notes = beats.trimmed
      ? allNotes
          .filter((n) => n.s >= beats.start - 1e-6 && n.s < beats.end - 1e-6)
          .map((n) => ({ ...n, s: n.s - beats.start, l: Math.min(n.l, beats.end - n.s) }))
      : allNotes;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.connect(this.midiBus);
    const pitched = notes.filter((n) => !n.drum);
    const vels = pitched.map((n) => Math.round(n.v * 127));
    const need = pitched.length
      ? { notes: [...new Set(pitched.map((n) => n.n))].sort((a, b) => a - b), velocityRange: [Math.max(1, Math.min(...vels) - 8), Math.min(127, Math.max(...vels) + 8)] as [number, number] }
      : undefined;
    const inst: Instrument = getInstrument(ctx, item.data.instrument, gain, this.midiBus, need);
    await inst.ready;
    if (this.generation.get(item.id) !== gen) {
      if (!inst.shared) inst.dispose();
      gain.disconnect();
      return null;
    }
    const r = this.tempoFactor(item);
    const fileSpb = 60 / summary.bpm;
    const duration = regionBeats * fileSpb;
    const loopLen = duration;
    const speed = 1 / r;
    const loop = opts.loop ?? (layer ? true : item.data.loop ?? true);
    const when = ctx.currentTime + 0.05;
    const pos = this.startPos(when, speed, loop ? loopLen : 0, duration, layer, regionFrom(opts.from, beats.start * fileSpb, duration));

    // Lookahead scheduler over native-beat note times.
    const spbReal = fileSpb * r;
    const startBeat = pos / fileSpb;
    let cycle = 0;
    let idx = notes.findIndex((n) => n.s >= startBeat - 1e-6);
    if (idx < 0) idx = notes.length;
    const stoppers: (() => void)[] = [];
    let ended = false;
    const tick = () => {
      const until = ctx.currentTime + LOOKAHEAD;
      for (;;) {
        if (idx >= notes.length) {
          if (!loop) {
            if (!ended) {
              ended = true;
              const endAt = when + (regionBeats - startBeat) * spbReal;
              setTimeout(() => finish(), Math.max(0, (endAt - ctx.currentTime) * 1000) + 200);
            }
            return;
          }
          idx = 0;
          cycle++;
        }
        const n = notes[idx];
        const t = when + (cycle * regionBeats + n.s - startBeat) * spbReal;
        if (t > until) return;
        if (t >= ctx.currentTime - 0.01) {
          const stop = inst.noteOn(n.drum ? n.n : n.n, Math.max(t, ctx.currentTime), Math.max(0.03, n.l * spbReal), n.v);
          if (stop && inst.shared) stoppers.push(stop);
        }
        idx++;
        if (stoppers.length > 512) stoppers.splice(0, 256);
      }
    };
    tick();
    const timer = setInterval(tick, 25);

    const finish = () => {
      clearInterval(timer);
      if (this.voices.get(item.id) === voice) {
        this.voices.delete(item.id);
        if (!this.voices.size) this.session = null;
        this.syncState();
      }
    };
    const voice: Voice = {
      id: item.id,
      item,
      t0: when,
      pos0: pos,
      speed,
      loop,
      loopLen,
      duration,
      offset: beats.start * fileSpb,
      total: summary.beats * fileSpb,
      layered: layer,
      gain,
      stop: () => {
        clearInterval(timer);
        const now = ctx.currentTime;
        if (inst.shared) {
          for (const s of stoppers) s();
        } else {
          gain.gain.setTargetAtTime(0, now, 0.02);
          inst.stopAll();
          setTimeout(() => {
            inst.dispose();
            gain.disconnect();
          }, 300);
        }
      },
    };
    return voice;
  }

  private stopVoice(v: Voice) {
    v.stop();
    if (this.voices.get(v.id) === v) this.voices.delete(v.id);
    if (!this.voices.size) this.session = null;
    this.syncState();
  }

  stop(id: string) {
    this.generation.set(id, (this.generation.get(id) ?? 0) + 1);
    this.setLoading(id, false);
    const v = this.voices.get(id);
    if (v) this.stopVoice(v);
  }

  stopAll() {
    for (const id of Object.keys(usePlayback.getState().loading)) this.stop(id);
    for (const v of [...this.voices.values()]) this.stopVoice(v);
    this.session = null;
  }

  /** Toggle between solo and layered for a clip that is already playing. */
  async toggle(item: Playable, layer: boolean) {
    if (this.voices.has(item.id) || usePlayback.getState().loading[item.id]) this.stop(item.id);
    else await this.play(item, { layer });
  }

  setLoop(id: string, loop: boolean) {
    const v = this.voices.get(id);
    if (!v) return;
    if (v.setLoop) {
      // Re-anchor so the playhead stays continuous when looping turns off past the end.
      const p = this.position(id);
      v.loop = loop;
      v.setLoop(loop);
      if (p) {
        v.pos0 = p.pos - v.offset;
        v.t0 = this.ctx.currentTime;
      }
      this.syncState();
    } else {
      void this.play(v.item, { layer: v.layered, from: this.position(id)?.pos, loop });
    }
  }

  /** Restart playing voices so they pick up new tempo or stretch settings. */
  private resync() {
    const vs = [...this.voices.values()];
    if (!vs.length) return;
    const snapshot = vs.map((v) => ({ item: v.item, layered: v.layered, loop: v.loop, pos: this.position(v.id)?.pos ?? 0 }));
    for (const v of vs) this.stopVoice(v);
    this.session = null;
    const [first, ...rest] = snapshot;
    void this.play(first.item, { layer: false, from: first.pos, loop: first.loop }).then(() => {
      for (const s of rest) void this.play(s.item, { layer: true, loop: s.loop });
    });
  }

  /** Pick up item changes (instrument, tags) for a clip that is playing. */
  refresh(item: Playable) {
    const v = this.voices.get(item.id);
    if (!v) return;
    void this.play(item, { layer: v.layered, from: this.position(item.id)?.pos, loop: v.loop });
  }

  setBoardTempo(bpm: number | null) {
    if (usePlayback.getState().boardBpm === bpm) return;
    usePlayback.setState({ boardBpm: bpm });
    if (usePlayback.getState().sync) this.resync();
  }

  setSync(sync: boolean) {
    usePlayback.setState({ sync });
    savePrefs();
    this.resync();
  }

  setStretch(stretch: StretchMode) {
    usePlayback.setState({ stretch });
    savePrefs();
    this.resync();
  }

  setVolume(volume: number) {
    usePlayback.setState({ volume });
    if (this._ctx) this.master.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.02);
    savePrefs();
  }

  /** Peak output level 0..1 for meters. */
  level() {
    if (!this._ctx || !this.voices.size) return 0;
    this.analyser.getFloatTimeDomainData(this.meterBuf);
    let pk = 0;
    for (const v of this.meterBuf) pk = Math.max(pk, Math.abs(v));
    return pk;
  }

  private setLoading(id: string, on: boolean) {
    const loading = { ...usePlayback.getState().loading };
    if (on) loading[id] = true;
    else delete loading[id];
    usePlayback.setState({ loading });
  }

  private syncState() {
    const playing: PlaybackState['playing'] = {};
    for (const v of this.voices.values()) playing[v.id] = { layered: v.layered, loop: v.loop };
    usePlayback.setState({ playing });
  }
}

function makeImpulse(ctx: BaseAudioContext, seconds: number) {
  const len = Math.round(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // Darkening exponential tail with a short pre-delay.
      lp = lp * 0.55 + (Math.random() * 2 - 1) * 0.45;
      d[i] = i < ctx.sampleRate * 0.012 ? 0 : lp * Math.pow(1 - t, 3.2);
    }
  }
  return buf;
}

export const engine = new AudioEngine();
