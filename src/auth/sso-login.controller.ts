import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { IpThrottlerGuard } from '../common/ip-throttler.guard';

/**
 * Broker đăng nhập Google (luồng redirect server-side).
 *
 * FE chỉ mở `GET /api/auth/google/start` → BE (giữ RICE_API_KEY) gọi RiceService
 * `/api/auth/google/authorize` để lấy Google authorize URL rồi 302 trình duyệt sang.
 * Nhờ vậy FE KHÔNG cần bake Google client_id — cấu hình client_id/secret chỉ đặt
 * 1 lần ở RiceService, app khác chỉ cần API key.
 *
 * Sau khi user đăng nhập Google, RiceService callback → 302 về
 * `<WEB_APP_URL>/auth/callback?token=<SSO JWT>` (JWT ký bằng SSO_JWT_SECRET chung,
 * FE lưu lại + BE verify qua verifySsoToken).
 */
@Controller('auth/google')
export class SsoLoginController {
  private readonly rice = (process.env.RICE_ENDPOINT || '').replace(/\/+$/, '');
  private readonly apiKey = process.env.RICE_API_KEY || '';

  /** Origin của web app (nơi RiceService redirect kèm token). */
  private webOrigin(): string {
    const explicit = (process.env.WEB_APP_URL || '').trim();
    if (explicit) return explicit.replace(/\/+$/, '');
    const first = (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)[0];
    return (first || '').replace(/\/+$/, '');
  }

  // Chống spam khởi tạo đăng nhập: 10 lần/phút/IP.
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseGuards(IpThrottlerGuard)
  @Get('start')
  async start(@Res() res: Response): Promise<void> {
    const web = this.webOrigin();
    if (!this.rice || !this.apiKey || !web) {
      res.status(500).send('SSO chưa cấu hình (RICE_ENDPOINT / RICE_API_KEY / WEB_APP_URL|ALLOWED_ORIGINS)');
      return;
    }
    const returnUrl = `${web}/auth/callback`;
    let r: globalThis.Response;
    try {
      r = await fetch(`${this.rice}/api/auth/google/authorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
        body: JSON.stringify({ returnUrl }),
      });
    } catch {
      res.status(502).send('Không kết nối được RiceService');
      return;
    }
    if (!r.ok) {
      res.status(502).send('Không khởi tạo được đăng nhập Google');
      return;
    }
    const data = (await r.json()) as { url?: string };
    if (!data.url) {
      res.status(502).send('RiceService không trả về authorize URL');
      return;
    }
    res.redirect(302, data.url);
  }
}
