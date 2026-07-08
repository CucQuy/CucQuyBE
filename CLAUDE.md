# CucQuy Backend — Project Guide

NestJS API cho tiệm bánh. **Postgres raw SQL — KHÔNG ORM.** Phục vụ `api.cucquy.site`.

## Kiến trúc dữ liệu (quan trọng)
- Toàn bộ logic data nằm trong **stored function Postgres** (schema `public`), file ở `migrations/functions/<domain>.sql` (xem `_CONVENTION.md`).
- 3 tầng: stored function ← **`<domain>.proc.ts`** (`@Injectable`, NƠI DUY NHẤT gọi DbService/`this.db.sql`) ← `<domain>.service.ts` (orchestration + map) ← controller.
- Driver: **postgres.js**, wrapper `src/db/db.service.ts` (đọc `DATABASE_URL`).
- 🔴 GOTCHA jsonb: KHÔNG `${JSON.stringify(x)}::jsonb` (double-encode → null). Dùng `${this.db.json(x)}::jsonb` (= `sql.json`).
- Auth: verify SSO JWT (RiceService) ở `sso-auth.guard`, nạp role từ Postgres `user_get`. Ảnh: RiceService object storage (`images.service`).

## Env / deploy
- Env từ k8s secret `cucquy-backend-env` (xem `.env.example`). `APP_ENV` = production/staging/local → prefix noti Zalo.
- Deploy: **merge `staging`/`production` → GitHub Actions build+push GHCR → keel rollout** (`.github/workflows/deploy.yml`). KHÔNG deploy tay.
- ⚠️ Repo PUBLIC: không commit secret (postgres password, token…) vào file nào.

## BMAD
Product-level BMAD ở `../` (root CucQuy). Việc nhỏ/ops làm trực tiếp; feature lớn mới bật BMAD.
