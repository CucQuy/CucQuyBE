export interface Transaction {
  id: string;
  accountNumber: string;
  accumulated: number;
  code: string | null;
  content: string;
  createdAt: string;
  description: string;
  gateway: string;
  orderNumber: string;
  receivedAt: string;
  referenceCode: string;
  sepayId: number;
  subAccount: string;
  transactionDate: string;
  transferType: string; // 'in' | 'out'
  transferAmount: number;
  /** Giao dịch không liên quan đến hệ thống (đánh dấu thủ công) */
  isExternal?: boolean;
  /** Tiền RA đã "kết toán" — chuyển về tài khoản chính (đánh dấu thủ công) */
  settledOut?: boolean;
  /** Phân loại chi phí (nội dung CK → category; auto hoặc set tay). */
  expenseCategory?: string | null;
  /** Loại khỏi chi phí (nội bộ / trả NCC đã tính COGS...) — không trừ vào lợi nhuận. */
  costExcluded?: boolean;
  /** Nhận tiền khớp ≥2 đơn cùng số tiền → cần đối soát tay (webhook gắn cờ). */
  needsReview?: boolean;
  reviewNote?: string | null;
}

export interface ExpenseRule {
  id: string;
  keyword: string;
  category: string;
}
