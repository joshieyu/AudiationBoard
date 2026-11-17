import { useEffect, useRef, useState } from 'react';
import type { Character, Role, Source } from '../../shared/types';
import type { AdminStatus } from '../../shared/types';
import { adminKey, adminStatus, createAlbum, createBoard, formatBytes } from '../lib/api';
import { ROLES, roleCss } from '../lib/colors';
import { forgetBoard, recentBoards, recentHref, rememberBoard, type RecentBoard } from '../lib/identity';
import { toggleTheme, useTheme } from '../lib/theme';
import { drawWaveform } from './Waveform';
import { CharacterIcon, EnvelopeGlyph, RoleIcon, SourceIcon } from './SoundGlyphs';
import { Icon } from './ui/Icon';
import { navigate } from '../router';

/** A few synthetic waveforms to show the visual language before anything is uploaded. */
function demoPeaks(kind: 'pluck' | 'pad' | 'drums' | 'bass' | 'lead', n = 220) {
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    let pk = 0, br = 0.5;
    if (kind === 'pluck') {
      const ph = (t * 8) % 1;
      pk = Math.exp(-ph * 5) * (0.75 + 0.25 * Math.sin(i));
      br = 0.75 - ph * 0.4;
    } else if (kind === 'pad') {
      pk = 0.45 + 0.35 * Math.sin(t * Math.PI) + 0.08 * Math.sin(i * 0.3);
      br = 0.35 + 0.25 * Math.sin(t * 6);
    } else if (kind === 'drums') {
      const ph = (t * 16) % 1;
      const kick = Math.floor(t * 16) % 4 === 0;
      pk = (kick ? 1 : 0.55) * Math.exp(-ph * (kick ? 6 : 12)) + 0.08;
      br = kick ? 0.2 : 0.85;
    } else if (kind === 'bass') {
      const ph = (t * 4) % 1;
      pk = 0.85 - ph * 0.2;
      br = 0.12;
    } else {
      const ph = (t * 6) % 1;
      pk = 0.9 - ph * 0.15 + 0.05 * Math.sin(i * 0.7);
      br = 0.8;
    }
    out[i * 3] = Math.min(255, pk * 255);
    out[i * 3 + 1] = Math.min(255, pk * 0.62 * 255);
    out[i * 3 + 2] = Math.max(0, Math.min(255, br * 255));
  }
  return out;
}

const DEMOS: { role: Role; source: Source; character: Character; kind: Parameters<typeof demoPeaks>[0]; name: string; meta: string; env: number[] }[] = [
  { role: 'chords', source: 'acoustic', character: 'clean', kind: 'pluck', name: 'Nylon arp', meta: 'A min · 92', env: [0, 1, 0.7, 0.5, 0.36, 0.26, 0.18, 0.12, 0.08, 0.04, 0.02, 0] },
  { role: 'pad', source: 'electronic', character: 'clean', kind: 'pad', name: 'Glass pad', meta: 'C maj · 4 bars', env: [0, 0.15, 0.35, 0.58, 0.78, 0.9, 0.97, 1, 1, 0.98, 0.7, 0] },
  { role: 'drums', source: 'electronic', character: 'driven', kind: 'drums', name: 'Dusty break', meta: '92 BPM', env: [0, 1, 0.3, 0.08, 0.02, 0, 0, 0, 0, 0, 0, 0] },
  { role: 'lead', source: 'electronic', character: 'distorted', kind: 'lead', name: 'Fuzz lead', meta: 'A min · 8A', env: [0, 1, 0.9, 0.84, 0.82, 0.82, 0.82, 0.82, 0.8, 0.8, 0.5, 0] },
  { role: 'bass', source: 'electronic', character: 'clean', kind: 'bass', name: 'Sub 808', meta: 'A1 · one-shot', env: [0, 1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0] },
];

