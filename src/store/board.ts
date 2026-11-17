import { create } from 'zustand';
import type { AnyItem, BoardKind, BoardMeta, BoardPatch, ItemPatch, Op, Peer, Role } from '../../shared/types';
import { getBoard, postOps } from '../lib/api';
import { identity, rememberBoard } from '../lib/identity';

export interface PendingItem {
  id: string;
  type: 'audio' | 'midi' | 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  progress: number;
  stage: 'uploading' | 'analyzing' | 'error';
  error?: string;
}

export interface Filter {
  roles: Role[];
  fitKey: boolean;
  fitTempo: boolean;
}

interface BoardState {
  status: 'loading' | 'ready' | 'error';
  error?: string;
  token: string;
  board: BoardMeta | null;
  access: 'edit' | 'view';
  viewId: string;
  editId?: string;
  kind: BoardKind;
  /** Title of the album a song/overview belongs to, when opened by its own link. */
  albumTitle?: string;
  items: Record<string, AnyItem>;
  pending: Record<string, PendingItem>;
  selection: string[];
  editingId: string | null;
  filter: Filter;
  peers: Peer[];
  cursors: Record<string, { x: number; y: number; t: number }>;
  remoteDrag: Record<string, { x: number; y: number }>;
  saving: 'idle' | 'saving' | 'error';
  canUndo: boolean;
  canRedo: boolean;
}

export const useBoard = create<BoardState>(() => ({
  status: 'loading',
  token: '',
  board: null,
  access: 'view',
  viewId: '',
  kind: 'single',
  items: {},
  pending: {},
  selection: [],
  editingId: null,
  filter: { roles: [], fitKey: false, fitTempo: false },
  peers: [],
  cursors: {},
  remoteDrag: {},
  saving: 'idle',
  canUndo: false,
  canRedo: false,
}));

export interface Camera {
  x: number;
  y: number;
  z: number;
}

export const useCamera = create<Camera>(() => ({ x: 0, y: 0, z: 1 }));

export const canEdit = () => useBoard.getState().access === 'edit';

// ---- Applying ops ------------------------------------------------------------------

function applyToState(ops: Op[]) {
  const s = useBoard.getState();
  let items = s.items;
  let board = s.board;
  let selection = s.selection;
  let touched = false;
  for (const op of ops) {
    if (op.op === 'add') {
      if (!touched) items = { ...items };
      touched = true;
      items[op.item.id] = op.item;
    } else if (op.op === 'update') {
      const cur = items[op.id];
      if (!cur) continue;
      if (!touched) items = { ...items };
      touched = true;
      const next = { ...cur, ...pickGeom(op.patch), updatedAt: Date.now() } as AnyItem;
      if (op.patch.data) next.data = { ...cur.data, ...op.patch.data } as AnyItem['data'];
      items[op.id] = next;
    } else if (op.op === 'remove') {
      if (!items[op.id]) continue;
      if (!touched) items = { ...items };
      touched = true;
      delete items[op.id];
      if (selection.includes(op.id)) selection = selection.filter((x) => x !== op.id);
    } else if (op.op === 'board' && board) {
      board = { ...board, ...op.patch };
    }
  }
  useBoard.setState({ items, board, selection });
}

function pickGeom(p: ItemPatch) {
  const out: Partial<Pick<AnyItem, 'x' | 'y' | 'w' | 'h' | 'z'>> = {};
  for (const k of ['x', 'y', 'w', 'h', 'z'] as const) if (typeof p[k] === 'number') out[k] = p[k];
  return out;
}

function inverseOf(ops: Op[]): Op[] {
  const { items, board } = useBoard.getState();
  const inv: Op[] = [];
  for (const op of ops) {
    if (op.op === 'add') inv.unshift({ op: 'remove', id: op.item.id });
    else if (op.op === 'remove') {
      const cur = items[op.id];
      if (cur) inv.unshift({ op: 'add', item: cur });
    } else if (op.op === 'update') {
      const cur = items[op.id];
      if (!cur) continue;
      const back: ItemPatch = {};
      for (const k of ['x', 'y', 'w', 'h', 'z'] as const) if (op.patch[k] !== undefined) back[k] = cur[k];
      if (op.patch.data) {
        back.data = {};
        const data = cur.data as unknown as Record<string, unknown>;
        for (const k of Object.keys(op.patch.data)) back.data[k] = data[k] ?? null;
      }
      inv.unshift({ op: 'update', id: op.id, patch: back });
    } else if (op.op === 'board' && board) {
      const back: BoardPatch = {};
      for (const k of Object.keys(op.patch) as (keyof BoardPatch)[]) (back as Record<string, unknown>)[k] = board[k];
      inv.unshift({ op: 'board', patch: back });
    }
  }
  return inv;
}

// ---- History -----------------------------------------------------------------------

