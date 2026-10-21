import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { IsImageSource } from '@postmill-ai/nestjs-libraries/dtos/ai/image-source.validator';

export class UpscaleImageDto {
  @IsString()
  @IsImageSource()
  imageUrl: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(8)
  scale?: number;
}
