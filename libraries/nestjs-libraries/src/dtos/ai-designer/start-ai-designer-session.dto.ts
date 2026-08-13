import {
  ArrayMaxSize,
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
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
import { STYLE_PRESET_IDS } from '@postmill-ai/nestjs-libraries/ai-designer/styles';

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

// Cross-field: channels may be empty only when at least one custom size is
// provided — the start form allows custom-sizes-only sessions, and an empty
// output list would fail the pipeline anyway.
@ValidatorConstraint({ name: 'aiDesignerChannelsOrCustomSizes', async: false })
class AiDesignerChannelsOrCustomSizesConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown, args: ValidationArguments): boolean {
    if (Array.isArray(value) && value.length > 0) return true;
    const dto = args.object as AiDesignerConfigDto;
    return Array.isArray(dto.customSizes) && dto.customSizes.length > 0;
  }

  defaultMessage(): string {
    return 'provide at least one channel or one custom size';
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
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @Validate(IsAiDesignerChannelPresetConstraint)
  @Validate(AiDesignerChannelsOrCustomSizesConstraint)
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

  // Optional style preset for the whole session — must be a registry id; the
  // frontend selector only offers these, but the payload is websocket-borne.
  @IsString()
  @IsOptional()
  @IsIn([...STYLE_PRESET_IDS])
  styleId?: string;
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

  // Copy the user edited on the plan card: variantId → copy-slot id → text.
  // Shape only is asserted here (the pipe forbids undeclared fields); the
  // conductor validates variant/slot keys against the persisted plans and
  // bounds each value before executing.
  @IsObject()
  @IsOptional()
  texts?: Record<string, Record<string, string>>;

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
