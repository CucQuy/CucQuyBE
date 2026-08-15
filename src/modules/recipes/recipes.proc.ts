import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { IngredientRow } from './recipes.types';

type JsonRow = { data: unknown };

@Injectable()
export class RecipesProc {
  constructor(private readonly db: DbService) {}

  // --- Công thức (hàm trả jsonb đã camelCase) ---
  async listRecipes(): Promise<unknown> {
    const rows = await this.db.sql<JsonRow[]>`SELECT recipe_list() AS data`;
    return rows[0]?.data ?? [];
  }
  async getRecipe(id: number): Promise<unknown> {
    const rows = await this.db.sql<JsonRow[]>`SELECT recipe_get(${id}) AS data`;
    return rows[0]?.data ?? null;
  }
  async upsertRecipe(body: unknown): Promise<unknown> {
    const rows = await this.db.sql<JsonRow[]>`SELECT recipe_upsert(${this.db.json(body ?? {})}::jsonb) AS data`;
    return rows[0]?.data ?? null;
  }
  async setMargin(id: number, marginPct: number): Promise<unknown> {
    const rows = await this.db.sql<JsonRow[]>`SELECT recipe_set_margin(${id}, ${marginPct}) AS data`;
    return rows[0]?.data ?? null;
  }
  remove(id: number): Promise<unknown> {
    return this.db.sql`SELECT recipe_delete(${id})`;
  }

  // --- Nguyên liệu (SETOF table → snake_case rows) ---
  listIngredients(): Promise<IngredientRow[]> {
    return this.db.sql<IngredientRow[]>`SELECT * FROM ingredient_list()`;
  }
  upsertIngredient(body: unknown): Promise<IngredientRow[]> {
    return this.db.sql<IngredientRow[]>`SELECT * FROM ingredient_upsert(${this.db.json(body ?? {})}::jsonb)`;
  }
  removeIngredient(id: number): Promise<unknown> {
    return this.db.sql`SELECT ingredient_delete(${id})`;
  }
}
