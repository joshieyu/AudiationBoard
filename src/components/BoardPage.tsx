import { useEffect } from 'react';
import { nanoid } from 'nanoid';
import type { AnyItem } from '../../shared/types';
import { engine } from '../audio/engine';
import { connect, disconnect } from '../lib/sync';
import { addFiles, addFromText, addText, bringToFront, duplicateItems, removeItems } from '../store/actions';
import { commit, loadBoard, maxZ, redo, select, undo, useBoard, useCamera } from '../store/board';
import { useAlbum } from '../store/album';
import { MakeAlbumDialog } from './MakeAlbumDialog';
import { Canvas, fitToContent, screenToWorld, zoomBy } from './Canvas';
import { Legend } from './Legend';
import { LinkDialog } from './LinkDialog';
import { RecordDialog } from './RecordDialog';
import { ShareDialog } from './ShareDialog';
import { Toolbar } from './Toolbar';
import { TopBar } from './TopBar';
import { Transport } from './Transport';
import { Icon } from './ui/Icon';
import { useUi } from './uiState';
import { ZoomControls } from './ZoomControls';

const CLIP_MARK = 'audiation/items:';
let lastPointer: { x: number; y: number } | null = null;

function typing(e: Event) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || useUi.getState().modal || document.querySelector('.popover, .dialog, .lightbox')) return;
      const st = useBoard.getState();
      const edit = st.access === 'edit';
      const mod = e.metaKey || e.ctrlKey;
      const sel = st.selection.filter((id) => st.items[id]);
      const k = e.key.toLowerCase();

      if (e.key === ' ') {
        e.preventDefault();
        const playable = sel.map((id) => st.items[id]).find((it) => it.type === 'audio' || it.type === 'midi') as Extract<AnyItem, { type: 'audio' | 'midi' }> | undefined;
        if (playable) void engine.toggle(playable, e.shiftKey);
        else engine.stopAll();
        return;
      }
      if (e.key === 'Escape') {
        if (sel.length) select([]);
        else engine.stopAll();
        return;
      }
      if (mod && k === 'z' && edit) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && k === 'y' && edit) {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && k === 'a') {
        e.preventDefault();
        select(Object.keys(st.items));
        return;
      }
      if (mod && k === 'd' && edit && sel.length) {
        e.preventDefault();
        duplicateItems(sel);
        return;
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomBy(1.25);
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        zoomBy(0.8);
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        zoomBy(1 / useCamera.getState().z);
        return;
      }
      if (e.shiftKey && e.code === 'Digit1') {
        fitToContent(sel.length ? sel : undefined);
        return;
      }
      if (mod || e.altKey) return;
      if ((e.key === 'Backspace' || e.key === 'Delete') && edit && sel.length) {
        e.preventDefault();
        removeItems(sel);
        return;
      }
      if (e.key.startsWith('Arrow') && edit && sel.length) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        commit(sel.map((id) => ({ op: 'update', id, patch: { x: st.items[id].x + dx, y: st.items[id].y + dy } })));
        return;
      }
      if (e.key === 'Enter' && edit && sel.length === 1 && st.items[sel[0]].type === 'text') {
        e.preventDefault();
        useBoard.setState({ editingId: sel[0] });
        return;
      }
      if (!edit) return;
      const at = lastPointer ?? undefined;
      if (k === 'n' || k === 't') {
        e.preventDefault();
        addText('', at);
      } else if (k === 'r') useUi.getState().open('record');
      else if (k === 'l') useUi.getState().open('link');
      else if (k === 'a') (document.querySelector('[data-picker="audio"]') as HTMLInputElement | null)?.click();
      else if (k === 'm') (document.querySelector('[data-picker="midi"]') as HTMLInputElement | null)?.click();
      else if (k === 'i') (document.querySelector('[data-picker="image"]') as HTMLInputElement | null)?.click();
    };

    const onCopy = (e: ClipboardEvent) => {
      if (typing(e) || window.getSelection()?.toString()) return;
      const st = useBoard.getState();
      const sel = st.selection.map((id) => st.items[id]).filter(Boolean);
      if (!sel.length) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', CLIP_MARK + JSON.stringify(sel));
    };

    const onPaste = (e: ClipboardEvent) => {
      if (typing(e) || useBoard.getState().access !== 'edit') return;
      const dt = e.clipboardData;
      if (!dt) return;
      const at = lastPointer ?? undefined;
      const files = [...dt.files];
      if (files.length) {
        e.preventDefault();
        void addFiles(files, at);
        return;
      }
      const text = dt.getData('text/plain');
      if (text.startsWith(CLIP_MARK)) {
        e.preventDefault();
        try {
          const items = JSON.parse(text.slice(CLIP_MARK.length)) as AnyItem[];
          const minX = Math.min(...items.map((i) => i.x)), minY = Math.min(...items.map((i) => i.y));
          const origin = at ?? { x: minX + 32, y: minY + 32 };
          let z = maxZ();
          const fresh = items.map((i) => ({ ...i, id: nanoid(12), x: Math.round(origin.x + i.x - minX), y: Math.round(origin.y + i.y - minY), z: ++z, createdAt: Date.now() })) as AnyItem[];
          commit(fresh.map((item) => ({ op: 'add', item })));
          select(fresh.map((i) => i.id));
          bringToFront(fresh.map((i) => i.id));
        } catch {
          /* not ours */
        }
        return;
      }
      if (text) {
        e.preventDefault();
        addFromText(text, at);
      }
    };

    const track = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest?.('[data-canvas]')) lastPointer = screenToWorld(e.clientX, e.clientY);
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('copy', onCopy);
    window.addEventListener('paste', onPaste);
    window.addEventListener('pointermove', track, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('pointermove', track);
    };
  }, []);
}

