import { Midi } from '@tonejs/midi';
import { exportName } from '../../shared/names';
import type { Item, SoundTags } from '../../shared/types';
import { engine, trimRegion } from '../audio/engine';
import { midiTags, parseMidi } from '../audio/midi';
import { analyzeBuffer } from '../audio/workerClient';
import { toast } from '../components/ui/toast';
import { uploadFile } from '../lib/api';
import { encodeWav } from '../lib/wav';
import { updateItem } from './actions';
import { useBoard } from './board';

const FADE = 0.003;

/** Fresh analysis, but anything the user set by hand stays. */
function keepUserTags(old: SoundTags | undefined, fresh: SoundTags): SoundTags {
  if (!old) return fresh;
  const out = { ...fresh } as Record<string, unknown>;
  for (const [k, v] of Object.entries(old)) if (v && typeof v === 'object' && (v as { src?: string }).src === 'user') out[k] = v;
  return out as unknown as SoundTags;
}

function baseName(title: string | undefined, fileName: string) {
  return exportName(title, fileName).replace(/\.[a-z0-9]{2,5}$/i, '');
}

/**
 * Makes the trim permanent: writes a new file holding just the trimmed part and points
 * the card at it. The old file stays on the server, so undo brings the full clip back.
 */
export async function saveTrim(item: Item<'audio'> | Item<'midi'>) {
  const editId = useBoard.getState().editId;
  if (!editId || !item.data.trim) return;
  toast('Saving trim…');
  try {
    if (item.type === 'audio') await saveAudioTrim(editId, item);
    else await saveMidiTrim(editId, item);
    toast('Trim saved. Downloads and drags now use the trimmed file.', 'success');
  } catch (err) {
    console.error(err);
    toast(`Couldn't save the trim: ${(err as Error).message}`, 'error', 5000);
  }
}

async function saveAudioTrim(editId: string, item: Item<'audio'>) {
  const d = item.data;
  const buf = await engine.getBuffer(d.file.url);
  const region = trimRegion(d.trim, buf.duration, 0.02);
  const sr = buf.sampleRate;
  const s0 = Math.round(region.start * sr);
  const s1 = Math.round(region.end * sr);
  const fade = Math.min(Math.round(FADE * sr), Math.floor((s1 - s0) / 4));
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch).slice(s0, s1);
    // A few milliseconds of fade so the new edges don't click.
    for (let i = 0; i < fade; i++) {
      const g = i / fade;
      data[i] *= g;
      data[data.length - 1 - i] *= g;
    }
    channels.push(data);
  }
  const name = `${baseName(d.title, d.file.name)}.wav`;
  const file = new File([encodeWav(channels, sr, 24)], name, { type: 'audio/wav' });
  const out = engine.ctx.createBuffer(channels.length, s1 - s0, sr);
  channels.forEach((c, i) => out.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  const [ref, res] = await Promise.all([uploadFile(editId, file), analyzeBuffer(out, name)]);
  engine.primeBuffer(ref.url, out);
  engine.stop(item.id);
  updateItem(item.id, {
    data: {
      file: ref,
      duration: out.duration,
      sampleRate: sr,
      channels: channels.length,
      peaks: res.peaks,
      analysis: res.analysis,
      tags: keepUserTags(d.tags, res.tags),
      trim: null,
    },
  });
}

async function saveMidiTrim(editId: string, item: Item<'midi'>) {
  const d = item.data;
  if (!d.summary) throw new Error('This MIDI file has no notes');
  const src = new Midi(await (await fetch(d.file.url)).arrayBuffer());
  const ppq = src.header.ppq;
  const region = trimRegion(d.trim, d.summary.beats, 0.25);
  const a = Math.round(region.start * ppq);
  const b = Math.round(region.end * ppq);

  const midi = new Midi();
  midi.header.setTempo(d.summary.bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: d.summary.timeSig });
  midi.header.name = src.header.name;
  const scale = midi.header.ppq / ppq;
  for (const t of src.tracks) {
    const track = midi.addTrack();
    track.name = t.name;
    track.channel = t.channel;
    track.instrument.number = t.instrument.number;
    for (const n of t.notes) {
      if (n.ticks < a || n.ticks >= b) continue;
      track.addNote({ midi: n.midi, ticks: Math.round((n.ticks - a) * scale), durationTicks: Math.max(1, Math.round(Math.min(n.durationTicks, b - n.ticks) * scale)), velocity: n.velocity });
    }
    for (const list of Object.values(t.controlChanges)) {
      for (const cc of list) if (cc.ticks >= a && cc.ticks < b) track.addCC({ number: cc.number, ticks: Math.round((cc.ticks - a) * scale), value: cc.value });
    }
  }
  const bytes = new Uint8Array(midi.toArray());
  const parsed = parseMidi(bytes.buffer);
  const file = new File([bytes], `${baseName(d.title, d.file.name)}.mid`, { type: 'audio/midi' });
  const ref = await uploadFile(editId, file);
  const role = d.tags?.role.v ?? parsed.role;
  engine.stop(item.id);
  updateItem(item.id, {
    data: {
      file: ref,
      summary: parsed.summary,
      tags: keepUserTags(d.tags, midiTags(parsed.summary, role, d.instrument, true)),
      trim: null,
    },
  });
}
