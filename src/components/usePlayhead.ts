import { useEffect } from 'react';
import { engine, usePlayback } from '../audio/engine';

/** Drives a clip-path progress overlay and playhead line while a clip plays. */
export function usePlayhead(
  id: string,
  progress: React.RefObject<HTMLDivElement | null>,
  head: React.RefObject<HTMLDivElement | null>,
  time?: React.RefObject<HTMLSpanElement | null>,
) {
  const playing = usePlayback((s) => !!s.playing[id]);
  useEffect(() => {
    const set = (pct: number, show: boolean) => {
      if (progress.current) progress.current.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
      if (head.current) {
        head.current.style.left = `${pct}%`;
        head.current.style.opacity = show ? '1' : '0';
      }
    };
    if (!playing) {
      set(0, false);
      if (time?.current) time.current.textContent = '';
      return;
    }
    let raf = 0;
    const tick = () => {
      const p = engine.position(id);
      if (p) {
        const pct = p.duration ? (p.pos / p.duration) * 100 : 0;
        set(pct, true);
        if (time?.current) time.current.textContent = fmtTime(p.pos);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, id, progress, head, time]);
}

export function fmtTime(s: number) {
  if (!Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return s < 10 ? `${sec.toFixed(1)}s` : `${m}:${Math.floor(sec).toString().padStart(2, '0')}`;
}
