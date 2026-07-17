import { IsString, IsUrl } from 'class-validator';

export class ImageToImageDto {
  @IsString()
  @IsUrl()
  imageUrl: string;

  @IsString()
  prompt: string;
}
