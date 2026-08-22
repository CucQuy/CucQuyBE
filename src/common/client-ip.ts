import type { Request } from 'express';

/**
 * IP thật của client sau Cloudflare Tunnel + k3s (traefik/nginx).
 * Ưu tiên Cf-Connecting-Ip; fallback x-forwarded-for → x-real-ip → req.ip.
 * Bỏ tiền tố IPv4-mapped-IPv6 "::ffff:".
 */
export function getClientIp(req: Request): string {
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
