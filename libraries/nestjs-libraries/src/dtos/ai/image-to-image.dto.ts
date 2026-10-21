import { IsString } from 'class-validator';
import { IsImageSource } from '@postmill-ai/nestjs-libraries/dtos/ai/image-source.validator';

export class ImageToImageDto {
  @IsString()
  @IsImageSource()
  imageUrl: string;

  @IsString()
  prompt: string;
}
