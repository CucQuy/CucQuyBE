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
    this.mqtt.publish(
      MQTT_TOPICS.POS_QR,
      { order_id: dto.order_id, amount: dto.amount, qr: dto.qr, at: new Date().toISOString() },
      { qos: 1, retain: true },
    );
    this.logger.log(`pos/qr ← ${dto.order_id} (${dto.amount}đ)`);
  }

  clear(): void {
    this.mqtt.publish(
      MQTT_TOPICS.POS_QR,
      { cleared: true, at: new Date().toISOString() },
      { qos: 1, retain: true },
    );
    this.logger.log('pos/qr ← cleared');
  }
}
