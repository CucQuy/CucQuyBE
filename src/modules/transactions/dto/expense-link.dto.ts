import { IsString } from 'class-validator';

/** Khớp tay 1 GD tiền-ra với 1 khoản chi phí có sẵn. */
export class ExpenseLinkDto {
  /** id khoản chi phí thủ công (manual_expenses.id). */
  @IsString()
  expenseId!: string;
}
