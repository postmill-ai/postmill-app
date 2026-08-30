import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

/**
 * class-validator DTOs for the platform `/admin/ai-settings` controller bodies
 * (PROVIDER_REMEDIATION 3.4). Same rationale as provider-config.dtos.ts: inline
 * `Object`-typed bodies bypass the global whitelist pipe. Shapes mirror exactly
 * what AiSettingsService consumes.
 */

export class SaveRagSettingsDto {
  @IsObject()
  ragSettings: Record<string, any>;
}

export class SaveMediaProviderDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  operations?: string[];

  @IsOptional()
  @IsBoolean()
  c2paAvailable?: boolean;
}

export class TriggerRagBackfillDto {
  @IsOptional()
  @IsString()
  organizationId?: string;
}

export class UpdateSecretSettingsDto {
  @IsObject()
  secretSettings: Record<string, string>;
}

export class UpsertOrgProviderConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

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
  @IsObject()
  extraConfig?: Record<string, any>;
}
