import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsJSON,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/**
 * Nested VPN selection for a per-tenant channel config.
 * Mirrors the `vpnSelection` JSON column shape used by `OrgProviderConfiguration`.
 */
export class ChannelVpnSelectionDto {
  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @IsString()
  identifier?: string;

  @IsOptional()
  @IsString()
  regionId?: string;

  @IsOptional()
  @IsString()
  vpnVersion?: string;
}

/**
 * Base DTO shared by create and update bodies.
 *
 * PROVIDER_REMEDIATION S-03: promotes the inline `ChannelConfigBody` interface to
 * class-validator DTOs so the global `whitelist`/`forbidNonWhitelisted` pipe
 * validates types and strips unknown fields instead of the hand-rolled
 * `validateBody()` helper.
 *
 * `name` is deliberately excluded here because create requires it and update keeps
 * it optional; redeclaring a decorated property in a subclass causes class-validator
 * to merge decorators rather than override them.
 */
export class ChannelConfigBodyDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  clientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  clientSecret?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  redirectUri?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  scopes?: string;

  @IsOptional()
  @IsString()
  @ValidateIf((o) => !!o.additionalConfig)
  @IsJSON()
  @MaxLength(8192)
  additionalConfig?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  setupNotes?: string;

  @IsOptional()
  @ValidateIf((o) => o.vpnSelection !== null)
  @ValidateNested()
  @Type(() => ChannelVpnSelectionDto)
  vpnSelection?: ChannelVpnSelectionDto | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  version?: string;
}

/**
 * Body DTO for `PUT /channels/config/:id`.
 */
export class UpdateChannelConfigDto extends ChannelConfigBodyDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}

/**
 * Body DTO for `POST /channels/config`.
 *
 * Adds the provider `identifier` plus a required `name`, which the controller
 * previously asserted by hand.
 */
export class CreateChannelConfigDto extends ChannelConfigBodyDto {
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;
}
