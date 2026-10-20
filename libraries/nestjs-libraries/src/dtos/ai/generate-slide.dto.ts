import { IsArray, IsOptional, IsString, IsUrl } from 'class-validator';

export class GenerateSlideDto {
  // Optional when imageUrls are supplied — the controller substitutes a
  // default topic so images-only slideshows can be generated.
  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  imageUrls?: string[];
}
