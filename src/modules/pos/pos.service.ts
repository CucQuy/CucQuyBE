import { Injectable, Logger } from '@nestjs/common';
import { MqttService } from '../../mqtt/mqtt.service';
import { MQTT_TOPICS } from '../../mqtt/mqtt.constants';
import { PosQrDto } from './dto/pos-qr.dto';

/**
 * Điều khiển màn hình thiết bị POS/ESP32 qua MQTT.
 * - showQr: đẩy QR thanh toán động (retain → thiết bị nối sau vẫn lấy đơn hiện tại).
 * - clear : xoá QR (về màn chờ) — thường gọi sau khi đơn đã thanh toán.
 * No-op nếu MQTT chưa cấu hình (MqttService tự nuốt).
 */
@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);

  constructor(private readonly mqtt: MqttService) {}

  showQr(dto: PosQrDto): void {
    // Key khớp firmware ESP32: { order_id, amount, qr }. Retain → thiết bị nối sau vẫn thấy.
    this.mqtt.publish(
      MQTT_TOPICS.ORDER_CREATE,
      { order_id: dto.order_id, amount: dto.amount, qr: dto.qr },
      { qos: 1, retain: true },
    );
    this.logger.log(`order/create ← ${dto.order_id} (${dto.amount}đ)`);
  }

  clear(): void {
    // Báo thiết bị về màn chính + xoá retained QR (device nối sau không hiện đơn cũ).
    this.mqtt.publish(MQTT_TOPICS.ORDER_CANCEL, {}, { qos: 1, retain: false });
    this.mqtt.clearRetained(MQTT_TOPICS.ORDER_CREATE);
    this.logger.log('order/cancel → về màn chính (retained QR xoá)');
  }
}
