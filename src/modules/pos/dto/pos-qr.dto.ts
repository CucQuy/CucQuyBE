import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

/** Payload đẩy QR thanh toán động xuống thiết bị POS/ESP32 (lúc tạo/mở đơn). */
export class PosQrDto {
  /** Mã đơn (vd DH001) — hiển thị + đối soát. */
  @IsString()
  @IsNotEmpty()
  order_id!: string;

  /** Số tiền cần thu (VND). */
  @IsNumber()
  @Min(0)
  amount!: number;

  /** Chuỗi VietQR EMV thô (00020101...) để thiết bị tự render QR. */
  @IsString()
  @IsNotEmpty()
  qr!: string;
}
