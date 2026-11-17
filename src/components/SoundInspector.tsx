import { useState } from 'react';
import type { Brightness, Character, ClipKind, Envelope, Item, Role, SoundTags, Source, TagValue } from '../../shared/types';
import { engine } from '../audio/engine';
import { analyzeBuffer } from '../audio/workerClient';
import { BRIGHTNESS, CHARACTERS, ENVELOPES, ROLE_ORDER, ROLES, SOURCES, roleCss } from '../lib/colors';
import { keyName, parseKey } from '../lib/music';
import { updateItem } from '../store/actions';
import { canEdit, useBoard } from '../store/board';
import { BrightnessIcon, CharacterIcon, EnvelopeGlyph, RoleIcon, SourceIcon } from './SoundGlyphs';
import { Icon } from './ui/Icon';
import { toast } from './ui/toast';

type Playable = Item<'audio'> | Item<'midi'>;

const KINDS: Record<ClipKind, string> = { oneshot: 'One-shot', loop: 'Loop', phrase: 'Phrase', song: 'Song' };
const ALL_KEYS = Array.from({ length: 24 }, (_, i) => keyName({ root: i % 12, mode: i < 12 ? 'major' : 'minor' }));

function Origin({ t }: { t: TagValue<unknown> }) {
  if (t.src === 'user') return <span className="origin user">set by you</span>;
  if (t.src === 'file') return <span className="origin file">from file name</span>;
  const pct = Math.round(t.conf * 100);
  return <span className={`origin auto ${t.conf < 0.5 ? 'low' : ''}`}>{pct < 50 ? 'guess' : 'detected'} · {pct}%</span>;
}

