// Types shared by the client and the server. Keep this file free of runtime code
// that isn't erasable, so Node can import it with type stripping.

export type ItemType = 'text' | 'image' | 'link' | 'audio' | 'midi';

// ---- Sound descriptors -------------------------------------------------------

export type Role = 'lead' | 'pad' | 'bass' | 'chords' | 'drums' | 'vocal' | 'fx' | 'mix' | 'other';
export type Source = 'acoustic' | 'electronic' | 'hybrid';
export type Character = 'clean' | 'driven' | 'distorted';
export type Brightness = 'dark' | 'balanced' | 'bright';
export type Envelope = 'pluck' | 'hit' | 'sustain' | 'swell';
export type ClipKind = 'oneshot' | 'loop' | 'phrase' | 'song';

/** Where a tag value came from: measured, parsed from the file name, or set by a person. */
export type TagOrigin = 'auto' | 'file' | 'user';

export interface TagValue<T> {
  v: T;
  /** 0..1. User-set values are always 1. */
  conf: number;
  src: TagOrigin;
}

export interface SoundTags {
  role: TagValue<Role>;
  source: TagValue<Source>;
  character: TagValue<Character>;
  brightness: TagValue<Brightness>;
  envelope: TagValue<Envelope>;
  kind: TagValue<ClipKind>;
  /** "A minor", "F# major" */
  key: TagValue<string | null>;
  bpm: TagValue<number | null>;
  /** Root note for tonal one-shots, e.g. "F#1". */
  root: TagValue<string | null>;
  /** Free-form words like "dreamy", "vintage". */
  extra: string[];
}

/** Raw measurements behind the tags, shown in the inspector. */
export interface AudioAnalysis {
  version: number;
  duration: number;
  peakDb: number;
  rmsDb: number;
  crestDb: number;
  centroidHz: number;
  flatness: number;
  lowPct: number;
  midPct: number;
  highPct: number;
  /** 0 = mono, 1 = very wide. */
  width: number;
  onsetRate: number;
  attackMs: number;
  sustain: number;
  f0Hz: number | null;
  voiced: number;
  jitterCents: number | null;
  /** 0..1 share of tonal frames that were not monophonic. */
  polyphony: number;
  bars: number | null;
  distortion: number;
  electronic: number;
  /** Averaged note envelope, 24 points over 1.2 s, each 0..1. */
  envShape: number[];
  ms: number;
}

// ---- Board items ------------------------------------------------------------

export interface FileRef {
  fileId: string;
  url: string;
  name: string;
  mime: string;
  size: number;
}

export type NoteColor = 'default' | 'yellow' | 'pink' | 'green' | 'blue' | 'purple' | 'orange';

export interface TextData {
  md: string;
  color: NoteColor;
}

export interface ImageData {
  file: FileRef;
  aspect: number;
  caption?: string;
}

export type EmbedProvider = 'youtube' | 'spotify' | 'soundcloud' | 'apple' | 'vimeo' | 'bandcamp';

export interface Embed {
  provider: EmbedProvider;
  src: string;
  height: number;
  thumb?: string;
  kind?: string;
}

