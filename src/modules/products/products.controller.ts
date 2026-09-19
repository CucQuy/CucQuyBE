import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { ProductsService } from './products.service';
import { ComboItem } from './products.types';

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

  /** Mọi combo (SP có thành phần). */
  @Get('combos/all')
  fetchCombos() {
    return this.service.fetchCombos();
  }

  /** Thành phần 1 combo + đối chiếu giá lẻ. */
  @Get(':id/combo')
  fetchCombo(@Param('id') id: string) {
    return this.service.fetchCombo(id);
  }

  /** Ghi đè thành phần combo — body: { items: [{productId, qty, portion, unitLabel, note}] }. */
  @Put(':id/combo')
  saveCombo(@Param('id') id: string, @Body() body: { items?: ComboItem[] }) {
    return this.service.saveCombo(id, body?.items ?? []);
  }
}
