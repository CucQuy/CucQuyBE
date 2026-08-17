import { IsArray } from 'class-validator';

/** 1 phiếu nhập được rải trong 1 lượt (amount rỗng = auto = còn nợ phiếu, cắt theo còn-lại GD). */
export interface TxReceiptAllocItem {
  receiptId: string;
  amount?: number | null;
}

/** Rải 1 GD tiền-ra vào NHIỀU phiếu nhập (transaction-first). */
export class TxReceiptAllocAddDto {
  @IsArray()
  items!: TxReceiptAllocItem[];
}
