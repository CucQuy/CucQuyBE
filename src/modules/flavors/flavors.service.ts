import { Injectable } from '@nestjs/common';
import { FlavorProc, FlavorRow } from './flavors.proc';
import { ProductFlavor } from './flavors.types';

const mapRow = (r: FlavorRow): ProductFlavor => ({
  id: r.id,
  name: r.name,
  color: r.color ?? undefined,
  sortOrder: r.sort_order ?? undefined,
});

/** Service chỉ orchestration + map; mọi call DB qua FlavorProc. */
@Injectable()
export class FlavorsService {
  constructor(private readonly proc: FlavorProc) {}

  async fetchFlavors(): Promise<ProductFlavor[]> {
    return (await this.proc.list()).map(mapRow);
  }

  async saveFlavors(flavors: unknown): Promise<ProductFlavor[]> {
    return (await this.proc.saveAll(flavors)).map(mapRow);
  }
}
