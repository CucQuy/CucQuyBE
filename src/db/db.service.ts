import { Injectable, OnModuleDestroy } from '@nestjs/common';
import postgres, { type Sql } from 'postgres';

/**
 * Bọc Postgres (postgres.js) — chỗ duy nhất chạm DB SQL.
 * Dùng raw SQL qua tagged template: `db.sql\`select ...\`` (tự tham số hoá).
 * Cấu hình qua env DATABASE_URL (mặc định: Postgres local docker).
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly sql: Sql;

  constructor() {
    const url =
      process.env.DATABASE_URL ||
      'postgresql://cucquy:cucquy_dev@localhost:5432/cucquy';
    this.sql = postgres(url, {
      max: 10, // pool size
      idle_timeout: 30,
      onnotice: () => {}, // tắt log NOTICE ồn ào
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }

  /**
   * Bọc giá trị thành tham số JSONB cho postgres.js (chấp nhận mọi kiểu).
   * QUAN TRỌNG: dùng cái này thay `JSON.stringify(x)::jsonb` — JSON.stringify bị
   * postgres.js double-encode thành jsonb string → `->>'field'` trả null.
   * Dùng: `db.sql\`... app.fn(${db.json(obj)}::jsonb)\``.
   */
  json(value: unknown) {
    return this.sql.json(value as never);
  }
}
