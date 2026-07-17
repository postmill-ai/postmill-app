import { IsNumber, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class TelegramUpdatesQueryDto {
  @IsString()
  word: string;

  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => (value ? parseInt(value, 10) : undefined))
  id?: number;
}
