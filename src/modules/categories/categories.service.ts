import { Injectable } from '@nestjs/common';
import { CategoryProc, CategoryRow } from './categories.proc';
import { ProductCategory } from './categories.types';

const mapRow = (r: CategoryRow): ProductCategory => ({
  id: r.id,
  name: r.name,
  parentId: r.parent_id,
  icon: r.icon ?? undefined,
  color: r.color ?? undefined,
  sortOrder: r.sort_order ?? undefined,
  description: r.description ?? undefined,
});

/** Service chỉ orchestration + map; mọi call DB qua CategoryProc. */
@Injectable()
export class CategoriesService {
  constructor(private readonly proc: CategoryProc) {}

  async fetchCategories(): Promise<ProductCategory[]> {
    return (await this.proc.list()).map(mapRow);
  }

  async saveCategories(
    categories: unknown,
    _actor?: { uid?: string; displayName?: string },
  ): Promise<ProductCategory[]> {
    return (await this.proc.saveAll(categories)).map(mapRow);
  }
}
