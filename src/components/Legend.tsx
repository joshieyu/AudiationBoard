import { useMemo } from 'react';
import type { Character, Role, Source } from '../../shared/types';
import { CHARACTERS, ENVELOPES, ROLE_ORDER, ROLES, SOURCES, roleCss } from '../lib/colors';
import { useBoard } from '../store/board';
import { CharacterIcon, EnvelopeGlyph, RoleIcon, SourceIcon } from './SoundGlyphs';
import { Icon } from './ui/Icon';
import { useUi } from './uiState';

/** Little waveform demos so the legend shows exactly what cards show. */
function MiniWave({ source, character }: { source: Source; character: Character }) {
  const vals = [0.3, 0.55, 0.8, 1, 0.9, 0.7, 0.85, 1, 0.75, 0.5, 0.65, 0.4];
  const clip = character === 'distorted' ? 0.62 : character === 'driven' ? 0.82 : 1;
  const h = 18, mid = h / 2;
  const v = (x: number) => (Math.min(x, clip) / clip) * (mid - 1);
  if (source === 'acoustic') {
    const pts = vals.map((x, i) => `${2 + i * 3.6},${(mid - v(x)).toFixed(1)}`).join(' ');
    const ptsB = [...vals].reverse().map((x, i) => `${2 + (vals.length - 1 - i) * 3.6},${(mid + v(x)).toFixed(1)}`).join(' ');
    return (
      <svg width="44" height={h} viewBox={`0 0 44 ${h}`} aria-hidden>
        <polygon points={`${pts} ${ptsB}`} fill="currentColor" opacity={0.85} strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="44" height={h} viewBox={`0 0 44 ${h}`} aria-hidden>
      {vals.map((x, i) => {
        const bh = source === 'electronic' ? Math.round(v(x) / 2) * 2 : v(x);
        return <rect key={i} x={1 + i * 3.6} y={mid - bh} width={source === 'electronic' ? 2.4 : 2.6} height={bh * 2} rx={source === 'hybrid' ? 1.3 : 0} fill="currentColor" opacity={0.85} />;
      })}
      {character !== 'clean' && <rect x="0" y="0.5" width="44" height="1" fill="currentColor" opacity={0.9} />}
    </svg>
  );
}

export function Legend() {
  const items = useBoard((s) => s.items);
  const filter = useBoard((s) => s.filter);
  const board = useBoard((s) => s.board);
  const { legend, toggleLegend } = useUi();

  const counts = useMemo(() => {
    const c = {} as Record<Role, number>;
    for (const it of Object.values(items)) if ((it.type === 'audio' || it.type === 'midi') && it.data.tags) c[it.data.tags.role.v] = (c[it.data.tags.role.v] ?? 0) + 1;
    return c;
  }, [items]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const active = filter.roles.length > 0 || filter.fitKey || filter.fitTempo;

  const setFilter = (patch: Partial<typeof filter>) => useBoard.setState((s) => ({ filter: { ...s.filter, ...patch } }));
  const toggleRole = (r: Role) => setFilter({ roles: filter.roles.includes(r) ? filter.roles.filter((x) => x !== r) : [...filter.roles, r] });

  if (!legend)
    return (
      <button className="legend-tab panel" onClick={toggleLegend} title="Sound map: what the colours and shapes mean, and filters">
        <span className="legend-dots" aria-hidden>
          {(['lead', 'pad', 'bass', 'drums'] as Role[]).map((r) => (
            <i key={r} style={{ background: roleCss(r) }} />
          ))}
        </span>
        Sound map
        {active && <span className="dot-active" />}
      </button>
    );

  return (
    <aside className="legend panel" aria-label="Sound map">
      <div className="legend-head">
        <div>
          <div className="eyebrow">Sound map</div>
          <div className="legend-sub">{total ? `${total} sound${total === 1 ? '' : 's'} on this board` : 'How sounds are drawn'}</div>
        </div>
        <button className="icon-btn sm" onClick={toggleLegend} aria-label="Hide sound map">
          <Icon name="close" size={15} />
        </button>
      </div>

      <div className="legend-section">
        <div className="legend-label">
          Colour = role
          {active && (
            <button className="link-btn" onClick={() => setFilter({ roles: [], fitKey: false, fitTempo: false })}>
              Show all
            </button>
          )}
        </div>
        <div className="role-list">
          {ROLE_ORDER.filter((r) => r !== 'other' || counts.other).map((r) => {
            const on = filter.roles.includes(r);
            const n = counts[r] ?? 0;
            return (
              <button key={r} className={`role-row ${on ? 'on' : ''} ${n ? '' : 'none'}`} onClick={() => toggleRole(r)} style={{ ['--c' as string]: roleCss(r) }} title={ROLES[r].blurb}>
                <span className="role-swatch">
                  <RoleIcon role={r} size={14} />
                </span>
                <span className="role-name">{ROLES[r].plural}</span>
                <span className="role-count mono">{n || ''}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="legend-section">
        <div className="legend-label">Fits the board</div>
        <div className="fit-toggles">
          <button className={`chip ${filter.fitKey ? 'on' : ''}`} disabled={!board?.key} onClick={() => setFilter({ fitKey: !filter.fitKey })} title={board?.key ? `Dim sounds that clash with ${board.key}` : 'Set a board key first (bottom bar)'}>
            <Icon name="key" size={14} /> Key{board?.key ? ` · ${board.key.replace(' major', '').replace(' minor', 'm')}` : ''}
          </button>
          <button className={`chip ${filter.fitTempo ? 'on' : ''}`} disabled={!board?.bpm} onClick={() => setFilter({ fitTempo: !filter.fitTempo })} title={board?.bpm ? `Dim sounds too far from ${board.bpm} BPM to stretch` : 'Set a board tempo first (bottom bar)'}>
            <Icon name="metronome" size={14} /> Tempo{board?.bpm ? ` · ${board.bpm}` : ''}
          </button>
        </div>
        <div className="fit-key">
          <span>
            <i className="fit-dot fit-perfect" /> fits
          </span>
          <span>
            <i className="fit-dot fit-good" /> close
          </span>
          <span>
            <i className="fit-dot fit-clash" /> clashes
          </span>
        </div>
      </div>

      <div className="legend-section">
        <div className="legend-label">Waveform style = source</div>
        {(Object.keys(SOURCES) as Source[]).map((s) => (
          <div className="legend-row" key={s}>
            <span className="lw">
              <MiniWave source={s} character="clean" />
            </span>
            <SourceIcon source={s} size={14} />
            <span>
              <b>{SOURCES[s].label}</b> {SOURCES[s].blurb.split('—')[0]}
            </span>
          </div>
        ))}
      </div>

      <div className="legend-section">
        <div className="legend-label">Edges = character</div>
        {(Object.keys(CHARACTERS) as Character[]).map((c) => (
          <div className="legend-row" key={c}>
            <span className="lw">
              <MiniWave source="hybrid" character={c} />
            </span>
            <CharacterIcon character={c} size={14} />
            <span>
              <b>{CHARACTERS[c].label}</b> {c === 'clean' ? 'untouched' : c === 'driven' ? 'saturated, warm grit' : 'clipped, aggressive'}
            </span>
          </div>
        ))}
      </div>

      <div className="legend-section">
        <div className="legend-label">Shading = brightness · glyph = envelope</div>
        <div className="legend-row">
          <span className="lw bright-ramp" aria-hidden />
          <span>darker columns are bassier, lighter ones brighter</span>
        </div>
        <div className="env-row">
          {(Object.keys(ENVELOPES) as (keyof typeof ENVELOPES)[]).map((e) => (
            <span key={e} title={ENVELOPES[e].blurb}>
              <EnvelopeGlyph shape={ENVELOPES[e].shape} width={30} height={14} />
              {ENVELOPES[e].label}
            </span>
          ))}
        </div>
      </div>
      <p className="legend-foot">
        Tags are measured from the audio when it's added. Dashed tags are guesses — click a card's tags to correct them.
      </p>
    </aside>
  );
}
