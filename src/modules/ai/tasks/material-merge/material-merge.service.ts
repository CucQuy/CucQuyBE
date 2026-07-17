import { Injectable } from '@nestjs/common';
import { AiClientService } from '../../core/ai-client.service';
import { loadPrompt } from '../../core/prompt.loader';
import { MATERIAL_MERGE_CONFIG } from './material-merge.config';
import { AiMergeGroup, MaterialForMerge } from './material-merge.types';

const SYSTEM_PROMPT = loadPrompt(__dirname, 'material-merge.prompt.md');

/** Nghiệp vụ: gợi ý gộp NVL trùng bằng AI (gom nhóm cùng sản phẩm). */
@Injectable()
export class MaterialMergeService {
  constructor(private readonly ai: AiClientService) {}

  /**
   * Đưa TOÀN BỘ danh sách tên NVL, AI gom các mục CÙNG một sản phẩm thật (dù OCR
   * ghi sai / thiếu dấu / viết tắt khác nhau), đồng thời GIỮ RIÊNG các biến thể
   * khác nhau (loại/thương hiệu/quy cách). Trả về mảng nhóm (≥2 thành viên) đã
   * validate id + clamp confidence.
   */
  async run(materials: MaterialForMerge[]): Promise<AiMergeGroup[]> {
    if (materials.length < 2) return [];

    // Danh sách gọn: "<id>\t<tên>[ (đơn vị)] [xN lần nhập]" — 1 dòng 1 NVL.
    const list = materials
      .map(
        (m) =>
          `${m.id}\t${m.name}${m.canonicalUnit ? ` (${m.canonicalUnit})` : ''} [x${m.importCount}]`,
      )
      .join('\n');

    const raw = await this.ai.complete(MATERIAL_MERGE_CONFIG, SYSTEM_PROMPT, list);
    const parsed = this.ai.parseJson<{ groups?: unknown }>(raw);
    const rawGroups = Array.isArray(parsed.groups) ? parsed.groups : [];
    const validIds = new Set(materials.map((m) => m.id));

    return rawGroups
      .map((g): AiMergeGroup => {
        const r = (g ?? {}) as Record<string, unknown>;
        const memberIds = Array.isArray(r.memberIds)
          ? Array.from(
              new Set(
                (r.memberIds as unknown[]).filter(
                  (id): id is string =>
                    typeof id === 'string' && validIds.has(id),
                ),
              ),
            )
          : [];
        const confidence =
          typeof r.confidence === 'number'
            ? Math.max(0, Math.min(1, r.confidence))
            : 0;
        return {
          memberIds,
          suggestedName: this.ai.normalizeStr(r.suggestedName) ?? '',
          suggestedUnit: this.ai.normalizeStr(r.suggestedUnit),
          confidence,
          reason: this.ai.normalizeStr(r.reason) ?? '',
        };
      })
      .filter((g) => g.memberIds.length >= 2);
  }
}
