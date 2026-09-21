import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { StorageProviderType } from '@prisma/client';

/**
 * class-validator DTOs for the per-domain provider-settings controllers
 * (PROVIDER_REMEDIATION 3.4). Inline `{ credentials?: Record<…> }` bodies have
 * metatype `Object`, so the global `whitelist`/`forbidNonWhitelisted` pipe skips
 * them — unknown fields and megabyte credential blobs are stored verbatim (violates
 * the 3Y invariant). These validate types + forbid unknown fields while preserving
 * the exact runtime shape each service consumes. Reference: UpsertShortlinkConfigDto.
 */

/** Shared "test connection" body — optional credentials map. */
export class ProviderTestConnectionDto {
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;
}

/** Shared "set active / make primary" body — optional pinned version. */
export class SetActiveVersionDto {
  @IsOptional()
  @IsString()
  version?: string;
}

// ── Org AI settings ──────────────────────────────────────────────────────────

export class UpsertOrgAiConfigDto {
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;

  @IsOptional()
  @IsString()
  defaultModel?: string;

  @IsOptional()
  @IsString()
  reasoningModel?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  budgetMonthlyCap?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  budgetDailyCap?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  budgetAlertThresholdPct?: number;

  @IsOptional()
  @IsString()
  version?: string;

  // The kit's On/Off toggle PUTs an explicit `{ enabled: false }` (no credentials)
  // to disable without clearing them; configuring defaults to enabled. Mirrors the
  // media surface (media-provider.controller `enabled: body.enabled ?? true`).
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * Org-wide AI budget ceiling (all providers summed). Omitted fields are left
 * unchanged; `null` clears a cap; `enabled: false` clears all three.
 */
export class UpdateBudgetDto {
  @ApiPropertyOptional({ description: 'Monthly ceiling in USD; null clears it', nullable: true, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyCap?: number | null;

  @ApiPropertyOptional({ description: 'Daily ceiling in USD; null clears it', nullable: true, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  dailyCap?: number | null;

  @ApiPropertyOptional({ description: 'Alert at this fraction of the cap (0–1); null = default 0.8', nullable: true, minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  alertThresholdPct?: number | null;

  @ApiPropertyOptional({ description: 'false clears all three caps (toggle off)' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

// ── Media provider settings ──────────────────────────────────────────────────

export class UpsertMediaConfigDto {
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class SetMediaStorageDto {
  @IsString()
  storageProviderId: string;

  @IsOptional()
  @IsString()
  storageRootFolderId?: string;
}

// ── Org VPN settings ─────────────────────────────────────────────────────────

export class UpsertVpnConfigDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  regions?: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

// ── Content pack settings ────────────────────────────────────────────────────

export class UpsertContentPackConfigDto {
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;

  @IsOptional()
  @IsObject()
  extraConfig?: Record<string, any>;
}

// ── Storage settings ─────────────────────────────────────────────────────────

export class CreateStorageConfigDto {
  @IsEnum(StorageProviderType)
  type: StorageProviderType;

  @IsString()
  name: string;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  bucket?: string;

  @IsOptional()
  @IsString()
  endpoint?: string;

  @IsOptional()
  @IsString()
  publicUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  quotaBytes?: number;

  @IsOptional()
  @IsString()
  version?: string;
}

export class UpdateStorageConfigDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  bucket?: string;

  @IsOptional()
  @IsString()
  endpoint?: string;

  @IsOptional()
  @IsString()
  publicUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  quotaBytes?: number;

  @IsOptional()
  @IsString()
  version?: string;
}

export class MigrateStorageDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}

export class SetOrgQuotaDto {
  @IsInt()
  @Min(0)
  quotaBytes: number;
}

export class SetDefaultFolderDto {
  @IsOptional()
  @IsString()
  folderId?: string | null;
}
