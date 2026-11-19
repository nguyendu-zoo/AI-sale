import { Global, Injectable, Module } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer, WsException } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { RbacService } from '../auth/rbac.service';

const cookie = (socket: Socket) => {
  const entry = socket.handshake.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('session_token='));
  return entry ? decodeURIComponent(entry.slice('session_token='.length)) : undefined;
};
@Injectable()
@WebSocketGateway({ cors: { origin: process.env.WEB_URL || 'http://localhost:5173', credentials: true } })
export class RealtimeService implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  constructor(private readonly auth: AuthService, private readonly rbac: RbacService) {}
  async handleConnection(socket: Socket) {
    try {
      const origin = socket.handshake.headers.origin;
      if (origin && origin !== (process.env.WEB_URL || 'http://localhost:5173')) return socket.disconnect(true);
      const session = await this.auth.session(cookie(socket));
      socket.data.userId = session.userId;
    } catch { socket.disconnect(true); }
  }
  @SubscribeMessage('join_page')
  async join(@ConnectedSocket() socket: Socket, @MessageBody() body: { pageId?: string }) {
    try {
      if (!body || typeof body.pageId !== 'string' || body.pageId.length > 100) throw new Error();
      const session = await this.auth.session(cookie(socket));
      await this.rbac.page(session.user, body.pageId);
      for (const room of socket.rooms) if (room.startsWith('page:')) await socket.leave(room);
      await socket.join(`page:${body.pageId}`);
      return { joined: body.pageId };
    } catch { throw new WsException('Không có quyền truy cập fanpage.'); }
  }
  // Recheck every recipient rather than trusting room membership after a grant was revoked.
  async emitPage(pageId: string, _event: string, _payload: unknown) {
    if (!this.server) return;
    const sockets = await this.server.in(`page:${pageId}`).fetchSockets();
    await Promise.all(sockets.map(async socket => {
      try {
        const token = socket.handshake.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('session_token='))?.slice(14);
        const session = await this.auth.session(token ? decodeURIComponent(token) : undefined);
        await this.rbac.page(session.user, pageId);
        // Invalidate only. Conversation content is always fetched through the protected API.
        socket.emit('page_update', { pageId });
      } catch { socket.leave(`page:${pageId}`); }
    }));
  }
  async revoke(userId: string, pageId: string) {
    if (!this.server) return;
    for (const socket of await this.server.in(`page:${pageId}`).fetchSockets()) {
      if (socket.data.userId === userId) { socket.emit('access_revoked', { pageId }); await socket.leave(`page:${pageId}`); }
    }
  }
}
@Global()
@Module({ providers: [RealtimeService], exports: [RealtimeService] })
export class RealtimeModule {}
