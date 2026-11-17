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

export interface Recording {
  stop(): Promise<{ file: File; seconds: number }>;
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
    for (const v of chs[0]) {
      const a = Math.abs(v);
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
    async stop() {
      cleanup();
      const nCh = Math.min(2, chunks[0]?.length ?? 1);
      // Dual-mono interfaces report two identical channels; keep those as mono.
      let channels = Array.from({ length: nCh }, () => new Float32Array(frames));
      let o = 0;
      for (const c of chunks) {
        for (let ch = 0; ch < nCh; ch++) channels[ch].set(c[ch] ?? c[0], o);
        o += c[0].length;
      }
      if (nCh === 2) {
        let diff = 0;
        for (let i = 0; i < frames; i += 7) diff += Math.abs(channels[0][i] - channels[1][i]);
        if (diff / Math.max(1, frames / 7) < 1e-5) channels = [channels[0]];
      }
      const stamp = new Date();
      const name = `Voice memo ${stamp.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${stamp
        .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        .replace(':', '.')}.wav`;
      const blob = encodeWav(channels, ctx.sampleRate, 24);
      return { file: new File([blob], name, { type: 'audio/wav' }), seconds: frames / ctx.sampleRate };
    },
    cancel: cleanup,
    level: () => recentPeak,
    peaks: () => peakHistory,
    seconds: () => frames / ctx.sampleRate,
  };
}
