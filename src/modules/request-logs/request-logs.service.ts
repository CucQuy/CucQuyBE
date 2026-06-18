import { Injectable, Logger } from '@nestjs/common';
import { RequestLogProc, RequestLogRow } from './request-logs.proc';

/** Số ngày giữ log trước khi purge tự xoá. */
export const RETENTION_DAYS = 30;

/** Trần số dòng đọc khi tính thống kê (tránh quét cả bảng). */
const STATS_SCAN_CAP = 2000;

export interface GeoInfo {
  country?: string;
  region?: string;
  city?: string;
  lat?: number;
  lng?: number;
}

/** 1 bản ghi request ghi vào DB (chưa kèm timestamp/expireAt). */
export interface RequestLogEntry {
  method: string;
  path: string;
  query: string; // chuỗi query (vd "?status=paid"), '' nếu không có
  statusCode: number;
  durationMs: number;
  responseSize: number | null; // content-length nếu có
  ip: string;
  geo: GeoInfo | null;
  uid: string | null;
  email: string | null;
  role: string | null;
  userAgent: string;
  referer: string | null;
  body: string | null; // payload đã redact + cắt bớt (chỉ method có body)
}

export interface QueryLogsParams {
  from?: string; // ISO date
  to?: string; // ISO date
  method?: string;
  status?: number;
  uid?: string;
  email?: string;
  ip?: string;
  page?: number; // 1-based
  limit?: number;
}

/** Map dòng DB → camelCase (field cũ mà FE/API đang dùng). */
const mapRow = (r: RequestLogRow): Record<string, unknown> => ({
  id: r.id,
  method: r.method,
  path: r.path,
  query: r.query,
  statusCode: r.status_code,
  durationMs: r.duration_ms,
  responseSize: r.response_size,
  ip: r.ip,
  geo: r.geo,
  uid: r.uid,
  email: r.email,
  role: r.role,
  userAgent: r.user_agent,
  referer: r.referer,
  body: r.body,
  timestamp: r.timestamp,
  expireAt: r.expire_at,
});

/** Toàn bộ logic ở stored function app.request_log_* — service chỉ gọi. */
@Injectable()
export class RequestLogsService {
  private readonly logger = new Logger(RequestLogsService.name);

  constructor(private readonly proc: RequestLogProc) {}

  /**
   * Ghi log (fire-and-forget). KHÔNG throw ra ngoài — lỗi log không được làm
   * hỏng response. Gọi không cần await trong middleware.
   */
  async writeLog(entry: RequestLogEntry): Promise<void> {
    try {
      await this.proc.insert(entry, RETENTION_DAYS);
    } catch (err) {
      this.logger.error(`Ghi request log thất bại: ${String(err)}`);
    }
  }

  /** Danh sách log có lọc + phân trang (offset). orderBy timestamp desc. */
  async queryLogs(params: QueryLogsParams): Promise<{
    items: Array<Record<string, unknown>>;
    page: number;
    limit: number;
    hasMore: boolean;
  }> {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(200, Math.max(1, params.limit ?? 50));

    const rows = await this.proc.list({
      from: params.from ?? null,
      to: params.to ?? null,
      method: params.method ?? null,
      status: typeof params.status === 'number' ? params.status : null,
      uid: params.uid ?? null,
      email: params.email ?? null,
      ip: params.ip ?? null,
      page,
      limit,
    });

    // Hàm trả dư 1 dòng (limit+1) để biết còn trang sau.
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(mapRow);
    return { items, page, limit, hasMore };
  }

  /**
   * Thống kê nhanh trên cửa sổ gần nhất (tối đa STATS_SCAN_CAP dòng trong khoảng
   * thời gian lọc). Trả kèm `scanned` để minh bạch số dòng đã quét.
   */
  async stats(params: Pick<QueryLogsParams, 'from' | 'to'>): Promise<{
    scanned: number;
    total: number;
    errorCount: number;
    uniqueIps: number;
    topPaths: Array<{ path: string; count: number }>;
    topIps: Array<{ ip: string; country?: string; count: number }>;
  }> {
    const [row] = await this.proc.stats(
      params.from ?? null,
      params.to ?? null,
      STATS_SCAN_CAP,
    );

    const s = (row?.stats ?? {}) as {
      scanned?: number;
      total?: number;
      errorCount?: number;
      uniqueIps?: number;
      topPaths?: Array<{ path: string; count: number }>;
      topIps?: Array<{ ip: string; country?: string; count: number }>;
    };

    return {
      scanned: s.scanned ?? 0,
      total: s.total ?? 0,
      errorCount: s.errorCount ?? 0,
      uniqueIps: s.uniqueIps ?? 0,
      topPaths: s.topPaths ?? [],
      topIps: s.topIps ?? [],
    };
  }

  /** Xoá log đã hết hạn (TTL thủ công). Trả số dòng đã xoá. */
  async purgeExpired(): Promise<number> {
    try {
      const [row] = await this.proc.purgeExpired();
      return Number(row?.count ?? 0);
    } catch (err) {
      this.logger.error(`Purge request log hết hạn thất bại: ${String(err)}`);
      return 0;
    }
  }
}
