export interface ManualExpense {
  id: string;
  date: string; // ISO yyyy-mm-dd (ngày phát sinh / bắt đầu phân bổ)
  amount: number; // VND (tổng khoản chi)
  category: string; // rent|utilities|... (ExpenseCategory)
  spreadMonths: number; // số tháng phân bổ (1 = ghi 1 lần)
  note?: string | null;
  createdAt: string;
  source?: 'manual' | 'receipt';
}
