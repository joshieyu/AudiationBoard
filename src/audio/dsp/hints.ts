import type { Brightness, Character, ClipKind, Envelope, Role, Source } from '../../../shared/types.ts';
import { parseKey, keyName, type Key } from '../../lib/music.ts';

/** Things sample-pack style file names tell us ("Pad_Dreamy_120_Am.wav"). */
export interface NameHints {
  bpm?: number;
  key?: Key;
  /** Root letter with no quality, e.g. "F#" — mode is left to analysis. */
  rootOnly?: number;
  role?: Role;
  source?: Source;
  character?: Character;
  brightness?: Brightness;
  envelope?: Envelope;
  kind?: ClipKind;
}

const ROLE_WORDS: [Role, RegExp][] = [
  ['bass', /^(bass|basses|sub|subbass|808|808s|reese|bassline)$/],
  ['drums', /^(drum|drums|kick|kik|bd|snare|snr|sd|hat|hats|hihat|hh|oh|ch|clap|perc|percs|percussion|tom|toms|cymbal|crash|ride|shaker|rim|rimshot|break|breakbeat|fill|beat|groove|top|tops|conga|bongo|tabla|djembe|snap)$/],
  ['vocal', /^(vox|vocal|vocals|voice|acapella|acappella|chop|chops|adlib|adlibs|choir|hum|humming|sing|singing|topline|memo)$/],
  ['pad', /^(pad|pads|atmos|atmosphere|drone|ambient|ambience|swell|bed|wash)$/],
  ['lead', /^(lead|leads|ld|melody|mel|hook|solo|riff|line)$/],
  ['chords', /^(chord|chords|keys|key|piano|rhodes|ep|organ|stab|stabs|comp|progression|prog|guitar|gtr|strum)$/],
  ['fx', /^(fx|sfx|riser|uplifter|downlifter|impact|sweep|whoosh|noise|texture|foley|transition|reverse|rev|downer|boom)$/],
  ['mix', /^(mix|master|mastered|reference|ref|demo|bounce|song|full|track|premaster)$/],
];

const ACOUSTIC = /^(acoustic|guitar|gtr|piano|strings|string|violin|cello|viola|brass|horn|horns|trumpet|sax|saxophone|flute|live|organic|harp|marimba|kalimba|ukulele|uke|banjo|mandolin|upright|woodwind|choir|vocal|vocals|vox|voice|hum|memo|conga|bongo|tabla|djembe|shaker|recorded|mic|field)$/;
const ELECTRONIC = /^(synth|synths|saw|supersaw|square|analog|analogue|digital|808|909|303|707|606|fm|wavetable|serum|vital|moog|juno|chip|chiptune|8bit|reese|wobble|bitcrush|bitcrushed|electro|edm|arp|modular|sid)$/;

export function parseFileName(fileName: string): NameHints {
  const stem = fileName.replace(/\.[a-z0-9]{2,5}$/i, '');
  const out: NameHints = {};

  const bpm =
    stem.match(/(\d{2,3}(?:\.\d{1,2})?)\s*-?\s*bpm/i) ?? stem.match(/bpm\s*[-_ ]?\s*(\d{2,3}(?:\.\d{1,2})?)/i);
  if (bpm) {
    const v = Number(bpm[1]);
    if (v >= 50 && v <= 220) out.bpm = v;
  }

  // Tokens split on separators but keep "C#", "Bb", "F#m" intact.
  const tokens = stem.split(/[\s_\-.,()[\]{}+]+/).filter(Boolean);
  let hasKeyToken = false;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    // "A min", "C# Major" split over two tokens
    const next = tokens[i + 1]?.toLowerCase();
    if (/^[A-G][#b♯♭]?$/.test(tok) && next && /^(maj|major|min|minor)$/.test(next)) {
      const k = parseKey(`${tok} ${next}`);
      if (k) {
        out.key = k;
        hasKeyToken = true;
        i++;
        continue;
      }
    }
    if (/^[A-G][#b♯♭]?(m|min|minor|maj|major|M)$/.test(tok)) {
      const k = parseKey(tok);
      if (k) {
        out.key = k;
        hasKeyToken = true;
        continue;
      }
    }
    if (/^[A-G][#♯b♭]$/.test(tok)) {
      out.rootOnly = parseKey(tok)?.root;
      hasKeyToken = true;
    }
  }

  // A bare number is a tempo only when the name already looks like a sample-pack name.
  if (!out.bpm && hasKeyToken) {
    for (const tok of tokens) {
      if (/^\d{2,3}$/.test(tok)) {
        const v = Number(tok);
        if (v >= 60 && v <= 200) {
          out.bpm = v;
          break;
        }
      }
    }
  }

  const words = tokens.flatMap((t) => t.split(/(?<=[a-z])(?=[A-Z])/)).map((t) => t.toLowerCase());
  for (const w of words) {
    if (!out.role) for (const [role, re] of ROLE_WORDS) if (re.test(w)) { out.role = role; break; }
    if (!out.source) {
      if (ELECTRONIC.test(w)) out.source = 'electronic';
      else if (ACOUSTIC.test(w)) out.source = 'acoustic';
    }
    if (!out.character) {
      if (/^(distorted|dist|distortion|fuzz|fuzzy|crushed|bitcrushed|heavy|dirty|grime|grimy|nasty)$/.test(w)) out.character = 'distorted';
      else if (/^(drive|driven|overdrive|od|saturated|sat|grit|gritty|warm|tape|lofi)$/.test(w)) out.character = 'driven';
      else if (/^(clean|pure|sine|di)$/.test(w)) out.character = 'clean';
    }
    if (!out.brightness) {
      if (/^(bright|airy|shimmer|crisp)$/.test(w)) out.brightness = 'bright';
      else if (/^(dark|muffled|deep|lofi|warm)$/.test(w)) out.brightness = 'dark';
    }
    if (!out.envelope) {
      if (/^(pluck|plucks|plucked|pizz|pizzicato)$/.test(w)) out.envelope = 'pluck';
      else if (/^(swell|swells|reverse|rev)$/.test(w)) out.envelope = 'swell';
      else if (/^(stab|stabs|hit|hits|shot|oneshot)$/.test(w)) out.envelope = 'hit';
    }
    if (!out.kind) {
      if (/^(loop|loops|lp)$/.test(w)) out.kind = 'loop';
      else if (/^(oneshot|shot|os|hit|one)$/.test(w)) out.kind = 'oneshot';
    }
  }
  if (out.role === 'drums' && /\b(808)\b/i.test(stem) && /bass|sub/i.test(stem)) out.role = 'bass';
  if (out.role === 'vocal' && !out.source) out.source = 'acoustic';
  return out;
}

export function hintKeyName(h: NameHints) {
  return h.key ? keyName(h.key) : undefined;
}
