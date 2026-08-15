import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DineInProc } from './dine-in.proc';
import { DineInTable, DineInTableInput } from './dine-in.types';

/** Orchestration màn Order theo bàn (dine-in): CRUD bàn + đóng bàn. */
@Injectable()
export class DineInService {
  constructor(private readonly proc: DineInProc) {}

  /** Danh sách bàn (kèm đơn đang mở). */
  async listTables(): Promise<DineInTable[]> {
    const rows = await this.proc.list();
    return rows[0]?.result ?? [];
  }

  /** Tạo/sửa bàn. */
  async upsertTable(input: DineInTableInput): Promise<DineInTable> {
    try {
      const rows = await this.proc.upsert(input);
      return rows[0].result;
    } catch (e) {
      throw mapDineInError(e);
    }
  }

  /** Xoá bàn (soft). Chặn nếu bàn còn đơn đang mở. */
  async deleteTable(id: string): Promise<{ ok: boolean }> {
    try {
      const rows = await this.proc.remove(id);
      return rows[0].result;
    } catch (e) {
      throw mapDineInError(e);
    }
  }

  /** Đóng bàn (set giờ ra). Trả đơn đã cập nhật. */
  async checkout(orderId: string): Promise<unknown> {
    try {
      const rows = await this.proc.checkout(orderId);
      return rows[0].result;
    } catch (e) {
      throw mapDineInError(e);
    }
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
