import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { AnyItem } from '../../shared/types';
import { sendCursor, sendCursorOut } from '../lib/sync';
import { addFiles, addFromText, addLink, addText } from '../store/actions';
import { select, useBoard, useCamera } from '../store/board';
import { pinch, setGesturing } from '../store/gesture';
import { CardFrame } from './CardFrame';
import { AudioCard } from './cards/AudioCard';
import { ImageCard } from './cards/ImageCard';
import { LinkCard } from './cards/LinkCard';
import { MidiCard } from './cards/MidiCard';
import { PendingCard } from './cards/PendingCard';
import { TextCard } from './cards/TextCard';
import { EmptyState } from './EmptyState';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2.5;

export function zoomAt(sx: number, sy: number, factor: number) {
  const c = useCamera.getState();
  const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, c.z * factor));
  const k = z / c.z;
  useCamera.setState({ z, x: sx - (sx - c.x) * k, y: sy - (sy - c.y) * k });
}

function canvasRect() {
  return (document.querySelector('[data-canvas]') as HTMLElement | null)?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
}

export function zoomBy(factor: number) {
  const r = canvasRect();
  zoomAt(r.width / 2, r.height / 2, factor);
}

/** Frame everything (or the given items) in view. */
export function fitToContent(ids?: string[], animate = true) {
  const { items } = useBoard.getState();
  const list = (ids?.length ? ids.map((id) => items[id]).filter(Boolean) : Object.values(items)) as AnyItem[];
  const r = canvasRect();
  if (!list.length) {
    setCamera({ x: r.width / 2, y: r.height / 2, z: 1 }, animate);
    return;
  }
  const minX = Math.min(...list.map((i) => i.x)), minY = Math.min(...list.map((i) => i.y));
  const maxX = Math.max(...list.map((i) => i.x + i.w)), maxY = Math.max(...list.map((i) => i.y + i.h));
  // Albums have a tab strip under the top bar.
  const padX = Math.min(120, r.width * 0.08), padTop = document.body.classList.contains('has-album') ? 128 : 84, padBottom = 110;
  const z = Math.max(MIN_ZOOM, Math.min(1, (r.width - padX * 2) / (maxX - minX), (r.height - padTop - padBottom) / (maxY - minY)));
  setCamera({ z, x: r.width / 2 - ((minX + maxX) / 2) * z, y: padTop + (r.height - padTop - padBottom) / 2 - ((minY + maxY) / 2) * z }, animate);
}

