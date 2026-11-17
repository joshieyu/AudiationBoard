import { analyzeAudio } from './dsp/analyze.ts';
import { wsola } from './dsp/stretch.ts';

type Req =
  | { id: number; kind: 'analyze'; channels: Float32Array[]; sampleRate: number; name: string }
  | { id: number; kind: 'stretch'; channels: Float32Array[]; sampleRate: number; factor: number; circular: boolean };

const post = (msg: unknown, transfer: Transferable[] = []) =>
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<Req>) => {
  const req = e.data;
  try {
    if (req.kind === 'analyze') {
      post({ id: req.id, ok: true, result: analyzeAudio(req.channels, req.sampleRate, req.name) });
    } else if (req.kind === 'stretch') {
      const out = wsola(req.channels, req.sampleRate, req.factor, req.circular);
      post({ id: req.id, ok: true, result: out }, out.map((c) => c.buffer as ArrayBuffer));
    }
  } catch (err) {
    post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
