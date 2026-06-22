import { Injectable } from '@nestjs/common';
import { SurchargeTagProc, SurchargeTagRow } from './surcharge-tags.proc';
import { SurchargeTag } from './surcharge-tags.types';

const mapRow = (r: SurchargeTagRow): SurchargeTag => ({
  key: r.key,
  label: r.label,
  preset: r.preset ?? undefined,
  active: r.active ?? undefined,
  sortOrder: r.sort_order ?? undefined,
});

/** Service chỉ orchestration + map; mọi call DB qua SurchargeTagProc. */
@Injectable()
export class SurchargeTagsService {
  constructor(private readonly proc: SurchargeTagProc) {}

  async fetchSurchargeTags(): Promise<SurchargeTag[]> {
    return (await this.proc.list()).map(mapRow);
  }

  async saveSurchargeTags(
    tags: unknown,
    _actor?: { uid?: string; displayName?: string },
  ): Promise<SurchargeTag[]> {
    return (await this.proc.saveAll(tags)).map(mapRow);
  }
}
