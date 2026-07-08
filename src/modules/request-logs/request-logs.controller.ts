import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { UserRole } from '../../auth/user.types';
import { RequestLogsService } from './request-logs.service';
import { QueryLogsDto, StatsLogsDto, TimeseriesLogsDto, ErrorGroupsDto } from './dto/query-logs.dto';

/** Nhật ký request — chỉ admin xem được. */
@ApiTags('Nhật ký Request')
@Controller('request-logs')
@UseGuards(SsoAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
export class RequestLogsController {
  constructor(private readonly service: RequestLogsService) {}

  /** Danh sách log có lọc + phân trang. */
  @Get()
  list(@Query() query: QueryLogsDto) {
    return this.service.queryLogs(query);
  }

  /** Thống kê tổng quan (tổng request, lỗi, IP, thời gian TB, top path/IP/quốc gia, phân bố). */
  @Get('stats')
  stats(@Query() query: StatsLogsDto) {
    return this.service.stats(query);
  }

  /** Chuỗi thời gian lưu lượng (gom theo giờ/ngày) cho biểu đồ. */
  @Get('timeseries')
  timeseries(@Query() query: TimeseriesLogsDto) {
    return this.service.timeseries(query);
  }

  /** Gom lỗi theo (method,path,status) — kiểu Sentry. */
  @Get('error-groups')
  errorGroups(@Query() query: ErrorGroupsDto) {
    return this.service.errorGroups(query);
  }
}
