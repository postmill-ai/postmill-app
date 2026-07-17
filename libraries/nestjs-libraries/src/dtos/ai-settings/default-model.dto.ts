import { IsObject, IsOptional, IsString } from 'class-validator';

// Body DTO for PUT /settings/{ai,content/media}-defaults/:category. The `category`
// itself is a route param, validated in each controller against AI_MODEL_CATEGORIES /
// AI_MEDIA_CATEGORIES — there is intentionally no body `category` field here.
export class SetDefaultModelDto {
  @IsString()
  providerId: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
