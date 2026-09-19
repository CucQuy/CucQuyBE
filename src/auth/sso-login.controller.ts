import { Controller, Get, Logger, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { IpThrottlerGuard } from '../common/ip-throttler.guard';
import { RiceSsoService } from './rice-sso.service';
import { setRefreshCookie } from './cookie.util';

/**
 * Broker đăng nhập Google (luồng redirect server-side).
 *
 * 1. FE mở `GET /api/auth/google/start` → BE (giữ RICE_API_KEY) hỏi RiceService lấy
 *    Google authorize URL rồi 302 sang. FE KHÔNG cần bake Google client_id.
 * 2. User đăng nhập Google → RiceService 302 về `GET /api/auth/google/callback?code=`
 *    (mã dùng 1 lần, KHÔNG phải token).
 * 3. BE đổi code lấy access + refresh token (server-to-server), cất refresh token vào
 *    cookie httpOnly rồi 302 về FE. Refresh token không hề lộ ra URL hay JS.
 * 4. FE gọi `POST /api/auth/refresh` để lấy access token đầu tiên.
 */
@Controller('auth/google')
export class SsoLoginController {
  private readonly logger = new Logger(SsoLoginController.name);

  constructor(private readonly rice: RiceSsoService) {}

  /** Origin của web app (nơi kết thúc luồng đăng nhập). */
  private webOrigin(): string {
    const explicit = (process.env.WEB_APP_URL || '').trim();
    if (explicit) return explicit.replace(/\/+$/, '');
    const first = (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)[0];
    return (first || '').replace(/\/+$/, '');
  }

  /**
   * Origin công khai của chính BE — RiceService redirect về đây, nên phải nằm trong
   * allowedOrigins của tenant ở RiceService. Suy từ request (đã bật trust proxy),
   * cho phép ghi đè bằng API_PUBLIC_URL nếu sau proxy host bị viết lại.
   */
  private apiOrigin(req: Request): string {
    const explicit = (process.env.API_PUBLIC_URL || '').trim();
    if (explicit) return explicit.replace(/\/+$/, '');
    return `${req.protocol}://${req.get('host')}`;
  }

  // Chống spam khởi tạo đăng nhập: 10 lần/phút/IP.
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseGuards(IpThrottlerGuard)
  @Get('start')
  async start(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.rice.configured || !this.webOrigin()) {
      res.status(500).send('SSO chưa cấu hình (RICE_ENDPOINT / RICE_API_KEY / WEB_APP_URL|ALLOWED_ORIGINS)');
      return;
    }
    try {
      res.redirect(302, await this.rice.authorizeUrl(`${this.apiOrigin(req)}/api/auth/google/callback`));
    } catch {
      res.status(502).send('Không khởi tạo được đăng nhập Google');
    }
  }

  /**
   * RiceService redirect về đây kèm `?code=`. Đổi code → phiên, cất refresh token vào
   * cookie httpOnly, rồi 302 về FE (URL sạch, không mang token).
   */
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('error') ssoError: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const web = this.webOrigin();
    if (!code) {
      // RiceService đưa user về đây kèm ?error= khi state hỏng/hết hạn hoặc user bấm huỷ.
      // Ghi lại lý do — không có dòng này thì lỗi đăng nhập là hộp đen.
      this.logger.warn(`callback không có code (error=${ssoError || 'không rõ'})`);
      res.redirect(302, `${web}/login?error=sso`);
      return;
    }
    try {
      const session = await this.rice.exchange(code);
      setRefreshCookie(req, res, session.refreshToken, this.rice.refreshIdleDays);
      res.redirect(302, `${web}/auth/callback`);
    } catch (e) {
      this.logger.error(`đổi code lấy phiên thất bại: ${e instanceof Error ? e.message : String(e)}`);
      res.redirect(302, `${web}/login?error=sso`);
    }
  }
}
