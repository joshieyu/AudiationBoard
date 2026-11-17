import { useEffect, useRef, useState } from 'react';
import type { AnyItem } from '../../shared/types';
import { clipTempo, engine, usePlayback } from '../audio/engine';
import { keyName, parseKey } from '../lib/music';
import { ROLES, roleCss } from '../lib/colors';
import { setBoardMeta } from '../store/actions';
import { useBoard } from '../store/board';
import { RoleIcon } from './SoundGlyphs';
import { Icon } from './ui/Icon';
import { Popover } from './ui/Popover';
import { fitToContent } from './Canvas';

const ALL_KEYS = Array.from({ length: 24 }, (_, i) => keyName({ root: i % 12, mode: i < 12 ? 'major' : 'minor' }));

/** Most likely board key/tempo from what's on the board, weighted by confidence. */
function suggest(items: AnyItem[]) {
  const keys = new Map<string, number>();
  const tempos = new Map<number, number>();
  for (const it of items) {
    if (it.type !== 'audio' && it.type !== 'midi') continue;
    const t = it.data.tags;
    if (!t) continue;
    const k = parseKey(t.key.v);
    if (k && (t.key.src !== 'auto' || t.key.conf >= 0.4)) {
      const name = keyName(k);
      keys.set(name, (keys.get(name) ?? 0) + (t.key.src === 'auto' ? t.key.conf : 1.5));
    }
    const b = it.type === 'midi' ? it.data.summary?.bpm ?? null : clipTempo(t);
    if (b) {
      const r = Math.round(b);
      tempos.set(r, (tempos.get(r) ?? 0) + (t.bpm.src === 'auto' ? t.bpm.conf : 1.5));
    }
  }
  const best = <T,>(m: Map<T, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { key: best(keys), bpm: best(tempos) };
}

function TempoKey() {
  const board = useBoard((s) => s.board);
  const editable = useBoard((s) => s.access === 'edit');
  const items = useBoard((s) => s.items);
  const sync = usePlayback((s) => s.sync);
  const stretch = usePlayback((s) => s.stretch);
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [bpmText, setBpmText] = useState('');
  const taps = useRef<number[]>([]);
  const [tapCount, setTapCount] = useState(0);

  useEffect(() => setBpmText(board?.bpm ? String(board.bpm) : ''), [board?.bpm, open]);

  const tap = () => {
    const now = performance.now();
    taps.current = taps.current.filter((t) => now - t < 2500).concat(now);
    if (taps.current.length >= 3) {
      const iv = taps.current.slice(1).map((t, i) => t - taps.current[i]);
      const bpm = Math.round(60000 / (iv.reduce((a, b) => a + b, 0) / iv.length));
      setTapCount(taps.current.length);
      setBpmText(String(bpm));
      // Commit once there are enough taps to trust the average.
      if (taps.current.length >= 4) commitBpm(String(bpm));
    } else setTapCount(taps.current.length);
  };

  const commitBpm = (raw: string) => {
    const v = raw.trim() ? Math.round(Number(raw) * 10) / 10 : null;
    if (v === null || (v >= 40 && v <= 300)) {
      if (v !== board?.bpm) setBoardMeta({ bpm: v });
    } else setBpmText(board?.bpm ? String(board.bpm) : '');
  };

  const sug = suggest(Object.values(items));
  const keyLabel = board?.key ? board.key.replace(' major', '').replace(' minor', 'm') : 'Key';
  return (
    <>
      <button ref={ref} className="tk-btn" onClick={() => setOpen((o) => !o)} title="Board tempo & key — clips show whether they fit">
        <span className="mono tk-bpm">{board?.bpm ?? '—'}</span>
        <span className="tk-unit">BPM</span>
        <span className="tk-sep" />
        <span className={`tk-key ${board?.key ? '' : 'dim'}`}>{keyLabel}</span>
        {sync && board?.bpm && <span className="tk-sync" title="Playback synced to board tempo">SYNC</span>}
      </button>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} width={300} placement="top">
        <div className="tk-pop">
          <div className="eyebrow">Board tempo & key</div>
          <p className="fine">Clips get a fit dot against these. With sync on, loops and MIDI play at the board tempo.</p>
          <div className="tk-row">
            <label className="tk-field">
              <span>Tempo</span>
              <input
                className="mono"
                inputMode="decimal"
                value={bpmText}
                placeholder="—"
                disabled={!editable}
                onChange={(e) => setBpmText(e.target.value)}
                onBlur={(e) => commitBpm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </label>
            {editable && (
              <button className="btn sm" onClick={tap} title="Tap along four or more times">
                <Icon name="tap" size={15} /> {tapCount > 0 && tapCount < 4 ? `Tap ${4 - tapCount}` : 'Tap'}
              </button>
            )}
            <label className="tk-field grow">
              <span>Key</span>
              <select value={board?.key ?? ''} disabled={!editable} onChange={(e) => setBoardMeta({ key: e.target.value || null })}>
                <option value="">—</option>
                {ALL_KEYS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
          </div>
          {editable && (sug.key || sug.bpm) && (sug.key !== board?.key || sug.bpm !== board?.bpm) && (
            <button
              className="suggest"
              onClick={() => {
                setBoardMeta({ ...(sug.bpm ? { bpm: sug.bpm } : {}), ...(sug.key ? { key: sug.key } : {}) });
              }}
            >
              <Icon name="sparkle" size={14} /> Use what's on the board: {[sug.bpm && `${sug.bpm} BPM`, sug.key].filter(Boolean).join(' · ')}
            </button>
          )}
          <div className="tk-divider" />
          <label className="toggle">
            <input type="checkbox" checked={sync} onChange={(e) => engine.setSync(e.target.checked)} />
            <span className="toggle-ui" />
            Sync playback to board tempo
          </label>
          <div className={`seg ${sync ? '' : 'disabled'}`} role="radiogroup" aria-label="Stretch mode">
            <button role="radio" aria-checked={stretch === 'warp'} className={stretch === 'warp' ? 'on' : ''} onClick={() => engine.setStretch('warp')} disabled={!sync}>
              Warp
              <small>keeps pitch</small>
            </button>
            <button role="radio" aria-checked={stretch === 'varispeed'} className={stretch === 'varispeed' ? 'on' : ''} onClick={() => engine.setStretch('varispeed')} disabled={!sync}>
              Varispeed
              <small>tape-style</small>
            </button>
          </div>
          <p className="fine">Sync settings are just for you; tempo and key are shared with the board.</p>
        </div>
      </Popover>
    </>
  );
}

function Meter() {
  const bar = useRef<HTMLDivElement>(null);
  const any = usePlayback((s) => Object.keys(s.playing).length > 0);
  useEffect(() => {
    if (!any) {
      if (bar.current) bar.current.style.transform = 'scaleX(0)';
      return;
    }
    let raf = 0, held = 0;
    const tick = () => {
      const lv = engine.level();
      held = Math.max(lv, held * 0.92);
      if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, Math.pow(held, 0.6))})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [any]);
  return (
    <div className="meter" aria-hidden>
      <div ref={bar} />
    </div>
  );
}

export function Transport() {
  const playing = usePlayback((s) => s.playing);
  const loading = usePlayback((s) => s.loading);
  const volume = usePlayback((s) => s.volume);
  const items = useBoard((s) => s.items);
  const boardBpm = useBoard((s) => s.board?.bpm ?? null);
  const ids = [...new Set([...Object.keys(playing), ...Object.keys(loading)])].filter((id) => items[id]);

  useEffect(() => engine.setBoardTempo(boardBpm), [boardBpm]);

  return (
    <div className="transport panel">
      <TempoKey />
      <div className="tr-mix">
        {ids.length === 0 ? (
          <span className="tr-hint">
            {matchMedia('(hover: none)').matches ? (
              <>Tap ▶ to listen · Layer stacks sounds</>
            ) : (
              <>
                <span className="hide-sm">Click ▶ to listen · </span>
                <kbd>Shift</kbd>-click ▶ to layer
              </>
            )}
          </span>
        ) : (
          ids.map((id) => {
            const it = items[id];
            if (it.type !== 'audio' && it.type !== 'midi') return null;
            const role = it.data.tags?.role.v ?? 'other';
            return (
              <button key={id} className={`mix-chip ${loading[id] ? 'loading' : ''}`} style={{ ['--c' as string]: roleCss(role) }} onClick={() => fitToContent([id])} title={`${ROLES[role].label} — click to find it`}>
                <RoleIcon role={role} size={13} />
                <span>{it.data.title ?? it.data.file.name}</span>
                <span
                  className="x"
                  role="button"
                  aria-label="Stop"
                  onClick={(e) => {
                    e.stopPropagation();
                    engine.stop(id);
                  }}
                >
                  <Icon name="close" size={12} />
                </span>
              </button>
            );
          })
        )}
      </div>
      {ids.length > 0 && (
        <button className="icon-btn" onClick={() => engine.stopAll()} title="Stop everything (Esc)" aria-label="Stop all">
          <Icon name="stop" size={14} />
        </button>
      )}
      <Meter />
      <input
        className="volume hide-sm"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(e) => engine.setVolume(Number(e.target.value))}
        aria-label="Volume"
        style={{ ['--v' as string]: `${volume * 100}%` }}
      />
    </div>
  );
}
