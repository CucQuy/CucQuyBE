// Kiểu dữ liệu cho module Công thức & Giá thành.

export interface RecipeLineInput {
  ingredientId?: number | string | null;
  childRecipeId?: number | string | null;
  qty?: number | string;
  unit?: string;
  sortOrder?: number;
  note?: string | null;
}

export interface RecipeUpsertBody {
  id?: number | string;
  name?: string;
  kind?: 'product' | 'semi';
  category?: string | null;
  yieldQty?: number | string;
  yieldUnit?: string;
  laborTier?: string | null;
  laborCost?: number | string;
  overheadCost?: number | string;
  packagingCost?: number | string;
  wastePct?: number | string;
  marginPct?: number | string;
  productId?: string | null;
  note?: string | null;
  lines?: RecipeLineInput[];
}

export interface IngredientUpsertBody {
  id?: number | string;
  name?: string;
  unit?: string;
  unitPrice?: number | string;
  materialId?: string | null;
  note?: string | null;
}

export interface IngredientRow {
  id: number;
  name: string;
  unit: string;
  unit_price: string | number;
  material_id: string | null;
  note: string | null;
  created_at: string | Date | null;
  updated_at: string | Date | null;
}

export interface Ingredient {
  id: number;
  name: string;
  unit: string;
  unitPrice: number;
  materialId: string | null;
  note: string | null;
}
