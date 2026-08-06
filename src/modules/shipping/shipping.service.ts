import { Injectable } from '@nestjs/common';
import { ShippingProc } from './shipping.proc';

/**
 * Thống kê vận chuyển theo ĐƠN VỊ VẬN CHUYỂN (DVVC). Toàn bộ logic gom số liệu
 * nằm trong stored function shipping_analytics() — service chỉ gọi qua proc.
 */
@Injectable()
export class ShippingService {
  constructor(private readonly proc: ShippingProc) {}

  /** Chỉ số DVVC cho trang Vận chuyển (from/to rỗng = toàn bộ lịch sử). */
  async analytics(from?: string, to?: string): Promise<Record<string, unknown>> {
    return this.proc.analytics(from?.trim() || null, to?.trim() || null);
  }
}
