-- ============================================================
-- VẬN CHUYỂN — thống kê theo ĐƠN VỊ VẬN CHUYỂN (DVVC).
-- DVVC suy từ tiền tố tracking_number (chưa có field carrier riêng).
-- Read-only, STABLE. order_province tái định nghĩa ở đây (dùng cho phân bố tỉnh).
-- ============================================================

-- DVVC từ mã vận đơn. SPX (Shopee Express) là chính; mở rộng khi có mã hãng khác.
-- Đơn không có mã → 'Chưa có mã / Tự giao' (pickup / ship nội thành / chưa sync).
CREATE OR REPLACE FUNCTION order_carrier(p_tracking text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_tracking ILIKE 'SPX%'                          THEN 'SPX (Shopee Express)'
    WHEN p_tracking ILIKE 'GHTK%'                         THEN 'GHTK'
    WHEN p_tracking ILIKE 'GHN%'                          THEN 'GHN'
    WHEN p_tracking ILIKE 'JT%' OR p_tracking ILIKE 'J&T%' THEN 'J&T Express'
    WHEN p_tracking ILIKE 'VTP%' OR p_tracking ILIKE 'VIETTEL%' THEN 'Viettel Post'
    WHEN COALESCE(p_tracking, '') <> ''                   THEN 'Khác'
    ELSE 'Chưa có mã / Tự giao'
  END;
$$;

-- Chuẩn hoá TỈNH/THÀNH từ address free-text (khớp không dấu; 5 TP lớn có alias).
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

-- Thống kê chỉ số theo DVVC trong kỳ (p_from/p_to NULL = toàn bộ). Đơn KHÔNG test/huỷ.
-- Trả jsonb:
--   carriers[]: mỗi DVVC → số đơn, doanh thu, AOV, phí ship TB; đã giao/đang giao/kẹt;
--               thời gian giao (count/avg/min/max) + histogram 1/2/3/4/5+ ngày.
--   stuckOrders[]: đơn đã gửi ≥4 ngày chưa có mốc giao (theo DVVC).
--   byProvince[]: đơn ship tỉnh gộp theo (DVVC, tỉnh) → số đơn, đã giao, TB ngày giao.
CREATE OR REPLACE FUNCTION shipping_analytics(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH valid AS (
    SELECT *, order_carrier(tracking_number) AS carrier
    FROM orders
    WHERE COALESCE(is_test, false) = false
      AND COALESCE(status, '') <> 'CANCELLED'
      AND (p_from IS NULL OR order_date >= p_from)
      AND (p_to   IS NULL OR order_date <  (p_to + 1))
  ),
  dur AS (
    SELECT carrier,
           ((delivered_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
             - (shipped_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) AS days
    FROM valid WHERE shipped_at IS NOT NULL AND delivered_at IS NOT NULL
  )
  SELECT jsonb_build_object(
    'carriers', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.orders DESC), '[]'::jsonb) FROM (
        SELECT v.carrier AS carrier,
          count(*) AS orders,
          COALESCE(sum(total), 0) AS revenue,
          CASE WHEN count(*) > 0 THEN round(COALESCE(sum(total), 0) / count(*)) ELSE 0 END AS aov,
          COALESCE(round(avg(NULLIF(shipping_cost, 0))), 0) AS ship_avg,
          count(*) FILTER (WHERE status = 'DELIVERED') AS delivered,
          count(*) FILTER (WHERE COALESCE(status,'') <> 'DELIVERED'
                             AND shipped_at IS NOT NULL AND delivered_at IS NULL) AS in_transit,
          count(*) FILTER (WHERE COALESCE(status,'') <> 'DELIVERED'
                             AND shipped_at IS NOT NULL AND delivered_at IS NULL
                             AND (CURRENT_DATE - (shipped_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) >= 4) AS stuck,
          (SELECT count(*) FROM dur d WHERE d.carrier = v.carrier) AS dur_count,
          (SELECT COALESCE(round(avg(days)::numeric, 1), 0) FROM dur d WHERE d.carrier = v.carrier) AS avg_days,
          (SELECT COALESCE(min(days), 0) FROM dur d WHERE d.carrier = v.carrier) AS min_days,
          (SELECT COALESCE(max(days), 0) FROM dur d WHERE d.carrier = v.carrier) AS max_days,
          jsonb_build_object(
            'd1',  (SELECT count(*) FROM dur d WHERE d.carrier = v.carrier AND d.days <= 1),
            'd2',  (SELECT count(*) FROM dur d WHERE d.carrier = v.carrier AND d.days = 2),
            'd3',  (SELECT count(*) FROM dur d WHERE d.carrier = v.carrier AND d.days = 3),
            'd4',  (SELECT count(*) FROM dur d WHERE d.carrier = v.carrier AND d.days = 4),
            'd5p', (SELECT count(*) FROM dur d WHERE d.carrier = v.carrier AND d.days >= 5)
          ) AS histogram
        FROM valid v GROUP BY v.carrier
      ) t
    ),
    'stuckOrders', (
      SELECT COALESCE(jsonb_agg(x ORDER BY x.age_days DESC), '[]'::jsonb) FROM (
        SELECT carrier, order_number, customer_name,
               (shipped_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS shipped_date,
               (CURRENT_DATE - (shipped_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) AS age_days
        FROM valid
        WHERE COALESCE(status,'') <> 'DELIVERED'
          AND shipped_at IS NOT NULL AND delivered_at IS NULL
          AND (CURRENT_DATE - (shipped_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) >= 4
        ORDER BY age_days DESC LIMIT 50
      ) x
    ),
    'byProvince', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.orders DESC), '[]'::jsonb) FROM (
        SELECT carrier, order_province(address) AS province,
               count(*) AS orders,
               count(*) FILTER (WHERE delivered_at IS NOT NULL AND shipped_at IS NOT NULL) AS delivered,
               round(avg(((delivered_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
                          - (shipped_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date))
                     FILTER (WHERE delivered_at IS NOT NULL AND shipped_at IS NOT NULL)::numeric, 1) AS avg_days
        FROM valid WHERE delivery_type = 'SHIP_PROVINCE'
        GROUP BY carrier, order_province(address)
      ) t
    ),
    'generatedAt', now()
  );
$$;
