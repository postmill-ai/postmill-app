import { IsOptional, IsString, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ScopeModelEntryDto {
  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  version?: string;
}

export class SaveGovernanceDto {
  @IsOptional()
  @IsObject()
  guardrailSettings?: Record<string, any>;

  @IsOptional()
  @IsObject()
  budgetSettings?: Record<string, any>;

  @IsOptional()
  @IsObject()
  rateLimitSettings?: Record<string, any>;

  @IsOptional()
  @IsObject()
  observability?: Record<string, any>;

  @IsOptional()
  @IsObject()
  mcpSettings?: Record<string, any>;

  @IsOptional()
  @IsObject()
  ragSettings?: Record<string, any>;

  @IsOptional()
  @IsObject()
  @ValidateNested({ each: true })
  @Type(() => ScopeModelEntryDto)
  scopeModels?: Record<string, ScopeModelEntryDto>;

  @IsOptional()
  @IsString()
  fallbackProvider?: string;

  @IsOptional()
  @IsString()
  fallbackImageProvider?: string;
}
