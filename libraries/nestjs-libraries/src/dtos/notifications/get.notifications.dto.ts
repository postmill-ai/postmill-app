import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GetNotificationsDto {
  @ApiPropertyOptional({
    description: 'Zero-based page index.',
    minimum: 0,
    maximum: 1_000_000,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  @Transform(({ value }) => Number(value))
  page?: number = 0;
}
