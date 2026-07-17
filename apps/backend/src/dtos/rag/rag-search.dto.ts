import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class RagSearchDto {
  @IsString()
  @MinLength(1)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value
  )
  query!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}
