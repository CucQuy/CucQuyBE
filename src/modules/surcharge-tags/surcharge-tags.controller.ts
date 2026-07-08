import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/user.types';
import { ResponseMessage } from '../../common/response-message.decorator';
import { SurchargeTagsService } from './surcharge-tags.service';
import { SurchargeTag } from './surcharge-tags.types';

@ApiTags('Tag phụ thu')
@Controller('surcharge-tags')
@UseGuards(SsoAuthGuard)
export class SurchargeTagsController {
  constructor(private readonly service: SurchargeTagsService) {}

  /** Lấy toàn bộ tag phụ thu. */
  @Get()
  fetch(): Promise<SurchargeTag[]> {
    return this.service.fetchSurchargeTags();
  }

  /** Lưu toàn bộ danh sách tag phụ thu (ghi đè). */
  @Put()
  @ResponseMessage('Đã lưu tag phụ thu')
  save(
    @Body() body: SurchargeTag[],
    @CurrentUser() user: AuthUser,
  ): Promise<SurchargeTag[]> {
    return this.service.saveSurchargeTags(body, {
      uid: user.uid,
      displayName: user.displayName,
    });
  }
}
