import { useEffect, useMemo, useRef } from 'react';
import type { Character, Role, Source } from '../../shared/types';
import { roleRgb, type Theme } from '../lib/colors';
import { useTheme } from '../lib/theme';

export function decodePeaks(b64: string | undefined): Uint8Array | null {
  if (!b64) return null;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

interface Style {
  role: Role;
  source: Source;
  character: Character;
}

/**
 * Draws a mirrored waveform whose look encodes the sound:
 *  - hue: role
 *  - lightness per column: local spectral brightness
 *  - acoustic = smooth curve, electronic = stepped bars, hybrid = rounded bars
 *  - driven/distorted = flattened (clipped) tops with a hot edge
 */
export function drawWaveform(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  peaks: Uint8Array,
  style: Style,
  theme: Theme,
  played: boolean,
) {
  ctx.clearRect(0, 0, w, h);
  const n = peaks.length / 3;
  if (!n || w <= 0 || h <= 0) return;
  const mid = h / 2;
  const clip = style.character === 'distorted' ? 0.72 : style.character === 'driven' ? 0.88 : 1;
  const shape = (v: number) => {
    // Gentle expansion so quiet detail stays visible, then clip for drive.
    const e = Math.pow(v, 0.75);
    return Math.min(e, clip) / clip;
  };
  // Light backgrounds need darker, denser ink to read at a glance.
  const baseL = theme === 'dark' ? 0.5 : 0.4;
  const spanL = theme === 'dark' ? 0.36 : 0.24;
  const alphaOuter = played ? 0.55 : theme === 'dark' ? 0.2 : 0.3;
  const alphaInner = played ? 1 : theme === 'dark' ? 0.42 : 0.62;
  const colour = (bright: number, a: number, lift = 0) => {
    const [r, g, b] = roleRgb(style.role, Math.min(0.97, baseL + spanL * bright + lift), played ? 1 : 0.8);
    return `rgba(${r},${g},${b},${a})`;
  };

  const sample = (x0: number, x1: number) => {
    const a = Math.floor((x0 / w) * n), b = Math.max(a + 1, Math.ceil((x1 / w) * n));
    let pk = 0, rms = 0, br = 0, c = 0;
    for (let i = a; i < b && i < n; i++) {
      pk = Math.max(pk, peaks[i * 3]);
      rms = Math.max(rms, peaks[i * 3 + 1]);
      br += peaks[i * 3 + 2];
      c++;
    }
    return { pk: pk / 255, rms: rms / 255, br: c ? br / c / 255 : 0.4 };
  };

  if (style.source === 'acoustic') {
    // Smooth, continuous mirrored curve.
    const step = 2;
    const cols: { x: number; pk: number; rms: number; br: number }[] = [];
    for (let x = 0; x <= w; x += step) cols.push({ x, ...sample(x, x + step) });
    const smooth = (key: 'pk' | 'rms') =>
      cols.map((c, i) => {
        const p = cols[i - 1]?.[key] ?? c[key], q = cols[i + 1]?.[key] ?? c[key];
        return (p + 2 * c[key] + q) / 4;
      });
    const pk = smooth('pk'), rm = smooth('rms');
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i < cols.length; i += Math.max(1, Math.floor(cols.length / 48))) grad.addColorStop(cols[i].x / w, colour(cols[i].br, alphaOuter));
    const gradIn = ctx.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i < cols.length; i += Math.max(1, Math.floor(cols.length / 48))) gradIn.addColorStop(cols[i].x / w, colour(cols[i].br, alphaInner));
    const path = (vals: number[], scale: number) => {
      ctx.beginPath();
      ctx.moveTo(0, mid);
      for (let i = 0; i < cols.length; i++) ctx.lineTo(cols[i].x, mid - shape(vals[i]) * mid * scale);
      for (let i = cols.length - 1; i >= 0; i--) ctx.lineTo(cols[i].x, mid + shape(vals[i]) * mid * scale);
      ctx.closePath();
    };
    path(pk, 0.96);
    ctx.fillStyle = grad;
    ctx.fill();
    path(rm, 0.96);
    ctx.fillStyle = gradIn;
    ctx.fill();
  } else {
    const electronic = style.source === 'electronic';
    const bar = electronic ? 2 : 3;
    const gap = electronic ? 1 : 1.5;
    const pitch = bar + gap;
    ctx.lineCap = electronic ? 'butt' : 'round';
    for (let x = 0; x < w; x += pitch) {
      const s = sample(x, x + pitch);
      let hPk = shape(s.pk) * mid * 0.96;
      let hRms = shape(s.rms) * mid * 0.96;
      if (electronic) {
        // Quantise heights for a stepped, digital read.
        const q = Math.max(2, h / 22);
        hPk = Math.max(1, Math.round(hPk / q) * q);
        hRms = Math.max(1, Math.round(hRms / q) * q);
      }
      ctx.fillStyle = colour(s.br, alphaOuter);
      if (electronic) ctx.fillRect(x, mid - hPk, bar, hPk * 2);
      else roundBar(ctx, x, mid - hPk, bar, hPk * 2);
      ctx.fillStyle = colour(s.br, alphaInner);
      if (electronic) ctx.fillRect(x, mid - hRms, bar, hRms * 2);
      else roundBar(ctx, x, mid - hRms, bar, hRms * 2);
      // Hot edge where the signal is clipped.
      if (style.character !== 'clean' && s.pk > 0.05 && Math.pow(s.pk, 0.75) >= clip * 0.98) {
        ctx.fillStyle = colour(1, played ? 0.95 : 0.5, 0.08);
        ctx.fillRect(x, mid - hPk, bar, 1.5);
        ctx.fillRect(x, mid + hPk - 1.5, bar, 1.5);
      }
    }
  }

  if (style.character === 'distorted' && style.source === 'acoustic') {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = colour(1, played ? 0.25 : 0.12, 0.1);
    ctx.fillRect(0, 0, w, 2);
    ctx.fillRect(0, h - 2, w, 2);
    ctx.globalCompositeOperation = 'source-over';
  }
}

function roundBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const r = Math.min(w / 2, h / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, w, Math.max(h, 1), r);
  ctx.fill();
}

/**
 * Two stacked canvases (dim + bright). Playback progress only moves a clip-path,
 * so the waveform is drawn once per size/theme change.
 */
export function Waveform({
  peaks,
  style,
  progressRef,
  className = '',
}: {
  peaks: string | undefined;
  style: Style;
  progressRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const hot = useRef<HTMLCanvasElement>(null);
  const theme = useTheme((s) => s.theme);
  const data = useMemo(() => decodePeaks(peaks), [peaks]);

  useEffect(() => {
    const el = wrap.current;
    if (!el || !data) return;
    const draw = () => {
      const w = el.clientWidth, h = el.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      for (const [c, played] of [
        [base.current, false],
        [hot.current, true],
      ] as const) {
        if (!c) continue;
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
        const ctx = c.getContext('2d')!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawWaveform(ctx, w, h, data, style, theme, played);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data, style.role, style.source, style.character, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={wrap} className={`wave ${className}`}>
      <canvas ref={base} className="wave-base" />
      <div ref={progressRef} className="wave-played" style={{ clipPath: 'inset(0 100% 0 0)' }}>
        <canvas ref={hot} />
      </div>
    </div>
  );
}