function DemoCard({ d, i }: { d: (typeof DEMOS)[number]; i: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useTheme((s) => s.theme);
  useEffect(() => {
    const c = ref.current!;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawWaveform(ctx, w, h, demoPeaks(d.kind), d, theme, true);
  }, [d, theme]);
  return (
    <div className="demo-card" style={{ ['--c' as string]: roleCss(d.role), animationDelay: `${i * 90}ms` }}>
      <div className="demo-top">
        <span className="demo-play">
          <Icon name="play" size={12} />
        </span>
        <span className="demo-name">{d.name}</span>
        <span className="demo-meta mono">{d.meta}</span>
      </div>
      <canvas ref={ref} />
      <div className="demo-sig">
        <span>
          <RoleIcon role={d.role} size={13} /> {ROLES[d.role].label}
        </span>
        <span>
          <SourceIcon source={d.source} size={13} />
        </span>
        <span>
          <CharacterIcon character={d.character} size={13} />
        </span>
        <EnvelopeGlyph shape={d.env} width={26} height={12} />
      </div>
    </div>
  );
}

export function Landing() {
  const [recent, setRecent] = useState<RecentBoard[]>(() => recentBoards());
  const [busy, setBusy] = useState<'single' | 'album' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const theme = useTheme((s) => s.theme);
  const [storage, setStorage] = useState<AdminStatus | null>(null);
  const isAdmin = !!adminKey();

  useEffect(() => {
    document.title = 'Audiation Space — a vision board that listens';
    // Only the admin's browser holds the key, so only the admin sees storage warnings.
    const key = adminKey();
    if (key) adminStatus(key).then(setStorage, () => {});
  }, []);

  const create = async (kind: 'single' | 'album') => {
    setBusy(kind);
    setErr(null);
    try {
      if (kind === 'album') {
        const a = await createAlbum();
        rememberBoard({ viewId: a.viewId, editId: a.editId, title: a.album.title, openedAt: Date.now(), kind: 'album', songs: a.songs.length });
        navigate(`/a/${a.editId}`);
      } else {
        const b = await createBoard();
        rememberBoard({ viewId: b.viewId, editId: b.editId, title: b.board.title, openedAt: Date.now() });
        navigate(`/e/${b.editId}`);
      }
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="landing">
      <header className="landing-nav">
        <span className="wordmark">
          <span className="logo-mark" aria-hidden>
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>Audiation <em>Space</em></span>
        </span>
        <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme">
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
        </button>
      </header>

      {storage?.low && (
        <a className="storage-banner" href="/admin" onClick={(e) => { e.preventDefault(); navigate('/admin'); }}>
          <Icon name="info" size={16} />
          <span>
            <b>Storage is running low.</b> {formatBytes(storage.disk.free)} free on the server
            {storage.minFree > 0 ? `; uploads stop at ${formatBytes(storage.minFree)}` : ''}.
          </span>
          <span className="sb-cta">
            Review projects <Icon name="chevronRight" size={14} />
          </span>
        </a>
      )}

      <main className="hero">
        <div className="hero-copy">
          <p className="eyebrow">For songwriters & producers</p>
          <h1>
            A vision board <em>that listens.</em>
          </h1>
          <p className="lede">
            Pin loops, stems, voice memos, MIDI, references, images and notes on one canvas. Every sound is analysed as it lands: role, key,
            tempo, tone, envelope and grit, so you can read a board at a glance and drag anything straight into your DAW.
          </p>
          <div className="hero-cta">
            <button className="btn primary lg" onClick={() => create('single')} disabled={!!busy} title="One board for one song or idea">
              {busy === 'single' ? <span className="spinner" /> : <Icon name="plus" size={18} />} New single
            </button>
            <button className="btn lg" onClick={() => create('album')} disabled={!!busy} title="Songs in tabs, plus an album page for the big picture">
              {busy === 'album' ? <span className="spinner" /> : <Icon name="layers" size={18} />} New album
            </button>
          </div>
          <p className="cta-note">No account. You get an edit link and a view link. A single can become an album later.</p>
          {err && <p className="form-error">{err}</p>}
        </div>
        <div className="hero-art" aria-hidden>
          {DEMOS.map((d, i) => (
            <DemoCard key={d.name} d={d} i={i} />
          ))}
        </div>
      </main>

      <section className="features">
        <div>
          <h3>Colour is the role</h3>
          <p>Leads, pads, bass, drums, vocals and FX each have their own hue, so a board reads like a mix at a distance.</p>
        </div>
        <div>
          <h3>Shape is the sound</h3>
          <p>Smooth curves for acoustic, stepped bars for electronic, clipped tops for distortion, and a tiny envelope for pluck vs swell.</p>
        </div>
        <div>
          <h3>Hear ideas together</h3>
          <p>Shift-click to layer loops and MIDI in sync, warped to the board tempo, with key-fit dots so clashes are obvious.</p>
        </div>
        <div>
          <h3>Straight into the session</h3>
          <p>Drag any sound or MIDI file into your DAW, or download the whole board as a zip sorted by role.</p>
        </div>
      </section>

      {recent.length > 0 && (
        <section className="recent">
          <h2>Your boards & albums</h2>
          <ul>
            {recent.map((b) => (
              <li key={b.viewId}>
                <span className={`rb-icon ${b.kind === 'album' ? 'album' : ''}`} aria-hidden>
                  <Icon name={b.kind === 'album' ? 'layers' : 'note'} size={16} />
                </span>
                <a href={recentHref(b)} onClick={(e) => { e.preventDefault(); navigate(recentHref(b)); }}>
                  <span className="rb-title">{b.title}</span>
                  <span className="rb-meta">
                    {b.kind === 'album' ? `Album${b.songs !== undefined ? ` · ${b.songs} song${b.songs === 1 ? '' : 's'}` : ''} · ` : ''}
                    {b.editId ? 'Can edit' : 'View only'} · opened {new Date(b.openedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                </a>
                <button
                  className="icon-btn sm"
                  title="Remove from this list (the board itself isn't deleted)"
                  aria-label="Remove from list"
                  onClick={() => {
                    forgetBoard(b.viewId);
                    setRecent(recentBoards());
                  }}
                >
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <footer className="landing-foot">
        Boards live on this server. Anyone with a board's link can open it — share edit links with care.
        {isAdmin && (
          <a href="/admin" onClick={(e) => { e.preventDefault(); navigate('/admin'); }}>
            Admin
          </a>
        )}
      </footer>
    </div>
  );
}
