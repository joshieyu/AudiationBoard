import type { AnalyzeOutput } from './dsp/analyze.ts';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, ok, result, error } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (ok) p.resolve(result);
      else p.reject(new Error(error));
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'Analysis worker crashed'));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

function call<T>(msg: Record<string, unknown>, transfer: Transferable[]): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    getWorker().postMessage({ ...msg, id }, transfer);
  });
}

function copyChannels(buf: AudioBuffer) {
  return Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i).slice());
}

export function analyzeBuffer(buf: AudioBuffer, name: string) {
  const channels = copyChannels(buf);
  return call<AnalyzeOutput>(
    { kind: 'analyze', channels, sampleRate: buf.sampleRate, name },
    channels.map((c) => c.buffer),
  );
}

export function stretchBuffer(buf: AudioBuffer, factor: number, circular: boolean) {
  const channels = copyChannels(buf);
  return call<Float32Array[]>(
    { kind: 'stretch', channels, sampleRate: buf.sampleRate, factor, circular },
    channels.map((c) => c.buffer),
  );
}
