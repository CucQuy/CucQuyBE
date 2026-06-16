import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { FirestoreService } from '../../firebase/firestore.service';
import { AuthUser, UserRole } from '../../auth/user.types';
import { diffOrders } from './order-history-diff';
import {
  DELIVERY_TYPE_SHIP,
  Order,
  OrderCustomer,
  PAYMENT_METHOD_CASH,
  PAYMENT_STATUS_UNPAID,
} from './orders.types';
import { AppliedPromotion } from '../promotions/promotions.types';
import { PromotionsService } from '../promotions/promotions.service';

const COL = 'orders';

/** Ném khi CTV cố cập nhật đơn không phải do họ tạo. Giữ trùng giá trị FE. */
export const ORDER_EDIT_DENIED = 'ORDER_EDIT_DENIED';

@Injectable()
export class OrdersService {
  constructor(
    private readonly fs: FirestoreService,
    private readonly promotions: PromotionsService,
  ) {}

  // ── Resolve tên hiển thị người tạo (như FE getUserByUid) ──
  private async resolveCreatorNames(
    uids: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const unique = [...new Set(uids.filter((u) => u))];
    await Promise.all(
      unique.map(async (uid) => {
        const snap = await this.fs.collection('users').doc(uid).get();
        const r = snap.exists ? (snap.data() as Record<string, unknown>) : {};
        const name =
          (typeof r.customName === 'string' && r.customName) ||
          (typeof r.displayName === 'string' && r.displayName) ||
          (typeof r.email === 'string' && r.email) ||
          uid;
        map.set(uid, name);
      }),
    );
    return map;
  }

  // ── Đọc (type-guard mọi field như FE) ─────────────────────
  async fetchOrders(): Promise<Order[]> {
    const snap = await this.fs.collection(COL).get();

    const raws = snap.docs.map((d) => ({
      id: d.id,
      data: d.data() as Record<string, unknown>,
    }));

    const creatorUids = raws
      .map((x) =>
        typeof x.data.createdBy === 'string' && x.data.createdBy.length > 0
          ? (x.data.createdBy as string)
          : undefined,
      )
      .filter((u): u is string => !!u);
    const nameByUid = await this.resolveCreatorNames(creatorUids);

    const orders = raws.map(({ id, data }) => {
      const creatorUid =
        typeof data.createdBy === 'string' && data.createdBy.length > 0
          ? (data.createdBy as string)
          : undefined;
      return {
        ...(data as Record<string, unknown>),
        id,
        createdByUid: creatorUid,
        createdBy: creatorUid ? nameByUid.get(creatorUid) ?? creatorUid : '',
      } as Order;
    });

    // Sort như FE: theo orderNumber desc.
    return orders.sort((a, b) =>
      (b.orderNumber ?? '').localeCompare(a.orderNumber ?? ''),
    );
  }

  // ── Sinh số đơn (port nguyên FE getNextOrderNumber) ────────
  async getNextOrderNumber(): Promise<string> {
    try {
      const snap = await this.fs
        .collection(COL)
        .orderBy('orderNumber', 'desc')
        .limit(1)
        .get();

      if (!snap.empty) {
        const lastOrder = snap.docs[0].data() as Record<string, unknown>;
        const lastNumberStr = lastOrder.orderNumber;

        if (
          typeof lastNumberStr === 'string' &&
          lastNumberStr.startsWith('ORD-')
        ) {
          const numPart = parseInt(lastNumberStr.split('-')[1], 10);
          if (!Number.isNaN(numPart)) {
            return `ORD-${String(numPart + 1).padStart(6, '0')}`;
          }
        }
      }
      return 'ORD-000001';
    } catch {
      return `ORD-${Date.now().toString().slice(-6)}`;
    }
  }

