/** Second-order low-pass (RBJ cookbook), applied in place. */
export function lowpass(x: Float32Array, sr: number, cutoff: number, q = Math.SQRT1_2) {
  const w0 = (2 * Math.PI * cutoff) / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const cw = Math.cos(w0);
  const a0 = 1 + alpha;
  const b0 = (1 - cw) / 2 / a0;
  const b1 = (1 - cw) / a0;
  const b2 = b0;
  const a1 = (-2 * cw) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    x[i] = y0;
  }
}

/** Low-pass then keep every `factor`-th sample. Returns a new array. */
export function decimate(x: Float32Array, sr: number, factor: number): Float32Array {
  if (factor <= 1) return x;
  const tmp = new Float32Array(x);
  const cutoff = (sr / factor) * 0.45;
  lowpass(tmp, sr, cutoff);
  lowpass(tmp, sr, cutoff);
  const out = new Float32Array(Math.floor(tmp.length / factor));
  for (let i = 0; i < out.length; i++) out[i] = tmp[i * factor];
  return out;
}
