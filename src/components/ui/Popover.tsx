import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Floating panel anchored to an element, rendered in a portal so it isn't scaled
 * with the canvas. Closes on outside pointerdown and Escape.
 */
export function Popover({
  anchor,
  open,
  onClose,
  children,
  placement = 'bottom',
  className = '',
  width,
}: {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  placement?: 'bottom' | 'top' | 'right' | 'left';
  className?: string;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const el = ref.current;
      const w = el?.offsetWidth ?? width ?? 280;
      const h = el?.offsetHeight ?? 200;
      const vw = window.innerWidth, vh = window.innerHeight;
      const gap = 8;
      let left = a.left + a.width / 2 - w / 2;
      let top = a.bottom + gap;
      if (placement === 'top' || (placement === 'bottom' && top + h > vh - 8 && a.top - gap - h > 8)) top = a.top - gap - h;
      if (placement === 'right') {
        left = a.right + gap;
        top = a.top + a.height / 2 - h / 2;
      }
      if (placement === 'left') {
        left = a.left - gap - w;
        top = a.top + a.height / 2 - h / 2;
      }
      left = Math.max(8, Math.min(vw - w - 8, left));
      top = Math.max(8, Math.min(vh - h - 8, top));
      setPos({ left, top });
    };
    place();
    const ro = new ResizeObserver(place);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener('resize', place);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [open, anchor, placement, width]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      // Clicks inside other popovers (nested menus) shouldn't close this one.
      if ((t as HTMLElement).closest?.('.popover')) return;
      onClose();
    };
    // Capture phase so Escape closes the popover before board shortcuts see it.
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={`popover ${className}`}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

export function Dialog({ open, onClose, children, title, wide }: { open: boolean; onClose: () => void; children: ReactNode; title: string; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.popover')) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal aria-label={title}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
