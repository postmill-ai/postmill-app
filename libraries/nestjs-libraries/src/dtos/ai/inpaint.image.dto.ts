import { IsString, IsUrl } from 'class-validator';

export class InpaintImageDto {
  @IsString()
  @IsUrl()
  imageUrl: string;

  @IsString()
  @IsUrl()
  maskUrl: string;

  @IsString()
  prompt: string;
}
