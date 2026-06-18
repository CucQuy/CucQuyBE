# Quy ước: move logic xuống stored function (Postgres) — CucQuy

Mục tiêu: MỌI logic data nằm trong stored function trong schema **`public`** (1 app sở hữu toàn DB → không cần schema riêng); service NestJS chỉ GỌI.

## Naming
- Schema: **`public`** cho cả bảng lẫn function (KHÔNG tách `app`, KHÔNG prefix tên app vào bảng).
- Hàm: `<domain>_<action>` snake_case (trong public). Action: `list / get / upsert / save_all / delete / <verb>` (compute/create…).
- Tham số: prefix `p_` (tránh đụng tên cột trong plpgsql). VD `p_id`, `p_items jsonb`.
- Luôn `CREATE OR REPLACE FUNCTION` (idempotent). LANGUAGE `sql` cho read đơn giản, `plpgsql` khi nhiều bước.
- Input nhiều field/nhiều dòng → nhận **`jsonb`** (client gửi camelCase, hàm tự đọc `x->>'fieldName'` + tự lọc validation).
- Output → `RETURNS SETOF <table>` hoặc `RETURNS TABLE(...)` (read) / `jsonb` (kết quả tính toán).

## File
- Mỗi domain 1 file: `backend/migrations/functions/<domain>.sql`.
- Áp vào DB: `docker exec -i cucquy-postgres psql -U cucquy -d cucquy -v ON_ERROR_STOP=1 -q < migrations/functions/<domain>.sql`

## Model (TS)
- Cập nhật `src/modules/<module>/<domain>.types.ts` cho KHỚP cột bảng (giữ field name camelCase mà API/FE đang dùng).

## Tầng PROC (bắt buộc) + Service
- Mỗi module có **`<domain>.proc.ts`**: class `@Injectable() <Domain>Proc` inject `DbService`, CHỈ ở đây mới gọi function DB. Mỗi method = 1 lời gọi proc, trả raw rows (snake_case), export kèm type Row.
  - Gọi: `this.db.sql\`SELECT ... FROM fn(...)\``; truyền jsonb: `${this.db.json(x)}::jsonb  // KHÔNG dùng JSON.stringify (double-encode!)`.
- **Service** import `<Domain>Proc`, chỉ orchestration + map snake_case→field cũ. KHÔNG gọi `this.db.sql` trực tiếp trong service.
- **Module**: thêm `<Domain>Proc` vào `providers`.
- MẪU: `src/modules/categories/categories.proc.ts` + `categories.service.ts` + `categories.module.ts`.

## MẪU THAM CHIẾU (đã xong, copy y pattern):
- `migrations/functions/categories.sql` — `category_list()`, `category_save_all(p_items jsonb)`.
- `src/modules/categories/categories.service.ts` — service chỉ gọi proc.

## Verify (KHÔNG phá data)
- `npx tsc --noEmit -p tsconfig.json` phải pass.
- Test proc bằng SELECT đọc (KHÔNG chạy save_all với list rỗng/thiếu → sẽ xoá data!).
- Xem schema bảng: `docker exec cucquy-postgres psql -U cucquy -d cucquy -c "\d <table>"`.
