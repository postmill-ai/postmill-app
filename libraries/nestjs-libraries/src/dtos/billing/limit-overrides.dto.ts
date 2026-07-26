import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsObject,
  IsOptional,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/**
 * Sparse map of numeric plan-limit overrides (super-admin only, backend-only —
 * consumed by the separate admin app via PATCH /admin/orgs/:orgId/limit-overrides).
 * A number sets the override, `null` clears it, an absent key leaves it.
 * `analytics_retention_days` is deliberately absent (data-lifecycle decision,
 * not a purchasable quota) — it is rejected like any unknown key.
 */
export class LimitOverridesMapDto {
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  channel?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  team_members?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  posts_per_month?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  brand_kits?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  webhooks?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  competitors?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  storage_gb?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  video_exports?: number | null;
}

export class LimitOverridesDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => LimitOverridesMapDto)
  overrides!: LimitOverridesMapDto;
}
