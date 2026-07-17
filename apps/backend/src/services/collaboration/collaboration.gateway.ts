import { Injectable, Logger } from '@nestjs/common';
import * as http from 'http';
import * as ws from 'ws';
import * as Y from 'yjs';

interface RoomClients {
  clients: Set<ws.WebSocket>;
  ydoc: Y.Doc;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

@Injectable()
export class CollaborationGateway {
  private readonly logger = new Logger(CollaborationGateway.name);
  private wss: ws.Server | null = null;
  private rooms = new Map<string, RoomClients>();
  private clientRoom = new WeakMap<ws.WebSocket, string>();

  initialize(server: http.Server, auth?: (token: string) => Promise<{userId: string; orgId: string} | null>) {
    this.wss = new ws.Server({ server, path: '/collaboration' });

    this.wss.on('connection', (socket, req) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const token = url.searchParams.get('token') || this._extractTokenFromCookie(req);

      if (auth) {
        if (!token) {
          socket.close(4001, 'Authentication required');
          return;
        }
        auth(token).then((user) => {
          if (!user) {
            socket.close(4002, 'Invalid token');
            return;
          }
          this._handleConnection(socket, req, url, user.orgId);
        }).catch(() => {
          socket.close(4002, 'Invalid token');
        });
      } else {
        this._handleConnection(socket, req, url, undefined);
      }
    });
  }

  private _handleConnection(socket: ws.WebSocket, req: http.IncomingMessage, url: URL, orgId?: string) {
      const rawRoom = url.searchParams.get('room') || 'default';
      const roomName = orgId ? `${orgId}:${rawRoom}` : rawRoom;

      this.logger.log(`Collaboration: client joined room=${roomName}`);

      let room = this.rooms.get(roomName);
      if (!room) {
        room = { clients: new Set(), ydoc: new Y.Doc() };
        this.rooms.set(roomName, room);
      }

      if (room.cleanupTimer) {
        clearTimeout(room.cleanupTimer);
        room.cleanupTimer = undefined;
      }

      room.clients.add(socket);
      this.clientRoom.set(socket, roomName);

      const initialState = Y.encodeStateAsUpdate(room.ydoc);
      socket.send(initialState);

      socket.on('message', (data) => {
        try {
          const update = new Uint8Array(data as ArrayBuffer);
          const currentRoom = this.clientRoom.get(socket);
          if (!currentRoom) return;
          const r = this.rooms.get(currentRoom);
          if (!r) return;
          Y.applyUpdate(r.ydoc, update);

          r.clients.forEach((client) => {
            if (client !== socket && client.readyState === ws.WebSocket.OPEN) {
              client.send(data);
            }
          });
        } catch (err) {
          this.logger.warn(`Failed to apply Yjs update: ${(err as Error).message}`);
        }
      });

      socket.on('close', () => {
        const currentRoom = this.clientRoom.get(socket);
        if (!currentRoom) return;
        const r = this.rooms.get(currentRoom);
        if (!r) return;
        r.clients.delete(socket);
        this.clientRoom.delete(socket);

        if (r.clients.size <= 0) {
          r.cleanupTimer = setTimeout(() => {
            const room = this.rooms.get(currentRoom);
            if (room && room.clients.size <= 0) {
              room.ydoc.destroy();
              this.rooms.delete(currentRoom);
              this.logger.log(`Collaboration: cleaned up room=${currentRoom}`);
            }
          }, 300000);
        }
      });

      socket.on('error', (err) => this.logger.warn(`Socket error: ${err.message}`));
  }

  getConnectedCount(roomName: string): number {
    const room = this.rooms.get(roomName);
    if (!room) return 0;
    return Array.from(room.clients).filter(
      (c) => c.readyState === ws.WebSocket.OPEN
    ).length;
  }

  private _extractTokenFromCookie(req: http.IncomingMessage): string | null {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return null;
    for (const part of cookieHeader.split(';')) {
      const trimmed = part.trim();
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq);
      if (key === 'auth') return trimmed.slice(eq + 1);
    }
    return null;
  }
}
