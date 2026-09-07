-- Chức năng thông báo Zalo thành DỮ LIỆU (thêm từ UI, không cần deploy).
--
-- Trước: 12 key hardcode trong code (ZALO_NOTIFY_FEATURES) + 4 loại nội dung hardcode
-- trong notification-schedules.service. Muốn thêm 1 nhắc việc mới là phải sửa code.
--
-- Sau: bảng zalo_features vừa là danh mục (nhãn, mô tả, nhóm hiển thị) vừa là cờ
-- bật/tắt. Loại 'template': người dùng tự gõ nội dung + chèn biến {{...}} → không
-- cần code. Loại 'builtin': nội dung do code soạn (giữ nguyên), không cho xoá.
CREATE TABLE IF NOT EXISTS zalo_features (
  feature     text PRIMARY KEY,
  label       text NOT NULL,
  description text,
  -- 'builtin' = nội dung do code soạn | 'template' = user tự gõ (render biến).
  kind        text NOT NULL DEFAULT 'template',
  -- Nhóm hiển thị ở màn Chức năng (UI tự sinh section theo cột này).
  section     text NOT NULL DEFAULT 'Khác',
  -- Nội dung cho kind='template' (hỗ trợ {{ten_bien}}).
  template    text,
  -- Id bộ soạn nội dung của code (daily_summary / production_tomorrow /
  -- delivery_today_tomorrow / delivery_by_day). NULL = thông báo theo sự kiện
  -- (tạo/sửa/xoá đơn, thanh toán) → không đặt lịch được.
  composer    text,
  enabled     boolean NOT NULL DEFAULT true,
  -- builtin: không cho xoá/đổi key ở UI (code còn tham chiếu).
  builtin     boolean NOT NULL DEFAULT false,
  sort_order  int NOT NULL DEFAULT 100,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);

-- Seed 12 chức năng đang có; enabled lấy từ zalo_notify_flags (096) để không đổi
-- hành vi. composer chỉ đặt cho loại có thể lên lịch.
INSERT INTO zalo_features (feature, label, description, kind, section, composer, builtin, sort_order, enabled)
VALUES
  ('order_create',        'Tạo đơn',                'Có đơn mới → bắn vào nhóm.',                        'builtin', 'Đơn hàng',           NULL,                      true, 10, true),
  ('order_update',        'Sửa đơn',                'Đơn bị sửa → bắn kèm field thay đổi.',              'builtin', 'Đơn hàng',           NULL,                      true, 20, true),
  ('order_delete',        'Xoá đơn',                'Đơn bị xoá.',                                        'builtin', 'Đơn hàng',           NULL,                      true, 30, true),
  ('payment',             'Thanh toán',             'Webhook SePay báo tiền về.',                         'builtin', 'Thanh toán',         NULL,                      true, 40, true),
  ('delivery_due',        'Đơn cần giao',           'Danh sách đơn tới hạn giao.',                        'builtin', 'Nhắc việc theo ngày', 'delivery_today_tomorrow', true, 50, true),
  ('production_tomorrow', 'Sản xuất ngày mai',      'Đơn cần làm cho ngày mai.',                          'builtin', 'Nhắc việc theo ngày', 'production_tomorrow',     true, 60, true),
  ('unpaid',              'Đơn chưa thanh toán',    'Đơn còn nợ tiền.',                                   'builtin', 'Nhắc việc theo ngày', NULL,                      true, 70, true),
  ('pending',             'Đơn chờ xử lý',          'Đơn đang ở trạng thái chờ.',                         'builtin', 'Nhắc việc theo ngày', NULL,                      true, 80, true),
  ('stuck_pending',       'Đơn treo lâu',           'Đơn chờ quá ngưỡng giờ.',                            'builtin', 'Nhắc việc theo ngày', NULL,                      true, 90, true),
  ('daily_summary',       'Tổng kết ngày',          'Doanh thu, số đơn, món bán chạy.',                   'builtin', 'Tổng hợp & khác',    'daily_summary',           true, 100, true),
  ('custom',              'Tin tuỳ chỉnh',          'Tin gõ tay gửi từ màn Thông báo.',                   'builtin', 'Tổng hợp & khác',    NULL,                      true, 110, true),
  ('health_check',        'Kiểm tra kết nối',       'Tin thử để biết bridge Zalo còn sống.',              'builtin', 'Tổng hợp & khác',    NULL,                      true, 120, true)
ON CONFLICT (feature) DO NOTHING;

-- Kế thừa trạng thái bật/tắt đã set ở màn Chức năng (096).
UPDATE zalo_features f
   SET enabled = fl.enabled
  FROM zalo_notify_flags fl
 WHERE fl.feature = f.feature;

-- Thêm loại 'delivery_by_day' làm chức năng lên lịch được (trước đây chỉ là composer
-- của lịch, không có chỗ gán nhóm/bật tắt) — dùng chung nhóm với 'Đơn cần giao'.
INSERT INTO zalo_features (feature, label, description, kind, section, composer, builtin, sort_order, enabled)
VALUES ('delivery_by_day', 'Đơn cần giao (gom theo ngày)',
        'Đơn còn phải giao, gom theo từng ngày — chọn ngày bắt đầu + số ngày ở lịch nhắc.',
        'builtin', 'Nhắc việc theo ngày', 'delivery_by_day', true, 55, true)
ON CONFLICT (feature) DO NOTHING;

UPDATE zalo_groups
   SET notify_features = array_append(notify_features, 'delivery_by_day')
 WHERE 'delivery_due' = ANY (notify_features)
   AND NOT ('delivery_by_day' = ANY (notify_features));
