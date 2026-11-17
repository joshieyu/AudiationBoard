import { useRef, useState, type DragEvent } from 'react';
import type { FileRef, Item, SoundTags, TagValue } from '../../../shared/types';
import { clipTempo, engine, usePlayback } from '../../audio/engine';
import { absoluteUrl, downloadUrl } from '../../lib/api';
import { BRIGHTNESS, CHARACTERS, ENVELOPES, ROLES, SOURCES } from '../../lib/colors';
import { camelot, keyFit, keyShort, parseKey, tempoFit, type Fit } from '../../lib/music';
import { useBoard } from '../../store/board';
import { Icon } from '../ui/Icon';
import { BrightnessIcon, CharacterIcon, EnvelopeGlyph, RoleIcon, SourceIcon } from '../SoundGlyphs';
import { SoundInspector } from '../SoundInspector';
import { Popover } from '../ui/Popover';

type Playable = Item<'audio'> | Item<'midi'>;

export function PlayButton({ item }: { item: Playable }) {
  const playing = usePlayback((s) => s.playing[item.id]);
  const loading = usePlayback((s) => !!s.loading[item.id]);
  const anyPlaying = usePlayback((s) => Object.keys(s.playing).length > 0);
  const disabled = item.data.status === 'error';
  return (
    <button
      className={`play-btn ${playing ? 'is-playing' : ''} ${loading ? 'is-loading' : ''}`}
      data-nodrag
      disabled={disabled}
      title={playing ? 'Stop (Space)' : anyPlaying ? 'Play — Shift-click to layer with what’s playing' : 'Play (Space)'}
      aria-label={playing ? 'Stop' : 'Play'}
      onClick={(e) => {
        e.stopPropagation();
        void engine.toggle(item, e.shiftKey && anyPlaying);
      }}
    >
      {loading ? <span className="spinner" /> : <Icon name={playing ? 'stop' : 'play'} size={playing ? 14 : 16} />}
    </button>
  );
}

export function LayerButton({ item }: { item: Playable }) {
  const st = usePlayback((s) => s.playing[item.id]);
  const anyOther = usePlayback((s) => Object.keys(s.playing).some((id) => id !== item.id));
  // "In mix" only means something when other clips are playing alongside this one.
  const inMix = !!st && anyOther;
  return (
    <button
      className={`mini-btn ${inMix ? 'on' : ''}`}
      data-nodrag
      title={inMix ? 'Remove from the mix' : st ? 'Playing — layer other clips onto it' : 'Layer: play in sync with what’s already playing'}
      onClick={(e) => {
        e.stopPropagation();
        if (inMix) engine.stop(item.id);
        else if (!st) void engine.play(item, { layer: true });
      }}
    >
      <Icon name="layers" size={14} />
      <span className="lbl">{inMix ? 'In mix' : 'Layer'}</span>
    </button>
  );
}

export function LoopButton({ item, canEdit, onChange }: { item: Playable; canEdit: boolean; onChange: (loop: boolean) => void }) {
  const st = usePlayback((s) => s.playing[item.id]);
  const loop = st ? st.loop : item.data.loop ?? false;
  return (
    <button
      className={`mini-btn icon-only ${loop ? 'on' : ''}`}
      data-nodrag
      title={loop ? 'Looping' : 'Loop'}
      aria-pressed={loop}
      onClick={(e) => {
        e.stopPropagation();
        engine.setLoop(item.id, !loop);
        if (canEdit) onChange(!loop);
      }}
    >
      <Icon name="loop" size={14} />
    </button>
  );
}

function safeFileName(name: string) {
  return name.replace(/[:\\/]+/g, '-');
}

/** Drag straight out of the browser into a DAW or Finder (Chromium), or click to download. */
export function DawHandle({ file }: { file: FileRef }) {
  const onDragStart = (e: DragEvent) => {
    e.stopPropagation();
    const url = absoluteUrl(downloadUrl(file));
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('DownloadURL', `${file.mime || 'application/octet-stream'}:${safeFileName(file.name)}:${url}`);
    e.dataTransfer.setData('text/uri-list', url);
    e.dataTransfer.setData('application/x-audiation', file.fileId);
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = file.name;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 14, 14);
    setTimeout(() => ghost.remove(), 0);
  };
  return (
    <a
      className="daw-handle"
      href={downloadUrl(file)}
      download={file.name}
      draggable
      data-nodrag
      onDragStart={onDragStart}
      onClick={(e) => e.stopPropagation()}
      title="Drag into your DAW (Chrome/Edge) · click to download"
      aria-label={`Download ${file.name}`}
    >
      <Icon name="grip" size={14} strokeWidth={2.6} />
      <Icon name="download" size={14} />
    </a>
  );
}

