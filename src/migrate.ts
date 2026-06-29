/**
 * Bộ migrate chạy LÚC CONTAINER KHỞI ĐỘNG (trước khi Nest boot).
 *
 * Vì sao tồn tại: deploy CucQuy (merge -> GHCR -> keel) KHÔNG có bước nào apply
 * SQL lên DB. Trước đây phải chạy tay -> dễ quên -> code lên nhưng DB còn bản cũ,
 * tính năng "deploy thành công" mà không chạy. Script này tự đồng bộ DB mỗi lần boot.
 *
 * Cơ chế:
 *  1) Migration đánh số (`migrations/0NN_*.sql`): chạy MỘT LẦN theo thứ tự tên file,
 *     theo dõi trong bảng `schema_migrations`. File đã ghi -> bỏ qua.
 *  2) Stored function (`migrations/functions/*.sql`): re-apply MỌI lần boot
 *     (đều là CREATE OR REPLACE -> idempotent). Đổi return type của 1 function thì
 *     file đó PHẢI tự `DROP FUNCTION IF EXISTS ...` trước CREATE (CREATE OR REPLACE
 *     không đổi được return type).
 *
 * Lỗi -> exit(1): pod fail readiness, keel/k8s giữ pod cũ phục vụ -> sự cố HIỆN RÕ,
 * không âm thầm chạy với DB lệch.
 *
 * BASELINE: DB đang chạy (đã có sẵn schema) phải được seed `schema_migrations` với
 * toàn bộ filename hiện có TRƯỚC khi bản image này boot lần đầu, nếu không nó sẽ thử
 * chạy lại `001_init...` và vỡ. DB mới (rỗng) thì chạy tuần tự từ 001.
 */
import 'dotenv/config';
import postgres from 'postgres';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(process.cwd(), 'migrations');
const FUNCTIONS_DIR = join(MIGRATIONS_DIR, 'functions');

const listSql = (dir: string): string[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

async function main(): Promise<void> {
  const url =
    process.env.DATABASE_URL ||
    'postgresql://cucquy:cucquy_dev@localhost:5432/cucquy';
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    // 1) Migration đánh số — chạy 1 lần theo thứ tự
    const applied = new Set(
      (
        await sql<{ filename: string }[]>`SELECT filename FROM schema_migrations`
      ).map((r) => r.filename),
    );
    const migrations = listSql(MIGRATIONS_DIR);
    let ranCount = 0;
    for (const f of migrations) {
      if (applied.has(f)) continue;
      const content = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
      console.log(`[migrate] migration: ${f}`);
      await sql.begin(async (tx) => {
        await tx.unsafe(content).simple();
        await tx`INSERT INTO schema_migrations (filename) VALUES (${f})`;
      });
      ranCount += 1;
    }
    console.log(
      `[migrate] migrations: ${ranCount} mới / ${migrations.length} tổng`,
    );

    // 2) Stored functions — re-apply mỗi lần boot (CREATE OR REPLACE)
    const fnFiles = listSql(FUNCTIONS_DIR);
    for (const f of fnFiles) {
      const content = readFileSync(join(FUNCTIONS_DIR, f), 'utf8');
      await sql.unsafe(content).simple();
    }
    console.log(`[migrate] functions: ${fnFiles.length} file đã apply`);
    console.log('[migrate] done');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e: unknown) => {
  console.error('[migrate] FAILED:', e);
  process.exit(1);
});