let anim = 0;
export function setCamera(target: { x: number; y: number; z: number }, animate = true) {
  cancelAnimationFrame(anim);
  if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    useCamera.setState(target);
    return;
  }
  const from = { ...useCamera.getState() };
  const t0 = performance.now();
  const step = (t: number) => {
    const p = Math.min(1, (t - t0) / 320);
    const e = 1 - Math.pow(1 - p, 3);
    useCamera.setState({ x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, z: from.z + (target.z - from.z) * e });
    if (p < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}

export function screenToWorld(clientX: number, clientY: number) {
  const r = canvasRect();
  const { x, y, z } = useCamera.getState();
  return { x: (clientX - r.left - x) / z, y: (clientY - r.top - y) / z };
}

const Card = memo(function Card({ item }: { item: AnyItem }) {
  let body;
  switch (item.type) {
    case 'audio': body = <AudioCard item={item} />; break;
    case 'midi': body = <MidiCard item={item} />; break;
    case 'text': body = <TextCard item={item} />; break;
    case 'image': body = <ImageCard item={item} />; break;
    case 'link': body = <LinkCard item={item} />; break;
  }
  return <CardFrame item={item}>{body}</CardFrame>;
});

function Cursors() {
  const cursors = useBoard((s) => s.cursors);
  const peers = useBoard((s) => s.peers);
  const z = useCamera((s) => s.z);
  return (
    <>
      {Object.entries(cursors).map(([id, c]) => {
        const p = peers.find((x) => x.id === id);
        if (!p || Date.now() - c.t > 30_000) return null;
        return (
          <div key={id} className="cursor" style={{ transform: `translate(${c.x}px, ${c.y}px) scale(${1 / z})`, color: p.color, ['--peer' as string]: p.color }}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
              <path d="M2 1.5l13 6.2-5.6 1.7L7 15z" fill="currentColor" stroke="rgba(0,0,0,.35)" strokeWidth="1" strokeLinejoin="round" />
            </svg>
            <span>{p.name}</span>
          </div>
        );
      })}
    </>
  );
}

export function Canvas() {
  const root = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const items = useBoard((s) => s.items);
  const pending = useBoard((s) => s.pending);
  const editable = useBoard((s) => s.access === 'edit');
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [dropping, setDropping] = useState(false);
  const list = useMemo(() => Object.values(items), [items]);

  // Camera -> DOM without re-rendering cards.
  useEffect(() => {
    const apply = (c: { x: number; y: number; z: number }) => {
      if (world.current) world.current.style.transform = `translate3d(${c.x}px, ${c.y}px, 0) scale(${c.z})`;
      if (root.current) {
        let step = 24;
        while (step * c.z < 14) step *= 2;
        const s = step * c.z;
        root.current.style.backgroundSize = `${s}px ${s}px`;
        root.current.style.backgroundPosition = `${c.x}px ${c.y}px`;
        root.current.style.setProperty('--zoom', String(c.z));
      }
    };
    apply(useCamera.getState());
    return useCamera.subscribe(apply);
  }, []);

  // Wheel: trackpad scroll pans, pinch / ⌘-scroll zooms.
  useEffect(() => {
    const el = root.current!;
    const onWheel = (e: WheelEvent) => {
      const t = e.target as HTMLElement;
      const scroller = t.closest('[data-scroll]') as HTMLElement | null;
      if (!e.ctrlKey && !e.metaKey && scroller && scroller.scrollHeight > scroller.clientHeight) {
        // While typing in a note, the wheel belongs to the note even at its ends.
        if (scroller instanceof HTMLTextAreaElement) return;
        const atTop = scroller.scrollTop <= 0 && e.deltaY < 0;
        const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1 && e.deltaY > 0;
        if (!atTop && !atEnd) return;
      }
      if (t.closest('.popover, .panel')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp((-e.deltaY * unit) / (e.ctrlKey && !e.metaKey ? 110 : 300)));
      } else {
        const c = useCamera.getState();
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        useCamera.setState({ x: c.x - dx * unit, y: c.y - dy * unit });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Two-finger pinch/pan anywhere (captures before cards see it).
  useEffect(() => {
    const el = root.current!;
    const touches = new Map<number, { x: number; y: number }>();
    let start: { d: number; mx: number; my: number; cam: { x: number; y: number; z: number } } | null = null;
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        pinch.active = true;
        setGesturing(true);
        start = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cam: { ...useCamera.getState() } };
      }
    };
    const move = (e: PointerEvent) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size !== 2 || !start) return;
      const [a, b] = [...touches.values()];
      const r = el.getBoundingClientRect();
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, start.cam.z * (d / start.d)));
      const k = z / start.cam.z;
      const sx = start.mx - r.left, sy = start.my - r.top;
      useCamera.setState({ z, x: sx - (sx - start.cam.x) * k + (mx - start.mx), y: sy - (sy - start.cam.y) * k + (my - start.my) });
    };
    const up = (e: PointerEvent) => {
      if (!touches.delete(e.pointerId)) return;
      if (touches.size < 2 && start) {
        start = null;
        setTimeout(() => (pinch.active = false), 50);
        setGesturing(false);
      }
    };
    el.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      el.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (pinch.active) return;
    const target = e.target as HTMLElement;
    const onCard = !!target.closest('.frame');
    if (onCard && editable && e.button === 0) return; // cards handle their own drags
    if (target.closest('.panel, .popover, button, a, input, textarea, select')) return;
    const el = root.current!;
    const r = el.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const cam = { ...useCamera.getState() };
    const marqueeMode = editable && e.shiftKey && e.button === 0 && !onCard;
    const baseSel = useBoard.getState().selection;
    let moved = false;
    el.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      if (pinch.active) return;
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) return;
      if (!moved) setGesturing(true);
      moved = true;
      if (marqueeMode) {
        const m = { x0: startX - r.left, y0: startY - r.top, x1: ev.clientX - r.left, y1: ev.clientY - r.top };
        setMarquee(m);
        const { x, y, z } = useCamera.getState();
        const wx0 = (Math.min(m.x0, m.x1) - x) / z, wx1 = (Math.max(m.x0, m.x1) - x) / z;
        const wy0 = (Math.min(m.y0, m.y1) - y) / z, wy1 = (Math.max(m.y0, m.y1) - y) / z;
        const hit = Object.values(useBoard.getState().items)
          .filter((i) => i.x < wx1 && i.x + i.w > wx0 && i.y < wy1 && i.y + i.h > wy0)
          .map((i) => i.id);
        select([...new Set([...baseSel, ...hit])]);
      } else {
        useCamera.setState({ x: cam.x + ev.clientX - startX, y: cam.y + ev.clientY - startY });
      }
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setGesturing(false);
      setMarquee(null);
      if (!moved && !onCard) {
        select([]);
        if (useBoard.getState().editingId) useBoard.setState({ editingId: null });
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    if (!editable) return;
    // Our own drag-to-DAW handles shouldn't drop back onto the board.
    if (e.dataTransfer.types.includes('application/x-audiation')) return;
    const at = screenToWorld(e.clientX, e.clientY);
    const files = [...e.dataTransfer.files];
    if (files.length) return void addFiles(files, at);
    const uri = e.dataTransfer.getData('text/uri-list').split('\n').find((l) => l && !l.startsWith('#'));
    if (uri) return void addLink(uri.trim(), at);
    const text = e.dataTransfer.getData('text/plain');
    if (text) addFromText(text, at);
  };

  return (
    <div
      ref={root}
      className={`canvas ${dropping ? 'dropping' : ''}`}
      data-canvas
      onPointerDown={onPointerDown}
      onPointerMove={(e) => {
        const w = screenToWorld(e.clientX, e.clientY);
        sendCursor(w.x, w.y);
      }}
      onPointerLeave={() => sendCursorOut()}
      onDoubleClick={(e) => {
        if (!editable || (e.target as HTMLElement).closest('.frame, .panel, .popover')) return;
        addText('', screenToWorld(e.clientX, e.clientY));
      }}
      onDragOver={(e) => {
        if (!editable || e.dataTransfer.types.includes('application/x-audiation')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!dropping) setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={onDrop}
    >
      <div ref={world} className="world">
        {list.map((it) => (
          <Card key={it.id} item={it} />
        ))}
        {Object.values(pending).map((p) => (
          <PendingCard key={p.id} p={p} />
        ))}
        <Cursors />
      </div>
      {list.length === 0 && Object.keys(pending).length === 0 && <EmptyState />}
      {marquee && (
        <div
          className="marquee"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      )}
      {dropping && (
        <div className="drop-hint">
          <span>Drop to add to the board</span>
        </div>
      )}
    </div>
  );
}
