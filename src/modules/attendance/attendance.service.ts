import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '../../auth/user.types';
import { ImagesService } from '../images/images.service';
import { AttendanceProc, AttendanceOverviewRow } from './attendance.proc';
import { FaceService } from './face.service';
import {
  AllowedNetwork,
  AttendanceKind,
  AttendanceRecord,
  AttendanceStatus,
  EmployeeRef,
  IpStatus,
} from './attendance.types';

type UploadFile = { buffer: Buffer; originalname: string; mimetype: string };

export interface MeResult {
  employee: EmployeeRef | null;
  status: AttendanceStatus | null;
  ip: IpStatus;
}

/** Orchestration chấm công: nối email→NV, kiểm IP mạng quán, so khớp khuôn mặt, ghi công. */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly proc: AttendanceProc,
    private readonly face: FaceService,
    private readonly images: ImagesService,
  ) {}

  /** Nối email đăng nhập → hồ sơ NV. Ném lỗi nếu chưa gắn (dùng cho luồng bắt buộc có NV). */
  private async requireEmployee(email?: string): Promise<EmployeeRef> {
    const emp = await this.resolveEmployee(email);
    if (!emp) {
      throw new ForbiddenException(
        'Tài khoản chưa được gắn với hồ sơ nhân viên. Liên hệ quản lý.',
      );
    }
    return emp;
  }

  private async resolveEmployee(email?: string): Promise<EmployeeRef | null> {
    if (!email) return null;
    const rows = await this.proc.resolveByEmail(email);
    return rows[0]?.result ?? null;
  }

  /** Trạng thái của NV đang đăng nhập + IP hiện tại. */
  async me(email: string | undefined, ip: string): Promise<MeResult> {
    const employee = await this.resolveEmployee(email);
    const ipRows = await this.proc.ipStatus(ip);
    const ipStatus = ipRows[0].result;
    let status: AttendanceStatus | null = null;
    if (employee) {
      const s = await this.proc.statusFor(employee.id);
      status = s[0]?.result ?? null;
    }
    return { employee, status, ip: ipStatus };
  }

  // ── Đăng ký công (NV tự đăng ký ca) + tính công theo ca hợp lệ ──
  /** Ca đang bật + đăng ký của NV đang đăng nhập trong khoảng ngày (cho lưới đăng ký). */
  async myShiftWeek(email: string | undefined, from: string, to: string) {
    const employee = await this.requireEmployee(email);
    const [wk] = await this.proc.myShiftWeek({ employeeId: employee.id, from, to });
    const [sh] = await this.proc.activeShifts();
    return { employee, shifts: sh?.result ?? [], week: wk?.result ?? {} };
  }

  /** NV tự đăng ký ca CỦA MÌNH cho 1 ngày tương lai (thay trọn ngày). */
  async registerSelfShift(email: string | undefined, workDate: string, shiftCodes: string[]) {
    const employee = await this.requireEmployee(email);
    try {
      const [r] = await this.proc.registerSelfShift({
        employeeId: employee.id,
        workDate,
        shiftCodes,
      });
      return r?.result ?? null;
    } catch (e) {
      if (String((e as { message?: string })?.message ?? '').includes('REGISTER_PAST')) {
        throw new BadRequestException('Chỉ đăng ký/sửa ca được cho ngày trong tương lai.');
      }
      throw e;
    }
  }

  /** Đối chiếu đăng ký ↔ đã làm (ca hợp lệ + công) cho 1 NV/ngày (admin dùng để đối chiếu). */
  async dayCompute(employeeId: string, date?: string) {
    const [r] = await this.proc.dayCompute({ employeeId, date });
    return r?.result ?? null;
  }

  // ── Bảng công & lương (payroll) + bổ sung công (admin) ──

  /** Tổng hợp công/giờ/lương theo kỳ (mặc định tháng hiện tại). */
  async payroll(input: { from?: string; to?: string; employeeId?: string }) {
    const [r] = await this.proc.payroll({
      from: input.from,
      to: input.to,
      employeeId: input.employeeId,
    });
    return r?.result ?? null;
  }

  async listAdjustments(input: { employeeId?: string; from?: string; to?: string }) {
    const [r] = await this.proc.adjustmentList(input);
    return r?.result ?? [];
  }

  /** Thêm 1 bổ sung công cho NV. createdBy = email admin đang đăng nhập. */
  async addAdjustment(
    createdBy: string | undefined,
    input: { employeeId: string; workDate: string; hours: number; shiftCode?: string; reason?: string },
  ) {
    const [r] = await this.proc.adjustmentAdd({
      employeeId: input.employeeId,
      workDate: input.workDate,
      hours: input.hours,
      shiftCode: input.shiftCode,
      reason: input.reason,
      createdBy,
    });
    return r?.result ?? null;
  }

  async removeAdjustment(id: string): Promise<{ ok: boolean }> {
    const [r] = await this.proc.adjustmentRemove(id);
    return r?.result ?? { ok: false };
  }

  /**
   * Đăng ký 1 mẫu khuôn mặt CHO 1 nhân viên. CHỈ super_admin (guard chặn ở controller).
   * Gọi nhiều lần cho nhiều góc mặt; reset=true ở lần đầu để xoá mẫu cũ.
   */
  async registerFace(
    file: UploadFile | undefined,
    employeeId: string | undefined,
    reset?: boolean,
  ): Promise<{ employeeId: string; faceCount: number }> {
    if (!file?.buffer?.length) throw new BadRequestException('Thiếu ảnh khuôn mặt');
    const targetId = (employeeId ?? '').trim();
    if (!targetId) throw new BadRequestException('Thiếu nhân viên cần đăng ký khuôn mặt');

    const detected = await this.face.detect(file.buffer);
    if (!detected) {
      throw new BadRequestException(
        'Không tìm thấy khuôn mặt trong ảnh. Chụp lại rõ hơn.',
      );
    }
    if (detected.score < 0.5) {
      throw new BadRequestException(
        'Khuôn mặt chưa rõ. Đưa mặt vào giữa khung, đủ sáng và chụp lại.',
      );
    }

    if (reset) await this.proc.faceClear(targetId);

    let imageUrl: string | undefined;
    try {
      imageUrl = await this.images.upload(
        { ...file, originalname: 'face.jpg', mimetype: 'image/jpeg' },
        `attendance/faces/${targetId}_${Date.now()}.jpg`,
      );
    } catch {
      imageUrl = undefined; // ảnh tham chiếu là phụ, không chặn đăng ký nếu storage lỗi
    }

    const rows = await this.proc.faceAdd({
      employeeId: targetId,
      descriptor: detected.descriptor,
      imageUrl,
    });
    const r = rows[0].result;
    return { employeeId: r.employeeId, faceCount: r.faceCount };
  }

  /** Chấm công vào/ra: kiểm IP mạng quán + so khớp khuôn mặt trước khi ghi. */
  async check(
    email: string | undefined,
    file: UploadFile | undefined,
    kind: AttendanceKind,
    ip: string,
    note?: string,
  ): Promise<{ record: AttendanceRecord; distance: number }> {
    if (!file?.buffer?.length) throw new BadRequestException('Thiếu ảnh chấm công');
    const employee = await this.requireEmployee(email);

    // 1) IP mạng quán
    const ipRows = await this.proc.ipStatus(ip);
    const ipStatus = ipRows[0].result;
    if (!ipStatus.configured) {
      throw new BadRequestException(
        'Quán chưa cấu hình mạng chấm công. Nhờ quản lý thêm IP mạng quán.',
      );
    }
    if (!ipStatus.allowed) {
      throw new ForbiddenException(
        'Bạn không ở trong mạng của quán nên không thể chấm công.',
      );
    }

    // 2) Đã đăng ký khuôn mặt chưa
    const faceRows = await this.proc.faceList(employee.id);
    const samples = (faceRows[0]?.result ?? []).map((f) => f.descriptor);
    if (samples.length === 0) {
      throw new BadRequestException(
        'Bạn chưa đăng ký khuôn mặt. Vào mục Đăng ký khuôn mặt trước.',
      );
    }

    // 3) So khớp khuôn mặt
    const detected = await this.face.detect(file.buffer);
    if (!detected) {
      throw new BadRequestException(
        'Không nhận diện được khuôn mặt. Chụp lại rõ hơn.',
      );
    }
    const distance = this.face.bestDistance(detected.descriptor, samples);
    if (distance > this.face.threshold) {
      throw new UnauthorizedException(
        'Khuôn mặt không khớp với người đã đăng ký. Chấm công thất bại.',
      );
    }

    // 4) Lưu ảnh audit (không chặn nếu storage lỗi) + ghi công
    let imageUrl: string | undefined;
    try {
      imageUrl = await this.images.upload(
        { ...file, originalname: 'check.jpg', mimetype: 'image/jpeg' },
        `attendance/checks/${employee.id}_${Date.now()}.jpg`,
      );
    } catch {
      imageUrl = undefined;
    }

    const rows = await this.proc.add({
      employeeId: employee.id,
      kind,
      ip,
      faceDistance: distance,
      imageUrl,
      note,
    });
    return { record: rows[0].result, distance };
  }

  // ---- Quản lý (admin) ----

  /** IP hiện tại + dải gợi ý để whitelist (IPv6 → /56, IPv4 → /32). */
  async currentIpInfo(ip: string): Promise<{ ip: string; suggestedCidr: string }> {
    const rows = await this.proc.suggestCidr(ip);
    return { ip, suggestedCidr: rows[0]?.result || ip };
  }

  async listNetworks(): Promise<AllowedNetwork[]> {
    const rows = await this.proc.networksList();
    return rows[0]?.result ?? [];
  }

  async upsertNetwork(input: unknown): Promise<AllowedNetwork> {
    const rows = await this.proc.networksUpsert(input);
    return rows[0].result;
  }

  async deleteNetwork(id: string): Promise<{ ok: boolean }> {
    const rows = await this.proc.networksDelete(id);
    return rows[0].result;
  }

  async history(input: unknown) {
    const rows = await this.proc.list(input);
    return rows[0].result;
  }

  async overview(): Promise<AttendanceOverviewRow[]> {
    const rows = await this.proc.overview();
    return rows[0]?.result ?? [];
  }

  /** Xoá toàn bộ mẫu mặt của 1 NV (admin, để NV đăng ký lại). */
  async clearFace(employeeId: string): Promise<{ ok: boolean; deleted: number }> {
    const rows = await this.proc.faceClear(employeeId);
    return rows[0].result;
  }
}
