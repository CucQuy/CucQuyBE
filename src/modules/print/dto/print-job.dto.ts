import { IsBase64, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Payload in bill/phiếu bếp: bytes ESC/POS đã encode base64 (FE render raster rồi gửi). */
export class PrintJobDto {
  /** Chuỗi base64 của luồng ESC/POS thô. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(4_000_000) // ~3MB raster — chặn payload vô lý
  @IsBase64()
  base64!: string;
}
