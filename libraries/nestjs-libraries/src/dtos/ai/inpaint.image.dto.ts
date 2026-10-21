import { IsString } from 'class-validator';
import { IsImageSource } from '@postmill-ai/nestjs-libraries/dtos/ai/image-source.validator';

export class InpaintImageDto {
  @IsString()
  @IsImageSource()
  imageUrl: string;

  @IsString()
  @IsImageSource()
  maskUrl: string;

  @IsString()
  prompt: string;
}
