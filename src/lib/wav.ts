/** 16- or 24-bit PCM WAV, interleaved. */
export function encodeWav(channels: Float32Array[], sampleRate: number, bits: 16 | 24 = 24): Blob {
  const nCh = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bps = bits / 8;
  const dataSize = frames * nCh * bps;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nCh * bps, true);
  v.setUint16(32, nCh * bps, true);
  v.setUint16(34, bits, true);
  str(36, 'data');
  v.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      if (bits === 16) {
        v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      } else {
        const n = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
        v.setUint8(o, n & 0xff);
        v.setUint8(o + 1, (n >> 8) & 0xff);
        v.setUint8(o + 2, (n >> 16) & 0xff);
      }
      o += bps;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}
