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
  @IsString()
  version?: string;

  // The kit's On/Off toggle PUTs an explicit `{ enabled: false }` (no credentials)
  // to disable without clearing them; configuring defaults to enabled. Mirrors the
  // media surface (media-provider.controller `enabled: body.enabled ?? true`).
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateBudgetDto {
  @IsOptional()
  @IsNumber()
  monthlyCap?: number;

  @IsOptional()
  @IsNumber()
  dailyCap?: number;

  @IsOptional()
  @IsNumber()
  alertThresholdPct?: number;

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

// ── Channel (social OAuth-app) config ────────────────────────────────────────

// PUT /admin/channel-configs/:identifier body. Was an inline object literal
// (metatype `Object`), so the global whitelist/forbidNonWhitelisted pipe skipped
// it — unknown fields passed through. `enabled` is required (the controller also
// asserts it is a boolean); the rest mirror the ProviderConfiguration upsert shape.
export class SaveChannelConfigDto {
  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  clientSecret?: string;

  @IsOptional()
  @IsString()
  redirectUri?: string;

  @IsOptional()
  @IsString()
  scopes?: string;

  @IsOptional()
  @IsString()
  additionalConfig?: string;

  @IsOptional()
  @IsString()
  setupInstructions?: string;
}
