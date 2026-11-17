import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMsg, Op, Peer, ServerMsg } from '../shared/types.ts';
import type { Db } from './db.ts';

interface Client {
  ws: WebSocket;
  id: string;
  boardId: string;
  canEdit: boolean;
  name: string;
  color: string;
}

export function createRooms(db: Db, newId: () => string) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const rooms = new Map<string, Set<Client>>();

  function send(c: Client, msg: ServerMsg) {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
  }

  function peers(boardId: string): Peer[] {
    return [...(rooms.get(boardId) ?? [])]
      .filter((c) => c.name)
      .map((c) => ({ id: c.id, name: c.name, color: c.color, canEdit: c.canEdit }));
  }

  function broadcast(boardId: string, msg: ServerMsg, except?: string) {
    const data = JSON.stringify(msg);
    for (const c of rooms.get(boardId) ?? []) {
      if (c.id !== except && c.ws.readyState === c.ws.OPEN) c.ws.send(data);
    }
  }

  wss.on('connection', (ws: WebSocket, client: Client) => {
    let room = rooms.get(client.boardId);
    if (!room) rooms.set(client.boardId, (room = new Set()));
    room.add(client);
    send(client, { t: 'welcome', clientId: client.id, peers: peers(client.boardId) });

    // Keep idle proxies from dropping the socket.
    const ping = setInterval(() => ws.ping(), 25_000);

    ws.on('message', (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.t === 'hello') {
        client.name = String(msg.name).slice(0, 40);
        client.color = String(msg.color).slice(0, 32);
        broadcast(client.boardId, { t: 'peers', peers: peers(client.boardId) });
      } else if (msg.t === 'cursor') {
        if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;
        broadcast(client.boardId, { t: 'cursor', id: client.id, x: msg.x, y: msg.y }, client.id);
      } else if (msg.t === 'cursor-out') {
        broadcast(client.boardId, { t: 'cursor-out', id: client.id }, client.id);
      } else if (msg.t === 'drag' && client.canEdit && Array.isArray(msg.moves)) {
        broadcast(client.boardId, { t: 'drag', id: client.id, moves: msg.moves.slice(0, 200) }, client.id);
      }
    });

    ws.on('close', () => {
      clearInterval(ping);
      room!.delete(client);
      if (room!.size === 0) rooms.delete(client.boardId);
      else {
        broadcast(client.boardId, { t: 'cursor-out', id: client.id });
        broadcast(client.boardId, { t: 'peers', peers: peers(client.boardId) });
      }
    });
  });

  return {
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
      const url = new URL(req.url ?? '/', 'http://x');
      const token = url.searchParams.get('token') ?? '';
      const resolved = db.resolve(token);
      if (url.pathname !== '/ws' || !resolved) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }
      const clientId = url.searchParams.get('client') || newId();
      wss.handleUpgrade(req, socket, head, (ws) => {
        const client: Client = {
          ws,
          id: clientId.slice(0, 32),
          boardId: resolved.board.id,
          canEdit: resolved.canEdit,
          name: '',
          color: '',
        };
        wss.emit('connection', ws, client);
      });
    },

    broadcastOps(boardId: string, ops: Op[], origin: string) {
      broadcast(boardId, { t: 'ops', ops, origin }, origin);
    },

    /** Tell everyone on any board of an album to refresh its tabs. */
    broadcastAlbum(boardIds: string[]) {
      for (const id of boardIds) broadcast(id, { t: 'album' });
    },
  };
}
