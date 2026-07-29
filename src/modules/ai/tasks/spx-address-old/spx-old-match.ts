/**
 * Matcher địa chỉ hệ CŨ (3 cấp SPX: Tỉnh → Quận/Huyện → Xã/Phường), grounded bằng danh mục
 * trong DB (bảng spx_*_old). Pure functions, không phụ thuộc Nest — nhận list, trả matcher.
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
const stripCity = (s: string): string =>
  norm(s).replace(/^(quan|huyen|thanh pho|thi xa|tp|tx)\s+/, '');
const stripWard = (s: string): string =>
  norm(s).replace(/^(phuong|xa|thi tran|dac khu|p|f|tt)\s+/, '');

/** True nếu `key` xuất hiện như cụm token trong `hay` (biên token). */
const containsPhrase = (hay: string, key: string): boolean => {
  if (!key) return false;
  const re = new RegExp(`(^| )${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
  return re.test(hay);
};

export interface OldAddr {
  state: string;
  city: string;
  ward: string;
}

interface Key {
  key: string;
  val: string;
  len: number;
}

/**
 * Dựng matcher từ danh mục CŨ. `resolve(address)` tách 3 cấp từ text tự do;
 * `snap(ai)` chuẩn hoá output AI về đúng chuỗi trong danh mục.
 */
export function createOldMatcher(
  states: string[],
  cities: { state: string; city: string }[],
  wards: { city: string; ward: string }[],
) {
  const citiesByState = new Map<string, string[]>();
  for (const { state, city } of cities) {
    const arr = citiesByState.get(state) ?? [];
    arr.push(city);
    citiesByState.set(state, arr);
  }
  const wardsByCity = new Map<string, string[]>();
  for (const { city, ward } of wards) {
    const arr = wardsByCity.get(city) ?? [];
    arr.push(ward);
    wardsByCity.set(city, arr);
  }

  // stripped-norm → tên tỉnh chuẩn (để alias trỏ tới).
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
  addAlias('brvt', 'ba ria vung tau');

  // Khoá tỉnh: norm đầy đủ + norm bỏ prefix + alias. Ưu tiên key dài (đặc trưng).
  const stateKeys: Key[] = [];
  for (const s of states) {
    stateKeys.push({ key: norm(s), val: s, len: norm(s).length });
    const st = stripState(s);
    if (st && st !== norm(s)) stateKeys.push({ key: st, val: s, len: st.length });
  }
  for (const [a, s] of Object.entries(alias)) stateKeys.push({ key: a, val: s, len: a.length });
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

  const matchState = (hay: string): string => bestPhrase(hay, stateKeys);

  const cityKeys = (state: string): Key[] => {
    const list = citiesByState.get(state) ?? [];
    const keys: Key[] = [];
    for (const c of list) {
      keys.push({ key: norm(c), val: c, len: norm(c).length });
      const sc = stripCity(c);
      if (sc && sc !== norm(c) && sc.length >= 2) keys.push({ key: sc, val: c, len: sc.length });
      // "QUẬN 5" ⇒ cũng khớp "q 5" / "q5".
      const qm = norm(c).match(/^quan (\d+)$/);
      if (qm) {
        keys.push({ key: `q ${qm[1]}`, val: c, len: 3 });
        keys.push({ key: `q${qm[1]}`, val: c, len: 2 });
      }
    }
    return keys.sort((a, b) => b.len - a.len);
  };
  const matchCity = (hay: string, state: string): string => bestPhrase(hay, cityKeys(state));

  const wardKeys = (city: string): Key[] => {
    const list = wardsByCity.get(city) ?? [];
    const keys: Key[] = [];
    for (const w of list) {
      // Khớp bằng norm ĐẦY ĐỦ (vd "phuong 2","xa long phu") — chính xác, tránh nhiễu số lẻ.
      keys.push({ key: norm(w), val: w, len: norm(w).length });
      const sw = stripWard(w);
      if (sw && sw.length >= 4 && sw !== norm(w)) keys.push({ key: sw, val: w, len: sw.length });
    }
    return keys.sort((a, b) => b.len - a.len);
  };
  const matchWard = (hay: string, city: string): string => bestPhrase(hay, wardKeys(city));

  const resolve = (address: string): OldAddr => {
    const hay = norm(address);
    if (!hay) return { state: '', city: '', ward: '' };
    const state = matchState(hay);
    const city = state ? matchCity(hay, state) : '';
    const ward = city ? matchWard(hay, city) : '';
    return { state, city, ward };
  };

  // Snap 1 giá trị AI → đúng chuỗi trong danh mục (exact theo norm, fallback khớp cụm).
  const snapState = (v: string): string => {
    const k = norm(v);
    if (!k) return '';
    const exact = states.find((s) => norm(s) === k || stripState(s) === stripState(v));
    return exact ?? matchState(k) ?? '';
  };
  const snapCity = (v: string, state: string): string => {
    if (!v || !state) return '';
    const list = citiesByState.get(state) ?? [];
    const k = norm(v);
    const exact = list.find((c) => norm(c) === k || stripCity(c) === stripCity(v));
    return exact ?? matchCity(k, state);
  };
  const snapWard = (v: string, city: string): string => {
    if (!v || !city) return '';
    const list = wardsByCity.get(city) ?? [];
    const k = norm(v);
    const exact = list.find((w) => norm(w) === k || stripWard(w) === stripWard(v));
    return exact ?? matchWard(k, city);
  };

  /** Snap trọn 1 địa chỉ AI: state → city (trong state) → ward (trong city). */
  const snap = (ai: OldAddr, fallbackAddress?: string): OldAddr => {
    const state = snapState(ai.state) || (fallbackAddress ? matchState(norm(fallbackAddress)) : '');
    const city = state
      ? snapCity(ai.city, state) || (fallbackAddress ? matchCity(norm(fallbackAddress), state) : '')
      : '';
    const ward = city
      ? snapWard(ai.ward, city) || (fallbackAddress ? matchWard(norm(fallbackAddress), city) : '')
      : '';
    return { state, city, ward };
  };

  return { resolve, snap, snapState, snapCity, snapWard, citiesByState, wardsByCity };
}