function FitDot({ fit, title }: { fit: Fit | null; title: string }) {
  if (!fit) return null;
  return <span className={`fit-dot fit-${fit}`} title={title} />;
}

export function KeyBadge({ tags }: { tags: SoundTags | undefined }) {
  const boardKey = useBoard((s) => s.board?.key ?? null);
  const root = tags?.root?.v;
  const kv = tags?.key;
  if (!kv?.v && root) return <span className="badge mono" title="Root note of this one-shot">{root}</span>;
  if (!kv?.v || (kv.src === 'auto' && kv.conf < 0.3)) return null;
  const k = parseKey(kv.v);
  if (!k) return null;
  const bk = parseKey(boardKey);
  const fit = bk ? keyFit(k, bk) : null;
  const unsure = kv.src === 'auto' && kv.conf < 0.55;
  const fitText = fit === 'perfect' ? 'Fits the board key' : fit === 'good' ? 'Neighbouring key — usually works' : 'Clashes with the board key';
  return (
    <span className={`badge mono ${unsure ? 'unsure' : ''}`} title={`${kv.v} (${camelot(k)})${bk ? ` — ${fitText}` : ''}${unsure ? ' · low-confidence guess' : ''}`}>
      <FitDot fit={fit} title={fitText} />
      {keyShort(k)}
      <span className="dim">{camelot(k)}</span>
    </span>
  );
}

export function BpmBadge({ tags, midiBpm }: { tags: SoundTags | undefined; midiBpm?: number }) {
  const boardBpm = useBoard((s) => s.board?.bpm ?? null);
  const sync = usePlayback((s) => s.sync);
  const bpm = midiBpm ?? clipTempo(tags);
  if (!bpm) return null;
  const tf = boardBpm ? tempoFit(bpm, boardBpm) : null;
  const unsure = !midiBpm && tags?.bpm.src === 'auto' && (tags?.bpm.conf ?? 0) < 0.55;
  const pct = tf ? `${tf.pct > 0 ? '+' : ''}${tf.pct.toFixed(1)}%` : '';
  const title = tf
    ? tf.fit === 'perfect'
      ? 'Matches the board tempo'
      : `${pct} to reach ${boardBpm} BPM${sync ? ' — playback is synced to the board' : ''}`
    : 'Tempo';
  return (
    <span className={`badge mono ${unsure ? 'unsure' : ''}`} title={title}>
      <FitDot fit={tf?.fit ?? null} title={title} />
      {Number.isInteger(bpm) ? bpm : bpm.toFixed(1)}
      <span className="dim">bpm</span>
    </span>
  );
}

const unsure = (t: TagValue<unknown> | undefined) => !!t && t.src === 'auto' && t.conf < 0.5;

/** Role · source · character · brightness · envelope. Click to inspect and correct. */
export function SignatureRow({ item, envShape }: { item: Playable; envShape?: number[] }) {
  const tags = item.data.tags;
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!tags) return null;
  const role = tags.role.v;
  return (
    <>
      <button ref={ref} className="signature" data-nodrag onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} title="Sound tags — click to see what was detected and correct it">
        <span className={`sig role ${unsure(tags.role) ? 'unsure' : ''}`}>
          <RoleIcon role={role} size={14} />
          <span className="lbl">{ROLES[role].label}</span>
        </span>
        <span className={`sig ${unsure(tags.source) ? 'unsure' : ''}`} title={SOURCES[tags.source.v].label}>
          <SourceIcon source={tags.source.v} size={14} />
          <span className="lbl">{SOURCES[tags.source.v].label}</span>
        </span>
        <span className={`sig ${unsure(tags.character) ? 'unsure' : ''}`} title={CHARACTERS[tags.character.v].label}>
          <CharacterIcon character={tags.character.v} size={14} />
          <span className="lbl wide-only">{CHARACTERS[tags.character.v].label}</span>
        </span>
        <span className={`sig ${unsure(tags.brightness) ? 'unsure' : ''}`} title={BRIGHTNESS[tags.brightness.v].label}>
          <BrightnessIcon brightness={tags.brightness.v} size={14} />
        </span>
        <span className={`sig env ${unsure(tags.envelope) ? 'unsure' : ''}`} title={`${ENVELOPES[tags.envelope.v].label} envelope`}>
          <EnvelopeGlyph shape={envShape?.some((v) => v > 0) ? envShape : ENVELOPES[tags.envelope.v].shape} width={30} height={14} />
        </span>
      </button>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} width={340} className="inspector-pop">
        <SoundInspector item={item} onClose={() => setOpen(false)} />
      </Popover>
    </>
  );
}
