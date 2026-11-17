# Audiation Space

A vision board for songwriting and production that listens to what you put on it.

Pin loops, stems, voice memos, MIDI, reference tracks, videos, images and notes on an infinite canvas. Every sound is analysed in the browser as it lands and drawn so you can read the board at a glance: what role a sound plays, whether it's acoustic or electronic, clean or distorted, plucky or swelling, what key and tempo it's in, and whether it fits the rest of the board. Anything can be dragged straight into a DAW.

## Running it

Requires Node 24+ (uses the built-in `node:sqlite` and native TypeScript).

```bash
npm install
npm run dev        # Vite on :5173, API on :8787 (proxied)
```

Production:

```bash
npm run build
npm start          # serves the app + API on $PORT (default 8787)
```

Data lives in `./data` (SQLite + uploaded files). Settings, all optional:

| Variable | Default | |
| --- | --- | --- |
| `DATA_DIR` | `./data` | Where the database and uploads live |
| `HOST` | all interfaces | Set `127.0.0.1` behind a reverse proxy |
| `MAX_UPLOAD_MB` | 250 | Per-file upload limit |
| `MIN_FREE_GB` | 0 (off) | Refuse uploads when the disk has less free space than this |
| `WARN_FREE_GB` | `MIN_FREE_GB` + 5 | Show the low-storage warning below this much free space |
| `ADMIN_KEY` | unset (admin off) | Unlocks `/admin`: disk usage, project sizes, deleting projects, cleaning up unused files |

### Deploying to the Hetzner server

`deploy/` holds everything for running at audiation.space next to other sites on one server: a systemd service, a Caddy site block, the env file and a private Node runtime install that leaves the system Node alone.

```bash
./deploy/deploy.sh --setup   # first time: creates the user, folders, Node, service and Caddy site
./deploy/deploy.sh           # every deploy after that
```

**Normally you don't run it yourself: every push to `main` deploys automatically** (GitHub Actions, `.github/workflows/deploy.yml`). Watch it under the repo's Actions tab, or re-run it from there with "Run workflow". It logs in as a `deploy` account on the server that can update the app's code and restart it, and nothing else; its key lives only in the repo's `DEPLOY_SSH_KEY` secret. If a deploy fails (a type error, say), the live site keeps running the previous version.

To work on it with someone: add them under Settings → Collaborators on GitHub. They clone, work on a branch, open a pull request, and merging it deploys. Anyone who can push to `main` can deploy, so turn on branch protection for `main` if you'd rather review each change first.

On the server: the app is in `/srv/audiation/app`, data in `/srv/audiation/data`, settings in `/etc/audiation/audiation.env`, logs via `journalctl -u audiation -f`. The admin key is in the env file: `ssh root@2.29.191.107 grep ADMIN_KEY /etc/audiation/audiation.env`. Back up `/srv/audiation/data` to keep boards safe.

## How it works

**Boards and sharing.** No accounts. Creating a board returns two links: an edit link (`/e/…`, 24-char secret) and a view link (`/b/…`). Viewers can play, audition MIDI with other sounds, download and drag out files, but the server rejects their writes. Every change is an op (`add` / `update` / `remove` / `board`) applied optimistically, batched to the server, and broadcast to everyone on the board over a WebSocket, along with presence, live cursors and drag previews. Undo/redo keeps inverse ops.

**Sound analysis** (`src/audio/dsp/`, runs in a Web Worker). On upload the file is decoded (with a built-in AIFF decoder, since Chrome and Firefox can't decode `.aif`) and measured:

| Measured | How | Reliability |
| --- | --- | --- |
| Tempo, bar count, loop vs one-shot | spectral-flux onset envelope → autocorrelation, plus a strong prior that loops are cut to whole bars | High for rhythmic loops |
| Key / root note | interpolated spectral peaks → chroma (overtones sieved out) → Krumhansl–Kessler profiles; root note for tonal one-shots via YIN pitch | Good for tonal material, low on short/sparse clips |
| Envelope (hit / pluck / sustain / swell) | 15 ms RMS envelope per detected note: attack, decay, sustain | High |
| Brightness | spectral centroid, relative to what the role usually sounds like | High |
| Role (lead, chords, pad, bass, drums, vocal, FX, reference) | weighted cues: pitch, polyphony, low-end share, percussiveness, onset rate, noisiness, duration | Medium; heuristic |
| Clean / driven / distorted | crest factor, digital clipping, spectral slope and density, gated by harmonic richness | Medium |
| Acoustic / electronic | pitch micro-drift, waveform periodicity, digital silence vs room noise, sub-bass, repeated identical hits | Low-medium; shown as a guess |

Sample-pack style file names (`Pad_Dreamy_124_F#min.wav`, `808 Bass C.wav`) override the analysis where they say something. Every tag carries a confidence and its origin (detected, from file name, or set by you); low-confidence tags are drawn dashed, and one click on a card's tag row corrects them. Re-analysing keeps anything set by hand.

**The visual language.** Hue = role. Waveform style = source (smooth curve for acoustic, stepped bars for electronic, rounded bars for hybrid). Clipped flat tops with a hot edge = driven/distorted. Column lightness = local brightness. The small glyph = the measured note envelope. Key and tempo badges get a dot showing fit against the board (Camelot-wheel key compatibility; tempo within stretch range).

**Playback** (`src/audio/engine.ts`). Click ▶ to play solo; Shift-click (or *Layer*) to add a clip to what's playing, phase-aligned to a shared bar grid. With *Sync* on, loops are time-stretched to the board tempo, either pitch-preserving (*Warp*, WSOLA in the worker) or tape-style (*Varispeed*). MIDI plays through a lookahead scheduler on a choice of sampled instruments (piano, electric piano, strings, marimba, via [smplr](https://github.com/danigb/smplr), loaded on demand with only the notes a clip uses) or built-in synths (pad, pluck, sub bass, saw lead, drum machine). MIDI cards show the piano roll and the detected chord progression.

**Getting sounds out.** Drag a card's ⠿ handle into Ableton, Logic, FL, or Finder (Chromium browsers support dragging files out of a page; elsewhere it downloads). *Pack* downloads the whole board as a zip, sorted into folders by role, with a `Board notes.md` summarising notes, references and every sound's tags.

## Shortcuts

| Key | |
| --- | --- |
| Space | play/stop selected sound (Shift+Space to layer) |
| Esc | deselect, then stop everything |
| N, A, M, R, I, L | new note, audio, MIDI, record, image, link |
| Double-click canvas | new note |
| ⌘Z / ⇧⌘Z | undo / redo |
| ⌘D, ⌫, arrows | duplicate, delete, nudge |
| ⌘C / ⌘V | copy/paste cards (works across boards) |
| ⇧1, ⌘0, ⌘± | fit, 100%, zoom |
| Scroll / pinch / drag empty space | pan / zoom / pan; Shift-drag to box-select |

Paste or drop files, URLs, or text anywhere on the board.