export interface LinkMeta {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

export interface LinkData {
  url: string;
  embed: Embed | null;
  meta?: LinkMeta;
}

/**
 * A non-destructive trim: playback covers only start..end. Seconds for audio,
 * beats for MIDI. The file itself is untouched until the trim is saved.
 */
export interface Trim {
  start: number;
  end: number;
}

export interface AudioData {
  file: FileRef;
  title?: string;
  trim?: Trim | null;
  duration: number;
  sampleRate: number;
  channels: number;
  /** base64 of Uint8 triples [peak, rms, brightness] per column. */
  peaks?: string;
  analysis?: AudioAnalysis;
  tags?: SoundTags;
  status: 'ready' | 'error';
  error?: string;
  loop?: boolean;
  recorded?: boolean;
}

export type InstrumentId =
  | 'piano'
  | 'epiano'
  | 'strings'
  | 'mallet'
  | 'pad'
  | 'pluck'
  | 'bass'
  | 'lead'
  | 'drums';

export interface MidiTrackInfo {
  name: string;
  channel: number;
  noteCount: number;
  drums: boolean;
}

export interface MidiChord {
  beat: number;
  beats: number;
  name: string;
}

export interface MidiSummary {
  bpm: number;
  timeSig: [number, number];
  /** Total length in beats, rounded up to a whole bar. */
  beats: number;
  bars: number;
  noteCount: number;
  pitchMin: number;
  pitchMax: number;
  polyphony: number;
  tracks: MidiTrackInfo[];
  /** Flat [startBeat, lengthBeats, midi, velocity0to127] quads, capped for preview. */
  notes: number[];
  truncated: boolean;
  chords: MidiChord[];
  key: string | null;
  keyConf: number;
  drums: boolean;
}

export interface MidiData {
  file: FileRef;
  title?: string;
  trim?: Trim | null;
  summary?: MidiSummary;
  instrument: InstrumentId;
  tags?: SoundTags;
  status: 'ready' | 'error';
  error?: string;
  loop?: boolean;
}

export interface ItemDataMap {
  text: TextData;
  image: ImageData;
  link: LinkData;
  audio: AudioData;
  midi: MidiData;
}

export interface Item<T extends ItemType = ItemType> {
  id: string;
  type: T;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  data: ItemDataMap[T];
  createdAt: number;
  updatedAt: number;
}

export type AnyItem = { [K in ItemType]: Item<K> }[ItemType];

export interface ItemPatch {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  z?: number;
  /** Shallow-merged into the item's data. */
  data?: Record<string, unknown>;
}

export interface BoardMeta {
  id: string;
  title: string;
  key: string | null;
  bpm: number | null;
  createdAt: number;
  updatedAt: number;
}

export type BoardPatch = Partial<Pick<BoardMeta, 'title' | 'key' | 'bpm'>>;

export type Op =
  | { op: 'add'; item: AnyItem }
  | { op: 'update'; id: string; patch: ItemPatch }
  | { op: 'remove'; id: string }
  | { op: 'board'; patch: BoardPatch };

/** A single is a standalone board; songs and the overview belong to an album. */
export type BoardKind = 'single' | 'song' | 'overview';

export interface BoardPayload {
  board: BoardMeta;
  items: AnyItem[];
  access: 'edit' | 'view';
  viewId: string;
  editId?: string;
  kind: BoardKind;
  /** Set for songs and overviews. Only the title: a song link doesn't open the rest of the album. */
  album?: { title: string };
}

// ---- Albums -------------------------------------------------------------------

export interface AlbumMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface AlbumBoardRef {
  viewId: string;
  /** Only present when the album was opened with its edit link. */
  editId?: string;
  kind: 'song' | 'overview';
  title: string;
  key: string | null;
  bpm: number | null;
  position: number;
}

export interface AlbumPayload {
  album: AlbumMeta;
  access: 'edit' | 'view';
  viewId: string;
  editId?: string;
  overview: AlbumBoardRef;
  songs: AlbumBoardRef[];
}

// ---- Live sync --------------------------------------------------------------

export interface Peer {
  id: string;
  name: string;
  color: string;
  canEdit: boolean;
}

export type ClientMsg =
  | { t: 'hello'; name: string; color: string }
  | { t: 'cursor'; x: number; y: number }
  | { t: 'cursor-out' }
  | { t: 'drag'; moves: { id: string; x: number; y: number }[] };

export type ServerMsg =
  | { t: 'welcome'; clientId: string; peers: Peer[] }
  | { t: 'peers'; peers: Peer[] }
  | { t: 'ops'; ops: Op[]; origin: string }
  | { t: 'cursor'; id: string; x: number; y: number }
  | { t: 'cursor-out'; id: string }
  | { t: 'drag'; id: string; moves: { id: string; x: number; y: number }[] }
  /** The album this board belongs to changed (songs added, renamed, reordered). */
  | { t: 'album' };

// ---- Admin ----

export interface StorageBoard {
  id: string;
  editId: string;
  title: string;
  kind: BoardKind;
  albumId: string | null;
  position: number;
  createdAt: number;
  updatedAt: number;
  items: number;
  files: number;
  bytes: number;
}

export interface StorageAlbum {
  id: string;
  editId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface StorageReport {
  boards: StorageBoard[];
  albums: StorageAlbum[];
  fileBytes: number;
  unused: { files: number; bytes: number };
}

export interface AdminStatus {
  disk: { total: number; free: number };
  dbBytes: number;
  /** Uploads are refused below this much free space (0 = never). */
  minFree: number;
  /** The admin page warns below this. */
  warnFree: number;
  low: boolean;
}

export type AdminStorage = AdminStatus & StorageReport;
