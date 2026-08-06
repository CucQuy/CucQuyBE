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
import { ProductsService } from './products.service';

@ApiTags('Sản phẩm')
@Controller('products')
@UseGuards(SsoAuthGuard)
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  /** Danh sách sản phẩm. */
  @Get()
  fetchProducts() {
    return this.service.fetchProducts();
  }

  /** Phân tích sản phẩm (top bán chạy) trong kỳ. ?from&to (YYYY-MM-DD, rỗng = toàn bộ). */
  @Get('analytics')
  analytics(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.analytics(from, to);
  }

  /** Tạo sản phẩm — trả { id }. */
  @Post()
  addProduct(@Body() body: Record<string, unknown>) {
    return this.service.addProduct(body);
  }

  /** Cập nhật sản phẩm (ghi kèm version). */
  @Patch(':id')
  async updateProduct(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    await this.service.updateProduct(id, body);
    return { id };
  }

  /** Xoá field costPrice. */
  @Delete(':id/cost-price')
  async removeCostPrice(@Param('id') id: string) {
    await this.service.removeProductCostPrice(id);
    return { id };
  }

  /** Xoá sản phẩm. */
  @Delete(':id')
  async deleteProduct(@Param('id') id: string) {
    await this.service.deleteProduct(id);
    return { id };
  }

  /** Lịch sử version của sản phẩm. */
  @Get(':id/versions')
  fetchProductVersions(@Param('id') id: string) {
    return this.service.fetchProductVersions(id);
  }
}
