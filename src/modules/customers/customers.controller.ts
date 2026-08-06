import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { Customer, CustomersService } from './customers.service';

/** Khách hàng — chỉ cần đăng nhập (CTV cũng tạo được khách hàng). */
@ApiTags('Khách hàng')
@Controller('customers')
@UseGuards(SsoAuthGuard)
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @Get()
  getAll() {
    return this.service.fetchCustomers();
  }

  /** Phân tích khách hàng (mới/quay lại/top + công nợ) trong kỳ. ?from&to (YYYY-MM-DD, rỗng = toàn bộ). */
  @Get('analytics')
  analytics(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.analytics(from, to);
  }

  @Post()
  create(@Body() body: Omit<Customer, 'id'>) {
    return this.service.addCustomer(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Partial<Omit<Customer, 'id'>>) {
    return this.service.updateCustomer(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.deleteCustomer(id);
  }
}
