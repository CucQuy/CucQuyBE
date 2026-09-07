import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { AttendanceProc } from './attendance.proc';
import { ZaloService } from '../zalo/zalo.service';
import { PayrollExportService } from './payroll-export.service';
import { PayrollResult } from './payroll.types';
import { signPayrollLink, verifyPayrollLink } from './payroll-link.util';

/** Số tiền VND có dấu phân cách nghìn (vd 1.250.000). */
function vnd(n: number): string {
  return Math.round(Number(n) || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Giờ gọn (bỏ .0 dư). */
function hrs(n: number): string {
  const v = Math.round((Number(n) || 0) * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** Bỏ dấu tiếng Việt → tên file ASCII an toàn cho Content-Disposition. */
function asciiSlug(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // bỏ dấu thanh
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/** Cache file trong pod: dùng lại trong 6h, xoá sau 40 ngày (token sống 30 ngày). */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_KEEP_MS = 40 * 24 * 60 * 60 * 1000;

export interface ClosingResult {
  month: string; // nhãn "tháng M/YYYY"
  from: string;
  to: string;
  totalSalary: number;
  employeeCount: number; // số NV có công trong kỳ
  sent: number; // số NV đã gửi Zalo cá nhân
  skipped: number; // NV bỏ qua (không SĐT / không có công)
  fullFileUrl: string | null; // link tải file tổng (cho admin xem, KHÔNG gửi ai)
  dryRun: boolean;
}

/**
 * Chốt công cuối tháng: tính bảng lương → gửi Zalo cá nhân cho từng NV kèm FILE .xlsx.
 * - CHỈ gửi cho từng NV tương ứng (file lương riêng), KHÔNG gửi bản tổng vào nhóm.
 * - File KHÔNG lên cloud: gửi qua sendFileZalo với link token — Abit tải link đó
 *   về rồi đính kèm; khi có request, BE SINH file, cache trong pod và trả bằng
 *   res.sendFile (xem buildDownloadPath + payroll-download.controller).
 * Không khoá dữ liệu chấm công (chỉ tính + gửi). Tái dùng payroll_compute.
 */
@Injectable()
export class PayrollClosingService {
  private readonly logger = new Logger(PayrollClosingService.name);

  constructor(
    private readonly proc: AttendanceProc,
    private readonly zalo: ZaloService,
    private readonly exporter: PayrollExportService,
  ) {}

  /** Lấy bảng lương kỳ (mặc định tháng hiện tại giờ VN qua payroll_compute). */
  private async computePayroll(input: {
    from?: string;
    to?: string;
    employeeId?: string;
  }): Promise<PayrollResult | null> {
    const [r] = await this.proc.payroll({
      from: input.from,
      to: input.to,
      employeeId: input.employeeId,
    });
    return (r?.result as PayrollResult) ?? null;
  }

  /** Map employeeId → SĐT cho NV active có SĐT. */
  private async phoneMap(): Promise<Map<string, string>> {
    const rows = await this.proc.reminderRecipients();
    const recipients = rows[0]?.result ?? [];
    const map = new Map<string, string>();
    for (const r of recipients) {
      const phone = String(r?.phone ?? '').trim();
      if (r?.id && phone) map.set(r.id, phone);
    }
    return map;
  }

  /** Base URL API công khai (để dựng link tải gửi Zalo). */
  private apiBase(): string {
    return (process.env.PUBLIC_API_URL || 'https://api.cucquy.site/api').replace(
      /\/+$/,
      '',
    );
  }

  /**
   * Link tải bảng lương (token hết hạn) — file sinh khi bấm, không lưu đâu.
   * Đuôi `.xlsx` trong đường dẫn là BẮT BUỘC: Abit/Zalo nhận dạng file theo đuôi
   * URL, link dạng `?token=` làm Zalo báo "Có lỗi trong quá trình tải File".
   */
  private downloadLink(
    scope: 'emp' | 'full',
    from: string,
    to: string,
    employeeId?: string,
  ): string {
    const token = signPayrollLink({ scope, employeeId, from, to });
    return `${this.apiBase()}/payroll/download/${token}.xlsx`;
  }

  /**
   * Sinh file .xlsx từ token tải (in-memory, không lưu). Trả buffer + tên file
   * ASCII, hoặc null nếu token sai/hết hạn/không có dữ liệu.
   */
  async buildDownload(
    token: string,
  ): Promise<{ filename: string; buffer: Buffer } | null> {
    const claims = verifyPayrollLink(token);
    if (!claims) return null;

    const payroll = await this.computePayroll({
      from: claims.from,
      to: claims.to,
      employeeId: claims.scope === 'emp' ? claims.employeeId : undefined,
    });
    if (!payroll) return null;
    const monthLabel = this.exporter.monthLabel(payroll);

    if (claims.scope === 'emp') {
      const emp = payroll.employees.find(
        (e) => e.employeeId === claims.employeeId,
      );
      if (!emp) return null;
      const buffer = await this.exporter.toBuffer(
        this.exporter.buildEmployeeWorkbook(emp, payroll),
      );
      return {
        filename: `bang-luong-${asciiSlug(emp.name)}-${asciiSlug(monthLabel)}.xlsx`,
        buffer,
      };
    }

    const buffer = await this.exporter.toBuffer(
      this.exporter.buildFullWorkbook(payroll),
    );
    return { filename: `bang-luong-${asciiSlug(monthLabel)}.xlsx`, buffer };
  }

  /**
   * Sinh file ra ĐĨA rồi trả đường dẫn, để controller dùng `res.sendFile` —
   * Zalo chỉ tải được file khi response có hành vi của file tĩnh (ETag mạnh,
   * Last-Modified, Accept-Ranges/206); trả buffer bằng res.send/end thì Zalo báo
   * "nội dung không có trên máy này và không có trên máy chủ Zalo".
   * Cache trong pod (ephemeral): còn mới thì dùng lại, mất/pod restart thì sinh
   * lại từ token nên link vẫn sống đủ 30 ngày.
   */
  async buildDownloadPath(
    token: string,
  ): Promise<{ filename: string; path: string } | null> {
    const claims = verifyPayrollLink(token);
    if (!claims) return null;

    // Mỗi token 1 thư mục, trong đó là file mang đúng tên hiển thị → nhánh cache
    // không cần tính lại bảng lương (payroll_compute + dựng workbook ~400ms).
    const root = process.env.PAYROLL_CACHE_DIR || '/tmp/payroll';
    const dir = join(
      root,
      createHash('sha256').update(token).digest('hex').slice(0, 24),
    );

    const cached = await this.freshCached(dir);
    if (cached) return cached;

    const out = await this.buildDownload(token);
    if (!out) return null;
    const path = join(dir, out.filename);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path, out.buffer);
    await this.pruneCache(root);
    return { filename: out.filename, path };
  }

  /** File .xlsx trong cache còn hạn dùng lại (nếu có). */
  private async freshCached(
    dir: string,
  ): Promise<{ filename: string; path: string } | null> {
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    const filename = names.find((n) => n.endsWith('.xlsx'));
    if (!filename) return null;
    const path = join(dir, filename);
    const st = await fs.stat(path).catch(() => null);
    if (!st || !st.size || Date.now() - st.mtimeMs >= CACHE_TTL_MS) return null;
    return { filename, path };
  }

  /** Dọn cache quá hạn token (không để rác tích trong pod). */
  private async pruneCache(root: string): Promise<void> {
    try {
      const deadline = Date.now() - CACHE_KEEP_MS;
      const dirs = await fs.readdir(root);
      await Promise.all(
        dirs.map(async (d) => {
          const f = join(root, d);
          const st = await fs.stat(f).catch(() => null);
          if (st && st.mtimeMs < deadline) {
            await fs.rm(f, { recursive: true, force: true });
          }
        }),
      );
    } catch (err) {
      this.logger.warn(`Dọn cache bảng lương lỗi: ${String(err)}`);
    }
  }

  /**
   * Chạy chốt công. Mặc định gửi Zalo cá nhân cho từng NV. `dryRun`=true → chỉ
   * trả link file tổng, KHÔNG gửi Zalo (dùng để test/xem trước).
   */
  async runClosing(
    opts: { from?: string; to?: string; dryRun?: boolean } = {},
  ): Promise<ClosingResult> {
    const payroll = await this.computePayroll({ from: opts.from, to: opts.to });
    if (!payroll) {
      throw new Error('Không tính được bảng lương (payroll_compute trả null)');
    }
    const dryRun = !!opts.dryRun;
    const monthLabel = this.exporter.monthLabel(payroll);

    // Chỉ tính NV có công trong kỳ (bỏ NV không đi làm để khỏi gửi lương 0đ).
    const workedEmployees = payroll.employees.filter(
      (e) => (e.totalHours || 0) > 0,
    );

    // File tổng: chỉ dựng LINK cho admin tự xem (không gửi ai, không lưu file).
    const fullFileUrl = this.downloadLink('full', payroll.from, payroll.to);

    // ── Từng NV → Zalo cá nhân kèm file .xlsx riêng (chỉ gửi cho NV tương ứng) ──
    let sent = 0;
    let skipped = 0;
    if (!dryRun) {
      const phones = await this.phoneMap();
      for (const emp of workedEmployees) {
        const phone = phones.get(emp.employeeId);
        if (!phone) {
          skipped += 1;
          continue;
        }
        try {
          const url = this.downloadLink(
            'emp',
            payroll.from,
            payroll.to,
            emp.employeeId,
          );
          const msg =
            `Chào ${emp.name}! 💰\n` +
            `Bảng lương ${monthLabel} của bạn:\n` +
            `• Tổng giờ công: ${hrs(emp.totalHours)} giờ\n` +
            `• Tổng lương: ${vnd(emp.salary)}đ\n` +
            `Chi tiết xem file Excel gửi kèm bên dưới nhé!`;
          await this.zalo.send({
            message: msg,
            toNumbers: [phone],
            // Abit tự tải link (token) về rồi đính kèm dưới dạng file .xlsx →
            // NV nhận file thật, không cần dán link trong tin nhắn nữa.
            files: [
              {
                url,
                // KHÔNG kèm '.xlsx': Abit ghép tên hiển thị = name + đuôi lấy từ
                // url, kèm đuôi ở đây ra '...xlsx.xlsx'.
                name: `bang-luong-${asciiSlug(emp.name)}-${asciiSlug(monthLabel)}`,
              },
            ],
          });
          sent += 1;
        } catch (err) {
          skipped += 1;
          this.logger.warn(
            `Gửi bảng lương cho ${emp.name} (${phone}) lỗi: ${String(err)}`,
          );
        }
      }
    } else {
      skipped = workedEmployees.length;
    }

    this.logger.log(
      `Chốt công ${monthLabel}: gửi ${sent}, bỏ qua ${skipped}${dryRun ? ' (dryRun)' : ''}.`,
    );

    return {
      month: monthLabel,
      from: payroll.from,
      to: payroll.to,
      totalSalary: payroll.totalSalary,
      employeeCount: workedEmployees.length,
      sent,
      skipped,
      fullFileUrl,
      dryRun,
    };
  }
}
