# CucQuyBakery — Backend (NestJS)

Backend tách khỏi FE, **Postgres raw SQL (KHÔNG ORM)**. Mục tiêu: bảo mật/ẩn
logic, trung tâm hóa nghiệp vụ, chạy webhook/job server-side. FE login qua **SSO
RiceService** và gửi JWT; server verify token + phân quyền theo `role` bảng `users`.

## Cài đặt
```bash
npm install
cp .env.example .env   # điền DATABASE_URL + SSO_JWT_SECRET + ALLOWED_ORIGINS...
npm run start:dev      # http://localhost:3000/api
```

### Env chính
`DATABASE_URL` (Postgres), `SSO_JWT_SECRET` (trùng RiceService để verify JWT),
`RICE_ENDPOINT`/`RICE_BUCKET`/`RICE_API_KEY` (lưu ảnh), `ALLOWED_ORIGINS`, `APP_ENV`.
Xem `.env.example`.

## Kiến trúc
- `src/db/` — wrapper `DbService` (postgres.js); logic data ở stored function `migrations/functions/*.sql`.
- `src/auth/` — `SsoAuthGuard` (verify SSO JWT, nạp role) + `RolesGuard` + `@Roles`/`@CurrentUser`/`@Public`.
- `src/modules/<domain>/` — controller + service + dto. Mỗi domain port dần từ `services/` của FE.

## Endpoints hiện có
| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/health` | public | health check |
| GET | `/api/commission/summaries` | admin | thống kê HH tất cả CTV |
| GET | `/api/commission/me` | đã đăng nhập | HH của chính mình |
| POST | `/api/commission/mark-paid` | admin | `{ orderIds }` đánh dấu đã trả |
| POST | `/api/commission/mark-pending` | admin | `{ orderIds }` đặt lại chưa trả |

Mọi request (trừ `@Public`) cần header `Authorization: Bearer <SSO JWT>`.

Các domain CRUD khác đều theo cùng pattern (đều cần đăng nhập): `/api/products`,
`/api/customers`, `/api/expenses`, `/api/transactions`, `/api/categories`,
`/api/badges`, `/api/commission-groups`, `/api/configurations/*`, `/api/users`,
`/api/orders`, `/api/stock-receipts`, `/api/admin-db/*`, `/api/images/*`.

### Webhook (PUBLIC — không cần token)
| Method | Path | Mô tả |
|---|---|---|
| POST | `/api/webhooks/sepay` | SePay: lưu transaction + set order PAID nếu khớp orderNumber |
| POST | `/api/webhooks/facebook` | Fanpage inbox: lưu message (idempotent theo `id_new_message`) |

Trả format GỐC của nhà cung cấp (không bọc envelope `{data,...}`).
⚠️ **URL đổi** so với bản Vercel cũ (`/api/sepay/webhook`, `/api/facebook/webhook`):
sau khi deploy BE phải cập nhật URL webhook trong dashboard **SePay** và **Facebook
service** sang `https://<be-domain>/api/webhooks/sepay` · `/facebook`.

## Deploy (Railway/Render/Fly)
- Build: `npm run build` · Start: `npm run start:prod` (hoặc dùng `Dockerfile`).
- Set env: `DATABASE_URL`, `SSO_JWT_SECRET`, `RICE_ENDPOINT`/`RICE_BUCKET`/`RICE_API_KEY`, `ALLOWED_ORIGINS`, `PORT`.
- ⚠️ Secret (DB password, SSO_JWT_SECRET, API key) — chỉ để ở env, không commit.

## Lộ trình
- [x] Phase 0: khung + Auth/Roles (SSO) + health.
- [x] Phase 1: domain **commission** (pilot).
- [x] Phase 2: products, customers, expenses, transactions, categories, badges, commissionGroups, configurations, users, orders, stockReceipt, admin-db, images.
- [x] Webhook sepay + facebook.
- [ ] Job nền còn lại: zalo notify (đang ở FE sau khi gọi API), gemini/ocr, cron.
