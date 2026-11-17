import { memo, useRef, useState, type ReactNode } from 'react';
import type { AnyItem, NoteColor } from '../../shared/types';
import { clipTempo, usePlayback } from '../audio/engine';
import { downloadUrl } from '../lib/api';
import { keyFit, parseKey, tempoFit } from '../lib/music';
import { sendDrag } from '../lib/sync';
import { bringToFront, duplicateItems, removeItems, updateItem } from '../store/actions';
import { commit, select, useBoard, useCamera } from '../store/board';
import { pinch, setGesturing, useGesture } from '../store/gesture';
import { Icon } from './ui/Icon';
import { Popover } from './ui/Popover';

const MIN: Record<AnyItem['type'], { w: number; h: number }> = {
  text: { w: 140, h: 72 },
  image: { w: 80, h: 60 },
  link: { w: 220, h: 80 },
  audio: { w: 210, h: 104 },
  midi: { w: 230, h: 120 },
};

function isInteractive(el: HTMLElement) {
  return !!el.closest('[data-nodrag], input, textarea, select, button, a, iframe, [contenteditable="true"]');
}

/** Dims cards that don't match the active Sound map filter. */
function useDimmed(item: AnyItem) {
  return useBoard((s) => {
    const f = s.filter;
    if (!f.roles.length && !f.fitKey && !f.fitTempo) return false;
    if (item.type !== 'audio' && item.type !== 'midi') return true;
    const tags = item.data.tags;
    if (f.roles.length && (!tags || !f.roles.includes(tags.role.v))) return true;
    if (f.fitKey) {
      const bk = parseKey(s.board?.key);
      const k = parseKey(tags?.key.v);
      if (bk && (!k || keyFit(k, bk) === 'clash')) return true;
    }
    if (f.fitTempo && s.board?.bpm) {
      const bpm = item.type === 'midi' ? item.data.summary?.bpm ?? null : clipTempo(tags);
      if (bpm && tempoFit(bpm, s.board.bpm).fit === 'clash') return true;
    }
    return false;
  });
}

