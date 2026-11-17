import fs from 'node:fs';
import { exportName } from '../shared/names.ts';
import { once } from 'node:events';
import type { ServerResponse } from 'node:http';
import { Zip, ZipPassThrough } from 'fflate';
import type { AnyItem, BoardMeta, Role } from '../shared/types.ts';
import type { Db } from './db.ts';

const ROLE_FOLDERS: Record<Role, string> = {
  drums: 'Drums',
  bass: 'Bass',
  chords: 'Chords & Keys',
  lead: 'Leads',
  pad: 'Pads',
  vocal: 'Vocals',
  fx: 'FX',
  mix: 'References',
  other: 'Other',
};

function safe(name: string) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'untitled';
}

function folderFor(item: AnyItem): string | null {
  if (item.type === 'audio') return ROLE_FOLDERS[item.data.tags?.role.v ?? 'other'] ?? 'Other';
  if (item.type === 'midi') return 'MIDI';
  if (item.type === 'image') return 'Images';
  return null;
}

/** A plain-text summary of the board so the pack makes sense on its own. */
function boardNotes(meta: BoardMeta, items: AnyItem[]) {
  const lines = [`# ${meta.title}`, ''];
  if (meta.key || meta.bpm) lines.push(`Key: ${meta.key ?? '—'}  ·  Tempo: ${meta.bpm ? `${meta.bpm} BPM` : '—'}`, '');
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const notes = sorted.filter((i) => i.type === 'text');
  if (notes.length) {
    lines.push('## Notes', '');
    for (const n of notes) if (n.type === 'text') lines.push(n.data.md.trim(), '', '---', '');
  }
  const links = sorted.filter((i) => i.type === 'link');
  if (links.length) {
    lines.push('## References', '');
    for (const l of links) if (l.type === 'link') lines.push(l.data.meta?.title ? `- ${l.data.meta.title} — ${l.data.url}` : `- ${l.data.url}`);
    lines.push('');
  }
  const sounds = sorted.filter((i) => i.type === 'audio' || i.type === 'midi');
  if (sounds.length) {
    lines.push('## Sounds', '');
    for (const s of sounds) {
      if (s.type !== 'audio' && s.type !== 'midi') continue;
      const t = s.data.tags;
      const bits = [t?.role.v, t?.key.v, t?.bpm.v ? `${t.bpm.v} BPM` : null, t?.source.v, t?.character.v].filter(Boolean);
      lines.push(`- ${s.data.title ?? s.data.file.name}${bits.length ? ` — ${bits.join(', ')}` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export interface PackSection {
  /** Folder prefix inside the zip, e.g. "02 Night drive/" (empty for a single). */
  prefix: string;
  boardId: string;
  meta: BoardMeta;
  notesName: string;
}

export function singleSections(boardId: string, meta: BoardMeta): PackSection[] {
  return [{ prefix: '', boardId, meta, notesName: 'Board notes.md' }];
}

/** Album packs get a folder for the album page and one per song, numbered in order. */
export function albumSections(boards: { id: string; meta: BoardMeta; kind: string }[]): PackSection[] {
  let n = 0;
  return boards.map((b) =>
    b.kind === 'overview'
      ? { prefix: '00 Album/', boardId: b.id, meta: b.meta, notesName: 'Album notes.md' }
      : { prefix: `${String(++n).padStart(2, '0')} ${safe(b.meta.title)}/`, boardId: b.id, meta: b.meta, notesName: 'Song notes.md' },
  );
}

export async function streamPack(db: Db, res: ServerResponse, title: string, sections: PackSection[]) {
  const zipName = `${safe(title)}.zip`;
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    // Header values must be ASCII; filename* carries the real (UTF-8) name.
    'Content-Disposition': `attachment; filename="${zipName.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(zipName)}`,
    'Cache-Control': 'no-store',
  });

  let failed = false;
  const zip = new Zip((err, chunk, final) => {
    if (err) {
      failed = true;
      res.destroy(err);
      return;
    }
    res.write(chunk);
    if (final) res.end();
  });

  const used = new Set<string>();
  const uniquePath = (folder: string, name: string) => {
    let candidate = `${folder}/${safe(name)}`;
    const dot = candidate.lastIndexOf('.');
    const stem = dot > folder.length ? candidate.slice(0, dot) : candidate;
    const ext = dot > folder.length ? candidate.slice(dot) : '';
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  };

  for (const section of sections) {
    const items = db.items(section.boardId);
    const readme = new ZipPassThrough(section.prefix + section.notesName);
    zip.add(readme);
    readme.push(new TextEncoder().encode(boardNotes(section.meta, items)), true);

    for (const item of items) {
      if (failed) return;
      const folder = folderFor(item);
      if (!folder || !('file' in item.data)) continue;
      const file = db.file(item.data.file.fileId);
      if (!file || !fs.existsSync(file.path)) continue;
      const entry = new ZipPassThrough(uniquePath(section.prefix + folder, exportName(item.type === 'audio' || item.type === 'midi' ? item.data.title : undefined, item.data.file.name)));
      zip.add(entry);
      for await (const chunk of fs.createReadStream(file.path)) {
        entry.push(new Uint8Array(chunk as Buffer), false);
        if (res.writableNeedDrain) await once(res, 'drain');
      }
      entry.push(new Uint8Array(0), true);
    }
  }
  zip.end();
}
