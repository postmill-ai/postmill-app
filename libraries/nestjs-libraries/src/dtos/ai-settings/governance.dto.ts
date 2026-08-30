import { IsOptional, IsString, IsObject } from 'class-validator';

export class SaveGovernanceDto {
  @IsOptional()
  @IsObject()
  guardrailSettings?: Record<string, any>;

  @IsOptional()
  @IsObject()
  budgetSettings?: Record<string, any>;

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
  @IsString()
  fallbackProvider?: string;

  @IsOptional()
  @IsString()
  fallbackImageProvider?: string;
}
