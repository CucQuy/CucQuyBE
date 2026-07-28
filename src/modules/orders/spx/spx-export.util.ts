import JSZip from 'jszip';
import { SPX_TEMPLATE_B64 } from './spx-template.base64';

/** Chế độ địa chỉ: 'old' = sheet "Tạo đơn (địa chỉ cũ)" (sheet ĐẦU, SPX đọc), 'new' = "địa chỉ mới". */
export type SpxAddressMode = 'old' | 'new';

// File worksheet trong nền (file upload-OK): sheet1 = "địa chỉ cũ", sheet2 = "địa chỉ mới".
const SHEET_FILE: Record<SpxAddressMode, string> = {
  old: 'xl/worksheets/sheet1.xml',
  new: 'xl/worksheets/sheet2.xml',
};
const SHARED_STRINGS = 'xl/sharedStrings.xml';

const colLetter = (i: number): string => {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
};

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Tạo file .xlsx tạo đơn hàng loạt SPX từ NỀN = file đã upload thành công (Google xuất, SPX nhận).
 * Mổ bằng JSZip: giữ nguyên toàn bộ cấu trúc, chỉ thay data (giữ header dòng 1) vào sheet theo
 * `mode` + xoá data mẫu sheet còn lại; text ghi shared string. NÉN DEFLATE để <5MB (giới hạn SPX).
 * `rows` = mảng dòng đơn (đã dựng sẵn ở FE theo đúng thứ tự cột template).
 */
export async function buildSpxFile(
  rows: (string | number)[][],
  mode: SpxAddressMode,
): Promise<Buffer> {
  const bytes = Buffer.from(SPX_TEMPLATE_B64, 'base64');
  const zip = await JSZip.loadAsync(bytes);

  const ssFile = zip.file(SHARED_STRINGS);
  if (!ssFile) throw new Error('Nền SPX thiếu sharedStrings.xml.');
  let ss = await ssFile.async('string');
  const sstOpen = ss.match(/<sst[^>]*>/)?.[0] ?? '';
  const count = parseInt(sstOpen.match(/\bcount="(\d+)"/)?.[1] ?? '0', 10);
  const unique = parseInt(sstOpen.match(/\buniqueCount="(\d+)"/)?.[1] ?? '0', 10);
  let nextIndex = unique;
  const addedSi: string[] = [];
  const strIndex = new Map<string, number>();
  let refsAdded = 0;
  const internString = (s: string): number => {
    const existing = strIndex.get(s);
    if (existing !== undefined) return existing;
    const idx = nextIndex++;
    strIndex.set(s, idx);
    addedSi.push(`<si><t xml:space="preserve">${escapeXml(s)}</t></si>`);
    return idx;
  };

  const fillSheet = async (path: string, dataRows: (string | number)[][]): Promise<void> => {
    const f = zip.file(path);
    if (!f) return;
    const xml = await f.async('string');
    const sd = xml.indexOf('<sheetData>');
    if (sd < 0) return;
    const r1End = xml.indexOf('</row>', sd) + '</row>'.length;
    const sdClose = xml.indexOf('</sheetData>', r1End);
    if (r1End < 6 || sdClose < 0) return;
    let body = '';
    dataRows.forEach((vals, ri) => {
      const r = ri + 2;
      let cells = '';
      vals.forEach((v, c) => {
        if (v === '' || v === null || v === undefined) return;
        const ref = `${colLetter(c)}${r}`;
        cells +=
          typeof v === 'number'
            ? `<c r="${ref}"><v>${v}</v></c>`
            : `<c r="${ref}" t="s"><v>${(refsAdded++, internString(String(v)))}</v></c>`;
      });
      body += `<row r="${r}">${cells}</row>`;
    });
    zip.file(path, xml.slice(0, r1End) + body + xml.slice(sdClose));
  };

  await fillSheet(SHEET_FILE[mode], rows);
  await fillSheet(SHEET_FILE[mode === 'old' ? 'new' : 'old'], []); // xoá data mẫu sheet còn lại

  if (addedSi.length > 0) {
    ss = ss
      .replace(/(<sst[^>]*\bcount=")\d+(")/, `$1${count + refsAdded}$2`)
      .replace(/(<sst[^>]*\buniqueCount=")\d+(")/, `$1${nextIndex}$2`)
      .replace('</sst>', `${addedSi.join('')}</sst>`);
    zip.file(SHARED_STRINGS, ss);
  }

  // Ghi zip.file() làm JSZip tự tạo entry thư mục (xl/, xl/worksheets/) — file nền không có,
  // parser SPX có thể loại. Xoá hết entry thư mục để khớp cấu trúc file gốc.
  for (const k of Object.keys(zip.files)) {
    if (zip.files[k].dir) delete zip.files[k];
  }

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
