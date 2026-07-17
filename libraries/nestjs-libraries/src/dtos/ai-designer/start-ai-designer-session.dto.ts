import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CHANNEL_PRESETS } from '@gitroom/nestjs-libraries/integrations/social/channel-presets';

// Every field here arrives over the AI Designer websocket, where each accepted
// payload can fan out into LLM dispatches and full renders — the numeric and
// size bounds below are the cost ceiling, not cosmetics. Keep them tight.

const VALID_CHANNEL_IDS = CHANNEL_PRESETS.map((p) => p.id);

@ValidatorConstraint({ name: 'isAiDesignerChannelPreset', async: false })
class IsAiDesignerChannelPresetConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown): boolean {
    return (
      Array.isArray(value) &&
      value.every((v) => typeof v === 'string' && VALID_CHANNEL_IDS.includes(v))
    );
  }

  defaultMessage(): string {
    return `channels must be valid preset ids: ${VALID_CHANNEL_IDS.join(', ')}`;
  }
}

class AiDesignerCustomSizeDto {
  @IsNumber()
  @Min(16)
  @Max(4096)
  width!: number;

  @IsNumber()
  @Min(16)
  @Max(4096)
  height!: number;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;
}

export class AiDesignerConfigDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @Validate(IsAiDesignerChannelPresetConstraint)
  channels!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AiDesignerCustomSizeDto)
  customSizes?: AiDesignerCustomSizeDto[];

  @IsString()
  @IsOptional()
  @MaxLength(300)
  savePath?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  saveFolderId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  brandProfileId?: string;

  @IsNumber()
  @Min(1)
  @Max(10)
  variants!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  referenceFileIds?: string[];
}

export class StartAiDesignerSessionDto {
  @IsObject()
  @ValidateNested()
  @Type(() => AiDesignerConfigDto)
  config!: AiDesignerConfigDto;

  @IsString()
  @IsOptional()
  @MaxLength(4000)
  prompt?: string;

  @IsIn(['chat', 'prompt'])
  mode!: 'chat' | 'prompt';

  @IsString()
  @MaxLength(100)
  nonce!: string;
}

export class AiDesignerMessageDto {
  @IsString()
  @MaxLength(4000)
  text!: string;

  @IsString()
  @MaxLength(100)
  nonce!: string;
}

export class AiDesignerFormSubmitDto {
  @IsString()
  @MaxLength(100)
  replyTo!: string;

  @IsObject()
  values!: Record<string, unknown>;

  @IsString()
  @MaxLength(100)
  nonce!: string;
}

export class AiDesignerAcceptPlanDto {
  @IsString()
  @MaxLength(100)
  replyTo!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  variantId?: string;

  @IsBoolean()
  @IsOptional()
  saveTemplate?: boolean;

  @IsString()
  @MaxLength(100)
  nonce!: string;
}

export class AiDesignerReviseDto {
  @IsString()
  @MaxLength(4000)
  instruction!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  targetDesignId?: string;

  @IsString()
  @MaxLength(100)
  nonce!: string;
}
