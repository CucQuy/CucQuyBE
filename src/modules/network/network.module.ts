import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { NetworkController } from './network.controller';
import { NetworkService } from './network.service';
import { NetworkProc } from './network.proc';
import { NetworkGuard } from './network.guard';

/**
 * Guard theo mạng cho từng màn (mở rộng từ giới hạn IP chấm công).
 * NetworkGuard đăng ký GLOBAL (APP_GUARD) → chặn mọi controller bị bật guard khi off-network.
 */
@Module({
  controllers: [NetworkController],
  providers: [
    NetworkService,
    NetworkProc,
    { provide: APP_GUARD, useClass: NetworkGuard },
  ],
  exports: [NetworkService],
})
export class NetworkModule {}
