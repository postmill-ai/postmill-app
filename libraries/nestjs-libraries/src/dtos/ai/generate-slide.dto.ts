import { IsArray, IsIn, IsInt, IsOptional, IsString, IsUrl, Max, Min, ValidateIf } from 'class-validator';

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

  // How a generated frame is fitted onto the target canvas. Only takes effect
  // when width/height are supplied; defaults to 'cover' server-side.
  @IsOptional()
  @IsIn(['contain', 'cover'])
  fitMode?: 'contain' | 'cover';

  // Coarse aspect for the image-generation call. Derived from width/height
  // server-side when omitted.
  @IsOptional()
  @IsIn(['square', 'wide', 'tall'])
  aspect?: 'square' | 'wide' | 'tall';

  // Target canvas for frame normalization. Both-or-nothing: supplying one
  // without the other is a 400 (ValidateIf on the sibling field).
  @ValidateIf((o) => o.width !== undefined || o.height !== undefined)
  @IsInt()
  @Min(16)
  @Max(16384)
  width?: number;

  @ValidateIf((o) => o.width !== undefined || o.height !== undefined)
  @IsInt()
  @Min(16)
  @Max(16384)
  height?: number;
}
