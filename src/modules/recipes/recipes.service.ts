import { Injectable } from '@nestjs/common';
import { RecipesProc } from './recipes.proc';
import { Ingredient, IngredientRow } from './recipes.types';

const mapIngredient = (r: IngredientRow): Ingredient => ({
  id: r.id,
  name: r.name,
  unit: r.unit,
  unitPrice: Number(r.unit_price ?? 0),
  materialId: r.material_id ?? null,
  note: r.note ?? null,
});

@Injectable()
export class RecipesService {
  constructor(private readonly proc: RecipesProc) {}

  listRecipes() {
    return this.proc.listRecipes();
  }
  getRecipe(id: number) {
    return this.proc.getRecipe(id);
  }
  upsertRecipe(body: unknown) {
    return this.proc.upsertRecipe(body);
  }
  setMargin(id: number, marginPct: number) {
    return this.proc.setMargin(id, marginPct);
  }
  async removeRecipe(id: number): Promise<void> {
    await this.proc.remove(id);
  }

  async listIngredients(): Promise<Ingredient[]> {
    return (await this.proc.listIngredients()).map(mapIngredient);
  }
  async upsertIngredient(body: unknown): Promise<Ingredient> {
    const rows = await this.proc.upsertIngredient(body);
    return mapIngredient(rows[0]);
  }
  async removeIngredient(id: number): Promise<void> {
    await this.proc.removeIngredient(id);
  }
}
