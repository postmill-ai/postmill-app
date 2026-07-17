import {
  Allow,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Lenient DTO for `POST /posts/valid` and `POST /posts/preflight`.
 *
 * These two endpoints only run content/media/settings checks and consume nothing
 * but `body.posts` (see `PostsService.validatePosts` / `preflightCheck`). The strict
 * `CreatePostDto` — which `@IsDefined()`s `shortLink`/`date`/`tags` and types per-post
 * `settings` as a `__type`-discriminated union — rejected the composer's partial
 * pre-check payload with a 400, so no post could be saved/scheduled through the UI (#7).
 *
 * Here every create-time field is accepted-but-optional, and per-post `settings`/`value`
 * are passed through untouched (`@Allow()`, no nested `@Type`) so the global
 * `forbidNonWhitelisted` pipe can't reject provider-specific settings keys. Provider
 * settings are still validated server-side, per provider, inside `validatePosts`
 * (`plainToInstance(provider.dto, settings)`). The real `POST /posts` create path keeps
 * the strict `CreatePostDto` — this loosening is confined to the validation-only routes.
 */

export class ValidateIntegration {
  @IsDefined()
  @IsString()
  id: string;
}

export class ValidatePost {
  @IsOptional()
  @IsString()
  type?: string;

  @IsDefined()
  @Type(() => ValidateIntegration)
  @ValidateNested()
  integration: ValidateIntegration;

  // Content/media are validated per-provider inside the service, not here.
  // Kept loose (no nested @Type) so item keys (id/content/delay/image/alt) survive whitelisting.
  @IsOptional()
  @IsArray()
  @Allow()
  value?: any[];

  @IsOptional()
  @IsString()
  group?: string;

  // Provider settings are a per-provider discriminated union validated server-side;
  // accept arbitrary keys so forbidNonWhitelisted doesn't strip/reject them.
  @IsOptional()
  @Allow()
  settings?: any;
}

export class ValidatePostsDto {
  // Accepted-but-optional create-time fields (declared so the composer's partial body,
  // which may include any subset of these, isn't rejected by forbidNonWhitelisted).
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  order?: string;

  @IsOptional()
  @IsString()
  creationMethod?: string;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @Allow()
  shortLink?: boolean;

  @IsOptional()
  @Allow()
  inter?: number;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsArray()
  @Allow()
  tags?: any[];

  // The only field actually consumed by /valid and /preflight.
  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @Type(() => ValidatePost)
  @ValidateNested({ each: true })
  posts: ValidatePost[];
}
