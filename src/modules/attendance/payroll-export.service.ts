import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PayrollDay, PayrollEmployee, PayrollResult } from './payroll.types';

/** yyyy-mm-dd hôm nay theo giờ VN (UTC+7). */
function vnTodayIso(): string {
  const vn = new Date(Date.now() + 7 * 3600 * 1000);
  return vn.toISOString().slice(0, 10);
}

/**
 * Nhãn + màu trạng thái công 1 ngày (khớp badge màn Sổ công): ưu tiên "Đã bổ sung"
 * khi có giờ bổ sung; còn lại suy ra từ ca đăng ký/hợp lệ/chấm công so với hôm nay.
 */
function dayStatus(d: PayrollDay, today: string): { label: string; argb?: string } {
  if ((d.adjHours || 0) !== 0) return { label: 'Đã bổ sung', argb: 'FF0369A1' };
  if (d.date > today)
    return d.registered > 0 ? { label: 'Chưa tới', argb: 'FF64748B' } : { label: '' };
  const shifts = Array.isArray(d.shifts) ? d.shifts : [];
  const workedUnreg = shifts.filter((s) => s?.worked && !s?.registered).length;
  if (d.registered === 0 && workedUnreg === 0 && !d.in) return { label: '' };
  if (d.registered > 0 && d.valid === 0) return { label: 'Vắng', argb: 'FFB91C1C' };
  if (d.valid === d.registered && workedUnreg === 0)
    return { label: 'Đủ công', argb: 'FF047857' };
  return { label: 'Thiếu công', argb: 'FFB45309' };
}

