import { IsString, MinLength } from 'class-validator';

export class BrandMemorySearchDto {
  @IsString()
  @MinLength(1)
  prompt!: string;
}
