import { IsBoolean } from 'class-validator';

export class MarkSettledDto {
  @IsBoolean()
  settled!: boolean;
}
