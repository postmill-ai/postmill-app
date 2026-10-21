import { IsString } from 'class-validator';
import { IsImageSource } from '@postmill-ai/nestjs-libraries/dtos/ai/image-source.validator';

export class RemoveBackgroundDto {
  @IsString()
  @IsImageSource()
  imageUrl: string;
}
