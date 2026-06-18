import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { ProductVersion } from './products.types';

/** Hàng (snake_case) trả ra từ stored function. */
export type ProductRow = {
  id: string;
  name: string;
  price: string | number | null;
  cost_price: string | number | null;
  description: string | null;
  status: string | null;
  category_id: string | null;
  category: string | null;
  tags: string[] | null;
  image: string | null;
  gallery: string[] | null;
  recipe_id: string | null;
  cakes_per_product: string | number | null;
  created_at: Date | string | null;
};

const COLS = `id, name, price, cost_price, description, status, category_id, category, tags, image, gallery, recipe_id, cakes_per_product, created_at`;

/**
 * Tầng quản lý stored procedure của domain products.
 * Chỉ ở đây mới gọi * — service import class này để dùng.
 */
@Injectable()
export class ProductProc {
  constructor(private readonly db: DbService) {}

  list(): Promise<ProductRow[]> {
    return this.db.sql<ProductRow[]>`
      SELECT ${this.db.sql.unsafe(COLS)} FROM product_list()`;
  }

  create(productData: Record<string, unknown>): Promise<ProductRow[]> {
    return this.db.sql<ProductRow[]>`
      SELECT ${this.db.sql.unsafe(COLS)}
      FROM product_create(${this.db.json(productData ?? {})}::jsonb)`;
  }

  update(id: string, productData: Record<string, unknown>): Promise<unknown> {
    return this.db.sql`
      SELECT id FROM product_update(${id}, ${this.db.json(productData)}::jsonb)`;
  }

  removeCostPrice(id: string): Promise<unknown> {
    return this.db.sql`SELECT id FROM product_remove_cost_price(${id})`;
  }

  delete(id: string): Promise<unknown> {
    return this.db.sql`SELECT product_delete(${id})`;
  }

  versions(productId: string): Promise<{ versions: ProductVersion[] }[]> {
    return this.db.sql<{ versions: ProductVersion[] }[]>`
      SELECT product_versions(${productId}) AS versions`;
  }
}
