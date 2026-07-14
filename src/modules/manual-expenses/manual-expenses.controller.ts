import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { ManualExpensesService } from './manual-expenses.service';
import { UpsertManualExpenseDto } from './dto/upsert-manual-expense.dto';

@ApiTags('Chi phí thủ công')
@Controller('manual-expenses')
@UseGuards(SsoAuthGuard)
export class ManualExpensesController {
  constructor(private readonly service: ManualExpensesService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  upsert(@Body() dto: UpsertManualExpenseDto) {
    return this.service.upsert(dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
    return { ok: true };
  }
}
