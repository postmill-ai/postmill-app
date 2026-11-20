import { IsOptional, IsString } from 'class-validator';
import { IsImageSource } from '@postmill-ai/nestjs-libraries/dtos/ai/image-source.validator';

export class OutpaintPageImageDto {
  @IsString()
  @IsImageSource()
  imageUrl: string;

  @IsString()
  @IsImageSource()
  maskUrl: string;

  @IsOptional()
  @IsString()
  prompt?: string;
}
