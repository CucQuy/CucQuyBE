import { Global, Module } from '@nestjs/common';
import { MqttService } from './mqtt.service';

/** Global → mọi module inject MqttService không cần import lại (giống RedisModule). */
@Global()
@Module({
  providers: [MqttService],
  exports: [MqttService],
})
export class MqttModule {}
