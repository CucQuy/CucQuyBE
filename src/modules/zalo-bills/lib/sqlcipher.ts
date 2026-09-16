import crypto from 'node:crypto';

/**
 * Giải mã file SQLCipher 4 (tham số mặc định) về buffer SQLite PLAINTEXT.
 * CHỈ dùng node:crypto — không lib native. Dùng cho DB chat Zalo desktop:
 * key = cipherKey (passphrase 32 hex chars), PBKDF2-HMAC-SHA512 256000, page 4096,
 * reserve = 16 (IV) + 64 (HMAC-SHA512) = 80. AES-256-CBC, no padding, per-page IV ở cuối page.
 * (WAL chưa gộp → thiếu vài tin mới nhất; chấp nhận, lần sync sau bù.)
 */
export function decryptSqlcipher4(
  fileBuf: Buffer,
  passphrase: string,
  opt: { pageSize?: number; kdfIter?: number; reserve?: number } = {},
): Buffer {
  const pageSize = opt.pageSize ?? 4096;
  const kdfIter = opt.kdfIter ?? 256000;
  const reserve = opt.reserve ?? 80;
  const reserveAligned = Math.ceil(reserve / 16) * 16;

  const salt = fileBuf.subarray(0, 16);
  const key = crypto.pbkdf2Sync(passphrase, salt, kdfIter, 32, 'sha512');
  const nPages = Math.floor(fileBuf.length / pageSize);
  const out = Buffer.alloc(fileBuf.length);
  Buffer.from('SQLite format 3\0', 'latin1').copy(out, 0);

  for (let i = 0; i < nPages; i++) {
    const base = i * pageSize;
    const page = fileBuf.subarray(base, base + pageSize);
    const off = i === 0 ? 16 : 0; // page 1: 16 byte đầu là salt (giữ nguyên plaintext ở output header)
    const ivPos = pageSize - reserveAligned;
    const iv = page.subarray(ivPos, ivPos + 16);
    const ct = page.subarray(off, ivPos);
    try {
      const d = crypto.createDecipheriv('aes-256-cbc', key, iv);
      d.setAutoPadding(false);
      const pt = Buffer.concat([d.update(ct), d.final()]);
      pt.copy(out, base + off);
    } catch {
      // trang lỗi (khoá sai / trang trống) → bỏ qua, giữ 0
    }
    // vùng reserve cuối page để 0 (out đã alloc 0) → SQLite coi là reserved-space
  }
  return out;
}

const RESERVE = 80;

/** Giải mã 1 page SQLCipher (dùng cho cả main DB lẫn frame WAL). */
function decryptPage(
  encPage: Buffer,
  pageIndex: number,
  key: Buffer,
  pageSize: number,
): Buffer {
  const off = pageIndex === 0 ? 16 : 0;
  const iv = encPage.subarray(pageSize - RESERVE, pageSize - RESERVE + 16);
  const ct = encPage.subarray(off, pageSize - RESERVE);
  const d = crypto.createDecipheriv('aes-256-cbc', key, iv);
  d.setAutoPadding(false);
  const pt = Buffer.concat([d.update(ct), d.final()]);
  const outPage = Buffer.alloc(pageSize);
  if (pageIndex === 0) Buffer.from('SQLite format 3\0', 'latin1').copy(outPage, 0);
  pt.copy(outPage, off);
  return outPage;
}

/**
 * Áp SQLCipher WAL (file -wal) vào buffer DB đã giải mã → lấy được tin MỚI NHẤT
 * (bill vừa đăng còn nằm trong WAL, chưa checkpoint vào .db chính). Thuần node:crypto.
 * `mainSalt` = 16 byte đầu của file .db gốc (KDF salt). Chỉ áp frame của WAL hiện tại (khớp salt).
 */
export function applyWal(
  plainDb: Buffer,
  walBuf: Buffer | undefined,
  passphrase: string,
  mainSalt: Buffer,
): Buffer {
  if (!walBuf || walBuf.length < 32) return plainDb;
  const magic = walBuf.readUInt32BE(0);
  if (magic !== 0x377f0682 && magic !== 0x377f0683) return plainDb;
  const pageSize = walBuf.readUInt32BE(8);
  const salt1 = walBuf.readUInt32BE(16);
  const salt2 = walBuf.readUInt32BE(20);
  const key = crypto.pbkdf2Sync(passphrase, mainSalt, 256000, 32, 'sha512');
  const frameSize = 24 + pageSize;
  let out = Buffer.from(plainDb);
  for (let off = 32; off + frameSize <= walBuf.length; off += frameSize) {
    const pageNo = walBuf.readUInt32BE(off);
    if (walBuf.readUInt32BE(off + 8) !== salt1 || walBuf.readUInt32BE(off + 12) !== salt2) {
      continue; // frame thế hệ WAL cũ → bỏ
    }
    const encPage = walBuf.subarray(off + 24, off + 24 + pageSize);
    let plainPage: Buffer;
    try {
      plainPage = decryptPage(encPage, pageNo - 1, key, pageSize);
    } catch {
      continue;
    }
    const need = pageNo * pageSize;
    if (out.length < need) {
      const bigger = Buffer.alloc(need);
      out.copy(bigger);
      out = bigger;
    }
    plainPage.copy(out, (pageNo - 1) * pageSize);
  }
  return out;
}
