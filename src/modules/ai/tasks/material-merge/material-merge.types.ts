/** 1 NVL đưa vào AI để gợi ý gộp (chỉ field cần thiết). */
export interface MaterialForMerge {
  id: string;
  name: string;
  canonicalUnit?: string | null;
  importCount: number;
}

/** 1 nhóm NVL AI cho là CÙNG sản phẩm (nên gộp). */
export interface AiMergeGroup {
  /** id các NVL trong nhóm (≥2). */
  memberIds: string[];
  /** Tên chuẩn AI đề xuất cho nhóm. */
  suggestedName: string;
  /** Đơn vị chuẩn AI đề xuất (null nếu không chắc). */
  suggestedUnit: string | null;
  /** Độ tin cậy 0–1. */
  confidence: number;
  /** Lý do ngắn (tiếng Việt) vì sao cùng sản phẩm. */
  reason: string;
}
