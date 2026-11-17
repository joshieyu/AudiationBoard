import { encodeWav } from '../lib/wav';
import { engine } from './engine';

const WORKLET = `
class AbRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length) this.port.postMessage(input.map((c) => c.slice(0)));
    return true;
  }
}
registerProcessor('ab-recorder', AbRecorder);
`;

let workletReady: Promise<void> | null = null;

/**
 * Which input channels to keep. Interfaces send mic input 1 on the left and input 2 on
 * the right of a stereo stream, so a single mic arrives hard-panned.
 */
export type ChannelMode = 'auto' | 'left' | 'right' | 'stereo';

export interface Recording {
  stop(mode?: ChannelMode): Promise<{ file: File; seconds: number; channels: 'mono' | 'stereo' }>;
  cancel(): void;
  /** Recent peak level 0..1 */
  level(): number;
  /** Last ~4 s of peaks for a live waveform. */
  peaks(): number[];
  seconds(): number;
}

export async function startRecording(opts: { metronomeBpm?: number | null } = {}): Promise<Recording> {
  const ctx = engine.ctx;
  await engine.resume();
  const stream = await navigator.mediaDevices.getUserMedia({
    // Music, not a call: keep the raw signal.
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } },
  });
  if (!workletReady) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    workletReady = ctx.audioWorklet.addModule(url);
  }
  await workletReady;

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'ab-recorder', { numberOfInputs: 1, numberOfOutputs: 0 });
  source.connect(node);

  const chunks: Float32Array[][] = [];
  let frames = 0;
  let recentPeak = 0;
  const peakHistory: number[] = [];
  let blockPeak = 0, blockN = 0;
  const blockSize = Math.round(ctx.sampleRate * 0.02);
  node.port.onmessage = (e: MessageEvent<Float32Array[]>) => {
    const chs = e.data;
    chunks.push(chs);
    frames += chs[0].length;
    const right = chs[1] ?? chs[0];
    for (let i = 0; i < chs[0].length; i++) {
      // Meter whichever side the signal is on.
      const a = Math.max(Math.abs(chs[0][i]), Math.abs(right[i]));
      if (a > blockPeak) blockPeak = a;
      if (++blockN >= blockSize) {
        peakHistory.push(blockPeak);
        if (peakHistory.length > 200) peakHistory.shift();
        recentPeak = Math.max(blockPeak, recentPeak * 0.85);
        blockPeak = 0;
        blockN = 0;
      }
    }
  };

  // Optional click at the board tempo (heard, not recorded).
  let clickTimer: ReturnType<typeof setInterval> | null = null;
  if (opts.metronomeBpm) {
    const spb = 60 / opts.metronomeBpm;
    let next = ctx.currentTime + 0.05;
    let beat = 0;
    clickTimer = setInterval(() => {
      while (next < ctx.currentTime + 0.12) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = beat % 4 === 0 ? 1760 : 1320;
        g.gain.setValueAtTime(0.25, next);
        g.gain.exponentialRampToValueAtTime(0.001, next + 0.05);
        o.connect(g).connect(ctx.destination);
        o.start(next);
        o.stop(next + 0.06);
        next += spb;
        beat++;
      }
    }, 25);
  }

  const cleanup = () => {
    if (clickTimer) clearInterval(clickTimer);
    node.port.onmessage = null;
    source.disconnect();
    node.disconnect();
    stream.getTracks().forEach((t) => t.stop());
  };

  return {
    async stop(mode: ChannelMode = 'auto') {
      cleanup();
      const nCh = Math.min(2, chunks[0]?.length ?? 1);
      let channels: Float32Array[] = Array.from({ length: nCh }, () => new Float32Array(frames));
      let o = 0;
      for (const c of chunks) {
        for (let ch = 0; ch < nCh; ch++) channels[ch].set(c[ch] ?? c[0], o);
        o += c[0].length;
      }
      if (nCh === 2) channels = pickChannels(channels[0], channels[1], mode);
      const stamp = new Date();
      const name = `Voice memo ${stamp.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${stamp
        .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        .replace(':', '.')}.wav`;
      const blob = encodeWav(channels, ctx.sampleRate, 24);
      return { file: new File([blob], name, { type: 'audio/wav' }), seconds: frames / ctx.sampleRate, channels: channels.length === 1 ? 'mono' : 'stereo' };
    },
    cancel: cleanup,
    level: () => recentPeak,
    peaks: () => peakHistory,
    seconds: () => frames / ctx.sampleRate,
  };
}

/**
 * Auto keeps stereo only when both sides carry their own signal. A side that's silent
 * (a single mic on input 1 or 2) or a copy of the other (dual mono) becomes one
 * centered mono channel.
 */
export function pickChannels(l: Float32Array, r: Float32Array, mode: ChannelMode): Float32Array[] {
  if (mode === 'left') return [l];
  if (mode === 'right') return [r];
  if (mode === 'stereo') return [l, r];
  let el = 0, er = 0, diff = 0;
  for (let i = 0; i < l.length; i += 4) {
    el += l[i] * l[i];
    er += r[i] * r[i];
    const d = l[i] - r[i];
    diff += d * d;
  }
  const loud = Math.max(el, er);
  if (loud === 0) return [l];
  // About 30 dB down: noise floor or crosstalk, not a second source.
  if (Math.min(el, er) < loud / 1000) return [el >= er ? l : r];
  if (diff < loud / 1e5) return [l];
  return [l, r];
}
