import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// One optional boolean per notification category — kept in lockstep with
// NOTIFICATION_CATEGORIES (the category union's canonical list). Unknown keys
// are rejected by the global whitelist pipe.
export class CommsCategoriesDto {
  @IsOptional()
  @IsBoolean()
  post_published?: boolean;

  @IsOptional()
  @IsBoolean()
  post_failed?: boolean;

  @IsOptional()
  @IsBoolean()
  channels?: boolean;

  @IsOptional()
  @IsBoolean()
  comments?: boolean;

  @IsOptional()
  @IsBoolean()
  budget?: boolean;

  @IsOptional()
  @IsBoolean()
  media?: boolean;

  @IsOptional()
  @IsBoolean()
  announcements?: boolean;

  @IsOptional()
  @IsBoolean()
  streak?: boolean;

  @IsOptional()
  @IsBoolean()
  agent?: boolean;

  @IsOptional()
  @IsBoolean()
  analytics?: boolean;
}

export class UpsertCommsConfigDto {
  // Free-form credential map rendered from the manifest's credentialFields;
  // values are validated/trimmed by CommsConfigService.
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class CreateCommsLinkDto {
  @IsString()
  @MaxLength(64)
  identifier!: string; // comms providerId; validated against kernel manifests in the service

  @IsString()
  @MaxLength(64)
  userId!: string; // cuid — never @IsUUID

  @IsBoolean()
  agentChatEnabled!: boolean;

  @ValidateNested()
  @Type(() => CommsCategoriesDto)
  categories!: CommsCategoriesDto;
}

export class UpdateCommsLinkDto {
  @IsOptional()
  @IsBoolean()
  agentChatEnabled?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => CommsCategoriesDto)
  categories?: CommsCategoriesDto;
}