export function BoardPage({ token, inAlbum = false }: { token: string; inAlbum?: boolean }) {
  const status = useBoard((s) => s.status);
  const error = useBoard((s) => s.error);
  const editable = useBoard((s) => s.access === 'edit');
  const title = useBoard((s) => s.board?.title);
  const kind = useBoard((s) => s.kind);
  const albumTitle = useAlbum((s) => s.data?.album.title);
  useShortcuts();

  useEffect(() => {
    let alive = true;
    void loadBoard(token, { remember: !inAlbum }).then((p) => {
      if (!alive || !p) return;
      engine.setBoardTempo(p.board.bpm);
      requestAnimationFrame(() => fitToContent(undefined, false));
      connect(token);
    });
    return () => {
      alive = false;
      disconnect();
      engine.stopAll();
    };
  }, [token]);

  useEffect(() => {
    const name = inAlbum && albumTitle ? (kind === 'overview' ? albumTitle : `${title} · ${albumTitle}`) : title;
    document.title = name ? `${name} · Audiation Space` : 'Audiation Space';
  }, [title, inAlbum, albumTitle, kind]);

  if (status === 'error')
    return (
      <div className="page-message">
        <div className="empty-card">
          <h2>{error === 'Board not found' ? 'This board doesn’t exist' : 'Couldn’t open the board'}</h2>
          <p>{error === 'Board not found' ? 'The link may be mistyped, or the board was never created on this server.' : error}</p>
          <a className="btn primary" href="/">
            <Icon name="home" size={16} /> Go to your boards
          </a>
        </div>
      </div>
    );

  return (
    <div className={`board-page ${editable ? 'can-edit' : 'view-only'}`}>
      <Canvas />
      {status === 'loading' && (
        <div className="loading-veil">
          <span className="spinner lg" />
        </div>
      )}
      <TopBar />
      {editable && <Toolbar />}
      <Legend />
      <Transport />
      <ZoomControls />
      <ShareDialog />
      <RecordDialog />
      <LinkDialog />
      <MakeAlbumDialog />
    </div>
  );
}
