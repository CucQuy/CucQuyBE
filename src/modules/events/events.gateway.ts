import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DbService } from '../../db/db.service';
import { RedisService } from '../../redis/redis.service';
import { UserRole } from '../../auth/user.types';
import { userCacheKey } from '../../auth/sso-auth.guard';
import { verifySsoToken } from '../../auth/sso.util';
import { SOCKET_EVENTS, type OrderPaidEvent } from './events.constants';
import { NotificationsService } from '../notifications/notifications.service';

export type { OrderPaidEvent };

/** Room nhận noti thanh toán — chỉ Owner (super_admin) + Admin được join. */
const PAYMENTS_ROOM = 'payments';
const NOTIFY_ROLES = new Set<UserRole>([UserRole.SUPER_ADMIN, UserRole.ADMIN]);

/** Chuẩn hoá role thô về UserRole (giống guard/FE). */
function normalizeRole(raw: unknown): UserRole | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.toLowerCase();
  if (s === 'super_admin') return UserRole.SUPER_ADMIN;
  if (s === 'admin') return UserRole.ADMIN;
  if (s === 'colaborator') return UserRole.COLABORATOR;
  return undefined;
}

/**
 * Gateway socket.io realtime. Mỗi client connect phải kèm SSO token
 * (handshake.auth.token). Verify token + nạp role (tái dùng cache của guard):
 * chỉ super_admin/admin được join room `payments` để nhận `order:paid`.
 * BE 1 replica + worker in-process → emit trực tiếp, chưa cần Redis adapter.
 */
// path '/api/socket.io': đi đúng prefix /api đã được tunnel/ingress route về BE
// (FE gọi API tại <origin>/api) → tránh phụ thuộc cách route theo host hay path.
@WebSocketGateway({
  path: '/api/socket.io',
  cors: { origin: true, credentials: true },
})
export class EventsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer() server!: Server;

  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly notif: NotificationsService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ||
        (client.handshake.query?.token as string | undefined);
      if (!token) {
        client.disconnect(true);
        return;
      }

      const email = verifySsoToken(token).email;

      // Role: ưu tiên cache (guard set sẵn theo email), miss thì đọc Postgres theo email.
      let role: UserRole | undefined;
      const cached = await this.redis.get<{ role: UserRole | null }>(
        userCacheKey(email),
      );
      if (cached?.role) {
        role = normalizeRole(cached.role);
      } else {
        const rows = await this.db.sql<{ role: string | null }[]>`
          SELECT role FROM users WHERE lower(email) = lower(${email}) LIMIT 1`;
        role = normalizeRole(rows[0]?.role);
      }

      if (role && NOTIFY_ROLES.has(role)) {
        client.join(PAYMENTS_ROOM);
      } else {
        client.disconnect(true);
      }
    } catch {
      client.disconnect(true);
    }
  }

  /** Bắn noti "đơn đã thanh toán" tới Owner/Admin đang online + lưu vào hộp thư in-app. */
  emitOrderPaid(event: OrderPaidEvent): void {
    if (this.server) {
      this.server.to(PAYMENTS_ROOM).emit(SOCKET_EVENTS.ORDER_PAID, event);
      this.logger.log(`order:paid → ${event.orderNumber} (${event.amount}đ)`);
    }
    // Lưu vào hộp thư in-app (fire-and-forget, không chặn emit).
    void this.notif.log({
      kind: 'inapp',
      category: 'order_paid',
      title: `Đơn ${event.orderNumber} đã thanh toán`,
      body: `Đơn ${event.orderNumber} vừa thanh toán ${(event.amount ?? 0).toLocaleString('vi-VN')}đ.`,
      target: 'admins',
      status: 'sent',
      triggeredBy: 'system',
    });
  }
}
