-- Chuẩn hoá TỈNH/THÀNH từ address free-text (khớp không dấu; 5 TP lớn có alias).
-- Ưu tiên khớp cụm rõ; không rõ → 'Khác'. Dùng cho phân tích giao hàng theo tỉnh.
-- Helper DÙNG CHUNG cho các hàm analytics theo domain (order_analytics dùng nó).
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
-- analytics_overview() ĐÃ TÁCH thành các hàm analytics theo domain
-- (order_analytics / product_analytics / customer_analytics /
--  commission_analytics / revenue_analytics) — mỗi hàm nhận p_from/p_to.
-- Drop hàm gộp cũ để dọn DB (idempotent, chạy mỗi lần boot).
-- ============================================================
DROP FUNCTION IF EXISTS analytics_overview();
