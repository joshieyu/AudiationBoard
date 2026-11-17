import { useEffect, useRef, useState } from 'react';
import { startRecording, type Recording } from '../audio/recorder';
import { addAudioFile, freeSpot, SIZES } from '../store/actions';
import { useBoard } from '../store/board';
import { Dialog } from './ui/Popover';
import { Icon } from './ui/Icon';
import { toast } from './ui/toast';
import { useUi } from './uiState';

export function RecordDialog() {
  const { modal, close } = useUi();
  const boardBpm = useBoard((s) => s.board?.bpm ?? null);
  const [rec, setRec] = useState<Recording | null>(null);
  const [click, setClick] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const timer = useRef<HTMLSpanElement>(null);
  const open = modal === 'record';

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
      setRec(null);
      close();
      if (seconds < 0.3) {
        toast('That was too short to keep');
        return;
      }
      void addAudioFile(file, freeSpot(SIZES.audio.w, SIZES.audio.h), { recorded: true });
    } finally {
      setSaving(false);
    }
  };

  const dismiss = () => {
    rec?.cancel();
    setRec(null);
    close();
  };

  return (
    <Dialog open={open} onClose={dismiss} title="Record an idea">
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
    </Dialog>
  );
}
