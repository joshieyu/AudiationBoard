import { useEffect, useRef } from 'react';
import type { MidiSummary, Role } from '../../shared/types';
import { roleRgb } from '../lib/colors';
import { useTheme } from '../lib/theme';

/** Piano-roll preview of a MIDI clip, in the role's colour, velocity as lightness. */
export function PianoRoll({ summary, role, progressRef }: { summary: MidiSummary; role: Role; progressRef?: React.RefObject<HTMLDivElement | null> }) {
  const wrap = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const hot = useRef<HTMLCanvasElement>(null);
  const theme = useTheme((s) => s.theme);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const draw = () => {
      const w = el.clientWidth, h = el.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const notes = summary.notes;
      const drumRows = new Map<number, number>();
      let lo = summary.pitchMin, hi = summary.pitchMax;
      for (let i = 0; i < notes.length; i += 4) if (notes[i + 2] < 0 && !drumRows.has(-notes[i + 2])) drumRows.set(-notes[i + 2], drumRows.size);
      if (summary.drums) {
        lo = 0;
        hi = Math.max(1, drumRows.size - 1);
      }
      lo -= 2;
      hi += 2;
      const range = Math.max(12, hi - lo + 1);
      const rowH = h / range;
      const bx = w / Math.max(1, summary.beats);
      const beatsPerBar = (summary.timeSig[0] * 4) / summary.timeSig[1];

      for (const [c, played] of [
        [base.current, false],
        [hot.current, true],
      ] as const) {
        if (!c) continue;
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
        const ctx = c.getContext('2d')!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        // Bar lines.
        ctx.fillStyle = theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
        for (let b = beatsPerBar; b < summary.beats; b += beatsPerBar) ctx.fillRect(Math.round(b * bx), 0, 1, h);
        for (let i = 0; i < notes.length; i += 4) {
          const s = notes[i], l = notes[i + 1], n = notes[i + 2], v = notes[i + 3] / 127;
          const pitch = n < 0 ? (summary.drums ? drumRows.get(-n)! : -n) : n;
          const y = h - (pitch - lo + 1) * rowH;
          const x = s * bx;
          const nw = n < 0 ? Math.max(2, Math.min(4, rowH)) : Math.max(1.5, l * bx - 0.75);
          const L = theme === 'dark' ? 0.5 + v * 0.32 : 0.45 + v * 0.22;
          const [r, g, b] = roleRgb(role, L, played ? 1 : 0.75);
          ctx.fillStyle = `rgba(${r},${g},${b},${played ? 1 : theme === 'dark' ? 0.45 : 0.55})`;
          const nh = Math.max(1.5, rowH - (rowH > 4 ? 1 : 0));
          ctx.beginPath();
          ctx.roundRect(x, y, nw, nh, Math.min(2, nh / 2));
          ctx.fill();
        }
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [summary, role, theme]);

  return (
    <div ref={wrap} className="wave roll">
      <canvas ref={base} className="wave-base" />
      <div ref={progressRef} className="wave-played" style={{ clipPath: 'inset(0 100% 0 0)' }}>
        <canvas ref={hot} />
      </div>
    </div>
  );
}
