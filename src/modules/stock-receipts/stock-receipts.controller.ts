import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { IpThrottlerGuard } from '../../common/ip-throttler.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser, UserRole } from '../../auth/user.types';
import { NotFoundException } from '@nestjs/common';
import { StockReceiptsService } from './stock-receipts.service';
import { BillPipelineService } from './bill-pipeline.service';
import { BillJobService } from './bill-job.service';
import { ProcessBillDto } from './dto/process-bill.dto';
import { ReceiptReconcileApplyDto } from './dto/reconcile-apply.dto';
import {
  MaterialUpdatePatch,
  MaterialCreateInput,
  SupplierCreateInput,
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
    private readonly billJobs: BillJobService,
  ) {}

  /** OCR + AI + gating: xử lý ảnh bill thành phiếu nhập (chưa lưu). */
  // Endpoint đắt tiền (OCR+AI, ~10s/bill). 60/phút/IP: dư cho bulk import
  // (concurrency 3 ~ tối đa ~18/phút) nhưng chặn lạm dụng.
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @UseGuards(IpThrottlerGuard)
  @Post('process-bill')
  processBill(@Body() dto: ProcessBillDto) {
    return this.billPipeline.processBill(dto.imageBase64);
  }

  /**
   * OCR bill dạng JOB NỀN — nhận ảnh NHỊ PHÂN (multipart 'file', KHÔNG base64 để
   * payload nhỏ + stream), trả jobId NGAY. FE poll GET process-bill/:jobId lấy kết quả.
   * Không giữ kết nối lâu → tránh 520 qua Cloudflare Tunnel / mạng nhà chập chờn.
   */
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @UseGuards(IpThrottlerGuard)
  @Post('process-bill/start')
  @UseInterceptors(FileInterceptor('file'))
  startBill(@UploadedFile() file: { buffer: Buffer } | undefined) {
    if (!file?.buffer?.length) throw new BadRequestException('Thiếu ảnh bill.');
    return { jobId: this.billJobs.start(file.buffer.toString('base64')) };
  }

  /** Trạng thái + kết quả job OCR bill. status: processing | done | error. */
  @Get('process-bill/:jobId')
  getBillJob(@Param('jobId') jobId: string) {
    const job = this.billJobs.get(jobId);
    if (!job) throw new NotFoundException('Job OCR không tồn tại hoặc đã hết hạn — nhập lại ảnh.');
    return job;
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

  /** Tồn dư (neo kiểm kê). */
  @Get('materials/stock-estimate')
  fetchMaterialStock() {
    return this.service.fetchMaterialStock();
  }

  /** Ghi 1 lần kiểm kê NVL (đếm tay). */
  @Post('materials/:id/stocktake')
  async recordStocktake(
    @Param('id') id: string,
    @Body() dto: { countedQty: number; countDate?: string; note?: string },
  ) {
    await this.service.recordStocktake(id, Number(dto?.countedQty) || 0, dto?.countDate, dto?.note);
    return { ok: true };
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

  /** GD tiền ra chưa gắn phiếu — cho màn khớp tay chọn thủ công. */
  @Get('unlinked-out-txns')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  listUnlinkedOutTxns() {
    return this.service.listUnlinkedOutTxns();
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
  /** Tạo NCC thủ công (không qua phiếu nhập). */
  @Post('suppliers')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async createSupplier(@Body() body: SupplierCreateInput) {
    const id = await this.service.createSupplier(body);
    return { id };
  }

  @Patch('suppliers/:id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async updateSupplier(
    @Param('id') id: string,
    @Body() body: Partial<SupplierContactInfo> & { name?: string; pinned?: boolean },
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

  /** Kiểm tra bill đang up đã có trong hệ thống chưa (trước khi lưu). */
  @Post('find-duplicate')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  findDuplicate(@Body() body: unknown) {
    return this.service.findDuplicate(body);
  }

  /**
   * Lưu phiếu nhập (tạo receipt + lines + upsert supplier/materials).
   * Route chính: POST /stock-receipts (tên đúng nghĩa). Giữ alias 'draft' cho FE cache cũ.
   */
  @Post(['', 'draft'])
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

  /** Gợi ý cặp khớp tự động tiền ra ↔ phiếu nhập (dry-run, không ghi). */
  @Post('reconcile/preview')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  reconcilePreview(@Body() body: { windowDays?: number }) {
    // Mặc định 0 = chỉ khớp theo SỐ TIỀN bằng nhau (không giới hạn ngày).
    const w = typeof body?.windowDays === 'number' ? body.windowDays : 0;
    return this.service.reconcilePreview(w);
  }

  /** Áp danh sách cặp {receiptId, transactionId} đã confirm. */
  @Post('reconcile/apply')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  reconcileApply(@Body() dto: ReceiptReconcileApplyDto) {
    return this.service.reconcileApply(dto.pairs);
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

  /** Tổng hợp phân bổ (paid/remaining/reconciled + danh sách GD) của 1 bill. */
  @Get(':id/allocations')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  allocSummary(@Param('id') id: string) {
    return this.service.allocSummary(id);
  }

  /** GD tiền ra còn lại có thể gắn cho 1 bill. */
  @Get(':id/available-txns')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  allocAvailable(@Param('id') id: string) {
    return this.service.allocAvailable(id);
  }

  /** Gắn thêm 1 GD tiền ra cho bill (amount rỗng → tự tính min còn-lại). */
  @Post(':id/allocations')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  allocAdd(
    @Param('id') id: string,
    @Body() body: { transactionId: string; amount?: number | null },
  ) {
    return this.service.allocAdd(id, body.transactionId, body.amount ?? null);
  }

  /** Xoá 1 phân bổ theo id. */
  @Delete('allocations/:allocId')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  allocRemove(@Param('allocId') allocId: string) {
    return this.service.allocRemove(allocId);
  }

  /** Đánh dấu / bỏ đánh dấu bill "đã khớp dù lệch" (không bắt buộc gắn đủ 100%). */
  @Post(':id/allocations/force')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  allocSetForced(@Param('id') id: string, @Body() body: { forced: boolean }) {
    return this.service.allocSetForced(id, body?.forced === true);
  }

  /** Xoá phiếu nhập (cascade: lines + tài sản/chi phí liên kết) + recompute tổng NCC/NVL.
   *  Dùng cho tính năng SỬA (FE tạo bản mới rồi xoá bản cũ). Chặn nếu phiếu đã đối soát. */
  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  deleteReceipt(@Param('id') id: string) {
    return this.service.deleteReceipt(id);
  }
}
