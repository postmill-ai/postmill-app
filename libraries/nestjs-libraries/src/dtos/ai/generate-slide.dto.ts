import { IsArray, IsOptional, IsString, IsUrl } from 'class-validator';

export class GenerateSlideDto {
  @IsString()
  prompt: string;

  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  imageUrls?: string[];
}
