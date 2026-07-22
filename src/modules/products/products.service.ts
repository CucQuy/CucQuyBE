import { Injectable } from '@nestjs/common';
import { ProductProc, ProductRow } from './products.proc';
import { Product, ProductVersion, ProductSize, ProductFlavorVariant, PriceTier } from './products.types';

const num = (v: string | number | null): number | undefined =>
  v === null || v === undefined ? undefined : Number(v);

const iso = (v: Date | string | null): string | undefined => {
  if (!v) return undefined;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
};

const mapRow = (r: ProductRow): Product => ({
  id: r.id,
  name: r.name,
  price: num(r.price),
  costPrice: num(r.cost_price),
  description: r.description ?? undefined,
  status: r.status ?? undefined,
  category: r.category ?? undefined,
  categoryId: r.category_id ?? undefined,
  tags: r.tags ?? undefined,
  image: r.image ?? undefined,
  gallery: r.gallery ?? undefined,
  recipeId: r.recipe_id ?? undefined,
  cakesPerProduct: num(r.cakes_per_product),
  flavors: r.flavors ?? undefined,
  sizes: (r.sizes as ProductSize[] | null) ?? undefined,
  flavorVariants: (r.flavor_variants as ProductFlavorVariant[] | null) ?? undefined,
  type: r.type ?? undefined,
  priceTiers: (r.price_tiers as PriceTier[] | null) ?? undefined,
  addOnProductIds: (r.add_on_product_ids as string[] | null) ?? undefined,
  createdAt: iso(r.created_at),
});

/** Service chỉ orchestration + map; mọi call DB qua ProductProc. */
@Injectable()
export class ProductsService {
  constructor(private readonly proc: ProductProc) {}

  async fetchProducts(): Promise<Product[]> {
    return (await this.proc.list()).map(mapRow);
  }

  async addProduct(
    productData: Record<string, unknown>,
  ): Promise<{ id: string }> {
    const rows = await this.proc.create(productData);
    return { id: rows[0].id };
  }

  async updateProduct(
    id: string,
    productData: Record<string, unknown>,
  ): Promise<void> {
    const { id: _ignore, ...rest } = productData;
    await this.proc.update(id, rest);
  }

  /** Xoá field costPrice — đưa sản phẩm ra khỏi danh sách "đã có hoa hồng". */
  async removeProductCostPrice(id: string): Promise<void> {
    await this.proc.removeCostPrice(id);
  }

  async deleteProduct(id: string): Promise<void> {
    await this.proc.delete(id);
  }

  async fetchProductVersions(productId: string): Promise<ProductVersion[]> {
    const [row] = await this.proc.versions(productId);
    return row?.versions ?? [];
  }
}
