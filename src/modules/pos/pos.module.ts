import { Module } from '@nestjs/common';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

/** Điều khiển thiết bị POS/ESP32 (đẩy QR động qua MQTT). MqttService là @Global. */
@Module({
  controllers: [PosController],
  providers: [PosService],
  exports: [PosService],
})
export class PosModule {}
