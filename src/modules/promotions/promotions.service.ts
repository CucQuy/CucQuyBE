import { Injectable } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { FirestoreService } from '../../firebase/firestore.service';
import {
  AppliedPromotion,
  ComputeInput,
  ComputeResult,
  Promotion,
  PromotionScope,
} from './promotions.types';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionDto } from './dto/update-promotion.dto';

const COL = 'promotions';
const round = (n: number) => Math.round(n);

@Injectable()
export class PromotionsService {
  constructor(private readonly fs: FirestoreService) {}

  // ───────────────────────── CRUD ─────────────────────────

  private map(id: string, r: Record<string, unknown>): Promotion {
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
    const arr = (v: unknown) =>
      Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : undefined;
    return {
      id,
      name: str(r.name) ?? '',
      applyMode: r.applyMode === 'CODE' ? 'CODE' : 'AUTO',
      code: str(r.code) ?? null,
      discountType: (str(r.discountType) ?? 'FIXED') as Promotion['discountType'],
      discountValue: num(r.discountValue) ?? 0,
      maxDiscount: num(r.maxDiscount) ?? null,
      groupBadgeId: str(r.groupBadgeId) ?? null,
      buyQuantity: num(r.buyQuantity),
      getQuantity: num(r.getQuantity),
      buyProductIds: arr(r.buyProductIds),
      getProductId: str(r.getProductId) ?? null,
      startAt: str(r.startAt) ?? null,
      endAt: str(r.endAt) ?? null,
      minOrderValue: num(r.minOrderValue) ?? 0,
      scope: (str(r.scope) ?? 'ALL') as PromotionScope,
      productIds: arr(r.productIds),
      categoryIds: arr(r.categoryIds),
      maxUses: num(r.maxUses) ?? null,
      usedCount: num(r.usedCount) ?? 0,
      status: r.status === 'inactive' ? 'inactive' : 'active',
      priority: num(r.priority) ?? 0,
      createdAt: str(r.createdAt),
      updatedAt: str(r.updatedAt),
      createdBy: str(r.createdBy),
    };
  }

  async findAll(): Promise<Promotion[]> {
    const snap = await this.fs.collection(COL).get();
    return snap.docs
      .map((d) => this.map(d.id, d.data() as Record<string, unknown>))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  async create(dto: CreatePromotionDto): Promise<{ id: string }> {
    const now = new Date().toISOString();
    const payload: Record<string, unknown> = {
      ...dto,
      code: dto.code ? dto.code.trim().toUpperCase() : null,
      status: dto.status ?? 'active',
      usedCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    const cleaned = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v !== undefined),
    );
    const ref = await this.fs.collection(COL).add(cleaned);
    return { id: ref.id };
  }

