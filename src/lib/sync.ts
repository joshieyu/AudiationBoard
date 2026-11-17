import type { ClientMsg, ServerMsg } from '../../shared/types';
import { applyRemote, refreshBoard, useBoard } from '../store/board';
import { identity } from './identity';

let ws: WebSocket | null = null;
let token = '';
let retry = 0;
let closedByUs = false;
let lastCursor = 0;
let pendingCursor: { x: number; y: number } | null = null;
let cursorTimer: ReturnType<typeof setTimeout> | null = null;
let everConnected = false;
const albumListeners = new Set<() => void>();

/** Called when the album this board belongs to changes (songs added, renamed, reordered). */
export function onAlbumChanged(cb: () => void) {
  albumListeners.add(cb);
  return () => {
    albumListeners.delete(cb);
  };
}

function send(msg: ClientMsg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function onMessage(msg: ServerMsg) {
  const me = identity().clientId;
  switch (msg.t) {
    case 'welcome':
    case 'peers':
      useBoard.setState({ peers: msg.peers.filter((p) => p.id !== me) });
      break;
    case 'ops':
      if (msg.origin !== me) applyRemote(msg.ops);
      // Ops for items someone was dragging end the live preview.
      useBoard.setState((s) => {
        const remoteDrag = { ...s.remoteDrag };
        for (const op of msg.ops) if (op.op === 'update') delete remoteDrag[op.id];
        return { remoteDrag };
      });
      break;
    case 'cursor':
      useBoard.setState((s) => ({ cursors: { ...s.cursors, [msg.id]: { x: msg.x, y: msg.y, t: Date.now() } } }));
      break;
    case 'cursor-out':
      useBoard.setState((s) => {
        const cursors = { ...s.cursors };
        delete cursors[msg.id];
        return { cursors };
      });
      break;
    case 'drag':
      useBoard.setState((s) => {
        const remoteDrag = { ...s.remoteDrag };
        for (const m of msg.moves) remoteDrag[m.id] = { x: m.x, y: m.y };
        return { remoteDrag };
      });
      break;
    case 'album':
      for (const cb of albumListeners) cb();
      break;
  }
}

function open() {
  const id = identity();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}&client=${id.clientId}`);
  ws.onopen = () => {
    retry = 0;
    send({ t: 'hello', name: id.name, color: id.color });
    if (everConnected) void refreshBoard();
    everConnected = true;
  };
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data));
    } catch {
      /* ignore malformed */
    }
  };
  ws.onclose = () => {
    ws = null;
    if (closedByUs) return;
    const delay = Math.min(10000, 500 * 2 ** retry++);
    setTimeout(() => !closedByUs && open(), delay);
  };
}

export function connect(boardToken: string) {
  disconnect();
  token = boardToken;
  closedByUs = false;
  everConnected = false;
  open();
}

export function disconnect() {
  closedByUs = true;
  ws?.close();
  ws = null;
  useBoard.setState({ peers: [], cursors: {}, remoteDrag: {} });
}

export function sendHello() {
  const id = identity();
  send({ t: 'hello', name: id.name, color: id.color });
}

/** World-space cursor, throttled to ~20 Hz. */
export function sendCursor(x: number, y: number) {
  pendingCursor = { x: Math.round(x), y: Math.round(y) };
  const now = performance.now();
  if (now - lastCursor > 50) {
    lastCursor = now;
    send({ t: 'cursor', ...pendingCursor });
    pendingCursor = null;
  } else if (!cursorTimer) {
    cursorTimer = setTimeout(() => {
      cursorTimer = null;
      if (pendingCursor) sendCursor(pendingCursor.x, pendingCursor.y);
    }, 50);
  }
}

export function sendCursorOut() {
  send({ t: 'cursor-out' });
}

let lastDrag = 0;
export function sendDrag(moves: { id: string; x: number; y: number }[], force = false) {
  const now = performance.now();
  if (!force && now - lastDrag < 40) return;
  lastDrag = now;
  send({ t: 'drag', moves: moves.map((m) => ({ id: m.id, x: Math.round(m.x), y: Math.round(m.y) })) });
}
