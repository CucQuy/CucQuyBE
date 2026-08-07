-- ============================================================
-- Chấm công nhân viên (attendance) + Face ID + giới hạn IP mạng quán.
--  * Link employees ⇄ tài khoản đăng nhập (users) qua email (NV đăng nhập Google SSO).
--  * Lưu vector khuôn mặt (128 số) đã đăng ký để so khớp 1:1 (nhận diện xử lý ở BE).
--  * Whitelist mạng quán (cidr) — chỉ chấm công khi IP request nằm trong dải cho phép.
-- Nhận diện/so khớp khuôn mặt do backend tính (face-api + tfjs wasm); DB chỉ lưu vector.
-- ============================================================

-- Email để nối hồ sơ nhân sự với tài khoản đăng nhập (SSO). NULL = chưa gắn tài khoản.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS email text;
CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(lower(email));

-- Vector khuôn mặt đã đăng ký của nhân viên (cho phép nhiều mẫu → khớp theo min distance).
CREATE TABLE IF NOT EXISTS employee_face_descriptors (
  id          text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  descriptor  jsonb NOT NULL,               -- mảng 128 số float (Face embedding)
  image_url   text,                          -- ảnh tham chiếu lúc đăng ký (RiceService)
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_face_desc_employee ON employee_face_descriptors(employee_id);

-- Bản ghi chấm công (mỗi lần vào/ra là 1 dòng).
CREATE TABLE IF NOT EXISTS attendance_records (
  id            text PRIMARY KEY,
  employee_id   text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind          text NOT NULL,               -- 'in' (vào ca) | 'out' (tan ca)
  checked_at    timestamptz NOT NULL DEFAULT now(),
  ip            text,                          -- IP client lúc chấm (audit)
  face_distance numeric,                       -- khoảng cách khớp khuôn mặt (log, càng nhỏ càng khớp)
  image_url     text,                          -- ảnh chụp lúc chấm (audit, có thể null)
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attendance_emp_time ON attendance_records(employee_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_checked_at ON attendance_records(checked_at DESC);

-- Whitelist mạng quán: IP/dải IP public (nhìn từ Cloudflare) được phép chấm công.
CREATE TABLE IF NOT EXISTS attendance_allowed_networks (
  id         text PRIMARY KEY,
  label      text,                            -- nhãn dễ nhớ (vd 'Wifi quán')
  ip_cidr    cidr NOT NULL,                   -- 1 IP => /32; dải => vd 1.2.3.0/24
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
