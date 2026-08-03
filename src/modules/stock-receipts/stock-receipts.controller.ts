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
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser, UserRole } from '../../auth/user.types';
import { StockReceiptsService } from './stock-receipts.service';
import { BillPipelineService } from './bill-pipeline.service';
import { ProcessBillDto } from './dto/process-bill.dto';
import {
  MaterialUpdatePatch,
  MaterialCreateInput,
  SaveStockReceiptDraftInput,
  SupplierContactInfo,
} from './stock-receipts.types';

@ApiTags('Nhập kho')
@Controller('stock-receipts')
@UseGuards(SsoAuthGuard, RolesGuard)
export class StockReceiptsController {
  constructor(
    private readonly service: StockReceiptsService,
    private readonly billPipeline: BillPipelineService,
  ) {}

  /** OCR + AI + gating: xử lý ảnh bill thành phiếu nhập (chưa lưu). */
  @Post('process-bill')
  processBill(@Body() dto: ProcessBillDto) {
    return this.billPipeline.processBill(dto.imageBase64);
  }

  /** Danh sách NCC đã nhập. */
  @Get('suppliers')
  fetchImportedSuppliers() {
    return this.service.fetchImportedSuppliers();
  }

  /** Danh sách nguyên liệu đã nhập. */
  @Get('materials')
  fetchImportedMaterials() {
    return this.service.fetchImportedMaterials();
  }

  /** Gợi ý các cặp nguyên liệu nghi trùng (Phase 1). threshold optional (mặc định 0.4). */
  @Get('materials/merge-suggestions')
  getMaterialMergeSuggestions(@Query('threshold') threshold?: string) {
    const t = threshold !== undefined ? Number(threshold) : undefined;
    return this.service.getMaterialMergeSuggestions(t);
  }

  /** Gợi ý gộp NVL bằng AI (Claude) — gom nhóm cùng sản phẩm, chịu OCR sai/thiếu dấu. */
  @Get('materials/merge-suggestions/ai')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  getMaterialMergeSuggestionsAi() {
    return this.service.getMaterialMergeSuggestionsAi();
  }

  /** Nguyên liệu kèm đơn giá nhập TB (dropdown OrderForm). */
  @Get('material-options')
  fetchMaterialPriceOptions() {
    return this.service.fetchMaterialPriceOptions();
  }

  /** Phiếu nhập + field đối soát — đối soát tiền ra ↔ phiếu nhập (tab Tiền ra). */
  @Get('for-reconcile')
  listReceiptsForReconcile() {
    return this.service.listReceiptsForReconcile();
  }

  /** Danh sách phiếu nhập (summary). */
  @Get()
  fetchStockReceiptSummaries() {
    return this.service.fetchStockReceiptSummaries();
  }

  /** Chi tiết 1 phiếu nhập. */
  @Get(':id')
  fetchStockReceiptDetail(@Param('id') id: string) {
    return this.service.fetchStockReceiptDetail(id);
  }

  /** Cập nhật thông tin NCC. */
  @Patch('suppliers/:id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async updateSupplier(
    @Param('id') id: string,
    @Body() body: Partial<SupplierContactInfo> & { name?: string },
  ) {
    await this.service.updateSupplier(id, body);
    return { id };
  }

  /** Sửa nguyên liệu (NVL): name / canonicalUnit. */
  @Patch('materials/:id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async updateMaterial(
    @Param('id') id: string,
    @Body() body: MaterialUpdatePatch,
  ) {
    await this.service.updateMaterial(id, body);
    return { id };
  }

  /** Tạo NVL thủ công (không qua phiếu nhập). */
  @Post('materials')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async createMaterial(@Body() body: MaterialCreateInput) {
    const id = await this.service.createMaterial(body);
    return { id };
  }

  /** Lưu phiếu nhập (tạo receipt + lines + upsert supplier/materials). */
  @Post('draft')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  saveStockReceiptDraft(
    @Body() body: SaveStockReceiptDraftInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.saveStockReceiptDraft({
      ...body,
      createdByUid: user?.uid ?? null,
    });
  }

  /** Gộp nhiều NCC trùng vào 1 root. */
  @Post('suppliers/merge')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async mergeSuppliers(
    @Body() body: { rootId: string; duplicateIds: string[] },
  ) {
    await this.service.mergeSuppliers(body.rootId, body.duplicateIds ?? []);
    return { ok: true };
  }

  /** Gộp nhiều nguyên liệu trùng vào 1 root. */
  @Post('materials/merge')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async mergeMaterials(
    @Body() body: { rootId: string; duplicateIds: string[] },
  ) {
    await this.service.mergeMaterials(body.rootId, body.duplicateIds ?? []);
    return { ok: true };
  }

  /** Gắn 1 giao dịch SePay tiền ra cho 1 phiếu nhập (đối soát thanh toán tổng kho). */
  @Post(':id/reconcile')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  reconcileReceipt(
    @Param('id') id: string,
    @Body() body: { transactionId: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reconcileReceipt(id, body.transactionId, user);
  }

  /** Gỡ đối soát phiếu nhập. */
  @Post(':id/unreconcile')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  unreconcileReceipt(@Param('id') id: string) {
    return this.service.unreconcileReceipt(id);
  }

  /** Xoá phiếu nhập (cascade: lines + tài sản/chi phí liên kết) + recompute tổng NCC/NVL.
   *  Dùng cho tính năng SỬA (FE tạo bản mới rồi xoá bản cũ). Chặn nếu phiếu đã đối soát. */
  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  deleteReceipt(@Param('id') id: string) {
    return this.service.deleteReceipt(id);
  }
}
