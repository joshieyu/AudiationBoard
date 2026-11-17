// Decoding with an AIFF fallback: Chrome and Firefox can't decode .aif/.aiff,
// which producers use constantly.

function ext80ToNumber(b: DataView, o: number) {
  const exp = ((b.getUint8(o) & 0x7f) << 8) | b.getUint8(o + 1);
  const hi = b.getUint32(o + 2);
  const lo = b.getUint32(o + 6);
  const sign = b.getUint8(o) & 0x80 ? -1 : 1;
  if (exp === 0 && hi === 0 && lo === 0) return 0;
  return sign * (hi * 2 ** (exp - 16383 - 31) + lo * 2 ** (exp - 16383 - 63));
}

export function isAiff(buf: ArrayBuffer) {
  if (buf.byteLength < 12) return false;
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  return tag(0) === 'FORM' && (tag(8) === 'AIFF' || tag(8) === 'AIFC');
}

export function parseAiff(buf: ArrayBuffer): { channels: Float32Array[]; sampleRate: number } {
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  let numCh = 0, frames = 0, bits = 16, sr = 44100, comp = 'NONE';
  let dataOff = -1;
  let o = 12;
  while (o + 8 <= buf.byteLength) {
    const id = tag(o);
    const size = v.getUint32(o + 4);
    const body = o + 8;
    if (id === 'COMM') {
      numCh = v.getUint16(body);
      frames = v.getUint32(body + 2);
      bits = v.getUint16(body + 6);
      sr = ext80ToNumber(v, body + 8);
      if (size >= 22) comp = tag(body + 18);
    } else if (id === 'SSND') {
      dataOff = body + 8 + v.getUint32(body);
    }
    o = body + size + (size & 1);
  }
  if (!numCh || dataOff < 0) throw new Error('Unreadable AIFF file');
  const little = comp === 'sowt';
  const float = comp === 'fl32' || comp === 'FL32' || comp === 'fl64' || comp === 'FL64';
  if (float && bits !== 64) bits = 32;
  if (comp === 'fl64' || comp === 'FL64') bits = 64;
  if (!['NONE', 'sowt', 'twos', 'in24', 'in32', 'fl32', 'FL32', 'fl64', 'FL64'].includes(comp)) {
    throw new Error(`Compressed AIFF (${comp}) is not supported`);
  }
  const bytes = Math.ceil(bits / 8);
  const channels = Array.from({ length: numCh }, () => new Float32Array(frames));
  const maxFrames = Math.min(frames, Math.floor((buf.byteLength - dataOff) / (bytes * numCh)));
  for (let f = 0; f < maxFrames; f++) {
    for (let c = 0; c < numCh; c++) {
      const p = dataOff + (f * numCh + c) * bytes;
      let s: number;
      if (float) s = bits === 64 ? v.getFloat64(p, little) : v.getFloat32(p, little);
      else if (bytes === 1) s = v.getInt8(p) / 128;
      else if (bytes === 2) s = v.getInt16(p, little) / 32768;
      else if (bytes === 3) {
        const b0 = v.getUint8(p), b1 = v.getUint8(p + 1), b2 = v.getUint8(p + 2);
        let n = little ? (b2 << 16) | (b1 << 8) | b0 : (b0 << 16) | (b1 << 8) | b2;
        if (n & 0x800000) n -= 0x1000000;
        s = n / 8388608;
      } else s = v.getInt32(p, little) / 2147483648;
      channels[c][f] = s;
    }
  }
  return { channels, sampleRate: sr };
}

export async function decodeAudio(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  if (isAiff(data)) {
    // Safari decodes AIFF natively; elsewhere use our parser.
    try {
      return await ctx.decodeAudioData(data.slice(0));
    } catch {
      const { channels, sampleRate } = parseAiff(data);
      const ab = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
      channels.forEach((c, i) => ab.copyToChannel(c as Float32Array<ArrayBuffer>, i));
      return ab;
    }
  }
  return ctx.decodeAudioData(data.slice(0));
}

export const AUDIO_EXT = /\.(wav|wave|aif|aiff|aifc|mp3|flac|ogg|oga|opus|m4a|aac|mp4|webm|caf)$/i;
export const MIDI_EXT = /\.(mid|midi|smf)$/i;
export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i;

export function fileKind(f: File): 'audio' | 'midi' | 'image' | null {
  if (MIDI_EXT.test(f.name) || f.type === 'audio/midi' || f.type === 'audio/x-midi') return 'midi';
  if (f.type.startsWith('image/') || IMAGE_EXT.test(f.name)) return 'image';
  if (f.type.startsWith('audio/') || AUDIO_EXT.test(f.name)) return 'audio';
  return null;
}