export function SoundInspector({ item, onClose }: { item: Playable; onClose: () => void }) {
  const editable = useBoard((s) => s.access === 'edit');
  const tags = item.data.tags!;
  const analysis = item.type === 'audio' ? item.data.analysis : undefined;
  const [showRaw, setShowRaw] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof SoundTags>(k: K, v: SoundTags[K] extends TagValue<infer T> ? T : never) => {
    if (!canEdit()) return;
    const next: SoundTags = { ...tags, [k]: { v, conf: 1, src: 'user' } };
    updateItem(item.id, { data: { tags: next } });
  };

  const reanalyze = async () => {
    if (item.type !== 'audio') return;
    setBusy(true);
    try {
      const buf = await engine.getBuffer(item.data.file.url);
      const res = await analyzeBuffer(buf, item.data.file.name);
      // Keep anything a person set by hand.
      const merged = { ...res.tags } as SoundTags;
      for (const k of Object.keys(tags) as (keyof SoundTags)[]) {
        const t = tags[k] as TagValue<unknown>;
        if (k !== 'extra' && t?.src === 'user') (merged as unknown as Record<string, unknown>)[k] = t;
      }
      merged.extra = tags.extra;
      updateItem(item.id, { data: { tags: merged, analysis: res.analysis, peaks: res.peaks } });
      toast('Re-analysed');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const chip = (active: boolean, onClick: () => void, children: React.ReactNode, title?: string) => (
    <button className={`chip ${active ? 'on' : ''}`} onClick={onClick} disabled={!editable && !active} title={title}>
      {children}
    </button>
  );

  return (
    <div className="inspector">
      <div className="insp-head">
        <div>
          <div className="eyebrow">Sound tags</div>
          <div className="insp-title">{item.data.title ?? item.data.file.name}</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
      </div>
      {!editable && <p className="insp-note">View-only link — tags can be changed from the edit link.</p>}

      <section>
        <div className="insp-label">
          Role <Origin t={tags.role} />
        </div>
        <div className="chips">
          {ROLE_ORDER.filter((r) => r !== 'other').map((r: Role) =>
            chip(tags.role.v === r, () => set('role', r), (
              <>
                <span className="swatch" style={{ color: roleCss(r) }}>
                  <RoleIcon role={r} size={14} />
                </span>
                {ROLES[r].label}
              </>
            ), ROLES[r].blurb),
          )}
        </div>
      </section>

      <section className="two">
        <div>
          <div className="insp-label">
            Source <Origin t={tags.source} />
          </div>
          <div className="chips">
            {(Object.keys(SOURCES) as Source[]).map((s) =>
              chip(tags.source.v === s, () => set('source', s), (
                <>
                  <SourceIcon source={s} size={14} />
                  {SOURCES[s].label}
                </>
              ), SOURCES[s].blurb),
            )}
          </div>
        </div>
      </section>

      <section>
        <div className="insp-label">
          Character <Origin t={tags.character} />
        </div>
        <div className="chips">
          {(Object.keys(CHARACTERS) as Character[]).map((c) =>
            chip(tags.character.v === c, () => set('character', c), (
              <>
                <CharacterIcon character={c} size={14} />
                {CHARACTERS[c].label}
              </>
            ), CHARACTERS[c].blurb),
          )}
        </div>
      </section>

      <section>
        <div className="insp-label">
          Tone <Origin t={tags.brightness} />
        </div>
        <div className="chips">
          {(Object.keys(BRIGHTNESS) as Brightness[]).map((b) =>
            chip(tags.brightness.v === b, () => set('brightness', b), (
              <>
                <BrightnessIcon brightness={b} size={14} />
                {BRIGHTNESS[b].label}
              </>
            ), BRIGHTNESS[b].blurb),
          )}
        </div>
      </section>

      <section>
        <div className="insp-label">
          Envelope <Origin t={tags.envelope} />
        </div>
        <div className="chips">
          {(Object.keys(ENVELOPES) as Envelope[]).map((e) =>
            chip(tags.envelope.v === e, () => set('envelope', e), (
              <>
                <EnvelopeGlyph shape={ENVELOPES[e].shape} width={22} height={12} />
                {ENVELOPES[e].label}
              </>
            ), ENVELOPES[e].blurb),
          )}
        </div>
      </section>

      <section className="row3">
        <label>
          <span className="insp-label">
            Key <Origin t={tags.key} />
          </span>
          <select
            value={tags.key.v ? keyName(parseKey(tags.key.v)!) : ''}
            disabled={!editable}
            onChange={(e) => set('key', e.target.value || null)}
          >
            <option value="">—</option>
            {ALL_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="insp-label">
            BPM <Origin t={tags.bpm} />
          </span>
          <input
            type="number"
            min={30}
            max={300}
            step={0.1}
            disabled={!editable || item.type === 'midi'}
            defaultValue={tags.bpm.v ?? ''}
            onBlur={(e) => {
              const v = e.target.value ? Number(e.target.value) : null;
              if (v !== tags.bpm.v && (v === null || (v >= 30 && v <= 300))) set('bpm', v);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </label>
        <label>
          <span className="insp-label">Type</span>
          <select value={tags.kind.v} disabled={!editable} onChange={(e) => set('kind', e.target.value as ClipKind)}>
            {(Object.keys(KINDS) as ClipKind[]).map((k) => (
              <option key={k} value={k}>
                {KINDS[k]}
              </option>
            ))}
          </select>
        </label>
      </section>

      {analysis && (
        <section>
          <button className="disclosure" onClick={() => setShowRaw((s) => !s)}>
            <Icon name={showRaw ? 'chevronDown' : 'chevronRight'} size={14} /> What the analysis measured
          </button>
          {showRaw && (
            <dl className="measures">
              <dt>Brightness</dt>
              <dd>{analysis.centroidHz.toLocaleString()} Hz centroid</dd>
              <dt>Energy</dt>
              <dd>
                {Math.round(analysis.lowPct * 100)}% low · {Math.round(analysis.midPct * 100)}% mid · {Math.round(analysis.highPct * 100)}% high
              </dd>
              <dt>Pitch</dt>
              <dd>
                {analysis.f0Hz ? `${analysis.f0Hz} Hz median` : 'no clear pitch'} · {Math.round(analysis.voiced * 100)}% pitched ·{' '}
                {Math.round(analysis.polyphony * 100)}% chordal
              </dd>
              <dt>Stability</dt>
              <dd>{analysis.jitterCents !== null ? `±${analysis.jitterCents.toFixed(1)} cents drift` : '—'}</dd>
              <dt>Rhythm</dt>
              <dd>
                {analysis.onsetRate} onsets/s{analysis.bars ? ` · ${analysis.bars} bar${analysis.bars === 1 ? '' : 's'}` : ''}
              </dd>
              <dt>Envelope</dt>
              <dd>
                {analysis.attackMs} ms attack · sustain {Math.round(analysis.sustain * 100)}%
              </dd>
              <dt>Level</dt>
              <dd>
                {analysis.peakDb.toFixed(1)} dBFS peak · {analysis.crestDb.toFixed(1)} dB crest
              </dd>
              <dt>Stereo</dt>
              <dd>{analysis.width < 0.05 ? 'mono' : `${Math.round(analysis.width * 100)}% side`}</dd>
              <dt>Scores</dt>
              <dd>
                drive {Math.round(analysis.distortion * 100)} · synthetic {Math.round(analysis.electronic * 100)}
              </dd>
            </dl>
          )}
        </section>
      )}

      {editable && item.type === 'audio' && (
        <div className="insp-foot">
          <button className="btn ghost sm" onClick={reanalyze} disabled={busy}>
            {busy ? <span className="spinner" /> : <Icon name="sparkle" size={14} />} Re-analyse
          </button>
          <span className="insp-hint">Tags you set by hand are kept.</span>
        </div>
      )}
    </div>
  );
}
