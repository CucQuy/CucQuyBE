import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { CommissionProc } from './commission.proc';
import { CollaboratorCommissionSummary } from './commission.types';

/** Cache thống kê hoa hồng tất cả CTV. */
const SUMMARIES_CACHE_KEY = 'report:commission:summaries';
const SUMMARIES_TTL = 120;

/**
 * Toàn bộ công thức tính hoa hồng nằm trong stored function app.commission_*
 * (xem migrations/functions/commission.sql). Service chỉ gọi proc + cache.
 */
@Injectable()
export class CommissionService {
  constructor(
    private readonly proc: CommissionProc,
    private readonly redis: RedisService,
  ) {}

  /** Admin: thống kê hoa hồng tất cả CTV (cache TTL ngắn). */
  async getAllSummaries(): Promise<CollaboratorCommissionSummary[]> {
    const cached = await this.redis.get<CollaboratorCommissionSummary[]>(SUMMARIES_CACHE_KEY);
    if (cached) return cached;

    const summaries = await this.proc.summaries();

    await this.redis.set(SUMMARIES_CACHE_KEY, summaries, SUMMARIES_TTL);
    return summaries;
  }

  /** CTV / admin: hoa hồng của chính mình. */
  async getMySummary(uid: string, name: string): Promise<CollaboratorCommissionSummary> {
    return this.proc.summary(uid, name);
  }

  /** Admin: đánh dấu các đơn đã/chưa trả hoa hồng. */
  async setPaidStatus(orderIds: string[], paid: boolean): Promise<void> {
    if (orderIds.length === 0) return;
    await this.proc.setPaid(orderIds, paid);
    // Trạng thái hoa hồng đổi → bỏ cache summaries để phản ánh ngay.
    await this.redis.del(SUMMARIES_CACHE_KEY);
  }
}
