import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DineInProc } from './dine-in.proc';
import { DineInSession, DineInTable, DineInTableInput } from './dine-in.types';
import { EventsGateway } from '../events/events.gateway';

/** Orchestration màn Order theo bàn (dine-in): CRUD bàn + đóng bàn. */
@Injectable()
export class DineInService {
  constructor(
    private readonly proc: DineInProc,
    private readonly events: EventsGateway,
  ) {}

  /** Danh sách bàn (kèm đơn đang mở). */
  async listTables(): Promise<DineInTable[]> {
    const rows = await this.proc.list();
    return rows[0]?.result ?? [];
  }

  /** Tạo/sửa bàn. */
  async upsertTable(input: DineInTableInput): Promise<DineInTable> {
    try {
      const rows = await this.proc.upsert(input);
      this.events.emitTablesChanged({ reason: 'table' });
      return rows[0].result;
    } catch (e) {
      throw mapDineInError(e);
    }
  }

  /** Xoá bàn (soft). Chặn nếu bàn còn đơn đang mở. */
  async deleteTable(id: string): Promise<{ ok: boolean }> {
    try {
      const rows = await this.proc.remove(id);
      this.events.emitTablesChanged({ reason: 'table' });
      return rows[0].result;
    } catch (e) {
      throw mapDineInError(e);
    }
  }

  /** Đóng bàn (set giờ ra). Trả đơn đã cập nhật. */
  async checkout(orderId: string): Promise<unknown> {
    try {
      const rows = await this.proc.checkout(orderId);
      this.events.emitTablesChanged({ reason: 'checkout' });
      return rows[0].result;
    } catch (e) {
      throw mapDineInError(e);
    }
  }

  /** Lịch sử vào/ra của 1 bàn (mọi phiên, mới nhất trước). */
  async tableHistory(tableId: string, limit = 30): Promise<DineInSession[]> {
    const rows = await this.proc.history(tableId, limit);
    return rows[0]?.result ?? [];
  }

  /** Lịch sử vào/ra toàn bộ bàn (tab Lịch sử bàn). */
  async allHistory(limit = 100): Promise<DineInSession[]> {
    const rows = await this.proc.allHistory(limit);
    return rows[0]?.result ?? [];
  }
}

/** Map exception raw từ Postgres sang HTTP status có nghĩa cho FE. */
function mapDineInError(e: unknown): Error {
  const msg = (e as { message?: string })?.message ?? '';
  if (msg.includes('TABLE_HAS_OPEN_ORDER')) {
    return new BadRequestException('TABLE_HAS_OPEN_ORDER');
  }
  if (msg.includes('TABLE_NOT_FOUND')) {
    return new NotFoundException('TABLE_NOT_FOUND');
  }
  if (msg.includes('ORDER_NOT_FOUND')) {
    return new NotFoundException('ORDER_NOT_FOUND');
  }
  return e as Error;
}