  // ── Tạo đơn (whitelist field GIỐNG HỆT FE addOrder) ────────
  async addOrder(
    orderData: Record<string, any>,
    _currentUser: AuthUser,
  ): Promise<Order> {
    const orderNumber =
      (typeof orderData.orderNumber === 'string' && orderData.orderNumber) ||
      (await this.getNextOrderNumber());

    const c = orderData.customer || {};
    const items = orderData.items || [];
    const decorations = orderData.decorations || [];
    const shippingCost = orderData.shippingCost || 0;

    // Tính giảm giá THẨM QUYỀN từ backend (không tin số discount/total do FE gửi).
    // LƯU Ý: item đơn dùng `id` = productId → map sang productId cho engine.
    const promo = await this.promotions.computeForCart({
      items: items.map((it: any) => ({
        productId: it.productId || it.id,
        price: it.price,
        quantity: it.quantity,
      })),
      decorations,
      shippingCost,
      code: orderData.appliedPromotionCode,
      promotionIds: orderData.appliedPromotionIds,
    });
    const hasItems = items.length > 0;
    const subtotal = hasItems ? promo.subtotal : (orderData.total || 0);
    const discountAmount = hasItems ? promo.discountAmount : 0;
    const total = hasItems ? promo.total : (orderData.total || 0);

    const payload: Record<string, any> = {
      orderNumber,
      sepayId: orderData.sepayId || null,
      customerName: c.name || '',
      phone: c.phone || '',
      address: c.address || '',
      email: c.email || '',
      customer: {
        id: c.id || '',
        name: c.name || '',
        phone: c.phone || '',
        address: c.address || '',
        email: c.email || '',
        city: c.city || '',
        country: c.country || '',
      },
      items,
      decorations,
      shippingCost,
      subtotal,
      discountAmount,
      appliedPromotions: promo.appliedPromotions,
      giftItems: hasItems ? promo.giftItems : [],
      total,
      note: orderData.note || '',
      status: orderData.status,
      deliveryDate: orderData.deliveryDate || null,
      deliveryTime: orderData.deliveryTime || null,
      orderDate: admin.firestore.Timestamp.now(),
      createdAt: admin.firestore.Timestamp.now(),
      paymentStatus: orderData.paymentStatus || PAYMENT_STATUS_UNPAID,
      paymentMethod: orderData.paymentMethod || PAYMENT_METHOD_CASH,
      isTest: !!orderData.isTest,
      deliveryType: orderData.deliveryType || DELIVERY_TYPE_SHIP,
      createdBy: orderData.createdBy || undefined,
      ...(orderData.commissionAmount !== undefined && {
        commissionAmount: orderData.commissionAmount,
      }),
      ...(orderData.commissionStatus && {
        commissionStatus: orderData.commissionStatus,
      }),
    };

    // Firestore không nhận undefined.
    const cleaned = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v !== undefined),
    );

    const ref = await this.fs.collection(COL).add(cleaned);

    // Trừ lượt dùng khuyến mãi (atomic). Huỷ đơn sau này gọi release() để hoàn.
    if (promo.appliedPromotions.length > 0) {
      await this.promotions.redeem(promo.appliedPromotions);
    }

    // Trả order đã tạo (gồm id + orderNumber) cho FE gửi Zalo.
    return {
      ...(cleaned as Record<string, unknown>),
      id: ref.id,
      orderNumber,
      customer: cleaned.customer as OrderCustomer,
    } as Order;
  }

  // ── Cập nhật đơn (check quyền + ghi history) ───────────────
  async updateOrder(
    orderId: string,
    orderData: Record<string, any>,
    currentUser: AuthUser,
  ): Promise<Order> {
    const orderRef = this.fs.collection(COL).doc(orderId);
    const existingSnap = await orderRef.get();
    if (!existingSnap.exists) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }
    const existing = existingSnap.data() as Record<string, any>;
    const creatorUid =
      typeof existing.createdBy === 'string'
        ? (existing.createdBy as string)
        : undefined;

    // CTV chỉ được sửa đơn của chính mình.
    if (currentUser?.role === UserRole.COLABORATOR) {
      if (!currentUser.uid || !creatorUid || creatorUid !== currentUser.uid) {
        throw new ForbiddenException(ORDER_EDIT_DENIED);
      }
    }

    const c = orderData.customer || {};
    const safeCustomer = {
      id: c.id || '',
      name: c.name || '',
      phone: c.phone || '',
      address: c.address || '',
      email: c.email || '',
      city: c.city || '',
      country: c.country || '',
    };

    // Tính lại khuyến mãi THẨM QUYỀN khi sửa đơn (giống lúc tạo) — không tin số FE.
    const items = orderData.items || [];
    const decorations = orderData.decorations || [];
    const shippingCost = orderData.shippingCost || 0;
    const promo = await this.promotions.computeForCart({
      items: items.map((it: any) => ({
        productId: it.productId || it.id,
        price: it.price,
        quantity: it.quantity,
      })),
      decorations,
      shippingCost,
      code: orderData.appliedPromotionCode,
      promotionIds: orderData.appliedPromotionIds,
    });
    const hasItems = items.length > 0;
    const subtotal = hasItems ? promo.subtotal : (orderData.total || 0);
    const discountAmount = hasItems ? promo.discountAmount : 0;
    const total = hasItems ? promo.total : (orderData.total || 0);

    const payload: Record<string, any> = {
      customerName: safeCustomer.name,
      phone: safeCustomer.phone,
      address: safeCustomer.address,
      email: safeCustomer.email,
      customer: safeCustomer,
      items,
      decorations,
      shippingCost,
      subtotal,
      discountAmount,
      appliedPromotions: promo.appliedPromotions,
      total,
      note: orderData.note || '',
      status: orderData.status,
      ...(orderData.deliveryDate !== undefined && {
        deliveryDate: orderData.deliveryDate || null,
      }),
      ...(orderData.deliveryTime !== undefined && {
        deliveryTime: orderData.deliveryTime || null,
      }),
      paymentStatus: orderData.paymentStatus || PAYMENT_STATUS_UNPAID,
      paymentMethod: orderData.paymentMethod || PAYMENT_METHOD_CASH,
      ...(orderData.sepayId !== undefined && { sepayId: orderData.sepayId }),
      ...(orderData.isTest !== undefined && { isTest: !!orderData.isTest }),
      ...(orderData.deliveryType !== undefined && {
        deliveryType: orderData.deliveryType,
      }),
      updatedAt: admin.firestore.Timestamp.now(),
    };

    // Tính diff giữa existing và payload mới -> append history entry.
    const changes = diffOrders(existing, {
      ...existing,
      ...payload,
      customer: safeCustomer,
    });

    if (changes.length > 0) {
      const uidShort = currentUser?.uid
        ? 'User-' + currentUser.uid.slice(0, 6)
        : null;
      const editorName =
        currentUser?.displayName || currentUser?.email || uidShort || 'Unknown';
      const newEntry = {
        at: admin.firestore.Timestamp.now(),
        by: editorName || 'Unknown',
        byUid: currentUser?.uid || '',
        changes: changes.map((c2) => ({
          field: c2.field || '',
          label: c2.label || '',
          oldValue: c2.oldValue ?? '—',
          newValue: c2.newValue ?? '—',
        })),
      };
      payload.history = admin.firestore.FieldValue.arrayUnion(newEntry);
      payload.updatedBy = editorName || 'Unknown';
    }

    await orderRef.update(payload);

    // Điều chỉnh lượt dùng khuyến mãi: hoàn lượt của bộ cũ, trừ lượt cho bộ mới.
    if (hasItems) {
      const oldApplied = Array.isArray(existing.appliedPromotions)
        ? existing.appliedPromotions
        : [];
      if (oldApplied.length) await this.promotions.release(oldApplied);
      if (promo.appliedPromotions.length) await this.promotions.redeem(promo.appliedPromotions);
    }

    // Trả order sau cập nhật + `changes` + `prevOrder` để FE gửi Zalo update.
    // KHÔNG gửi Zalo trong BE.
    return {
      ...existing,
      ...payload,
      // arrayUnion là sentinel — không trả thẳng về client.
      history: undefined,
      id: orderId,
      orderNumber: existing.orderNumber,
      customer: safeCustomer,
      createdByUid: creatorUid,
      changes,
      prevOrder: { ...existing, id: orderId },
    } as Order & { changes: unknown[]; prevOrder: unknown };
  }

  /** Xoá đơn — trả lại snapshot đã xoá để FE gửi Zalo delete notify. */
  async deleteOrder(id: string): Promise<{ id: string; prevOrder: unknown }> {
    const ref = this.fs.collection(COL).doc(id);
    const snap = await ref.get();
    const data = snap.exists ? (snap.data() as Record<string, unknown>) : null;
    const prevOrder = data ? { ...data, id } : null;
    await ref.delete();
    // Hoàn lượt dùng khuyến mãi của đơn bị xoá.
    if (data && Array.isArray(data.appliedPromotions) && data.appliedPromotions.length) {
      await this.promotions.release(data.appliedPromotions as AppliedPromotion[]);
    }
    return { id, prevOrder };
  }
}