  async update(id: string, dto: UpdatePromotionDto): Promise<void> {
    const payload: Record<string, unknown> = {
      ...dto,
      ...(dto.code !== undefined && {
        code: dto.code ? dto.code.trim().toUpperCase() : null,
      }),
      updatedAt: new Date().toISOString(),
    };
    const cleaned = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v !== undefined),
    );
    await this.fs.collection(COL).doc(id).update(cleaned);
  }

  async remove(id: string): Promise<void> {
    await this.fs.collection(COL).doc(id).delete();
  }

  // ─────────────────── Engine tính giảm giá ───────────────────

  /** Tính giảm giá thẩm quyền cho 1 giỏ hàng (dùng cho /preview và lúc tạo đơn). */
  async computeForCart(input: ComputeInput): Promise<ComputeResult> {
    const items = input.items ?? [];
    const decorations = input.decorations ?? [];
    const shippingCost = input.shippingCost ?? 0;
    const codeNorm = input.code?.trim().toUpperCase() || null;
    const selected = new Set(input.promotionIds ?? []); // chiến dịch CTV chọn

    const itemsTotal = items.reduce((s, it) => s + (it.price || 0) * (it.quantity || 0), 0);
    const decoTotal = decorations.reduce((s, d) => s + (d.price || 0) * (d.quantity || 0), 0);
    const subtotal = round(itemsTotal + decoTotal);

    const result: ComputeResult = {
      subtotal,
      shippingCost,
      discountAmount: 0,
      total: round(subtotal + shippingCost),
      appliedPromotions: [],
      giftItems: [],
      errors: [],
    };

    const all = await this.findAll();
    const now = Date.now();
    const errors: string[] = [];

    // Bản đồ productId -> category (chỉ nạp khi có promo scope CATEGORIES)
    let catMap: Map<string, string> | null = null;
    const needCat = all.some((p) => p.scope === 'CATEGORIES');
    if (needCat) catMap = await this.productCategoryMap(items.map((i) => i.productId));

    // BUY_X_GET_Y theo nhóm: sản phẩm lưu badge dưới dạng TÊN trong `tags`,
    // còn promo lưu groupBadgeId → cần map id→tên để so khớp.
    let productTags: Map<string, string[]> | null = null;
    let badgeNameById: Map<string, string> | null = null;
    const needBadge = all.some((p) => p.discountType === 'BUY_X_GET_Y');
    if (needBadge) {
      productTags = await this.productTagsMap(items.map((i) => i.productId));
      badgeNameById = await this.badgeNameMap();
    }

    const eligible: { promo: Promotion; amount: number }[] = [];
    const bxgyApplied: { promo: Promotion; amount: number }[] = []; // mua N tặng M (giảm tiền)

    for (const p of all) {
      if (p.status !== 'active') continue;

      // Chỉ áp khi: CTV CHỌN chiến dịch này, HOẶC mã nhập khớp. KHÔNG tự áp.
      const chosen = selected.has(p.id);
      const byCode = p.applyMode === 'CODE' && !!codeNorm && p.code === codeNorm;
      if (!chosen && !byCode) continue;

      const reason = this.ineligibleReason(p, now, subtotal);
      if (reason) {
        errors.push(reason);
        continue;
      }

      // Mua N tặng M theo nhóm (badge): món rẻ nhất thành 0đ → giảm tiền.
      if (p.discountType === 'BUY_X_GET_Y') {
        const amt = this.bxgyDiscount(p, items, productTags, badgeNameById);
        if (amt > 0) bxgyApplied.push({ promo: p, amount: amt });
        else errors.push(`"${p.name}": đơn chưa đủ điều kiện mua N tặng M của nhóm.`);
        continue;
      }

      const amount = this.discountAmount(p, items, decorations, subtotal, shippingCost, catMap);
      if (amount > 0) eligible.push({ promo: p, amount });
      else errors.push(`"${p.name}": không áp dụng cho sản phẩm trong đơn.`);
    }

    // Mã nhập nhưng không tồn tại / không active.
    if (codeNorm && !all.some((p) => p.code === codeNorm && p.status === 'active')) {
      errors.push('Mã không hợp lệ hoặc đã hết hạn.');
    }

    // Quy tắc Phase 1: FREE_SHIP có thể cộng cùng 1 giảm-giá-trị tốt nhất.
    const freeShip = eligible
      .filter((e) => e.promo.discountType === 'FREE_SHIP')
      .sort((a, b) => b.amount - a.amount)[0];
    const bestValue = eligible
      .filter((e) => e.promo.discountType !== 'FREE_SHIP')
      .sort((a, b) => b.amount - a.amount)[0];

    // FREE_SHIP + 1 giảm-giá-trị tốt nhất + mọi "mua N tặng M" (đều cộng dồn).
    const applied: AppliedPromotion[] = [];
    for (const e of [bestValue, freeShip, ...bxgyApplied]) {
      if (!e) continue;
      applied.push({
        promotionId: e.promo.id,
        code: e.promo.code ?? null,
        name: e.promo.name,
        type: e.promo.discountType,
        amount: e.amount,
      });
    }

    let discountAmount = applied.reduce((s, a) => s + a.amount, 0);
    // Không vượt quá tổng tiền hàng + ship (total không âm).
    discountAmount = Math.min(discountAmount, subtotal + shippingCost);

    result.discountAmount = round(discountAmount);
    result.total = round(subtotal + shippingCost - discountAmount);
    result.appliedPromotions = applied;
    result.giftItems = [];
    result.errors = errors;
    return result;
  }

  /**
   * Giảm tiền "mua N tặng M" theo nhóm badge: cứ đủ (N+M) món thuộc badge trong giỏ
   * thì M món RẺ NHẤT thành 0đ. Lặp lại. Trả về tổng tiền được giảm.
   */
  private bxgyDiscount(
    p: Promotion,
    items: ComputeInput['items'],
    productTags: Map<string, string[]> | null,
    badgeNameById: Map<string, string> | null,
  ): number {
    const gid = p.groupBadgeId;
    if (!gid || !productTags || !badgeNameById) return 0;
    // Sản phẩm lưu badge bằng TÊN trong tags → resolve groupBadgeId sang tên.
    const groupName = badgeNameById.get(gid);
    if (!groupName) return 0;
    const N = p.buyQuantity && p.buyQuantity > 0 ? p.buyQuantity : 1;
    const M = p.getQuantity && p.getQuantity > 0 ? p.getQuantity : 1;
    const block = N + M;

    // Bung từng đơn vị (mỗi cái 1 giá) của các sản phẩm có tag = tên nhóm.
    const units: number[] = [];
    for (const it of items) {
      if (!it.productId) continue;
      if (!(productTags.get(it.productId) ?? []).includes(groupName)) continue;
      for (let i = 0; i < (it.quantity || 0); i++) units.push(it.price || 0);
    }
    if (units.length < block) return 0;
    const freeCount = Math.floor(units.length / block) * M;
    if (freeCount <= 0) return 0;
    units.sort((a, b) => a - b); // rẻ nhất trước
    let sum = 0;
    for (let i = 0; i < freeCount; i++) sum += units[i];
    return round(sum);
  }

  /** Lý do KHÔNG hợp lệ (null = hợp lệ). */
  private ineligibleReason(p: Promotion, now: number, subtotal: number): string | null {
    if (p.startAt && now < Date.parse(p.startAt)) return 'Chương trình chưa bắt đầu.';
    if (p.endAt && now > Date.parse(p.endAt)) return 'Chương trình đã kết thúc.';
    if (p.minOrderValue && subtotal < p.minOrderValue)
      return `Đơn tối thiểu ${p.minOrderValue.toLocaleString('vi-VN')}đ để áp dụng.`;
    if (p.maxUses != null && p.usedCount >= p.maxUses) return 'Khuyến mãi đã hết lượt.';
    return null;
  }

  /** Số tiền giảm của 1 promo cho giỏ này (0 nếu không khớp phạm vi). */
  private discountAmount(
    p: Promotion,
    items: ComputeInput['items'],
    decorations: NonNullable<ComputeInput['decorations']>,
    subtotal: number,
    shippingCost: number,
    catMap: Map<string, string> | null,
  ): number {
    if (p.discountType === 'FREE_SHIP') return round(shippingCost);

    // eligibleSubtotal theo phạm vi
    let base: number;
    if (p.scope === 'ALL') {
      base = subtotal;
    } else {
      const matchIds = new Set(
        p.scope === 'PRODUCTS' ? p.productIds ?? [] : p.categoryIds ?? [],
      );
      base = items.reduce((s, it) => {
        const key =
          p.scope === 'PRODUCTS'
            ? it.productId
            : it.productId
              ? catMap?.get(it.productId)
              : undefined;
        return key && matchIds.has(key) ? s + (it.price || 0) * (it.quantity || 0) : s;
      }, 0);
    }
    if (base <= 0) return 0;

    if (p.discountType === 'PERCENT') {
      let amt = (base * (p.discountValue ?? 0)) / 100;
      if (p.maxDiscount != null) amt = Math.min(amt, p.maxDiscount);
      return round(amt);
    }
    if (p.discountType === 'FIXED') {
      return round(Math.min(p.discountValue ?? 0, base));
    }
    return 0;
  }

  /** Lấy `tags` (tên badge) theo productId — để xét nhóm cho "mua N tặng M". */
  private async productTagsMap(
    productIds: (string | undefined)[],
  ): Promise<Map<string, string[]>> {
    const ids = [...new Set(productIds.filter((x): x is string => !!x))];
    const map = new Map<string, string[]>();
    if (!ids.length) return map;
    const refs = ids.map((id) => this.fs.collection('products').doc(id));
    const snaps = await this.fs.firestore.getAll(...refs);
    for (const s of snaps) {
      const d = s.data();
      if (s.exists && d && Array.isArray(d.tags)) {
        map.set(s.id, (d.tags as unknown[]).filter((x): x is string => typeof x === 'string'));
      }
    }
    return map;
  }

  /** Map badgeId → tên badge (từ configurations/badges.productBadges). */
  private async badgeNameMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const doc = await this.fs.collection('configurations').doc('badges').get();
    const list = (doc.data()?.productBadges as unknown[]) ?? [];
    for (const b of list) {
      if (b && typeof b === 'object') {
        const o = b as Record<string, unknown>;
        if (typeof o.id === 'string' && typeof o.name === 'string') map.set(o.id, o.name);
      }
    }
    return map;
  }

  private async productCategoryMap(
    productIds: (string | undefined)[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(productIds.filter((x): x is string => !!x))];
    const map = new Map<string, string>();
    if (!ids.length) return map;
    const refs = ids.map((id) => this.fs.collection('products').doc(id));
    const snaps = await this.fs.firestore.getAll(...refs);
    for (const s of snaps) {
      const data = s.data();
      if (s.exists && data && typeof data.category === 'string') {
        map.set(s.id, data.category);
      }
    }
    return map;
  }

  // ─────────────────── Lượt dùng (redeem / release) ───────────────────

  /** Tăng usedCount cho các promo đã áp (atomic, chặn vượt maxUses). Gọi khi tạo đơn. */
  async redeem(applied: AppliedPromotion[]): Promise<void> {
    for (const a of applied) {
      const ref = this.fs.collection(COL).doc(a.promotionId);
      await this.fs.firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const d = snap.data() as Record<string, unknown>;
        const used = typeof d.usedCount === 'number' ? d.usedCount : 0;
        const max = typeof d.maxUses === 'number' ? d.maxUses : null;
        if (max != null && used >= max) return; // hết lượt → không tăng nữa
        tx.update(ref, { usedCount: used + 1 });
      });
    }
  }

  /** Hoàn lại lượt khi huỷ/gỡ khuyến mãi khỏi đơn. */
  async release(applied: AppliedPromotion[]): Promise<void> {
    for (const a of applied) {
      const ref = this.fs.collection(COL).doc(a.promotionId);
      await this.fs.firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const d = snap.data() as Record<string, unknown>;
        const used = typeof d.usedCount === 'number' ? d.usedCount : 0;
        tx.update(ref, { usedCount: Math.max(0, used - 1) });
      });
    }
  }
}
