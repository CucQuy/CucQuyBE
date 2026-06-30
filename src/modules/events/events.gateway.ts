import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { FirestoreService } from '../../firebase/firestore.service';
import { DbService } from '../../db/db.service';
import { RedisService } from '../../redis/redis.service';
import { UserRole } from '../../auth/user.types';
import { userCacheKey } from '../../auth/firebase-auth.guard';

/** Room nhận noti thanh toán — chỉ Owner (super_admin) + Admin được join. */
const PAYMENTS_ROOM = 'payments';
const NOTIFY_ROLES = new Set<UserRole>([UserRole.SUPER_ADMIN, UserRole.ADMIN]);

/** Payload sự kiện đơn được thanh toán (qua webhook SePay tiền vào). */
export interface OrderPaidEvent {
  orderNumber: string;
  amount: number; // VND
}

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
 * Gateway socket.io realtime. Mỗi client connect phải kèm Firebase ID token
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
    private readonly firestore: FirestoreService,
    private readonly db: DbService,
    private readonly redis: RedisService,
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

      const decoded = await this.firestore.auth().verifyIdToken(token);

      // Role: ưu tiên cache (guard set sẵn), miss thì đọc Postgres user_get.
      let role: UserRole | undefined;
      const cached = await this.redis.get<{ role: UserRole | null }>(
        userCacheKey(decoded.uid),
      );
      if (cached?.role) {
        role = normalizeRole(cached.role);
      } else {
        const rows = await this.db.sql<{ role: string | null }[]>`
          SELECT role FROM user_get(${decoded.uid})`;
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

  /** Bắn noti "đơn đã thanh toán" tới Owner/Admin đang online. */
  emitOrderPaid(event: OrderPaidEvent): void {
    if (!this.server) return;
    this.server.to(PAYMENTS_ROOM).emit('order:paid', event);
    this.logger.log(`order:paid → ${event.orderNumber} (${event.amount}đ)`);
  }
}