/** dd/mm/yyyy từ 'yyyy-mm-dd'. */
function vnDate(iso: string): string {
  const [y, m, d] = String(iso ?? '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(iso ?? '');
}

/** dd/mm từ 'yyyy-mm-dd' (dùng trong cột ngày của bảng). */
function vnDayShort(iso: string): string {
  const [, m, d] = String(iso ?? '').split('-');
  return m && d ? `${d}/${m}` : String(iso ?? '');
}

/** 'HH:MM' từ ISO timestamp (giờ VN). Rỗng nếu không có. */
function vnTime(ts: string | null): string {
  if (!ts) return '';
  const dt = new Date(ts);
  if (Number.isNaN(dt.getTime())) return '';
  const vn = new Date(dt.getTime() + 7 * 3600 * 1000);
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const mm = String(vn.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

const FMT_VND = '#,##0';
const FMT_HOURS = '0.0';

/**
 * Sinh file Excel (.xlsx) bảng lương từ kết quả payroll_compute (in-memory).
 * KHÔNG lưu file ở đâu — buffer sinh tại chỗ để stream cho người tải (xem
 * payroll-download.controller). Zalo chỉ gửi LINK tải (bridge không đính kèm file).
 */
@Injectable()
export class PayrollExportService {
  /** Nhãn kỳ "dd/mm/yyyy – dd/mm/yyyy". */
  periodLabel(p: PayrollResult): string {
    return `${vnDate(p.from)} – ${vnDate(p.to)}`;
  }

  /** Nhãn "tháng M/YYYY" từ ngày 'from'. */
  monthLabel(p: PayrollResult): string {
    const [y, m] = String(p.from ?? '').split('-');
    return y && m ? `tháng ${Number(m)}/${y}` : this.periodLabel(p);
  }

  /** Điền 1 sheet chi tiết bảng công + lương cho 1 NV. */
  private fillEmployeeSheet(
    ws: ExcelJS.Worksheet,
    emp: PayrollEmployee,
    p: PayrollResult,
  ): void {
    ws.columns = [
      { width: 10 }, // 1 Ngày
      { width: 8 }, // 2 Công
      { width: 8 }, // 3 Vào
      { width: 8 }, // 4 Ra
      { width: 14 }, // 5 Trạng thái
      { width: 10 }, // 6 Giờ làm
      { width: 12 }, // 7 Giờ bổ sung
      { width: 10 }, // 8 Tổng giờ
      { width: 14 }, // 9 Mức/giờ
      { width: 16 }, // 10 Thành tiền
    ];

    const title = ws.addRow([`BẢNG LƯƠNG — ${emp.name}`]);
    title.font = { bold: true, size: 14 };
    ws.mergeCells(title.number, 1, title.number, 10);

    ws.addRow([`Kỳ: ${this.periodLabel(p)}`]);
    if (emp.position) ws.addRow([`Vị trí: ${emp.position}`]);
    ws.addRow([]);

    const header = ws.addRow([
      'Ngày',
      'Công',
      'Vào',
      'Ra',
      'Trạng thái',
      'Giờ làm',
      'Giờ bổ sung',
      'Tổng giờ',
      'Mức/giờ',
      'Thành tiền',
    ]);
    header.font = { bold: true };
    header.alignment = { horizontal: 'center' };
    header.eachCell((c) => {
      c.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF1F5F9' },
      };
      c.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
    });

    const today = vnTodayIso();
    for (const d of emp.days) {
      const st = dayStatus(d, today);
      const row = ws.addRow([
        vnDayShort(d.date),
        d.cong,
        vnTime(d.in),
        vnTime(d.out),
        st.label,
        d.workHours,
        d.adjHours,
        d.hours,
        d.rate,
        d.pay,
      ]);
      const statusCell = row.getCell(5);
      statusCell.alignment = { horizontal: 'center' };
      if (st.argb) statusCell.font = { color: { argb: st.argb }, bold: true };
      row.getCell(6).numFmt = FMT_HOURS;
      row.getCell(7).numFmt = FMT_HOURS;
      row.getCell(8).numFmt = FMT_HOURS;
      row.getCell(9).numFmt = FMT_VND;
      row.getCell(10).numFmt = FMT_VND;
    }

    ws.addRow([]);
    const total = ws.addRow([
      'TỔNG',
      '',
      '',
      '',
      '',
      '',
      '',
      emp.totalHours,
      '',
      emp.salary,
    ]);
    total.font = { bold: true };
    total.getCell(8).numFmt = FMT_HOURS;
    total.getCell(10).numFmt = FMT_VND;
  }

  /** Workbook chỉ chứa bảng của 1 NV (gửi riêng cho NV đó). */
  buildEmployeeWorkbook(
    emp: PayrollEmployee,
    p: PayrollResult,
  ): ExcelJS.Workbook {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Bảng lương');
    this.fillEmployeeSheet(ws, emp, p);
    return wb;
  }

  /** Workbook tổng: 1 sheet tổng hợp + mỗi NV 1 sheet chi tiết (cho chủ/admin). */
  buildFullWorkbook(p: PayrollResult): ExcelJS.Workbook {
    const wb = new ExcelJS.Workbook();
    const sum = wb.addWorksheet('Tổng hợp');
    sum.columns = [
      { width: 6 }, // STT
      { width: 28 }, // Nhân viên
      { width: 16 }, // Vị trí
      { width: 12 }, // Tổng giờ
      { width: 18 }, // Tổng lương
    ];

    const title = sum.addRow([`BẢNG LƯƠNG ${this.monthLabel(p).toUpperCase()}`]);
    title.font = { bold: true, size: 14 };
    sum.mergeCells(title.number, 1, title.number, 5);
    sum.addRow([`Kỳ: ${this.periodLabel(p)}`]);
    sum.addRow([]);

    const header = sum.addRow([
      'STT',
      'Nhân viên',
      'Vị trí',
      'Tổng giờ',
      'Tổng lương',
    ]);
    header.font = { bold: true };
    header.alignment = { horizontal: 'center' };
    header.eachCell((c) => {
      c.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF1F5F9' },
      };
      c.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
    });

    p.employees.forEach((emp, i) => {
      const row = sum.addRow([
        i + 1,
        emp.name,
        emp.position ?? '',
        emp.totalHours,
        emp.salary,
      ]);
      row.getCell(4).numFmt = FMT_HOURS;
      row.getCell(5).numFmt = FMT_VND;
    });

    sum.addRow([]);
    const total = sum.addRow([
      '',
      'TỔNG CỘNG',
      '',
      p.totalHours,
      p.totalSalary,
    ]);
    total.font = { bold: true };
    total.getCell(4).numFmt = FMT_HOURS;
    total.getCell(5).numFmt = FMT_VND;

    // Mỗi NV 1 sheet chi tiết. Tên sheet cắt 31 ký tự (giới hạn Excel) + né trùng.
    const used = new Set<string>(['Tổng hợp']);
    for (const emp of p.employees) {
      let name = (emp.name || 'NV').slice(0, 28).replace(/[\\/*?:[\]]/g, ' ');
      let n = name;
      let k = 2;
      while (used.has(n)) n = `${name.slice(0, 26)} ${k++}`;
      used.add(n);
      this.fillEmployeeSheet(wb.addWorksheet(n), emp, p);
    }

    return wb;
  }

  /** Xuất workbook ra Buffer .xlsx. */
  async toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
