import { Injectable, InternalServerErrorException, Logger, UnauthorizedException } from '@nestjs/common';

/** Phiên do RiceService phát: access token ngắn + refresh token dài (xoay vòng). */
export interface RiceSession {
  accessToken: string;
  refreshToken: string;
  /** Số giây còn lại của access token — FE dùng để hẹn giờ refresh trước khi hết hạn. */
  expiresIn: number;
  user: { email: string; name?: string; picture?: string };
}

/**
 * Client gọi RiceService (SSO broker) bằng RICE_API_KEY — luôn server-to-server.
 * Refresh token KHÔNG bao giờ đi qua trình duyệt dưới dạng URL hay JS đọc được:
 * BE giữ nó trong cookie httpOnly của chính `api.cucquy.site` (xem cookie.util.ts).
 */
@Injectable()
export class RiceSsoService {
  private readonly logger = new Logger(RiceSsoService.name);
  private readonly endpoint = (process.env.RICE_ENDPOINT || '').replace(/\/+$/, '');
  private readonly apiKey = process.env.RICE_API_KEY || '';

  /** Số ngày không dùng app thì phiên chết (khớp SSO_REFRESH_IDLE_DAYS của RiceService). */
  readonly refreshIdleDays = Number(process.env.SSO_REFRESH_IDLE_DAYS || 90);

  get configured(): boolean {
    return Boolean(this.endpoint && this.apiKey);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    if (!this.configured) {
      throw new InternalServerErrorException('SSO chưa cấu hình (RICE_ENDPOINT / RICE_API_KEY)');
    }
    let res: globalThis.Response;
    try {
      res = await fetch(`${this.endpoint}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
        body: JSON.stringify(body),
      });
    } catch (e) {
      this.logger.error(`RiceService không phản hồi (${path}): ${String(e)}`);
      throw new InternalServerErrorException('Không kết nối được RiceService');
    }
    // 401/403 từ broker = phiên hỏng/hết hạn → trả 401 cho FE để nó đăng nhập lại,
    // KHÔNG nuốt thành 500 (FE phân biệt được "cần login" với "server lỗi").
    if (res.status === 401 || res.status === 403) {
      throw new UnauthorizedException('Phiên đăng nhập không hợp lệ hoặc đã hết hạn');
    }
    if (!res.ok) {
      this.logger.error(`RiceService ${path} → HTTP ${res.status}`);
      throw new InternalServerErrorException('RiceService trả lỗi');
    }
    return (await res.json()) as T;
  }

  /** Lấy Google authorize URL cho luồng redirect (app chỉ cần API key). */
  async authorizeUrl(returnUrl: string): Promise<string> {
    const data = await this.post<{ url?: string }>('/api/auth/google/authorize', { returnUrl });
    if (!data.url) throw new InternalServerErrorException('RiceService không trả về authorize URL');
    return data.url;
  }

  /** Đổi mã 1 lần (từ callback) lấy phiên đầu tiên. */
  exchange(code: string): Promise<RiceSession> {
    return this.post<RiceSession>('/api/auth/google/exchange', { code });
  }

  /** Xoay vòng: refresh token cũ → access + refresh mới, hạn trượt lại từ đầu. */
  refresh(refreshToken: string): Promise<RiceSession> {
    return this.post<RiceSession>('/api/auth/refresh', { refreshToken });
  }

  /** Thu hồi cả chuỗi token của phiên. Lỗi ở đây không được chặn việc đăng xuất ở FE. */
  async logout(refreshToken: string): Promise<void> {
    try {
      await this.post('/api/auth/logout', { refreshToken });
    } catch (e) {
      this.logger.warn(`Thu hồi phiên ở RiceService thất bại: ${String(e)}`);
    }
  }
}
