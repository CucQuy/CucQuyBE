import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/roles.decorator';
import { DbService } from '../db/db.service';

/** Sức khỏe hệ thống (public — dùng cho uptime monitor + tab Giám sát). */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Public()
  @Get()
  async check() {
    let dbOk = false;
    let dbLatencyMs: number | null = null;
    const t0 = Date.now();
    try {
      await this.db.sql`SELECT 1`;
      dbOk = true;
      dbLatencyMs = Date.now() - t0;
    } catch {
      dbOk = false;
    }
    return {
      status: dbOk ? 'ok' : 'degraded',
      service: 'cucquy-bakery-server',
      db: dbOk,
      dbLatencyMs,
      uptimeSec: Math.round(process.uptime()),
      env: String(process.env.APP_ENV ?? 'local'),
      version: String(process.env.APP_VERSION ?? process.env.npm_package_version ?? ''),
      time: new Date().toISOString(),
    };
  }
}
