import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoAuthGuard } from '../../auth/sso-auth.guard';
import { RecipesService } from './recipes.service';
import { IngredientUpsertBody, RecipeUpsertBody } from './recipes.types';

@ApiTags('Công thức & Giá thành')
@Controller('recipes')
@UseGuards(SsoAuthGuard)
export class RecipesController {
  constructor(private readonly service: RecipesService) {}

  // --- Nguyên liệu (khai báo TRƯỚC route :id để không bị nuốt) ---
  @Get('ingredients')
  listIngredients() {
    return this.service.listIngredients();
  }
  @Post('ingredients')
  upsertIngredient(@Body() body: IngredientUpsertBody) {
    return this.service.upsertIngredient(body);
  }
  @Delete('ingredients/:id')
  async removeIngredient(@Param('id') id: string) {
    await this.service.removeIngredient(Number(id));
    return { ok: true };
  }

  // --- Công thức ---
  @Get()
  list() {
    return this.service.listRecipes();
  }
  @Post()
  upsert(@Body() body: RecipeUpsertBody) {
    return this.service.upsertRecipe(body);
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.getRecipe(Number(id));
  }
  @Patch(':id/margin')
  setMargin(@Param('id') id: string, @Body() body: { marginPct: number }) {
    return this.service.setMargin(Number(id), Number(body?.marginPct ?? 0));
  }
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.service.removeRecipe(Number(id));
    return { ok: true };
  }
}
