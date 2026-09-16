import path from 'node:path';
import { createRequire } from 'node:module';
import { decryptSqlcipher4, applyWal } from './sqlcipher';

const nodeRequire = createRequire(__filename);

/** 1 ảnh bill đọc từ DB nhóm Zalo. */
export interface BillPhoto {
  msgId: string;
  ts: number;
  dName: string;
  /** URL ảnh (đã rewrite sang .jpg — server trả JPEG XL bytes, cần convert JXL→JPG). */
  url: string;
}

// sql.js khởi tạo 1 lần (WASM thuần, không native).
let sqlPromise: Promise<any> | null = null;
function getSql(): Promise<any> {
  if (!sqlPromise) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const initSqlJs = nodeRequire('sql.js');
    const base = path.dirname(nodeRequire.resolve('sql.js'));
    sqlPromise = initSqlJs({ locateFile: (f: string) => path.join(base, f) });
  }
  return sqlPromise!;
}

/** Giải XOR cột `message` (lưu dạng JSON-string-literal) bằng cipherKey (ASCII). */
function xorDecodeMessageHex(hexOfMessageCol: string, keyAscii: Buffer): string {
  const escaped = Buffer.from(hexOfMessageCol, 'hex').toString('utf8'); // JSON string literal
  const cipher = Buffer.from(JSON.parse(escaped) as string, 'latin1');
  const out = Buffer.alloc(cipher.length);
  for (let i = 0; i < cipher.length; i++) out[i] = cipher[i] ^ keyAscii[i % keyAscii.length];
  return out.toString('utf8');
}

/** Đổi URL .jxl?jxlstatus=… sang .jpg (bytes vẫn là JXL, convert ở bước sau). */
function toJpgUrl(url: string): string {
  return url.replace(/\.jxl(\?[^]*)?$/i, '.jpg');
}

/** Lấy URL ảnh từ JSON message đã giải XOR (photo: params.hd / href). */
function extractPhotoUrl(decoded: string): string {
  try {
    const o = JSON.parse(decoded) as { href?: string; normalUrl?: string; params?: string };
    const p = o.params ? (JSON.parse(o.params) as { hd?: string; href?: string }) : {};
    const raw = p.hd || o.href || p.href || o.normalUrl || '';
    return raw ? toJpgUrl(raw) : '';
  } catch {
    return '';
  }
}

/** 1 bill dạng TEXT (nhập tay trong nhóm) — line1: quán+tổng, các line sau: item. */
export interface TextBill {
  msgId: string;
  ts: number;
  dName: string;
  text: string;
}

export interface GroupBills {
  photos: BillPhoto[];
  textBills: TextBill[];
}

/** Lấy text của message text (msgType=1): XOR → JSON.parse (thường là chuỗi). */
function extractText(decoded: string): string {
  try {
    const v = JSON.parse(decoded);
    if (typeof v === 'string') return v;
    if (v && typeof v.title === 'string') return v.title;
  } catch {
    /* không phải JSON */
  }
  return '';
}

/**
 * Ứng viên bill text: có tín hiệu GIÁ (…k / …đ / ngàn / nghìn / "Tổng") + đủ nội dung (≥3 từ).
 * Bắt cả dạng 1 dòng tự do ("Chị thắm 40 ngàn bột mì…") lẫn multi-line "Tổng…".
 * Loại chit-chat ngắn ("50k", tên người, "ok"). AI sẽ lọc/parse tiếp; service loại kết quả rỗng.
 */
function isBillCandidate(text: string): boolean {
  const t = text.trim();
  if (t.length < 6) return false;
  const hasPrice =
    /\d[\d.,]*\s*(k|đ|ng[àa]n|ngh[ìi]n)\b/i.test(t) || /t[oổ]ng/i.test(t);
  if (!hasPrice) return false;
  return t.split(/\s+/).filter(Boolean).length >= 3;
}

/**
 * Đọc bill (ảnh msgType=2 + text msgType=1 giống bill) từ DB nhóm, `sendDttm >= sinceTs`.
 * Giải mã + áp WAL 1 lần (để thấy tin mới nhất còn trong WAL).
 */
export async function readBills(
  dbBuffer: Buffer,
  cipherKey: string,
  sinceTs = 0,
  walBuffer?: Buffer,
): Promise<GroupBills> {
  let plain = decryptSqlcipher4(dbBuffer, cipherKey);
  plain = applyWal(plain, walBuffer, cipherKey, dbBuffer.subarray(0, 16));
  const SQL = await getSql();
  const db = new SQL.Database(plain);
  const keyAscii = Buffer.from(cipherKey, 'utf8');
  const photos: BillPhoto[] = [];
  const textBills: TextBill[] = [];
  try {
    const res = db.exec(
      "SELECT msgType, msgId, sendDttm, COALESCE(dName,'') dName, hex(message) hx " +
        'FROM message WHERE msgType IN (1,2) AND message IS NOT NULL ORDER BY sendDttm ASC',
    );
    if (!res.length) return { photos, textBills };
    const cols: string[] = res[0].columns;
    const iType = cols.indexOf('msgType');
    const iMsg = cols.indexOf('msgId');
    const iTs = cols.indexOf('sendDttm');
    const iName = cols.indexOf('dName');
    const iHx = cols.indexOf('hx');
    for (const row of res[0].values as unknown[][]) {
      const ts = Number(row[iTs]);
      if (sinceTs && ts < sinceTs) continue;
      const decoded = xorDecodeMessageHex(String(row[iHx]), keyAscii);
      const msgId = String(row[iMsg]);
      const dName = String(row[iName]);
      if (Number(row[iType]) === 2) {
        const url = extractPhotoUrl(decoded);
        if (url) photos.push({ msgId, ts, dName, url });
      } else {
        const text = extractText(decoded);
        if (text && isBillCandidate(text)) textBills.push({ msgId, ts, dName, text });
      }
    }
  } finally {
    db.close();
  }
  return { photos, textBills };
}
