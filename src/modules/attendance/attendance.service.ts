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

  /**
   * Đăng ký 1 mẫu khuôn mặt. self = NV tự đăng ký; admin có thể truyền employeeId để đăng ký hộ.
   * reset = xoá mẫu cũ trước.
   */
  async registerFace(
    actorEmail: string | undefined,
    actorRole: UserRole | undefined,
    file: UploadFile | undefined,
    employeeId?: string,
    reset?: boolean,
  ): Promise<{ employeeId: string; faceCount: number }> {
    if (!file?.buffer?.length) throw new BadRequestException('Thiếu ảnh khuôn mặt');

    let targetId: string;
    if (employeeId) {
      const isAdmin =
        actorRole === UserRole.ADMIN || actorRole === UserRole.SUPER_ADMIN;
      if (!isAdmin) {
        throw new ForbiddenException('Chỉ quản lý mới đăng ký hộ nhân viên khác');
      }
      targetId = employeeId;
    } else {
      targetId = (await this.requireEmployee(actorEmail)).id;
    }

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
