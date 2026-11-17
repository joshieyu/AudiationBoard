import { useEffect, useRef, useState } from 'react';
import type { InstrumentId } from '../../shared/types';
import { INSTRUMENTS, instrumentInfo } from '../audio/instruments';
import { MidiCapture, takeToMidi } from '../audio/midiCapture';
import { startRecording, type Recording } from '../audio/recorder';
import { roleCss } from '../lib/colors';
import { addAudioFile, addMidiFile, freeSpot, SIZES } from '../store/actions';
import { useBoard } from '../store/board';
import { Dialog } from './ui/Popover';
import { Icon } from './ui/Icon';
import { toast } from './ui/toast';
import { useUi } from './uiState';

type Mode = 'voice' | 'midi';

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* per-tab only */
    }
  },
};

export function RecordDialog() {
  const { modal, close } = useUi();
  const [mode, setMode] = useState<Mode>(() => (store.get('audiation-record-mode') === 'midi' ? 'midi' : 'voice'));
  const [busy, setBusy] = useState(false);
  const open = modal === 'record';

  const pick = (m: Mode) => {
    setMode(m);
    store.set('audiation-record-mode', m);
  };

  // Closing unmounts the recorder, which cancels anything in progress.
  const dismiss = () => {
    setBusy(false);
    close();
  };

  return (
    <Dialog open={open} onClose={dismiss} title="Record an idea" wide={mode === 'midi'}>
      <div className={`seg rec-mode ${busy ? 'disabled' : ''}`} role="tablist" aria-label="What to record">
        <button role="tab" aria-selected={mode === 'voice'} className={mode === 'voice' ? 'on' : ''} disabled={busy} onClick={() => pick('voice')}>
          <span className="rm-label">
            <Icon name="mic" size={15} /> Audio
          </span>
          <small>Voice, guitar, anything with a mic</small>
        </button>
        <button role="tab" aria-selected={mode === 'midi'} className={mode === 'midi' ? 'on' : ''} disabled={busy} onClick={() => pick('midi')}>
          <span className="rm-label">
            <Icon name="piano" size={15} /> MIDI
          </span>
          <small>A MIDI keyboard or your computer keys</small>
        </button>
      </div>
      {mode === 'voice' ? <VoiceRecorder onBusy={setBusy} done={close} /> : <MidiRecorder onBusy={setBusy} done={close} />}
    </Dialog>
  );
}

// ---- Audio ----------------------------------------------------------------------------

