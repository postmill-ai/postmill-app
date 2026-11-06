import { IsString } from 'class-validator';
import { IsImageSource } from '@postmill-ai/nestjs-libraries/dtos/ai/image-source.validator';

export class MagicGrabImageDto {
  @IsString()
  @IsImageSource()
  imageUrl: string;

  @IsString()
  @IsImageSource()
  cutoutUrl: string;

  @IsString()
  @IsImageSource()
  maskUrl: string;
}
