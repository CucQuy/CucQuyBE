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
 * - File KHÔNG lưu ở cloud/đĩa: gửi qua sendFileZalo với link token — Abit tải link
 *   đó về rồi đính kèm; khi có request, BE mới SINH file tại chỗ rồi stream (xem
 *   buildDownload + payroll-download.controller). Link cũng nằm trong text dự phòng.
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

  /** Link tải bảng lương (token hết hạn) — file sinh khi bấm, không lưu đâu. */
  private downloadLink(
    scope: 'emp' | 'full',
    from: string,
    to: string,
    employeeId?: string,
  ): string {
    const token = signPayrollLink({ scope, employeeId, from, to });
    return `${this.apiBase()}/payroll/download?token=${token}`;
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
            `File Excel chi tiết gửi kèm bên dưới. Nếu không mở được:\n${url}`;
          await this.zalo.send({
            message: msg,
            toNumbers: [phone],
            // Abit tự tải link (token) về rồi gửi kèm dưới dạng file .xlsx → NV
            // nhận file thật. Link vẫn để trong text làm phương án dự phòng vì
            // gửi qua queue, lỗi tải file phía Abit không quay lại được đây.
            files: [
              {
                url,
                name: `bang-luong-${asciiSlug(emp.name)}-${asciiSlug(monthLabel)}.xlsx`,
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
