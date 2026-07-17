import { IsOptional, IsString } from 'class-validator';

export class GenerateVideoDto {
  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  output?: string;
}