function VoiceRecorder({ onBusy, done }: { onBusy: (b: boolean) => void; done: () => void }) {
  const boardBpm = useBoard((s) => s.board?.bpm ?? null);
  const [rec, setRec] = useState<Recording | null>(null);
  const [click, setClick] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const timer = useRef<HTMLSpanElement>(null);
  const live = useRef<Recording | null>(null);
  live.current = rec;

  useEffect(() => () => live.current?.cancel(), []);

  // Live waveform + timer.
  useEffect(() => {
    if (!rec) return;
    let raf = 0;
    const draw = () => {
      const c = canvas.current;
      if (c) {
        const dpr = Math.min(2, devicePixelRatio || 1);
        const w = c.clientWidth, h = c.clientHeight;
        if (c.width !== Math.round(w * dpr)) {
          c.width = Math.round(w * dpr);
          c.height = Math.round(h * dpr);
        }
        const ctx = c.getContext('2d')!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const peaks = rec.peaks();
        const bar = 3, gap = 2;
        const n = Math.floor(w / (bar + gap));
        const start = Math.max(0, peaks.length - n);
        ctx.fillStyle = getComputedStyle(c).color;
        for (let i = start; i < peaks.length; i++) {
          const v = Math.min(1, Math.pow(peaks[i], 0.6));
          const bh = Math.max(2, v * h * 0.9);
          const x = (i - start) * (bar + gap) + (n - (peaks.length - start)) * (bar + gap);
          ctx.beginPath();
          ctx.roundRect(x, (h - bh) / 2, bar, bh, 1.5);
          ctx.fill();
        }
      }
      if (timer.current) {
        const s = rec.seconds();
        timer.current.textContent = `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [rec]);

  const begin = async () => {
    setError(null);
    try {
      setRec(await startRecording({ metronomeBpm: click ? boardBpm : null }));
      onBusy(true);
    } catch (e) {
      const err = e as DOMException;
      setError(err.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in your browser’s site settings and try again.' : err.message || 'Could not start recording');
    }
  };

  const finish = async () => {
    if (!rec) return;
    setSaving(true);
    try {
      const { file, seconds } = await rec.stop();
      live.current = null;
      setRec(null);
      onBusy(false);
      done();
      if (seconds < 0.3) {
        toast('That was too short to keep');
        return;
      }
      void addAudioFile(file, freeSpot(SIZES.audio.w, SIZES.audio.h), { recorded: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="recorder">
      <div className={`rec-display ${rec ? 'live' : ''}`}>
        <canvas ref={canvas} />
        {!rec && <span className="rec-idle">Hum it, sing it, play it — it lands on the board as a tagged audio card.</span>}
      </div>
      <div className="rec-controls">
        <button className={`rec-btn ${rec ? 'on' : ''}`} onClick={rec ? finish : begin} disabled={saving} aria-label={rec ? 'Stop and add' : 'Start recording'}>
          {rec ? <Icon name="stop" size={22} /> : <Icon name="record" size={26} />}
        </button>
        <div className="rec-meta">
          <span ref={timer} className="mono rec-time">
            0:00
          </span>
          <span className="rec-state">{rec ? 'Recording — press stop to add it' : 'Ready'}</span>
        </div>
        {boardBpm && (
          <label className="toggle" title="A click at the board tempo — wear headphones so it isn't recorded">
            <input type="checkbox" checked={click} disabled={!!rec} onChange={(e) => setClick(e.target.checked)} />
            <span className="toggle-ui" />
            <Icon name="metronome" size={15} /> Click at {boardBpm}
          </label>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
      <p className="fine">Recorded as uncompressed 24-bit WAV with no noise suppression, so it drops straight into a session.</p>
    </div>
  );
}

// ---- MIDI -----------------------------------------------------------------------------

type Quantize = 'off' | '16' | '8';
const GRID: Record<Quantize, number | null> = { off: null, '16': 0.25, '8': 0.5 };
const VIEW_SECONDS = 8;

function MidiRecorder({ onBusy, done }: { onBusy: (b: boolean) => void; done: () => void }) {
  const boardBpm = useBoard((s) => s.board?.bpm ?? null);
  const [capture] = useState(() => new MidiCapture());
  const [, setTick] = useState(0);
  const [instrument, setInstrument] = useState<InstrumentId>(() => (store.get('audiation-midi-instrument') as InstrumentId | null) ?? 'piano');
  const [bpm, setBpm] = useState(() => Math.round(boardBpm ?? 120));
  const [click, setClick] = useState(() => store.get('audiation-midi-click') !== '0');
  const [quantize, setQuantize] = useState<Quantize>(() => (store.get('audiation-midi-quantize') as Quantize | null) ?? 'off');
  const [state, setState] = useState<'idle' | 'countin' | 'recording'>('idle');
  const canvas = useRef<HTMLCanvasElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const dots = useRef<HTMLSpanElement>(null);
  const settings = useRef({ bpm, click });
  settings.current = { bpm, click };

  useEffect(() => {
    const off = capture.onChange(() => setTick((t) => t + 1));
    void capture.open();
    return () => {
      off();
      capture.close();
    };
  }, [capture]);

  useEffect(() => {
    capture.setInstrument(instrument);
    store.set('audiation-midi-instrument', instrument);
  }, [capture, instrument]);

  // Live piano roll: the last few seconds, scrolling left, with the beat grid while recording.
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      if (!c) return;
      const dpr = Math.min(2, devicePixelRatio || 1);
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const styles = getComputedStyle(c);
      const now = (performance.now() - capture.t0) / 1000;
      const from = now - VIEW_SECONDS * 0.85;
      const x = (t: number) => ((t - from) / VIEW_SECONDS) * w;

      const { bpm: tempo, click: grid } = settings.current;
      if (capture.recording && grid) {
        const spb = 60 / tempo;
        for (let b = Math.floor(from / spb); b * spb < from + VIEW_SECONDS; b++) {
          ctx.fillStyle = b % 4 === 0 ? styles.getPropertyValue('--border-2') : styles.getPropertyValue('--border');
          ctx.fillRect(Math.round(x(b * spb)), 0, 1, h);
        }
      }

      const visible = capture.notes.filter((n) => (n.end ?? now) >= from);
      let lo = 60, hi = 72;
      for (const n of visible) {
        lo = Math.min(lo, n.n);
        hi = Math.max(hi, n.n);
      }
      lo -= 2;
      hi += 2;
      const row = h / (hi - lo + 1);
      ctx.fillStyle = capture.recording ? styles.getPropertyValue('--rec-note') : styles.getPropertyValue('--text-3');
      for (const n of visible) {
        const x0 = Math.max(0, x(n.t));
        const x1 = x(n.end ?? now);
        ctx.globalAlpha = n.end === null ? 1 : 0.55 + 0.4 * n.v;
        ctx.beginPath();
        ctx.roundRect(x0, h - (n.n - lo + 1) * row + 1, Math.max(3, x1 - x0), Math.max(2, row - 2), 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (capture.recording) {
        ctx.fillStyle = styles.getPropertyValue('--bad');
        ctx.fillRect(Math.round(x(now)), 0, 1.5, h);
      }

      if (clock.current) {
        if (!capture.recording) clock.current.textContent = '0:00';
        else if (now < 0) clock.current.textContent = `${Math.ceil(-now / (60 / tempo))}…`;
        else if (grid) {
          const beat = Math.floor(now / (60 / tempo));
          clock.current.textContent = `${Math.floor(beat / 4) + 1}.${(beat % 4) + 1}`;
        } else clock.current.textContent = `${Math.floor(now / 60)}:${Math.floor(now % 60).toString().padStart(2, '0')}`;
      }
      if (dots.current) dots.current.classList.toggle('lit', performance.now() - capture.lastActivity < 120);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [capture]);

  const begin = () => {
    store.set('audiation-midi-click', click ? '1' : '0');
    const lead = capture.start({ bpm, click, countIn: click });
    onBusy(true);
    setState(lead > 150 ? 'countin' : 'recording');
    if (lead > 150) setTimeout(() => setState((s) => (s === 'countin' ? 'recording' : s)), lead);
  };

  const finish = () => {
    const take = capture.stop();
    setState('idle');
    onBusy(false);
    if (!take.length) {
      toast('No notes were played, so nothing was added');
      return;
    }
    store.set('audiation-midi-quantize', quantize);
    const name = `${instrumentInfo(instrument).label} take ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const { bytes, count } = takeToMidi(take, { bpm, instrument, name, grid: GRID[quantize], fromFirstNote: !click });
    if (!count) {
      toast('No notes were played after the count-in');
      return;
    }
    done();
    const file = new File([bytes], `${name.replace(/[:/]/g, '.')}.mid`, { type: 'audio/midi' });
    void addMidiFile(file, freeSpot(SIZES.midi.w, SIZES.midi.h), { instrument });
  };

  const live = state !== 'idle';
  const octaveName = `C${capture.octave}`;

  return (
    <div className="recorder midi-rec">
      <div className="midi-inputs">
        <span ref={dots} className="midi-activity" aria-hidden />
        {capture.devices.map((d) => (
          <span key={d.id} className="midi-chip on">
            <Icon name="piano" size={13} /> {d.name}
          </span>
        ))}
        <label className={`midi-chip ${capture.keysEnabled ? 'on' : ''}`} title="Play with A to ; (black keys on W E T Y U O P). Z and X change octave.">
          <input
            type="checkbox"
            checked={capture.keysEnabled}
            onChange={(e) => {
              capture.keysEnabled = e.target.checked;
              setTick((t) => t + 1);
            }}
          />
          Computer keys · {octaveName}
        </label>
        {capture.deviceError === 'unsupported' && <span className="midi-note">This browser can't see MIDI keyboards (Chrome, Edge and Firefox can). Computer keys still work.</span>}
        {capture.deviceError === 'blocked' && <span className="midi-note">MIDI access was blocked. Allow it in your browser's site settings to use a keyboard.</span>}
        {!capture.deviceError && capture.devices.length === 0 && <span className="midi-note">No MIDI keyboard found. Plug one in and it shows up here.</span>}
      </div>

      <div className={`rec-display midi-display ${live ? 'live' : ''}`} style={{ ['--rec-note' as string]: roleCss(instrument === 'drums' ? 'drums' : 'lead') }}>
        <canvas ref={canvas} />
        {!live && capture.notes.length === 0 && (
          <span className="rec-idle">
            Play to warm up — you'll hear it. Nothing is kept until you press record.
            {capture.keysEnabled && (
              <span className="key-hint">
                <kbd>A</kbd>–<kbd>;</kbd> notes · <kbd>W</kbd> <kbd>E</kbd> <kbd>T</kbd> <kbd>Y</kbd> <kbd>U</kbd> sharps · <kbd>Z</kbd> <kbd>X</kbd> octave
              </span>
            )}
          </span>
        )}
      </div>

      <div className="rec-controls">
        <button className={`rec-btn ${live ? 'on' : ''}`} onClick={live ? finish : begin} aria-label={live ? 'Stop and add' : 'Start recording'}>
          {live ? <Icon name="stop" size={22} /> : <Icon name="record" size={26} />}
        </button>
        <div className="rec-meta">
          <span ref={clock} className="mono rec-time">
            0:00
          </span>
          <span className="rec-state">
            {state === 'countin' ? 'Count-in…' : state === 'recording' ? 'Recording — press stop to add it' : 'Ready'}
          </span>
        </div>
        <label className="midi-field">
          <span>Sound</span>
          <select value={instrument} onChange={(e) => setInstrument(e.target.value as InstrumentId)}>
            {INSTRUMENTS.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="midi-options">
        <label className="midi-field tempo">
          <span>Tempo</span>
          <input
            type="number"
            min={40}
            max={240}
            value={bpm}
            disabled={live}
            onChange={(e) => setBpm(Math.max(40, Math.min(240, Number(e.target.value) || 120)))}
          />
        </label>
        <label className="toggle" title="One bar of count-in, then a click on every beat. Takes line up with the bar.">
          <input type="checkbox" checked={click} disabled={live} onChange={(e) => setClick(e.target.checked)} />
          <span className="toggle-ui" />
          <Icon name="metronome" size={15} /> Click + count-in
        </label>
        <label className="midi-field">
          <span>Quantize</span>
          <select value={quantize} onChange={(e) => setQuantize(e.target.value as Quantize)}>
            <option value="off">Off (as played)</option>
            <option value="16">1/16 notes</option>
            <option value="8">1/8 notes</option>
          </select>
        </label>
      </div>
      <p className="fine">
        Saved as a standard MIDI file at {bpm} BPM{click ? ', starting on the bar' : ', starting at your first note'}. The sustain pedal is baked into note lengths.
      </p>
    </div>
  );
}
