import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as geoip from 'geoip-lite';
import { AuthUser } from '../../auth/user.types';
import { GeoInfo, RequestLogsService } from './request-logs.service';

/** Path bỏ qua (noise / tránh tự log đệ quy). So khớp theo prefix. */
const SKIP_PREFIXES = ['/api/request-logs', '/api/docs', '/api/health'];

/** Field nhạy cảm trong body → thay bằng '[REDACTED]' (không lưu giá trị thật). */
const SENSITIVE_KEYS = [
  'password',
  'pass',
  'token',
  'idtoken',
  'accesstoken',
  'refreshtoken',
  'secret',
  'apikey',
  'authorization',
  'otp',
  'pin',
  'cvv',
  'cardnumber',
];

/** Độ dài tối đa của body (ký tự) lưu vào log — tránh phình DB. */
const MAX_BODY_LEN = 4000;

/** Method có body cần ghi lại. */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Đệ quy che giá trị các field nhạy cảm (so khớp tên field, không phân biệt hoa thường). */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.includes(k.toLowerCase()) ? '[REDACTED]' : redact(v);
    }
    return out;
  }
  return value;
}

/** Chuyển body request thành chuỗi JSON đã redact + cắt bớt; null nếu rỗng. */
function serializeBody(method: string, body: unknown): string | null {
  if (!BODY_METHODS.has(method)) return null;
  if (body === undefined || body === null) return null;
  if (typeof body === 'object' && Object.keys(body as object).length === 0) return null;
  try {
    let str = JSON.stringify(redact(body));
    if (str.length > MAX_BODY_LEN) str = str.slice(0, MAX_BODY_LEN) + '…[truncated]';
    return str;
  } catch {
    return null;
  }
}

/**
 * Ghi lại MỌI request (kể cả 401/403/404). Dùng middleware thay vì interceptor
 * vì interceptor không chạy khi Guard chặn request. Hook `res.on('finish')` để
 * đọc status + duration + req.user (Guard đã gắn xong tại thời điểm này), rồi
 * ghi log bất đồng bộ — KHÔNG chặn response.
 */
@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  constructor(private readonly logs: RequestLogsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const qIdx = req.originalUrl.indexOf('?');
    const path = qIdx === -1 ? req.originalUrl : req.originalUrl.slice(0, qIdx);
    const query = qIdx === -1 ? '' : req.originalUrl.slice(qIdx);

    // Bỏ preflight CORS và các path nhiễu.
    if (req.method === 'OPTIONS' || SKIP_PREFIXES.some((p) => path.startsWith(p))) {
      return next();
    }

    const start = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - start;
      const ip = this.extractIp(req);
      const geo = this.lookupGeo(ip);
      const user = (req as Request & { user?: AuthUser }).user;
      const lenHeader = res.getHeader('content-length');
      const responseSize = lenHeader ? Number(lenHeader) : null;
      const referer = (req.headers['referer'] ?? req.headers['referrer'] ?? null) as string | null;

      // Fire-and-forget — không await.
      void this.logs.writeLog({
        method: req.method,
        path,
        query,
        statusCode: res.statusCode,
        durationMs,
        responseSize: Number.isFinite(responseSize) ? responseSize : null,
        ip,
        geo,
        uid: user?.uid ?? null,
        email: user?.email ?? null,
        role: user?.role ?? null,
        userAgent: req.headers['user-agent'] ?? '',
        referer,
        body: serializeBody(req.method, (req as Request & { body?: unknown }).body),
      });
    });

    next();
  }

  /**
   * IP thật của khách. Sau Cloudflare Tunnel + k3s, req.ip/socket chỉ là IP proxy
   * nội bộ (vd 10.42.0.x). Cloudflare luôn set `CF-Connecting-IP` = IP client thật;
   * fallback X-Forwarded-For (phần tử đầu) → X-Real-IP → req.ip. Bỏ tiền tố IPv6-mapped.
   */
  private extractIp(req: Request): string {
    const header = (name: string): string => {
      const v = req.headers[name];
      const s = Array.isArray(v) ? v[0] : v;
      return (s ?? '').split(',')[0].trim();
    };
    const raw =
      header('cf-connecting-ip') ||
      header('x-forwarded-for') ||
      header('x-real-ip') ||
      req.ip ||
      req.socket?.remoteAddress ||
      '';
    return raw.replace(/^::ffff:/, '');
  }

  private lookupGeo(ip: string): GeoInfo | null {
    try {
      const g = geoip.lookup(ip);
      if (!g) return null;
      return {
        country: g.country,
        region: g.region,
        city: g.city,
        lat: g.ll?.[0],
        lng: g.ll?.[1],
      };
    } catch {
      return null;
    }
  }
}