const undoStack: { ops: Op[]; inverse: Op[] }[] = [];
const redoStack: { ops: Op[]; inverse: Op[] }[] = [];

function syncHistoryFlags() {
  useBoard.setState({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });
}

/** Apply locally, record for undo, and send to the server. */
export function commit(ops: Op[], opts: { history?: boolean } = {}) {
  if (!ops.length || !canEdit()) return;
  const inverse = inverseOf(ops);
  applyToState(ops);
  if (opts.history !== false) {
    undoStack.push({ ops, inverse });
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    syncHistoryFlags();
  }
  enqueue(ops);
}

export function undo() {
  const e = undoStack.pop();
  if (!e) return;
  const fresh = inverseOf(e.inverse);
  applyToState(e.inverse);
  redoStack.push({ ops: e.inverse, inverse: fresh });
  enqueue(e.inverse);
  syncHistoryFlags();
}

export function redo() {
  const e = redoStack.pop();
  if (!e) return;
  const fresh = inverseOf(e.ops);
  applyToState(e.ops);
  undoStack.push({ ops: e.ops, inverse: fresh });
  enqueue(e.ops);
  syncHistoryFlags();
}

// ---- Send queue ------------------------------------------------------------------

let queue: Op[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight = false;
let retryDelay = 1000;

function enqueue(ops: Op[]) {
  queue.push(...ops);
  useBoard.setState({ saving: 'saving' });
  if (!timer) timer = setTimeout(flush, 60);
}

async function flush() {
  timer = null;
  const { editId } = useBoard.getState();
  if (inflight || !queue.length || !editId) return;
  const batch = queue.splice(0, 400);
  inflight = true;
  try {
    const res = await postOps(editId, batch, identity().clientId);
    retryDelay = 1000;
    // The server echoes the canonical board meta (title/key/bpm).
    useBoard.setState((s) => ({ board: s.board ? { ...s.board, ...res.board } : res.board }));
    useBoard.setState({ saving: queue.length ? 'saving' : 'idle' });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status && status >= 400 && status < 500) {
      console.error('Ops rejected', err);
      useBoard.setState({ saving: 'error' });
    } else {
      queue.unshift(...batch);
      useBoard.setState({ saving: 'error' });
      setTimeout(() => !timer && (timer = setTimeout(flush, 0)), retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15000);
    }
  } finally {
    inflight = false;
    if (queue.length && !timer) timer = setTimeout(flush, 30);
  }
}

window.addEventListener('beforeunload', (e) => {
  if (queue.length || inflight) {
    void flush();
    e.preventDefault();
  }
});

// ---- Remote ----------------------------------------------------------------------

export function applyRemote(ops: Op[]) {
  applyToState(ops);
}

// ---- Loading -------------------------------------------------------------------

/** `remember` adds it to the home page's list; boards opened inside an album don't. */
export async function loadBoard(token: string, opts: { remember?: boolean } = {}) {
  useBoard.setState({ status: 'loading', token, error: undefined, items: {}, pending: {}, selection: [], board: null });
  undoStack.length = 0;
  redoStack.length = 0;
  syncHistoryFlags();
  try {
    const p = await getBoard(token);
    const items: Record<string, AnyItem> = {};
    for (const it of p.items) items[it.id] = it;
    useBoard.setState({ status: 'ready', board: p.board, access: p.access, viewId: p.viewId, editId: p.editId, items, kind: p.kind, albumTitle: p.album?.title });
    if (opts.remember !== false) rememberBoard({ viewId: p.viewId, editId: p.editId, title: p.board.title, openedAt: Date.now() });
    return p;
  } catch (err) {
    useBoard.setState({ status: 'error', error: (err as Error).message });
    return null;
  }
}

/** Re-fetch after a reconnect so we don't miss ops sent while offline. */
export async function refreshBoard() {
  const { token } = useBoard.getState();
  if (!token) return;
  try {
    const p = await getBoard(token);
    const items: Record<string, AnyItem> = {};
    for (const it of p.items) items[it.id] = it;
    useBoard.setState({ board: p.board, items });
  } catch {
    /* keep local state */
  }
}

export function setPending(p: PendingItem | null, id?: string) {
  useBoard.setState((s) => {
    const pending = { ...s.pending };
    if (p) pending[p.id] = p;
    else if (id) delete pending[id];
    return { pending };
  });
}

export function patchPending(id: string, patch: Partial<PendingItem>) {
  useBoard.setState((s) => (s.pending[id] ? { pending: { ...s.pending, [id]: { ...s.pending[id], ...patch } } } : {}));
}

export function select(ids: string[]) {
  useBoard.setState({ selection: ids });
}

export function maxZ() {
  let z = 0;
  for (const it of Object.values(useBoard.getState().items)) if (it.z > z) z = it.z;
  return z;
}
