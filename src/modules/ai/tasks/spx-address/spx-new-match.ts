/**
 * Matcher địa chỉ hệ MỚI (2 cấp SPX: Tỉnh/Thành → Xã/Phường), grounded bằng danh mục
 * trong DB (bảng spx_state_new / spx_ward_new). Pure functions, không phụ thuộc Nest.
 * Song song `spx-old-match.ts` (3 cấp) — khác ở chỗ KHÔNG có tầng Quận/Huyện, và
 * ward khoá theo TỈNH (hệ mới xã/phường trực thuộc tỉnh).
 */

/** Bỏ dấu tiếng Việt + đ→d, lowercase, gom token cách nhau bởi khoảng trắng. */
export const norm = (s: string): string =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const stripState = (s: string): string => norm(s).replace(/^(tp|thanh pho|tinh)\s+/, '');
const stripWard = (s: string): string =>
  norm(s).replace(/^(phuong|xa|thi tran|dac khu|p|f|tt)\s+/, '');

/** True nếu `key` xuất hiện như cụm token trong `hay` (biên token). */
const containsPhrase = (hay: string, key: string): boolean => {
  if (!key) return false;
  const re = new RegExp(`(^| )${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
  return re.test(hay);
};

/** Địa chỉ 2 cấp: Tỉnh (dạng đầy đủ 'Thành phố Hà Nội') + Xã/Phường. */
export interface NewAddr {
  province: string;
  ward: string;
}

interface Key {
  key: string;
  val: string;
  len: number;
}

/** Quận/Huyện CŨ đặc trưng → suy ra tỉnh mới (địa chỉ khách hay còn ghi theo hệ cũ). */
const OLD_DISTRICT_HINTS: Record<string, string> = {
  'thu duc': 'ho chi minh',
  'binh thanh': 'ho chi minh',
  'go vap': 'ho chi minh',
  'tan binh': 'ho chi minh',
  'tan phu': 'ho chi minh',
  'phu nhuan': 'ho chi minh',
  'binh chanh': 'ho chi minh',
  'hoc mon': 'ho chi minh',
  'nha be': 'ho chi minh',
  'can gio': 'ho chi minh',
  'cu chi': 'ho chi minh',
  'binh tan': 'ho chi minh',
  'quan 1': 'ho chi minh',
  'quan 2': 'ho chi minh',
  'quan 3': 'ho chi minh',
  'quan 4': 'ho chi minh',
  'quan 5': 'ho chi minh',
  'quan 6': 'ho chi minh',
  'quan 7': 'ho chi minh',
  'quan 8': 'ho chi minh',
  'quan 9': 'ho chi minh',
  'quan 10': 'ho chi minh',
  'quan 11': 'ho chi minh',
  'quan 12': 'ho chi minh',
  'ba dinh': 'ha noi',
  'hoan kiem': 'ha noi',
  'dong da': 'ha noi',
  'hai ba trung': 'ha noi',
  'thanh xuan': 'ha noi',
  'cau giay': 'ha noi',
  'tay ho': 'ha noi',
  'long bien': 'ha noi',
  'hoang mai': 'ha noi',
  'ha dong': 'ha noi',
  'nam tu liem': 'ha noi',
  'bac tu liem': 'ha noi',
  'gia lam': 'ha noi',
  'dong anh': 'ha noi',
  'soc son': 'ha noi',
  'thanh tri': 'ha noi',
  'hoai duc': 'ha noi',
  'dan phuong': 'ha noi',
  'me linh': 'ha noi',
  'son tay': 'ha noi',
  'thach that': 'ha noi',
  'quoc oai': 'ha noi',
  'chuong my': 'ha noi',
  'thanh oai': 'ha noi',
  'thuong tin': 'ha noi',
  'phu xuyen': 'ha noi',
  'ung hoa': 'ha noi',
  'my duc': 'ha noi',
  'ba vi': 'ha noi',
  'phuc tho': 'ha noi',
};

/**
 * Dựng matcher từ danh mục MỚI. `resolve(address)` tách 2 cấp từ text tự do;
 * `snap(ai)` chuẩn hoá output AI về đúng chuỗi trong danh mục.
 */
export function createNewMatcher(
  states: string[],
  wards: { state: string; ward: string }[],
) {
  const wardsByState = new Map<string, string[]>();
  for (const { state, ward } of wards) {
    const arr = wardsByState.get(state) ?? [];
    arr.push(ward);
    wardsByState.set(state, arr);
  }

  // stripped-norm → tên tỉnh chuẩn (để alias/hint trỏ tới).
  const stateByStripped = new Map<string, string>();
  for (const s of states) stateByStripped.set(stripState(s), s);

  const alias: Record<string, string> = {};
  const addAlias = (a: string, strippedTarget: string) => {
    const st = stateByStripped.get(strippedTarget);
    if (st) alias[a] = st;
  };
  addAlias('hcm', 'ho chi minh');
  addAlias('tphcm', 'ho chi minh');
  addAlias('tp hcm', 'ho chi minh');
  addAlias('sai gon', 'ho chi minh');
  addAlias('saigon', 'ho chi minh');
  addAlias('sg', 'ho chi minh');
  addAlias('hanoi', 'ha noi');
  addAlias('hn', 'ha noi');
  addAlias('danang', 'da nang');
  // Tỉnh đã sáp nhập: địa chỉ ghi tên CŨ vẫn suy ra được tỉnh mới.
  addAlias('ba ria vung tau', 'ho chi minh');
  addAlias('binh duong', 'ho chi minh');
  addAlias('ha nam', 'ninh binh');
  addAlias('nam dinh', 'ninh binh');
  addAlias('vinh phuc', 'phu tho');
  addAlias('hoa binh', 'phu tho');
  addAlias('bac giang', 'bac ninh');
  addAlias('thai binh', 'hung yen');
  addAlias('hai duong', 'hai phong');
  addAlias('yen bai', 'lao cai');
  addAlias('ha giang', 'tuyen quang');
  addAlias('bac kan', 'thai nguyen');
  addAlias('quang nam', 'da nang');
  addAlias('binh dinh', 'gia lai');
  addAlias('phu yen', 'dak lak');
  addAlias('ninh thuan', 'khanh hoa');
  addAlias('binh thuan', 'lam dong');
  addAlias('dak nong', 'lam dong');
  addAlias('quang binh', 'quang tri');
  addAlias('kon tum', 'quang ngai');
  addAlias('tien giang', 'dong thap');
  addAlias('ben tre', 'vinh long');
  addAlias('tra vinh', 'vinh long');
  addAlias('long an', 'tay ninh');
  addAlias('hau giang', 'can tho');
  addAlias('soc trang', 'can tho');
  addAlias('bac lieu', 'ca mau');
  addAlias('kien giang', 'an giang');
  addAlias('thua thien hue', 'hue');

  // Khoá tỉnh: norm đầy đủ + norm bỏ prefix + alias. Ưu tiên key dài (đặc trưng).
  const stateKeys: Key[] = [];
  for (const s of states) {
    stateKeys.push({ key: norm(s), val: s, len: norm(s).length });
    const st = stripState(s);
    if (st && st !== norm(s)) stateKeys.push({ key: st, val: s, len: st.length });
  }
  for (const [a, s] of Object.entries(alias)) stateKeys.push({ key: a, val: s, len: a.length });
  // Quận cũ đặc trưng → tỉnh mới (key ngắn hơn tên tỉnh để không lấn khi cả 2 xuất hiện).
  for (const [hint, stripped] of Object.entries(OLD_DISTRICT_HINTS)) {
    const st = stateByStripped.get(stripped);
    if (st) stateKeys.push({ key: hint, val: st, len: 1 });
  }
  stateKeys.sort((a, b) => b.len - a.len);

  const bestPhrase = (hay: string, keys: Key[]): string => {
    let best: { val: string; len: number; pos: number } | null = null;
    for (const { key, val, len } of keys) {
      if (!containsPhrase(hay, key)) continue;
      const pos = hay.lastIndexOf(key);
      if (!best || len > best.len || (len === best.len && pos > best.pos)) {
        best = { val, len, pos };
      }
    }
    return best?.val ?? '';
  };

  const matchProvince = (hay: string): string => bestPhrase(hay, stateKeys);

  // 2 nhóm khoá xã: STRONG = norm đầy đủ có tiền tố ("phuong lang") — địa chỉ ghi rõ
  // "phường/xã X" nên khớp trước; WEAK = tên trần ("lang") — chỉ dùng khi không có strong,
  // vì tên phường MỚI hay trùng tên quận CŨ (Đống Đa, Từ Liêm…) → dễ khớp lệch.
  const wardKeysStrong = (province: string): Key[] =>
    (wardsByState.get(province) ?? [])
      .map((w) => ({ key: norm(w), val: w, len: norm(w).length }))
      .sort((a, b) => b.len - a.len);
  const wardKeysWeak = (province: string): Key[] => {
    const keys: Key[] = [];
    for (const w of wardsByState.get(province) ?? []) {
      const sw = stripWard(w);
      if (sw && sw.length >= 4 && sw !== norm(w)) keys.push({ key: sw, val: w, len: sw.length });
    }
    return keys.sort((a, b) => b.len - a.len);
  };
  const matchWard = (hay: string, province: string): string =>
    bestPhrase(hay, wardKeysStrong(province)) || bestPhrase(hay, wardKeysWeak(province));

  const resolve = (address: string): NewAddr => {
    const hay = norm(address);
    if (!hay) return { province: '', ward: '' };
    const province = matchProvince(hay);
    const ward = province ? matchWard(hay, province) : '';
    return { province, ward };
  };

  // Snap 1 giá trị AI → đúng chuỗi trong danh mục (exact theo norm, fallback khớp cụm).
  const snapProvince = (v: string): string => {
    const k = norm(v);
    if (!k) return '';
    const exact = states.find((s) => norm(s) === k || stripState(s) === stripState(v));
    return exact ?? matchProvince(k);
  };
  const snapWard = (v: string, province: string): string => {
    if (!v || !province) return '';
    const list = wardsByState.get(province) ?? [];
    const k = norm(v);
    const exact = list.find((w) => norm(w) === k || stripWard(w) === stripWard(v));
    return exact ?? matchWard(k, province);
  };


  /** Snap trọn 1 địa chỉ AI: province → ward (trong province). */
  const snap = (ai: NewAddr, fallbackAddress?: string): NewAddr => {
    const province =
      snapProvince(ai.province) || (fallbackAddress ? matchProvince(norm(fallbackAddress)) : '');
    const ward = province
      ? snapWard(ai.ward, province) ||
        (fallbackAddress ? matchWard(norm(fallbackAddress), province) : '')
      : '';
    return { province, ward };
  };

  return { resolve, snap, snapProvince, snapWard, wardsByState };
}
