import { Type } from 'class-transformer';
import { IsArray, IsString, ValidateNested } from 'class-validator';

export class ExpenseRuleItemDto {
  @IsString()
  keyword!: string;

  @IsString()
  category!: string;
}

export class SaveExpenseRulesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExpenseRuleItemDto)
  items!: ExpenseRuleItemDto[];
}
