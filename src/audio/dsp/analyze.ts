import type {
  AudioAnalysis,
  Brightness,
  Character,
  ClipKind,
  Envelope,
  Role,
  SoundTags,
  Source,
  TagValue,
} from '../../../shared/types.ts';
import { FFT, hann } from './fft.ts';
import { decimate } from './filters.ts';
import { parseFileName } from './hints.ts';
import { detectKey, hzToMidi, keyName, midiToName } from '../../lib/music.ts';

export const ANALYSIS_VERSION = 1;
export const PEAK_COLUMNS = 1000;

export interface AnalyzeOutput {
  peaks: string;
  analysis: AudioAnalysis;
  tags: SoundTags;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Smoothstep from a to b; works descending when a > b. */
const ss = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const toDb = (x: number) => 20 * Math.log10(Math.max(x, 1e-10));

function median(a: number[]) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(a: ArrayLike<number>, p: number) {
  const s = Array.from(a).sort((x, y) => x - y);
  if (!s.length) return NaN;
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
}

function toBase64(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const tag = <T>(v: T, conf: number, src: TagValue<T>['src'] = 'auto'): TagValue<T> => ({
  v,
  conf: Math.round(clamp01(conf) * 100) / 100,
  src,
});

export function analyzeAudio(channels: Float32Array[], sr: number, fileName: string): AnalyzeOutput {
  const started = Date.now();
  const nCh = Math.max(1, channels.length);
  const len = channels[0]?.length ?? 0;
  const duration = len / sr;
  const hints = parseFileName(fileName);

  // ---- Mono mix, levels, stereo image ----------------------------------------
  const mono = new Float32Array(len);
  let peak = 0;
  for (let c = 0; c < nCh; c++) {
    const ch = channels[c];
    for (let i = 0; i < len; i++) {
      const v = ch[i];
      mono[i] += v / nCh;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
  }

  let width = 0;
  if (nCh >= 2) {
    const L = channels[0], R = channels[1];
    let mm = 0, sd = 0;
    for (let i = 0; i < len; i++) {
      const m = (L[i] + R[i]) * 0.5, s = (L[i] - R[i]) * 0.5;
      mm += m * m;
      sd += s * s;
    }
    width = mm > 0 ? clamp01(Math.sqrt(sd / mm)) : 0;
  }

  // Digital clipping shows up as runs of identical samples at the top of the range.
  let clipped = 0;
  if (peak > 0.5) {
    const thr = peak * 0.95;
    for (let c = 0; c < nCh; c++) {
      const ch = channels[c];
      let run = 0;
      for (let i = 1; i < len; i++) {
        const a = ch[i] < 0 ? -ch[i] : ch[i];
        if (a >= thr && Math.abs(ch[i] - ch[i - 1]) < 1e-6) {
          run++;
          if (run === 2) clipped += 3;
          else if (run > 2) clipped++;
        } else run = 0;
      }
    }
  }
  const clipRatio = len ? clipped / (len * nCh) : 0;

  // Noise floor / digital silence, from 10 ms blocks of the original signal.
  const block = Math.max(64, Math.round(sr * 0.01));
  const blockDb: number[] = [];
  let exactZeros = 0;
  for (let s = 0; s + block <= len; s += block) {
    let sq = 0;
    for (let i = s; i < s + block; i++) {
      sq += mono[i] * mono[i];
      if (mono[i] === 0) exactZeros++;
    }
    blockDb.push(10 * Math.log10(sq / block + 1e-20));
  }
  const floorDb = blockDb.length ? percentile(blockDb, 0.05) : -200;

  // ---- Peak columns for the waveform ------------------------------------------
  const cols = PEAK_COLUMNS;
  const colPeak = new Float32Array(cols);
  const colRms = new Float32Array(cols);
  for (let c = 0; c < cols; c++) {
    const s = Math.floor((c * len) / cols);
    const e = Math.max(s + 1, Math.floor(((c + 1) * len) / cols));
    let pk = 0, sq = 0, n = 0;
    for (let i = s; i < e && i < len; i++) {
      const v = mono[i];
      const a = v < 0 ? -v : v;
      if (a > pk) pk = a;
      sq += v * v;
      n++;
    }
    colPeak[c] = pk;
    colRms[c] = n ? Math.sqrt(sq / n) : 0;
  }

  // ---- STFT features ------------------------------------------------------------
  const factor = sr >= 80000 ? 4 : sr >= 40000 ? 2 : 1;
  const fs = sr / factor;
  const N = 2048;
  const half = N / 2;
  const ds = decimate(mono, sr, factor);
  // Centre frames: N/2 zeros of lead-in so the first attack registers as an onset.
  const x = new Float32Array(ds.length + N);
  x.set(ds, half);
  let hop = 512;
  const maxFrames = 6000;
  if ((x.length - N) / hop > maxFrames) hop = Math.ceil((x.length - N) / maxFrames);
  const nFrames = Math.max(1, Math.floor((x.length - N) / hop) + 1);
  const frameSec = hop / fs;

  const fft = new FFT(N);
  const win = hann(N);
  const scale = 2 / (N / 2);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const mag = new Float64Array(half + 1);
  const prevLog = new Float64Array(half + 1);

  const energy = new Float64Array(nFrames);
  const centroid = new Float64Array(nFrames);
  const flatness = new Float64Array(nFrames);
  const hfFlat = new Float64Array(nFrames);
  const flux = new Float64Array(nFrames);
  const lowE = new Float64Array(nFrames);
  const midE = new Float64Array(nFrames);
  const highE = new Float64Array(nFrames);
  const subE = new Float64Array(nFrames);
  const NB = 16;
  const bandVec = new Float32Array(nFrames * NB);
  const frameChroma = new Float32Array(nFrames * 12);
  const octBands = [125, 250, 500, 1000, 2000, 4000, 8000].filter((f) => f * 1.41 < fs / 2);
  const octPower = new Float64Array(nFrames * octBands.length);

  const binHz = fs / N;
  const kFlatLo = Math.max(1, Math.round(100 / binHz));
  const kFlatHi = Math.min(half - 1, Math.round(Math.min(10000, fs / 2 - 200) / binHz));
  const kHfLo = Math.round(3000 / binHz);
  const kHfHi = kFlatHi;
  const kChromaLo = Math.max(2, Math.round(65 / binHz));
  const kChromaHi = Math.min(half - 2, Math.round(2500 / binHz));
  const peakF = new Float64Array(64);
  const peakM = new Float64Array(64);
  const bandOf = new Int8Array(half + 1);
  for (let k = 0; k <= half; k++) {
    const f = k * binHz;
    bandOf[k] = f < 40 ? -1 : Math.min(NB - 1, Math.floor((Math.log2(f / 40) / Math.log2(fs / 2 / 40)) * NB));
  }
  const octOf = new Int8Array(half + 1).fill(-1);
  for (let k = 0; k <= half; k++) {
    const f = k * binHz;
    for (let b = 0; b < octBands.length; b++) if (f >= octBands[b] / 1.41 && f < octBands[b] * 1.41) octOf[k] = b;
  }

  for (let fr = 0; fr < nFrames; fr++) {
    const start = fr * hop;
    for (let i = 0; i < N; i++) {
      re[i] = (x[start + i] ?? 0) * win[i];
      im[i] = 0;
    }
    fft.transform(re, im);
    let E = 0, cNum = 0, mSum = 0, lo = 0, mi = 0, hi = 0, sub = 0, fl = 0, logSum = 0, pSum = 0, hLog = 0, hSum = 0;
    let maxMag = 0;
    for (let k = 1; k < half; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * scale;
      mag[k] = m;
      if (m > maxMag) maxMag = m;
      const p = m * m;
      const f = k * binHz;
      E += p;
      cNum += f * m;
      mSum += m;
      if (f < 250) lo += p;
      else if (f < 4000) mi += p;
      else hi += p;
      if (f < 60) sub += p;
      if (k >= kFlatLo && k <= kFlatHi) {
        logSum += Math.log(p + 1e-14);
        pSum += p;
      }
      if (k >= kHfLo && k <= kHfHi) {
        hLog += Math.log(p + 1e-14);
        hSum += p;
      }
      const lm = Math.log(1 + 1000 * m);
      const d = lm - prevLog[k];
      if (d > 0) fl += d;
      prevLog[k] = lm;
      const b = bandOf[k];
      if (b >= 0) bandVec[fr * NB + b] += p;
      const ob = octOf[k];
      if (ob >= 0) octPower[fr * octBands.length + ob] += p;
    }
    energy[fr] = E;
    centroid[fr] = mSum > 0 ? cNum / mSum : 0;
    const nF = kFlatHi - kFlatLo + 1;
    flatness[fr] = pSum > 0 ? Math.exp(logSum / nF) / (pSum / nF) : 1;
    const nH = kHfHi - kHfLo + 1;
    hfFlat[fr] = hSum > 1e-12 ? Math.exp(hLog / nH) / (hSum / nH) : 0;
    flux[fr] = fl;
    lowE[fr] = lo;
    midE[fr] = mi;
    highE[fr] = hi;
    subE[fr] = sub;
    for (let b = 0; b < NB; b++) bandVec[fr * NB + b] = Math.log10(bandVec[fr * NB + b] + 1e-10);

    // Chroma from interpolated spectral peaks (sharper than raw bins in the bass),
    // with overtones of lower peaks sieved out so a saw's fifths don't skew the key.
    if (maxMag > 1e-5) {
      const thr = maxMag * 0.03;
      let np = 0;
      for (let k = kChromaLo; k <= kChromaHi && np < 64; k++) {
        const m = mag[k];
        if (m > thr && m > mag[k - 1] && m >= mag[k + 1]) {
          const a = Math.log(mag[k - 1] + 1e-12), b = Math.log(m + 1e-12), c = Math.log(mag[k + 1] + 1e-12);
          const den = a - 2 * b + c;
          const off = den !== 0 ? (0.5 * (a - c)) / den : 0;
          peakF[np] = (k + off) * binHz;
          peakM[np] = m;
          np++;
        }
      }
      for (let i = 0; i < np; i++) {
        const f = peakF[i];
        let overtone = false;
        for (let j = 0; j < i && !overtone; j++) {
          const ratio = f / peakF[j];
          const h = Math.round(ratio);
          if (h >= 2 && h <= 8 && Math.abs(ratio - h) < 0.03 * h && peakM[j] > peakM[i] * 0.25) overtone = true;
        }
        const midi = hzToMidi(f);
        const pc = ((Math.round(midi) % 12) + 12) % 12;
        // Down-weight peaks far from a semitone centre (inharmonic content).
        const dev = Math.abs(midi - Math.round(midi));
        frameChroma[fr * 12 + pc] += Math.sqrt(peakM[i]) * (1 - dev) * (overtone ? 0.2 : 1);
      }
    }
  }

  // ---- Activity ---------------------------------------------------------------
  let maxE = 0;
  for (let i = 0; i < nFrames; i++) if (energy[i] > maxE) maxE = energy[i];
  const maxDb = 10 * Math.log10(maxE + 1e-20);
  const actThr = Math.max(maxDb - 45, -80);
  const active = new Uint8Array(nFrames);
  let nActive = 0;
  for (let i = 0; i < nFrames; i++) {
    if (10 * Math.log10(energy[i] + 1e-20) > actThr) {
      active[i] = 1;
      nActive++;
    }
  }
  const silent = maxE < 1e-9 || nActive === 0;
  const activeSec = Math.max(frameSec, nActive * frameSec);

  const tonal = new Uint8Array(nFrames);
  let nTonal = 0;
  let sumW = 0, centW = 0, flatAct = 0, lo = 0, mi = 0, hi = 0, sub = 0, hfFlatT = 0;
  const chroma = new Float64Array(12);
  const logCents: number[] = [];
  for (let i = 0; i < nFrames; i++) {
    if (!active[i]) continue;
    const w = Math.sqrt(energy[i]);
    sumW += w;
    centW += w * centroid[i];
    flatAct += flatness[i];
    lo += lowE[i];
    mi += midE[i];
    hi += highE[i];
    sub += subE[i];
    if (centroid[i] > 0) logCents.push(Math.log2(centroid[i]));
    if (flatness[i] < 0.12) {
      tonal[i] = 1;
      nTonal++;
      hfFlatT += hfFlat[i];
      for (let p = 0; p < 12; p++) chroma[p] += frameChroma[i * 12 + p];
    }
  }
  const total = lo + mi + hi || 1;
  const lowPct = lo / total, midPct = mi / total, highPct = hi / total, subPct = sub / total;
  const centroidHz = sumW ? centW / sumW : 0;
  const flatMean = nActive ? flatAct / nActive : 1;
  const tonalFrac = nActive ? nTonal / nActive : 0;
  const hfFlatMean = nTonal ? hfFlatT / nTonal : 0;
  const centroidSpread = logCents.length > 4 ? percentile(logCents, 0.9) - percentile(logCents, 0.1) : 0;

  // Spectral slope across octave bands (tonal frames, else all active).
  let slope = -6;
  let coverage = 0;
  {
    const nb = octBands.length;
    const acc = new Float64Array(nb);
    for (let i = 0; i < nFrames; i++) {
      if (!(nTonal ? tonal[i] : active[i])) continue;
      for (let b = 0; b < nb; b++) acc[b] += octPower[i * nb + b];
    }
    const bandDb = Array.from(acc, (v) => 10 * Math.log10(v + 1e-20));
    const loudest = Math.max(...bandDb);
    coverage = nb ? bandDb.filter((d) => d > loudest - 30).length / nb : 0;
    const xs: number[] = [], ys: number[] = [];
    for (let b = 1; b < nb; b++) {
      if (acc[b] > 0) {
        xs.push(b);
        ys.push(10 * Math.log10(acc[b]));
      }
    }
    if (xs.length >= 3) {
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const my = ys.reduce((a, b) => a + b, 0) / ys.length;
      let num = 0, den = 0;
      for (let i = 0; i < xs.length; i++) {
        num += (xs[i] - mx) * (ys[i] - my);
        den += (xs[i] - mx) ** 2;
      }
      slope = den ? num / den : -6;
    }
  }

  // ---- Onsets -------------------------------------------------------------------
  const sm = new Float64Array(nFrames);
  for (let i = 0; i < nFrames; i++) sm[i] = (flux[Math.max(0, i - 1)] + 2 * flux[i] + flux[Math.min(nFrames - 1, i + 1)]) / 4;
  let maxFlux = 0;
  for (let i = 0; i < nFrames; i++) if (sm[i] > maxFlux) maxFlux = sm[i];
  const fluxN = new Float64Array(nFrames);
  if (maxFlux > 0) for (let i = 0; i < nFrames; i++) fluxN[i] = sm[i] / maxFlux;
  const onsets: number[] = [];
  const minGap = Math.max(1, Math.round(0.07 / frameSec));
  const W = Math.max(3, Math.round(0.25 / frameSec));
  for (let i = 1; i < nFrames - 1; i++) {
    const v = fluxN[i];
    if (v < 0.07) continue;
    let isMax = true;
    for (let j = Math.max(0, i - 3); j <= Math.min(nFrames - 1, i + 3); j++) if (fluxN[j] > v) isMax = false;
    if (!isMax) continue;
    let mean = 0, n = 0;
    for (let j = Math.max(0, i - W); j <= Math.min(nFrames - 1, i + W); j++) {
      mean += fluxN[j];
      n++;
    }
    mean /= n;
    if (v < mean * 1.25 + 0.04) continue;
    // Needs to land on or right before sound.
    if (!active[i] && !active[Math.min(nFrames - 1, i + 1)] && !active[Math.min(nFrames - 1, i + 2)]) continue;
    if (onsets.length && i - onsets[onsets.length - 1] < minGap) continue;
    onsets.push(i);
  }
  const firstActive = active.indexOf(1);
  if (firstActive >= 0 && (!onsets.length || onsets[0] - firstActive > minGap * 2)) onsets.unshift(Math.max(0, firstActive - 1));
  const onsetRate = silent ? 0 : onsets.length / activeSec;

  // ---- Note envelopes ---------------------------------------------------------------
  // STFT frames smear attacks over ~90 ms, so measure notes on a 15 ms RMS envelope (5 ms hop).
  const fineHop = Math.max(16, Math.round(fs * 0.005));
  const fineSec = fineHop / fs;
  const nFine = Math.max(1, Math.floor(ds.length / fineHop));
  const sqPre = new Float64Array(ds.length + 1);
  for (let i = 0; i < ds.length; i++) sqPre[i + 1] = sqPre[i] + ds[i] * ds[i];
  const fine = new Float64Array(nFine);
  for (let b = 0; b < nFine; b++) {
    const a = Math.max(0, (b - 1) * fineHop), e = Math.min(ds.length, (b + 2) * fineHop);
    fine[b] = Math.sqrt((sqPre[e] - sqPre[a]) / Math.max(1, e - a));
  }
  const toFine = (frame: number) => Math.round((frame * frameSec) / fineSec);

  const shapePts = 24;
  const shapeSum = new Float64Array(shapePts);
  const shapeCnt = new Float64Array(shapePts);
  const attacks: number[] = [], sustains: number[] = [], noteLens: number[] = [], decays: number[] = [];
  let noteCount = 0, decayedCount = 0;
  const step = Math.ceil(onsets.length / 48);
  for (let oi = 0; oi < onsets.length; oi += step) {
    const s = onsets[oi];
    const from = Math.max(0, toFine(s) - Math.round(0.06 / fineSec));
    const nextStart = oi + 1 < onsets.length ? toFine(onsets[oi + 1]) - Math.round(0.03 / fineSec) : nFine;
    const end = Math.min(nFine, nextStart, toFine(s) + Math.round(2 / fineSec));
    if (end - from < 4) continue;
    // Use the early peak unless the note keeps growing well past it (a real swell);
    // detuned voices beating later in the note shouldn't count as a slow attack.
    let p = from, pk = 0;
    const earlyEnd = Math.min(end, from + Math.round(0.15 / fineSec));
    for (let j = from; j < earlyEnd; j++) if (fine[j] > pk) {
      pk = fine[j];
      p = j;
    }
    const searchEnd = Math.min(end, from + Math.round(1.2 / fineSec));
    let lp = p, lpk = pk;
    for (let j = earlyEnd; j < searchEnd; j++) if (fine[j] > lpk) {
      lpk = fine[j];
      lp = j;
    }
    if (lpk > pk * 1.6) {
      pk = lpk;
      p = lp;
    }
    if (pk <= 1e-6) continue;
    let a0 = p;
    while (a0 > from && fine[a0 - 1] >= 0.1 * pk) a0--;
    // 10%→50% rise, scaled to a conventional 10–90% figure. The upper half of the rise
    // is where beating between detuned voices makes the 90% point jump around.
    let a1 = a0;
    while (a1 < p && fine[a1] < 0.5 * pk) a1++;
    let atk = (a1 - a0) * fineSec;
    if (a1 > a0 && fine[a1] > fine[a1 - 1]) atk -= ((fine[a1] - 0.5 * pk) / (fine[a1] - fine[a1 - 1])) * fineSec;
    attacks.push(Math.max(0.001, atk * 2) * 1000);
    noteCount++;
    let d = p;
    while (d < end && fine[d] > 0.3 * pk) d++;
    if (d < end) {
      decayedCount++;
      decays.push((d - p) * fineSec * 1000);
    }
    noteLens.push((end - a0) * fineSec);
    const susStart = p + Math.round(0.15 / fineSec);
    if (end - susStart >= 4) {
      let acc = 0;
      for (let j = susStart; j < end; j++) acc += fine[j];
      sustains.push(acc / (end - susStart) / pk);
    }
    for (let k = 0; k < shapePts; k++) {
      const j = a0 + Math.round((k * 0.05) / fineSec);
      if (j < end) {
        shapeSum[k] += fine[j] / pk;
        shapeCnt[k]++;
      }
    }
  }
  const attackMs = attacks.length ? median(attacks) : 0;
  const decayedFrac = noteCount ? decayedCount / noteCount : 0;
  const sustain = sustains.length ? median(sustains) : decayedFrac >= 0.5 ? 0 : 1;
  const decayMs = decays.length ? median(decays) : Infinity;
  const noteLen = noteLens.length ? median(noteLens) : duration;
  const envShape: number[] = [];
  for (let k = 0; k < shapePts; k++) envShape.push(shapeCnt[k] >= Math.max(1, noteCount * 0.25) ? Math.round((shapeSum[k] / shapeCnt[k]) * 100) / 100 : 0);

  let envelope: Envelope;
  if (attackMs > 110) envelope = 'swell';
  else if (decayedFrac >= 0.5 && decayMs < 170 && (sustain < 0.3 || noteLen < 0.35)) envelope = 'hit';
  else if (decayedFrac >= 0.5 && sustain < 0.5) envelope = 'pluck';
  else envelope = 'sustain';
  const envConf = attackMs > 200 || (envelope === 'hit' && decayMs < 120) ? 0.8 : 0.6;
  const percussive = decayedFrac * ss(0.5, 0.15, sustain) * ss(300, 120, Number.isFinite(decayMs) ? decayMs : 1000);

  // ---- Pitch (YIN, FFT cross-correlation) --------------------------------------
  const p2 = fs > 16000 ? decimate(ds, fs, 2) : ds;
  const pfs = fs > 16000 ? fs / 2 : fs;
  const PW = 512;
  const tauMax = Math.min(PW - 1, Math.floor(pfs / 45));
  const tauMin = Math.max(2, Math.floor(pfs / 1800));
  const M = 2048;
  const pf = new FFT(M);
  const ar = new Float64Array(M), ai = new Float64Array(M), br = new Float64Array(M), bi = new Float64Array(M);
  const dvals = new Float64Array(tauMax + 2);
  let pHop = Math.round(pfs * 0.03);
  if ((p2.length - PW - tauMax) / pHop > 1500) pHop = Math.ceil((p2.length - PW - tauMax) / 1500);
  const f0s: number[] = [];
  const apers: number[] = [];
  const f0Track: number[] = [];
  let pitchFramesActive = 0, voicedFrames = 0, tonalPitchFrames = 0, tonalVoiced = 0;
  for (let s = 0; s + PW + tauMax < p2.length; s += pHop) {
    const centreSec = (s + PW / 2) / pfs;
    const fi = Math.min(nFrames - 1, Math.round(centreSec / frameSec));
    if (!active[fi]) {
      f0Track.push(0);
      continue;
    }
    pitchFramesActive++;
    ar.fill(0); ai.fill(0); br.fill(0); bi.fill(0);
    let e0 = 0;
    for (let j = 0; j < PW; j++) {
      ar[j] = p2[s + j];
      e0 += ar[j] * ar[j];
    }
    for (let j = 0; j < PW + tauMax; j++) br[j] = p2[s + j];
    pf.transform(ar, ai);
    pf.transform(br, bi);
    for (let k = 0; k < M; k++) {
      // conj(A) * B
      const r = ar[k] * br[k] + ai[k] * bi[k];
      const i2 = ar[k] * bi[k] - ai[k] * br[k];
      ar[k] = r;
      ai[k] = i2;
    }
    pf.transform(ar, ai, true);
    // e_tau via sliding window
    let et = e0;
    let running = 0;
    dvals[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) {
      const out = p2[s + tau - 1], inn = p2[s + tau - 1 + PW];
      et += inn * inn - out * out;
      const d = e0 + et - (2 * ar[tau]) / M;
      running += d;
      dvals[tau] = running > 0 ? (d * tau) / running : 1;
    }
    let best = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (dvals[tau] < 0.12) {
        while (tau + 1 <= tauMax && dvals[tau + 1] < dvals[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) {
      let mn = Infinity;
      for (let tau = tauMin; tau <= tauMax; tau++) if (dvals[tau] < mn) {
        mn = dvals[tau];
        best = tau;
      }
    }
    let tauF = best;
    if (best > tauMin && best < tauMax) {
      const a = dvals[best - 1], b = dvals[best], c = dvals[best + 1];
      const den = a - 2 * b + c;
      if (den > 0) tauF = best + (0.5 * (a - c)) / den;
    }
    const aper = dvals[best];
    const f0 = pfs / tauF;
    const voiced = aper < 0.2 && f0 >= 40 && f0 <= 1800;
    if (tonal[fi]) tonalPitchFrames++;
    if (voiced) {
      voicedFrames++;
      if (tonal[fi]) tonalVoiced++;
      f0s.push(f0);
      apers.push(aper);
      f0Track.push(f0);
    } else f0Track.push(0);
  }
  const voicedRatio = pitchFramesActive ? voicedFrames / pitchFramesActive : 0;
  const f0Hz = f0s.length >= 3 ? median(f0s) : null;
  const aperMed = apers.length ? median(apers) : null;
  const polyphony = tonalPitchFrames ? clamp01(1 - tonalVoiced / tonalPitchFrames) : 0;

  // Pitch micro-instability within held notes: robust spread of each frame around a
  // 5-frame running median, ignoring the first/last frames of a note.
  let jitterCents: number | null = null;
  {
    const devs: number[] = [];
    let run: number[] = [];
    const flush = () => {
      if (run.length >= 9) {
        const cents = run.map((f) => 1200 * Math.log2(f));
        for (let i = 4; i < cents.length - 4; i++) devs.push(Math.abs(cents[i] - median(cents.slice(i - 2, i + 3))));
      }
      run = [];
    };
    for (const f of f0Track) {
      if (f > 0 && (!run.length || Math.abs(1200 * Math.log2(f / run[run.length - 1])) < 70)) run.push(f);
      else {
        flush();
        if (f > 0) run.push(f);
      }
    }
    flush();
    if (devs.length >= 6) jitterCents = median(devs) * 1.4826;
  }

  // ---- Tempo -----------------------------------------------------------------------
  const fps = 1 / frameSec;
  const oenv = new Float64Array(nFrames);
  {
    const w = Math.max(2, Math.round(0.5 * fps));
    let acc = 0;
    const pre = new Float64Array(nFrames + 1);
    for (let i = 0; i < nFrames; i++) pre[i + 1] = pre[i] + fluxN[i];
    for (let i = 0; i < nFrames; i++) {
      const a = Math.max(0, i - w), b = Math.min(nFrames, i + w + 1);
      acc = (pre[b] - pre[a]) / (b - a);
      oenv[i] = Math.max(0, fluxN[i] - acc);
    }
  }
  const maxLag = Math.min(nFrames - 1, Math.ceil((60 * fps) / 50) * 4);
  const ac = new Float64Array(maxLag + 2);
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < nFrames; i++) s += oenv[i] * oenv[i + lag];
    ac[lag] = s;
  }
  const ac0 = ac[0] || 1;
  for (let lag = 0; lag <= maxLag; lag++) ac[lag] /= ac0;
  const acAt = (lag: number) => {
    if (lag < 1 || lag >= maxLag) return 0;
    const i = Math.floor(lag), f = lag - i;
    return ac[i] * (1 - f) + ac[i + 1] * f;
  };
  const tempoScore = (bpm: number) => {
    const L = (60 * fps) / bpm;
    let s = acAt(L);
    if (2 * L < maxLag) s += 0.5 * acAt(2 * L);
    if (4 * L < maxLag) s += 0.25 * acAt(4 * L);
    // Most produced music sits around 90-150 BPM; this resolves half/double-time ties.
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.65) ** 2);
    return s * (0.25 + 0.75 * prior);
  };
  let acBpm = 0, acBest = 0;
  const allScores: number[] = [];
  for (let bpm = 60; bpm <= 190; bpm += 0.5) {
    const sc = tempoScore(bpm);
    allScores.push(sc);
    if (sc > acBest) {
      acBest = sc;
      acBpm = bpm;
    }
  }
  const scoreMed = median(allScores);
  const rhythmic = onsets.length >= 4 && acBest > 0;
  let tempoConf = rhythmic ? clamp01((acBest - scoreMed) / (acBest + 1e-9)) * clamp01((onsets.length - 2) / 8) : 0;
  let bpm: number | null = rhythmic ? acBpm : null;
  let bars: number | null = null;
  let loopFit = false;

  if (duration >= 1.2) {
    let bestFit: { bpm: number; beats: number; score: number } | null = null;
    for (const beats of [4, 8, 16, 32, 64, 128, 12, 24, 48]) {
      const b = (60 * beats) / duration;
      if (b < 60 || b > 190) continue;
      // Without rhythm to go on, prefer power-of-two bar counts nearest 120 BPM.
      const sc = rhythmic
        ? tempoScore(b) * (beats % 3 === 0 ? 0.85 : 1)
        : beats % 3 === 0 ? 0 : 1 / (1 + Math.abs(Math.log2(b / 120)));
      if (!bestFit || sc > bestFit.score) bestFit = { bpm: b, beats, score: sc };
    }
    if (bestFit) {
      const integerish = Math.abs(bestFit.bpm - Math.round(bestFit.bpm)) < 0.03;
      const near = (a: number, b: number) => Math.abs(a / b - 1) < 0.035;
      const agrees = rhythmic && (near(bestFit.bpm, acBpm) || near(bestFit.bpm, acBpm * 2) || near(bestFit.bpm, acBpm / 2));
      if (rhythmic && (agrees || (integerish && bestFit.score > acBest * 0.6))) {
        bpm = bestFit.bpm;
        loopFit = true;
        tempoConf = Math.max(tempoConf, integerish ? 0.85 : 0.7);
      } else if (!rhythmic && integerish && duration <= 64 && bestFit.bpm >= 75 && bestFit.bpm <= 165) {
        // Exactly N bars at a whole-number tempo is rarely an accident.
        bpm = bestFit.bpm;
        loopFit = tonalFrac > 0.5;
        // Enough to sync a pad bed to the board, still shown as a guess.
        tempoConf = loopFit ? 0.45 : 0.3;
      }
    }
  }
  if (bpm) {
    while (bpm < 70) bpm *= 2;
    while (bpm >= 180) bpm /= 2;
  }
  if (hints.bpm) {
    bpm = hints.bpm;
    tempoConf = 0.95;
  }
  if (bpm) {
    if (Math.abs(bpm - Math.round(bpm)) < 0.06) bpm = Math.round(bpm);
    else bpm = Math.round(bpm * 10) / 10;
    const b = (duration * bpm) / 240;
    const rb = b < 0.75 ? 0.5 : Math.round(b);
    if (Math.abs(b - rb) / rb < 0.02) bars = rb;
    if (bars && hints.bpm && tonalFrac > 0.3) loopFit = true;
  }

  // ---- Clip kind ------------------------------------------------------------------
  let kind: ClipKind;
  if (duration < 2.5 && onsets.length <= 2) kind = 'oneshot';
  else if (duration > 50) kind = 'song';
  else if (loopFit && bars) kind = 'loop';
  else kind = 'phrase';
  if (hints.kind === 'loop' && duration >= 1) kind = 'loop';
  if (hints.kind === 'oneshot' && duration < 6) kind = 'oneshot';
  if (kind === 'oneshot' && !hints.bpm) {
    bpm = null;
    bars = null;
    tempoConf = 0;
  }

  // ---- Distortion ---------------------------------------------------------------
  let rmsActive = 0;
  {
    let sq = 0, n = 0;
    for (let i = 0; i < nFrames; i++) if (active[i]) {
      sq += energy[i];
      n++;
    }
    // One-sided Hann-windowed energy with this scaling is ~3x the mean square.
    rmsActive = n ? Math.sqrt(sq / n / 3) : 0;
  }
  const monoPeak = colPeak.reduce((a, b) => Math.max(a, b), 0);
  const crestDb = rmsActive > 0 ? toDb(monoPeak / rmsActive) : 0;
  const sCrest = ss(11, 5, crestDb);
  const sDense = ss(0.04, 0.22, hfFlatMean);
  const sSlope = ss(-8, -1.5, slope);
  const sClip = ss(0.00003, 0.002, clipRatio);
  const isTonal = tonalFrac > 0.35;
  // A sine has a low crest factor too; distortion implies added harmonics.
  const richness = f0Hz && voicedRatio > 0.4 ? ss(1.6, 4, centroidHz / f0Hz) : 1;
  const distortion = clamp01(
    (isTonal ? 0.45 * sCrest + 0.15 * sDense + 0.2 * sSlope + 0.2 * sClip : 0.5 * sCrest + 0.2 * sSlope + 0.3 * sClip) *
      (0.3 + 0.7 * richness),
  );
  let character: Character = distortion < 0.4 ? 'clean' : distortion < 0.56 ? 'driven' : 'distorted';
  let charConf = 0.35 + Math.min(Math.abs(distortion - 0.4), Math.abs(distortion - 0.56)) * 1.6;

  // ---- Repetition of drum hits (machines repeat exactly) -----------------------
  let repeatSim: number | null = null;
  if (onsets.length >= 6) {
    const vecs = onsets.slice(0, 64).map((o) => {
      const fr = Math.min(nFrames - 1, o + 1);
      return Array.from(bandVec.subarray(fr * NB, fr * NB + NB));
    });
    const norm = (v: number[]) => {
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      const c = v.map((x) => x - m);
      const n = Math.sqrt(c.reduce((a, b) => a + b * b, 0)) || 1;
      return c.map((x) => x / n);
    };
    const nv = vecs.map(norm);
    const best: number[] = [];
    for (let i = 0; i < nv.length; i++) {
      let mx = -1;
      for (let j = 0; j < nv.length; j++) {
        if (i === j) continue;
        let d = 0;
        for (let k = 0; k < NB; k++) d += nv[i][k] * nv[j][k];
        if (d > mx) mx = d;
      }
      best.push(mx);
    }
    repeatSim = median(best);
  }

  // ---- Acoustic vs electronic ----------------------------------------------------------
  const cues: [number, number][] = [];
  if (jitterCents !== null) cues.push([ss(5, 1.2, jitterCents), 0.35]);
  if (aperMed !== null && voicedRatio > 0.3) cues.push([ss(0.09, 0.02, aperMed), 0.12]);
  const zeroFrac = len ? exactZeros / len : 0;
  if (zeroFrac > 0.01 || floorDb < -105) cues.push([1, 0.25]);
  else if (floorDb > -85 && floorDb < -35 && blockDb.length > 20) cues.push([0.15, 0.2]);
  if (subPct > 0.12) cues.push([ss(0.12, 0.4, subPct), 0.15]);
  if (repeatSim !== null && tonalFrac < 0.5) cues.push([ss(0.96, 0.995, repeatSim), 0.3]);
  const cueWeight = cues.reduce((a, [, w]) => a + w, 0);
  const electronic = cueWeight ? cues.reduce((a, [v, w]) => a + v * w, 0) / cueWeight : 0.5;
  let source: Source = electronic > 0.6 ? 'electronic' : electronic < 0.4 ? 'acoustic' : 'hybrid';
  let sourceConf = Math.min(0.72, 0.15 + Math.abs(electronic - 0.5) * 1.2 * Math.min(1, cueWeight / 0.5));

  // ---- Role ---------------------------------------------------------------------
  const f0 = f0Hz ?? 0;
  const hasPitch = f0Hz !== null && voicedRatio > 0.2;
  const shortLowHit = kind === 'oneshot' && noteLen < 0.7 && lowPct > 0.4 && (envelope === 'hit' || envelope === 'pluck');
  const scores: Record<Role, number> = {
    drums:
      0.35 * percussive +
      0.2 * ss(1.2, 4, onsetRate) +
      0.15 * ss(0.03, 0.2, flatMean) +
      0.15 * (1 - tonalFrac) +
      0.15 * (repeatSim !== null ? ss(0.9, 0.99, repeatSim) : 0) +
      (shortLowHit ? 0.45 : 0),
    bass:
      0.35 * ss(0.35, 0.75, lowPct) * (1 - ss(0.6, 1, coverage) * ss(15, 40, duration)) +
      0.5 * (hasPitch ? ss(200, 110, f0) * ss(0.15, 0.5, voicedRatio) : 0) +
      0.15 * (1 - ss(0.04, 0.2, highPct)) -
      0.5 * percussive * ss(1, 3, onsetRate) -
      (shortLowHit ? 0.35 : 0),
    lead:
      0.35 * ss(0.3, 0.7, voicedRatio) +
      0.25 * (hasPitch ? ss(170, 280, f0) * ss(2200, 1300, f0) : 0) +
      0.2 * (1 - polyphony) * tonalFrac +
      0.2 * (onsetRate > 0.4 && onsetRate < 8 ? 1 : 0.3) -
      0.35 * ss(0.4, 0.7, lowPct),
    pad:
      0.35 * (envelope === 'swell' ? 1 : envelope === 'sustain' ? 0.6 : 0.05) +
      0.25 * ss(1.6, 0.3, onsetRate) +
      0.2 * polyphony * tonalFrac +
      0.1 * width +
      0.1 * ss(0.2, 0.6, tonalFrac) -
      0.3 * ss(0.4, 0.7, lowPct),
    chords:
      0.35 * polyphony * ss(0.25, 0.7, tonalFrac) +
      0.25 * (envelope === 'pluck' || envelope === 'sustain' ? 1 : envelope === 'hit' ? 0.5 : 0.2) +
      0.2 * ss(0.15, 0.8, onsetRate) * ss(7, 2.5, onsetRate) +
      0.2 * ss(0.3, 0.7, tonalFrac) -
      0.25 * ss(0.4, 0.7, lowPct),
    vocal:
      0.3 * ss(0.3, 0.7, voicedRatio) +
      0.3 * (jitterCents !== null ? ss(5, 16, jitterCents) : 0) +
      0.2 * (hasPitch ? ss(85, 150, f0) * ss(1100, 650, f0) : 0) +
      0.2 * (1 - electronic) -
      0.2 * ss(0.4, 0.7, lowPct),
    fx:
      0.35 * ss(0.12, 0.42, flatMean) +
      0.25 * ss(1.2, 0.2, onsetRate) +
      0.2 * ss(0.8, 2.5, centroidSpread) +
      0.2 * (1 - voicedRatio),
    mix:
      duration > 15
        ? 0.35 * ss(15, 45, duration) +
          0.3 * ss(0.55, 1, coverage) +
          0.2 * ss(0.5, 2, onsetRate) +
          0.15 * ss(0.15, 0.5, polyphony + flatMean)
        : 0,
    other: 0.2,
  };
  const ranked = (Object.entries(scores) as [Role, number][]).sort((a, b) => b[1] - a[1]);
  let role: Role = silent ? 'other' : ranked[0][0];
  let roleConf = silent ? 0 : Math.max(0.2, Math.min(0.8, 0.3 + (ranked[0][1] - ranked[1][1]) * 1.8));

  // ---- Brightness, relative to what the role usually sounds like ---------------------
  const expected: Record<Role, number> = {
    bass: 350, drums: 2600, lead: 1900, pad: 1300, chords: 1500, vocal: 1700, fx: 2600, mix: 2100, other: 1600,
  };
  const relBright = centroidHz > 0 ? clamp01(0.5 + Math.log2(centroidHz / expected[role]) / 2.4) : 0.5;
  let brightness: Brightness = relBright < 0.36 ? 'dark' : relBright > 0.64 ? 'bright' : 'balanced';
  const brightConf = 0.5 + Math.min(0.35, Math.abs(relBright - 0.5));

  // ---- Key / root -------------------------------------------------------------------
  let keyStr: string | null = null;
  let keyConf = 0;
  let rootStr: string | null = null;
  let rootConf = 0;
  const keyable = !silent && kind !== 'oneshot' && role !== 'drums' && tonalFrac > 0.2;
  if (keyable) {
    const det = detectKey(chroma);
    if (det) {
      keyStr = keyName(det.key);
      keyConf = det.conf * ss(0.2, 0.6, tonalFrac);
      if (hints.rootOnly !== undefined) {
        keyStr = keyName({ root: hints.rootOnly, mode: det.key.root === hints.rootOnly ? det.key.mode : 'minor' });
        keyConf = 0.7;
      }
    }
  }
  if (keyConf < 0.15) keyStr = null;
  if (hints.key) {
    const hk = keyName(hints.key);
    keyConf = hk === keyStr ? 0.99 : 0.95;
    keyStr = hk;
  }
  if (kind === 'oneshot' && hasPitch && voicedRatio > 0.45) {
    rootStr = midiToName(Math.round(hzToMidi(f0)));
    rootConf = ss(0.45, 0.85, voicedRatio) * 0.9;
  }

  // ---- File-name hints win where present ---------------------------------------
  if (hints.role) {
    role = hints.role;
    roleConf = 0.95;
  }
  let sourceSrc: TagValue<Source>['src'] = 'auto';
  if (hints.source) {
    source = hints.source;
    sourceConf = 0.9;
    sourceSrc = 'file';
  }
  let charSrc: TagValue<Character>['src'] = 'auto';
  if (hints.character) {
    character = hints.character;
    charConf = 0.9;
    charSrc = 'file';
  }
  let brightSrc: TagValue<Brightness>['src'] = 'auto';
  let bConf = brightConf;
  if (hints.brightness) {
    brightness = hints.brightness;
    bConf = 0.85;
    brightSrc = 'file';
  }
  let envSrc: TagValue<Envelope>['src'] = 'auto';
  let eConf = envConf;
  if (hints.envelope) {
    envelope = hints.envelope;
    eConf = 0.9;
    envSrc = 'file';
  }

  const tags: SoundTags = {
    role: tag(role, roleConf, hints.role ? 'file' : 'auto'),
    source: tag(source, sourceConf, sourceSrc),
    character: tag(character, charConf, charSrc),
    brightness: tag(brightness, bConf, brightSrc),
    envelope: tag(envelope, eConf, envSrc),
    kind: tag(kind, hints.kind ? 0.9 : kind === 'loop' ? Math.max(0.5, tempoConf) : 0.75, hints.kind ? 'file' : 'auto'),
    key: tag(keyStr, keyConf, hints.key ? 'file' : 'auto'),
    bpm: tag(bpm, tempoConf, hints.bpm ? 'file' : 'auto'),
    root: tag(rootStr, rootConf),
    extra: [],
  };

  // ---- Encode peaks ------------------------------------------------------------------
  const bytes = new Uint8Array(cols * 3);
  const colBright = new Float64Array(cols).fill(-1);
  {
    const sumB = new Float64Array(cols), wB = new Float64Array(cols);
    for (let i = 0; i < nFrames; i++) {
      const t = i * frameSec;
      const c = Math.floor((t / Math.max(duration, 1e-6)) * cols);
      if (c < 0 || c >= cols || centroid[i] <= 0) continue;
      const w = Math.sqrt(energy[i]) + 1e-9;
      sumB[c] += w * Math.log2(Math.max(150, centroid[i]) / 150);
      wB[c] += w;
    }
    for (let c = 0; c < cols; c++) if (wB[c] > 0) colBright[c] = sumB[c] / wB[c] / Math.log2(6000 / 150);
    // Fill gaps (short clips have fewer frames than columns).
    let last = -1;
    for (let c = 0; c < cols; c++) {
      if (colBright[c] >= 0) {
        if (last < 0) for (let j = 0; j < c; j++) colBright[j] = colBright[c];
        else for (let j = last + 1; j < c; j++) colBright[j] = colBright[last] + ((colBright[c] - colBright[last]) * (j - last)) / (c - last);
        last = c;
      }
    }
    if (last < 0) colBright.fill(0.4);
    else for (let j = last + 1; j < cols; j++) colBright[j] = colBright[last];
  }
  const norm = monoPeak > 0 ? 1 / monoPeak : 0;
  for (let c = 0; c < cols; c++) {
    bytes[c * 3] = Math.round(clamp01(colPeak[c] * norm) * 255);
    bytes[c * 3 + 1] = Math.round(clamp01(colRms[c] * norm) * 255);
    bytes[c * 3 + 2] = Math.round(clamp01(colBright[c]) * 255);
  }

  const r2 = (v: number) => Math.round(v * 100) / 100;
  const analysis: AudioAnalysis = {
    version: ANALYSIS_VERSION,
    duration: r2(duration),
    peakDb: r2(toDb(peak)),
    rmsDb: r2(toDb(rmsActive)),
    crestDb: r2(crestDb),
    centroidHz: Math.round(centroidHz),
    flatness: r2(flatMean),
    lowPct: r2(lowPct),
    midPct: r2(midPct),
    highPct: r2(highPct),
    width: r2(width),
    onsetRate: r2(onsetRate),
    attackMs: Math.round(attackMs),
    sustain: r2(sustain),
    f0Hz: f0Hz ? Math.round(f0Hz * 10) / 10 : null,
    voiced: r2(voicedRatio),
    jitterCents: jitterCents !== null ? r2(jitterCents) : null,
    polyphony: r2(polyphony),
    bars,
    distortion: r2(distortion),
    electronic: r2(electronic),
    envShape,
    ms: Date.now() - started,
  };

  return { peaks: toBase64(bytes), analysis, tags };
}
