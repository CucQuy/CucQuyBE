import { Module } from '@nestjs/common';
import { RequestLogsController } from './request-logs.controller';
import { RequestLogsService } from './request-logs.service';
import { RequestLogProc } from './request-logs.proc';
import { LoggingMiddleware } from './logging.middleware';

/**
 * Module nhật ký request. Export RequestLogsService + LoggingMiddleware để
 * AppModule áp middleware (configure) cho mọi route.
 */
@Module({
  controllers: [RequestLogsController],
  providers: [RequestLogsService, RequestLogProc, LoggingMiddleware],
  exports: [RequestLogsService, LoggingMiddleware],
})
export class RequestLogsModule {}
