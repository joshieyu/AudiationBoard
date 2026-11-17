import { useRef, useState } from 'react';
import { create } from 'zustand';
import type { InstrumentId, Item, SoundTags, Trim } from '../../../shared/types';
import { engine, usePlayback } from '../../audio/engine';
import { INSTRUMENTS, instrumentInfo } from '../../audio/instruments';
import { ROLES, roleVars } from '../../lib/colors';
import { updateItem } from '../../store/actions';
import { useBoard } from '../../store/board';
import { PianoRoll } from '../PianoRoll';
import { SourceIcon } from '../SoundGlyphs';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { usePlayhead } from '../usePlayhead';
import { InlineTitle } from './InlineTitle';
import { TrimHandles } from './TrimHandles';
import { BpmBadge, DawHandle, KeyBadge, LayerButton, LoopButton, PlayButton, SignatureRow } from './SoundParts';

/** Viewers can audition MIDI with other sounds without changing the board. */
const useLocalInstrument = create<Record<string, InstrumentId>>(() => ({}));

function withInstrument(item: Item<'midi'>, id: InstrumentId): Item<'midi'> {
  const info = instrumentInfo(id);
  const tags = item.data.tags;
  const keep = <K extends keyof SoundTags>(k: K, v: SoundTags[K]) => (tags && (tags[k] as { src?: string }).src === 'user' ? tags[k] : v);
  const nextTags: SoundTags | undefined = tags && {
    ...tags,
    source: keep('source', { v: info.source, conf: 0.9, src: 'auto' }),
    character: keep('character', { v: info.character, conf: 0.9, src: 'auto' }),
    brightness: keep('brightness', { v: info.brightness, conf: 0.8, src: 'auto' }),
    envelope: keep('envelope', { v: info.envelope, conf: 0.85, src: 'auto' }),
  };
  return { ...item, data: { ...item.data, instrument: id, tags: nextTags } };
}

export function MidiCard({ item: stored }: { item: Item<'midi'> }) {
  const editable = useBoard((s) => s.access === 'edit');
  const local = useLocalInstrument((s) => s[stored.id]);
  const item = local && local !== stored.data.instrument ? withInstrument(stored, local) : stored;
  const d = item.data;
  const s = d.summary;
  const role = d.tags?.role.v ?? 'chords';
  const progress = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const instRef = useRef<HTMLButtonElement>(null);
  const [pick, setPick] = useState(false);
  usePlayhead(item.id, progress, head);

  const setTrim = (trim: Trim | null) => {
    updateItem(stored.id, { data: { trim } });
    engine.refresh({ ...item, data: { ...d, trim } });
  };
  const beatsPerBar = s ? (s.timeSig[0] * 4) / s.timeSig[1] : 4;
  // Bar.beat, plus the sixteenth when it isn't on the beat.
  const beatLabel = (v: number) => {
    const bar = Math.floor(v / beatsPerBar + 1e-6);
    const beat = v - bar * beatsPerBar;
    const sixteenth = Math.round((beat % 1) * 4);
    return `${bar + 1}.${Math.floor(beat + 1e-6) + 1}${sixteenth ? `.${sixteenth + 1}` : ''}`;
  };

  const choose = (id: InstrumentId) => {
    setPick(false);
    const next = withInstrument(stored, id);
    if (editable) {
      updateItem(stored.id, { data: { instrument: id, tags: next.data.tags } });
      useLocalInstrument.setState({ [stored.id]: id });
    } else useLocalInstrument.setState({ [stored.id]: id });
    engine.refresh(next);
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!s) return;
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    // Snap seeks to the beat so the first notes aren't skipped.
    const beat = Math.floor(f * s.beats);
    const pb = usePlayback.getState();
    const st = pb.playing[item.id];
    const others = Object.keys(pb.playing).some((id) => id !== item.id);
    void engine.play(item, { from: (beat * 60) / s.bpm, layer: st ? st.layered || others : e.shiftKey && others, loop: st?.loop });
  };

  const info = instrumentInfo(d.instrument);
  return (
    <div className="card sound-card midi-card" style={roleVars(role) as React.CSSProperties} data-role={role}>
      <div className="sc-head">
        <PlayButton item={item} />
        <div className="sc-title">
          <InlineTitle id={stored.id} value={d.title ?? d.file.name} editable={editable} onChange={(title) => updateItem(stored.id, { data: { title } })} />
          <div className="sc-sub">
            MIDI · {ROLES[role].label}
            {s ? ` · ${s.bars} bar${s.bars === 1 ? '' : 's'} · ${s.noteCount} notes` : ''}
          </div>
        </div>
        <button ref={instRef} className="inst-btn" data-nodrag onClick={(e) => { e.stopPropagation(); setPick((p) => !p); }} title="Choose the sound that plays this MIDI">
          <SourceIcon source={info.source} size={13} />
          <span>{info.label}</span>
          <Icon name="chevronDown" size={13} />
        </button>
        <DawHandle file={d.file} title={d.title} />
      </div>
      <SignatureRow item={item} />
      <div className="sc-wave" data-nodrag onClick={seek}>
        {s && <PianoRoll summary={s} role={role} progressRef={progress} />}
        {s && (
          <TrimHandles total={s.beats} trim={d.trim} editable={editable} minLength={0.25} snap={(v) => Math.round(v * 4) / 4} label={beatLabel} onChange={setTrim} />
        )}
        <div className="playhead" ref={head} />
      </div>
      {s && s.chords.length > 0 && (
        <div className="chord-strip" aria-label="Detected chords">
          {s.chords.map((c, i) => (
            <span key={i} className="chord" style={{ left: `${(c.beat / s.beats) * 100}%`, width: `${(c.beats / s.beats) * 100}%` }} title={`${c.name} — beat ${c.beat + 1}`}>
              {c.name}
            </span>
          ))}
        </div>
      )}
      <div className="sc-foot">
        <KeyBadge tags={d.tags} />
        <BpmBadge tags={d.tags} midiBpm={s?.bpm} />
        <span className="spacer" />
        <LoopButton item={item} canEdit={editable} onChange={(loop) => updateItem(stored.id, { data: { loop } }, false)} />
        <LayerButton item={item} />
      </div>
      <Popover anchor={instRef.current} open={pick} onClose={() => setPick(false)} width={250}>
        <div className="menu inst-menu">
          <div className="menu-title">{editable ? 'Play this MIDI with' : 'Audition with (just for you)'}</div>
          {INSTRUMENTS.map((i) => (
            <button key={i.id} className={`menu-item ${i.id === d.instrument ? 'on' : ''}`} onClick={() => choose(i.id)}>
              <SourceIcon source={i.source} size={15} />
              <span className="mi-text">
                <span>{i.label}</span>
                <span className="mi-sub">{i.blurb}</span>
              </span>
              {i.id === d.instrument && <Icon name="check" size={15} />}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}
