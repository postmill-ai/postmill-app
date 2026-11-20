import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class ConvertDesignToVideoDto {
  @ApiProperty({ minimum: 100, maximum: 180000, example: 5000 })
  @IsInt()
  @Min(100)
  @Max(180000)
  pageDurationMs!: number;
}