export const CardFrame = memo(function CardFrame({ item, children }: { item: AnyItem; children: ReactNode }) {
  const selected = useBoard((s) => s.selection.includes(item.id));
  const editable = useBoard((s) => s.access === 'edit');
  const editing = useBoard((s) => s.editingId === item.id);
  const remote = useBoard((s) => s.remoteDrag[item.id]);
  const drag = useGesture((s) => (s.dragIds.includes(item.id) ? s : null));
  const resize = useGesture((s) => (s.resize?.id === item.id ? s.resize : null));
  const playing = usePlayback((s) => !!s.playing[item.id]);
  const dimmed = useDimmed(item);
  const menuRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);

  const x = remote ? remote.x : item.x + (drag?.dx ?? 0);
  const y = remote ? remote.y : item.y + (drag?.dy ?? 0);
  const w = resize?.w ?? item.w;
  const h = resize?.h ?? item.h;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || pinch.active) return;
    const target = e.target as HTMLElement;
    if (!editable || editing) return; // let the canvas pan in view mode
    if (isInteractive(target)) return;
    e.stopPropagation();
    const st = useBoard.getState();
    let ids = st.selection;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (additive) ids = ids.includes(item.id) ? ids.filter((i) => i !== item.id) : [...ids, item.id];
    else if (!ids.includes(item.id)) ids = [item.id];
    select(ids);
    if (st.editingId) useBoard.setState({ editingId: null });

    const startX = e.clientX, startY = e.clientY;
    const z = useCamera.getState().z;
    const moving = ids.filter((id) => st.items[id]);
    let dragging = false;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      if (pinch.active) return cancel();
      const dx = (ev.clientX - startX) / z, dy = (ev.clientY - startY) / z;
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
      if (!dragging) {
        dragging = true;
        setGesturing(true);
        bringToFront(moving);
      }
      useGesture.setState({ dragIds: moving, dx, dy });
      const items = useBoard.getState().items;
      sendDrag(moving.map((id) => ({ id, x: items[id].x + dx, y: items[id].y + dy })));
    };
    const up = (ev: PointerEvent) => {
      cleanup();
      if (!dragging) {
        if (!additive) select([item.id]);
        return;
      }
      const dx = Math.round((ev.clientX - startX) / z), dy = Math.round((ev.clientY - startY) / z);
      const items = useBoard.getState().items;
      useGesture.setState({ dragIds: [], dx: 0, dy: 0 });
      if (dx || dy) commit(moving.filter((id) => items[id]).map((id) => ({ op: 'update', id, patch: { x: items[id].x + dx, y: items[id].y + dy } })));
    };
    const cancel = () => {
      cleanup();
      useGesture.setState({ dragIds: [], dx: 0, dy: 0 });
    };
    const cleanup = () => {
      setGesturing(false);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
  };

  const onResizeDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const z = useCamera.getState().z;
    const min = MIN[item.type];
    const aspect = item.type === 'image' ? item.data.aspect : 0;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    setGesturing(true);
    let last = { w: item.w, h: item.h };
    const move = (ev: PointerEvent) => {
      let nw = Math.max(min.w, Math.round(item.w + (ev.clientX - startX) / z));
      let nh = Math.max(min.h, Math.round(item.h + (ev.clientY - startY) / z));
      if (aspect && !ev.shiftKey) nh = Math.round(nw / aspect);
      if (item.type === 'link' && item.data.embed && item.data.embed.provider !== 'youtube' && item.data.embed.provider !== 'vimeo') nh = item.h;
      last = { w: nw, h: nh };
      useGesture.setState({ resize: { id: item.id, ...last } });
    };
    const up = () => {
      setGesturing(false);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      useGesture.setState({ resize: null });
      if (last.w !== item.w || last.h !== item.h) updateItem(item.id, { w: last.w, h: last.h });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const fileRef = 'file' in item.data ? item.data.file : null;
  return (
    <div
      className={`frame ${selected ? 'selected' : ''} ${dimmed ? 'dimmed' : ''} ${playing ? 'playing' : ''} ${remote ? 'remote-moving' : ''} ${drag ? 'dragging' : ''}`}
      style={{ transform: `translate(${x}px, ${y}px)`, width: w, height: h, zIndex: drag ? 1e6 + item.z : item.z }}
      data-item={item.id}
      onPointerDown={onPointerDown}
    >
      {children}
      <button
        ref={menuRef}
        className="frame-menu"
        data-nodrag
        aria-label="Card menu"
        onClick={(e) => {
          e.stopPropagation();
          setMenu((m) => !m);
        }}
      >
        <Icon name="more" size={16} strokeWidth={2.4} />
      </button>
      {editable && <div className="resize-handle" onPointerDown={onResizeDown} aria-hidden />}
      <Popover anchor={menuRef.current} open={menu} onClose={() => setMenu(false)} width={200}>
        <div className="menu" onClick={() => setMenu(false)}>
          {item.type === 'text' && editable && <NoteColors id={item.id} current={item.data.color} />}
          {item.type === 'text' && editable && (
            <button className="menu-item" onClick={() => useBoard.setState({ editingId: item.id, selection: [item.id] })}>
              <Icon name="pencil" size={15} /> Edit text
            </button>
          )}
          {fileRef && (
            <a className="menu-item" href={downloadUrl(fileRef)} download={fileRef.name}>
              <Icon name="download" size={15} /> Download {fileRef.name.split('.').pop()?.toUpperCase()}
            </a>
          )}
          {item.type === 'link' && (
            <a className="menu-item" href={item.data.url} target="_blank" rel="noopener noreferrer">
              <Icon name="external" size={15} /> Open link
            </a>
          )}
          {item.type === 'link' && (
            <button className="menu-item" onClick={() => navigator.clipboard?.writeText(item.data.url)}>
              <Icon name="copy" size={15} /> Copy link
            </button>
          )}
          {editable && (
            <>
              <button className="menu-item" onClick={() => duplicateItems([item.id])}>
                <Icon name="copy" size={15} /> Duplicate <kbd>⌘D</kbd>
              </button>
              <button className="menu-item" onClick={() => bringToFront([item.id])}>
                <Icon name="layers" size={15} /> Bring to front
              </button>
              <div className="menu-sep" />
              <button className="menu-item danger" onClick={() => removeItems([item.id])}>
                <Icon name="trash" size={15} /> Delete <kbd>⌫</kbd>
              </button>
            </>
          )}
        </div>
      </Popover>
    </div>
  );
});

const NOTE_COLORS: NoteColor[] = ['default', 'yellow', 'orange', 'pink', 'purple', 'blue', 'green'];

function NoteColors({ id, current }: { id: string; current: NoteColor }) {
  return (
    <div className="note-colors" role="radiogroup" aria-label="Note colour">
      {NOTE_COLORS.map((c) => (
        <button
          key={c}
          role="radio"
          aria-checked={c === current}
          aria-label={c}
          className={`nc nc-${c} ${c === current ? 'on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            updateItem(id, { data: { color: c } });
          }}
        />
      ))}
    </div>
  );
}
