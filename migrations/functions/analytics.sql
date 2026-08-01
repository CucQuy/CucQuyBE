-- Chuẩn hoá TỈNH/THÀNH từ address free-text (khớp không dấu; 5 TP lớn có alias).
-- Ưu tiên khớp cụm rõ; không rõ → 'Khác'. Dùng cho phân tích giao hàng theo tỉnh.
CREATE OR REPLACE FUNCTION order_province(p_address text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH a AS (SELECT ' ' || unaccent(lower(coalesce(p_address, ''))) || ' ' AS s),
  provs(ord, canon, pat) AS (VALUES
    (1,  'TP. Hồ Chí Minh', 'ho chi minh|hcm|tphcm|sai gon|thu duc|go vap|tan binh|tan phu|binh tan|binh chanh|phu nhuan|nha be|hoc mon|cu chi|can gio|q7|q9|q12'),
    (2,  'Hà Nội',          'ha noi| hn |,hn|\.hn|hai ba trung|cau giay|tu liem|ha dong|hoang mai|long bien|thanh xuan|dong da'),
    (3,  'Đà Nẵng',         'da nang'),
    (4,  'Hải Phòng',       'hai phong'),
    (5,  'Cần Thơ',         'can tho'),
    (6,  'Lâm Đồng',        'lam dong|da lat|bao loc'),
    (7,  'Bắc Ninh',        'bac ninh|tu son|phat tich'),
    (8,  'Bắc Giang',       'bac giang'),
    (9,  'Bình Dương',      'binh duong|di an|thuan an'),
    (10, 'Đồng Nai',        'dong nai|bien hoa'),
    (11, 'Bà Rịa - Vũng Tàu','vung tau|ba ria'),
    (12, 'Khánh Hòa',       'khanh hoa|nha trang|cam ranh'),
    (13, 'Thừa Thiên Huế',  'thua thien| hue |,hue|\.hue'),
    (14, 'Quảng Nam',       'quang nam|hoi an|tam ky'),
    (15, 'Quảng Ngãi',      'quang ngai'),
    (16, 'Bình Định',       'binh dinh|quy nhon'),
    (17, 'Phú Yên',         'phu yen|tuy hoa'),
    (18, 'Nghệ An',         'nghe an'),
    (19, 'Hà Tĩnh',         'ha tinh'),
    (20, 'Thanh Hóa',       'thanh hoa'),
    (21, 'Quảng Bình',      'quang binh|dong hoi'),
    (22, 'Quảng Trị',       'quang tri'),
    (23, 'Nam Định',        'nam dinh'),
    (24, 'Thái Bình',       'thai binh'),
    (25, 'Ninh Bình',       'ninh binh'),
    (26, 'Hà Nam',          'ha nam'),
    (27, 'Hưng Yên',        'hung yen'),
    (28, 'Hải Dương',       'hai duong'),
    (29, 'Vĩnh Phúc',       'vinh phuc'),
    (30, 'Phú Thọ',         'phu tho|viet tri'),
    (31, 'Thái Nguyên',     'thai nguyen'),
    (32, 'Quảng Ninh',      'quang ninh|ha long|cam pha'),
    (33, 'Lào Cai',         'lao cai|sa pa|sapa'),
    (34, 'Yên Bái',         'yen bai'),
    (35, 'Tuyên Quang',     'tuyen quang'),
    (36, 'Hòa Bình',        'hoa binh'),
    (37, 'Sơn La',          'son la'),
    (38, 'Điện Biên',       'dien bien'),
    (39, 'Lai Châu',        'lai chau'),
    (40, 'Hà Giang',        'ha giang'),
    (41, 'Cao Bằng',        'cao bang'),
    (42, 'Bắc Kạn',         'bac kan'),
    (43, 'Lạng Sơn',        'lang son'),
    (44, 'Gia Lai',         'gia lai|pleiku'),
    (45, 'Kon Tum',         'kon tum'),
    (46, 'Đắk Lắk',         'dak lak|dac lac|buon ma thuot'),
    (47, 'Đắk Nông',        'dak nong|dac nong|gia nghia'),
    (48, 'Ninh Thuận',      'ninh thuan|phan rang'),
    (49, 'Bình Thuận',      'binh thuan|phan thiet'),
    (50, 'Tây Ninh',        'tay ninh'),
    (51, 'Bình Phước',      'binh phuoc|dong xoai'),
    (52, 'Long An',         'long an|tan an'),
    (53, 'Tiền Giang',      'tien giang|my tho'),
    (54, 'Bến Tre',         'ben tre'),
    (55, 'Trà Vinh',        'tra vinh'),
    (56, 'Vĩnh Long',       'vinh long'),
    (57, 'Đồng Tháp',       'dong thap|cao lanh|sa dec'),
    (58, 'An Giang',        'an giang|long xuyen|chau doc'),
    (59, 'Kiên Giang',      'kien giang|rach gia|phu quoc'),
    (60, 'Hậu Giang',       'hau giang|vi thanh'),
    (61, 'Sóc Trăng',       'soc trang'),
    (62, 'Bạc Liêu',        'bac lieu'),
    (63, 'Cà Mau',          'ca mau')
  )
  SELECT COALESCE(
    (SELECT canon FROM provs, a WHERE a.s ~ ('[ ,\./-]' || pat) ORDER BY ord LIMIT 1),
    'Khác');
$$;

-- ============================================================
-- Phân tích kinh doanh: tổng hợp số liệu đơn hàng cho trang "Phân tích".
-- Read-only, STABLE. Loại đơn test; doanh thu chỉ tính đơn KHÔNG huỷ.
-- Trả 1 jsonb gồm: KPI, tỉ lệ hình thức giao, doanh thu/đơn theo tháng,
-- nhu cầu theo thứ trong tuần, cơ cấu trạng thái/thanh toán, top sản phẩm,
-- shipDuration (thời gian giao đơn tỉnh), shipByProvince (giao theo tỉnh).
-- ============================================================
CREATE OR REPLACE FUNCTION analytics_overview()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT * FROM orders WHERE COALESCE(is_test, false) = false
  ),
  valid AS (
    SELECT * FROM base WHERE COALESCE(status, '') <> 'CANCELLED'
  )
  SELECT jsonb_build_object(
    'kpi', (
      SELECT jsonb_build_object(
        'orders', count(*),
        'revenue', COALESCE(sum(total), 0),
        'aov', CASE WHEN count(*) > 0 THEN round(COALESCE(sum(total), 0) / count(*)) ELSE 0 END,
        'shipProvinceOrders', count(*) FILTER (WHERE delivery_type = 'SHIP_PROVINCE'),
        'shipOrders', count(*) FILTER (WHERE delivery_type = 'SHIP'),
        'pickupOrders', count(*) FILTER (WHERE delivery_type = 'PICKUP'),
        'deliveredOrders', count(*) FILTER (WHERE status = 'DELIVERED'),
        'paidRevenue', COALESCE(sum(paid_amount), 0)
      ) FROM valid
    ),
    'deliveryType', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.orders DESC), '[]'::jsonb) FROM (
        SELECT COALESCE(NULLIF(delivery_type, ''), 'UNKNOWN') AS type,
               count(*) AS orders, COALESCE(sum(total), 0) AS revenue
        FROM valid GROUP BY 1
      ) t
    ),
    'byMonth', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.month), '[]'::jsonb) FROM (
        SELECT to_char(order_date, 'YYYY-MM') AS month,
               count(*) AS orders, COALESCE(sum(total), 0) AS revenue
        FROM valid WHERE order_date IS NOT NULL GROUP BY 1
      ) t
    ),
    'byDow', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.dow), '[]'::jsonb) FROM (
        SELECT extract(dow FROM order_date)::int AS dow,
               count(*) AS orders, COALESCE(sum(total), 0) AS revenue
        FROM valid WHERE order_date IS NOT NULL GROUP BY 1
      ) t
    ),
    'statusBreakdown', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.orders DESC), '[]'::jsonb) FROM (
        SELECT COALESCE(NULLIF(status, ''), 'UNKNOWN') AS status, count(*) AS orders
        FROM base GROUP BY 1
      ) t
    ),
    'paymentBreakdown', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.orders DESC), '[]'::jsonb) FROM (
        SELECT COALESCE(NULLIF(payment_status, ''), 'UNKNOWN') AS status, count(*) AS orders
        FROM valid GROUP BY 1
      ) t
    ),
    'topProducts', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.qty DESC), '[]'::jsonb) FROM (
        SELECT oi.product_name AS name,
               sum(COALESCE(oi.quantity, 0)) AS qty,
               sum(COALESCE(oi.quantity, 0) * COALESCE(oi.unit_price, 0)) AS revenue
        FROM order_items oi JOIN valid v ON v.id = oi.order_id
        WHERE COALESCE(oi.product_name, '') <> ''
        GROUP BY 1 ORDER BY qty DESC LIMIT 15
      ) t
    ),
    -- Đơn TỈNH: thời gian SPX giao THỰC = từ lúc nhận hàng (shipped_at) đến lúc giao (delivered_at).
    -- days = số ngày (lịch, giờ VN). Không xét sớm/trễ, chỉ đo mất bao lâu.
    'shipDuration', (
      WITH tl AS (
        SELECT order_number,
               (shipped_at   AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS shipped_date,
               (delivered_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS delivered_date,
               ((delivered_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
                 - (shipped_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) AS days
        FROM orders
        WHERE delivery_type = 'SHIP_PROVINCE' AND COALESCE(is_test, false) = false
          AND delivered_at IS NOT NULL AND shipped_at IS NOT NULL
      )
      SELECT jsonb_build_object(
        'count', (SELECT count(*) FROM tl),
        'avgDays', (SELECT COALESCE(round(avg(days)::numeric, 1), 0) FROM tl),
        'minDays', (SELECT COALESCE(min(days), 0) FROM tl),
        'maxDays', (SELECT COALESCE(max(days), 0) FROM tl),
        'orders', (SELECT COALESCE(jsonb_agg(o ORDER BY o.days DESC), '[]'::jsonb) FROM (
          SELECT order_number, shipped_date, delivered_date, days FROM tl
        ) o)
      )
    ),
    -- Đơn TỈNH gộp theo TỈNH/THÀNH (từ address): số đơn, số đã giao, TB ngày giao.
    -- Sắp theo TB ngày giao GIẢM (tỉnh giao lâu lên đầu); tỉnh chưa có mốc giao vẫn hiện (avgDays=null).
    'shipByProvince', (
      SELECT COALESCE(jsonb_agg(t ORDER BY (t.avg_days IS NULL), t.avg_days DESC, t.orders DESC), '[]'::jsonb)
      FROM (
        SELECT order_province(address) AS province,
               count(*) AS orders,
               count(*) FILTER (WHERE delivered_at IS NOT NULL AND shipped_at IS NOT NULL) AS delivered,
               round(avg(((delivered_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
                          - (shipped_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date))
                     FILTER (WHERE delivered_at IS NOT NULL AND shipped_at IS NOT NULL)::numeric, 1) AS avg_days
        FROM orders
        WHERE delivery_type = 'SHIP_PROVINCE' AND COALESCE(is_test, false) = false
        GROUP BY 1
      ) t
    ),
    'generatedAt', now()
  );
$$;
