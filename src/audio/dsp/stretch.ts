/**
 * Pitch-preserving time stretch (WSOLA). `factor` > 1 makes the clip longer/slower.
 * All channels share one set of splice points so the stereo image stays intact.
 * With `circular`, the input and output both wrap, so a seamless loop stays seamless.
 */
export function wsola(channels: Float32Array[], sr: number, factor: number, circular: boolean): Float32Array[] {
  const inLen = channels[0].length;
  const outLen = Math.max(1, Math.round(inLen * factor));
  const frame = Math.max(256, Math.round(sr * 0.05) & ~1);
  const halfF = frame / 2;
  const nOut = Math.max(1, Math.round(outLen / halfF));
  const hopOut = outLen / nOut;
  const hopIn = hopOut / factor;
  const tol = Math.round(sr * 0.012);
  const win = new Float32Array(frame);
  for (let i = 0; i < frame; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame);

  // Decimated mono guide for a cheap coarse search.
  const D = 4;
  const gLen = Math.floor(inLen / D);
  const guide = new Float32Array(gLen);
  for (let i = 0; i < gLen; i++) {
    let s = 0;
    for (let c = 0; c < channels.length; c++) for (let j = 0; j < D; j++) s += channels[c][i * D + j];
    guide[i] = s;
  }
  const gAt = (i: number) => (circular ? guide[((i % gLen) + gLen) % gLen] : i >= 0 && i < gLen ? guide[i] : 0);
  const at = (ch: Float32Array, i: number) => (circular ? ch[((i % inLen) + inLen) % inLen] : i >= 0 && i < inLen ? ch[i] : 0);

  const outs = channels.map(() => new Float32Array(circular ? outLen : outLen + frame));
  let prev = 0;
  const steps = circular ? nOut : nOut + 1;
  for (let k = 0; k < steps; k++) {
    const outPos = Math.round(k * hopOut);
    const ideal = Math.round(k * hopIn);
    let pos = ideal;
    if (k > 0) {
      const target = prev + Math.round(hopOut);
      const ov = Math.floor(halfF / D);
      let best = 0, bestScore = -Infinity;
      for (let d = -Math.floor(tol / D); d <= Math.floor(tol / D); d++) {
        const base = Math.floor((ideal + d * D) / D);
        const tb = Math.floor(target / D);
        let num = 0, en = 1e-9;
        for (let j = 0; j < ov; j++) {
          const a = gAt(base + j);
          num += a * gAt(tb + j);
          en += a * a;
        }
        const sc = num / Math.sqrt(en);
        if (sc > bestScore) {
          bestScore = sc;
          best = d * D;
        }
      }
      // Refine around the coarse hit at full resolution (mono sum of first channel pair).
      let fine = best, fineScore = -Infinity;
      const c0 = channels[0], c1 = channels[1] ?? channels[0];
      for (let d = best - D; d <= best + D; d++) {
        let num = 0, en = 1e-9;
        for (let j = 0; j < halfF; j += 2) {
          const a = at(c0, ideal + d + j) + at(c1, ideal + d + j);
          num += a * (at(c0, target + j) + at(c1, target + j));
          en += a * a;
        }
        const sc = num / Math.sqrt(en);
        if (sc > fineScore) {
          fineScore = sc;
          fine = d;
        }
      }
      pos = ideal + fine;
      if (!circular) pos = Math.max(0, Math.min(inLen - 1, pos));
    }
    for (let c = 0; c < channels.length; c++) {
      const src = channels[c];
      const dst = outs[c];
      for (let j = 0; j < frame; j++) {
        const o = outPos + j;
        const idx = circular ? o % outLen : o;
        if (idx < dst.length) dst[idx] += at(src, pos + j) * win[j];
      }
    }
    prev = pos;
  }
  return circular ? outs : outs.map((o) => o.subarray(0, outLen));
}
