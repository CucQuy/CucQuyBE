import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Bọc ioredis. NGUYÊN TẮC: cache là "tốt thì dùng" — nếu Redis lỗi/không kết nối
 * được thì mọi thao tác trả null / no-op để caller tự fallback (đọc DB trực tiếp),
 * TUYỆT ĐỐI không làm hỏng request. Vì vậy mọi lệnh đều bọc try/catch.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private loggedError = false;

  onModuleInit(): void {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    try {
      this.client = new Redis(url, {
        // Fail nhanh khi Redis không sẵn → caller fallback ngay, không treo request.
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: (times) => Math.min(times * 500, 5000),
        lazyConnect: false,
      });
      this.client.on('error', (err) => {
        if (!this.loggedError) {
          this.logger.warn(`Redis không kết nối được (cache tắt, đọc DB trực tiếp): ${err.message}`);
          this.loggedError = true;
        }
      });
      this.client.on('connect', () => {
        this.loggedError = false;
        this.logger.log('Redis đã kết nối — cache bật');
      });
    } catch (err) {
      this.logger.warn(`Khởi tạo Redis thất bại (cache tắt): ${String(err)}`);
      this.client = null;
    }
  }

  onModuleDestroy(): void {
    this.client?.quit().catch(() => {});
  }

  /** Lấy giá trị JSON theo key. null nếu miss / Redis lỗi. */
  async get<T>(key: string): Promise<T | null> {
    if (!this.client) return null;
    try {
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  /** Set JSON + TTL (giây). No-op nếu Redis lỗi. */
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      /* bỏ qua — cache không bắt buộc */
    }
  }

  /** Xoá 1 hoặc nhiều key (invalidate cache). No-op nếu Redis lỗi. */
  async del(...keys: string[]): Promise<void> {
    if (!this.client || keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch {
      /* bỏ qua */
    }
  }
}
