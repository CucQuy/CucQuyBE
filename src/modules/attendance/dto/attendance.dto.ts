import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Chấm công vào/ra (ảnh gửi kèm dạng multipart field 'file'). */
export class CheckDto {
  @IsIn(['in', 'out'])
  kind!: 'in' | 'out';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

/** Đăng ký khuôn mặt. employeeId chỉ dùng khi admin đăng ký hộ NV khác. */
export class RegisterFaceDto {
  @IsOptional()
  @IsString()
  employeeId?: string;

  /** true = xoá mẫu cũ rồi thêm mới (đăng ký lại từ đầu). */
  @IsOptional()
  @IsString()
  reset?: string;
}

/** Thêm/sửa dải mạng cho phép chấm công. */
export class UpsertNetworkDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsString()
  ipCidr!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
