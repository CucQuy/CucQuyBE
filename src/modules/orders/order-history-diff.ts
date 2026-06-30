/**
 * Port nguyên util frontend/utils/order/orderHistoryDiff.ts (diffOrders).
 * So sánh 2 phiên bản order, trả về danh sách field đã thay đổi để ghi history.
 */
import { OrderFieldChange, OrderItem } from './orders.types';

const stringifyValue = (v: any): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
};

// Chữ ký so sánh items: dùng name+qty+price (ổn định giữa DB & payload FE).
// KHÔNG dùng it.id vì FE rebuild id tạm (`item-<ts>-<idx>`) mỗi lần sửa →
// id luôn khác id row DB → diff báo "đổi sản phẩm" giả dù nội dung y hệt.
const itemsSignature = (items?: OrderItem[]): string => {
  if (!items || items.length === 0) return '';
  return items
    .map((it) => (it.name || '') + ':' + (it.quantity || 0) + ':' + (it.price || 0))
    .sort()
    .join('|');
};

const itemsSummary = (items?: OrderItem[]): string => {
  if (!items || items.length === 0) return 'Trống';
  const totalQty = items.reduce((s, it) => s + (it.quantity || 0), 0);
  return items.length + ' món · ' + totalQty + ' sản phẩm';
};

/** Cấu hình field được theo dõi trong history. */
const TRACKED_FIELDS: Array<{
  key: string;
  label: string;
  get?: (o: any) => any;
  equals?: (a: any, b: any) => boolean;
  format?: (v: any) => string;
}> = [
  { key: 'status', label: 'Trạng thái' },
  { key: 'paymentStatus', label: 'Thanh toán' },
  { key: 'paymentMethod', label: 'Phương thức TT' },
  { key: 'deliveryType', label: 'Hình thức nhận hàng' },
  { key: 'total', label: 'Tổng tiền' },
  { key: 'shippingCost', label: 'Phí ship' },
  { key: 'deliveryDate', label: 'Ngày giao' },
  { key: 'deliveryTime', label: 'Giờ giao' },
  { key: 'note', label: 'Ghi chú' },
  { key: 'customer.name', label: 'Tên khách', get: (o) => o?.customer?.name },
  { key: 'customer.phone', label: 'SĐT khách', get: (o) => o?.customer?.phone },
  { key: 'customer.address', label: 'Địa chỉ', get: (o) => o?.customer?.address },
  {
    key: 'items',
    label: 'Sản phẩm',
    get: (o) => o?.items,
    equals: (a, b) => itemsSignature(a) === itemsSignature(b),
    format: (v) => itemsSummary(v),
  },
];

/** So sánh 2 phiên bản order, trả về danh sách các field đã thay đổi. */
export const diffOrders = (prev: any, next: any): OrderFieldChange[] => {
  const changes: OrderFieldChange[] = [];
  for (const cfg of TRACKED_FIELDS) {
    const getter = cfg.get ?? ((o: any) => o?.[cfg.key]);
    const a = getter(prev);
    const b = getter(next);
    const eq = cfg.equals ?? ((x, y) => x === y);
    if (eq(a, b)) continue;
    const aBlank = a === null || a === undefined || a === '';
    const bBlank = b === null || b === undefined || b === '';
    if (aBlank && bBlank) continue;

    const fmt = cfg.format ?? stringifyValue;
    const oldValue = aBlank ? '—' : fmt(a);
    const newValue = bBlank ? '—' : fmt(b);
    // Chốt chặn: nếu giá trị hiển thị y hệt thì coi như không đổi, không log
    // (tránh entry nhiễu "X → X" mà người dùng nhìn không thấy khác gì).
    if (oldValue === newValue) continue;
    changes.push({
      field: cfg.key,
      label: cfg.label,
      oldValue,
      newValue,
    });
  }
  return changes;
};
